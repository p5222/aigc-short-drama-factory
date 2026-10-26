import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { activeMembership, discountedCredits, membershipQueuePriority } from "./membership.js";
import { calculateOfficialBatchCredits, calculateOfficialCredits, officialSampleUsage, type BillingUsage, type TaskBillingQuote } from "@aifilm/shared";
import { creditPolicy, readCostRule } from "./pricing.js";
import { ensureFunding, spendFunding } from "./funding.js";

type TaskCreditInput = { taskId: string; userId: string; description?: string; attemptId?: string };
export type TaskCreditMutation = { applied: boolean; credits: number; reservedCredits: number };

function creditAmount(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name}必须是非负整数`);
  return value;
}

/** All task billing transitions lock in the same order: task, then its account.
 * Call inside the transaction that also changes the task state / saves its output.
 * The ledger, rather than the account's total frozen balance, owns reservations.
 */
export async function lockTaskCredits(tx: Prisma.TransactionClient, taskId: string, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "GenerationTask" WHERE "id" = ${taskId} AND "userId" = ${userId} FOR UPDATE`;
  const task = await tx.generationTask.findFirst({ where: { id: taskId, userId } });
  if (!task) throw new Error("任务不存在");
  await tx.$queryRaw`SELECT "id" FROM "CreditAccount" WHERE "userId" = ${userId} FOR UPDATE`;
  const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId } });
  const ledger = await tx.creditTransaction.findMany({
    where: { taskId, userId, type: { in: ["freeze", "refund", "consume"] } },
    select: { type: true, amount: true }
  });
  let reservedCredits = 0;
  let consumedCredits = 0;
  for (const entry of ledger) {
    if (entry.type === "freeze") reservedCredits -= entry.amount;
    if (entry.type === "refund") reservedCredits -= entry.amount;
    if (entry.type === "consume") {
      consumedCredits -= entry.amount;
      reservedCredits += entry.amount;
    }
  }
  // Historical failed jobs may already have duplicate refund entries. Never
  // interpret them as a claim on a different task's remaining frozen credits.
  return { task, account, reservedCredits: Math.max(0, reservedCredits), consumedCredits, ledgerBalance: reservedCredits };
}

export async function reserveTaskCredits(tx: Prisma.TransactionClient, input: TaskCreditInput): Promise<TaskCreditMutation> {
  const { task, account, reservedCredits, consumedCredits, ledgerBalance } = await lockTaskCredits(tx, input.taskId, input.userId);
  let estimate = creditAmount(task.estimatedCredits, "预估积分");
  if (task.status === "succeeded" || task.finalCredits !== null || consumedCredits > 0) {
    throw new Error("已结算任务不能再次冻结积分");
  }
  if (task.billingDiscountPercent === null) {
    // Preserve existing reservations at their original price across this rollout.
    const membership = reservedCredits === 0 ? await activeMembership(tx, input.userId) : null;
    await tx.generationTask.update({ where: { id: task.id }, data: {
      billingDiscountPercent: membership?.discountPercent ?? 0,
      queuePriority: membershipQueuePriority(membership?.priorityLevel ?? 0)
    } });
  }
  if (!task.billingQuote && reservedCredits === 0) {
    const price = await tx.modelPrice.findFirst({ where: { providerId: task.provider, model: task.model, enabled: true } });
    const rule = readCostRule(price?.billing);
    const policy = await creditPolicy(tx);
    const membership = await activeMembership(tx, input.userId);
    // With automatic costs + margin protection, membership savings are limited
    // by the cost floor. Manual prices retain their existing membership benefit.
    const discountPercent = rule && policy.protectMargin ? 0 : membership?.discountPercent ?? 0;
    estimate = discountedCredits(task.estimatedCredits, discountPercent);
    const payload = task.requestPayload as { billingInput?: BillingUsage } | null;
    let estimatedUsage = payload?.billingInput;
    if (!estimatedUsage && rule && rule.kind !== "tokens") {
      const sampleCredits = calculateOfficialCredits(rule, officialSampleUsage(rule), policy).listCredits;
      const quantity = sampleCredits ? Math.max(1, Math.floor(task.estimatedCredits / sampleCredits)) : 0;
      estimatedUsage = rule.kind === "image" ? { images: quantity } : rule.kind === "second" ? { seconds: quantity } : undefined;
    }
    const quote: TaskBillingQuote = { version: 1, mode: rule ? "official" : "manual", rule,
      policy, model: task.model, provider: task.provider, maximumCredits: estimate,
      listCredits: task.estimatedCredits, payableCredits: estimate, discountPercent, estimatedUsage, quotedAt: new Date().toISOString() };
    await tx.generationTask.update({ where: { id: task.id }, data: {
      billingQuote: JSON.parse(JSON.stringify(quote)), billingDiscountPercent: discountPercent
    } });
  } else if (task.billingQuote) estimate = (task.billingQuote as unknown as TaskBillingQuote).maximumCredits;
  if (ledgerBalance < 0) throw new Error("历史任务退款记录异常，请联系管理员核对后重试");
  const credits = Math.max(0, estimate - reservedCredits);
  if (!credits) return { applied: false, credits: 0, reservedCredits };
  if (account.balance - account.frozenBalance < credits) throw new Error("积分余额不足");
  await tx.creditAccount.update({ where: { userId: input.userId }, data: { frozenBalance: { increment: credits } } });
  await tx.creditTransaction.create({ data: {
    id: `tx_${crypto.randomUUID()}`, userId: input.userId, projectId: task.projectId, taskId: task.id,
    type: "freeze", amount: -credits, balanceAfter: account.balance,
    description: input.description ?? "生成任务冻结积分"
  } });
  return { applied: true, credits, reservedCredits: reservedCredits + credits };
}

export async function settleTaskCredits(
  tx: Prisma.TransactionClient,
  input: TaskCreditInput & { finalCredits?: number }
): Promise<TaskCreditMutation> {
  const { task, account, reservedCredits, consumedCredits } = await lockTaskCredits(tx, input.taskId, input.userId);
  if (["succeeded", "canceled", "refunded", "failed"].includes(task.status) || task.finalCredits !== null || consumedCredits > 0) {
    return { applied: false, credits: 0, reservedCredits };
  }
  const baseCredits = creditAmount(input.finalCredits ?? task.estimatedCredits, "结算积分");
  const quote = task.billingQuote as unknown as TaskBillingQuote | null;
  const meter = task.billingUsage as { calls?: Array<{ usage: BillingUsage; provider: string; model: string; delivered: boolean; attemptId?: string }> } | null;
  const calls = meter?.calls ?? [];
  const matched = calls.filter(call => call.provider === (quote?.provider ?? task.provider) && call.model === (quote?.model ?? task.model));
  const delivered = matched.filter(call => call.delivered && (!input.attemptId || call.attemptId === input.attemptId)).map(call => call.usage);
  const outputUsage = quote?.estimatedUsage && baseCredits > 0 ? Object.fromEntries(Object.entries(quote.estimatedUsage).map(([key, value]) =>
    [key, typeof value === "number" ? Math.floor(value * baseCredits / Math.max(1, task.estimatedCredits)) : value])) as BillingUsage : undefined;
  const billable = delivered.length ? delivered : outputUsage ? [outputUsage] : [];
  const measured = quote?.rule && billable.length ? calculateOfficialBatchCredits(quote.rule, billable, quote.policy, quote.discountPercent) : null;
  const allCost = quote?.rule && matched.length ? calculateOfficialBatchCredits(quote.rule, matched.map(call => call.usage), quote.policy).costMicros : measured?.costMicros ?? null;
  const discounted = discountedCredits(baseCredits, quote?.discountPercent ?? task.billingDiscountPercent ?? 0);
  const calculated = baseCredits === 0 ? 0 : measured?.payableCredits ?? discounted;
  if (!quote && baseCredits > reservedCredits) throw new Error("任务冻结积分不足，不能结算");
  const credits = quote ? Math.min(calculated, quote.maximumCredits) : calculated;
  if (credits > reservedCredits) throw new Error("任务冻结积分不足，不能结算");
  if (account.frozenBalance < reservedCredits || account.balance < credits) throw new Error("账户积分账目异常，请联系管理员核对");
  await ensureFunding(tx, input.userId, account.balance);
  const funding = await spendFunding(tx, input.userId, credits);
  await tx.creditAccount.update({ where: { userId: input.userId }, data: {
    frozenBalance: { decrement: reservedCredits }, balance: { decrement: credits }, totalConsume: { increment: credits }
  } });
  if (credits > 0) await tx.creditTransaction.create({ data: {
    id: `tx_${crypto.randomUUID()}`, userId: input.userId, projectId: task.projectId, taskId: task.id,
    type: "consume", amount: -credits, balanceAfter: account.balance - credits,
    description: `${input.description ?? "生成任务正式扣费"}${task.billingDiscountPercent ? `（会员减免 ${task.billingDiscountPercent}%，原价 ${baseCredits} 积分）` : ""}`
  } });
  if (reservedCredits > credits) await tx.creditTransaction.create({ data: {
    id: `tx_${crypto.randomUUID()}`, userId: input.userId, projectId: task.projectId, taskId: task.id,
    type: "refund", amount: reservedCredits - credits, balanceAfter: account.balance - credits,
    description: "任务结算，释放剩余冻结积分"
  } });
  // This marker also makes zero-credit settlements idempotent. The caller must
  // save succeeded + output in this same transaction, so a failure rolls it back.
  await tx.generationTask.update({ where: { id: task.id }, data: {
    finalCredits: credits,
    billingSettlement: JSON.parse(JSON.stringify({ version: 1, chargedCredits: credits,
      releasedCredits: reservedCredits - credits, calculatedCredits: calculated, capped: calculated > credits,
      costMicros: allCost, costStatus: allCost === null ? "unverified" : matched.length ? "usage_derived" : "output_quantity",
      usage: billable.reduce((sum, u) => ({ ...sum, ...u, inputTokens: (sum.inputTokens ?? 0) + (u.inputTokens ?? 0), outputTokens: (sum.outputTokens ?? 0) + (u.outputTokens ?? 0), cachedInputTokens: (sum.cachedInputTokens ?? 0) + (u.cachedInputTokens ?? 0) }), {} as BillingUsage),
      routeMismatch: calls.length !== matched.length, funding }))
  } });
  return { applied: true, credits, reservedCredits: 0 };
}

export async function releaseTaskCredits(tx: Prisma.TransactionClient, input: TaskCreditInput): Promise<TaskCreditMutation> {
  const { task, account, reservedCredits } = await lockTaskCredits(tx, input.taskId, input.userId);
  if (!reservedCredits) return { applied: false, credits: 0, reservedCredits: 0 };
  if (account.frozenBalance < reservedCredits) throw new Error("账户冻结积分与任务账目不一致，请联系管理员核对");
  await tx.creditAccount.update({ where: { userId: input.userId }, data: { frozenBalance: { decrement: reservedCredits } } });
  await tx.creditTransaction.create({ data: {
    id: `tx_${crypto.randomUUID()}`, userId: input.userId, projectId: task.projectId, taskId: task.id,
    type: "refund", amount: reservedCredits, balanceAfter: account.balance,
    description: input.description ?? "任务结束，释放未消耗的冻结积分"
  } });
  const quote = task.billingQuote as unknown as TaskBillingQuote | null;
  const meter = task.billingUsage as { calls?: Array<{ usage: BillingUsage; provider: string; model: string }> } | null;
  const calls = (meter?.calls ?? []).filter(c => c.provider === quote?.provider && c.model === quote?.model);
  const cost = quote?.rule && calls.length ? calculateOfficialBatchCredits(quote.rule, calls.map(c => c.usage), quote.policy).costMicros : null;
  if (quote) await tx.generationTask.update({ where: { id: task.id }, data: {
    billingSettlement: { version: 1, chargedCredits: 0, releasedCredits: reservedCredits, costMicros: cost,
      costStatus: cost === null ? "unverified" : "usage_derived" }
  } });
  return { applied: true, credits: reservedCredits, reservedCredits: 0 };
}
