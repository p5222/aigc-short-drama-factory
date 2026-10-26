import { AsyncLocalStorage } from "node:async_hooks";
import { calculateOfficialBatchCredits, type BillingUsage, type TaskBillingQuote } from "@aifilm/shared";
import { prisma } from "../db/client.js";

type Meter = { taskId: string; attemptId?: string; calls: Array<{ usage: BillingUsage; provider: string; model: string; requestId?: string }> };
const context = new AsyncLocalStorage<Meter>();
export async function flushTaskMeter(delivered: boolean, db = prisma) {
  const meter = context.getStore();
  if (!meter?.calls.length) return;
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "GenerationTask" WHERE "id" = ${meter.taskId} FOR UPDATE`;
    const previous = await tx.generationTask.findUniqueOrThrow({ where: { id: meter.taskId } });
    const old = previous.billingUsage as { calls?: Array<{ usage: BillingUsage; provider: string; model: string; delivered: boolean }> } | null;
    let leaseId: string | undefined;
    try { const checkpoint = JSON.parse(previous.errorReason ?? "{}"); leaseId = checkpoint.leaseId ?? checkpoint.metadata?.leaseId; } catch { /* No execution lease. */ }
    const accepted = delivered && !["failed", "canceled", "refunded"].includes(previous.status) && (!meter.attemptId || leaseId === meter.attemptId);
    const calls = [...(old?.calls ?? []), ...meter.calls.map(call => ({ ...call, delivered: accepted, ...(meter.attemptId ? { attemptId: meter.attemptId } : {}) }))];
    const quote = previous.billingQuote as unknown as TaskBillingQuote | null;
    const settlement = previous.billingSettlement as Record<string, unknown> | null;
    const matching = calls.filter(call => call.provider === quote?.provider && call.model === quote?.model);
    const lateCost = !["pending", "running"].includes(previous.status) && settlement?.costStatus !== "invoice_verified" && quote?.rule && matching.length
      ? calculateOfficialBatchCredits(quote.rule, matching.map(c => c.usage), quote.policy).costMicros : null;
    await tx.generationTask.update({ where: { id: meter.taskId }, data: {
      billingUsage: JSON.parse(JSON.stringify({ version: 1, source: "provider_usage", calls })),
      ...(lateCost === null ? {} : { billingSettlement: JSON.parse(JSON.stringify({ ...(settlement ?? {}), costMicros: lateCost, costStatus: "usage_derived" })) })
    } });
    meter.calls.length = 0;
  });
}
export async function withTaskMeter<T>(taskId: string, run: () => Promise<T>, db = prisma, attemptId?: string): Promise<T> {
  const meter: Meter = { taskId, attemptId, calls: [] };
  let delivered = false;
  try { const result = await context.run(meter, run); delivered = true; return result; }
  finally {
    await context.run(meter, () => flushTaskMeter(delivered, db));
  }
}
/** Capture usage before parsing generated content: invalid JSON can still incur cost. */
export function recordTextUsage(data: unknown, provider: string, model: string) {
  const meter = context.getStore();
  if (!meter || !data || typeof data !== "object") return;
  const d = data as Record<string, any>, u = d.usage ?? d.usageMetadata;
  if (!u) return;
  const input = u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount;
  const output = u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) return;
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cachedContentTokenCount ?? 0;
  if (!Number.isSafeInteger(cached) || cached < 0 || cached > input) return;
  meter.calls.push({ usage: { inputTokens: input, outputTokens: output, cachedInputTokens: cached }, provider, model, ...(typeof d.id === "string" ? { requestId: d.id } : {}) });
}
