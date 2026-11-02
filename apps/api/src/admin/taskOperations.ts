import crypto from "node:crypto";
import type { GenerationTask, Prisma, PrismaClient } from "@prisma/client";
import type { ProviderConnection, TaskOperationRow, TaskResolutionResult } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { lockTaskCredits, releaseTaskCredits } from "../billing/taskCredits.js";
import { mediaCheckpoint } from "../billing/mediaTask.js";
import { creationExecution } from "../queue/creationState.js";
import { exportSourceFromDiagnostics } from "../export/exportSource.js";
import { queryVideoTaskResult } from "../providers/video.js";
import { providerRuntimeOptions } from "../providers/connection.js";

export class TaskOperationError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const active = ["pending", "running"];
const leaseMs = 120_000;
const terminal = ["succeeded", "failed", "canceled", "refunded"];
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function contentIdentity(task: Pick<GenerationTask, "jobId">) {
  const parts = task.jobId?.split(":") ?? [];
  return parts[0] === "content" && ["operation", "billing"].includes(parts[2])
    ? { contentId: parts[1], parentId: parts[3] } : undefined;
}
async function requireOperator(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, status: true } });
  if (actor?.role !== "admin" || actor.status !== "active") throw new TaskOperationError(403, "当前账号没有异常任务处置权限。");
}
function assertIdle(status: string, updatedAt: Date) {
  if (status === "succeeded") throw new TaskOperationError(409, "已完成任务不能撤回或释放已消耗积分。");
  if (active.includes(status) && updatedAt.getTime() > Date.now() - leaseMs)
    throw new TaskOperationError(409, "任务仍有近期进度或心跳，请等待执行停止后再核对。");
}
function checkVersion(actual: Date, expected: string) {
  if (actual.toISOString() !== expected) throw new TaskOperationError(409, "任务状态已变化，请刷新详情后重新核对。");
}

function taskRow(row: GenerationTask, frozenCredits: number): TaskOperationRow {
  const checkpoint = mediaCheckpoint(row), state = creationExecution(row.execution);
  const payload = row.requestPayload as { source?: { inputFingerprint?: string } } | null;
  return {
    id: row.id, kind: "generation", userId: row.userId, projectId: row.projectId ?? undefined,
    contentProjectId: contentIdentity(row)?.contentId,
    title: row.title, projectName: row.projectName ?? undefined, type: row.type, status: row.status,
    provider: row.provider, model: row.model, frozenCredits, chargedCredits: row.finalCredits ?? 0,
    reviewRequired: state.reviewRequired || Boolean(checkpoint.needsReconciliation),
    remoteTaskId: typeof checkpoint.remoteTaskId === "string" ? checkpoint.remoteTaskId.slice(0, 200) : undefined,
    sourceFingerprint: payload?.source?.inputFingerprint,
    canQuery: row.type === "video" && typeof checkpoint.remoteTaskId === "string",
    canResolve: (active.includes(row.status) && row.updatedAt.getTime() <= Date.now() - leaseMs) || (row.status === "failed" && (frozenCredits > 0 || state.reviewRequired)),
    attempts: state.attempts.map(({ id, state, startedAt, submittedAt, finishedAt }) => ({ id, state, startedAt, submittedAt, finishedAt })),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
  };
}
async function frozenByTask(db: Prisma.TransactionClient, ids: string[]) {
  const groups = await db.creditTransaction.groupBy({ by: ["taskId", "type"], where: { taskId: { in: ids }, type: { in: ["freeze", "refund", "consume"] } }, _sum: { amount: true } });
  const values = new Map<string, number>();
  for (const group of groups) {
    const sign = group.type === "consume" ? 1 : -1;
    values.set(group.taskId!, (values.get(group.taskId!) ?? 0) + sign * (group._sum.amount ?? 0));
  }
  return values;
}
export async function listTaskOperations(input: { kind: "generation" | "export"; page: number; pageSize: number; keyword: string; view: "attention" | "all"; exactId?: string }, db: PrismaClient = prisma) {
  const { kind, page, pageSize, keyword, view } = input;
  const common = {
    ...(view === "attention" ? { status: { in: active }, updatedAt: { lt: new Date(Date.now() - leaseMs) } } : {}),
    ...(input.exactId ? { id: input.exactId } : keyword ? { OR: [{ id: { contains: keyword } }, { userId: { contains: keyword } }, { projectId: { contains: keyword } }] } : {})
  };
  return db.$transaction(async tx => {
    if (kind === "export") {
      const where: Prisma.ExportJobWhereInput = common;
      const rows = await tx.exportJob.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      const items: TaskOperationRow[] = rows.map(row => ({
        id: row.id, kind, userId: row.userId, projectId: row.projectId, title: "作品导出", type: row.type, status: row.status,
        frozenCredits: 0, chargedCredits: 0, reviewRequired: active.includes(row.status), canQuery: false,
        canResolve: active.includes(row.status) && row.updatedAt.getTime() <= Date.now() - leaseMs,
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), attempts: []
      }));
      return { items, total: await tx.exportJob.count({ where }), page, pageSize };
    }
    const where: Prisma.GenerationTaskWhereInput = common;
    const rows = await tx.generationTask.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const frozen = await frozenByTask(tx, rows.map(row => row.id));
    return { items: rows.map(row => taskRow(row, Math.max(0, frozen.get(row.id) ?? 0))), total: await tx.generationTask.count({ where }), page, pageSize };
  });
}

export async function getTaskOperation(kind: "generation" | "export", id: string, db: PrismaClient = prisma): Promise<TaskOperationRow> {
  const page = await listTaskOperations({ kind, page: 1, pageSize: 1, keyword: "", exactId: id, view: "all" }, db);
  const row = page.items.find(item => item.id === id);
  if (!row) throw new TaskOperationError(404, "任务不存在。");
  const history = await db.taskResolution.findMany({ where: { kind, targetId: id }, orderBy: { createdAt: "desc" }, take: 20 });
  return { ...row, resolutions: history.map(item => ({ id: item.id, actorId: item.actorId, reason: item.reason,
    releasedCredits: (item.result as unknown as TaskResolutionResult).releasedCredits, createdAt: item.createdAt.toISOString() })) };
}

export async function resolveTaskOperation(actorId: string, kind: "generation" | "export", targetId: string,
  input: { requestId: string; expectedUpdatedAt: string; reason: string }, db: PrismaClient = prisma): Promise<TaskResolutionResult> {
  const requestHash = crypto.createHash("sha256").update(JSON.stringify({ kind, targetId, ...input })).digest("hex");
  return db.$transaction(async tx => {
    await requireOperator(tx, actorId);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`task-resolution:${actorId}:${input.requestId}`}))`;
    const replay = await tx.taskResolution.findUnique({ where: { actorId_requestId: { actorId, requestId: input.requestId } } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw new TaskOperationError(409, "本次处置标识已用于另一项操作，请刷新。");
      return replay.result as unknown as TaskResolutionResult;
    }
    let result: TaskResolutionResult;
    if (kind === "export") {
      const candidate = await tx.exportJob.findUnique({ where: { id: targetId } });
      if (!candidate) throw new TaskOperationError(404, "导出任务不存在。");
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`project-lifecycle:${candidate.projectId}`}))`;
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${candidate.projectId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "ExportJob" WHERE "id" = ${targetId} FOR UPDATE`;
      const row = await tx.exportJob.findUniqueOrThrow({ where: { id: targetId } });
      checkVersion(row.updatedAt, input.expectedUpdatedAt); assertIdle(row.status, row.updatedAt);
      if (terminal.includes(row.status)) throw new TaskOperationError(409, "导出任务已经结束，无需再次处置。");
      await tx.exportJob.update({ where: { id: targetId }, data: { status: "failed",
        errorReason: JSON.stringify({ kind: "export_diagnostics", sourceSnapshot: exportSourceFromDiagnostics(row.errorReason),
          message: "管理员核对后已结束未交付导出。已完成的配音与素材仍保留，可重新导出。" }) } });
      result = { targetId, affectedTaskIds: [targetId], releasedCredits: 0 };
    } else {
      const candidate = await tx.generationTask.findUnique({ where: { id: targetId } });
      if (!candidate) throw new TaskOperationError(404, "生成任务不存在。");
      const content = contentIdentity(candidate);
      if (content) {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`content-generation:${content.contentId}`}))`;
        await tx.$queryRaw`SELECT "id" FROM "GenerationTask" WHERE "id" = ${content.parentId} FOR UPDATE`;
        const parent = await tx.generationTask.findUnique({ where: { id: content.parentId } });
        if (parent && active.includes(parent.status)) assertIdle(parent.status, parent.updatedAt);
      } else if (candidate.projectId) {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`project-lifecycle:${candidate.projectId}`}))`;
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${candidate.projectId} FOR UPDATE`;
      }
      const related = content ? await tx.generationTask.findMany({ where: { userId: candidate.userId,
        OR: [{ id: content.parentId }, { jobId: { startsWith: `content:${content.contentId}:billing:${content.parentId}:` } }] }, orderBy: { id: "asc" } }) : [candidate];
      let releasedCredits = 0;
      const affectedTaskIds: string[] = [];
      const ids = [...new Set([...related.map(row => row.id), targetId])].sort();
      // Acquire every child row before the account lock; a late child failure
      // also locks its row before the account.
      for (const id of ids) await tx.$queryRaw`SELECT "id" FROM "GenerationTask" WHERE "id" = ${id} FOR UPDATE`;
      // Lock target independently even if a malformed legacy content link has no parent.
      const { task: target } = await lockTaskCredits(tx, targetId, candidate.userId);
      checkVersion(target.updatedAt, input.expectedUpdatedAt); assertIdle(target.status, target.updatedAt);
      if (terminal.includes(target.status) && target.status !== "failed") throw new TaskOperationError(409, "该任务已经结束，无需再次处置。");
      if (!related.some(row => row.id === targetId)) related.push(target);
      for (const item of related) {
        const { task: live, reservedCredits } = await lockTaskCredits(tx, item.id, candidate.userId);
        if (live.status === "succeeded" || (terminal.includes(live.status) && !reservedCredits && live.id !== targetId)) continue;
        if (active.includes(live.status)) assertIdle(live.status, live.updatedAt);
        const release = await releaseTaskCredits(tx, { taskId: live.id, userId: candidate.userId, description: "管理员核对结束未交付任务，释放本任务冻结积分" });
        const execution = creationExecution(live.execution);
        execution.reviewRequired = false;
        releasedCredits += release.credits; affectedTaskIds.push(live.id);
        await tx.generationTask.update({ where: { id: live.id }, data: { status: "canceled", progress: 0,
          execution: json({ ...execution, resolutionId: input.requestId }),
          errorReason: "管理员核对后已结束任务，未交付部分的冻结积分已释放。供应商费用以账单核对为准。" } });
      }
      if (content) {
        const steps = await tx.creatorStep.findMany({ where: { taskId: { in: affectedTaskIds } }, select: { id: true, runId: true } });
        await tx.creatorStep.updateMany({ where: { id: { in: steps.map(step => step.id) }, status: { in: ["pending", "running", "unknown"] } }, data: { status: "canceled", error: "管理员已核对结束未交付调用。" } });
        await tx.creatorRun.updateMany({ where: { id: { in: steps.map(step => step.runId) }, userId: candidate.userId }, data: { status: "canceled", cancelRequested: true, error: "管理员核对后结束计划，已保留完成的内容。" } });
        await tx.contentProject.updateMany({ where: { id: content.contentId, userId: candidate.userId }, data: { status: "failed" } });
      }
      result = { targetId, affectedTaskIds, releasedCredits };
    }
    await tx.taskResolution.create({ data: { id: `resolution_${crypto.randomUUID()}`, actorId, requestId: input.requestId,
      requestHash, kind, targetId, reason: input.reason, result: json(result) } });
    await tx.adminAuditLog.create({ data: { id: `audit_${crypto.randomUUID()}`, actorId, actorRole: "admin", action: "RESOLVE_TASK",
      target: `${kind}:${targetId}`, details: json({ requestId: input.requestId, ...result }), status: "succeeded", statusCode: 200, completedAt: new Date() } });
    return result;
  }, { timeout: 30_000 });
}

/** Query an existing supplier ID only. No submission, settlement or output promotion. */
export async function inspectRemoteTask(targetId: string, db: PrismaClient = prisma) {
  const task = await db.generationTask.findUnique({ where: { id: targetId } });
  if (!task || task.type !== "video") throw new TaskOperationError(404, "未找到可查询的视频任务。");
  const checkpoint = mediaCheckpoint(task);
  if (typeof checkpoint.remoteTaskId !== "string") throw new TaskOperationError(409, "没有已知上游任务编号，请在供应商控制台人工核对。");
  const providerId = typeof checkpoint.provider === "string" ? checkpoint.provider : task.provider;
  const provider = await db.modelProvider.findUnique({ where: { id: providerId } });
  if (!provider) throw new TaskOperationError(409, "原任务渠道配置已移除，请人工核对供应商记录。");
  const runtime = providerRuntimeOptions(provider);
  const result = await queryVideoTaskResult({ taskId: checkpoint.remoteTaskId, provider: providerId, model: task.model, ...runtime,
    ...(checkpoint.connection ? { connection: checkpoint.connection as ProviderConnection } : {}),
    ...(typeof checkpoint.baseUrl === "string" ? { baseUrl: checkpoint.baseUrl } : {}) });
  return { status: result.status, hasOutput: Boolean(result.videoUrl), checkedAt: new Date().toISOString(),
    message: result.videoUrl ? "供应商已有输出。请从原作品继续查询和保存；此核对操作未交付或扣费。" : "已查询原任务。平台未重新提交，费用仍需核对供应商账单。" };
}
