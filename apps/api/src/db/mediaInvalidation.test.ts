import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { archiveCurrentAsset, archiveReferenceAsset, countCurrentImageAssets, invalidateReferenceMedia, invalidateShotMedia, isHistoricalAssetId } from "./mediaInvalidation.js";

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;

test("historical asset recognition does not mistake ordinary names for archived outputs", () => {
  assert.equal(isHistoricalAssetId(`role_example_history_${crypto.randomUUID()}`), true);
  assert.equal(isHistoricalAssetId("asset_history_task_result"), true);
  for (const id of ["image_history_book", "role_project_history_person", "tailframe_history_123", "video_history_not-a-uuid"]) assert.equal(isHistoricalAssetId(id), false);
});

test("PostgreSQL media invalidation preserves history and follows actual continuity", { skip: !databaseUrl, timeout: 60_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const userId = `media_invalidation_${crypto.randomUUID()}`;
  await db.user.create({ data: { id: userId, name: "Media history fixture" } });

  async function fixture() {
    const projectId = `media_dependency_${crypto.randomUUID()}`;
    const ids = Object.fromEntries(["a", "b", "c", "d"].map(label => [label, `${projectId}_${label}`])) as Record<"a" | "b" | "c" | "d", string>;
    await db.project.create({ data: { id: projectId, userId, name: "Continuity fixture", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "completed", videoClips: 4, storyboards: 4 } });
    for (const [index, label] of (["a", "b", "c", "d"] as const).entries()) {
      const id = ids[label];
      await db.storyboard.create({ data: {
        id, projectId, episodeNo: 1, sceneNo: 1, shotNo: index + 1, duration: 2, shotSize: "全景", cameraAngle: "平视", cameraMovement: "固定", characters: [], scene: "书店", pictureDesc: label,
        dialogue: "", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: label, videoPrompt: label, referenceAssetIds: [], status: "succeeded",
        firstFrameAssetId: label === "b" ? `tailframe_${ids.a}` : label === "c" ? `tailframe_${ids.b}` : `image_${id}`,
        lastFrameAssetId: `tailframe_${id}`, continuitySourceShotId: label === "b" ? ids.a : label === "c" ? ids.b : null
      } });
      await db.asset.createMany({ data: ["image", "video", "tailframe"].map(kind => ({
        id: `${kind}_${id}`, projectId, type: kind === "video" ? "video" : "image", name: `${label} ${kind}`, description: "Original description", prompt: label,
        referenceUrl: `/storage/${kind}_${id}.${kind === "video" ? "mp4" : "png"}`, status: "succeeded"
      })) });
    }
    return { projectId, ids };
  }

  const locked = <T>(projectId: string, run: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(async tx => {
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`project-lifecycle:${projectId}`}))`;
    await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
    return run(tx);
  });
  const state = async (projectId: string) => ({
    project: await db.project.findUniqueOrThrow({ where: { id: projectId } }),
    shots: await db.storyboard.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
    assets: await db.asset.findMany({ where: { projectId }, orderBy: { id: "asc" } })
  });

  try {
    await t.test("A → B → C continuity invalidates descendant media while independent D remains intact", async () => {
      const { projectId, ids } = await fixture();
      const before = await state(projectId);
      const result = await locked(projectId, tx => invalidateShotMedia(tx, projectId, [ids.a], { reason: "A 视频已重新生成" }));
      assert.deepEqual(result.shotIds, [ids.a, ids.b, ids.c]);
      const after = await state(projectId);
      assert.equal(after.project.videoClips, 1);
      assert.equal(after.project.status, "asseting");
      for (const id of [ids.a, ids.b, ids.c]) {
        assert.equal(after.assets.some(asset => asset.id === `video_${id}` || asset.id === `tailframe_${id}`), false);
        assert.equal(after.shots.find(shot => shot.id === id)!.lastFrameAssetId, null);
      }
      assert.ok(after.assets.some(asset => asset.id === `image_${ids.a}`), "the root's unchanged first frame is still usable");
      for (const id of [ids.b, ids.c]) {
        assert.equal(after.assets.some(asset => asset.id === `image_${id}`), false);
        const shot = after.shots.find(item => item.id === id)!;
        assert.equal(shot.firstFrameAssetId, null); assert.equal(shot.continuitySourceShotId, null); assert.equal(shot.status, "pending");
      }
      assert.deepEqual(after.shots.find(shot => shot.id === ids.d), before.shots.find(shot => shot.id === ids.d));
      assert.deepEqual(after.assets.filter(asset => asset.id.endsWith(ids.d)), before.assets.filter(asset => asset.id.endsWith(ids.d)));
      assert.equal(after.assets.length, before.assets.length, "assets are archived, never deleted");
      assert.deepEqual(after.assets.map(asset => asset.referenceUrl).sort(), before.assets.map(asset => asset.referenceUrl).sort(), "every existing physical file URL is retained");
      assert.equal(after.assets.filter(asset => asset.id.includes("_history_")).length, 8);
    });

    await t.test("manual edits invalidate the root image too, and repeated invalidation does not duplicate history", async () => {
      const { projectId, ids } = await fixture();
      await locked(projectId, tx => invalidateShotMedia(tx, projectId, [ids.a, ids.a], { includeImages: true, reason: "镜头编辑" }));
      const first = await state(projectId);
      assert.equal(first.project.status, "storyboarding");
      assert.equal(first.assets.some(asset => asset.id === `image_${ids.a}`), false);
      const root = first.shots.find(shot => shot.id === ids.a)!;
      assert.equal(root.firstFrameAssetId, null); assert.equal(root.continuitySourceShotId, null); assert.equal(root.status, "pending");
      assert.equal(first.assets.filter(asset => asset.id.includes("_history_")).length, 9);
      await locked(projectId, tx => invalidateShotMedia(tx, projectId, [ids.a], { includeImages: true, reason: "重复操作" }));
      assert.deepEqual((await state(projectId)).assets, first.assets);
    });

    await t.test("archiving preserves the asset's quality, feedback and published-work audit relationships", async () => {
      const { projectId, ids } = await fixture();
      const assetId = `video_${ids.a}`;
      const qualityId = `quality_${crypto.randomUUID()}`, feedbackId = `feedback_${crypto.randomUUID()}`, showcaseId = `showcase_${crypto.randomUUID()}`;
      await db.qualityReport.create({ data: { id: qualityId, projectId, assetId, stage: "video", totalScore: 90, pass: true, dimensionScores: {}, problems: [], suggestions: [], recommendedAction: "export" } });
      await db.userFeedback.create({ data: { id: feedbackId, userId, projectId, assetId, stage: "video", tags: [], content: "保留历史评价" } });
      await db.showcaseWork.create({ data: { id: showcaseId, creatorId: userId, projectId, sourceAssetId: assetId, title: "Published fixture", coverUrl: "/storage/fixture.png", videoUrl: `/storage/video_${ids.a}.mp4`, status: "published" } });
      await locked(projectId, tx => archiveCurrentAsset(tx, projectId, assetId, "镜头视频替换"));
      assert.equal(await db.asset.findUnique({ where: { id: assetId } }), null);
      const historical = await db.asset.findFirstOrThrow({ where: { projectId, id: { startsWith: `${assetId}_history_` } } });
      assert.equal(historical.referenceUrl, `/storage/video_${ids.a}.mp4`);
      assert.equal(historical.status, "succeeded"); assert.match(historical.description, /Original description.*\n历史版本：镜头视频替换/);
      assert.equal((await db.qualityReport.findUniqueOrThrow({ where: { id: qualityId } })).assetId, historical.id);
      assert.equal((await db.userFeedback.findUniqueOrThrow({ where: { id: feedbackId } })).assetId, historical.id);
      const showcased = await db.showcaseWork.findUniqueOrThrow({ where: { id: showcaseId } });
      assert.equal(showcased.sourceAssetId, historical.id); assert.equal(showcased.videoUrl, historical.referenceUrl); assert.equal(showcased.status, "published");
    });

    await t.test("cross-project IDs and even malformed cross-project inheritance never mutate the other project", async () => {
      const first = await fixture(), second = await fixture();
      await db.storyboard.update({ where: { id: second.ids.a }, data: { continuitySourceShotId: first.ids.a, firstFrameAssetId: `tailframe_${first.ids.a}` } });
      const before = await state(second.projectId);
      const original = await state(first.projectId);
      await locked(first.projectId, async tx => {
        await archiveCurrentAsset(tx, first.projectId, `video_${second.ids.a}`, "错误项目");
        assert.deepEqual(await invalidateShotMedia(tx, first.projectId, [second.ids.a, "unknown"], { includeImages: true, reason: "错误项目" }), { shotIds: [] });
      });
      assert.deepEqual(await state(first.projectId), original);
      await locked(first.projectId, tx => invalidateShotMedia(tx, first.projectId, [first.ids.a], { includeImages: true, reason: "本项目镜头编辑" }));
      assert.deepEqual(await state(second.projectId), before);
    });

    await t.test("legacy single-field inheritance and accidental cycles are traversed once", async () => {
      const { projectId, ids } = await fixture();
      await db.storyboard.update({ where: { id: ids.b }, data: { continuitySourceShotId: null } });
      await db.storyboard.update({ where: { id: ids.c }, data: { firstFrameAssetId: null } });
      await db.storyboard.update({ where: { id: ids.a }, data: { continuitySourceShotId: ids.c, firstFrameAssetId: `tailframe_${ids.c}` } });
      const result = await locked(projectId, tx => invalidateShotMedia(tx, projectId, [ids.a], { includeImages: true, reason: "循环保护" }));
      assert.deepEqual(result.shotIds, [ids.a, ids.b, ids.c]);
      assert.equal((await state(projectId)).assets.filter(asset => asset.id.includes("_history_")).length, 9);
    });

    await t.test("current image counts exclude tail frames, historical outputs and detached images", async () => {
      const { projectId } = await fixture();
      await db.asset.createMany({ data: ["role", "role_derivative", "scene", "prop", "cover", "role_reference"].map(type => ({
        id: `${projectId}_${type}`, projectId, type, name: type, description: type, prompt: type, status: "succeeded"
      })).concat([
        { id: `${projectId}_role_history_${crypto.randomUUID()}`, projectId, type: "role", name: "history", description: "history", prompt: "history", status: "succeeded" },
        { id: `asset_history_${projectId}`, projectId, type: "scene", name: "history", description: "history", prompt: "history", status: "succeeded" },
        { id: `image_detached_${projectId}`, projectId, type: "image", name: "detached", description: "detached", prompt: "detached", status: "succeeded" }
      ]) });
      assert.equal(await locked(projectId, tx => countCurrentImageAssets(tx, projectId)), 9);
      await locked(projectId, tx => archiveReferenceAsset(tx, projectId, `${projectId}_role`, "角色已替换"));
      assert.equal(await locked(projectId, tx => countCurrentImageAssets(tx, projectId)), 8);
      const history = await db.asset.findFirstOrThrow({ where: { id: { startsWith: `${projectId}_role_history_` }, description: { contains: "角色已替换" } } });
      assert.equal(history.type, "role");
      await locked(projectId, tx => archiveReferenceAsset(tx, projectId, history.id, "重复归档"));
      assert.ok(await db.asset.findUnique({ where: { id: history.id } }));
    });

    await t.test("reference changes follow character name, character ID and explicit role references", async () => {
      const { projectId, ids } = await fixture();
      const characterId = `character_${crypto.randomUUID()}`, roleId = `role_${characterId}`, referenceId = `reference_${characterId}`;
      await db.character.create({ data: { id: characterId, projectId, name: "甲", identity: "主角", appearance: "fixture", costume: "fixture", personality: "fixture", prompt: "fixture", negativePrompt: "", referenceAssetId: roleId } });
      await db.asset.createMany({ data: [roleId, referenceId].map((id, index) => ({ id, projectId, type: index ? "role_reference" : "role", relatedCharacterId: characterId,
        name: "甲角色", description: "fixture", prompt: "fixture", referenceUrl: `/storage/${id}.png`, status: "succeeded" })) });
      await db.storyboard.update({ where: { id: ids.a }, data: { characters: ["甲"] } });
      await db.storyboard.update({ where: { id: ids.b }, data: { characters: [characterId], firstFrameAssetId: null, continuitySourceShotId: null } });
      await db.storyboard.update({ where: { id: ids.c }, data: { referenceAssetIds: [referenceId], firstFrameAssetId: null, continuitySourceShotId: null } });
      const d = await db.storyboard.findUniqueOrThrow({ where: { id: ids.d } });
      const result = await locked(projectId, tx => invalidateReferenceMedia(tx, projectId, userId, { characterIds: [characterId] }, "角色参考图更新"));
      assert.deepEqual(result.shotIds, [ids.a, ids.b, ids.c]);
      assert.deepEqual(await db.storyboard.findUniqueOrThrow({ where: { id: ids.d } }), d);
      assert.equal((await state(projectId)).project.videoClips, 1);
      assert.equal((await state(projectId)).project.imageAssets, 2, "one canonical D image and one current role board; user reference is counted separately");
    });

    await t.test("implicit scene dependencies invalidate only matching shots and cross-project reference IDs are ignored", async () => {
      const first = await fixture(), other = await fixture();
      const sceneId = `scene_${crypto.randomUUID()}`, foreignId = `scene_${crypto.randomUUID()}`;
      await db.asset.createMany({ data: [{ id: sceneId, projectId: first.projectId }, { id: foreignId, projectId: other.projectId }].map(row => ({ ...row, type: "scene", name: "书店关键场景", description: "fixture", prompt: "fixture", referenceUrl: `/storage/${row.id}.png`, status: "succeeded" })) });
      await db.storyboard.update({ where: { id: first.ids.d }, data: { scene: "海边" } });
      const before = await state(first.projectId), foreignBefore = await state(other.projectId);
      await locked(first.projectId, async tx => {
        await archiveReferenceAsset(tx, first.projectId, foreignId, "foreign ignored");
        assert.deepEqual(await invalidateReferenceMedia(tx, first.projectId, userId, { assetIds: [foreignId] }, "foreign ignored"), { shotIds: [] });
      });
      assert.deepEqual(await state(first.projectId), before);
      await assert.rejects(locked(first.projectId, tx => invalidateReferenceMedia(tx, first.projectId, "wrong-owner", { assetIds: [sceneId] }, "wrong owner")), /无权/);
      const result = await locked(first.projectId, async tx => {
        const affected = await invalidateReferenceMedia(tx, first.projectId, userId, { assetIds: [sceneId] }, "书店场景替换");
        await archiveReferenceAsset(tx, first.projectId, sceneId, "书店场景替换");
        return affected;
      });
      assert.deepEqual(result.shotIds, [first.ids.a, first.ids.b, first.ids.c]);
      assert.deepEqual(await db.storyboard.findUniqueOrThrow({ where: { id: first.ids.d } }), before.shots.find(shot => shot.id === first.ids.d));
      assert.deepEqual(await state(other.projectId), foreignBefore);
      const historical = await db.asset.findFirstOrThrow({ where: { projectId: first.projectId, id: { startsWith: `${sceneId}_history_` } } });
      assert.equal(historical.type, "scene"); assert.equal(historical.referenceUrl, `/storage/${sceneId}.png`);
    });
  } finally {
    // Showcase creator/project references intentionally survive deletion in production; remove only these fixtures.
    await db.showcaseWork.deleteMany({ where: { creatorId: userId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
