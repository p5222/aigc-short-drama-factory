import { Aperture, Asterisk, AudioLines, BrainCircuit, Clapperboard, Cpu, FishSymbol, Hexagon, Moon, Orbit, Sparkles, Triangle, Waves } from "lucide-react";
import type { ModelModality } from "@aifilm/shared";
import { modelIdentity, type ModelFamily } from "./modelCatalog";

const icons = {
  openai: Hexagon, deepseek: FishSymbol, qwen: Orbit, wan: Waves, gemini: Sparkles, claude: Asterisk,
  seed: Clapperboard, kling: Aperture, flux: Aperture, minimax: Triangle, kimi: Moon, generic: Cpu
};

/** Vector identity marks distinguish model families without downloading images or claiming official logos. */
export function ModelIcon({ model, family, modality, small = false }: { model?: string; family?: ModelFamily; modality?: ModelModality; small?: boolean }) {
  const key = family ?? modelIdentity(model ?? "").family;
  const Icon = key === "generic" && modality === "tts" ? AudioLines : key === "generic" && modality === "text" ? BrainCircuit : icons[key];
  return <span className={`model-icon model-icon--${key}${small ? " model-icon--small" : ""}`} aria-hidden="true"><Icon size={small ? 16 : 21} strokeWidth={1.7} /></span>;
}

export function ModelIdentity({ model, providerName, modality, compact = false }: { model: string; providerName?: string; modality?: ModelModality; compact?: boolean }) {
  const identity = modelIdentity(model);
  return <span className={`model-identity${compact ? " model-identity--compact" : ""}`}>
    <ModelIcon family={identity.family} modality={modality} small={compact} />
    <span className="model-identity-copy"><strong>{identity.name}</strong><small>{providerName ? `${providerName} · ` : ""}{model || "请先选择模型"}</small></span>
  </span>;
}
