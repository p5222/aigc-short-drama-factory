import crypto from "node:crypto";
import type { GenerationTask, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.js";
import { assertIndependentImageBatch, lockMediaProject, mediaSourceIsCurrent, MediaSourceConflict, readMediaSource, TERMINAL_MEDIA_STATUSES, type MediaSourceSnapshot } from "../db/mediaSource.js";
import { lockTaskCredits, releaseTaskCredits, reserveTaskCredits, settleTaskCredits } from "./taskCredits.js";

type MediaTaskInput = {
  userId: string; projectId: string; projectName: string; type: string; scope: string;
  provider: string; model: string; estimatedCredits: number; title: string; resume?: boolean; source?: MediaSourceSnapshot;
};
type FinalOptions<T extends object> = { status?: "succeeded" | "failed"; errorReason?: string | null; onStale?: (tx: Prisma.TransactionClient) => Promise<T> };
export type MediaTaskContext = {
  taskId: string; task: GenerationTask;
  checkpoint(metadata: Record<string, unknown>): Promise<void>;
  defer(metadata: Record<string, unknown>): Promise<GenerationTask>;
  complete<T extends object>(credits: number, persist: (tx: Prisma.TransactionClient, settledCredits: number) => Promise<T>, options?: FinalOptions<T>): Promise<T & { task: GenerationTask }>;
};

export function assertProductionMediaProvider(
  provider: { enabled: boolean; modality: string; models: string[] } | null,
  providerId: string, model: string, modality: "text" | "image" | "video"
) {
  if (provider && (!provider.enabled || provider.modality !== modality || !provider.models.includes(model))) {
    throw new Error("所选模型已停用或不属于当前渠道，请重新选择可用模型。");
  }
  if (process.env.NODE_ENV === "production" && (!provider || /mock|embedded|local/i.test(providerId))) {
    throw new Error("正式生成需要已启用的真实模型渠道，当前配置不可用于生产。");
  }
}

export function mediaCheckpoint(task: Pick<GenerationTask, "errorReason">): Record<string, unknown> {
  try {
    const parsed = JSON.parse(task.errorReason ?? "{}");
    return parsed?.kind === "media_checkpoint" && parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : {};
  } catch { return {}; }
}

/** Durable reservation + lease for request-driven media work. Remote videos keep
 * their reservation while pending and reuse the same task when the user refreshes.
 */
export async function runMediaTask<T>(input: MediaTaskInput, run: (context: MediaTaskContext) => Promise<T>, db: PrismaClient = prisma): Promise<T> {
  const jobId = `media:${input.scope}`;
  const leaseId = crypto.randomUUID();
  const task = await db.$transaction(async (tx) => {
    await lockMediaProject(tx, input.projectId, input.userId);
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`${input.userId}:${input.projectId}:${jobId}`}))`;
    const existing = await tx.generationTask.findFirst({
      where: { userId: input.userId, projectId: input.projectId, jobId, status: { in: ["pending", "running"] } },
      orderBy: { createdAt: "desc" }
    });
    if (existing?.status === "running" && existing.updatedAt.getTime() > Date.now() - 120_000) throw new Error("该阶段正在生成，请等待当前任务完成，避免重复扣费。");
    const active = await tx.generationTask.findMany({
      where: { projectId: input.projectId, status: { notIn: TERMINAL_MEDIA_STATUSES }, ...(existing ? { id: { not: existing.id } } : {}) },
      select: { type: true, jobId: true }
    });
    // Independent video shots may render together. Source-changing modalities are exclusive.
    if (active.some(other => !(input.type === "video" && jobId.startsWith("media:video:") && other.type === "video" && other.jobId?.startsWith("media:video:") && other.jobId !== jobId))) {
      throw new MediaSourceConflict("项目有其他生成任务正在使用素材，请等待完成后再更换生成阶段。");
    }
    if (existing) {
      const recent = existing.updatedAt.getTime() > Date.now() - 120_000;
      if (existing.status === "running" && recent) throw new Error("该阶段正在生成，请等待当前任务完成，避免重复扣费。");
      await lockTaskCredits(tx, existing.id, input.userId);
      if (input.resume && (mediaCheckpoint(existing).remoteTaskId || mediaCheckpoint(existing).remoteVideoUrl)) {
        return tx.generationTask.update({ where: { id: existing.id }, data: {
          status: "running", progress: 25,
          errorReason: JSON.stringify({ kind: "media_checkpoint", metadata: { ...mediaCheckpoint(existing), leaseId } })
        } });
      }
      if (input.resume) {
        throw new Error("上次视频提交尚未确认结果，请联系管理员核对上游任务后再重试，以免重复提交。");
      }
      // A persisted source means a production media request may already have reached its provider.
      // Without a remote checkpoint it is unsafe to replace an expired image/reference lease.
      if (input.source || readMediaSource((existing.requestPayload as { source?: unknown } | null)?.source)) {
        throw new MediaSourceConflict("上次生成请求尚未确认结果，请先核对供应商任务，不能自动重新提交以免重复产生费用。");
      }
      await releaseTaskCredits(tx, { taskId: existing.id, userId: input.userId, description: "生成进程中断，释放任务冻结积分" });
      await tx.generationTask.update({ where: { id: existing.id }, data: { status: "failed", errorReason: "生成进程中断，未交付的任务积分已释放。" } });
    }
    if (input.source && (input.source.projectId !== input.projectId || !await mediaSourceIsCurrent(tx, input.userId, input.source))) {
      throw new MediaSourceConflict("镜头或参考素材已变化，请刷新后重新确认生成。");
    }
    if (input.source) await assertIndependentImageBatch(tx, input.source);
    const created = await tx.generationTask.create({ data: {
      id: `task_${crypto.randomUUID()}`, userId: input.userId, projectId: input.projectId,
      projectName: input.projectName, type: input.type, title: input.title, provider: input.provider,
      model: input.model, estimatedCredits: input.estimatedCredits, status: "running", progress: 10, jobId,
      ...(input.source ? { requestPayload: { kind: "media_source", source: JSON.parse(JSON.stringify(input.source)) } } : {}),
      errorReason: JSON.stringify({ kind: "media_checkpoint", metadata: { leaseId } })
    } });
    await reserveTaskCredits(tx, { taskId: created.id, userId: input.userId });
    return created;
  });
  let finalized = false;
  let checkpoint = mediaCheckpoint(task);
  const requestPayload = task.requestPayload as { source?: unknown } | null;
  const originalSource = readMediaSource(requestPayload?.source);
  const heartbeat = setInterval(() => {
    void db.generationTask.updateMany({ where: { id: task.id, status: "running", errorReason: { contains: leaseId } }, data: { updatedAt: new Date() } }).catch(() => undefined);
  }, 20_000);
  heartbeat.unref();
  async function saveCheckpoint(metadata: Record<string, unknown>, status: "running" | "pending") {
    checkpoint = { ...checkpoint, ...metadata };
    return db.$transaction(async (tx) => {
      const { task: latest } = await lockTaskCredits(tx, task.id, input.userId);
      if (mediaCheckpoint(latest).leaseId !== leaseId || latest.status !== "running") throw new Error("任务已由新的请求接管，请刷新查看最新进度。");
      return tx.generationTask.update({ where: { id: task.id }, data: {
        status, errorReason: JSON.stringify({ kind: "media_checkpoint", metadata: checkpoint }), progress: status === "pending" ? 35 : 25
      } });
    });
  }
  try {
    const result = await run({
      taskId: task.id, task,
      checkpoint: async (metadata) => { await saveCheckpoint(metadata, "running"); },
      defer: async (metadata) => { const pending = await saveCheckpoint(metadata, "pending"); finalized = true; return pending; },
      complete: async (credits, persist, options = {}) => {
        const result = await db.$transaction(async (tx) => {
          await lockMediaProject(tx, input.projectId, input.userId);
          const locked = await lockTaskCredits(tx, task.id, input.userId);
          if (locked.task.status !== "running" || mediaCheckpoint(locked.task).leaseId !== leaseId) throw new Error("生成任务状态已变化，本次结果未提交，请刷新任务。");
          // A definitive provider failure has no output to promote and can always release its reservation.
          const noOutputFailure = options.status === "failed" && credits === 0;
          const sourceCurrent = noOutputFailure || (!input.source && !originalSource) || Boolean(originalSource && await mediaSourceIsCurrent(tx, input.userId, originalSource));
          if (!sourceCurrent && !options.onStale) throw new MediaSourceConflict("生成输入已变化，结果暂未覆盖当前素材，请核对任务后恢复。");
          const settlement = await settleTaskCredits(tx, { taskId: task.id, userId: input.userId, finalCredits: sourceCurrent ? credits : 0 });
          if (!settlement.applied) throw new Error("该生成任务已处理，不能重复结算。");
          const saved = sourceCurrent ? await persist(tx, settlement.credits) : await options.onStale!(tx);
          const finalMessage = sourceCurrent ? options.errorReason : "生成期间输入已变化，结果已保留为历史素材，未扣费；请基于当前素材重新确认生成。";
          const completed = await tx.generationTask.update({ where: { id: task.id }, data: {
            status: sourceCurrent ? options.status ?? "succeeded" : "failed", progress: 100,
            errorReason: JSON.stringify({ kind: "media_checkpoint", metadata: { ...checkpoint, completed: true, sourceStale: !sourceCurrent, lastError: finalMessage ?? undefined } })
          } });
          return { ...saved, task: completed };
        }, { timeout: 30_000 });
        finalized = true;
        return result;
      }
    });
    if (!finalized) throw new Error("媒体任务未记录最终状态");
    return result;
  } catch (error) {
    if (!finalized) {
      const message = error instanceof Error ? error.message : "媒体生成失败";
      await db.$transaction(async (tx) => {
        const { task: latest } = await lockTaskCredits(tx, task.id, input.userId);
        if (!["pending", "running"].includes(latest.status) || mediaCheckpoint(latest).leaseId !== leaseId) return;
        if (input.resume && (checkpoint.remoteTaskId || checkpoint.remoteVideoUrl || checkpoint.submissionStarted)) {
          await tx.generationTask.update({ where: { id: task.id }, data: {
            status: "pending", errorReason: JSON.stringify({ kind: "media_checkpoint", metadata: { ...checkpoint, lastError: message } })
          } });
          return;
        }
        await releaseTaskCredits(tx, { taskId: task.id, userId: input.userId, description: "媒体生成失败，释放该任务冻结积分" });
        await tx.generationTask.update({ where: { id: task.id }, data: { status: "failed", progress: 0, errorReason: message } });
      });
    }
    throw error;
  } finally { clearInterval(heartbeat); }
}
