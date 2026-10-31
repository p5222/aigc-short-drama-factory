import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

test("export acceptance uses version-bound feedback and cumulative complete costs", { skip: !process.env.AIFILM_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.AIFILM_TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_/);
  process.env.DATABASE_URL = url.toString(); process.env.AIFILM_LOAD_ENV_FILES = "false";
  const { prisma: db } = await import("../db/client.js");
  const { exportOutcomeReport, reviewExportOutcome } = await import("./exportOutcome.js");
  const id = `audit_outcome_${crypto.randomUUID()}`, projectId = `${id}_project`, contentId = `${id}_content`, exportId = `${id}_export`;
  const baseTask = { userId: id, type: "text", title: "fixture", provider: "fixture", model: "fixture", status: "succeeded", createdAt: new Date("2026-01-01") };
  try {
    await db.user.create({ data: { id, name: "Outcome fixture" } });
    await db.project.create({ data: { id: projectId, userId: id, name: "成片成本测试", type: "漫剧", sourceType: "script", artStyle: "国漫", videoRatio: "16:9", status: "completed" } });
    await db.contentProject.create({ data: { id: contentId, userId: id, title: "故事", mode: "original", productionProjectId: projectId } });
    await db.exportJob.create({ data: { id: exportId, userId: id, projectId, type: "video_export", status: "succeeded", outputUrl: "/storage/outcome.mp4", updatedAt: new Date("2026-02-01"),
      errorReason: JSON.stringify({ kind: "export_diagnostics", outputKind: "mp4", sourceSnapshot: { version: 1, type: "video_export", projectId, scope: "selection", storyboardIds: ["shot"], inputFingerprint: "a".repeat(64), durationSeconds: 30 } }) } });
    await db.generationTask.createMany({ data: [
      { ...baseTask, id: `${id}_ok`, projectId, finalCredits: 20, billingSettlement: { chargedCredits: 20, costMicros: 100000, costStatus: "invoice_verified" } },
      { ...baseTask, id: `${id}_failed`, projectId, status: "failed", billingSettlement: { chargedCredits: 0, costMicros: 50000, costStatus: "usage_derived" } },
      { ...baseTask, id: `${id}_story`, jobId: `content:${contentId}:billing:test`, finalCredits: 10, billingSettlement: { costMicros: 10000, costStatus: "usage_derived" } },
      { ...baseTask, id: `${id}_operation`, jobId: `content:${contentId}:operation:test` },
      { ...baseTask, id: `${id}_future`, projectId, finalCredits: 999, createdAt: new Date("2026-03-01") }
    ] });
    let report = await exportOutcomeReport(id, projectId, exportId);
    assert.equal(report.costs.taskCount, 3);
    assert.equal(report.costs.credits, 30);
    assert.equal(report.costs.costMicros, 160000);
    assert.equal(report.costs.failedTaskCount, 1);
    assert.equal(report.costs.invoiceStatus, "partially_verified");
    assert.equal(report.costs.creditsPerUsableSecond, null);
    await db.scriptDraft.create({ data: { id: `${id}_source`, projectId, name: "已保存故事", content: "故事版本", synopsis: "", promptSnapshot: { sourceContentId: contentId } } });
    await db.contentProject.update({ where: { id: contentId }, data: { productionProjectId: null } });
    assert.equal((await exportOutcomeReport(id, projectId, exportId)).costs.credits, 30, "saved production provenance retains earlier story costs after a new version is created");
    const input = { outputFingerprint: report.outputFingerprint, expectedRevision: 0, verdict: "usable", note: "叙事与节奏可以交付" };
    report = await reviewExportOutcome(id, projectId, exportId, input);
    assert.equal(report.costs.creditsPerUsableSecond, 1);
    assert.equal(report.review?.revision, 1);
    assert.equal((await reviewExportOutcome(id, projectId, exportId, input)).history.length, 1);
    await assert.rejects(reviewExportOutcome(id, projectId, exportId, { ...input, note: "new" }), /已有更新/);
    await assert.rejects(exportOutcomeReport("other-user", projectId, exportId), /不存在/);
    await assert.rejects(exportOutcomeReport(undefined as unknown as string, projectId, exportId), /请先登录/);
    await db.generationTask.create({ data: { ...baseTask, id: `${id}_unknown`, projectId, status: "failed" } });
    report = await exportOutcomeReport(id, projectId, exportId);
    assert.equal(report.costs.costMicros, null);
    assert.equal(report.costs.credits, null);
    assert.equal(report.costs.knownCostMicros, 160000);
    assert.equal(report.costs.creditsPerUsableSecond, null);
    await db.exportJob.update({ where: { id: exportId }, data: { outputUrl: "/storage/replaced.mp4", updatedAt: new Date("2026-02-01") } });
    await assert.rejects(reviewExportOutcome(id, projectId, exportId, { ...input, expectedRevision: 1 }), /版本已变化/);
    assert.equal((await exportOutcomeReport(id, projectId, exportId)).review, null);
    await db.exportJob.update({ where: { id: exportId }, data: { status: "failed" } });
    await assert.rejects(exportOutcomeReport(id, projectId, exportId), /只有已完成/);
  } finally {
    await db.contentProject.deleteMany({ where: { id: contentId } });
    await db.user.deleteMany({ where: { id } });
    await db.$disconnect();
  }
});
