import type { CreditTransaction, GenerationTask } from "./index.js";
import type { BillingUsage, CreditPolicy, OfficialCostRule } from "./creditPricing.js";
export interface CreditPage<T> { items: T[]; total: number; page: number; pageSize: number }
export interface CreditPricingOverview {
  policy: CreditPolicy; effectivePolicy: CreditPolicy; version: number;
  prices: Array<{ id: string; providerId: string | null; providerName: string; model: string; modality: string; unitCredits: number; enabled: boolean; billing: OfficialCostRule | null; updatedAt: string; officialCandidate: OfficialCostRule | null }>;
  plans: Array<{ id: string; name: string; price: number; credits: number; bonusCredits: number; enabled: boolean; cashValueMicros: number | null }>;
  memberships: Array<{ id: string; name: string; monthlyPrice: number; monthlyCredits: number; discountPercent: number; enabled: boolean }>;
  catalog: OfficialCostRule[]; warnings: string[];
}
export interface CreditAccountRow {
  userId: string; name: string; email: string | null; balance: number; frozenBalance: number;
  available: number; totalRecharge: number; totalConsume: number; consumeLedger: number; anomaly: boolean;
  frozenLedger: number; fundedBalance: number; unclassifiedBalance: number;
}
export interface CreditFundingRow {
  id: string; userId: string; source: string; originalCredits: number; remainingCredits: number; cashMicros: number | null; referenceId: string | null; createdAt: string;
}
export interface BillingSettlement {
  chargedCredits?: number; releasedCredits?: number; calculatedCredits?: number; capped?: boolean;
  costMicros?: number | null; costStatus?: string; invoiceReference?: string; routeMismatch?: boolean;
  usage?: BillingUsage; funding?: { cashMicros: number; unknownCredits: number; giftCredits: number; allocations: unknown[] };
}
export type CreditBillingTask = GenerationTask & { userId: string; settlement?: BillingSettlement | null; metering?: unknown };
export type CreditLedgerPage = CreditPage<CreditTransaction>;
