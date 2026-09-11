import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { lockTaskCredits, releaseTaskCredits, reserveTaskCredits, settleTaskCredits } from "./taskCredits.js";

// Explicit opt-in: this suite may write only to a dedicated, local test database.
const testDatabaseUrl = process.env.AIFILM_TEST_DATABASE_URL;

test("PostgreSQL task billing: concurrent reserve, retries, cancellation and settlement", { skip: !testDatabaseUrl }, async (t) => {
  const url = new URL(testDatabaseUrl!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const db = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  const users: string[] = [];
  const { processCreationJob, isFinalCreationAttempt, CreationLeaseBusyError } = await import("../queue/creationProcessor.js");

  async function fixture(balance = 100, estimates = [30]) {
    const userId = `audit_credit_${crypto.randomUUID()}`;
    users.push(userId);
    await db.user.create({ data: { id: userId, name: "Isolated billing test", credit: { create: { id: `account_${crypto.randomUUID()}`, balance } } } });
    const project = await db.project.create({ data: {
      id: `audit_project_${crypto.randomUUID()}`, userId, name: "Billing test", type: "test", sourceType: "idea", artStyle: "test", videoRatio: "9:16", status: "planning"
    } });
    const tasks = [];
    for (const estimate of estimates) tasks.push(await db.generationTask.create({ data: {
      id: `audit_task_${crypto.randomUUID()}`, userId, projectId: project.id, type: "text", title: "Billing regression", provider: "test", model: "test", status: "pending", estimatedCredits: estimate
    } }));
    return { userId, projectId: project.id, tasks, account: () => db.creditAccount.findUniqueOrThrow({ where: { userId } }) };
  }
  const reservation = (userId: string, taskId: string) => db.$transaction((tx) => reserveTaskCredits(tx, { userId, taskId }));
  const release = (userId: string, taskId: string) => db.$transaction((tx) => releaseTaskCredits(tx, { userId, taskId }));
  async function cancel(userId: string, taskId: string) {
    return db.$transaction(async (tx) => {
      const { task } = await lockTaskCredits(tx, taskId, userId);
      if (["succeeded", "canceled"].includes(task.status)) return;
      await releaseTaskCredits(tx, { taskId, userId });
      await tx.generationTask.update({ where: { id: taskId }, data: { status: "canceled" } });
    });
  }
  function job(f: Awaited<ReturnType<typeof fixture>>, attempt = 0) {
    return { id: "audit-job", attemptsMade: attempt, opts: { attempts: 3 }, data: {
      taskId: f.tasks[0]!.id, userId: f.userId, projectId: f.projectId, estimatedCredits: 30,
      input: { title: "Test", content: "test", sourceType: "idea" as const, mode: "director" as const, genre: "test", videoRatio: "9:16" as const, artStyle: "test" }
    } };
  }
  function output(projectId: string) {
    return {
      mode: "real" as const,
      script: { id: `script_${crypto.randomUUID()}`, projectId, name: "Generated test", content: "Generated content", synopsis: "Synopsis", version: 1, createdAt: new Date().toISOString() },
      characters: [], assets: []
    };
  }

  try {
    await t.test("concurrent requests cannot reserve beyond the account balance", async () => {
      const f = await fixture(100, Array(12).fill(30));
      const results = await Promise.allSettled(f.tasks.map((task) => reservation(f.userId, task.id)));
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
      assert.equal((await f.account()).frozenBalance, 90);
      assert.equal((await f.account()).balance, 100);
    });
    await t.test("repeated reserve and refund affect only their own task once", async () => {
      const f = await fixture(100, [30, 30]);
      const results = await Promise.all(Array.from({ length: 12 }, () => reservation(f.userId, f.tasks[0]!.id)));
      assert.equal(results.filter((result) => result.applied).length, 1);
      await reservation(f.userId, f.tasks[1]!.id);
      await Promise.all(Array.from({ length: 12 }, () => release(f.userId, f.tasks[0]!.id)));
      await db.generationTask.update({ where: { id: f.tasks[0]!.id }, data: { status: "failed" } });
      await cancel(f.userId, f.tasks[0]!.id);
      assert.equal((await f.account()).frozenBalance, 30);
      assert.equal(await db.creditTransaction.count({ where: { taskId: f.tasks[0]!.id, type: "refund" } }), 1);
    });
    await t.test("automatic retries retain the freeze and release once after the last failure", async () => {
      const f = await fixture();
      await reservation(f.userId, f.tasks[0]!.id);
      const generate = async () => { throw new Error("Simulated provider timeout"); };
      for (let attempt = 0; attempt < 3; attempt++) {
        await assert.rejects(processCreationJob(job(f, attempt), { db, generate }), /Simulated provider timeout/);
        assert.equal((await f.account()).frozenBalance, attempt < 2 ? 30 : 0);
      }
      assert.equal((await f.account()).balance, 100);
      assert.equal(await db.creditTransaction.count({ where: { taskId: f.tasks[0]!.id, type: "refund" } }), 1);
      assert.equal(isFinalCreationAttempt({ opts: {}, attemptsMade: 0 }), true);
    });
    await t.test("success after retries and duplicate delivery debit only once", async () => {
      const f = await fixture();
      await reservation(f.userId, f.tasks[0]!.id);
      let calls = 0;
      const generate = async () => { calls++; if (calls < 3) throw new Error("Retry"); return output(f.projectId); };
      for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(processCreationJob(job(f, attempt), { db, generate }), /Retry/);
      await processCreationJob(job(f, 2), { db, generate });
      await processCreationJob(job(f, 2), { db, generate });
      assert.equal(calls, 3);
      assert.equal((await f.account()).balance, 70);
      assert.equal((await f.account()).frozenBalance, 0);
      assert.equal(await db.scriptDraft.count({ where: { projectId: f.projectId } }), 1);
      assert.equal(await db.creditTransaction.count({ where: { taskId: f.tasks[0]!.id, type: "consume" } }), 1);
    });
    await t.test("cancellation during provider execution wins without saving or charging output", async () => {
      const f = await fixture();
      await reservation(f.userId, f.tasks[0]!.id);
      let started!: () => void;
      let finish!: () => void;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      const finishPromise = new Promise<void>((resolve) => { finish = resolve; });
      const running = processCreationJob(job(f), { db, generate: async () => { started(); await finishPromise; return output(f.projectId); } });
      await startedPromise;
      await cancel(f.userId, f.tasks[0]!.id);
      finish();
      await running;
      assert.equal((await f.account()).balance, 100);
      assert.equal((await f.account()).frozenBalance, 0);
      assert.equal(await db.scriptDraft.count({ where: { projectId: f.projectId } }), 0);
      assert.equal(await db.creditTransaction.count({ where: { taskId: f.tasks[0]!.id, type: "consume" } }), 0);
    });
    await t.test("an active duplicate delivery never calls the model or releases the live reservation", async () => {
      const f = await fixture(); let started!: () => void; let finish!: () => void; let calls = 0;
      const began = new Promise<void>(resolve => { started = resolve; }); const end = new Promise<void>(resolve => { finish = resolve; });
      const generate = async () => { calls++; started(); await end; return output(f.projectId); };
      const running = processCreationJob(job(f), { db, generate }); await began;
      try {
        await assert.rejects(processCreationJob(job(f, 2), { db, generate }), CreationLeaseBusyError);
        assert.equal(calls, 1); assert.equal((await f.account()).frozenBalance, 30);
        assert.equal((await db.generationTask.findUniqueOrThrow({ where: { id: f.tasks[0]!.id } })).status, "running");
        assert.equal(await db.creditTransaction.count({ where: { taskId: f.tasks[0]!.id, type: "refund" } }), 0);
      } finally { finish(); }
      await running; assert.equal((await f.account()).balance, 70);
    });
    await t.test("an expired worker cannot save output or refund the new execution lease", async () => {
      for (const oldFails of [false, true]) {
        const f = await fixture(); let startedOld!: () => void; let finishOld!: () => void; let startedNew!: () => void; let finishNew!: () => void;
        const oldBegan = new Promise<void>(resolve => { startedOld = resolve; }); const oldEnd = new Promise<void>(resolve => { finishOld = resolve; });
        const newBegan = new Promise<void>(resolve => { startedNew = resolve; }); const newEnd = new Promise<void>(resolve => { finishNew = resolve; });
        const old = processCreationJob(job(f, 2), { db, generate: async () => { startedOld(); await oldEnd; if (oldFails) throw new Error("Old provider failed"); return output(f.projectId); } });
        await oldBegan;
        const oldLease = (await db.generationTask.findUniqueOrThrow({ where: { id: f.tasks[0]!.id } })).errorReason;
        await db.generationTask.update({ where: { id: f.tasks[0]!.id }, data: { updatedAt: new Date(Date.now() - 180_000) } });
        const current = processCreationJob(job(f), { db, generate: async () => { startedNew(); await newEnd; return output(f.projectId); } });
        await newBegan;
        const newLease = (await db.generationTask.findUniqueOrThrow({ where: { id: f.tasks[0]!.id } })).errorReason;
        assert.notEqual(newLease, oldLease);
        const rejected = assert.rejects(old, oldFails ? /Old provider failed/ : CreationLeaseBusyError); finishOld(); await rejected;
        assert.equal((await f.account()).frozenBalance, 30); assert.equal((await f.account()).balance, 100);
        assert.equal((await db.generationTask.findUniqueOrThrow({ where: { id: f.tasks[0]!.id } })).errorReason, newLease);
        assert.equal(await db.scriptDraft.count({ where: { projectId: f.projectId } }), 0);
        finishNew(); await current;
        assert.equal((await f.account()).balance, 70); assert.equal((await f.account()).frozenBalance, 0);
        assert.equal(await db.scriptDraft.count({ where: { projectId: f.projectId } }), 1);
      }
    });
    await t.test("simultaneous settle and cancel have exactly one financial outcome", async () => {
      for (let round = 0; round < 6; round++) {
        const f = await fixture();
        const taskId = f.tasks[0]!.id;
        await reservation(f.userId, taskId);
        await Promise.all([
          db.$transaction(async (tx) => {
            const result = await settleTaskCredits(tx, { taskId, userId: f.userId });
            if (result.applied) await tx.generationTask.update({ where: { id: taskId }, data: { status: "succeeded" } });
          }),
          cancel(f.userId, taskId)
        ]);
        const task = await db.generationTask.findUniqueOrThrow({ where: { id: taskId } });
        const account = await f.account();
        assert.equal(account.frozenBalance, 0);
        assert.equal(account.balance, task.status === "succeeded" ? 70 : 100);
        assert.equal(account.totalConsume, task.status === "succeeded" ? 30 : 0);
      }
    });
    await t.test("settlement rolls back if output persistence fails", async () => {
      const f = await fixture();
      await reservation(f.userId, f.tasks[0]!.id);
      await assert.rejects(db.$transaction(async (tx) => {
        await settleTaskCredits(tx, { taskId: f.tasks[0]!.id, userId: f.userId });
        throw new Error("Output write failed");
      }), /Output write failed/);
      assert.equal((await f.account()).balance, 100);
      assert.equal((await f.account()).frozenBalance, 30);
      assert.equal((await db.generationTask.findUniqueOrThrow({ where: { id: f.tasks[0]!.id } })).finalCredits, null);
      assert.equal(await db.creditTransaction.count({ where: { taskId: f.tasks[0]!.id, type: "consume" } }), 0);
    });
    await t.test("partial settlement releases surplus and cannot charge a second time", async () => {
      const f = await fixture();
      const input = { userId: f.userId, taskId: f.tasks[0]!.id };
      await reservation(input.userId, input.taskId);
      await db.$transaction((tx) => settleTaskCredits(tx, { ...input, finalCredits: 20 }));
      const second = await db.$transaction((tx) => settleTaskCredits(tx, { ...input, finalCredits: 20 }));
      assert.equal(second.applied, false);
      await release(input.userId, input.taskId);
      assert.equal((await f.account()).balance, 80);
      assert.equal((await f.account()).frozenBalance, 0);
    });
    await t.test("manual retry reserves again after a released final failure", async () => {
      const f = await fixture();
      const taskId = f.tasks[0]!.id;
      await reservation(f.userId, taskId);
      await release(f.userId, taskId);
      await db.generationTask.update({ where: { id: taskId }, data: { status: "failed" } });
      await db.$transaction(async (tx) => {
        await lockTaskCredits(tx, taskId, f.userId);
        await reserveTaskCredits(tx, { taskId, userId: f.userId });
        await tx.generationTask.update({ where: { id: taskId }, data: { status: "pending" } });
      });
      await processCreationJob(job(f), { db, generate: async () => output(f.projectId) });
      assert.equal((await f.account()).balance, 70);
      assert.equal((await f.account()).frozenBalance, 0);
    });
    await t.test("an obsolete job cannot run after a newer retry owns the task", async () => {
      const f = await fixture();
      await reservation(f.userId, f.tasks[0]!.id);
      await db.generationTask.update({ where: { id: f.tasks[0]!.id }, data: { jobId: "newer-job" } });
      await processCreationJob(job(f), { db, generate: async () => { throw new Error("Must not call provider"); } });
      assert.equal((await f.account()).frozenBalance, 30);
      assert.equal((await f.account()).balance, 100);
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
