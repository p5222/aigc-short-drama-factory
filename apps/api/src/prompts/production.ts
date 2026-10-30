import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma, ProductionPromptVersion as VersionRow } from "@prisma/client";
import type { ProductionPromptDefinition, ProductionPromptDetail, ProductionPromptDraft, ProductionPromptSummary } from "@aifilm/shared";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { getPromptDefinition, productionPromptScopes, promptCatalog } from "./catalog.js";
import { materializePrompt } from "./runtime.js";

export class ProductionPromptError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const productionPromptDraftSchema = z.object({
  systemPrompt: z.string().trim().min(20).max(20000),
  userTemplate: z.string().trim().min(10).max(30000)
}).strict();
export const productionPromptSaveSchema = productionPromptDraftSchema.extend({
  notes: z.string().trim().min(1).max(800),
  expectedRevision: z.number().int().nonnegative(),
  requestId: z.string().uuid()
});
export const productionPromptActivateSchema = z.object({
  versionId: z.string().min(1).max(120).nullable(),
  expectedRevision: z.number().int().nonnegative()
}).strict();
export const productionPromptPreviewSchema = productionPromptDraftSchema.extend({
  variables: z.record(z.string(), z.unknown())
});

function builtin(key: string) {
  const definition = getPromptDefinition(key);
  if (!definition) throw new ProductionPromptError("提示词不存在", 404);
  return definition;
}
function assertConnected(key: string) {
  const definition = builtin(key);
  if (!productionPromptScopes[key]) throw new ProductionPromptError("此模板为设计参考，尚未接入生产生成");
  return definition;
}

export function validateProductionDraft(key: string, draft: ProductionPromptDraft) {
  const definition = builtin(key);
  const parsed = productionPromptDraftSchema.safeParse(draft);
  if (!parsed.success) throw new ProductionPromptError("系统指令或用户模板长度不符合要求");
  const text = `${parsed.data.systemPrompt}\n${parsed.data.userTemplate}`;
  const matches = [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(match => match[1]!);
  if (/\{\{|\}\}/.test(text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, ""))) throw new ProductionPromptError("变量占位符格式无效，请使用 {{variable}}");
  const unknown = matches.filter(key => !definition.variables.includes(key));
  if (unknown.length) throw new ProductionPromptError(`不支持的变量：${[...new Set(unknown)].join("、")}`);
  const missing = definition.variables.filter(key => !matches.includes(key));
  if (missing.length) throw new ProductionPromptError(`模板缺少必需变量：${missing.join("、")}`);
  return { ...structuredClone(definition), ...parsed.data };
}

function checkedStored(key: string, row: VersionRow): ProductionPromptDefinition {
  const reference = builtin(key);
  const stored = row.definition as unknown as ProductionPromptDefinition;
  if (row.key !== key || stored.key !== key || stored.version !== `${reference.version}+custom.${row.number}` ||
      ["variables", "outputSchema", "validationRules", "negativeRules"].some(field =>
        !isDeepStrictEqual(stored[field as keyof ProductionPromptDefinition], reference[field as keyof ProductionPromptDefinition]))) {
    throw new ProductionPromptError("已保存版本与当前输出契约不兼容，请在提示词工作室重新保存版本", 409);
  }
  validateProductionDraft(key, { systemPrompt: stored.systemPrompt, userTemplate: stored.userTemplate });
  return stored;
}

function summary(definition: ProductionPromptDefinition, state?: { activeVersionId: string | null; revision: number }, version?: VersionRow): ProductionPromptSummary {
  return {
    key: definition.key, name: definition.name, stage: definition.stage,
    runtimeScope: productionPromptScopes[definition.key] ?? null,
    builtinVersion: definition.version, activeVersion: version ? (version.definition as unknown as ProductionPromptDefinition).version : definition.version,
    activeVersionId: state?.activeVersionId ?? null, revision: state?.revision ?? 0
  };
}

export async function listProductionPrompts() {
  return prisma.$transaction(async tx => {
    const states = await tx.productionPromptState.findMany();
    const versions = await tx.productionPromptVersion.findMany({ where: { id: { in: states.flatMap(state => state.activeVersionId ? [state.activeVersionId] : []) } } });
    return promptCatalog.map(definition => {
      const state = states.find(state => state.key === definition.key);
      return summary(definition, state, versions.find(version => version.id === state?.activeVersionId));
    });
  }, { isolationLevel: "RepeatableRead" });
}

export async function getProductionPrompt(key: string): Promise<ProductionPromptDetail> {
  const definition = builtin(key);
  return prisma.$transaction(async tx => {
    const state = await tx.productionPromptState.findUnique({ where: { key } });
    const versions = await tx.productionPromptVersion.findMany({ where: { key }, orderBy: { number: "desc" }, take: 50 });
    const active = state?.activeVersionId ? versions.find(row => row.id === state.activeVersionId) ?? await tx.productionPromptVersion.findUnique({ where: { id: state.activeVersionId } }) : null;
    if (active && !versions.some(row => row.id === active.id)) versions.push(active);
    let effective = definition, compatibilityError: string | undefined;
    if (state?.activeVersionId && !active) compatibilityError = "生效版本缺失，生成已阻止。请恢复内置版本。";
    if (active) {
      try { effective = checkedStored(key, active); }
      catch { compatibilityError = "当前生效版本与输出契约不兼容，生成已阻止。编辑器显示内置基线，可重新保存或恢复内置。"; }
    }
    return {
      ...summary(definition, state ?? undefined, active ?? undefined),
      builtin: definition, effective, compatibilityError,
      versions: versions.map(row => ({ id: row.id, number: row.number, definition: row.definition as unknown as ProductionPromptDefinition, notes: row.notes, createdAt: row.createdAt.toISOString() })),
      totalVersions: await tx.productionPromptVersion.count({ where: { key } })
    };
  }, { isolationLevel: "RepeatableRead" });
}

async function lock(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-prompt:${key}`}))`;
  return tx.productionPromptState.upsert({ where: { key }, create: { key }, update: {} });
}
function assertRevision(actual: number, expected: number) {
  if (actual !== expected) throw new ProductionPromptError("生效版本已被其他管理员更新。草稿已保留，请刷新版本后重新核对。", 409);
}

export async function saveProductionPrompt(key: string, raw: z.infer<typeof productionPromptSaveSchema>, owner: string) {
  assertConnected(key);
  const input = productionPromptSaveSchema.parse(raw);
  const definition = validateProductionDraft(key, { systemPrompt: input.systemPrompt, userTemplate: input.userTemplate });
  const id = `prod_prompt_${crypto.createHash("sha256").update(`${key}:${owner}:${input.requestId}`).digest("hex").slice(0, 48)}`;
  return prisma.$transaction(async tx => {
    const state = await lock(tx, key);
    const existing = await tx.productionPromptVersion.findUnique({ where: { id } });
    if (existing) {
      const saved = existing.definition as unknown as ProductionPromptDefinition;
      if (saved.systemPrompt !== definition.systemPrompt || saved.userTemplate !== definition.userTemplate || existing.notes !== input.notes) throw new ProductionPromptError("同一保存请求的内容已改变，请创建新的保存请求", 409);
      return { id, number: existing.number };
    }
    assertRevision(state.revision, input.expectedRevision);
    const latest = await tx.productionPromptVersion.aggregate({ where: { key }, _max: { number: true } });
    const number = (latest._max.number ?? 0) + 1;
    await tx.productionPromptVersion.create({ data: { id, key, number, owner, notes: input.notes, definition: { ...definition, version: `${definition.version}+custom.${number}` } as unknown as Prisma.InputJsonValue } });
    return { id, number };
  }, { timeout: 15000 });
}

export async function activateProductionPrompt(key: string, input: z.infer<typeof productionPromptActivateSchema>) {
  assertConnected(key);
  return prisma.$transaction(async tx => {
    const state = await lock(tx, key);
    assertRevision(state.revision, input.expectedRevision);
    if (input.versionId) {
      const version = await tx.productionPromptVersion.findUnique({ where: { id: input.versionId } });
      if (!version || version.key !== key) throw new ProductionPromptError("版本不属于此提示词", 400);
      checkedStored(key, version);
    }
    if (state.activeVersionId === input.versionId) return state;
    return tx.productionPromptState.update({ where: { key }, data: { activeVersionId: input.versionId, revision: { increment: 1 } } });
  }, { timeout: 15000 });
}

export function previewProductionPrompt(key: string, draft: ProductionPromptDraft, variables: Record<string, unknown>) {
  const definition = validateProductionDraft(key, draft);
  try {
    const rendered = materializePrompt(key, variables, definition);
    return { systemPrompt: rendered.systemPrompt, userPrompt: rendered.userPrompt, characters: rendered.systemPrompt.length + rendered.userPrompt.length };
  } catch (error) { throw new ProductionPromptError(error instanceof Error ? error.message : "变量渲染失败"); }
}

// One immutable pointer lookup per generation, without cache or silent fallback on DB failure.
export async function resolveProductionPrompt(key: string) {
  assertConnected(key);
  const state = await prisma.productionPromptState.findUnique({ where: { key } });
  if (!state?.activeVersionId) return builtin(key);
  const version = await prisma.productionPromptVersion.findUnique({ where: { id: state.activeVersionId } });
  if (!version) throw new ProductionPromptError("生效提示词版本缺失", 409);
  return checkedStored(key, version);
}
export async function materializeProductionPrompt(key: string, variables: Record<string, unknown>) {
  return materializePrompt(key, variables, await resolveProductionPrompt(key));
}
