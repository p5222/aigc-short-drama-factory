import { AudioLines, BrainCircuit, Cpu } from "lucide-react";
import { useId } from "react";
import type { ModelModality, ModelProvider } from "@aifilm/shared";
import { modelIdentity, providerModelFamily, type ModelFamily } from "./modelCatalog";
import monoMarks from "./brand/marks.json";
import colorMarks from "./brand/color-marks.json";

const marks = { ...monoMarks, ...colorMarks };

/** Pinned brand geometry; source and license in docs/product/model-brand-sources.md. */
export function ModelIcon({ model, family, modality, small = false }: { model?: string; family?: ModelFamily; modality?: ModelModality; small?: boolean }) {
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const key = family ?? modelIdentity(model ?? "").family;
  const mark = key === "generic" ? undefined : marks[key];
  // Multiple instances must never reference another icon's gradient (including in hidden dialogs).
  const body = mark?.body.replace(/id="([^"]+)"/g, `id="${instance}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${instance}-$1)`);
  const Icon = modality === "tts" ? AudioLines : modality === "text" ? BrainCircuit : Cpu;
  return <span className={`model-icon model-icon--${key}${small ? " model-icon--small" : ""}`} aria-hidden="true" data-brand={key}>
    {mark ? <svg width={small ? 18 : 24} height={small ? 18 : 24} viewBox={mark.viewBox} fill="currentColor" fillRule="evenodd" focusable="false" dangerouslySetInnerHTML={{ __html: body! }} />
      : <Icon size={small ? 16 : 21} strokeWidth={1.7} />}
  </span>;
}

export function ModelIdentity({ model, providerName, modality, compact = false }: { model: string; providerName?: string; modality?: ModelModality; compact?: boolean }) {
  const identity = modelIdentity(model);
  return <span className={`model-identity${compact ? " model-identity--compact" : ""}`}>
    <ModelIcon family={identity.family} modality={modality} small={compact} />
    <span className="model-identity-copy"><strong>{identity.name}</strong><small>{providerName ? `${providerName} · ` : ""}{model || "请先选择模型"}</small></span>
  </span>;
}

export function ProviderIcon({ provider }: { provider?: Pick<ModelProvider, "models" | "modality" | "iconUrl" | "name"> }) {
  const family = providerModelFamily(provider?.models ?? []);
  // Retain the administrator's uploaded channel identity when model brands are mixed or unknown.
  if (family === "generic" && provider?.iconUrl) return <span className="model-icon" aria-hidden="true"><img src={provider.iconUrl} alt="" width={24} height={24} /></span>;
  return <ModelIcon family={family} modality={provider?.modality} />;
}
