import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { captureVideoExportSnapshot } from "./exportCompletion.js";
import { selectExportWorkflow } from "./exportSelection.js";
import type { MediaExportResult } from "./mediaExport.js";

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;

test("export completion and shot invalidation commit consistently in PostgreSQL", { skip: !databaseUrl, timeout: 60_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const { getProjectWorkflow, persistProjectExportSuccess } = await import("../db/repository.js");
  const { updateStoryboardShot } = await import("../db/storyboardActions.js");
  const { runMediaTask } = await import("../billing/mediaTask.js");
  const userId = `export_completion_user_${crypto.randomUUID()}`;
  await db.user.create({ data: { id: userId, name: "Export completion fixture", credit: { create: { id: `credit_${userId}`, balance: 1_000 } } } });

  async function fixture(episodes = 2, populatedEpisodes = episodes) {
    const projectId = `export_completion_${crypto.randomUUID()}`;
    await db.project.create({ data: { id: projectId, userId, name: "Two episodes", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "rendering", episodes } });
    for (let episodeNo = 1; episodeNo <= populatedEpisodes; episodeNo++) {
      const shotId = `${projectId}_shot_${episodeNo}`;
      await db.storyboard.create({ data: {
        id: shotId, projectId, episodeNo, sceneNo: 1, shotNo: 1, duration: 2, shotSize: "全景", cameraAngle: "平视", cameraMovement: "固定",
        characters: [], scene: "书店", pictureDesc: "雨后的书店", dialogue: "", voiceOver: "", environmentSound: "", soundEffect: "",
        imagePrompt: "bookstore", videoPrompt: "a quiet bookstore", referenceAssetIds: [], status: "succeeded"
      } });
      await db.asset.createMany({ data: [
        { id: `image_${shotId}`, projectId, type: "image", name: "First frame", description: "Fixture", prompt: "bookstore", referenceUrl: `/storage/${shotId}.png`, status: "succeeded" },
        { id: `video_${shotId}`, projectId, type: "video", name: "Source clip", description: "Fixture", prompt: "bookstore", referenceUrl: `/storage/${shotId}.mp4`, status: "succeeded" }
      ] });
    }
    const workflow = await getProjectWorkflow(projectId, userId, db);
    assert.ok(workflow);
    return { projectId, workflow };
  }

  // Media bytes are covered by the real FFmpeg composition suite. These tests execute the same
  // production persistence function as createProjectExportJob, with no paid provider calls.
  async function prepareExport(source: Awaited<ReturnType<typeof fixture>>, selectedIds?: string[]) {
    const workflow = selectExportWorkflow(source.workflow, selectedIds);
    const jobId = `completion_job_${crypto.randomUUID()}`;
    await db.exportJob.create({ data: { id: jobId, projectId: source.projectId, userId, type: "video_export", status: "running" } });
    const exportResult: MediaExportResult = { outputKind: "mp4", outputUrl: `/storage/${jobId}.mp4`, ffmpegReady: true, clipCount: workflow.storyboards.length };
    return { projectId: source.projectId, userId, jobId, type: "video_export" as const, workflow, exportResult, videoSnapshot: captureVideoExportSnapshot(workflow) };
  }

  const status = async (projectId: string) => (await db.project.findUniqueOrThrow({ where: { id: projectId } })).status;
  const diagnostics = (job: { errorReason: string | null }) => JSON.parse(job.errorReason || "{}");
  const editingState = async (projectId: string) => ({
    project: await db.project.findUniqueOrThrow({ where: { id: projectId } }),
    shots: await db.storyboard.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
    assets: await db.asset.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
    account: await db.creditAccount.findUniqueOrThrow({ where: { userId } }),
    ledger: await db.creditTransaction.findMany({ where: { projectId }, orderBy: { id: "asc" } })
  });

  // Observe real PostgreSQL waiters, rather than assuming a sleep means two operations overlapped.
  async function awaitAdvisoryWaiters(blockerPid: number, expected: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM pg_locks waiting
        JOIN pg_locks holding ON waiting.locktype = holding.locktype
          AND waiting.database IS NOT DISTINCT FROM holding.database
          AND waiting.classid IS NOT DISTINCT FROM holding.classid
          AND waiting.objid IS NOT DISTINCT FROM holding.objid
          AND waiting.objsubid IS NOT DISTINCT FROM holding.objsubid
        WHERE holding.pid = ${blockerPid} AND holding.granted
          AND waiting.locktype = 'advisory' AND NOT waiting.granted`;
      if (row?.count === expected) return;
      await delay(10);
    }
    assert.fail(`Expected ${expected} operations waiting on the project lifecycle lock`);
  }

  async function inLockOrder<T, U>(projectId: string, first: () => Promise<T>, second: () => Promise<U>) {
    let release!: () => void;
    let ready!: (pid: number) => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<number>(resolve => { ready = resolve; });
    const blocker = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`project-lifecycle:${projectId}`}))`;
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      ready(row!.pid);
      await gate;
    }, { timeout: 15_000 });
    const blockerPid = await started;
    let firstResult: Promise<PromiseSettledResult<T>> | undefined;
    let secondResult: Promise<PromiseSettledResult<U>> | undefined;
    const settle = <V>(promise: Promise<V>): Promise<PromiseSettledResult<V>> => promise.then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason }));
    try {
      firstResult = settle(first());
      await awaitAdvisoryWaiters(blockerPid, 1);
      secondResult = settle(second());
      await awaitAdvisoryWaiters(blockerPid, 2);
    } finally {
      release();
      await blocker;
      // Always drain launched operations before fixture cleanup, even if a lock assertion fails.
      await Promise.all([firstResult, secondResult]);
    }
    const a = await firstResult!, b = await secondResult!;
    if (a.status === "rejected") throw a.reason;
    if (b.status === "rejected") throw b.reason;
    return [a.value, b.value] as const;
  }

  try {
    await t.test("a selected episode creates a downloadable artifact but only all current episodes complete the project", async () => {
      const source = await fixture();
      const partial = await prepareExport(source, [source.workflow.storyboards[0]!.id]);
      const partialJob = await persistProjectExportSuccess(partial, db);
      assert.equal(partialJob.status, "succeeded");
      assert.equal(await status(source.projectId), "rendering");
      assert.equal(diagnostics(partialJob).projectCompletion, "partial_scope");
      assert.equal(await db.asset.count({ where: { projectId: source.projectId, referenceUrl: partial.exportResult.outputUrl } }), 1);
      const full = await prepareExport(source);
      const complete = await persistProjectExportSuccess(full, db);
      assert.equal(await status(source.projectId), "completed");
      assert.equal(diagnostics(complete).projectCompletion, "complete");
      assert.deepEqual(diagnostics(complete).storyboardIds, source.workflow.storyboards.map(shot => shot.id));
      assert.equal(diagnostics(complete).videoSnapshot.inputFingerprint, full.videoSnapshot.inputFingerprint);
      const anotherPartial = await persistProjectExportSuccess(await prepareExport(source, [source.workflow.storyboards[1]!.id]), db);
      assert.equal(diagnostics(anotherPartial).projectCompletion, "partial_scope", "a selected export never claims full coverage itself");
      assert.match(diagnostics(anotherPartial).message, /已有与当前内容一致的完整成片/);
      assert.equal(await status(source.projectId), "completed", "a valid prior full export survives later partial exports");
    });

    await t.test("existing shots do not complete a project whose planned second episode is missing", async () => {
      const source = await fixture(2, 1);
      const job = await persistProjectExportSuccess(await prepareExport(source), db);
      assert.equal(job.status, "succeeded");
      assert.equal(await status(source.projectId), "rendering");
      assert.equal(diagnostics(job).projectCompletion, "planned_episodes_incomplete");
    });

    await t.test("the compositor clip count and MP4 result are checked before completion", async () => {
      const source = await fixture();
      const input = await prepareExport(source);
      await assert.rejects(persistProjectExportSuccess({ ...input, exportResult: { ...input.exportResult, outputKind: "diagnostic_bundle" } }, db), /MP4/);
      assert.equal((await db.exportJob.findUniqueOrThrow({ where: { id: input.jobId } })).status, "running");
      input.exportResult.clipCount = 1;
      const job = await persistProjectExportSuccess(input, db);
      assert.equal(diagnostics(job).projectCompletion, "clip_count_mismatch");
      assert.equal(await status(source.projectId), "rendering");
    });

    await t.test("editing a completed shot atomically invalidates its media and preserves the historic export", async () => {
      const source = await fixture();
      const input = await prepareExport(source);
      await persistProjectExportSuccess(input, db);
      const shotId = source.workflow.storyboards[0]!.id;
      const shot = await updateStoryboardShot(source.projectId, shotId, userId, { dialogue: "现在重新出发。" }, db);
      assert.equal(shot.status, "pending");
      assert.equal(shot.dialogue, "现在重新出发。");
      assert.equal(await status(source.projectId), "storyboarding");
      assert.equal(await db.asset.count({ where: { id: { in: [`image_${shotId}`, `video_${shotId}`] } } }), 0);
      assert.equal(await db.asset.count({ where: { projectId: source.projectId, referenceUrl: input.exportResult.outputUrl } }), 1);
    });

    await t.test("a source edit makes earlier full proof unusable for later partial exports", async () => {
      const source = await fixture();
      const full = await prepareExport(source);
      await persistProjectExportSuccess(full, db);
      await updateStoryboardShot(source.projectId, source.workflow.storyboards[0]!.id, userId, { dialogue: "更改后的台词。" }, db);
      const workflow = await getProjectWorkflow(source.projectId, userId, db);
      assert.ok(workflow);
      const partial = await prepareExport({ ...source, workflow }, [workflow.storyboards[1]!.id]);
      await persistProjectExportSuccess(partial, db);
      assert.equal(await status(source.projectId), "storyboarding");
      // Even a stale legacy status is insufficient: the prior full snapshot must still match.
      await db.project.update({ where: { id: source.projectId }, data: { status: "completed" } });
      await persistProjectExportSuccess(await prepareExport({ ...source, workflow }, [workflow.storyboards[1]!.id]), db);
      assert.equal(await status(source.projectId), "rendering");
      assert.equal(await db.asset.count({ where: { projectId: source.projectId, referenceUrl: full.exportResult.outputUrl } }), 1);
    });

    await t.test("running and pending media tasks reject edits without changing shots, assets or reserved credits", async () => {
      const source = await fixture(1);
      const input = { userId, projectId: source.projectId, projectName: "Fixture", type: "video", scope: "video:edit-protection", provider: "fixture", model: "fixture", title: "Fixture", estimatedCredits: 30, resume: true };
      const assertEditingRejected = async () => {
        const before = await editingState(source.projectId);
        await assert.rejects(updateStoryboardShot(source.projectId, source.workflow.storyboards[0]!.id, userId, { duration: 8 }, db), { status: 409 });
        assert.deepEqual(await editingState(source.projectId), before);
      };
      const pending = await runMediaTask(input, async context => {
        await assertEditingRejected();
        return context.defer({ remoteTaskId: "fixture-only-no-provider" });
      }, db);
      assert.equal(pending.status, "pending");
      assert.equal((await db.creditAccount.findUniqueOrThrow({ where: { userId } })).frozenBalance, 30);
      await assertEditingRejected();
      await runMediaTask(input, context => context.complete(30, async () => ({ delivered: true })), db);
      const edited = await updateStoryboardShot(source.projectId, source.workflow.storyboards[0]!.id, userId, { duration: 8 }, db);
      assert.equal(edited.duration, 8);
      assert.equal((await db.creditAccount.findUniqueOrThrow({ where: { userId } })).frozenBalance, 0);
    });

    await t.test("zero-credit media settlement and a concurrent edit serialize without losing the produced media", async () => {
      const source = await fixture(1);
      const shotId = source.workflow.storyboards[0]!.id;
      let release!: () => void, ready!: (pid: number) => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<number>(resolve => { ready = resolve; });
      const generation = runMediaTask({ userId, projectId: source.projectId, projectName: "Fixture", type: "video", scope: "video:zero-credit-edit", provider: "fixture", model: "fixture", title: "Fixture", estimatedCredits: 0 },
        context => context.complete(0, async tx => {
          await tx.asset.update({ where: { id: `video_${shotId}` }, data: { referenceUrl: "/storage/regenerated-fixture.mp4" } });
          const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          ready(row!.pid);
          await gate;
          await tx.project.update({ where: { id: source.projectId }, data: { status: "rendering" } });
          return { delivered: true };
        }), db);
      const blockerPid = await started;
      const before = await editingState(source.projectId);
      const edit = updateStoryboardShot(source.projectId, shotId, userId, { duration: 9 }, db);
      try {
        await awaitAdvisoryWaiters(blockerPid, 1);
        assert.deepEqual(await editingState(source.projectId), before);
      } finally {
        release();
        await Promise.all([generation, edit]);
      }
      assert.equal(await db.asset.findUnique({ where: { id: `video_${shotId}` } }), null);
      assert.equal((await db.asset.findFirstOrThrow({ where: { projectId: source.projectId, id: { startsWith: `video_${shotId}_history_` } } })).referenceUrl, "/storage/regenerated-fixture.mp4");
      assert.equal((await db.storyboard.findUniqueOrThrow({ where: { id: shotId } })).duration, 9);
      assert.equal(await status(source.projectId), "storyboarding");
    });

    await t.test("an edit queued before export persistence cannot be overwritten by the stale export", async () => {
      const source = await fixture();
      const input = await prepareExport(source);
      const [, exported] = await inLockOrder(source.projectId,
        () => updateStoryboardShot(source.projectId, source.workflow.storyboards[0]!.id, userId, { duration: 3 }, db),
        () => persistProjectExportSuccess(input, db));
      assert.equal(exported.status, "succeeded");
      assert.equal(diagnostics(exported).projectCompletion, "source_changed");
      assert.equal(await status(source.projectId), "storyboarding");
    });

    await t.test("an edit queued after export persistence removes completion in its own commit", async () => {
      const source = await fixture();
      const input = await prepareExport(source);
      const [exported] = await inLockOrder(source.projectId,
        () => persistProjectExportSuccess(input, db),
        () => updateStoryboardShot(source.projectId, source.workflow.storyboards[0]!.id, userId, { videoPrompt: "updated motion" }, db));
      assert.equal(diagnostics(exported).projectCompletion, "complete");
      assert.equal(await status(source.projectId), "storyboarding");
      assert.equal(await db.asset.count({ where: { id: `video_${source.workflow.storyboards[0]!.id}` } }), 0);
    });

    await t.test("new source shots during composition prevent a stale complete status", async () => {
      const source = await fixture(1);
      const input = await prepareExport(source);
      const { startState: _start, endState: _end, ...original } = await db.storyboard.findUniqueOrThrow({ where: { id: source.workflow.storyboards[0]!.id } });
      await db.storyboard.create({ data: { ...original, id: `${source.projectId}_new`, shotNo: 2 } });
      const job = await persistProjectExportSuccess(input, db);
      assert.equal(diagnostics(job).projectCompletion, "partial_scope");
      assert.equal(await status(source.projectId), "rendering");
    });

    await t.test("foreign ownership and replay cannot alter an existing export or its project", async () => {
      const source = await fixture(1), another = await fixture(1);
      const input = await prepareExport(source);
      await assert.rejects(updateStoryboardShot(source.projectId, source.workflow.storyboards[0]!.id, `${userId}_foreign`, { duration: 8 }, db), /Project not found/);
      await assert.rejects(persistProjectExportSuccess({ ...input, projectId: another.projectId }, db), /不属于当前项目/);
      await persistProjectExportSuccess(input, db);
      const before = await db.asset.count({ where: { projectId: source.projectId } });
      await assert.rejects(persistProjectExportSuccess(input, db), /接管/);
      assert.equal(await db.asset.count({ where: { projectId: source.projectId } }), before);
      assert.equal(await status(source.projectId), "completed");
    });
  } finally {
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
