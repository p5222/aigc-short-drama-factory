export type ProductionPromptStage = "analysis" | "strategy" | "chapter" | "script" | "entity" | "character" | "scene" | "storyboard" | "video";

export interface ProductionPromptDefinition {
  key: string;
  name: string;
  stage: ProductionPromptStage;
  purpose: "generation" | "evaluation";
  version: string;
  systemPrompt: string;
  userTemplate: string;
  variables: string[];
  outputSchema: Record<string, unknown>;
  validationRules: string[];
  negativeRules: string[];
}

export interface ProductionPromptSummary {
  key: string;
  name: string;
  stage: ProductionPromptStage;
  runtimeScope: string | null;
  builtinVersion: string;
  activeVersion: string;
  activeVersionId: string | null;
  revision: number;
}

export interface ProductionPromptVersion {
  id: string;
  number: number;
  definition: ProductionPromptDefinition;
  notes: string;
  createdAt: string;
}

export interface ProductionPromptDetail extends ProductionPromptSummary {
  builtin: ProductionPromptDefinition;
  effective: ProductionPromptDefinition;
  versions: ProductionPromptVersion[];
  totalVersions: number;
  compatibilityError?: string;
}

export interface ProductionPromptDraft {
  systemPrompt: string;
  userTemplate: string;
}

export interface ProductionPromptPreview {
  systemPrompt: string;
  userPrompt: string;
  characters: number;
}
