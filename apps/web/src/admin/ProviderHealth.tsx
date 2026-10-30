import { useMemo, useState } from "react";
import { ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import type { ModelModality, ModelPrice, ModelProvider } from "@aifilm/shared";
import { ProviderIcon } from "../components/ModelIdentity";
import { modalityNames } from "../components/modelCatalog";
import { StatePanel } from "../design-system/ui";
import { AdminPagination, useAdminPagination } from "./AdminPagination";
import { providerHealth } from "./providerHealthModel";

export function ProviderHealth({ providers, prices, onConfigure, onPrices }: {
  providers: ModelProvider[]; prices: ModelPrice[]; onConfigure: (id: string) => void; onPrices: () => void;
}) {
  const [modality, setModality] = useState("all"), [keyword, setKeyword] = useState(""), [attention, setAttention] = useState(false);
  const health = useMemo(() => providers.map(provider => providerHealth(provider, prices)), [providers, prices]);
  const attentionCount = health.filter(item => item.needsAttention).length;
  const modalities: ModelModality[] = ["text", "image", "video", "tts", "embedding"];
  const filtered = health.filter(item => (modality === "all" || item.provider.modality === modality)
    && (!attention || item.needsAttention)
    && `${item.provider.name} ${item.provider.id} ${item.models.map(model => model.model).join(" ")} ${item.issues.join(" ")}`.toLowerCase().includes(keyword.trim().toLowerCase()));
  const pagination = useAdminPagination(filtered, `${modality}:${keyword}:${attention}`, 8);
  return <section className="adm-provider-health" aria-label="模型渠道健康">
    <header className="adm-health-heading"><div><h2>模型与渠道</h2><p>从写故事到交付成片，检查每一步的模型准备情况。</p></div><button type="button" className="admin-secondary-btn compact" onClick={() => onConfigure("")}><SlidersHorizontal size={15} />管理全部渠道</button></header>
    <div className="adm-capability-strip" role="group" aria-label="按创作能力筛选">
      {modalities.map(type => {
        const pool = health.filter(item => item.provider.modality === type);
        const ready = pool.reduce((sum, item) => sum + item.ready, 0), total = pool.reduce((sum, item) => sum + item.models.length, 0);
        return <button key={type} type="button" aria-pressed={modality === type} onClick={() => setModality(modality === type ? "all" : type)}>
          <span>{modalityNames[type]}</span><strong>{ready}<small> / {total}</small></strong><em>{total ? "模型配置齐全" : "尚未接入"}</em>
        </button>;
      })}
    </div>
    <div className="adm-health-tools">
      <label className="admin-product-search"><Search size={16} /><input aria-label="搜索模型渠道" placeholder="搜索渠道、模型或配置问题" value={keyword} onChange={event => setKeyword(event.target.value)} /></label>
      <button className="adm-attention-filter" type="button" aria-pressed={attention} onClick={() => setAttention(!attention)}>待处理渠道 <b>{attentionCount}</b></button>
      {modality !== "all" || keyword || attention ? <button className="admin-text-btn" type="button" onClick={() => { setModality("all"); setKeyword(""); setAttention(false); }}>重置筛选</button> : null}
      <span>匹配 {filtered.length} / 共 {providers.length} 个渠道</span>
    </div>
    <div className="adm-health-list">
      {pagination.items.map(item => <article className="adm-health-row" key={item.provider.id} data-attention={item.needsAttention || undefined}>
        <div className="adm-health-identity"><ProviderIcon provider={item.provider} /><div><strong>{item.provider.name}</strong><small>{modalityNames[item.provider.modality]} · {item.models.length} 个模型</small></div></div>
        <div className="adm-health-models">{item.models.slice(0, 3).map(model => <span key={model.key} title={model.model}>{model.model}</span>)}{item.models.length > 3 ? <small>另 {item.models.length - 3} 个</small> : null}</div>
        <div className="adm-health-coverage"><span>有效价格 <b>{item.covered} / {item.models.length}</b></span><meter min={0} max={Math.max(1, item.models.length)} value={item.covered} aria-label={`${item.provider.name}价格覆盖 ${item.covered}/${item.models.length}`} /></div>
        <div className="adm-health-state"><span className="adm-status" data-status={!item.provider.enabled ? "disabled" : item.needsAttention ? "started" : "active"}>{item.status}</span><small>{item.provider.enabled ? item.issues.join(" · ") || "实际调用待测试" : "不接受新任务"}</small></div>
        <button type="button" className="adm-row-open" onClick={() => onConfigure(item.provider.id)}>检查渠道<ChevronRight size={14} /></button>
      </article>)}
      {!filtered.length ? <StatePanel compact title={providers.length ? "没有匹配的渠道" : "还没有模型渠道"} description="可调整筛选，或从渠道管理添加模型。" /> : null}
    </div>
    <AdminPagination total={filtered.length} page={pagination.page} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
    <footer className="adm-health-note"><span>“配置齐全”表示密钥、价格和当前额度检查通过。连接实测与生成质量另行核验。</span><button className="admin-text-btn" type="button" onClick={onPrices}>核对价格策略<ChevronRight size={14} /></button></footer>
  </section>;
}
