import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";

/** Caller holds the account lock. Historical unexplained balance has no invented cash value. */
export async function ensureFunding(tx: Prisma.TransactionClient, userId: string, balance: number) {
  const result = await tx.creditFundingLot.aggregate({ where: { userId }, _sum: { remainingCredits: true } });
  const difference = balance - (result._sum.remainingCredits ?? 0);
  if (difference < 0) throw new Error("资金批次与余额不一致，请先核对账务");
  if (difference > 0) await grantFunding(tx, { userId, credits: difference, source: "legacy_unknown" });
}
export async function grantFunding(tx: Prisma.TransactionClient, input: { userId: string; credits: number; source: string; cashMicros?: number; referenceId?: string }) {
  if (!Number.isSafeInteger(input.credits) || input.credits < 0 || input.credits > 2147483647 ||
    (input.cashMicros !== undefined && (!Number.isSafeInteger(input.cashMicros) || input.cashMicros < 0))) throw new Error("资金批次积分或实收金额无效");
  if (!input.credits) return;
  await tx.creditFundingLot.create({ data: {
    id: `fund_${crypto.randomUUID()}`, userId: input.userId, source: input.source,
    originalCredits: input.credits, remainingCredits: input.credits,
    cashMicros: input.cashMicros === undefined ? null : BigInt(input.cashMicros), referenceId: input.referenceId
  } });
}
export async function spendFunding(tx: Prisma.TransactionClient, userId: string, credits: number) {
  const lots = await tx.creditFundingLot.findMany({ where: { userId, remainingCredits: { gt: 0 } }, orderBy: { sequence: "asc" } });
  let remaining = credits, cashMicros = 0, unknownCredits = 0, giftCredits = 0;
  const allocations: Array<{ lotId: string; credits: number; source: string; cashMicros: number | null }> = [];
  for (const lot of lots) {
    if (!remaining) break;
    const used = Math.min(lot.remainingCredits, remaining);
    // Difference of cumulative allocations conserves every micro-CNY on the final credit.
    const spent = lot.originalCredits - lot.remainingCredits;
    const cash = lot.cashMicros === null ? null : Number(lot.cashMicros * BigInt(spent + used) / BigInt(lot.originalCredits) - lot.cashMicros * BigInt(spent) / BigInt(lot.originalCredits));
    await tx.creditFundingLot.update({ where: { id: lot.id }, data: { remainingCredits: { decrement: used } } });
    remaining -= used;
    if (cash === null) unknownCredits += used;
    else { cashMicros += cash; if (lot.source === "gift") giftCredits += used; }
    allocations.push({ lotId: lot.id, credits: used, source: lot.source, cashMicros: cash });
  }
  if (remaining) throw new Error("资金批次不足，交易已回滚");
  return { cashMicros, unknownCredits, giftCredits, allocations };
}
