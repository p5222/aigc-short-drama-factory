import type { GenerationTask } from "@aifilm/shared";
export function BillingReceipt({ task }: { task: GenerationTask }) {
  const bill = task.billing;
  if (!bill) return null;
  const usage = bill.usage;
  const units = usage ? [usage.inputTokens ? `输入 ${usage.inputTokens} Token` : "", usage.outputTokens ? `输出 ${usage.outputTokens} Token` : "", usage.cachedInputTokens ? `缓存 ${usage.cachedInputTokens} Token` : "", usage.images ? `${usage.images} 张` : "", usage.seconds ? `${usage.seconds} 秒` : "", usage.characters ? `${usage.characters} 字符` : ""].filter(Boolean).join(" · ") : "";
  return <div className="wb-task-hint"><p>原价 {bill.listCredits} · 应付上限 {bill.maximumCredits} 积分{bill.discountPercent ? ` · 会员减免 ${bill.discountPercent}%` : ""}</p>{bill.releasedCredits !== undefined ? <p>已释放冻结 {bill.releasedCredits} 积分</p> : null}{units ? <p>结算用量：{units}</p> : null}<small>{bill.mode === "official" ? "按已确认模型用量计费" : "按已确认固定价格计费"} · 政策版本 {bill.policyVersion}</small></div>;
}
