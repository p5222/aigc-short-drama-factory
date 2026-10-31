import crypto from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { isPersistedPlayableVideoReference, type ExportOutcomeReport } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { ContentMutationError } from "../content/contentMutation.js";
import { exportSourceFromDiagnostics } from "./exportSource.js";

const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function outputFingerprint(job: { id: string; outputUrl: string | null; errorReason: string | null }) {
  const source = exportSourceFromDiagnostics(job.errorReason);
  return crypto.createHash("sha256").update(JSON.stringify([job.id, job.outputUrl, source?.inputFingerprint ?? null, source?.deliveryEdit ?? null])).digest("hex");
}
async function loadExport(tx: Prisma.TransactionClient, userId: string, projectId: string, exportJobId: string) {
  if (!userId) throw Object.assign(new Error("请先登录"), { status: 401 });
  const job = await tx.exportJob.findFirst({ where: { id: exportJobId, projectId, userId, project: { userId } }, include: { outcome: true } });
  if (!job) throw new ContentMutationError(404, "导出记录不存在");
  let diagnostics: Record<string, any> = {};
  try { diagnostics = record(JSON.parse(job.errorReason ?? "{}")); } catch { /* Old exports may lack diagnostics. */ }
  if (job.type !== "video_export" || job.status !== "succeeded" || (diagnostics.outputKind && diagnostics.outputKind !== "mp4") || !isPersistedPlayableVideoReference(job.outputUrl ?? "")) throw new ContentMutationError(409, "只有已完成的 MP4 成片可以记录可用性反馈");
  return job;
}

/** Cumulative investment for ONE chosen output, not divided by duplicate export versions.
 * Includes failed/repaired content and production tasks up to this export's completion.
 * Old reused assets are reported separately, without assigning invented historical cost.
 */
export async function exportOutcomeReport(userId: string, projectId: string, exportJobId: string): Promise<ExportOutcomeReport> {
  return prisma.$transaction(async tx => {
    const job = await loadExport(tx, userId, projectId, exportJobId);
    const fingerprint = outputFingerprint(job);
    const sourceScripts = await tx.scriptDraft.findMany({ where: { projectId }, select: { promptSnapshot: true } });
    const sourceContentIds = sourceScripts.map(script => record(script.promptSnapshot).sourceContentId).filter((id): id is string => typeof id === "string");
    const linked = await tx.contentProject.findMany({ where: { userId, OR: [{ productionProjectId: projectId }, { id: { in: sourceContentIds } }] }, select: { id: true } });
    const tasks = await tx.generationTask.findMany({ where: { userId, createdAt: { lte: job.updatedAt },
      OR: [{ projectId }, ...linked.map(item => ({ jobId: { startsWith: `content:${item.id}:billing:` } }))] },
      select: { finalCredits: true, billingSettlement: true, status: true, jobId: true } });
    const billable = tasks.filter(task => !task.jobId?.includes(":operation:"));
    let knownCredits = 0, knownCostMicros = 0, unknownCostTasks = 0, unsettledTasks = 0, verified = 0;
    for (const task of billable) {
      const settlement = record(task.billingSettlement);
      const credits = task.finalCredits ?? settlement.chargedCredits;
      if (typeof credits === "number" && Number.isFinite(credits)) knownCredits += credits;
      else unsettledTasks++;
      if (typeof settlement.costMicros === "number" && Number.isFinite(settlement.costMicros) && !settlement.routeMismatch) knownCostMicros += settlement.costMicros;
      else unknownCostTasks++;
      if (settlement.costStatus === "invoice_verified") verified++;
    }
    const review = job.outcome?.outputFingerprint === fingerprint ? job.outcome : null;
    const source = exportSourceFromDiagnostics(job.errorReason);
    const durationSeconds = source?.durationSeconds && Number.isFinite(source.durationSeconds) && source.durationSeconds > 0 ? source.durationSeconds : null;
    const credits = billable.length && !unsettledTasks ? knownCredits : null;
    const costMicros = billable.length && !unknownCostTasks ? knownCostMicros : null;
    const usable = review?.verdict === "usable";
    return {
      exportJobId, reviewRevision: job.outcome?.revision ?? 0, outputFingerprint: fingerprint, durationSeconds,
      review: review ? { verdict: review.verdict as "usable" | "needs_changes", note: review.note, revision: review.revision, updatedAt: review.updatedAt.toISOString() } : null,
      history: Array.isArray(job.outcome?.history) ? job.outcome.history as any : [],
      costs: { scope: "cumulative_project_to_export", taskCount: billable.length, failedTaskCount: billable.filter(task => ["failed", "canceled", "refunded"].includes(task.status)).length,
        unknownCostTasks, unsettledTasks, credits, knownCredits, costMicros, knownCostMicros,
        invoiceStatus: verified && verified === billable.length ? "invoice_verified" : verified ? "partially_verified" : "unverified",
        creditsPerUsableSecond: usable && credits !== null && durationSeconds ? credits / durationSeconds : null,
        costMicrosPerUsableSecond: usable && costMicros !== null && durationSeconds ? costMicros / durationSeconds : null,
        reusedAssets: await tx.asset.count({ where: { projectId, reusedFromAssetId: { not: null } } }) }
    };
  }, { isolationLevel: "RepeatableRead" });
}

export async function reviewExportOutcome(userId: string, projectId: string, exportJobId: string, raw: unknown) {
  const input = z.object({ outputFingerprint: z.string().regex(/^[a-f0-9]{64}$/), expectedRevision: z.number().int().min(0),
    verdict: z.enum(["usable", "needs_changes"]), note: z.string().trim().max(2000).default("") }).strict().parse(raw);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ExportJob" WHERE "id" = ${exportJobId} FOR UPDATE`;
    const job = await loadExport(tx, userId, projectId, exportJobId);
    const fingerprint = outputFingerprint(job);
    if (fingerprint !== input.outputFingerprint) throw new ContentMutationError(409, "成片版本已变化，请重新预览后评价");
    const previous = job.outcome;
    if (previous?.outputFingerprint === fingerprint && previous.verdict === input.verdict && previous.note === input.note) return;
    if ((previous?.revision ?? 0) !== input.expectedRevision) throw new ContentMutationError(409, "反馈已有更新，请保留草稿并重新读取");
    const history = [...(Array.isArray(previous?.history) ? previous.history : []),
      { verdict: input.verdict, note: input.note, revision: (previous?.revision ?? 0) + 1, reviewedAt: new Date().toISOString(), outputFingerprint: fingerprint }];
    await tx.exportOutcome.upsert({ where: { exportJobId }, create: { exportJobId, userId, outputFingerprint: fingerprint, verdict: input.verdict, note: input.note, history: json(history) },
      update: { outputFingerprint: fingerprint, verdict: input.verdict, note: input.note, revision: { increment: 1 }, history: json(history) } });
    await tx.analyticsEvent.create({ data: { id: `event_${crypto.randomUUID()}`, userId, projectId, entityType: "export", entityId: exportJobId,
      eventName: input.verdict === "usable" ? "creator_export_accepted" : "creator_export_needs_changes",
      sourceChannel: "creator_studio", properties: { outputFingerprint: fingerprint, revision: (previous?.revision ?? 0) + 1 } } });
  });
  return exportOutcomeReport(userId, projectId, exportJobId);
}
