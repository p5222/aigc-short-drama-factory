import { AudioLines, BrainCircuit, Cpu } from "lucide-react";
import type { ModelModality } from "@aifilm/shared";
import { modelIdentity, type ModelFamily } from "./modelCatalog";
import marks from "./brand/marks.json";

/** Pinned brand geometry; source and license in docs/product/model-brand-sources.md. */
export function ModelIcon({ model, family, modality, small = false }: { model?: string; family?: ModelFamily; modality?: ModelModality; small?: boolean }) {
  const key = family ?? modelIdentity(model ?? "").family;
  const mark = key === "generic" ? undefined : marks[key];
  const Icon = modality === "tts" ? AudioLines : modality === "text" ? BrainCircuit : Cpu;
  return <span className={`model-icon model-icon--${key}${small ? " model-icon--small" : ""}`} aria-hidden="true" data-brand={key}>
    {mark ? <svg width={small ? 18 : 24} height={small ? 18 : 24} viewBox={mark.viewBox} fill="currentColor" fillRule="evenodd" focusable="false" dangerouslySetInnerHTML={{ __html: mark.body }} />
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
