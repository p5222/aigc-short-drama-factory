import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { ModelPrice, ModelProvider } from "@aifilm/shared";

export interface ModelRoutePickerProps {
  modality: "text" | "image" | "video";
  providers: ModelProvider[];
  modelPrices?: ModelPrice[];
  value: { providerId: string; model: string };
  onChange: (providerId: string, model: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

const avatarPalette = ["#0b8f7b", "#4f6bed", "#b3591f", "#8a4fb8", "#c04f6e"];

/** 渠道图标映射：优先后台配置的 iconUrl，其次按 id/名称关键字匹配 public/logo 静态图，匹配不到返回空串（渲染首字彩色圆）。 */
function providerLogoSrc(id: string, name: string, iconUrl?: string): string {
  if (iconUrl) return iconUrl;
  const key = `${id} ${name}`.toLowerCase();
  if (/manjiao|openai|zml|gpt|ripp/.test(key)) return "/logo/openai.png";
  if (/deepseek/.test(key)) return "/logo/deepseek-color.png";
  if (/dashscope|bailian|qwen|wan/.test(key)) return "/logo/qwen-color.png";
  if (/gemini|google/.test(key)) return "/logo/gemini-color.png";
  if (/claude/.test(key)) return "/logo/claude-color.png";
  return "";
}

function avatarColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return avatarPalette[hash % avatarPalette.length];
}

function ProviderIcon({ id, name, iconUrl }: { id: string; name: string; iconUrl?: string }): ReactElement {
  const src = providerLogoSrc(id, name, iconUrl);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) {
    return <span className="mrp-avatar" style={{ background: avatarColor(id || name) }} aria-hidden="true">{(name || id || "模").slice(0, 1).toUpperCase()}</span>;
  }
  return <img className="mrp-logo" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

function priceUnitLabel(unit: ModelPrice["unit"]): string {
  if (unit === "text_run") return "次";
  if (unit === "image") return "张";
  if (unit === "video_second") return "秒";
  return unit;
}

/** 积分徽标：先按渠道+模型精确匹配启用价格，退化为同模态下仅模型匹配；查不到返回空串（不显示徽标）。 */
function priceBadge(prices: ModelPrice[] | undefined, modality: ModelRoutePickerProps["modality"], providerId: string, model: string): string {
  if (!prices?.length) return "";
  const candidates = prices.filter((price) => price.enabled && price.modality === modality && price.model === model);
  const matched = candidates.find((price) => price.providerId === providerId) ?? candidates[0];
  return matched ? `${matched.unitCredits} 积分/${priceUnitLabel(matched.unit)}` : "";
}

function capabilityTags(provider: ModelProvider, model: string): string[] {
  if (provider.modality === "text") {
    const key = model.toLowerCase();
    if (key.includes("gpt-5.5")) return ["高质量"];
    if (/flash|turbo/.test(key)) return ["快速"];
    return [];
  }
  const tags: string[] = [];
  if (provider.capability?.supportsReferenceImage) tags.push("参考图");
  if (provider.capability?.supportsImageToVideo) tags.push("图生视频");
  if (provider.capability?.supportsAsyncTask) tags.push("异步");
  return tags;
}

/** 统一的模型路由选择器：触发器胶囊 + 按渠道分组的下拉面板，供内容创作 / 资产 / 分镜 / 交付四处复用。 */
export function ModelRoutePicker({ modality, providers, modelPrices, value, onChange, disabled, compact }: ModelRoutePickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo(
    () => providers.filter((provider) => provider.enabled && provider.modality === modality && provider.models.length > 0),
    [providers, modality]
  );
  const currentProvider = providers.find((provider) => provider.id === value.providerId);

  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(event: MouseEvent) {
      if (event.target instanceof Node && rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    function onDocKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [open]);

  const triggerBadge = compact ? "" : priceBadge(modelPrices, modality, value.providerId, value.model);
  const rootClass = ["mrp-root", compact ? "is-compact" : "", disabled ? "is-disabled" : ""].filter(Boolean).join(" ");

  return <div className={rootClass} ref={rootRef}>
    <button type="button" className="mrp-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((state) => !state)}>
      <ProviderIcon id={currentProvider?.id ?? value.providerId} name={currentProvider?.name ?? value.providerId} iconUrl={currentProvider?.iconUrl} />
      <span className="mrp-trigger-model">{value.model || "选择模型"}</span>
      {triggerBadge ? <span className="mrp-badge">{triggerBadge}</span> : null}
      <ChevronDown size={13} className="mrp-caret" aria-hidden="true" />
    </button>
    {open ? <div className="mrp-panel" role="listbox" aria-label="选择模型路由">
      {groups.length === 0 ? <p className="mrp-empty">暂无可用渠道</p> : groups.map((provider) => <div className="mrp-group" key={provider.id}>
        <div className="mrp-group-head">
          <ProviderIcon id={provider.id} name={provider.name} iconUrl={provider.iconUrl} />
          <strong>{provider.name}</strong>
          {provider.costHint ? <small>{provider.costHint}</small> : null}
        </div>
        {provider.models.map((model) => {
          const selected = provider.id === value.providerId && model === value.model;
          const badge = priceBadge(modelPrices, modality, provider.id, model);
          return <button
            type="button"
            role="option"
            aria-selected={selected}
            key={model}
            className={selected ? "mrp-option is-selected" : "mrp-option"}
            onClick={() => { setOpen(false); if (!selected) onChange(provider.id, model); }}
          >
            <span className="mrp-option-name">{model}</span>
            {capabilityTags(provider, model).slice(0, 2).map((tag) => <em className="mrp-tag" key={tag}>{tag}</em>)}
            {badge ? <span className="mrp-badge">{badge}</span> : null}
            {selected ? <Check size={14} className="mrp-check" aria-hidden="true" /> : null}
          </button>;
        })}
      </div>)}
    </div> : null}
  </div>;
}
