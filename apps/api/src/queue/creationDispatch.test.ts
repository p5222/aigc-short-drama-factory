import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

const databaseUrl = process.env.AIFILM_TEST_DATABASE_URL;
const redisUrl = process.env.AIFILM_TEST_REDIS_URL;
test("durable creation dispatch restores a lost Redis job once without changing billing", { skip: !databaseUrl || !redisUrl }, async t => {
  const dbUrl = new URL(databaseUrl!); const redis = new URL(redisUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(dbUrl.hostname));
  assert.match(dbUrl.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  assert.ok(["localhost", "127.0.0.1"].includes(redis.hostname));
  assert.ok(Number(redis.pathname.slice(1)) >= 10);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  const { prisma: db } = await import("../db/client.js");
  const queue = await import("./generationQueue.js");
  const { enqueueCreationTask, recoverCreationDispatches } = await import("./creationDispatch.js");
  const run = crypto.randomUUID();
  const userId = `dispatch_user_${run}`;
  const taskId = `dispatch_task_${run}`;
  const jobId = `creation-${run}`;
  const extraJobs: string[] = [];
  try {
    await queue.generationQueue.waitUntilReady();
    await db.user.create({ data: { id: userId, name: "Dispatch review", credit: { create: { id: `credit_${run}`, balance: 100, frozenBalance: 20 } } } });
    const project = await db.project.create({ data: { id: `dispatch_project_${run}`, userId, name: "Dispatch review", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "planning" } });
    await db.generationTask.create({ data: { id: taskId, userId, projectId: project.id, type: "text", title: "Dispatch test", provider: "test", model: "test", estimatedCredits: 20, status: "pending", jobId, requestPayload: { content: "persisted input", sourceType: "script", mode: "nine_grid" } } });
    await t.test("committed input is recovered even when the original enqueue never ran", async () => {
      await Promise.all([recoverCreationDispatches(), recoverCreationDispatches()]);
      const job = await queue.generationQueue.getJob(jobId);
      assert.ok(job);
      assert.equal(job.data.input.content, "persisted input");
      assert.equal(job.data.taskId, taskId);
    });
    await t.test("duplicate dispatch reuses the deterministic job and keeps the reservation", async () => {
      await Promise.all(Array.from({ length: 8 }, () => enqueueCreationTask(taskId)));
      assert.equal((await queue.generationQueue.getJobs(["waiting"])).filter(job => job.id === jobId).length, 1);
      const account = await db.creditAccount.findUniqueOrThrow({ where: { userId } });
      assert.equal(account.balance, 100); assert.equal(account.frozenBalance, 20);
      assert.equal(await db.creditTransaction.count({ where: { userId } }), 0);
    });
    await t.test("lost Redis job is restored, but canceled work is never restored", async () => {
      await (await queue.generationQueue.getJob(jobId))!.remove();
      await recoverCreationDispatches();
      assert.ok(await queue.generationQueue.getJob(jobId));
      await (await queue.generationQueue.getJob(jobId))!.remove();
      await db.generationTask.update({ where: { id: taskId }, data: { status: "canceled" } });
      await recoverCreationDispatches();
      assert.equal(await queue.generationQueue.getJob(jobId), undefined);
    });
    await t.test("later tasks are recovered behind a full page of existing queued tasks", async () => {
      const original = await db.generationTask.findUniqueOrThrow({ where: { id: taskId } });
      const createdAt = new Date();
      const rows = Array.from({ length: 101 }, (_, index) => {
        const suffix = String(index).padStart(3, "0");
        const id = `dispatch_page_${run}_${suffix}`;
        const nextJob = `creation-${run}-${suffix}`;
        extraJobs.push(nextJob);
        return { id, userId, projectId: original.projectId, type: "text", title: "Page test", provider: "test", model: "test", estimatedCredits: 0, status: "pending", jobId: nextJob, createdAt, requestPayload: { content: suffix } };
      });
      await db.generationTask.createMany({ data: rows });
      await recoverCreationDispatches();
      await recoverCreationDispatches();
      assert.ok(await queue.generationQueue.getJob(extraJobs[100]!));
      assert.equal((await db.creditAccount.findUniqueOrThrow({ where: { userId } })).frozenBalance, 20);
    });

  } finally {
    for (const id of extraJobs) await (await queue.generationQueue.getJob(id))?.remove();
    await (await queue.generationQueue.getJob(jobId))?.remove();
    await queue.generationQueue.close();
    await queue.generationQueueEvents.close();
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
