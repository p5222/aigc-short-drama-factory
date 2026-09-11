import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { captureReferenceSource } from "./mediaSource.js";
import { isHistoricalAssetId } from "./mediaAssetIdentity.js";

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;
test("reference source mutation and settlement preserve current media and history", { skip: !databaseUrl, timeout: 60_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const { getProjectWorkflow } = await import("./repository.js");
  const { runMediaTask, mediaCheckpoint } = await import("../billing/mediaTask.js");
  const { persistCharacterReferenceInput, removeCharacterReferenceInputs, persistCurrentReferenceImage, persistStaleReferenceOutputs } = await import("./mediaPersistence.js");
  const users: string[] = [];
  async function fixture() {
    const id = crypto.randomUUID(), userId = `reference_user_${id}`, projectId = `reference_project_${id}`, characterId = `character_${id}`, roleId = `role_${id}`, sceneId = `scene_${id}`;
    users.push(userId);
    await db.user.create({ data: { id: userId, name: "Reference fixture", credit: { create: { id: `credit_${id}`, balance: 1000 } } } });
    await db.project.create({ data: { id: projectId, userId, name: "Reference fixture", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "completed", videoClips: 2 } });
    await db.character.create({ data: { id: characterId, projectId, name: "小林", identity: "主角", appearance: "short hair", costume: "coat", personality: "quiet", prompt: "original character", negativePrompt: "", referenceAssetId: roleId } });
    await db.asset.createMany({ data: [
      { id: roleId, projectId, type: "role", name: "小林角色", description: "original", prompt: "role prompt", referenceUrl: `/storage/${roleId}.png`, status: "succeeded", relatedCharacterId: characterId },
      { id: sceneId, projectId, type: "scene", name: "书店", description: "original scene", prompt: "scene prompt", referenceUrl: `/storage/${sceneId}.png`, status: "succeeded" }
    ] });
    for (const index of [0, 1]) {
      const shotId = `${projectId}_${index}`;
      await db.storyboard.create({ data: { id: shotId, projectId, episodeNo: 1, sceneNo: index + 1, shotNo: index + 1, duration: 2, shotSize: "全景", cameraAngle: "平视", cameraMovement: "固定", characters: index === 0 ? ["小林"] : [], scene: index === 0 ? "书店" : "海边", pictureDesc: "fixture", dialogue: "", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: "image", videoPrompt: "video", referenceAssetIds: [], status: "succeeded" } });
      await db.asset.createMany({ data: ["image", "video"].map(kind => ({ id: `${kind}_${shotId}`, projectId, type: kind, name: kind, description: "original", prompt: kind, referenceUrl: `/storage/${kind}_${shotId}.${kind === "video" ? "mp4" : "png"}`, status: "succeeded" })) });
    }
    const workflow = await getProjectWorkflow(projectId, userId, db);
    assert.ok(workflow);
    return { userId, projectId, characterId, roleId, sceneId, workflow };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const assets = (f: Fixture) => db.asset.findMany({ where: { projectId: f.projectId }, orderBy: { id: "asc" } });
  const account = (f: Fixture) => db.creditAccount.findUniqueOrThrow({ where: { userId: f.userId } });
  const input = (f: Fixture, assetId = f.sceneId) => ({ userId: f.userId, projectId: f.projectId, projectName: "Reference fixture", type: "image", scope: "image", provider: "fixture", model: "fixture", estimatedCredits: 30, title: "Reference generation", source: captureReferenceSource(f.workflow, [assetId]) });
  try {
    await t.test("adding and removing a character reference invalidates only dependent current media and retains reference history", async () => {
      const f = await fixture(), target = f.workflow.storyboards[0]!.id, independent = f.workflow.storyboards[1]!.id;
      const added = await persistCharacterReferenceInput(f.projectId, f.characterId, f.userId, { referenceUrl: "/storage/new-character-reference.png" }, db);
      assert.equal(await db.asset.count({ where: { id: { in: [`image_${target}`, `video_${target}`] } } }), 0);
      assert.equal(await db.asset.count({ where: { id: { in: [`image_${independent}`, `video_${independent}`] } } }), 2);
      assert.ok((await db.storyboard.findUniqueOrThrow({ where: { id: target } })).referenceAssetIds.includes(added.id));
      assert.equal((await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).status, "storyboarding");
      const removed = await removeCharacterReferenceInputs(f.projectId, f.characterId, f.userId, db);
      assert.equal(removed.deletedAssets, 1);
      assert.ok(!(await db.storyboard.findUniqueOrThrow({ where: { id: target } })).referenceAssetIds.includes(added.id));
      assert.ok((await assets(f)).some(asset => isHistoricalAssetId(asset.id) && asset.referenceUrl === added.referenceUrl));
      assert.equal((await account(f)).balance, 1000);
      assert.equal(await db.creditTransaction.count({ where: { userId: f.userId } }), 0);
    });
    await t.test("reference upload and deletion cannot change input under an in-flight video reservation", async () => {
      const f = await fixture();
      await persistCharacterReferenceInput(f.projectId, f.characterId, f.userId, { referenceUrl: "/storage/preexisting-reference.png" }, db);
      const media = { ...input(f), type: "video", scope: "video:guarded-reference", source: undefined, resume: true };
      const pending = await runMediaTask(media, context => context.defer({ remoteTaskId: "fixture-no-network" }), db);
      const before = await assets(f);
      await assert.rejects(persistCharacterReferenceInput(f.projectId, f.characterId, f.userId, { referenceUrl: "/storage/new-reference.png" }, db), { status: 409 });
      await assert.rejects(removeCharacterReferenceInputs(f.projectId, f.characterId, f.userId, db), { status: 409 });
      assert.deepEqual(await assets(f), before);
      assert.equal((await account(f)).frozenBalance, 30);
      const settled = await runMediaTask(media, context => context.complete(0, async () => ({}), { status: "failed", errorReason: "Fixture remote canceled" }), db);
      assert.equal(settled.task.id, pending.id);
    });
    await t.test("a changed role reference fingerprint fails before task creation or a provider callback", async () => {
      const f = await fixture(), original = input(f, f.roleId);
      await persistCharacterReferenceInput(f.projectId, f.characterId, f.userId, { referenceUrl: "/storage/updated-reference.png" }, db);
      let calls = 0;
      await assert.rejects(runMediaTask(original, async context => { calls++; return context.complete(30, async () => ({})); }, db), { status: 409 });
      assert.equal(calls, 0);
      assert.equal(await db.generationTask.count({ where: { userId: f.userId } }), 0);
      assert.equal((await account(f)).frozenBalance, 0);
    });
    await t.test("scene image replacement archives its old source and invalidates implicit scene shots only", async () => {
      const f = await fixture();
      const result = await runMediaTask(input(f), context => context.complete(30, tx => persistCurrentReferenceImage(tx, { projectId: f.projectId, userId: f.userId, assetId: f.sceneId, prompt: "new scene", url: "/storage/new-scene.png", credits: 30 })), db);
      assert.equal(result.created, 1);
      assert.equal((await db.asset.findUniqueOrThrow({ where: { id: f.sceneId } })).referenceUrl, "/storage/new-scene.png");
      assert.ok((await assets(f)).some(asset => isHistoricalAssetId(asset.id) && asset.referenceUrl === `/storage/${f.sceneId}.png`));
      assert.equal(await db.asset.count({ where: { id: `video_${f.workflow.storyboards[0]!.id}` } }), 0);
      assert.equal(await db.asset.count({ where: { id: `video_${f.workflow.storyboards[1]!.id}` } }), 1);
      assert.equal((await account(f)).balance, 970);
      assert.equal((await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).imageAssets, 3, "one current shot image plus current role and scene; no history counted");
    });
    await t.test("a late reference provider result is retained in history without overwriting a newer source or consuming credits", async () => {
      const f = await fixture();
      const result = await runMediaTask(input(f), async context => {
        await context.checkpoint({ remoteTaskId: "reference-provider-history" });
        await db.asset.update({ where: { id: f.sceneId }, data: { prompt: "changed outside the original request", referenceUrl: "/storage/newer-scene.png" } });
        return context.complete(30,
          async () => { assert.fail("Stale source must never enter canonical persistence"); },
          { onStale: tx => persistStaleReferenceOutputs(tx, f.projectId, context.taskId, [{ name: "书店", type: "scene", prompt: "original input", url: "/storage/late-scene.png" }]) });
      }, db);
      assert.equal(result.task.status, "failed");
      assert.equal(mediaCheckpoint(result.task).remoteTaskId, "reference-provider-history");
      assert.equal((await db.asset.findUniqueOrThrow({ where: { id: f.sceneId } })).referenceUrl, "/storage/newer-scene.png");
      assert.ok((await assets(f)).some(asset => isHistoricalAssetId(asset.id) && asset.referenceUrl === "/storage/late-scene.png"));
      assert.equal((await account(f)).balance, 1000); assert.equal((await account(f)).frozenBalance, 0);
      assert.equal(await db.creditTransaction.count({ where: { userId: f.userId, type: "consume" } }), 0);
    });
    await t.test("an expired image or reference lease with an unknown remote outcome cannot be submitted again", async () => {
      const f = await fixture();
      let submissions = 0;
      const pending = await runMediaTask(input(f), async context => { submissions++; return context.defer({ submissionStarted: true }); }, db);
      await db.generationTask.update({ where: { id: pending.id }, data: { status: "running", updatedAt: new Date(Date.now() - 180_000) } });
      await assert.rejects(runMediaTask(input(f), async context => { submissions++; return context.complete(30, async () => ({})); }, db), { status: 409 });
      assert.equal(submissions, 1);
      assert.equal(await db.generationTask.count({ where: { projectId: f.projectId } }), 1);
      assert.equal((await account(f)).balance, 1000); assert.equal((await account(f)).frozenBalance, 30);
    });
  } finally { await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect(); }
});
