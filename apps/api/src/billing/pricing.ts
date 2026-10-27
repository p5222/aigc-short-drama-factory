import type { Prisma } from "@prisma/client";
import { calculateOfficialCredits, defaultCreditPolicy, officialSampleUsage, validateCostRule, validateCreditPolicy, type BillingUsage, type CreditPolicy, type OfficialCostRule } from "@aifilm/shared";
import { prisma } from "../db/client.js";

export type PricingDb = Pick<Prisma.TransactionClient, "creditPricingPolicy" | "plan" | "membershipPlan" | "$queryRaw">;
export async function creditPolicy(db: PricingDb = prisma): Promise<CreditPolicy> {
  const row = await db.creditPricingPolicy.findUnique({ where: { id: "global" } });
  const policy = row ? row.policy as unknown as CreditPolicy : { ...defaultCreditPolicy };
  validateCreditPolicy(policy);
  // Current offers and unspent verified paid lots both affect cash value:
  // disabling or repricing an offer must not hide its cheaper existing credits.
  // Gift and historical unknown balances remain separate accounting.
  const plans = await db.plan.findMany({ where: { enabled: true } });
  const values = plans.filter(p => p.price > 0 && p.credits + p.bonusCredits > 0)
    .map(p => Math.max(1, Math.floor(Math.round(p.price * 100) * 10000 / (p.credits + p.bonusCredits))));
  const members = await db.membershipPlan.findMany({ where: { enabled: true } });
  values.push(...members.filter(p => p.monthlyPrice > 0 && p.monthlyCredits > 0)
    .map(p => Math.max(1, Math.floor(Math.round(p.monthlyPrice * 100) * 10000 / p.monthlyCredits))));
  if (policy.protectMargin) {
    const [paid] = await db.$queryRaw<Array<{ value: bigint | null }>>`
      SELECT MIN("cashMicros" / "originalCredits") AS "value"
      FROM "CreditFundingLot"
      WHERE "source" = 'paid' AND "remainingCredits" > 0
        AND "originalCredits" > 0 AND "cashMicros" IS NOT NULL`;
    if (paid?.value !== null && paid?.value !== undefined) {
      if (paid.value < 1n) throw new Error("付费积分批次的实收价值过低，请先核对资金或关闭毛利保护");
      values.push(Number(paid.value > BigInt(policy.creditValueMicros) ? BigInt(policy.creditValueMicros) : paid.value));
    }
  }
  return { ...policy, creditValueMicros: policy.protectMargin ? Math.min(policy.creditValueMicros, ...values) : policy.creditValueMicros };
}
export function readCostRule(billing: unknown): OfficialCostRule | undefined {
  if (!billing || typeof billing !== "object") return undefined;
  const rule = billing as OfficialCostRule;
  validateCostRule(rule);
  return rule;
}
export async function quotePrice(price: { billing?: unknown; unitCredits: number }, usage?: BillingUsage, db: PricingDb = prisma) {
  const rule = readCostRule(price.billing);
  if (!rule) return price.unitCredits;
  return calculateOfficialCredits(rule, usage ?? officialSampleUsage(rule), await creditPolicy(db)).payableCredits;
}
