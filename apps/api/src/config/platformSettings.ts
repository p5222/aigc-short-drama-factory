import type { Prisma, PrismaClient } from "@prisma/client";
import { platformSettingGroups, readProviderConnection, assertProviderConnection, type SettingGroup, type SettingValue, type PlatformSettingView, type PlatformSettingUpdate } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { encryptSettingSecret, decryptSettingSecret, settingsEncryptionReady } from "./secrets.js";
import { wechatConfig } from "../billing/wechat.js";

type Db = Pick<Prisma.TransactionClient, "platformSetting">;
export class SettingsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function definition(group: string) {
  const item = platformSettingGroups.find(item => item.id === group);
  if (!item) throw new SettingsError(404, "配置分组不存在。");
  return item;
}
function resolveValues(group: SettingGroup, stored: Record<string, SettingValue>, env: NodeJS.ProcessEnv) {
  const values: Record<string, SettingValue> = {};
  const sources: PlatformSettingView["sources"] = {};
  for (const field of definition(group).fields) {
    const raw = field.env ? env[field.env] : undefined;
    sources[field.key] = field.key in stored ? "database" : raw?.trim() ? "environment" : field.defaultValue !== undefined ? "default" : "empty";
    const value = stored[field.key] ?? (raw?.trim() ? raw : field.defaultValue ?? "");
    values[field.key] = field.type === "secret" && field.key in stored ? decryptSettingSecret(String(value), `${group}:${field.key}`)
      : field.type === "boolean" ? value === true || value === "true"
      : field.type === "number" ? Number(value) : value;
  }
  return { values, sources };
}
export async function effectiveSettings(group: SettingGroup, db: Db = prisma) {
  const row = await db.platformSetting.findUnique({ where: { key: group } });
  return resolveValues(group, (row?.values || {}) as Record<string, SettingValue>, process.env).values;
}
export async function settingsEnvironment(group: SettingGroup, db: Db = prisma) {
  const values = await effectiveSettings(group, db);
  return Object.fromEntries(definition(group).fields.filter(field => field.env).map(field => [field.env!, String(values[field.key] ?? "")])) as NodeJS.ProcessEnv;
}
export async function readPlatformSettings(group: SettingGroup, db: Db = prisma): Promise<PlatformSettingView> {
  const row = await db.platformSetting.findUnique({ where: { key: group } });
  const { values, sources } = resolveValues(group, (row?.values || {}) as Record<string, SettingValue>, process.env);
  const secrets: Record<string, boolean> = {};
  for (const field of definition(group).fields.filter(field => field.type === "secret")) {
    secrets[field.key] = Boolean(values[field.key]);
    delete values[field.key];
  }
  return { group, version: row?.version ?? 0, values, sources, secrets, encryptionReady: settingsEncryptionReady(), updatedAt: row?.updatedAt.toISOString() };
}
export async function lockPaymentConfiguration(tx: Prisma.TransactionClient, shared = false) {
  if (shared) await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock_shared(hashtext('platform:payment-configuration'))`;
  else await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext('platform:payment-configuration'))`;
}
export async function updatePlatformSettings(group: SettingGroup, input: PlatformSettingUpdate, actorId: string, db: PrismaClient = prisma) {
  const spec = definition(group);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !input.values || Array.isArray(input.values)) throw new SettingsError(400, "配置版本或字段格式无效。");
  return db.$transaction(async tx => {
    if (group === "payment") await lockPaymentConfiguration(tx);
    else await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`platform:settings:${group}`}))`;
    const current = await tx.platformSetting.findUnique({ where: { key: group } });
    if ((current?.version ?? 0) !== input.expectedVersion) throw new SettingsError(409, "配置已被其他管理员更新。请刷新后重新编辑，当前草稿未保存。");
    const stored = { ...((current?.values || {}) as Record<string, SettingValue>) };
    for (const [name, value] of Object.entries(input.values)) {
      const field = spec.fields.find(field => field.key === name);
      if (!field) throw new SettingsError(400, "包含未知配置字段。");
      if (value === null) { delete stored[name]; continue; }
      if (field.type === "boolean" ? typeof value !== "boolean" : field.type === "number" ? typeof value !== "number" : typeof value !== "string") throw new SettingsError(400, `${field.label}格式无效。`);
      if (typeof value === "string" && value.length > 32000) throw new SettingsError(400, `${field.label}过长。`);
      if (field.type === "secret") {
        if (!String(value).trim()) throw new SettingsError(400, "密钥留空表示保留，请使用恢复服务器配置来清除后台覆盖。");
        stored[name] = encryptSettingSecret(String(value).trim(), `${group}:${name}`);
      } else stored[name] = typeof value === "string" ? value.trim() : value;
    }
    const next = resolveValues(group, stored, process.env).values;
    if (group === "email") {
      if (!Number.isInteger(next.port) || Number(next.port) < 1 || Number(next.port) > 65535) throw new SettingsError(400, "SMTP 端口必须在 1–65535 之间。");
      if (!/^[a-z0-9.-]+$/i.test(String(next.host)) || (next.user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(next.user)))) throw new SettingsError(400, "SMTP 服务器或发件邮箱格式无效。");
    }
    if (group === "routing") {
      for (const field of spec.fields) {
        if (!next[field.key]) continue;
        const provider = await tx.modelProvider.findUnique({ where: { id: String(next[field.key]) } });
        if (!provider?.enabled || provider.modality !== field.modality || !provider.models.length) throw new SettingsError(400, `${field.label}需要选择已启用且有模型的渠道。`);
        assertProviderConnection(readProviderConnection(provider.id, provider.modality, provider.capability), provider.modality);
      }
    }
    if (group === "payment") {
      const before = resolveValues(group, (current?.values || {}) as Record<string, SettingValue>, process.env).values;
      const changed = spec.fields.some(field => field.key !== "enabled" && next[field.key] !== before[field.key]);
      if (changed && await tx.rechargeOrder.count({ where: { channel: "wechat", status: "pending", amountFen: { not: null } } })) throw new SettingsError(409, "存在待确认微信订单，请先完成对账再更换支付凭据或商户配置；可单独暂停新收款。");
      if (next.enabled) {
        const env = Object.fromEntries(spec.fields.map(field => [field.env!, String(next[field.key])]));
        wechatConfig(env);
      }
    }
    await tx.platformSetting.upsert({ where: { key: group }, create: { key: group, values: stored, version: 1, updatedBy: actorId },
      update: { values: stored, version: { increment: 1 }, updatedBy: actorId } });
    return readPlatformSettings(group, tx);
  });
}

/** Disabling new sales must not disable signature verification or reconciliation. */
export async function effectiveWechatConfig(acceptNewOrders = false, db: Db = prisma) {
  const env = await settingsEnvironment("payment", db);
  if (acceptNewOrders && env.WECHAT_PAY_ENABLED !== "true") return null;
  if (!acceptNewOrders && !env.WECHAT_PAY_MCH_ID) return null;
  return wechatConfig({ ...env, WECHAT_PAY_ENABLED: "true" });
}

export async function applyDefaultModelRoutes<T extends { textProvider?: string; textModel?: string; imageProvider?: string; imageModel?: string; videoProvider?: string; videoModel?: string }>(
  input: T, db: Pick<Prisma.TransactionClient, "platformSetting" | "modelProvider"> = prisma
): Promise<T> {
  const defaults = await effectiveSettings("routing", db);
  const result = { ...input };
  for (const modality of ["text", "image", "video"] as const) {
    const providerKey = `${modality}Provider` as const;
    const modelKey = `${modality}Model` as const;
    if (result[providerKey] || !defaults[providerKey]) continue;
    const id = String(defaults[providerKey]);
    const provider = await db.modelProvider.findUnique({ where: { id } });
    if (!provider?.enabled || provider.modality !== modality) throw new SettingsError(409, "默认模型渠道已停用，请管理员重新选择默认渠道。");
    result[providerKey] = id;
    if (!result[modelKey]) {
      const routing = (provider.capability as { routing?: { preferredModel?: string } }).routing;
      result[modelKey] = provider.models.includes(routing?.preferredModel || "") ? routing!.preferredModel : provider.models[0];
    }
  }
  return result;
}
