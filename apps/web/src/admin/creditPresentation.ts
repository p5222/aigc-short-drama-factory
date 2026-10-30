import type { CreditBillingTask, CreditPricingOverview, OfficialCostRule } from "@aifilm/shared";

export type CreditPrice = CreditPricingOverview["prices"][number];
export const creditMoney = (micros: number | null | undefined) => micros == null ? "未核验" : `¥${(micros / 1000000).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
export const creditNumber = (value: number) => value.toLocaleString("zh-CN");
export const creditDate = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN") : "未填写";
export const creditSources: Record<string, string> = { paid: "在线支付", gift: "推广赠送", legacy_unknown: "历史余额 · 实收未知", admin_unknown: "人工入账 · 实收未知", redeem_unknown: "兑换码 · 实收未知", checkout_unverified: "测试支付 · 实收未知" };
export const creditLedgerNames: Record<string, string> = { recharge: "充值入账", consume: "消费扣费", freeze: "冻结积分", refund: "释放冻结", adjust: "后台调整" };
export const creditTaskStates: Record<string, string> = { pending: "排队中", running: "执行中", succeeded: "已完成", failed: "失败", canceled: "已取消", refunded: "已退还", cancelled: "已取消" };
export const creditCostStates: Record<string, string> = { invoice_verified: "账单已核验", usage_derived: "按供应商用量推导", output_quantity: "按交付数量推导" };
export const creditKinds: Record<string, OfficialCostRule["kind"] | undefined> = { text: "tokens", image: "image", video: "second", tts: "character" };
export const creditKindNames = { tokens: "Token 计价", image: "按张计价", second: "按秒计价", character: "按字符计价" };

export function cashMargin(task: CreditBillingTask) {
  const s = task.settlement, f = s?.funding;
  if (s?.costStatus !== "invoice_verified" || s.costMicros == null || !f || f.unknownCredits) return "现金毛利待核验";
  if (!f.cashMicros) return `无消费实收 · API成本 ${creditMoney(s.costMicros)}`;
  return `现金毛利 ${((f.cashMicros - s.costMicros) / f.cashMicros * 100).toFixed(2)}%`;
}
export function initialCreditRule(price: CreditPrice): string {
  if (price.billing || price.officialCandidate) return JSON.stringify(price.billing ?? price.officialCandidate, null, 2);
  const kind = creditKinds[price.modality];
  return kind ? JSON.stringify({ version: 1, currency: "CNY", kind, model: price.model, region: "", verifiedAt: "", sourceUrl: "" }, null, 2) : "";
}
/** Incomplete numeric fields are allowed while editing; malformed JSON never enters the form. */
export function parseCreditRule(text: string): OfficialCostRule {
  let rule: OfficialCostRule;
  try { rule = JSON.parse(text); } catch { throw new Error("JSON 格式不完整，请修正后继续。"); }
  if (!rule || typeof rule !== "object" || Array.isArray(rule) || rule.version !== 1 ||
    !["CNY", "USD"].includes(rule.currency) || !Object.keys(creditKindNames).includes(rule.kind) ||
    !["model", "region", "verifiedAt", "sourceUrl"].every(key => typeof (rule as unknown as Record<string, unknown>)[key] === "string") ||
    !["inputMicros", "outputMicros", "cachedInputMicros", "rateMicros"].every(key => {
      const value = (rule as unknown as Record<string, unknown>)[key]; return value === undefined || typeof value === "number";
    }) ||
    (rule.tiers !== undefined && (!Array.isArray(rule.tiers) || !rule.tiers.every(tier => tier && ["aboveInputTokens", "inputMicros", "outputMicros"].every(key => typeof (tier as unknown as Record<string, unknown>)[key] === "number")))) ||
    (rule.resolutionRates !== undefined && (!rule.resolutionRates || typeof rule.resolutionRates !== "object" || Array.isArray(rule.resolutionRates) || !Object.values(rule.resolutionRates).every(value => typeof value === "number")))) {
    throw new Error("规则结构不正确，请核对版本、币种、计费类型和字段格式。");
  }
  return rule;
}
