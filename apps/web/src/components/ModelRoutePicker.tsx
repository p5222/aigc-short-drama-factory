import { Check, ChevronDown, Search, Star } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ModelModality, ModelPrice, ModelProvider } from "@aifilm/shared";
import { Dialog } from "../design-system/ui";
import { ModelIcon } from "./ModelIdentity";
import { buildModelCatalog, modelIdentity, modelPriceLabel, modelRouteKey, modalityNames, searchModelCatalog, type CatalogModel } from "./modelCatalog";
import { useModelPreferences } from "./useModelPreferences";
import "./model-experience.css";

export interface ModelRoutePickerProps {
  modality: ModelModality;
  providers: ModelProvider[];
  modelPrices?: ModelPrice[];
  value: { providerId: string; model: string };
  onChange: (providerId: string, model: string) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  /** Configuration editors can choose disabled or incomplete routes without calling them. */
  allowUnavailable?: boolean;
}

export function ModelRoutePicker({ modality, providers, modelPrices, value, onChange, disabled, compact, label, allowUnavailable = false }: ModelRoutePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "favorites" | "recent">("all");
  const [activeKey, setActiveKey] = useState("");
  const [adminTheme, setAdminTheme] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const id = useId();
  const preferences = useModelPreferences();
  const items = useMemo(() => buildModelCatalog(providers.filter(provider => provider.modality === modality && (allowUnavailable || provider.enabled)), modelPrices), [providers, modality, modelPrices, allowUnavailable]);
  const currentKey = modelRouteKey(value.providerId, value.model);
  const current = items.find(item => item.key === currentKey);
  const visible = useMemo(() => {
    const filtered = searchModelCatalog(items, query).filter(item =>
      filter === "all" || (filter === "favorites" ? preferences.favorites : preferences.recent).includes(item.key));
    return filter === "recent" ? filtered.sort((a, b) => preferences.recent.indexOf(a.key) - preferences.recent.indexOf(b.key)) : filtered;
  }, [items, query, filter, preferences.favorites, preferences.recent]);
  const active = visible.find(item => item.key === activeKey) ?? visible.find(item => item.key === currentKey) ?? visible[0];
  const selectable = visible.filter(item => allowUnavailable || item.selectable);
  const groups = [...new Set(visible.map(item => item.provider.id))];
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open && active) optionRefs.current.get(active.key)?.scrollIntoView({ block: "nearest" }); }, [open, active?.key]);

  const title = label ?? `选择${modalityNames[modality]}模型`;
  function begin() {
    setAdminTheme(Boolean(root.current?.closest(".admin-product")));
    setQuery(""); setFilter("all"); setActiveKey(currentKey); setOpen(true);
  }
  function choose(item: CatalogModel) {
    if (disabled || (!allowUnavailable && !item.selectable)) return;
    preferences.recordSelection(item.key);
    setOpen(false);
    if (item.key !== currentKey) onChange(item.provider.id, item.model);
  }
  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (!selectable.length) return;
    const index = selectable.findIndex(item => item.key === active?.key);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 1) % selectable.length;
    if (event.key === "ArrowUp") next = (index <= 0 ? selectable.length : index) - 1;
    if (event.key === "Home" && event.ctrlKey) next = 0;
    if (event.key === "End" && event.ctrlKey) next = selectable.length - 1;
    if (next !== undefined) { event.preventDefault(); setActiveKey(selectable[next].key); }
    if (event.key === "Enter" && active && (allowUnavailable || active.selectable)) { event.preventDefault(); choose(active); }
  }
  const optionId = (key: string) => `${id}-option-${items.findIndex(item => item.key === key)}`;
  const identity = modelIdentity(value.model);

  return <div ref={root} className={`mrp-root${compact ? " is-compact" : ""}`}>
    <button type="button" className="mrp-trigger" disabled={disabled} aria-label={`${title}：${identity.name}`} aria-haspopup="dialog" aria-expanded={open} onClick={begin}>
      <ModelIcon family={identity.family} modality={modality} small />
      <span className="mrp-trigger-copy"><strong className="mrp-trigger-model">{value.model ? identity.name : "请选择模型"}</strong><small>{current?.provider.name ?? (value.providerId || modalityNames[modality])}</small></span>
      {!compact && current?.price ? <span className="mrp-badge">{modelPriceLabel(current.price)}</span> : null}
      <ChevronDown size={15} className="mrp-caret" aria-hidden="true" />
    </button>
    <Dialog open={open} title={title} description={allowUnavailable ? "选择配置中的模型；此操作不会发起测试或生成。" : "按模型、渠道或能力搜索。实际费用以生成前的报价为准。"} onClose={() => setOpen(false)} className={`model-picker-dialog${adminTheme ? " model-admin-theme" : ""}`} footer={<div className="model-picker-footer"><span><kbd>↑ ↓</kbd> 浏览 <kbd>Enter</kbd> 选择 <kbd>Esc</kbd> 关闭</span><small>收藏与最近选择仅保存在此浏览器</small></div>}>
      <div className="model-picker-tools">
        <label className="model-search"><Search size={18} aria-hidden="true" /><input ref={search} data-autofocus role="combobox" aria-label="搜索模型或渠道" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={active ? optionId(active.key) : undefined} value={query} placeholder="搜索名称、渠道或能力…" onChange={event => { setQuery(event.target.value); setActiveKey(""); }} onKeyDown={onSearchKey} /></label>
        <div className="model-filter-tabs" aria-label="模型列表范围">{([["all", "全部模型"], ["favorites", "我的收藏"], ["recent", "最近选择"]] as const).map(([key, text]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setActiveKey(""); search.current?.focus(); }}>{text}{key === "favorites" ? <span>{items.filter(item => preferences.favorites.includes(item.key)).length}</span> : null}</button>)}</div>
      </div>
      <div className="model-picker-content">
        <div className="model-picker-list" id={`${id}-list`} role="listbox" aria-label={title}>
          {groups.map(providerId => {
            const group = visible.filter(item => item.provider.id === providerId);
            return <div role="group" aria-label={group[0].provider.name} className="model-picker-group" key={providerId}>
              <div className="model-picker-group-head"><strong>{group[0].provider.name}</strong><small>{group.length} 个模型</small></div>
              {group.map(item => <button ref={element => { if (element) optionRefs.current.set(item.key, element); else optionRefs.current.delete(item.key); }} id={optionId(item.key)} type="button" role="option" aria-selected={item.key === currentKey} aria-disabled={!allowUnavailable && !item.selectable || undefined} tabIndex={-1} className={`model-picker-option${item.key === active?.key ? " is-active" : ""}${item.key === currentKey ? " is-selected" : ""}${!item.selectable ? " is-unavailable" : ""}`} key={item.key} onMouseEnter={() => setActiveKey(item.key)} onClick={() => choose(item)}>
                <ModelIcon family={item.family} modality={modality} />
                <span className="model-option-copy"><strong>{item.name}{preferences.favorites.includes(item.key) ? <Star size={12} fill="currentColor" aria-label="已收藏" /> : null}</strong><small>{item.model}</small><span className="model-option-tags">{item.tags.slice(0, 3).map(tag => <em key={tag}>{tag}</em>)}{item.preferred ? <em>渠道默认</em> : null}</span></span>
                <span className="model-option-meta"><strong>{modelPriceLabel(item.price)}</strong><small className={`model-state model-state--${item.state}`}>{item.statusLabel}</small></span>
                {item.key === currentKey ? <Check size={17} className="model-option-check" aria-hidden="true" /> : null}
              </button>)}
            </div>;
          })}
          {!visible.length ? <div className="model-catalog-empty"><Search size={24} aria-hidden="true" /><strong>{query ? "没有匹配的模型" : filter === "favorites" ? "还没有收藏模型" : filter === "recent" ? "还没有最近选择" : "暂无模型配置"}</strong><p>{query ? "试试模型名称、渠道名称或“参考图”等能力。" : "在模型详情中收藏，或切回全部模型。"}</p><button className="ds-button" type="button" onClick={() => { setQuery(""); setFilter("all"); }}>查看全部模型</button></div> : null}
        </div>
        {active ? <aside className="model-picker-detail">
          <span className="model-detail-kicker">{modalityNames[modality]}模型 · 配置详情</span>
          <ModelIcon family={active.family} modality={modality} />
          <h3>{active.name}</h3><code>{active.model}</code>
          <p>{active.description}</p>
          <dl><div><dt>模型渠道</dt><dd>{active.provider.name}</dd></div><div><dt>积分单价</dt><dd>{modelPriceLabel(active.price)}</dd></div><div><dt>配置状态</dt><dd>{active.statusLabel}</dd></div></dl>
          <div className="model-detail-tags">{active.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
          <button className="ds-button" type="button" aria-pressed={preferences.favorites.includes(active.key)} onClick={() => preferences.toggleFavorite(active.key)}><Star size={16} fill={preferences.favorites.includes(active.key) ? "currentColor" : "none"} />{preferences.favorites.includes(active.key) ? "取消收藏" : "收藏这个模型"}</button>
          <small>能力来自渠道配置，配置齐全不代表已完成真实生成验收。</small>
        </aside> : null}
      </div>
    </Dialog>
  </div>;
}
