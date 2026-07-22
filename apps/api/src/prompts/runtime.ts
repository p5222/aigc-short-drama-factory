import type { PromptVersion } from "@aifilm/shared";
import { getPromptDefinition, type PromptDefinition } from "./catalog.js";

export function renderPrompt(template: string, variables: Record<string, unknown>) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = key.split(".").reduce<unknown>((current, segment) => (current && typeof current === "object" ? (current as Record<string, unknown>)[segment] : undefined), variables);
    if (value === undefined || value === null || value === "") throw new Error(`提示词缺少变量：${key}`);
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

export function materializePrompt(key: string, variables: Record<string, unknown>, version?: PromptDefinition) {
  const definition = version ?? getPromptDefinition(key);
  if (!definition) throw new Error(`未找到提示词定义：${key}`);
  return {
    key: definition.key,
    version: definition.version,
    systemPrompt: definition.systemPrompt,
    userPrompt: renderPrompt(definition.userTemplate, variables),
    outputSchema: definition.outputSchema,
    validationRules: definition.validationRules,
    negativeRules: definition.negativeRules,
    snapshot: structuredClone(definition)
  };
}

export function promptSnapshot(version: PromptVersion | Record<string, unknown>) {
  return JSON.parse(JSON.stringify(version));
}
