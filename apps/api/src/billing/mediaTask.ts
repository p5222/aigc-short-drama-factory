import crypto from "node:crypto";
import type { GenerationTask, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.js";
import { lockTaskCredits, releaseTaskCredits, reserveTaskCredits, settleTaskCredits } from "./taskCredits.js";

type MediaTaskInput = {
  userId: string; projectId: string; projectName: string; type: string; scope: string;
  provider: string; model: string; estimatedCredits: number; title: string; resume?: boolean;
};
type FinalOptions = { status?: "succeeded" | "failed"; errorReason?: string | null };
export type MediaTaskContext = {
  taskId: string; task: GenerationTask;
  checkpoint(metadata: Record<string, unknown>): Promise<void>;
  defer(metadata: Record<string, unknown>): Promise<GenerationTask>;
  complete<T extends object>(credits: number, persist: (tx: Prisma.TransactionClient) => Promise<T>, options?: FinalOptions): Promise<T & { task: GenerationTask }>;
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
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`${input.userId}:${input.projectId}:${jobId}`}))`;
    const existing = await tx.generationTask.findFirst({
      where: { userId: input.userId, projectId: input.projectId, jobId, status: { in: ["pending", "running"] } },
      orderBy: { createdAt: "desc" }
    });
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
      await releaseTaskCredits(tx, { taskId: existing.id, userId: input.userId, description: "生成进程中断，释放任务冻结积分" });
      await tx.generationTask.update({ where: { id: existing.id }, data: { status: "failed", errorReason: "生成进程中断，未交付的任务积分已释放。" } });
    }
    const created = await tx.generationTask.create({ data: {
      id: `task_${crypto.randomUUID()}`, userId: input.userId, projectId: input.projectId,
      projectName: input.projectName, type: input.type, title: input.title, provider: input.provider,
      model: input.model, estimatedCredits: input.estimatedCredits, status: "running", progress: 10, jobId,
      errorReason: JSON.stringify({ kind: "media_checkpoint", metadata: { leaseId } })
    } });
    await reserveTaskCredits(tx, { taskId: created.id, userId: input.userId });
    return created;
  });
  let finalized = false;
  let checkpoint = mediaCheckpoint(task);
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
          const locked = await lockTaskCredits(tx, task.id, input.userId);
          if (locked.task.status !== "running" || mediaCheckpoint(locked.task).leaseId !== leaseId) throw new Error("生成任务状态已变化，本次结果未提交，请刷新任务。");
          const settlement = await settleTaskCredits(tx, { taskId: task.id, userId: input.userId, finalCredits: credits });
          if (!settlement.applied) throw new Error("该生成任务已处理，不能重复结算。");
          const saved = await persist(tx);
          const completed = await tx.generationTask.update({ where: { id: task.id }, data: {
            status: options.status ?? "succeeded", progress: 100, errorReason: options.errorReason ?? null
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
