import type { ModelModality, ModelPrice, ModelProvider } from "@aifilm/shared";
import { buildModelCatalog, modalityNames } from "./modelCatalog";
import "./production-readiness.css";

type ProductionModality = Extract<ModelModality, "text" | "image" | "video" | "tts">;
interface ProductionReadinessProps {
  providers: ModelProvider[];
  prices: ModelPrice[];
  modalities?: ProductionModality[];
  routes?: Partial<Record<ProductionModality, { providerId?: string; model?: string }>>;
}

/** This is configuration evidence only. It never treats a configured route as a tested connection. */
export function ProductionReadiness({ providers, prices, modalities = ["text", "image", "video", "tts"], routes }: ProductionReadinessProps) {
  const catalog = buildModelCatalog(providers, prices);
  return <section className="creator-readiness" aria-label="生成准备情况">
    <header><strong>生成准备</strong><span>配置检查 · 连接与效果在实际生成时确认</span></header>
    <ul>{modalities.map(modality => {
      const route = routes?.[modality];
      const models = catalog.filter(item => item.provider.modality === modality);
      const selected = route ? models.find(item => item.provider.id === route.providerId && item.model === route.model) : undefined;
      const ready = route ? selected?.selectable : models.some(item => item.selectable);
      const verifiedConfig = route ? selected?.state === "configured" : models.some(item => item.state === "configured");
      const label = route ? selected?.statusLabel ?? (route.model ? "路由已失效" : "待选择")
        : ready ? verifiedConfig ? "配置齐全" : "连接待确认" : models.length ? "需完善配置" : "暂未配置";
      return <li key={modality} data-ready={Boolean(ready)}><i aria-hidden="true" /><strong>{modalityNames[modality]}</strong><span>{label}</span></li>;
    })}</ul>
  </section>;
}
