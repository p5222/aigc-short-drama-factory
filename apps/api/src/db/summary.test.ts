import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.AIFILM_TEST_COMMERCE_DATABASE_URL;
test("PostgreSQL summaries use complete records and distinguish receipts from profit", { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); assert.match(url.pathname, /^\/audit_commerce_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false"; process.env.DATABASE_URL = databaseUrl;
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const { getWorkbenchSummary, getAdminSummary } = await import("./repository.js");
  const users: string[] = [];
  async function user() {
    const id = `summary_user_${crypto.randomUUID()}`; users.push(id);
    await db.user.create({ data: { id, name: "Summary test", credit: { create: { id: `credit_${id}`, balance: 100, totalConsume: 180 } } } });
    return id;
  }
  async function project(userId: string, index: number) {
    return db.project.create({ data: { id: `summary_project_${crypto.randomUUID()}`, userId, name: `Summary project ${index}`, type: "test", sourceType: "idea", artStyle: "test", videoRatio: "9:16", status: "planning", storyboards: 999 } });
  }
  try {
    await t.test("workbench totals include older projects, actual storyboards and tasks outside recent cards", async () => {
      const userId = await user(); const outsider = await user(); await project(outsider, 100);
      const projects = await Promise.all(Array.from({ length: 9 }, (_, index) => project(userId, index)));
      for (const current of projects) await db.storyboard.create({ data: {
        id: `summary_shot_${crypto.randomUUID()}`, projectId: current.id, episodeNo: 1, sceneNo: 1, shotNo: 1, duration: 5,
        shotSize: "wide", cameraAngle: "level", cameraMovement: "static", characters: [], scene: "Test", pictureDesc: "Test",
        dialogue: "", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: "", videoPrompt: "", referenceAssetIds: [], status: "pending"
      } });
      await db.generationTask.createMany({ data: Array.from({ length: 11 }, (_, index) => ({
        id: `summary_task_${crypto.randomUUID()}`, userId, projectId: projects[0]!.id, type: "text", title: "Summary task", provider: "test", model: "test",
        status: index === 0 ? "pending" : "succeeded", updatedAt: new Date(Date.UTC(2001, 0, index + 1))
      })) });
      await db.generationTask.create({ data: { id: `content_operation_${crypto.randomUUID()}`, userId, type: "text", title: "Internal lock", provider: "test", model: "test", status: "running" } });
      const summary = await getWorkbenchSummary(userId);
      assert.equal(summary.projects, 9); assert.equal(summary.recentProjects.length, 6);
      assert.equal(summary.storyboards, 9, "Actual storyboard rows take precedence over stale cached project counters");
      assert.equal(summary.runningTasks, 1); assert.equal(summary.recentTasks.length, 8);
      assert.equal(summary.recentTasks.some(task => task.status === "pending"), false, "The active task is older than all recent cards");
    });
    await t.test("admin totals never turn seeded account balances, pending budgets or model prices into revenue", async () => {
      const before = await getAdminSummary();
      const userId = await user(); const own = await project(userId, 1);
      const now = new Date(); const old = new Date(now.getTime() - 3 * 86_400_000);
      const tasks = [
        { id: `summary_old_${crypto.randomUUID()}`, status: "succeeded", createdAt: old, finalCredits: 12 },
        { id: `summary_failed_${crypto.randomUUID()}`, status: "failed", createdAt: now, finalCredits: null },
        { id: `summary_running_${crypto.randomUUID()}`, status: "running", createdAt: now, finalCredits: null }
      ];
      await db.generationTask.createMany({ data: tasks.map(task => ({ ...task, userId, projectId: own.id, type: "text", title: "Summary test", provider: "test", model: "test", estimatedCredits: 1000 })) });
      await db.generationTask.create({ data: { id: `content_operation_${crypto.randomUUID()}`, userId, type: "text", title: "Internal lock", provider: "test", model: "test", status: "running", estimatedCredits: 0 } });
      await db.creditTransaction.createMany({ data: [
        { id: `summary_consume_${crypto.randomUUID()}`, userId, taskId: tasks[0]!.id, type: "consume", amount: -12, balanceAfter: 100, description: "Actual debit" },
        { id: `summary_release_${crypto.randomUUID()}`, userId, taskId: tasks[1]!.id, type: "refund", amount: 1000, balanceAfter: 100, description: "Release, not cash refund" },
        { id: `summary_gift_${crypto.randomUUID()}`, userId, type: "recharge", amount: 500, balanceAfter: 600, description: "Admin credit gift, not cash" }
      ] });
      await db.rechargeOrder.createMany({ data: [
        { id: `summary_paid_${crypto.randomUUID()}`, userId, planName: "Paid", channel: "manual", status: "paid", amountCny: 19.9, credits: 200 },
        { id: `summary_pending_${crypto.randomUUID()}`, userId, planName: "Unpaid", channel: "alipay", status: "pending", amountCny: 99, credits: 1000 },
        { id: `summary_mock_${crypto.randomUUID()}`, userId, planName: "Simulation", channel: "mock", status: "paid", amountCny: 999, credits: 10000 }
      ] });
      const summary = await getAdminSummary();
      assert.equal(summary.totalTasks, before.totalTasks! + 3); assert.equal(summary.tasksToday, before.tasksToday + 2);
      assert.equal(summary.completedTasks, before.completedTasks! + 2); assert.equal(summary.failedTasks, before.failedTasks! + 1);
      assert.equal(summary.creditsConsumed, before.creditsConsumed + 12);
      assert.equal(summary.paidRechargeCny, Math.round((before.paidRechargeCny! + 19.9) * 100) / 100);
      assert.equal(summary.providerCost, null); assert.equal(summary.providerCostStatus, "unavailable");
      assert.equal(summary.creditsRevenueEstimate, null); assert.equal(summary.grossMarginEstimate, null); assert.equal(summary.grossMarginRate, null);
      assert.equal(summary.metricTimezone, "Asia/Shanghai"); assert.ok(summary.unreconciledCredits! > 0);
      assert.equal(summary.refundCredits, before.refundCredits! + 1000);
      assert.ok(summary.costByStage?.every(row => row.providerCost === null));
      assert.match(summary.metricsNote!, /成本与毛利不可计算/);
    });
  } finally { await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect(); }
});
