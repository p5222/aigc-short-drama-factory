import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ModelQuotaStatus } from "@aifilm/shared";
import { storageRoot } from "../storage/objectStorage.js";

interface ModelQuotaState {
  submissions: number;
  blockedUntil?: string;
  lastError?: string;
  updatedAt?: string;
}

interface ProviderQuotaState {
  [model: string]: ModelQuotaState;
}

interface QuotaStateFile {
  day: string;
  providers: Record<string, ProviderQuotaState>;
}

const quotaStatePath = resolve(storageRoot, "system", "model-quota-state.json");

export async function getModelQuotaDecision(provider: string, model: string) {
  const state = await readQuotaState();
  return quotaDecisionFromState(state, provider, model);
}

export async function recordModelSubmission(provider: string, model: string) {
  const state = await readQuotaState();
  const entry = ensureEntry(state, provider, model);
  entry.submissions += 1;
  entry.updatedAt = new Date().toISOString();
  await writeQuotaState(state);
}

export async function blockModelUntilNextDay(provider: string, model: string, reason: string) {
  const state = await readQuotaState();
  const entry = ensureEntry(state, provider, model);
  entry.blockedUntil = nextBeijingDayStart().toISOString();
  entry.lastError = reason.slice(0, 500);
  entry.updatedAt = new Date().toISOString();
  await writeQuotaState(state);
}

export async function coolDownModel(
  provider: string,
  model: string,
  reason: string,
  cooldownMs = Number(process.env.VIDEO_MODEL_RATE_LIMIT_COOLDOWN_MS ?? 120_000)
) {
  const state = await readQuotaState();
  const entry = ensureEntry(state, provider, model);
  entry.blockedUntil = new Date(Date.now() + Math.max(30_000, cooldownMs)).toISOString();
  entry.lastError = reason.slice(0, 500);
  entry.updatedAt = new Date().toISOString();
  await writeQuotaState(state);
}

export async function getProviderQuotaSnapshot(provider: string, models: string[]): Promise<ModelQuotaStatus[]> {
  const state = await readQuotaState();
  return uniqueModels(models).map((model) => quotaSnapshotFromState(state, provider, model));
}

function ensureEntry(state: QuotaStateFile, provider: string, model: string) {
  state.providers[provider] ??= {};
  state.providers[provider][model] ??= { submissions: 0 };
  return state.providers[provider][model];
}

async function readQuotaState(): Promise<QuotaStateFile> {
  const day = currentBeijingDay();
  try {
    const parsed = JSON.parse(await readFile(quotaStatePath, "utf8")) as QuotaStateFile;
    if (parsed.day === day && parsed.providers) return parsed;
  } catch {
    // Missing or invalid state should not block generation.
  }
  return { day, providers: {} };
}

async function writeQuotaState(state: QuotaStateFile) {
  await mkdir(dirname(quotaStatePath), { recursive: true });
  await writeFile(quotaStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function quotaDecisionFromState(state: QuotaStateFile, provider: string, model: string) {
  const snapshot = quotaSnapshotFromState(state, provider, model);
  return {
    available: snapshot.available,
    reason: snapshot.reason,
    submissions: snapshot.submissions,
    dailyLimit: snapshot.dailyLimit
  };
}

function quotaSnapshotFromState(state: QuotaStateFile, provider: string, model: string): ModelQuotaStatus {
  const entry = state.providers[provider]?.[model];
  const now = Date.now();
  const blockedUntilMs = entry?.blockedUntil ? new Date(entry.blockedUntil).getTime() : 0;
  const dailyLimit = dailyTaskLimit(provider, model);
  const coolingDown = blockedUntilMs > now;
  const dailyCapped = dailyLimit !== undefined && (entry?.submissions ?? 0) >= dailyLimit;
  const available = !coolingDown && !dailyCapped;
  const reason = coolingDown
    ? `冷却中，直到 ${entry?.blockedUntil}${entry?.lastError ? `；原因：${entry.lastError}` : ""}`
    : dailyCapped
      ? `今日已达到本地提交上限 ${dailyLimit}，会自动切换到下一个模型`
      : undefined;
  return {
    model,
    submissions: entry?.submissions ?? 0,
    dailyLimit,
    blockedUntil: entry?.blockedUntil,
    lastError: entry?.lastError,
    updatedAt: entry?.updatedAt,
    available,
    coolingDown,
    reason
  };
}

function currentBeijingDay() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function nextBeijingDayStart() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const nextUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0) - 8 * 60 * 60 * 1000;
  return new Date(nextUtcMs);
}

function dailyTaskLimit(provider: string, model: string) {
  const maps = [
    parseLimitMap(process.env.VIDEO_MODEL_DAILY_TASK_LIMITS),
    provider === "doubao-seedance" ? parseLimitMap(process.env.DOUBAO_SEEDANCE_DAILY_TASK_LIMITS) : {},
    provider === "dashscope-video" ? parseLimitMap(process.env.DASHSCOPE_VIDEO_DAILY_TASK_LIMITS) : {},
    provider === "dashscope-image" ? parseLimitMap(process.env.DASHSCOPE_IMAGE_DAILY_TASK_LIMITS) : {},
    provider === "dashscope-text" ? parseLimitMap(process.env.DASHSCOPE_TEXT_DAILY_TASK_LIMITS) : {},
    provider === "dashscope-tts" ? parseLimitMap(process.env.DASHSCOPE_TTS_DAILY_TASK_LIMITS) : {}
  ];
  for (const map of maps) {
    const value = map[`${provider}:${model}`] ?? map[model] ?? map[provider];
    if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
  }
  return undefined;
}

function parseLimitMap(raw?: string) {
  const result: Record<string, number> = {};
  if (!raw?.trim()) return result;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number") result[key] = value;
      if (typeof value === "object" && value) {
        for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
          if (typeof childValue === "number") result[`${key}:${childKey}`] = childValue;
        }
      }
    }
    return result;
  } catch {
    // Also support "modelA=20,modelB=10".
  }
  raw.split(/[;,]/).forEach((part) => {
    const [key, value] = part.split("=").map((item) => item.trim());
    const limit = Number(value);
    if (key && Number.isFinite(limit)) result[key] = limit;
  });
  return result;
}

function uniqueModels(models: string[]) {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}
