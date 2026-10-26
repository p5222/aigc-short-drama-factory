import { ArrowRight, Search, SlidersHorizontal, Star } from "lucide-react";
import { useMemo, useState } from "react";
import type { ModelModality, ModelPrice, ModelProvider } from "@aifilm/shared";
import { Dialog } from "../design-system/ui";
import { ModelIdentity } from "./ModelIdentity";
import { buildModelCatalog, modelPriceLabel, modalityNames, searchModelCatalog } from "./modelCatalog";
import { useModelPreferences } from "./useModelPreferences";
import "./model-experience.css";

export function ModelLibrary({ providers, modelPrices, admin = false, onConfigure, onPrice, onCreate }: {
  providers: ModelProvider[]; modelPrices: ModelPrice[]; admin?: boolean;
  onConfigure?: (providerId: string) => void; onPrice?: () => void; onCreate?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [modality, setModality] = useState<ModelModality | "all">("all");
  const [scope, setScope] = useState<"all" | "favorites" | "issues">("all");
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const preferences = useModelPreferences();
  const catalog = useMemo(() => buildModelCatalog(providers.filter(provider => admin || provider.enabled), modelPrices), [providers, modelPrices, admin]);
  const rows = searchModelCatalog(catalog, query).filter(item =>
    (modality === "all" || item.provider.modality === modality) &&
    (scope === "all" || (scope === "favorites" ? preferences.favorites.includes(item.key) : item.issues.length > 0 && item.state !== "disabled")));
  const selected = catalog.filter(item => compare.includes(item.key));
  const missingKey = catalog.filter(item => item.state !== "disabled" && item.issues.includes("待配置"));
  const missingPrice = catalog.filter(item => item.state !== "disabled" && item.issues.some(issue => ["未配置价格", "价格配置冲突", "价格配置无效"].includes(issue)));
  const issues = catalog.filter(item => !item.selectable && item.state !== "disabled");
  const emptyProviders = admin ? providers.filter(provider => provider.enabled && !provider.models.some(model => model.trim())) : [];
  const favorites = catalog.filter(item => preferences.favorites.includes(item.key));

  return <section className={`model-library${admin ? " model-library--admin model-admin-theme" : ""}`} aria-label={admin ? "模型配置目录" : "模型中心"}>
    <header className="model-library-intro"><div><span className="ui-eyebrow">{admin ? "MODEL OPERATIONS" : "MANJIAO MODELS"}</span>{admin ? <h2>模型配置目录</h2> : <h1>为每一步创作，找到合适的模型</h1>}<p>{admin ? "将模型、渠道、价格和配置状态放在一起核对，发现缺口后直接进入编辑。" : "文本梳理故事，图像构建画面，视频完成镜头。先了解配置与计费，再到创作步骤选择模型。"}</p></div><div className="model-library-count"><strong>{catalog.length}</strong>个配置模型<br />来自 {new Set(catalog.map(item => item.provider.id)).size} 个渠道</div></header>
    {admin && (issues.length > 0 || emptyProviders.length > 0) ? <div className="model-readiness"><strong><SlidersHorizontal size={15} /> 配置检查：{issues.length} 个模型需要处理{emptyProviders.length ? ` · ${emptyProviders.length} 个渠道未填写模型` : ""}</strong><p>{missingKey.length} 个模型待配置密钥 · {missingPrice.length} 个模型价格缺失、冲突或无效。同一模型可有多项问题；冷却和额度状态也需核对。</p><div className="model-readiness-actions"><button className="ds-button" type="button" onClick={() => { setScope("issues"); setQuery(""); setModality("all"); }}>查看配置问题</button>{onPrice ? <button className="ds-button" type="button" onClick={onPrice}>管理价格策略<ArrowRight size={13} /></button> : null}{emptyProviders.map(provider => <button className="ds-button" type="button" key={provider.id} onClick={() => onConfigure?.(provider.id)}>{provider.name} · 补充模型<ArrowRight size={13} /></button>)}</div></div> : null}
    <div className="model-library-toolbar"><label className="model-search"><Search size={18} aria-hidden="true" /><input aria-label="搜索模型目录" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索模型、渠道或能力…" /></label><div className="model-filter-tabs" aria-label="模型目录范围">{([["all", "全部"], ["favorites", `收藏 ${favorites.length}`], ...(admin ? [["issues", "配置问题"]] : [])] as Array<["all" | "favorites" | "issues", string]>).map(([key, name]) => <button type="button" key={key} aria-pressed={scope === key} onClick={() => setScope(key)}>{name}</button>)}</div>{onCreate ? <button className="ds-button ds-button--primary" type="button" onClick={onCreate}>开始创作<ArrowRight size={15} /></button> : null}</div>
    <div className="model-filter-tabs" aria-label="模型能力分类">{(["all", "text", "image", "video", "tts", "embedding"] as const).map(key => <button key={key} type="button" aria-pressed={modality === key} onClick={() => setModality(key)}>{key === "all" ? "全部能力" : modalityNames[key]}<span>{catalog.filter(item => key === "all" || item.provider.modality === key).length}</span></button>)}</div>
    <div className="model-library-grid">{rows.map(item => <article key={item.key} className="model-library-card">
      <header className="model-library-card-header"><ModelIdentity model={item.model} providerName={item.provider.name} modality={item.provider.modality} /><button className="ui-icon-button" type="button" aria-label={`${preferences.favorites.includes(item.key) ? "取消收藏" : "收藏"}${item.name} · ${item.provider.name}`} aria-pressed={preferences.favorites.includes(item.key)} onClick={() => preferences.toggleFavorite(item.key)}><Star size={17} fill={preferences.favorites.includes(item.key) ? "currentColor" : "none"} /></button></header>
      <p>{item.description}</p><div className="model-detail-tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}{item.preferred ? <span>渠道默认</span> : null}</div>
      {admin && item.issues.length > 0 ? <p className="model-configuration-issues">需核对：{item.issues.join(" · ")}</p> : null}
      <footer className="model-library-card-footer"><div><strong>{modelPriceLabel(item.price)}</strong><small className={`model-state model-state--${item.state}`}>{item.statusLabel}</small></div><label><input type="checkbox" checked={compare.includes(item.key)} disabled={!compare.includes(item.key) && selected.length >= 3} onChange={event => setCompare(current => event.target.checked ? [...current.filter(key => catalog.some(item => item.key === key)), item.key].slice(0, 3) : current.filter(key => key !== item.key))} aria-label={`对比${item.name} · ${item.provider.name}`} />加入对比</label></footer>
      {onConfigure ? <button className="ds-button" type="button" onClick={() => onConfigure(item.provider.id)}>编辑渠道<ArrowRight size={13} /></button> : null}
    </article>)}</div>
    {!rows.length ? <div className="model-catalog-empty"><Search size={26} /><strong>{scope === "issues" ? "没有匹配的配置问题" : scope === "favorites" ? "还没有匹配的收藏" : "没有匹配的模型"}</strong><p>调整能力分类或搜索关键词，收藏不会自动切换项目中的模型。</p><button type="button" className="ds-button" onClick={() => { setQuery(""); setModality("all"); setScope("all"); }}>重置筛选</button></div> : null}
    {selected.length ? <div className="model-compare-dock"><strong>已选 {selected.length}/3 个模型 · 能力与积分对比</strong><button className="ds-button" type="button" onClick={() => setCompare([])}>清空</button><button className="ds-button ds-button--primary" type="button" disabled={selected.length < 2} onClick={() => setCompareOpen(true)}>对比模型</button></div> : null}
    <p className="model-library-note">能力来自当前渠道配置。积分单价未包含尺寸、质量、数量或会员结算等影响，实际费用以生成前服务器报价为准。</p>
    <Dialog open={compareOpen} title="模型对比" description="按当前配置比较用途、价格与能力。不同计费单位不能直接比较高低。" onClose={() => setCompareOpen(false)} className={`model-compare-dialog${admin ? " model-admin-theme" : ""}`}>
      <div className="model-compare-scroll"><table className="model-compare-table"><thead><tr><th>比较项目</th>{selected.map(item => <th key={item.key}><ModelIdentity model={item.model} providerName={item.provider.name} modality={item.provider.modality} /></th>)}</tr></thead><tbody>
        <tr><th>用途</th>{selected.map(item => <td key={item.key}>{modalityNames[item.provider.modality]}</td>)}</tr>
        <tr><th>积分单价</th>{selected.map(item => <td key={item.key}>{modelPriceLabel(item.price)}</td>)}</tr>
        <tr><th>配置状态</th>{selected.map(item => <td key={item.key}>{item.statusLabel}</td>)}</tr>
        <tr><th>渠道能力</th>{selected.map(item => <td key={item.key}>{item.tags.join(" · ")}</td>)}</tr>
        <tr><th>配置画幅</th>{selected.map(item => <td key={item.key}>{item.provider.capability?.ratios?.join(" · ") || "未配置"}</td>)}</tr>
        <tr><th>配置时长上限</th>{selected.map(item => <td key={item.key}>{item.provider.capability?.maxDuration ? `${item.provider.capability.maxDuration} 秒` : "未配置"}</td>)}</tr>
      </tbody></table></div>
    </Dialog>
  </section>;
}
