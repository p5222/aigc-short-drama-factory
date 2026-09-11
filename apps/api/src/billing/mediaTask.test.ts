import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.AIFILM_TEST_DATABASE_URL;
test("PostgreSQL media tasks preserve billing and remote generation state", { skip: !databaseUrl }, async (t) => {
  const url = new URL(databaseUrl!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const { runMediaTask, mediaCheckpoint } = await import("./mediaTask.js");
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const users: string[] = [];
  async function fixture(resume = false) {
    const userId = `audit_media_${crypto.randomUUID()}`;
    users.push(userId);
    await db.user.create({ data: { id: userId, name: "Media test", credit: { create: { id: `account_${crypto.randomUUID()}`, balance: 100 } } } });
    const projectId = `project_${crypto.randomUUID()}`;
    await db.project.create({ data: { id: projectId, userId, name: "Media test", type: "test", sourceType: "idea", artStyle: "test", videoRatio: "9:16", status: "planning" } });
    return { input: { userId, projectId, projectName: "Media test", type: resume ? "video" : "image", scope: resume ? "video:shot-one" : "image", provider: "test", model: "test", estimatedCredits: 30, title: "Test generation", resume },
      account: () => db.creditAccount.findUniqueOrThrow({ where: { userId } }),
      tasks: () => db.generationTask.findMany({ where: { userId } }) };
  }
  try {
    await t.test("a durable task and reservation exist before the external call", async () => {
      const f = await fixture();
      const result = await runMediaTask(f.input, async (context) => {
        assert.equal((await f.account()).frozenBalance, 30);
        assert.equal((await f.tasks())[0]!.status, "running");
        return context.complete(30, async (tx) => {
          await tx.asset.create({ data: { id: `asset_${crypto.randomUUID()}`, projectId: f.input.projectId, type: "image", name: "Output", description: "Generated", prompt: "test", status: "succeeded" } });
          return { delivered: true };
        });
      }, db);
      assert.equal(result.delivered, true);
      assert.equal((await f.account()).balance, 70);
      assert.equal((await f.account()).frozenBalance, 0);
    });
    await t.test("model failure leaves a failed task and refunds its reservation", async () => {
      const f = await fixture();
      await assert.rejects(runMediaTask(f.input, async () => { throw new Error("Model failed"); }, db), /Model failed/);
      assert.equal((await f.tasks())[0]!.status, "failed");
      assert.equal((await f.account()).balance, 100);
      assert.equal((await f.account()).frozenBalance, 0);
    });
    await t.test("partial batch delivery charges only successful images", async () => {
      const f = await fixture();
      const completed = await runMediaTask(f.input, (context) => context.complete(20, async () => ({ delivered: 2 }), { status: "failed", errorReason: "One of three images failed" }), db);
      assert.equal(completed.delivered, 2);
      assert.equal(completed.task.finalCredits, 20);
      assert.equal((await f.account()).balance, 80);
      assert.equal((await f.account()).frozenBalance, 0);
    });
    await t.test("duplicate generation is rejected before a second provider request", async () => {
      const f = await fixture();
      let started!: () => void; let finish!: () => void; let calls = 0;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      const finishPromise = new Promise<void>((resolve) => { finish = resolve; });
      const first = runMediaTask(f.input, async (context) => { calls++; started(); await finishPromise; return context.complete(30, async () => ({})); }, db);
      await startedPromise;
      await assert.rejects(runMediaTask(f.input, async (context) => { calls++; return context.complete(30, async () => ({})); }, db), /正在生成/);
      finish(); await first;
      assert.equal(calls, 1);
      assert.equal((await f.account()).balance, 70);
    });
    await t.test("pending remote video resumes the same task and frozen balance", async () => {
      const f = await fixture(true);
      let submissions = 0;
      const pending = await runMediaTask(f.input, async (context) => {
        submissions++;
        await context.checkpoint({ submissionStarted: true, remoteTaskId: "upstream-job-one" });
        return context.defer({ remoteTaskId: "upstream-job-one" });
      }, db);
      assert.equal(pending.status, "pending");
      assert.equal((await f.account()).frozenBalance, 30);
      const done = await runMediaTask(f.input, async (context) => {
        assert.equal(context.taskId, pending.id);
        assert.equal(mediaCheckpoint(context.task).remoteTaskId, "upstream-job-one");
        return context.complete(30, async () => ({ delivered: true }));
      }, db);
      assert.equal(submissions, 1);
      assert.equal(done.task.id, pending.id);
      assert.equal((await f.tasks()).length, 1);
      assert.equal((await f.account()).balance, 70);
      assert.equal((await f.account()).frozenBalance, 0);
    });
    await t.test("an uncertain submission is retained for reconciliation instead of submitted twice", async () => {
      const f = await fixture(true);
      let submissions = 0;
      await assert.rejects(runMediaTask(f.input, async (context) => {
        await context.checkpoint({ submissionStarted: true });
        submissions++;
        throw new Error("Connection lost after submitting");
      }, db), /Connection lost/);
      assert.equal((await f.tasks())[0]!.status, "pending");
      await assert.rejects(runMediaTask(f.input, async (context) => { submissions++; return context.complete(30, async () => ({})); }, db), /尚未确认/);
      assert.equal(submissions, 1);
      assert.equal((await f.account()).frozenBalance, 30);
    });
    await t.test("an expired request cannot save over a new recovery lease", async () => {
      const f = await fixture(true);
      let started!: () => void; let finish!: () => void;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      const finishPromise = new Promise<void>((resolve) => { finish = resolve; });
      const original = runMediaTask(f.input, async (context) => {
        await context.checkpoint({ remoteTaskId: "lease-upstream" }); started(); await finishPromise;
        return context.complete(30, async () => ({ stale: true }));
      }, db);
      await startedPromise;
      await db.generationTask.update({ where: { id: (await f.tasks())[0]!.id }, data: { updatedAt: new Date(Date.now() - 180_000) } });
      const recovered = await runMediaTask(f.input, (context) => context.complete(30, async () => ({ recovered: true })), db);
      finish();
      await assert.rejects(original, /状态已变化/);
      assert.equal(recovered.recovered, true);
      assert.equal((await f.account()).balance, 70);
      assert.equal((await f.account()).frozenBalance, 0);
    });
    await t.test("persistence rollback preserves the remote result for retry without another generation", async () => {
      const f = await fixture(true);
      await assert.rejects(runMediaTask(f.input, async (context) => {
        await context.checkpoint({ remoteTaskId: "ready-job", remoteVideoUrl: "https://test.invalid/result.mp4" });
        return context.complete(30, async () => { throw new Error("Database output write failed"); });
      }, db), /Database output write failed/);
      assert.equal((await f.account()).balance, 100);
      assert.equal((await f.account()).frozenBalance, 30);
      await runMediaTask(f.input, async (context) => {
        assert.equal(mediaCheckpoint(context.task).remoteVideoUrl, "https://test.invalid/result.mp4");
        return context.complete(30, async () => ({}));
      }, db);
      assert.equal((await f.account()).balance, 70);
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
