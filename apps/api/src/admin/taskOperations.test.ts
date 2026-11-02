import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { listTaskOperations, resolveTaskOperation } from "./taskOperations.js";
import { reserveTaskCredits, settleTaskCredits } from "../billing/taskCredits.js";
import { runMediaTask } from "../billing/mediaTask.js";

const databaseUrl = process.env.AIFILM_TEST_DATABASE_URL;
test("task operations end only idle undelivered work and preserve its audit and financial boundaries", { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const run = crypto.randomUUID(), actorId = `task_admin_${run}`, userId = `task_user_${run}`, projectId = `task_project_${run}`, contentId = `task_content_${run}`;
  const oldTime = () => new Date(Date.now() - 180_000);
  const request = (updatedAt: Date) => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: updatedAt.toISOString(), reason: "已核对供应商记录，确认本次结果未交付，结束任务。" });
  async function task(jobId = `creation-${crypto.randomUUID()}`, credits = 30) {
    const row = await db.generationTask.create({ data: { id: `operation_fixture_${crypto.randomUUID()}`, userId, projectId, type: "text", title: "Task fixture",
      provider: "fixture", model: "fixture", status: "pending", estimatedCredits: credits, jobId,
      requestPayload: { apiKey: "must-not-expose", prompt: "private-story", source: { inputFingerprint: "saved-input-fingerprint" } },
      errorReason: JSON.stringify({ kind: "media_checkpoint", metadata: { remoteTaskId: "known-provider-id", apiKey: "private-checkpoint-key" } }) } });
    await db.$transaction(tx => reserveTaskCredits(tx, { taskId: row.id, userId }));
    return db.generationTask.update({ where: { id: row.id }, data: { updatedAt: oldTime() } });
  }
  try {
    await db.user.create({ data: { id: actorId, name: "Task administrator", role: "admin" } });
    await db.user.create({ data: { id: userId, name: "Task owner", credit: { create: { id: `credit_${run}`, balance: 5000 } } } });
    await db.project.create({ data: { id: projectId, userId, name: "Task operations", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "planning" } });
    await db.contentProject.create({ data: { id: contentId, userId, title: "Content fixture", mode: "original" } });

    await t.test("pagination and response allowlists exclude prompts and private configuration", async () => {
      const one = await task(), two = await task();
      const result = await listTaskOperations({ kind: "generation", page: 1, pageSize: 1, view: "attention", keyword: userId }, db);
      assert.equal(result.items.length, 1); assert.equal(result.total, 2);
      assert.equal(result.items[0].frozenCredits, 30); assert.equal(result.items[0].remoteTaskId, "known-provider-id");
      assert.equal(result.items[0].sourceFingerprint, "saved-input-fingerprint");
      assert.doesNotMatch(JSON.stringify(result), /must-not-expose|private-story|private-checkpoint-key/);
      const second = await listTaskOperations({ kind: "generation", page: 2, pageSize: 1, view: "attention", keyword: userId }, db);
      assert.notEqual(result.items[0].id, second.items[0].id);
      assert.ok([one.id, two.id].includes(second.items[0].id));
    });
    await t.test("role, active heartbeat and changed version all reject without releasing credits", async () => {
      const row = await task(), body = request(row.updatedAt);
      await assert.rejects(resolveTaskOperation(userId, "generation", row.id, body, db), { status: 403 });
      const live = await db.generationTask.update({ where: { id: row.id }, data: { status: "running" } });
      await assert.rejects(resolveTaskOperation(actorId, "generation", row.id, body, db), { status: 409 });
      await assert.rejects(resolveTaskOperation(actorId, "generation", row.id, request(live.updatedAt), db), /心跳/);
      assert.equal(await db.creditTransaction.count({ where: { taskId: row.id, type: "refund" } }), 0);
    });
    await t.test("concurrent replay releases this task once and retains other task reservations", async () => {
      const row = await task(), body = request(row.updatedAt);
      const before = await db.creditAccount.findUniqueOrThrow({ where: { userId } });
      const results = await Promise.all(Array.from({ length: 4 }, () => resolveTaskOperation(actorId, "generation", row.id, body, db)));
      assert.ok(results.every(result => result.releasedCredits === 30));
      const after = await db.creditAccount.findUniqueOrThrow({ where: { userId } });
      assert.equal(before.frozenBalance - after.frozenBalance, 30); assert.equal(before.balance, after.balance);
      assert.equal(await db.creditTransaction.count({ where: { taskId: row.id, type: "refund" } }), 1);
      assert.equal(await db.taskResolution.count({ where: { targetId: row.id } }), 1);
      assert.equal(await db.adminAuditLog.count({ where: { actorId, action: "RESOLVE_TASK", target: `generation:${row.id}` } }), 1);
      await assert.rejects(resolveTaskOperation(actorId, "generation", row.id, { ...body, reason: "变更后的核对说明不得沿用原请求" }, db), /标识已用于/);
    });
    await t.test("content child resolution checks the parent heartbeat and ends unresolved siblings only", async () => {
      const parent = await task(`content:${contentId}:operation:parent-placeholder`, 0);
      await db.generationTask.update({ where: { id: parent.id }, data: { jobId: `content:${contentId}:operation:${parent.id}`, status: "running" } });
      const child = await task(`content:${contentId}:billing:${parent.id}:one`), sibling = await task(`content:${contentId}:billing:${parent.id}:two`);
      const completed = await task(`content:${contentId}:billing:${parent.id}:completed`);
      await db.$transaction(async tx => {
        await settleTaskCredits(tx, { taskId: completed.id, userId });
        await tx.generationTask.update({ where: { id: completed.id }, data: { status: "succeeded" } });
      });
      await assert.rejects(resolveTaskOperation(actorId, "generation", child.id, request(child.updatedAt), db), /心跳/);
      await db.generationTask.update({ where: { id: parent.id }, data: { updatedAt: oldTime() } });
      const result = await resolveTaskOperation(actorId, "generation", child.id, request(child.updatedAt), db);
      assert.equal(result.releasedCredits, 60);
      assert.deepEqual(new Set(result.affectedTaskIds), new Set([parent.id, child.id, sibling.id]));
      assert.equal((await db.generationTask.findUniqueOrThrow({ where: { id: completed.id } })).status, "succeeded");
    });
    await t.test("a late media response is fenced after administrator resolution", async () => {
      const mediaProjectId = `media_ops_${run}`;
      await db.project.create({ data: { id: mediaProjectId, userId, name: "Media operations", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "planning" } });
      let started!: () => void, finish!: () => void;
      const began = new Promise<void>(resolve => { started = resolve; }), end = new Promise<void>(resolve => { finish = resolve; });
      let taskId = "", saved = false;
      const running = runMediaTask({ userId, projectId: mediaProjectId, projectName: "Fixture", type: "image", scope: `ops-${run}`, provider: "fixture", model: "fixture", estimatedCredits: 30, title: "Media fixture" },
        async context => { taskId = context.taskId; started(); await end; return context.complete(30, async () => { saved = true; return {}; }); }, db);
      const rejection = running.catch(error => { throw error; });
      void rejection.catch(() => undefined);
      await Promise.race([began, rejection]);
      const row = await db.generationTask.update({ where: { id: taskId }, data: { updatedAt: oldTime() } });
      await resolveTaskOperation(actorId, "generation", taskId, request(row.updatedAt), db);
      const rejected = assert.rejects(rejection, /状态已变化/); finish(); await rejected;
      assert.equal(saved, false); assert.equal((await db.generationTask.findUniqueOrThrow({ where: { id: taskId } })).status, "canceled");
    });
    await t.test("finished exports cannot promote late results or be processed twice", async () => {
      const id = `export_operation_${run}`;
      const row = await db.exportJob.create({ data: { id, userId, projectId, type: "subtitle", status: "running", updatedAt: oldTime() } });
      const body = request(row.updatedAt);
      assert.equal((await resolveTaskOperation(actorId, "export", id, body, db)).releasedCredits, 0);
      const { getProjectWorkflow, persistProjectExportSuccess } = await import("../db/repository.js");
      const workflow = await getProjectWorkflow(projectId, userId, db);
      await assert.rejects(persistProjectExportSuccess({ projectId, userId, jobId: id, type: "subtitle", workflow: workflow!,
        exportResult: { outputKind: "subtitle", outputUrl: "/storage/test.srt", ffmpegReady: false, clipCount: 0 } }, db), /接管/);
      assert.equal((await resolveTaskOperation(actorId, "export", id, body, db)).targetId, id);
      assert.equal((await db.exportJob.findUniqueOrThrow({ where: { id } })).status, "failed");
    });
  } finally {
    await db.taskResolution.deleteMany({ where: { actorId } });
    await db.adminAuditLog.deleteMany({ where: { actorId } });
    await db.contentProject.deleteMany({ where: { id: contentId } });
    await db.user.deleteMany({ where: { id: { in: [actorId, userId] } } });
    await db.$disconnect();
  }
});
