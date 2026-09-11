import { analyzeProductionEpisodes, type CreateProjectInput, type ModelProvider } from "@aifilm/shared";

export function normalizeWizardSourceType(sourceType: unknown): CreateProjectInput["sourceType"] {
  if (sourceType === "screenplay") return "script";
  if (["novel", "short_story", "idea", "script", "excel"].includes(String(sourceType))) return sourceType as CreateProjectInput["sourceType"];
  return "novel";
}

export function buildGenerationInput(form: CreateProjectInput): CreateProjectInput {
  const sourceType = normalizeWizardSourceType(form.sourceType);
  const maxEpisodes = analyzeProductionEpisodes(form.content, sourceType === "script" ? "script" : "novel").maxEpisodes;
  return {
    ...form,
    sourceType,
    title: form.title.trim() || form.content.trim().split(/\r?\n/).find((line) => line.trim())?.slice(0, 12) || "未命名漫剧",
    genre: form.genre.trim() || "AI 自动识别题材",
    artStyle: form.artStyle.trim() || "AI 自动匹配画风",
    targetEpisodes: Math.max(1, Math.min(maxEpisodes, form.targetEpisodes ?? 1))
  };
}

export function buildEstimateInput(form: CreateProjectInput) {
  const { content, sourceType, mode, targetEpisodes, textProvider, textModel, imageProvider, imageModel, imageSize, imageQuality, videoProvider, videoModel } = buildGenerationInput(form);
  return { content, sourceType, mode, targetEpisodes, textProvider, textModel, imageProvider, imageModel, imageSize, imageQuality, videoProvider, videoModel };
}

export function creationBillingSignature(form: CreateProjectInput) {
  return JSON.stringify(buildEstimateInput(form));
}

/** Binds asynchronous estimates to both their input and request order. */
export function createCreationQuoteGate() {
  let signature = "", sequence = 0;
  function select(next: string) { if (signature !== next) { signature = next; sequence++; } }
  return {
    select,
    begin(next: string) { select(next); return { signature: next, sequence: ++sequence }; },
    current(ticket: { signature: string; sequence: number }) { return ticket.signature === signature && ticket.sequence === sequence; }
  };
}

export function canManageModelTests(role: string | undefined) {
  return role === "admin";
}

export function isConfiguredModelRoute(providers: ModelProvider[], modality: ModelProvider["modality"], providerId: string | undefined, model: string | undefined) {
  return Boolean(model && providers.some((provider) => provider.id === providerId && provider.modality === modality && provider.enabled && provider.models.includes(model)));
}
