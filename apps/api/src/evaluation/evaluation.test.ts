import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { fingerprint, parseJudge, structureReport, readSnapshot } from "./evidence.js";
import type { TextUsageCall } from "../billing/metering.js";

const valid = { totalScore: 0, dimensionScores: { coherence: 0, specificity: 0, productionReadiness: 0 }, mainProblems: [], suggestedFixes: [], criticalFailure: false, pass: true };
test("judge contracts preserve zero and reject malformed evidence without fallback", () => {
  assert.equal(parseJudge(valid).totalScore, 0); assert.equal(parseJudge(valid).pass, false);
  assert.equal(parseJudge({ ...valid, totalScore: 99, criticalFailure: true }).pass, false);
  for (const invalid of [null, [], { ...valid, totalScore: "0" }, { ...valid, totalScore: -1 }, { ...valid, totalScore: 101 }, { ...valid, totalScore: 0.5 },
    { ...valid, dimensionScores: {} }, { ...valid, dimensionScores: { ...valid.dimensionScores, extra: 1 } }, { ...valid, mainProblems: "none" }, { ...valid, suggestedFixes: [1] }, { ...valid, criticalFailure: undefined }]) {
    assert.throws(() => parseJudge(invalid));
  }
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
});

test("media structure never claims visual quality or coverage from duplicate assets", () => {
  const snapshot = readSnapshot({ project: { id: "p" }, shots: [{}, {}], assets: [{ id: "a", type: "image", hasSource: true, status: "succeeded" }, { id: "b", type: "image", hasSource: true, status: "succeeded" }] });
  const report = structureReport(snapshot, "image");
  assert.equal(report.evidenceScope, "structure");
  assert.deepEqual(Object.keys(report.dimensionScores), ["assetsPresent", "sourcesPresent", "successfulStatus"]);
  assert.equal(report.recommendedAction, "manual_review");
});

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;
test("fixed evaluation PostgreSQL evidence, paid-call guards, review and feedback closure", { skip: !databaseUrl, timeout: 300_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); assert.match(url.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false"; process.env.DATABASE_URL = databaseUrl;
  const mediaRoot = await mkdtemp(join(tmpdir(), "evaluation-media-"));
  process.env.OBJECT_STORAGE_LOCAL_DIR = mediaRoot;
  await mkdir(join(mediaRoot, "images")); await writeFile(join(mediaRoot, "images", "old.png"), "original media bytes");
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  const { createFrozenDataset, runEvaluation, reconcileStaleRuns, withEvaluationSnapshot } = await import("./runner.js");
  const { compareEvidence } = await import("./comparison.js");
  const { runEvidence, reviewAttempt, attemptMedia, reconcileAttempt } = await import("./reviews.js");
  const { convertFeedback, updateFeedback } = await import("./feedback.js");
  const { deleteEvaluationRun } = await import("../db/evaluation.js");
  const { recordTextUsage, withTextUsageCapture } = await import("../billing/metering.js");
  const uid = `eval_test_${crypto.randomUUID()}`, pid = `${uid}_project`, provider = `${uid}_provider`;
  const actor = `${uid}_admin`;
  const fetchOriginal = globalThis.fetch;
  const requestIds: string[] = [];
  const rule = { version: 1, kind: "tokens", currency: "CNY", inputMicros: 1_000_000, outputMicros: 2_000_000, model: "judge", region: "test", sourceUrl: "https://example.test/pricing", verifiedAt: "2026-11-08T00:00:00Z" };
  await db.user.create({ data: { id: uid, name: "Fixed evidence fixture", credit: { create: { id: `${uid}_credit`, balance: 100 } } } });
  await db.project.create({ data: { id: pid, userId: uid, name: "Evidence fixture", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "draft" } });
  await db.scriptDraft.create({ data: { id: `${uid}_script`, projectId: pid, name: "Original", synopsis: "Fixed synopsis", content: "Original complete script", promptSnapshot: { secretExample: "must-not-copy", version: "actual-v1" } } });
  await db.modelProvider.create({ data: { id: provider, name: "Fixture judge", costHint: "test", modality: "text", models: ["judge"], enabled: true, apiKey: "fixture-key",
    baseUrl: "https://evaluation.invalid/v1", capability: { connection: { protocol: "openai-chat" } } } });
  await db.modelPrice.create({ data: { id: `${uid}_price`, providerId: provider, providerName: "Fixture judge", modality: "text", model: "judge", unit: "text_run", unitCredits: 1, billing: rule } });
  const input = () => { const requestId = crypto.randomUUID(); requestIds.push(requestId); return { requestId, projectIds: [pid], stages: ["script"] as ["script"], mode: "llm" as const, evaluatorModels: [{ provider, model: "judge" }], maxLlmCalls: 2 }; };
  let networkCalls = 0;
  const respond = (content = JSON.stringify(valid), reportedModel = "judge") => {
    globalThis.fetch = async () => {
      networkCalls++;
      assert.equal(await db.evaluationAttempt.count({ where: { status: "submitted", run: { requestKey: { startsWith: actor } } } }), 1, "durable marker must precede IO");
      return new Response(JSON.stringify({ id: "provider-receipt", model: reportedModel, usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [{ message: { content } }] }));
    };
  };
  try {
    await t.test("independent usage retains returned model identity while missing usage stays unknown", async () => {
      const calls: TextUsageCall[] = [];
      await withTextUsageCapture(calls, async () => {
        recordTextUsage({ id: "receipt", model: "different-model" }, "provider", "requested-model");
        recordTextUsage({ modelVersion: "returned-version", usage: { input_tokens: "10", output_tokens: 2 } }, "provider", "requested-model");
      });
      assert.equal(calls.length, 2);
      assert.equal(calls[0].reportedModel, "different-model");
      assert.equal(calls[1].reportedModel, "returned-version");
      assert.deepEqual(calls.map(call => call.usage), [{}, {}]);
    });
    await t.test("dataset captures complete whitelisted content and preserves it after project edits", async () => {
      const dataset = await db.$transaction(tx => createFrozenDataset({ name: "fixed", projectIds: [pid], stages: ["script"] }, tx));
      const saved = await db.evaluationSample.findFirstOrThrow({ where: { datasetId: dataset.id } });
      assert.doesNotMatch(JSON.stringify(saved.snapshot), /must-not-copy|fixture-key/);
      await db.scriptDraft.update({ where: { id: `${uid}_script` }, data: { content: "Changed live script" } });
      const result = await runEvaluation({ requestId: crypto.randomUUID(), datasetId: dataset.id, mode: "rules" }, undefined, actor);
      const evidence = await runEvidence(result.run!.id);
      assert.equal(readSnapshot(evidence.attempts[0].sample.snapshot).scripts[0].content, "Original complete script");
      assert.equal(evidence.attempts[0].sample.fingerprint, saved.fingerprint);
      await assert.rejects(runEvaluation({ requestId: crypto.randomUUID(), datasetId: dataset.id, mode: "rules" }, uid), /自己的项目/);
    });
    await t.test("parallel identical request submits once; parameter changes conflict and no creator credits are charged", async () => {
      respond(); const params = input(), before = networkCalls;
      const results = await Promise.all([runEvaluation(params, undefined, actor), runEvaluation(params, undefined, actor)]);
      assert.equal(results[0].run!.id, results[1].run!.id); assert.equal(networkCalls - before, 1);
      const saved = await runEvaluation(params, undefined, actor);
      assert.equal(saved.reports[0].totalScore, 0); assert.equal(saved.reports[0].pass, false);
      assert.equal(saved.usage.inputTokens, 100); assert.equal(saved.usage.unknownCostCalls, 0); assert.ok(saved.usage.knownCostMicros! > 0);
      assert.equal((await db.creditAccount.findUniqueOrThrow({ where: { userId: uid } })).balance, 100);
      await assert.rejects(runEvaluation({ ...params, maxLlmCalls: 1 }, undefined, actor), /不同的评测参数/);
      await assert.rejects(deleteEvaluationRun(saved.run!.id), /不能删除/);
    });
    await t.test("invalid generated JSON retains provider usage even when every evaluation fails", async () => {
      respond("not valid JSON"); const result = await runEvaluation(input(), undefined, actor);
      assert.equal(result.run!.status, "failed"); assert.equal(result.reports.length, 0);
      assert.equal(result.usage.llmCalls, 1); assert.equal(result.usage.llmFailures, 1); assert.equal(result.usage.inputTokens, 100); assert.ok(result.usage.knownCostMicros! > 0);
    });
    await t.test("a different returned judge cannot borrow the selected model price or produce a comparable score", async () => {
      respond(JSON.stringify(valid), "unexpected-judge");
      const result = await runEvaluation(input(), undefined, actor);
      assert.equal(result.run!.status, "failed");
      assert.equal(result.reports.length, 0);
      assert.equal(result.usage.inputTokens, 100);
      assert.equal(result.usage.unknownCostCalls, 1);
      assert.equal(result.usage.knownCostMicros, 0);
      assert.equal((await runEvidence(result.run!.id)).attempts[0].usage.calls![0].reportedModel, "unexpected-judge");
    });
    await t.test("unknown supplier response stops remaining calls and duplicate requests never resubmit", async () => {
      const before = networkCalls;
      globalThis.fetch = async () => { networkCalls++; throw new Error("network result unknown"); };
      const params = { ...input(), stages: ["script", "character"] as ["script", "character"] };
      const result = await runEvaluation(params, undefined, actor);
      assert.equal(result.run!.status, "needs_review"); assert.equal(networkCalls - before, 1); assert.equal(result.usage.unknownCostCalls, 1);
      await runEvaluation(params, undefined, actor); assert.equal(networkCalls - before, 1);
    });
    await t.test("price and configuration budgets prevent submission, and media never reaches a text judge", async () => {
      respond(); const before = networkCalls;
      const result = await runEvaluation({ ...input(), budgetCny: 0 }, undefined, actor);
      assert.equal(result.usage.llmCalls, 0);
      const media = await runEvaluation({ ...input(), stages: ["image"] }, undefined, actor);
      assert.equal(media.usage.llmCalls, 0); assert.equal(networkCalls, before);
      assert.equal(media.reports[0].evidenceScope, "structure");
      await db.modelPrice.update({ where: { id: `${uid}_price` }, data: { model: "wrong-model" } });
      assert.equal((await runEvaluation(input(), undefined, actor)).usage.llmCalls, 0);
      await db.modelPrice.update({ where: { id: `${uid}_price` }, data: { model: "judge" } });
    });
    await t.test("review is append-only, idempotent and detects concurrent changes", async () => {
      respond(); const result = await runEvaluation(input(), undefined, actor);
      const attempt = (await runEvidence(result.run!.id)).attempts[0];
      const review = { requestId: crypto.randomUUID(), expectedVersion: 0, fingerprint: attempt.sample.fingerprint, scope: "text" as const, verdict: "usable" as const, reason: "Reviewed actual complete script" };
      const first = await reviewAttempt(attempt.id, actor, review);
      assert.deepEqual(await reviewAttempt(attempt.id, actor, review), first);
      await assert.rejects(reviewAttempt(attempt.id, actor, { ...review, requestId: crypto.randomUUID() }), /已更新/);
      await reviewAttempt(attempt.id, actor, { ...review, requestId: crypto.randomUUID(), expectedVersion: 1, verdict: "unusable" });
      const evidence = await runEvidence(result.run!.id);
      assert.equal(evidence.attempts[0].reviews.length, 2); assert.equal(evidence.calibration.agreed, 1);
    });
    await t.test("feedback conversion is atomic; repair needs fresh matched review evidence", async () => {
      const feedbackId = `${uid}_feedback`;
      await db.userFeedback.create({ data: { id: feedbackId, projectId: pid, userId: uid, stage: "script", tags: [], content: "Script needs review" } });
      const [a, b] = await Promise.all([convertFeedback(feedbackId), convertFeedback(feedbackId)]);
      assert.equal(a.dataset.id, b.dataset.id); assert.equal(a.feedback.status, "processing");
      await assert.rejects(updateFeedback(feedbackId, { expectedVersion: a.feedback.version, status: "resolved", resolution: "Fixed" }), /关联复测/);
      respond(); const result = await runEvaluation(input(), undefined, actor), attempt = (await runEvidence(result.run!.id)).attempts[0];
      const review = await reviewAttempt(attempt.id, actor, { requestId: crypto.randomUUID(), expectedVersion: 0, fingerprint: attempt.sample.fingerprint, scope: "text", verdict: "usable", reason: "Read complete revised sample" });
      const updated = await updateFeedback(feedbackId, { expectedVersion: a.feedback.version, status: "resolved", resolution: "修订后逐句复核通过", resolutionAttemptId: attempt.id, resolutionReviewId: review.id });
      assert.equal(updated.status, "resolved"); assert.equal(updated.resolutionReviewId, review.id);
      await assert.rejects(updateFeedback(feedbackId, { expectedVersion: a.feedback.version, status: "ignored", resolution: "Close" }), /已更新/);
      const before = networkCalls;
      const manual = await runEvaluation({ ...input(), mode: "rules" }, undefined, actor);
      const manualAttempt = (await runEvidence(manual.run!.id)).attempts[0];
      const manualReview = await reviewAttempt(manualAttempt.id, actor, { requestId: crypto.randomUUID(), expectedVersion: 0, fingerprint: manualAttempt.sample.fingerprint, scope: "text", verdict: "usable", reason: "人工查看完整固定文本，无需文本模型调用。" });
      assert.equal((await updateFeedback(feedbackId, { expectedVersion: updated.version, status: "resolved", resolution: "完整文本人工复测通过", resolutionAttemptId: manualAttempt.id, resolutionReviewId: manualReview.id })).status, "resolved");
      assert.equal((await runEvidence(manual.run!.id)).calibration.reviewed, 0, "human text review must not calibrate structural checks");
      assert.equal(networkCalls, before);
    });
    await t.test("changed media cannot be substituted into an old sample review", async () => {
      await db.asset.create({ data: { id: `${uid}_asset`, projectId: pid, type: "image", name: "Frame", description: "", prompt: "", status: "succeeded", referenceUrl: "/storage/images/old.png" } });
      const result = await runEvaluation({ ...input(), mode: "rules", stages: ["image"] }, undefined, actor), attempt = (await runEvidence(result.run!.id)).attempts[0];
      assert.equal((await attemptMedia(attempt.id))[0].available, true);
      await writeFile(join(mediaRoot, "images", "old.png"), "different bytes at same URL");
      assert.equal((await attemptMedia(attempt.id))[0].available, false);
      await assert.rejects(reviewAttempt(attempt.id, actor, { requestId: crypto.randomUUID(), expectedVersion: 0, fingerprint: attempt.sample.fingerprint, scope: "media", verdict: "usable", reason: "Viewed", mediaIds: [`${uid}_asset`] }), /已变化/);
    });
    await t.test("comparison separates channels and excludes changed or missing evidence", async () => {
      respond();
      const a = await runEvaluation({ ...input(), mode: "hybrid" }, undefined, actor);
      const b = await runEvaluation({ ...input(), mode: "hybrid" }, undefined, actor);
      const metrics = await compareEvidence(a.run!.id, b.run!.id, "script");
      assert.equal(metrics.comparability!.paired, 2); assert.equal(metrics.comparability!.channels.length, 2);
      assert.equal(b.run!.summary.channels!.length, 2); assert.equal(b.run!.summary.stageScores.length, 0);
      await db.scriptDraft.update({ where: { id: `${uid}_script` }, data: { content: "Another version" } });
      const c = await runEvaluation(input(), undefined, actor);
      assert.equal((await compareEvidence(a.run!.id, c.run!.id, "script")).comparability!.paired, 0);
      assert.match(metrics.comparability!.reasons.join(), /待验证/);
    });
    await t.test("repeatable snapshots do not combine content from concurrent project revisions", async () => {
      const dataset = await withEvaluationSnapshot(async tx => {
        const before = await tx.scriptDraft.findUniqueOrThrow({ where: { id: `${uid}_script` } });
        await db.scriptDraft.update({ where: { id: `${uid}_script` }, data: { content: "Concurrent edit" } });
        const frozen = await createFrozenDataset({ name: "Consistent snapshot", projectIds: [pid], stages: ["script"] }, tx);
        const sample = await tx.evaluationSample.findFirstOrThrow({ where: { datasetId: frozen.id } });
        assert.equal(readSnapshot(sample.snapshot).scripts[0].content, before.content);
        return frozen;
      });
      assert.ok(dataset.id);
    });
    await t.test("stale submitted attempts become unknown and can be reconciled without fabricating a report", async () => {
      const result = await runEvaluation({ ...input(), mode: "rules" }, undefined, actor), attempt = (await runEvidence(result.run!.id)).attempts[0];
      await db.evaluationAttempt.update({ where: { id: attempt.id }, data: { status: "submitted", submittedAt: new Date() } });
      await db.evaluationRun.update({ where: { id: result.run!.id }, data: { status: "running", updatedAt: new Date(Date.now() - 16 * 60_000) } });
      const before = networkCalls; await reconcileStaleRuns();
      assert.equal((await db.evaluationRun.findUniqueOrThrow({ where: { id: result.run!.id } })).status, "needs_review"); assert.equal(networkCalls, before);
      await db.evaluationAttempt.update({ where: { id: attempt.id }, data: { report: {}, reportId: null } });
      const reconciliation = { requestId: crypto.randomUUID(), outcome: "provider_failed" as const, reference: "provider-log-123", reason: "已检查供应商调用记录，确认处理失败。" };
      await reconcileAttempt(attempt.id, actor, reconciliation);
      await reconcileAttempt(attempt.id, actor, reconciliation);
      await assert.rejects(reconcileAttempt(attempt.id, actor, { ...reconciliation, requestId: crypto.randomUUID(), outcome: "provider_completed" }), /已核对/);
      const detail = await runEvidence(result.run!.id);
      assert.equal(detail.attempts[0].status, "failed"); assert.equal(detail.attempts[0].report, undefined);
      assert.equal(detail.attempts[0].reconciliation?.reference, "provider-log-123");
      assert.equal((await db.evaluationRun.findUniqueOrThrow({ where: { id: result.run!.id } })).status, "failed");
      assert.equal(networkCalls, before);
    });
  } finally {
    globalThis.fetch = fetchOriginal;
    const runs = await db.evaluationRun.findMany({ where: { requestKey: { startsWith: actor } }, select: { id: true } });
    const ids = runs.map(r => r.id);
    await db.evaluationReview.deleteMany({ where: { attempt: { runId: { in: ids } } } });
    await db.evaluationAttempt.deleteMany({ where: { runId: { in: ids } } });
    await db.evaluationRun.deleteMany({ where: { id: { in: ids } } });
    await db.evaluationSample.deleteMany({ where: { projectId: pid } });
    await db.evaluationDataset.deleteMany({ where: { projectIds: { has: pid } } });
    await db.modelProvider.delete({ where: { id: provider } });
    await db.user.delete({ where: { id: uid } }); await db.$disconnect();
    await rm(mediaRoot, { recursive: true, force: true });
  }
});
