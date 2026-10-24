import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ProjectWorkflow } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { readProviderRoutingState } from "../db/mappers.js";
import { runMediaTask } from "../billing/mediaTask.js";
import { readStoredAsset } from "../storage/objectStorage.js";
import { buildVoiceCues, createTtsAudioAsset, type TtsAudioAsset, type TtsRuntime } from "./videoComposer.js";

export type NarrationQuote = {
  providerId: string; providerName: string; model: string; characters: number;
  estimatedCredits: number; unitCredits: number; unit: "tts_character"; cached: boolean; cueCount: number;
};

type NarrationDependencies = {
  synthesize?: typeof createTtsAudioAsset;
  verifyAudio?: (url: string) => Promise<unknown>;
  maximumCredits?: number;
};

async function narrationPlan(workflow: ProjectWorkflow, userId: string, db: PrismaClient) {
  if (!await db.project.findFirst({ where: { id: workflow.project.id, userId }, select: { id: true } })) throw new Error("项目不存在或无权访问");
  const cues = buildVoiceCues(workflow);
  const characters = cues.reduce((sum, cue) => sum + Array.from(cue.text).length, 0);
  let runtime: TtsRuntime | undefined;
  let unitCredits = 0;
  let providerName = "无对白静音音轨";
  let configurationError: string | undefined;
  if (characters) {
    const provider = await db.modelProvider.findUnique({ where: { id: "dashscope-tts" } });
    if (!provider || provider.modality !== "tts" || !provider.models.length) throw new Error("请管理员启用并配置 dashscope-tts 配音渠道");
    if (!provider.enabled) configurationError = "请管理员启用并配置 dashscope-tts 配音渠道";
    const model = readProviderRoutingState(provider.capability, provider.models).preferredModel;
    if (!model || !provider.models.includes(model)) throw new Error("配音模型未配置");
    const price = await db.modelPrice.findFirst({ where: { providerId: provider.id, model, modality: "tts", enabled: true } });
    if (!price || price.unit !== "tts_character" || !Number.isSafeInteger(price.unitCredits) || price.unitCredits < 0) configurationError = "配音模型尚未配置有效的按字符积分价格";
    const apiKey = provider.apiKey || process.env.DASHSCOPE_TTS_API_KEY || process.env.TTS_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_TEXT_API_KEY;
    if (!apiKey) configurationError = "配音渠道缺少 API Key，请管理员完成配置";
    const baseUrl = provider.baseUrl || "https://dashscope.aliyuncs.com/api/v1";
    runtime = { providerId: "dashscope-tts", apiKey: apiKey ?? "", baseUrl, model, defaultVoice: process.env.DASHSCOPE_TTS_DEFAULT_VOICE || process.env.TTS_VOICE || "Cherry" };
    unitCredits = price?.unitCredits ?? 0;
    providerName = provider.name;
  }
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ version: 1, projectId: workflow.project.id,
    provider: runtime?.providerId ?? "silence", model: runtime?.model ?? "silence", baseUrl: runtime?.baseUrl,
    language: process.env.DASHSCOPE_TTS_LANGUAGE_TYPE || process.env.TTS_LANGUAGE || "Chinese",
    cues: cues.map(cue => ({ text: cue.text, duration: cue.duration, voice: cue.voice || runtime?.defaultVoice })) })).digest("hex");
  const assetId = `audio_tts_${fingerprint}`;
  const cached = await readCachedNarration(assetId, workflow.project.id, db);
  if (!cached && configurationError) throw new Error(configurationError);
  const credits = characters * unitCredits;
  if (!Number.isSafeInteger(credits) || credits > 2147483647) throw new Error("配音预算过大，请按集或选择部分镜头导出");
  const quote: NarrationQuote = { providerId: runtime?.providerId ?? "silence", providerName, model: runtime?.model ?? "silence", characters,
    estimatedCredits: cached ? 0 : credits, unitCredits, unit: "tts_character", cached: Boolean(cached), cueCount: cues.filter(cue => cue.text).length };
  return { runtime, quote, fingerprint, assetId, cached };
}

async function readCachedNarration(assetId: string, projectId: string, db: PrismaClient): Promise<TtsAudioAsset | null> {
  const asset = await db.asset.findFirst({ where: { id: assetId, projectId, status: "succeeded" } });
  if (!asset?.referenceUrl) return null;
  try {
    const metadata = JSON.parse(asset.description);
    if (metadata.kind === "tts_cache" && metadata.audio?.audioUrl === asset.referenceUrl) return metadata.audio as TtsAudioAsset;
  } catch { /* Older unstructured audio assets are not reusable cache entries. */ }
  return null;
}

export async function quoteProjectNarration(workflow: ProjectWorkflow, userId: string, db: PrismaClient = prisma): Promise<NarrationQuote> {
  return (await narrationPlan(workflow, userId, db)).quote;
}

/** Persist the complete narration and settle its reservation together. MP4 retries
 * reuse this asset even when a later FFmpeg step failed. No credentials enter metadata. */
export async function getOrCreatePaidNarration(workflow: ProjectWorkflow, userId: string, db: PrismaClient = prisma, dependencies: NarrationDependencies = {}) {
  const plan = await narrationPlan(workflow, userId, db);
  if (plan.quote.estimatedCredits > (dependencies.maximumCredits ?? 0)) throw new Error("配音价格或内容已变化，请重新获取报价并确认积分上限。");
  const verifyAudio = dependencies.verifyAudio ?? readStoredAsset;
  if (plan.cached) {
    try { await verifyAudio(plan.cached.audioUrl); } catch { throw new Error("已付费配音文件缺失，请管理员恢复存储备份后重试；未重复扣费。"); }
    return plan.cached;
  }
  return runMediaTask({ userId, projectId: workflow.project.id, projectName: workflow.project.name, type: "tts",
    scope: `tts:${plan.fingerprint}`, provider: plan.quote.providerId, model: plan.quote.model,
    estimatedCredits: plan.quote.estimatedCredits, title: "生成项目配音" }, async context => {
    // The previous request may have committed while this request acquired its lease.
    const cached = await readCachedNarration(plan.assetId, workflow.project.id, db);
    if (cached) { await verifyAudio(cached.audioUrl); return (await context.complete(0, async () => ({ audio: cached }))).audio; }
    const audio = await (dependencies.synthesize ?? createTtsAudioAsset)(workflow, plan.runtime);
    if (audio.provider !== plan.quote.providerId) throw new Error("配音结果与已报价渠道不一致，未接受替代模型或占位配音");
    await verifyAudio(audio.audioUrl);
    return (await context.complete(plan.quote.estimatedCredits, async (tx, settledCredits) => {
      await tx.asset.create({ data: { id: plan.assetId, projectId: workflow.project.id, type: "audio", name: "项目配音音轨",
        description: JSON.stringify({ kind: "tts_cache", audio }), prompt: "已按确认模型生成并与镜头时长对齐", referenceUrl: audio.audioUrl, status: "succeeded" } });
      await tx.asset.create({ data: { id: `${plan.assetId}_manifest`, projectId: workflow.project.id, type: "audio_manifest", name: "配音清单",
        description: "配音来源、时长与角色信息", prompt: "配音清单", referenceUrl: audio.manifestUrl, status: "succeeded" } });
      await tx.project.update({ where: { id: workflow.project.id }, data: { creditsSpent: { increment: settledCredits } } });
      return { audio };
    })).audio;
  }, db);
}
