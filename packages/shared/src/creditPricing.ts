/** Currency uses millionths of CNY. Round credits only after summing a request. */
export interface CreditPolicy {
  version: number;
  targetMarginBps: number;
  creditValueMicros: number;
  usdCnyMicros: number | null;
  overheadBps: number;
  protectMargin: boolean;
}
export const defaultCreditPolicy: CreditPolicy = {
  version: 1, targetMarginBps: 4000, creditValueMicros: 10000,
  usdCnyMicros: null, overheadBps: 0, protectMargin: true
};
export interface BillingUsage {
  inputTokens?: number; outputTokens?: number; cachedInputTokens?: number;
  images?: number; seconds?: number; characters?: number; resolution?: string;
}
export interface OfficialCostRule {
  version: 1;
  currency: "CNY" | "USD";
  kind: "tokens" | "image" | "second" | "character";
  /** Millionths of currency per million tokens, image, second or 10,000 characters. */
  inputMicros?: number; cachedInputMicros?: number; outputMicros?: number;
  rateMicros?: number;
  tiers?: Array<{ aboveInputTokens: number; inputMicros: number; outputMicros: number }>;
  resolutionRates?: Record<string, number>;
  sourceUrl: string; verifiedAt: string; region: string; model: string;
}
export interface TaskBillingQuote {
  version: 1; policy: CreditPolicy; rule?: OfficialCostRule;
  mode: "official" | "manual"; model: string; provider: string;
  maximumCredits: number; listCredits: number; payableCredits: number;
  discountPercent: number; quotedAt: string;
  estimatedUsage?: BillingUsage;
}
function integer(value: number, label: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label}必须为有效整数`);
  return BigInt(value);
}
function ceil(n: bigint, d: bigint) { return (n + d - 1n) / d; }
function safe(n: bigint) {
  if (n > 2147483647n) throw new Error("积分或金额超出支持范围，请拆分任务");
  return Number(n);
}
export function validateCreditPolicy(policy: CreditPolicy) {
  integer(policy.version, "政策版本", 1);
  integer(policy.creditValueMicros, "每积分价值", 1);
  integer(policy.targetMarginBps, "毛利率");
  integer(policy.overheadBps, "运营费用");
  if (policy.targetMarginBps >= 10000 || policy.overheadBps > 10000) throw new Error("毛利率必须低于100%，运营费用不超过100%");
  if (policy.usdCnyMicros !== null) integer(policy.usdCnyMicros, "美元结算汇率", 1);
  if (typeof policy.protectMargin !== "boolean") throw new Error("毛利保护配置无效");
  return policy;
}
export function validateCostRule(rule: OfficialCostRule, policy?: CreditPolicy) {
  if (rule.version !== 1 || !["CNY", "USD"].includes(rule.currency) || !["tokens", "image", "second", "character"].includes(rule.kind)) throw new Error("官方成本规则无效");
  if (!rule.model.trim() || !rule.region.trim() || !Number.isFinite(Date.parse(rule.verifiedAt))) throw new Error("请填写模型、地域和核验时间");
  const url = new URL(rule.sourceUrl);
  if (url.protocol !== "https:") throw new Error("成本来源必须使用HTTPS");
  for (const field of ["inputMicros", "cachedInputMicros", "outputMicros", "rateMicros"] as const) {
    if (rule[field] !== undefined) integer(rule[field]!, "成本费率");
  }
  if (rule.kind === "tokens" && (rule.inputMicros === undefined || rule.outputMicros === undefined)) throw new Error("文本必须填写输入、输出成本");
  if (rule.kind !== "tokens" && rule.rateMicros === undefined) throw new Error("必须填写单位成本");
  let previous = -1;
  for (const tier of rule.tiers ?? []) {
    integer(tier.aboveInputTokens, "阶梯阈值"); integer(tier.inputMicros, "输入成本"); integer(tier.outputMicros, "输出成本");
    if (tier.aboveInputTokens <= previous) throw new Error("阶梯阈值必须递增");
    previous = tier.aboveInputTokens;
  }
  for (const value of Object.values(rule.resolutionRates ?? {})) integer(value, "规格成本");
  if (policy && rule.currency === "USD" && !policy.usdCnyMicros) throw new Error("美元计费需要先配置结算汇率");
  return rule;
}
/** Returns a rational number of micro-CNY, avoiding per-token rounding. */
function costFraction(rule: OfficialCostRule, usage: BillingUsage, policy: CreditPolicy): [bigint, bigint] {
  validateCreditPolicy(policy); validateCostRule(rule, policy);
  let n = 0n, d = 1n;
  if (rule.kind === "tokens") {
    const input = integer(usage.inputTokens ?? 0, "输入Token"), output = integer(usage.outputTokens ?? 0, "输出Token");
    const cached = integer(usage.cachedInputTokens ?? 0, "缓存Token");
    if (cached > input) throw new Error("缓存Token不能大于输入Token");
    const tier = [...(rule.tiers ?? [])].reverse().find(t => input > BigInt(t.aboveInputTokens));
    const inRate = BigInt(tier?.inputMicros ?? rule.inputMicros!);
    n = (input - cached) * inRate + cached * BigInt(rule.cachedInputMicros ?? Number(inRate)) + output * BigInt(tier?.outputMicros ?? rule.outputMicros!);
    d = 1000000n;
  } else {
    if (rule.resolutionRates && usage.resolution && !(usage.resolution in rule.resolutionRates)) throw new Error("当前分辨率未配置官方成本，不能计价");
    const amount = rule.kind === "image" ? usage.images : rule.kind === "second" ? usage.seconds : usage.characters;
    n = integer(amount ?? 0, "用量") * BigInt(rule.resolutionRates?.[usage.resolution ?? ""] ?? rule.rateMicros!);
    d = rule.kind === "character" ? 10000n : 1n;
  }
  if (rule.currency === "USD") { n *= BigInt(policy.usdCnyMicros!); d *= 1000000n; }
  return [n, d];
}
export function calculateOfficialCredits(rule: OfficialCostRule, usage: BillingUsage, policy: CreditPolicy, discountPercent = 0) {
  return calculateOfficialBatchCredits(rule, [usage], policy, discountPercent);
}
export function calculateOfficialBatchCredits(rule: OfficialCostRule, usages: BillingUsage[], policy: CreditPolicy, discountPercent = 0) {
  const discount = integer(discountPercent, "折扣");
  if (discount > 100n) throw new Error("会员减免不能超过100%");
  let costN = 0n, costD = 1n;
  for (const usage of usages) {
    const [n, d] = costFraction(rule, usage, policy);
    // All usages of a rule share a denominator; keep a common denominator.
    if (costN === 0n) { costN = n; costD = d; }
    else if (d === costD) costN += n;
    else { costN = costN * d + n * costD; costD *= d; }
  }
  const priceN = costN * BigInt(10000 + policy.overheadBps) * 10000n;
  const priceD = costD * 10000n * BigInt(10000 - policy.targetMarginBps) * BigInt(policy.creditValueMicros);
  const minimum = ceil(priceN, priceD);
  // Margin protection displays a higher list price, then applies the membership
  // benefit, instead of silently ignoring a promised discount at settlement.
  if (policy.protectMargin && discount === 100n && costN > 0n) throw new Error("100%减免不能同时保证毛利");
  const list = policy.protectMargin && discount < 100n ? ceil(priceN * 100n, priceD * (100n - discount)) : minimum;
  const payable = ceil(list * (100n - discount), 100n);
  return {
    costMicros: Number(ceil(costN, costD)), listCredits: safe(list), payableCredits: safe(payable),
    minimumCredits: safe(minimum),
    marginBps: payable === 0n ? null : Number((payable * BigInt(policy.creditValueMicros) * costD - costN) * 10000n / (payable * BigInt(policy.creditValueMicros) * costD))
  };
}
export function officialSampleUsage(rule: OfficialCostRule): BillingUsage {
  return rule.kind === "tokens" ? { inputTokens: 8000, outputTokens: 16000 }
    : rule.kind === "image" ? { images: 1 } : rule.kind === "second" ? { seconds: 1 } : { characters: 10000 };
}
/** unitCredits is a reference quantity in automatic mode, not a per-character rate. */
export function creditPriceUnit(price: { unit: string; billing?: OfficialCostRule | null }) {
  if (price.billing?.kind === "character") return "万字符";
  if (price.billing?.kind === "tokens") return "参考次（8千输入 / 1.6万输出Token）";
  const labels: Record<string, string> = { text_run: "次", image: "张", image2: "张", video_second: "秒", tts_character: "字符", export: "次导出" };
  return labels[price.unit] ?? price.unit;
}
export const verifiedOfficialCosts: OfficialCostRule[] = [
  { model: "qwen3.7-plus", kind: "tokens", inputMicros: 2000000, outputMicros: 8000000,
    tiers: [{ aboveInputTokens: 262144, inputMicros: 6000000, outputMicros: 24000000 }] },
  ...["qwen-image-2.0-pro", "qwen-image-2.0-pro-2026-04-22", "qwen-image-2.0-pro-2026-06-22"].map(model => ({ model, kind: "image" as const, rateMicros: 500000 })),
  ...["qwen-image-2.0", "qwen-image-2.0-2026-03-03"].map(model => ({ model, kind: "image" as const, rateMicros: 200000 })),
  { model: "wanx2.1-i2v-turbo", kind: "second", rateMicros: 240000, resolutionRates: { "480P": 240000, "720P": 240000 } },
  { model: "wanx2.1-i2v-plus", kind: "second", rateMicros: 700000, resolutionRates: { "720P": 700000 } },
  ...["wan2.7-i2v", "wan2.7-i2v-2026-04-25"].map(model => ({ model, kind: "second" as const, rateMicros: 600000, resolutionRates: { "720P": 600000, "1080P": 1000000 } })),
  { model: "qwen3-tts-flash", kind: "character", rateMicros: 800000 }
].map(rule => ({ ...rule, version: 1, currency: "CNY", region: "cn-beijing", sourceUrl: "https://help.aliyun.com/zh/model-studio/model-pricing", verifiedAt: "2026-10-26T00:00:00.000Z" } as OfficialCostRule));
