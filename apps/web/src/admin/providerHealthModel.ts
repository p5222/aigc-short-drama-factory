import { inspectModelPrice, type ModelPrice, type ModelProvider } from "@aifilm/shared";
import { buildModelCatalog, providerModelFamily } from "../components/modelCatalog.ts";

export function providerHealth(provider: ModelProvider, prices: ModelPrice[]) {
  const models = buildModelCatalog([provider], prices);
  const covered = models.filter(item => inspectModelPrice(prices, { providerId: provider.id, modality: provider.modality, model: item.model }).state === "ready").length;
  const ready = models.filter(item => item.state === "configured").length;
  const issues = [...new Set(models.flatMap(item => item.issues))];
  if (!models.length) issues.push("尚未添加模型");
  if (provider.apiKeyConfigured === undefined) issues.push("密钥状态待确认");
  return {
    provider, models, covered, ready, issues,
    family: providerModelFamily(provider.models),
    needsAttention: provider.enabled && (ready !== models.length || !models.length),
    status: !provider.enabled ? "已停用" : !models.length ? "尚未添加模型" : ready === models.length ? "配置齐全" : "需要处理"
  };
}

/** A matching name is never sufficient for a route to be billable. */
export function inspectAdminPrice(price: ModelPrice, providers: ModelProvider[], prices: ModelPrice[]) {
  const provider = providers.find(item => item.id === price.providerId && item.modality === price.modality && item.models.some(model => model.trim() === price.model));
  if (!provider) return { state: "orphan", label: "无模型关联", detail: "渠道 ID、类型和模型必须同时匹配" };
  if (!price.enabled) return { state: "disabled", label: "已停用", detail: "不参与新任务报价" };
  const result = inspectModelPrice(prices, { providerId: provider.id, modality: provider.modality, model: price.model });
  if (result.state !== "ready") return { state: result.state, label: result.state === "conflict" ? "价格冲突" : "价格无效", detail: result.state === "conflict" ? "同一模型有多条启用价格" : "核对单价和计费单位" };
  if (!provider.enabled) return { state: "disabled_route", label: "渠道停用", detail: "价格已启用，渠道暂不接受新任务" };
  if (provider.apiKeyConfigured !== true) return { state: "missing_key", label: provider.apiKeyConfigured === false ? "渠道未配置" : "连接待确认", detail: "需在模型路由核对密钥" };
  const quota = provider.routing?.quotaStatus?.find(item => item.model === price.model);
  if (quota?.coolingDown || quota?.available === false) return { state: "limited", label: quota.coolingDown ? "模型冷却中" : "额度暂不可用", detail: "价格有效，当前提交需等待额度恢复" };
  return { state: "ready", label: "可参与报价", detail: "配置完整；真实调用与成本需单独核验" };
}

export function groupAdminPrices(prices: ModelPrice[]) {
  const groups = new Map<string, { id: string; provider: string; prices: ModelPrice[]; total: number; enabled: number }>();
  for (const price of prices) {
    const id = price.providerId || `unlinked:${price.providerName}`;
    const group = groups.get(id) ?? { id, provider: price.providerName, prices: [], total: 0, enabled: 0 };
    group.prices.push(price); group.total++; if (price.enabled) group.enabled++;
    groups.set(id, group);
  }
  return [...groups.values()];
}
