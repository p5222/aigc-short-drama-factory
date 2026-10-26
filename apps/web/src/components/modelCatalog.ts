import type { ModelModality, ModelPrice, ModelProvider } from "@aifilm/shared";
import { inspectModelPrice } from "@aifilm/shared";

export type ModelFamily = "openai" | "deepseek" | "qwen" | "wan" | "gemini" | "claude" | "seed" | "kling" | "flux" | "minimax" | "kimi" | "generic";
export type ModelState = "configured" | "unknown" | "disabled" | "missing_key" | "cooling" | "limited" | "missing_price" | "price_conflict" | "invalid_price";
export interface CatalogModel {
  key: string;
  model: string;
  name: string;
  family: ModelFamily;
  provider: ModelProvider;
  price?: ModelPrice;
  state: ModelState;
  selectable: boolean;
  statusLabel: string;
  description: string;
  issues: string[];
  tags: string[];
  preferred: boolean;
}

export const modalityNames: Record<ModelModality, string> = {
  text: "文本", image: "图像", video: "视频", tts: "配音", embedding: "向量"
};
const purposes: Record<ModelModality, string> = {
  text: "剧本解析、故事结构与分镜文字",
  image: "角色、场景、道具与分镜画面",
  video: "镜头片段与动态画面",
  tts: "台词、旁白与语音合成",
  embedding: "内容检索与语义匹配"
};
const stateLabels: Record<ModelState, string> = {
  configured: "配置齐全", unknown: "连接待确认", disabled: "已停用", missing_key: "待配置",
  cooling: "冷却中", limited: "额度暂不可用", missing_price: "未配置价格", price_conflict: "价格配置冲突", invalid_price: "价格配置无效"
};
const stateDescriptions: Partial<Record<ModelState, string>> = {
  unknown: "连接状态尚未确认，实际调用时由服务器校验。",
  disabled: "渠道已停用，请选择其他渠道或联系管理员。",
  missing_key: "渠道尚未配置发起调用所需的服务端密钥。",
  cooling: "该模型暂时处于冷却期，请稍后刷新或选择其他模型。",
  limited: "该模型的可提交额度暂不可用，请选择其他模型。",
  missing_price: "当前渠道与模型没有启用的价格策略。",
  price_conflict: "当前渠道与模型存在多条启用价格，请联系管理员核对。",
  invalid_price: "计费单位与模型类型不匹配，或积分单价无效，请联系管理员核对。"
};

export function modelRouteKey(providerId: string, model: string): string {
  return JSON.stringify([providerId, model]);
}

/** Identify the model itself, never a relay's generic name. Unknown IDs remain explicit. */
export function modelIdentity(model: string | null | undefined): { family: ModelFamily; name: string } {
  const id = model?.trim() ?? "";
  const leaf = id.includes("/") ? id.split("/").at(-1)! : id;
  const patterns: Array<[RegExp, ModelFamily, string]> = [
    [/^deepseek[-_]?/i, "deepseek", "DeepSeek "],
    [/^gpt[-_]?/i, "openai", "GPT "],
    [/^o(?=\d)/i, "openai", "o"],
    [/^qwen[-_]?/i, "qwen", "Qwen "],
    [/^wan(?=[\d._-])/i, "wan", "Wan "],
    [/^gemini[-_]?/i, "gemini", "Gemini "],
    [/^claude[-_]?/i, "claude", "Claude "],
    [/^(?:seedance|seedream|doubao)[-_]?/i, "seed", (leaf.match(/^(seedance|seedream|doubao)/i)?.[0] ?? "Seed").replace(/^./, c => c.toUpperCase()) + " "],
    [/^kling[-_]?/i, "kling", "Kling "],
    [/^flux[-_]?/i, "flux", "FLUX "],
    [/^(?:minimax|hailuo)[-_]?/i, "minimax", "MiniMax "],
    [/^kimi[-_]?/i, "kimi", "Kimi "]
  ];
  for (const [pattern, family, prefix] of patterns) {
    if (!pattern.test(leaf)) continue;
    const suffix = leaf.replace(pattern, "")
      .split(/[-_]/).map(word => /^\d{4}$/.test(word) ? word : word.replace(/^./, c => c.toUpperCase())).join(" ");
    return { family, name: `${prefix}${suffix}`.trim() };
  }
  return { family: "generic", name: id || "未选择模型" };
}

export function modelCapabilityTags(provider: ModelProvider): string[] {
  const capability = provider.capability;
  return [
    modalityNames[provider.modality],
    capability?.supportsReferenceImage ? "参考图" : "",
    capability?.supportsImageToImage ? "图像编辑" : "",
    capability?.supportsImageToVideo ? "图生视频" : "",
    capability?.supportsSeed ? "固定随机种子" : ""
  ].filter(Boolean);
}

/** Strict route matching mirrors production billing. Never borrow another route's price. */
export function routePrices(prices: ModelPrice[] | undefined, provider: Pick<ModelProvider, "id" | "modality">, model: string): ModelPrice[] {
  return (prices ?? []).filter(price => price.enabled && price.providerId === provider.id && price.modality === provider.modality && price.model === model);
}

export function modelPriceLabel(price?: ModelPrice): string {
  if (!price) return "报价时确认";
  const units: Record<ModelPrice["unit"], string> = {
    text_run: "次", image: "张", image2: "张", video_second: "秒", tts_character: "字", export: "次导出"
  };
  return `${price.unitCredits.toLocaleString("zh-CN")} 积分/${units[price.unit] ?? price.unit}`;
}

export function buildModelCatalog(providers: ModelProvider[], prices?: ModelPrice[]): CatalogModel[] {
  return providers.flatMap(provider => [...new Set(provider.models.map(model => model.trim()).filter(Boolean))].map(model => {
    const pricing = inspectModelPrice(prices ?? [], { providerId: provider.id, modality: provider.modality, model });
    const quota = provider.routing?.quotaStatus?.find(item => item.model === model);
    const priceState: ModelState | undefined = prices === undefined || pricing.state === "ready" ? undefined
      : pricing.state === "missing" ? "missing_price" : pricing.state === "conflict" ? "price_conflict" : "invalid_price";
    const issues = [
      provider.apiKeyConfigured === false ? "missing_key" : undefined,
      quota?.coolingDown ? "cooling" : quota?.available === false ? "limited" : undefined,
      priceState
    ].filter((state): state is ModelState => Boolean(state)).map(state => stateLabels[state]);
    const state: ModelState = !provider.enabled ? "disabled"
      : provider.apiKeyConfigured === false ? "missing_key"
      : quota?.coolingDown ? "cooling"
      : quota?.available === false ? "limited"
      : priceState ?? (provider.apiKeyConfigured === true ? "configured" : "unknown");
    return {
      key: modelRouteKey(provider.id, model), model, ...modelIdentity(model), provider,
      price: pricing.price, issues,
      state, selectable: state === "configured" || state === "unknown",
      statusLabel: stateLabels[state], description: stateDescriptions[state] ?? purposes[provider.modality],
      tags: modelCapabilityTags(provider), preferred: provider.routing?.preferredModel === model
    };
  }));
}

export function searchModelCatalog(items: CatalogModel[], query: string): CatalogModel[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    const text = `${item.name} ${item.model} ${item.provider.name} ${item.provider.id} ${item.tags.join(" ")} ${item.statusLabel} ${item.issues.join(" ")}`.toLowerCase();
    return terms.every(term => text.includes(term));
  });
}

export function defaultModelRoute(providers: ModelProvider[], modality: ModelModality, prices?: ModelPrice[]): { providerId: string; model: string } {
  const items = buildModelCatalog(providers.filter(provider => provider.modality === modality), prices).filter(item => item.selectable);
  const item = items.find(item => item.preferred) ?? items[0];
  return { providerId: item?.provider.id ?? "", model: item?.model ?? "" };
}

export function parseModelPreferences(raw: string | null): { favorites: string[]; recent: string[] } {
  try {
    const value = JSON.parse(raw ?? "{}");
    const safeList = (list: unknown) => Array.isArray(list)
      ? [...new Set(list.filter((key): key is string => typeof key === "string" && key.length <= 500))].slice(0, 64) : [];
    return { favorites: safeList(value?.favorites), recent: safeList(value?.recent).slice(0, 8) };
  } catch { return { favorites: [], recent: [] }; }
}
