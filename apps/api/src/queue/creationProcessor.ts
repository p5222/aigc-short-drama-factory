import crypto from "node:crypto";
import { providerRuntimeOptions } from "../providers/connection.js";
import type { Prisma } from "@prisma/client";
import { DelayedError, UnrecoverableError, type Job } from "bullmq";
import type { CreateProjectInput } from "@aifilm/shared";
import { generateProjectScriptContent, hasTextModelConfig, textModelName, textProviderName } from "../agents/generator.js";
import { withTaskMeter } from "../billing/metering.js";
import { lockTaskCredits, releaseTaskCredits, reserveTaskCredits, settleTaskCredits } from "../billing/taskCredits.js";
import { prisma } from "../db/client.js";
import { assertProductionMediaProvider } from "../billing/mediaTask.js";
import { readProviderRoutingState } from "../db/mappers.js";
import { textSubmissionOutcome, withTextSubmissionGuard } from "../providers/textSubmission.js";
import { creationExecution, creationNeedsReview, CREATION_REVIEW_MESSAGE } from "./creationState.js";

export interface CreationJobData {
  projectId: string;
  taskId: string;
  userId: string;
  input: CreateProjectInput;
  estimatedCredits: number;
}
export type CreationJobResult = { mode: "real" | "local" };
export type CreationJobName = "create-project";
type CreationJob = Pick<Job<CreationJobData, CreationJobResult, CreationJobName>, "id" | "data" | "opts" | "attemptsMade">;
const CREATION_LEASE_MS = 120_000;

export class CreationReviewRequiredError extends Error {
  constructor() { super(CREATION_REVIEW_MESSAGE); this.name = "CreationReviewRequiredError"; }
}
export class CreationLeaseBusyError extends Error {
  readonly retryAfterMs = 30_000;
  constructor() { super("该任务仍由另一个执行进程处理，将稍后检查结果。"); this.name = "CreationLeaseBusyError"; }
}

function creationLeaseId(errorReason: string | null) {
  try { const parsed = JSON.parse(errorReason ?? "{}"); return parsed.kind === "creation_lease" && typeof parsed.leaseId === "string" ? parsed.leaseId : undefined; }
  catch { return undefined; }
}

/** BullMQ must delay a duplicate delivery, not mark it complete or exhaust the
 * model retry budget while the current DB lease still owns the external call. */
export async function processQueuedCreationJob(
  job: CreationJob & Pick<Job, "moveToDelayed">,
  token?: string,
  process: (job: CreationJob) => Promise<CreationJobResult> = processCreationJob
): Promise<CreationJobResult> {
  try { return await process(job); }
  catch (error) {
    if (error instanceof CreationReviewRequiredError) throw new UnrecoverableError(error.message);
    if (!(error instanceof CreationLeaseBusyError)) throw error;
    await job.moveToDelayed(Date.now() + error.retryAfterMs, token);
    throw new DelayedError();
  }
}

export function isFinalCreationAttempt(job: Pick<CreationJob, "opts" | "attemptsMade">) {
  return job.attemptsMade + 1 >= Math.max(1, job.opts.attempts ?? 1);
}

function isInactive(status: string) {
  return ["succeeded", "canceled", "refunded", "failed"].includes(status);
}

/** Injectable dependencies keep worker regression tests independent of Redis and paid providers. */
export async function processCreationJob(
  job: CreationJob,
  dependencies = { db: prisma, generate: generateProjectScriptContent }
): Promise<CreationJobResult> {
  const { projectId, taskId, userId, input } = job.data;
  const db = dependencies.db;
  const leaseId = crypto.randomUUID();
  let hasLease = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const currentTask = await db.generationTask.findFirst({ where: { id: taskId, userId } });
  if (!currentTask || isInactive(currentTask.status) || (currentTask.jobId && job.id && currentTask.jobId !== job.id)) {
    return { mode: "local" };
  }

  try {
    const claimed = await db.$transaction(async (tx) => {
      const { task } = await lockTaskCredits(tx, taskId, userId);
      if (isInactive(task.status) || (task.jobId && job.id && task.jobId !== job.id)) return false;
      if (task.status === "running" && task.updatedAt.getTime() > Date.now() - CREATION_LEASE_MS) throw new CreationLeaseBusyError();
      const execution = creationExecution(task.execution);
      // A legacy running lease has no reliable submission marker. New prepared
      // leases can be reclaimed; submitted leases must never send again.
      if (creationNeedsReview(task) || (task.status === "running" && !execution.attempts.length)) {
        execution.reviewRequired = true;
        const attempt = execution.attempts.at(-1);
        if (attempt?.state === "submitted") attempt.state = "unknown";
        await tx.generationTask.update({ where: { id: taskId }, data: {
          status: "pending", execution: JSON.parse(JSON.stringify(execution)), errorReason: CREATION_REVIEW_MESSAGE
        } });
        return false;
      }
      await reserveTaskCredits(tx, { taskId, userId });
      execution.attempts.push({ id: leaseId, state: "prepared", startedAt: new Date().toISOString() });
      await tx.generationTask.update({ where: { id: taskId }, data: {
        status: "running", progress: 10, errorReason: JSON.stringify({ kind: "creation_lease", leaseId }),
        execution: JSON.parse(JSON.stringify(execution))
      } });
      return true;
    });
    if (!claimed) return { mode: "local" };
    hasLease = true;
    heartbeat = setInterval(() => {
      void db.generationTask.updateMany({ where: { id: taskId, status: "running", errorReason: { contains: leaseId } }, data: { updatedAt: new Date() } }).catch(() => undefined);
    }, 20_000);
    heartbeat.unref();
    const configuredProvider = input.textProvider
      ? await db.modelProvider.findUnique({ where: { id: input.textProvider } })
      : null;
    if (configuredProvider && (!configuredProvider.enabled || configuredProvider.modality !== "text")) {
      throw new Error("所选文本渠道已停用或不支持文本生成，请选择可用渠道后重试。");
    }
    const models = configuredProvider?.models.length ? configuredProvider.models : [input.textModel || textModelName(input)];
    const routing = readProviderRoutingState(configuredProvider?.capability, models);
    const selectedTextModel = input.textModel || routing.preferredModel;
    assertProductionMediaProvider(configuredProvider, input.textProvider || "local", selectedTextModel || "", "text");
    const runtimeInput = {
      ...input,
      textProvider: configuredProvider?.id ?? input.textProvider,
      textModel: selectedTextModel,
      // A paid task uses the quoted model. Automatic fallback must not charge
      // one model's price while delivering another model's output.
      textModelPool: [selectedTextModel].filter((value): value is string => Boolean(value)),
      singleSubmission: true,
      ...providerRuntimeOptions(configuredProvider)
    };
    const realConfig = hasTextModelConfig(runtimeInput);
    if (process.env.NODE_ENV === "production" && !realConfig) throw new Error("文本模型尚未配置，无法开始正式生成。请联系管理员配置可用模型。");

    const canGenerate = await db.$transaction(async (tx) => {
      const { task } = await lockTaskCredits(tx, taskId, userId);
      if (isInactive(task.status) || (task.jobId && job.id && task.jobId !== job.id)) return false;
      if (creationLeaseId(task.errorReason) !== leaseId) throw new CreationLeaseBusyError();
      await tx.generationTask.update({ where: { id: taskId }, data: {
        progress: 20,
        provider: realConfig ? runtimeInput.textProvider || textProviderName(runtimeInput) : "Local Generator",
        model: realConfig ? textModelName(runtimeInput) : "generation-pipeline"
      } });
      return true;
    });
    if (!canGenerate) return { mode: "local" };

    const generated = await withTaskMeter(taskId, () => withTextSubmissionGuard(async () => {
      await db.$transaction(async tx => {
        const { task } = await lockTaskCredits(tx, taskId, userId);
        if (task.status !== "running" || creationLeaseId(task.errorReason) !== leaseId) throw new CreationLeaseBusyError();
        const execution = creationExecution(task.execution), attempt = execution.attempts.at(-1);
        if (!attempt || attempt.id !== leaseId || attempt.state !== "prepared") throw new CreationReviewRequiredError();
        attempt.state = "submitted"; attempt.submittedAt = new Date().toISOString();
        await tx.generationTask.update({ where: { id: taskId }, data: { execution: JSON.parse(JSON.stringify(execution)) } });
      });
    }, () => dependencies.generate(projectId, runtimeInput)), db, leaseId);
    if (process.env.NODE_ENV === "production" && generated.mode !== "real") throw new Error("正式文本任务未返回真实模型结果，未接受本地占位输出。");
    await db.$transaction(async (tx) => {
      const { task } = await lockTaskCredits(tx, taskId, userId);
      if (isInactive(task.status) || (task.jobId && job.id && task.jobId !== job.id)) return;
      if (creationLeaseId(task.errorReason) !== leaseId) throw new CreationLeaseBusyError();
      const execution = creationExecution(task.execution), attempt = execution.attempts.at(-1);
      if (attempt?.id === leaseId) { attempt.state = "delivered"; attempt.finishedAt = new Date().toISOString(); }
      const settlement = await settleTaskCredits(tx, { taskId, userId, attemptId: leaseId });
      if (!settlement.applied) return;
      await tx.scriptDraft.create({ data: {
        id: generated.script.id, projectId, name: generated.script.name,
        content: generated.script.content, synopsis: generated.script.synopsis, version: generated.script.version,
        promptSnapshot: (generated.promptSnapshot ?? {}) as Prisma.InputJsonValue
      } });
      await tx.character.createMany({ data: generated.characters.map((character) => ({
        id: character.id, projectId, name: character.name, identity: character.identity,
        appearance: character.appearance, costume: character.costume, personality: character.personality,
        prompt: character.prompt, negativePrompt: character.negativePrompt, referenceAssetId: character.referenceAssetId,
        voiceId: character.voiceId, seed: character.seed, consistencyLevel: character.consistencyLevel
      })) });
      await tx.asset.createMany({ data: generated.assets.map((asset) => ({
        id: asset.id, projectId, type: asset.type, name: asset.name, description: asset.description,
        prompt: asset.prompt, referenceUrl: asset.referenceUrl, status: asset.status, relatedCharacterId: asset.relatedCharacterId
      })) });
      await tx.project.update({ where: { id: projectId }, data: {
        status: "scripting", intro: generated.script.synopsis, storyboards: 0,
        characters: generated.characters.length, imageAssets: generated.assets.length,
        creditsSpent: { increment: settlement.credits }
      } });
      await tx.generationTask.update({ where: { id: taskId }, data: {
        status: "succeeded", progress: 100, finalCredits: settlement.credits, errorReason: null,
        execution: JSON.parse(JSON.stringify(execution)),
        provider: generated.mode === "real" ? textProviderName(runtimeInput) : "Local Generator",
        model: generated.mode === "real" ? textModelName(runtimeInput) : "local-script-v1"
      } });
    });
    return { mode: generated.mode };
  } catch (error) {
    if (!hasLease || error instanceof CreationLeaseBusyError) throw error;
    let reviewRequired = false;
    await db.$transaction(async (tx) => {
      const { task } = await lockTaskCredits(tx, taskId, userId);
      if (isInactive(task.status) || (task.jobId && job.id && task.jobId !== job.id)) return;
      if (creationLeaseId(task.errorReason) !== leaseId) return;
      const execution = creationExecution(task.execution), attempt = execution.attempts.at(-1);
      if (!attempt || attempt.id !== leaseId) return;
      const outcome = textSubmissionOutcome(error);
      reviewRequired = (attempt.state === "submitted" && outcome !== "rejected") || error instanceof CreationReviewRequiredError;
      attempt.state = reviewRequired ? "unknown" : outcome === "rejected" ? "rejected" : "not_submitted";
      attempt.finishedAt = new Date().toISOString();
      execution.reviewRequired = reviewRequired;
      if (reviewRequired) {
        await tx.generationTask.update({ where: { id: taskId }, data: {
          status: "pending", errorReason: CREATION_REVIEW_MESSAGE, execution: JSON.parse(JSON.stringify(execution))
        } });
        return;
      }
      const finalAttempt = isFinalCreationAttempt(job);
      if (finalAttempt) await releaseTaskCredits(tx, { taskId, userId, description: "生成重试已用尽，退回该任务冻结积分" });
      await tx.generationTask.update({ where: { id: taskId }, data: {
        status: finalAttempt ? "failed" : "pending", progress: 0,
        execution: JSON.parse(JSON.stringify(execution)),
        errorReason: finalAttempt
          ? "生成请求未提交或已被供应商明确拒绝，未交付积分已释放。请检查渠道配置后重试。"
          : `请求未提交或已被明确拒绝，正在重试（${job.attemptsMade + 1}/${job.opts.attempts ?? 1}）。`
      } });
    });
    if (reviewRequired) throw new CreationReviewRequiredError();
    throw error;
  } finally { if (heartbeat) clearInterval(heartbeat); }
}
