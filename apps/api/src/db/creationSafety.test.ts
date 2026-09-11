import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import type { CreateProjectInput } from "@aifilm/shared";
import { releaseTaskCredits, settleTaskCredits } from "../billing/taskCredits.js";

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;
test("creation request replay and project deletion preserve tasks and ledger", { skip: !databaseUrl, timeout: 60_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const { createProjectAndTask, deleteProject, retryTask } = await import("./repository.js");
  const run = crypto.randomUUID();
  const providerId = `creation_provider_${run}`;
  const priceId = `creation_price_${run}`;
  const users: string[] = [];
  const input = (requestId = crypto.randomUUID()): CreateProjectInput => ({ requestId, title: "Replay fixture", sourceType: "script", content: "第1集 雨后\n场景1 书店\n小林：雨停了。", mode: "director", targetEpisodes: 1,
    genre: "test", videoRatio: "9:16", artStyle: "test", textProvider: providerId, textModel: "fixture-text" });
  async function user(balance = 1000) {
    const id = `creation_user_${crypto.randomUUID()}`; users.push(id);
    await db.user.create({ data: { id, name: "Creation safety", credit: { create: { id: `credit_${id}`, balance } } } });
    return id;
  }
  const create = (value: CreateProjectInput, userId: string, cap = 37) => createProjectAndTask(value, userId, cap, db);
  const snapshot = async (userId: string) => ({
    projects: await db.project.count({ where: { userId } }), tasks: await db.generationTask.count({ where: { userId } }),
    requests: await db.creationRequest.count({ where: { userId } }), ledger: await db.creditTransaction.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    account: await db.creditAccount.findUniqueOrThrow({ where: { userId } })
  });
  try {
    await db.modelProvider.create({ data: { id: providerId, name: "Creation fixture", modality: "text", models: ["fixture-text"], costHint: "isolated", enabled: true, capability: {} } });
    await db.modelPrice.create({ data: { id: priceId, providerId, providerName: "Creation fixture", model: "fixture-text", modality: "text", unit: "text_episode", unitCredits: 37 } });

    await t.test("concurrent identical requests and reordered JSON create and freeze once", async () => {
      const userId = await user(), value = input();
      const reordered = Object.fromEntries(Object.entries(value).reverse()) as unknown as CreateProjectInput;
      const results = await Promise.all(Array.from({ length: 8 }, (_, index) => create(index % 2 ? reordered : value, userId)));
      assert.equal(new Set(results.map(row => row.projectId)).size, 1);
      assert.equal(new Set(results.map(row => row.taskId)).size, 1);
      assert.equal(results.filter(row => !row.replayed).length, 1);
      const state = await snapshot(userId);
      assert.equal(state.projects, 1); assert.equal(state.tasks, 1); assert.equal(state.requests, 1);
      assert.equal(state.ledger.length, 1); assert.equal(state.ledger[0]!.type, "freeze"); assert.equal(state.account.frozenBalance, 37);
      const reconnect = new PrismaClient({ datasourceUrl: databaseUrl });
      try { assert.equal((await createProjectAndTask(value, userId, 37, reconnect)).taskId, results[0]!.taskId); }
      finally { await reconnect.$disconnect(); }
      assert.deepEqual(await snapshot(userId), state);
    });

    await t.test("original result survives pricing or provider changes and changed input is a conflict", async () => {
      const userId = await user(), value = input();
      const original = await create(value, userId);
      const before = await snapshot(userId);
      await db.modelProvider.update({ where: { id: providerId }, data: { enabled: false } });
      await db.modelPrice.update({ where: { id: priceId }, data: { unitCredits: 999 } });
      try {
        const replay = await create({ ...value, maxCredits: 0 }, userId, 0);
        assert.equal(replay.replayed, true); assert.equal(replay.taskId, original.taskId); assert.deepEqual(replay.estimate, original.estimate);
        await assert.rejects(create({ ...value, content: value.content + "新剧情" }, userId), { status: 409 });
        assert.deepEqual(await snapshot(userId), before);
      } finally {
        await db.modelProvider.update({ where: { id: providerId }, data: { enabled: true } });
        await db.modelPrice.update({ where: { id: priceId }, data: { unitCredits: 37 } });
      }
    });

    await t.test("the same request key belongs independently to each user", async () => {
      const first = await user(), second = await user(), value = input();
      const a = await create(value, first), b = await create(value, second);
      assert.notEqual(a.projectId, b.projectId); assert.notEqual(a.taskId, b.taskId);
      assert.equal((await snapshot(first)).account.frozenBalance, 37); assert.equal((await snapshot(second)).account.frozenBalance, 37);
    });

    await t.test("missing key, rejected quote and insufficient balance leave no partial creation", async () => {
      const userId = await user(0), value = input(), before = await snapshot(userId);
      await assert.rejects(create({ ...value, requestId: undefined }, userId), { status: 400 });
      await assert.rejects(create(value, userId, 0), /重新获取报价/);
      await assert.rejects(create(value, userId), /积分余额不足/);
      assert.deepEqual(await snapshot(userId), before);
      await db.creditAccount.update({ where: { userId }, data: { balance: 100 } });
      assert.equal((await create(value, userId)).replayed, false, "a rolled-back key may be retried after the user fixes the cause");
    });

    await t.test("active generation, exports and unsettled reservations prevent deletion", async () => {
      const userId = await user(), other = await user(), value = input(), created = await create(value, userId);
      const before = await snapshot(userId);
      await assert.rejects(deleteProject(created.projectId, other, db), { status: 404 });
      await assert.rejects(deleteProject(created.projectId, userId, db), { status: 409 });
      assert.deepEqual(await snapshot(userId), before);
      await db.generationTask.update({ where: { id: created.taskId }, data: { status: "failed" } });
      await assert.rejects(deleteProject(created.projectId, userId, db), /未结算/);
      await db.$transaction(tx => releaseTaskCredits(tx, { taskId: created.taskId, userId }));
      const exportId = `export_${run}`;
      await db.exportJob.create({ data: { id: exportId, projectId: created.projectId, userId, type: "subtitle", status: "running" } });
      await assert.rejects(deleteProject(created.projectId, userId, db), { status: 409 });
      await db.exportJob.update({ where: { id: exportId }, data: { status: "failed" } });
      assert.equal((await deleteProject(created.projectId, userId, db)).deleted, true);
      assert.ok(await db.generationTask.findUnique({ where: { id: created.taskId } }));
      await assert.rejects(retryTask(created.taskId, userId, value, db), /对应创作步骤|原项目已删除/);
    });

    await t.test("deleting a completed project preserves billed history and cannot revive its creation key", async () => {
      const userId = await user(), value = input(), created = await create(value, userId);
      await db.$transaction(async tx => {
        await settleTaskCredits(tx, { taskId: created.taskId, userId });
        await tx.generationTask.update({ where: { id: created.taskId }, data: { status: "succeeded" } });
      });
      const before = await snapshot(userId);
      await deleteProject(created.projectId, userId, db);
      const after = await snapshot(userId);
      assert.equal(after.projects, 0); assert.equal(after.tasks, before.tasks); assert.equal(after.requests, before.requests);
      assert.deepEqual(after.account, before.account);
      assert.deepEqual(after.ledger.map(row => ({ ...row, projectId: created.projectId })), before.ledger);
      assert.equal((await db.generationTask.findUniqueOrThrow({ where: { id: created.taskId } })).projectId, null);
      await assert.rejects(create(value, userId), { status: 409 });
      assert.deepEqual(await snapshot(userId), after);
    });
    await t.test("a concurrent retry or deletion wins without orphaning a new reservation", async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const userId = await user(), value = input(), created = await create(value, userId);
        await db.$transaction(async tx => {
          await releaseTaskCredits(tx, { taskId: created.taskId, userId });
          await tx.generationTask.update({ where: { id: created.taskId }, data: { status: "failed" } });
        });
        await Promise.allSettled([deleteProject(created.projectId, userId, db), retryTask(created.taskId, userId, value, db)]);
        const project = await db.project.findUnique({ where: { id: created.projectId } });
        const task = await db.generationTask.findUniqueOrThrow({ where: { id: created.taskId } });
        const account = await db.creditAccount.findUniqueOrThrow({ where: { userId } });
        if (project) { assert.equal(task.status, "pending"); assert.equal(account.frozenBalance, 37); }
        else { assert.equal(task.projectId, null); assert.equal(task.status, "failed"); assert.equal(account.frozenBalance, 0); }
      }
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.modelPrice.deleteMany({ where: { id: priceId } });
    await db.modelProvider.deleteMany({ where: { id: providerId } });
    await db.$disconnect();
  }
});
