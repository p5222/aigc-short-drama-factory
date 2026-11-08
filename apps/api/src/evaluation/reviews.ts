import type { EvaluationAttempt, EvaluationReviewInput } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { fingerprint, id, readSnapshot } from "./evidence.js";
import { mediaContentHash } from "./mediaIdentity.js";
import { summarizeRun } from "./runner.js";
import { json } from "./evidence.js";

export async function runEvidence(runId: string) {
  const rows = await prisma.evaluationAttempt.findMany({ where: { runId }, include: { sample: true, reviews: { orderBy: { version: "desc" } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const attempts = rows.map(row => ({
    ...row, submittedAt: row.submittedAt?.toISOString(), finishedAt: row.finishedAt?.toISOString(),
    reconciliation: (() => {
      const r = row.reconciliation as Record<string, unknown>;
      return r.outcome ? { outcome: r.outcome, reason: r.reason, reference: r.reference, reconciledAt: r.reconciledAt } : undefined;
    })(),
    report: row.reportId ? row.report : undefined,
    sample: { ...row.sample, createdAt: row.sample.createdAt.toISOString() },
    reviews: row.reviews.map(({ actorId: _actor, requestKey: _key, requestHash: _hash, ...r }) => ({ ...r, createdAt: r.createdAt.toISOString() }))
  })) as unknown as EvaluationAttempt[];
  const calibrated = attempts.filter(a => {
    const coverage = a.contract.coverage as { items?: number; totalItems?: number } | undefined;
    return a.report && a.reviews[0]?.scope === a.report.evidenceScope && a.reviews[0].verdict !== "insufficient" && !a.contract.includeFeedback &&
      (a.channel !== "text" || (!!coverage && coverage.items === coverage.totalItems));
  });
  const agreed = calibrated.filter(a => a.report!.pass === (a.reviews[0].verdict === "usable")).length;
  return { attempts, calibration: { reviewed: calibrated.length, agreed, disagreed: calibrated.length - agreed } };
}

export async function reconcileAttempt(attemptId: string, actorId: string, input: {
  requestId: string; outcome: "provider_completed" | "provider_failed"; reason: string; reference: string;
}) {
  if (input.reason.trim().length < 8 || !input.reference.trim()) throw new Error("请填写核对依据和至少 8 字说明。");
  const requestHash = fingerprint({ actorId, input });
  const runId = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "EvaluationAttempt" WHERE "id" = ${attemptId} FOR UPDATE`;
    const attempt = await tx.evaluationAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const prior = attempt.reconciliation as Record<string, unknown>;
    if (prior.requestHash === requestHash) return attempt.runId;
    if (prior.requestHash || attempt.status !== "unknown") throw new Error("当前尝试已核对或状态已变化，请刷新证据。");
    await tx.evaluationAttempt.update({ where: { id: attemptId }, data: {
      status: "failed", finishedAt: new Date(),
      errorReason: "供应商结果已人工核对，本次未形成有效评测报告；成本仍按已有用量证据记录。",
      reconciliation: json({ ...input, requestHash, actorId, originalStatus: attempt.status, originalError: attempt.errorReason, reconciledAt: new Date().toISOString() })
    } });
    return attempt.runId;
  });
  await summarizeRun(runId, true);
  return { id: attemptId, reconciled: true };
}

export async function attemptMedia(attemptId: string) {
  const attempt = await prisma.evaluationAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { sample: true } });
  const snapshot = readSnapshot(attempt.sample.snapshot);
  const relevant = snapshot.assets.filter(a => a.current !== false && (attempt.sample.stage === "character" ? ["role", "role_derivative", "role_reference"].includes(a.type) : a.type === attempt.sample.stage));
  const current = await prisma.asset.findMany({ where: { id: { in: relevant.map(a => a.id) }, projectId: attempt.sample.projectId } });
  return Promise.all(relevant.map(async asset => {
    const live = current.find(a => a.id === asset.id);
    const valid = !!asset.contentHash && !!live?.referenceUrl && live.status === asset.status && live.updatedAt.toISOString() === asset.updatedAt && fingerprint(live.referenceUrl) === asset.sourceFingerprint && await mediaContentHash(live.referenceUrl) === asset.contentHash;
    return { id: asset.id, name: asset.name, type: asset.type, available: valid, url: valid ? live!.referenceUrl! : undefined, reason: valid ? undefined : "文件内容无法核验或已改变；外链和未保留文件只能标记为证据不足。" };
  }));
}

export async function reviewAttempt(attemptId: string, actorId: string, input: EvaluationReviewInput) {
  const requestKey = `${actorId}:${input.requestId}`, requestHash = fingerprint({ attemptId, input });
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`review:${requestKey}`}))`;
    const prior = await tx.evaluationReview.findUnique({ where: { requestKey } });
    if (prior) {
      if (prior.requestHash !== requestHash) throw new Error("同一复核请求不能更改内容。");
      return { id: prior.id, version: prior.version };
    }
    await tx.$queryRaw`SELECT "id" FROM "EvaluationAttempt" WHERE "id" = ${attemptId} FOR UPDATE`;
    const attempt = await tx.evaluationAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { sample: true } });
    if (attempt.reviewVersion !== input.expectedVersion) throw new Error("复核意见已更新，请刷新后再提交。");
    if (attempt.sample.fingerprint !== input.fingerprint) throw new Error("样本指纹不匹配。");
    if (!input.reason.trim() || input.reason.length > 2000) throw new Error("复核需要 1–2000 字说明。");
    if (["prepared", "submitted", "unknown"].includes(attempt.status)) throw new Error("请先核对执行结果，再复核质量。");
    const fullTextReview = input.scope === "text" && ["script", "character", "storyboard"].includes(attempt.sample.stage);
    if (input.scope !== "media" && input.scope !== attempt.channel && !fullTextReview) throw new Error("复核范围与评测证据不匹配。");
    const mediaIds = [...new Set(input.mediaIds ?? [])];
    if (input.scope === "media") {
      if (!["character", "image", "video"].includes(attempt.sample.stage)) throw new Error("当前阶段没有媒体复核范围。");
      const snapshot = readSnapshot(attempt.sample.snapshot);
      const relevant = snapshot.assets.filter(a => a.current !== false && (attempt.sample.stage === "character" ? ["role", "role_derivative", "role_reference"].includes(a.type) : a.type === attempt.sample.stage));
      if (input.verdict !== "insufficient" && (!relevant.length || relevant.length !== mediaIds.length || relevant.some(a => !mediaIds.includes(a.id)))) throw new Error("请查看此阶段全部固定媒体并确认，缺少媒体时请选择证据不足。");
      for (const assetId of mediaIds) {
        const saved = relevant.find(a => a.id === assetId);
        await tx.$queryRaw`SELECT "id" FROM "Asset" WHERE "id" = ${assetId} FOR SHARE`;
        const live = await tx.asset.findUnique({ where: { id: assetId } });
        if (!saved?.contentHash || !live?.referenceUrl || live.projectId !== attempt.sample.projectId || live.status !== saved.status || live.updatedAt.toISOString() !== saved.updatedAt || fingerprint(live.referenceUrl) !== saved.sourceFingerprint || await mediaContentHash(live.referenceUrl) !== saved.contentHash) throw new Error("媒体来源已变化或内容无法核验，请保存新样本后复核。");
      }
    } else if (mediaIds.length) throw new Error("文本或结构复核不能附加媒体确认。");
    const version = attempt.reviewVersion + 1;
    const review = await tx.evaluationReview.create({ data: { id: id("eval_review"), attemptId, actorId, requestKey, requestHash, version,
      fingerprint: input.fingerprint, scope: input.scope, verdict: input.verdict, reason: input.reason.trim(), mediaIds } });
    await tx.evaluationAttempt.update({ where: { id: attemptId }, data: { reviewVersion: version } });
    return { id: review.id, version };
  }, { timeout: 60_000 });
}
