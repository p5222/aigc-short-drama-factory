import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import type { ProjectWorkflow } from "@aifilm/shared";
import { captureMediaSource, lockMediaProject } from "../db/mediaSource.js";
import { captureVideoExportSnapshot } from "../export/exportCompletion.js";

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;

test("PostgreSQL media source admission, recovery and dependency safety", { skip: !databaseUrl, timeout: 90_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const { runMediaTask, mediaCheckpoint } = await import("./mediaTask.js");
  const { getProjectWorkflow, persistProjectExportSuccess } = await import("../db/repository.js");
  const { persistCurrentShotImages, persistCurrentShotVideo, persistStaleShotOutputs, persistStoryboardTailFrame } = await import("../db/mediaPersistence.js");
  const users: string[] = [];
  const signal = () => {
    let resolve!: () => void;
    return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
  };

  async function fixture(shotCount = 2) {
    const userId = `source_safety_user_${crypto.randomUUID()}`;
    users.push(userId);
    const projectId = `source_safety_project_${crypto.randomUUID()}`;
    await db.user.create({ data: { id: userId, name: "Source safety fixture", credit: { create: { id: `credit_${userId}`, balance: 1_000 } } } });
    await db.project.create({ data: { id: projectId, userId, name: "Source safety fixture", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "rendering", storyboards: shotCount, videoClips: shotCount } });
    for (let index = 0; index < shotCount; index++) {
      const id = `${projectId}_${index}`;
      await db.storyboard.create({ data: { id, projectId, episodeNo: 1, sceneNo: 1, shotNo: index + 1, duration: 2, shotSize: "全景", cameraAngle: "平视", cameraMovement: "固定", characters: [], scene: "书店", pictureDesc: `shot ${index}`,
        dialogue: "", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: `image ${index}`, videoPrompt: `video ${index}`, referenceAssetIds: [], status: "succeeded" } });
      await db.asset.createMany({ data: ["image", "video"].map(kind => ({ id: `${kind}_${id}`, projectId, type: kind, name: `shot ${index} ${kind}`, description: "Fixture original", prompt: kind,
        referenceUrl: `/storage/${kind}_${id}.${kind === "video" ? "mp4" : "png"}`, status: "succeeded" })) });
    }
    const workflow = await getProjectWorkflow(projectId, userId, db);
    assert.ok(workflow);
    return { userId, projectId, workflow };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const inputFor = (f: Fixture, kind: "image" | "video", index = 0, workflow: ProjectWorkflow = f.workflow) => ({
    userId: f.userId, projectId: f.projectId, projectName: workflow.project.name, type: kind,
    scope: kind === "image" ? "image" : `video:${workflow.storyboards[index]!.id}`,
    provider: "fixture-no-provider-calls", model: "fixture", estimatedCredits: 30, title: "Fixture generation", resume: kind === "video",
    source: captureMediaSource(workflow, kind, [workflow.storyboards[index]!.id])
  });
  const account = (f: Fixture) => db.creditAccount.findUniqueOrThrow({ where: { userId: f.userId } });
  const tasks = (f: Fixture) => db.generationTask.findMany({ where: { projectId: f.projectId }, orderBy: { createdAt: "asc" } });
  const assets = (f: Fixture) => db.asset.findMany({ where: { projectId: f.projectId }, orderBy: { id: "asc" } });
  async function inheritTail(f: Fixture, source = f.workflow.storyboards[0]!, child = f.workflow.storyboards[1]!) {
    const frameId = `tailframe_${source.id}`;
    await db.asset.create({ data: { id: frameId, projectId: f.projectId, type: "image", name: "Source tail", description: "Fixture tail", prompt: "", referenceUrl: `/storage/${frameId}.png`, status: "succeeded" } });
    await db.storyboard.update({ where: { id: source.id }, data: { lastFrameAssetId: frameId } });
    await db.storyboard.update({ where: { id: child.id }, data: { firstFrameAssetId: frameId, continuitySourceShotId: source.id } });
    return frameId;
  }

  try {
    await t.test("image and video work exclude each other before the second callback or reservation in either direction", async () => {
      for (const kind of ["image", "video"] as const) {
        const f = await fixture(), started = signal(), release = signal();
        let competingCalls = 0;
        const first = runMediaTask(inputFor(f, kind), async context => {
          started.resolve(); await release.promise;
          return context.complete(30, async () => ({ delivered: true }));
        }, db);
        await started.promise;
        try {
          await assert.rejects(runMediaTask(inputFor(f, kind === "image" ? "video" : "image"), async context => {
            competingCalls++; return context.complete(30, async () => ({ delivered: true }));
          }, db), { status: 409 });
          assert.equal(competingCalls, 0); assert.equal((await tasks(f)).length, 1); assert.equal((await account(f)).frozenBalance, 30);
        } finally { release.resolve(); await first; }
        assert.equal((await account(f)).balance, 970); assert.equal((await account(f)).frozenBalance, 0);
      }
    });

    await t.test("different independent video shots can run concurrently and each settle only its own result", async () => {
      const f = await fixture(), started = [signal(), signal()], release = signal();
      const promises = [0, 1].map(index => runMediaTask(inputFor(f, "video", index), async context => {
        started[index]!.resolve(); await release.promise;
        return context.complete(30, tx => persistCurrentShotVideo(tx, { projectId: f.projectId, shot: f.workflow.storyboards[index]!, url: `/storage/parallel_${index}.mp4`, credits: 30 }));
      }, db));
      await Promise.all(started.map(item => item.promise));
      try { assert.equal((await tasks(f)).length, 2); assert.equal((await account(f)).frozenBalance, 60); }
      finally { release.resolve(); await Promise.all(promises); }
      assert.equal((await account(f)).balance, 940); assert.equal((await account(f)).frozenBalance, 0);
      assert.equal((await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).videoClips, 2);
      for (const index of [0, 1]) assert.equal((await db.asset.findUniqueOrThrow({ where: { id: `video_${f.workflow.storyboards[index]!.id}` } })).referenceUrl, `/storage/parallel_${index}.mp4`);
    });

    await t.test("a new request with a stale input fingerprint is rejected before freezing credits or invoking a provider", async () => {
      for (const kind of ["image", "video"] as const) {
        const f = await fixture(), input = inputFor(f, kind);
        await db.storyboard.update({ where: { id: f.workflow.storyboards[0]!.id }, data: { pictureDesc: "A newer edit" } });
        const before = await account(f); let calls = 0;
        await assert.rejects(runMediaTask(input, async context => { calls++; return context.complete(30, async () => ({})); }, db), { status: 409 });
        assert.equal(calls, 0); assert.deepEqual(await account(f), before); assert.equal((await tasks(f)).length, 0);
        assert.equal(await db.creditTransaction.count({ where: { userId: f.userId } }), 0);
      }
    });

    await t.test("pending video recovery keeps its durable task/source and queries once without resubmission", async () => {
      const f = await fixture(), input = inputFor(f, "video"), shot = f.workflow.storyboards[0]!;
      let submissions = 0, queries = 0;
      const pending = await runMediaTask(input, async context => {
        submissions++;
        await context.checkpoint({ submissionStarted: true, remoteTaskId: "fixture-remote-original" });
        return context.defer({ remoteTaskId: "fixture-remote-original" });
      }, db);
      assert.deepEqual(pending.requestPayload, { kind: "media_source", source: input.source });
      const done = await runMediaTask(input, async context => {
        assert.equal(context.taskId, pending.id); assert.deepEqual(context.task.requestPayload, pending.requestPayload);
        assert.equal(mediaCheckpoint(context.task).remoteTaskId, "fixture-remote-original"); queries++;
        await context.checkpoint({ remoteVideoUrl: "/storage/recovered.mp4" });
        return context.complete(30, tx => persistCurrentShotVideo(tx, { projectId: f.projectId, shot, url: "/storage/recovered.mp4", credits: 30 }));
      }, db);
      assert.equal(done.task.id, pending.id); assert.equal(done.task.status, "succeeded");
      assert.equal(submissions, 1); assert.equal(queries, 1); assert.equal((await tasks(f)).length, 1);
      assert.equal((await account(f)).balance, 970); assert.equal((await account(f)).frozenBalance, 0);
      assert.equal(mediaCheckpoint(done.task).remoteTaskId, "fixture-remote-original");
    });

    await t.test("a pending video based on an older image or prompt recovers to history with zero consumption", async () => {
      for (const mutation of ["image", "prompt"] as const) {
        const f = await fixture(), input = inputFor(f, "video"), shot = f.workflow.storyboards[0]!;
        const originalVideo = await db.asset.findUniqueOrThrow({ where: { id: `video_${shot.id}` } });
        const pending = await runMediaTask(input, context => context.defer({ submissionStarted: true, remoteTaskId: `fixture-${mutation}` }), db);
        if (mutation === "image") await db.asset.update({ where: { id: `image_${shot.id}` }, data: { referenceUrl: "/storage/new-current-image.png" } });
        else await db.storyboard.update({ where: { id: shot.id }, data: { videoPrompt: "A changed prompt during an old remote request" } });
        const fresh = await getProjectWorkflow(f.projectId, f.userId, db); assert.ok(fresh);
        const afterEditAssets = await assets(f); let canonicalCalls = 0, historyCalls = 0, queries = 0;
        const done = await runMediaTask(inputFor(f, "video", 0, fresh), async context => {
          assert.equal(context.taskId, pending.id); assert.deepEqual(context.task.requestPayload, pending.requestPayload); queries++;
          const output = [{ shot, url: `/storage/stale_${mutation}.mp4` }];
          return context.complete(30, async tx => { canonicalCalls++; return persistCurrentShotVideo(tx, { projectId: f.projectId, shot, url: output[0]!.url, credits: 30 }); }, {
            onStale: async tx => { historyCalls++; return persistStaleShotOutputs(tx, { projectId: f.projectId, taskId: context.taskId, type: "video", outputs: output }); }
          });
        }, db);
        assert.equal(done.created, 0); assert.equal(done.task.status, "failed"); assert.equal(done.task.finalCredits, 0);
        assert.equal(canonicalCalls, 0); assert.equal(historyCalls, 1); assert.equal(queries, 1);
        assert.equal((await account(f)).balance, 1_000); assert.equal((await account(f)).frozenBalance, 0);
        assert.equal(await db.creditTransaction.count({ where: { userId: f.userId, type: "consume" } }), 0);
        assert.equal(mediaCheckpoint(done.task).remoteTaskId, `fixture-${mutation}`); assert.equal(mediaCheckpoint(done.task).sourceStale, true);
        assert.deepEqual(await db.asset.findUniqueOrThrow({ where: { id: originalVideo.id } }), originalVideo);
        assert.deepEqual((await assets(f)).filter(asset => !asset.id.startsWith("asset_history_")), afterEditAssets);
        assert.equal(await db.asset.count({ where: { projectId: f.projectId, referenceUrl: `/storage/stale_${mutation}.mp4` } }), 1);
      }
    });

    await t.test("an unknown remote submission stays reserved and cannot trigger a second callback", async () => {
      const f = await fixture(), input = inputFor(f, "video"); let calls = 0;
      await assert.rejects(runMediaTask(input, async context => {
        calls++; await context.checkpoint({ submissionStarted: true }); throw new Error("Fixture connection lost after submission");
      }, db), /connection lost/);
      const original = (await tasks(f))[0]!;
      await assert.rejects(runMediaTask(input, async context => { calls++; return context.complete(30, async () => ({})); }, db), /尚未确认/);
      assert.equal(calls, 1); assert.equal((await tasks(f)).length, 1); assert.equal((await tasks(f))[0]!.id, original.id);
      assert.equal((await tasks(f))[0]!.status, "pending"); assert.equal((await account(f)).frozenBalance, 30); assert.equal((await account(f)).balance, 1_000);
      assert.equal(mediaCheckpoint((await tasks(f))[0]!).submissionStarted, true);
    });

    await t.test("successful first-frame replacement archives old videos and preserves a previously exported full film", async () => {
      const f = await fixture(), shot = f.workflow.storyboards[0]!, jobId = `source_export_${crypto.randomUUID()}`;
      await db.exportJob.create({ data: { id: jobId, userId: f.userId, projectId: f.projectId, type: "video_export", status: "running" } });
      await persistProjectExportSuccess({ projectId: f.projectId, userId: f.userId, jobId, type: "video_export", workflow: f.workflow, videoSnapshot: captureVideoExportSnapshot(f.workflow),
        exportResult: { outputKind: "mp4", outputUrl: "/storage/previous-full.mp4", ffmpegReady: true, clipCount: 2 } }, db);
      const oldImage = (await db.asset.findUniqueOrThrow({ where: { id: `image_${shot.id}` } })).referenceUrl;
      const oldVideo = (await db.asset.findUniqueOrThrow({ where: { id: `video_${shot.id}` } })).referenceUrl;
      const result = await runMediaTask(inputFor(f, "image"), context => context.complete(30,
        tx => persistCurrentShotImages(tx, f.projectId, [{ shot, url: "/storage/new-first-frame.png" }], 30)), db);
      assert.equal(result.created, 1); assert.equal(result.task.status, "succeeded");
      assert.equal((await db.asset.findUniqueOrThrow({ where: { id: `image_${shot.id}` } })).referenceUrl, "/storage/new-first-frame.png");
      assert.equal(await db.asset.findUnique({ where: { id: `video_${shot.id}` } }), null);
      assert.equal(await db.asset.count({ where: { projectId: f.projectId, referenceUrl: { in: [oldImage!, oldVideo!, "/storage/previous-full.mp4"] } } }), 3);
      assert.equal((await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).status, "asseting");
      assert.equal((await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).videoClips, 1);
      assert.equal((await account(f)).balance, 970);
    });

    await t.test("regenerating an inherited first frame retains its valid incoming edge for later upstream invalidation", async () => {
      for (const legacyFrameOnly of [false, true]) {
        const f = await fixture(), [parent, child] = f.workflow.storyboards;
        assert.ok(parent && child);
        const frameId = await inheritTail(f);
        if (legacyFrameOnly) await db.storyboard.update({ where: { id: child.id }, data: { continuitySourceShotId: null } });
        const workflow = await getProjectWorkflow(f.projectId, f.userId, db); assert.ok(workflow);
        await runMediaTask(inputFor(f, "image", 1, workflow), context => context.complete(30,
          tx => persistCurrentShotImages(tx, f.projectId, [{ shot: workflow.storyboards[1]!, url: "/storage/inherited-new.png" }], 30)), db);
        const renewed = await db.storyboard.findUniqueOrThrow({ where: { id: child.id } });
        assert.equal(renewed.firstFrameAssetId, frameId); assert.equal(renewed.continuitySourceShotId, parent.id);
        const nextWorkflow = await getProjectWorkflow(f.projectId, f.userId, db); assert.ok(nextWorkflow);
        await runMediaTask(inputFor(f, "video", 0, nextWorkflow), context => context.complete(30,
          tx => persistCurrentShotVideo(tx, { projectId: f.projectId, shot: nextWorkflow.storyboards[0]!, url: "/storage/parent-replaced.mp4", credits: 30 })), db);
        const invalid = await db.storyboard.findUniqueOrThrow({ where: { id: child.id } });
        assert.equal(invalid.firstFrameAssetId, null); assert.equal(invalid.continuitySourceShotId, null); assert.equal(invalid.status, "pending");
        assert.equal(await db.asset.findUnique({ where: { id: `image_${child.id}` } }), null);
        assert.equal(await db.asset.count({ where: { projectId: f.projectId, referenceUrl: "/storage/inherited-new.png" } }), 1);
        assert.equal((await account(f)).balance, 940); assert.equal((await account(f)).frozenBalance, 0);
      }
    });

    await t.test("one image batch cannot restore an incoming edge whose source was invalidated by another selected root", async () => {
      const f = await fixture(), frameId = await inheritTail(f);
      const workflow = await getProjectWorkflow(f.projectId, f.userId, db); assert.ok(workflow);
      await db.$transaction(async tx => {
        await lockMediaProject(tx, f.projectId, f.userId);
        return persistCurrentShotImages(tx, f.projectId, workflow.storyboards.map(shot => ({ shot, url: `/storage/batch-${shot.id}.png` })), 0);
      });
      const child = await db.storyboard.findUniqueOrThrow({ where: { id: workflow.storyboards[1]!.id } });
      assert.equal(child.firstFrameAssetId, null); assert.equal(child.continuitySourceShotId, null);
      assert.equal(await db.asset.findUnique({ where: { id: frameId } }), null);
    });

    await t.test("related image batches reject before provider callbacks or credit writes, while an unselected parent does not block independent targets", async () => {
      for (const indirect of [false, true]) {
        const f = await fixture(4), [a, b, c, independent] = f.workflow.storyboards;
        assert.ok(a && b && c && independent);
        await inheritTail(f, a, b);
        if (indirect) await inheritTail(f, b, c);
        const workflow = await getProjectWorkflow(f.projectId, f.userId, db); assert.ok(workflow);
        const descendant = indirect ? c : b;
        const input = { ...inputFor(f, "image", 0, workflow), estimatedCredits: 60, source: captureMediaSource(workflow, "image", [a.id, descendant.id]) };
        let calls = 0;
        const beforeAssets = await assets(f), beforeAccount = await account(f);
        await assert.rejects(runMediaTask(input, async context => { calls++; return context.complete(60, async () => ({})); }, db), { status: 409 });
        assert.equal(calls, 0); assert.deepEqual(await account(f), beforeAccount); assert.deepEqual(await assets(f), beforeAssets);
        assert.equal((await tasks(f)).length, 0); assert.equal(await db.creditTransaction.count({ where: { userId: f.userId } }), 0);
        // The production caller builds source.shotIds after excluding existing images and applying its batch limit.
        const targets = [workflow.storyboards[indirect ? 2 : 1]!, workflow.storyboards[3]!];
        await runMediaTask({ ...input, source: captureMediaSource(workflow, "image", targets.map(shot => shot.id)) }, async context => {
          calls++; return context.complete(60, tx => persistCurrentShotImages(tx, f.projectId, targets.map(shot => ({ shot, url: `/storage/allowed-${shot.id}.png` })), 60));
        }, db);
        assert.equal(calls, 1); assert.equal((await account(f)).balance, 940); assert.equal((await account(f)).frozenBalance, 0);
        const renewed = await db.storyboard.findUniqueOrThrow({ where: { id: descendant.id } });
        assert.equal(renewed.continuitySourceShotId, indirect ? b.id : a.id);
      }
    });

    await t.test("first-frame persistence never restores a cross-project tail dependency", async () => {
      const f = await fixture(), foreign = await fixture(), frameId = await inheritTail(foreign);
      const foreignAssets = await assets(foreign);
      await db.storyboard.update({ where: { id: f.workflow.storyboards[1]!.id }, data: { firstFrameAssetId: frameId, continuitySourceShotId: foreign.workflow.storyboards[0]!.id } });
      const workflow = await getProjectWorkflow(f.projectId, f.userId, db); assert.ok(workflow);
      await runMediaTask(inputFor(f, "image", 1, workflow), context => context.complete(30,
        tx => persistCurrentShotImages(tx, f.projectId, [{ shot: workflow.storyboards[1]!, url: "/storage/own-new.png" }], 30)), db);
      const child = await db.storyboard.findUniqueOrThrow({ where: { id: workflow.storyboards[1]!.id } });
      assert.equal(child.firstFrameAssetId, null); assert.equal(child.continuitySourceShotId, null);
      assert.deepEqual(await assets(foreign), foreignAssets);
    });

    await t.test("missing, unsuccessful, empty or mismatched current tail sources cannot be revived after image replacement", async () => {
      for (const kind of ["missing", "failed", "empty", "mismatched"] as const) {
        const f = await fixture(), frameId = await inheritTail(f);
        if (kind === "missing") await db.asset.delete({ where: { id: frameId } });
        if (kind === "failed") await db.asset.update({ where: { id: frameId }, data: { status: "failed" } });
        if (kind === "empty") await db.asset.update({ where: { id: frameId }, data: { referenceUrl: null } });
        if (kind === "mismatched") await db.storyboard.update({ where: { id: f.workflow.storyboards[0]!.id }, data: { lastFrameAssetId: "tailframe_another_current_source" } });
        const workflow = await getProjectWorkflow(f.projectId, f.userId, db); assert.ok(workflow);
        await runMediaTask(inputFor(f, "image", 1, workflow), context => context.complete(30,
          tx => persistCurrentShotImages(tx, f.projectId, [{ shot: workflow.storyboards[1]!, url: `/storage/${kind}-new.png` }], 30)), db);
        const child = await db.storyboard.findUniqueOrThrow({ where: { id: workflow.storyboards[1]!.id } });
        assert.equal(child.firstFrameAssetId, null); assert.equal(child.continuitySourceShotId, null);
      }
    });

    await t.test("tail capture rejects an old video/source or active work, then invalidates the actual next shot's video", async () => {
      const f = await fixture(), [shot, next] = f.workflow.storyboards;
      assert.ok(shot && next);
      const oldVideoUrl = (await db.asset.findUniqueOrThrow({ where: { id: `video_${shot.id}` } })).referenceUrl!;
      const tailInput = { projectId: f.projectId, userId: f.userId, shotId: shot.id, storedUrl: "/storage/new-tail.png", sourceVideoUrl: oldVideoUrl,
        source: captureMediaSource(f.workflow, "video", [shot.id, next.id]), nextShotId: next.id };
      await db.asset.update({ where: { id: `video_${shot.id}` }, data: { referenceUrl: "/storage/new-root-video.mp4" } });
      await assert.rejects(persistStoryboardTailFrame(tailInput, db), /当前镜头视频已更新/);
      await db.storyboard.update({ where: { id: next.id }, data: { videoPrompt: "new next shot prompt" } });
      await assert.rejects(persistStoryboardTailFrame({ ...tailInput, sourceVideoUrl: "/storage/new-root-video.mp4" }, db), /素材已变化/);
      const fresh = await getProjectWorkflow(f.projectId, f.userId, db); assert.ok(fresh);
      const validTail = { ...tailInput, sourceVideoUrl: "/storage/new-root-video.mp4", source: captureMediaSource(fresh, "video", [shot.id, next.id]) };
      const started = signal(), release = signal();
      const active = runMediaTask(inputFor(f, "video", 0, fresh), async context => { started.resolve(); await release.promise; return context.complete(0, async () => ({}), { status: "failed", errorReason: "Fixture finished without output" }); }, db);
      await started.promise;
      try { await assert.rejects(persistStoryboardTailFrame(validTail, db), { status: 409 }); }
      finally { release.resolve(); await active; }
      const result = await persistStoryboardTailFrame(validTail, db);
      assert.equal(result.asset.referenceUrl, "/storage/new-tail.png");
      assert.equal(result.updatedNextShot!.firstFrameAssetId, `tailframe_${shot.id}`); assert.equal(result.updatedNextShot!.continuitySourceShotId, shot.id);
      assert.equal((await db.asset.findUniqueOrThrow({ where: { id: `image_${next.id}` } })).referenceUrl, "/storage/new-tail.png");
      assert.equal(await db.asset.findUnique({ where: { id: `video_${next.id}` } }), null);
      assert.equal((await db.asset.findUniqueOrThrow({ where: { id: `video_${shot.id}` } })).referenceUrl, "/storage/new-root-video.mp4");
      assert.equal((await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).videoClips, 1);
      assert.equal((await account(f)).balance, 1_000); assert.equal((await account(f)).frozenBalance, 0);
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
