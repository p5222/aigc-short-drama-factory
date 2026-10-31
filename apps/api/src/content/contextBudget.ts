import type { ContextManifest } from "@aifilm/shared";

export interface ContextSource { id: string; label: string; content: unknown; required: boolean; priority?: number }
// UTF-8 bytes form a conservative bound for common byte-level tokenizers.
// This is deliberately not presented as measured provider usage.
export function estimateContextTokens(value: string): number { return Buffer.byteLength(value, "utf8"); }

export function assembleContext(sources: ContextSource[], options: { budgetTokens?: number; reservedOutputTokens?: number; safetyTokens?: number } = {}) {
  const budgetTokens = options.budgetTokens ?? 32000, reservedOutputTokens = options.reservedOutputTokens ?? 5000, safetyTokens = options.safetyTokens ?? 1500;
  const ordered = sources.map((source, order) => ({ ...source, order, text: typeof source.content === "string" ? source.content : JSON.stringify(source.content) }))
    .sort((a, b) => Number(b.required) - Number(a.required) || (b.priority ?? 0) - (a.priority ?? 0) || a.order - b.order);
  let used = 0;
  const selected: Record<string, unknown> = {};
  const manifest: ContextManifest = { estimator: "utf8_upper_bound_v1", budgetTokens, estimatedInputTokens: 0, reservedOutputTokens, safetyTokens, sources: [] };
  for (const item of ordered) {
    const tokens = estimateContextTokens(`${item.id}: ${item.text}\n`);
    const included = used + tokens + reservedOutputTokens + safetyTokens <= budgetTokens;
    if (item.required && !included) throw new Error(`必需资料「${item.label}」超过本步上下文预算。请缩小当前素材范围；已锁定设定不会被静默删除。`);
    manifest.sources.push({ id: item.id, label: item.label, required: item.required, estimatedTokens: tokens, included });
    if (included) { selected[item.id] = item.content; used += tokens; }
  }
  manifest.estimatedInputTokens = used;
  return { selected, manifest };
}
