import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { inspectModelPrice, type BillingUsage } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { lockTaskCredits, releaseTaskCredits, reserveTaskCredits, settleTaskCredits } from "../billing/taskCredits.js";
import { quotePrice } from "../billing/pricing.js";
import { withTaskMeter } from "../billing/metering.js";
import { ContentMutationError } from "./contentMutation.js";
import { assertProductionMediaProvider } from "../billing/mediaTask.js";
import { creationExecution, creationNeedsReview, CREATION_REVIEW_MESSAGE } from "../queue/creationState.js";
import { withTextSubmissionGuard, textSubmissionOutcome } from "../providers/textSubmission.js";

type ContentProjectRoute = { id: string; userId: string; title: string; textProvider: string; textModel: string };
type Operation = { id: string; userId: string; contentProjectId: string };
const LEASE_MS = 120_000;
const contexts = new AsyncLocalStorage<Operation>();
const operationPrefix = (contentProjectId: string) => `content:${contentProjectId}:operation:`;
const billingPrefix = (operation: Operation) => `content:${operation.contentProjectId}:billing:${operation.id}:`;

function failureMessage(error: unknown) { return error instanceof Error ? error.message : "内容生成失败，请重试"; }

async function lockActiveOperation(tx: Prisma.TransactionClient, operation: Operation) {
  await tx.$queryRaw`SELECT "id" FROM "GenerationTask" WHERE "id" = ${operation.id} AND "userId" = ${operation.userId} FOR UPDATE`;
  const row = await tx.generationTask.findFirst({ where: { id: operation.id, userId: operation.userId } });
  if (!row || row.status !== "running") throw new Error("内容操作已中断，旧请求结果不会覆盖当前版本。请返回内容页重试。");
  return row;
}

export async function saveContentOperationOutput<T>(save: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const operation = contexts.getStore();
  if (!operation) throw new Error("内容更新缺少操作锁");
  return prisma.$transaction(async (tx) => {
    await lockActiveOperation(tx, operation);
    return save(tx);
  });
}

export async function markContentOperationFailed(activeStep?: string): Promise<void> {
  const operation = contexts.getStore();
  if (!operation) return;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "GenerationTask" WHERE "id" = ${operation.id} FOR UPDATE`;
    const lease = await tx.generationTask.findUnique({ where: { id: operation.id } });
    // A late exception from a reclaimed request must not mark its successor failed.
    if (lease?.status !== "running") return;
    await tx.contentProject.updateMany({ where: { id: operation.contentProjectId, userId: operation.userId }, data: { status: "failed", ...(activeStep ? { activeStep } : {}) } });
  });
}

/** The durable operation lease serializes every stage of one content project.
 * A heartbeat keeps long provider calls alive without keeping a DB transaction open.
 * Lock order for output/recovery: operation -> billable task -> account -> content.
 */
export async function withContentGenerationOperation<T>(userId: string, contentProjectId: string, title: string, execute: () => Promise<T>): Promise<T> {
  const current = contexts.getStore();
  if (current?.userId === userId && current.contentProjectId === contentProjectId) return execute();
  const operation = await prisma.$transaction(async (tx) => {
    // A transaction-scoped advisory lock protects initial lease acquisition even
    // before the first OperationTask exists; no row lock is held across a model call.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`content-generation:${contentProjectId}`}))`;
    const project = await tx.contentProject.findFirst({ where: { id: contentProjectId, userId } });
    if (!project) throw new ContentMutationError(404, "内容项目不存在");
    const unresolved = await tx.generationTask.findFirst({ where: { userId, jobId: { startsWith: `content:${contentProjectId}:billing:` },
      status: "pending" } });
    if (unresolved) throw new ContentMutationError(409, "上次内容生成结果待核对，请联系管理员处理后再继续。");
    const active = await tx.generationTask.findMany({ where: { userId, jobId: { startsWith: operationPrefix(contentProjectId) }, status: { in: ["pending", "running"] } } });
    for (const candidate of active) {
      await tx.$queryRaw`SELECT "id" FROM "GenerationTask" WHERE "id" = ${candidate.id} FOR UPDATE`;
      const lease = await tx.generationTask.findUniqueOrThrow({ where: { id: candidate.id } });
      if (!["pending", "running"].includes(lease.status)) continue;
      if (Date.now() - lease.updatedAt.getTime() < LEASE_MS) throw new Error("该内容项目已有生成任务正在执行，请等待完成后再提交。");
      const interrupted = { id: lease.id, userId, contentProjectId };
      const children = await tx.generationTask.findMany({ where: { userId, jobId: { startsWith: billingPrefix(interrupted) }, status: { in: ["pending", "running"] } }, orderBy: { id: "asc" } });
      if (children.some(child => creationNeedsReview(child) || !(child.execution as { version?: number } | null)?.version)) {
        throw new ContentMutationError(409, "上次内容生成可能已提交供应商，请联系管理员核对后结束，不能重复调用。");
      }
      for (const child of children) {
        await releaseTaskCredits(tx, { taskId: child.id, userId, description: "内容生成执行中断，释放冻结积分" });
        await tx.generationTask.update({ where: { id: child.id }, data: { status: "failed", errorReason: "生成进程失去响应，积分已解冻。已完成章节仍保留，请从内容页继续。" } });
      }
      await tx.generationTask.update({ where: { id: lease.id }, data: { status: "failed", finalCredits: 0, errorReason: "内容操作心跳过期，已回收执行锁。" } });
    }
    const id = `content_operation_${crypto.randomUUID()}`;
    await tx.generationTask.create({ data: { id, userId, projectId: null, projectName: project.title, type: "text", title, provider: project.textProvider, model: project.textModel, status: "running", estimatedCredits: 0, jobId: `${operationPrefix(contentProjectId)}${id}` } });
    return { id, userId, contentProjectId };
  });
  const heartbeat = setInterval(() => {
    void prisma.generationTask.updateMany({ where: { id: operation.id, status: "running" }, data: { updatedAt: new Date() } }).catch(() => undefined);
  }, 20_000);
  heartbeat.unref();
  try {
    const result = await contexts.run(operation, execute);
    await prisma.$transaction(async (tx) => {
      await lockActiveOperation(tx, operation);
      const pending = await tx.generationTask.findFirst({ where: { userId, jobId: { startsWith: billingPrefix(operation) }, status: "pending" } });
      await tx.generationTask.update({ where: { id: operation.id }, data: pending
        ? { status: "pending", errorReason: CREATION_REVIEW_MESSAGE, execution: { version: 1, attempts: [], reviewRequired: true } }
        : { status: "succeeded", progress: 100, finalCredits: 0 } });
    });
    return result;
  } catch (error) {
    const pending = await prisma.generationTask.findFirst({ where: { userId, jobId: { startsWith: billingPrefix(operation) }, status: "pending" } });
    await prisma.generationTask.updateMany({ where: { id: operation.id, status: "running" }, data: pending
      ? { status: "pending", errorReason: CREATION_REVIEW_MESSAGE, execution: { version: 1, attempts: [], reviewRequired: true } }
      : { status: "failed", finalCredits: 0, errorReason: failureMessage(error).slice(0, 2000) } });
    throw error;
  } finally { clearInterval(heartbeat); }
}

/** One persisted, priced task for each provider call. Save and settle atomically. */
export async function runBilledContentGeneration<T, R>(project: ContentProjectRoute, title: string, generate: () => Promise<T>, save: (tx: Prisma.TransactionClient, result: T) => Promise<R>, options?: {
  maximumCredits: number;
  billingInput?: BillingUsage;
  onReserved?: (tx: Prisma.TransactionClient, taskId: string, maximumCredits: number) => Promise<void>;
}): Promise<R> {
  const operation = contexts.getStore();
  if (!operation || operation.userId !== project.userId || operation.contentProjectId !== project.id) throw new Error("内容生成缺少操作锁");
  const task = await prisma.$transaction(async (tx) => {
    await lockActiveOperation(tx, operation);
    const provider = await tx.modelProvider.findFirst({ where: { id: project.textProvider, enabled: true, modality: "text" } });
    if (!provider?.models.includes(project.textModel)) throw new Error("所选文本模型不可用，请先切换模型");
    assertProductionMediaProvider(provider, project.textProvider, project.textModel, "text");
    const rows = await tx.modelPrice.findMany({ where: { providerId: provider.id, modality: "text", model: project.textModel, enabled: true }, take: 2 });
    const pricing = inspectModelPrice(rows, { providerId: provider.id, modality: "text", model: project.textModel });
    if (!pricing.price) throw new Error(pricing.state === "conflict" ? "所选文本模型存在多条启用价格，请联系管理员核对" : "所选文本模型尚未配置有效价格，请联系管理员");
    const price = pricing.price;
    const estimate = await quotePrice(price, options?.billingInput, tx);
    if (options && estimate > options.maximumCredits) throw new Error("本步报价超过已批准的费用上限，请重新核对报价。");
    const id = `content_text_${crypto.randomUUID()}`;
    const row = await tx.generationTask.create({ data: { id, userId: project.userId, projectId: null, projectName: project.title, type: "text", title, provider: provider.id, model: project.textModel, status: "running", estimatedCredits: estimate, ...(options?.billingInput ? { requestPayload: { billingInput: options.billingInput } as unknown as Prisma.InputJsonValue } : {}), jobId: `${billingPrefix(operation)}${id}` } });
    await reserveTaskCredits(tx, { taskId: id, userId: project.userId, description: `${title}：冻结积分` });
    await tx.generationTask.update({ where: { id }, data: { execution: { version: 1, reviewRequired: false,
      attempts: [{ id, state: "prepared", startedAt: new Date().toISOString() }] } } });
    await options?.onReserved?.(tx, id, estimate);
    return row;
  });
  try {
    const result = await withTaskMeter(task.id, () => withTextSubmissionGuard(async () => {
      await prisma.$transaction(async tx => {
        await lockActiveOperation(tx, operation);
        const { task: live } = await lockTaskCredits(tx, task.id, project.userId);
        const execution = creationExecution(live.execution), attempt = execution.attempts.at(-1);
        if (live.status !== "running" || attempt?.state !== "prepared") throw new Error("该内容调用已提交或停止，不能再次发送。");
        attempt.state = "submitted"; attempt.submittedAt = new Date().toISOString();
        await tx.generationTask.update({ where: { id: task.id }, data: { execution: JSON.parse(JSON.stringify(execution)) } });
      });
    }, generate));
    return await prisma.$transaction(async (tx) => {
      await lockActiveOperation(tx, operation);
      const locked = await lockTaskCredits(tx, task.id, project.userId);
      if (locked.task.status !== "running") throw new Error("该内容生成任务已结束，旧响应不会覆盖内容。");
      const output = await save(tx, result);
      const settled = await settleTaskCredits(tx, { taskId: task.id, userId: project.userId, description: `${title}：生成成功扣费` });
      if (!settled.applied) throw new Error("内容生成任务已结算，不能重复保存。");
      const execution = creationExecution(locked.task.execution), attempt = execution.attempts.at(-1);
      if (attempt) { attempt.state = "delivered"; attempt.finishedAt = new Date().toISOString(); }
      await tx.generationTask.update({ where: { id: task.id }, data: { status: "succeeded", progress: 100, execution: JSON.parse(JSON.stringify(execution)) } });
      return output;
    });
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      const locked = await lockTaskCredits(tx, task.id, project.userId);
      if (["succeeded", "canceled", "refunded", "failed"].includes(locked.task.status)) return;
      const execution = creationExecution(locked.task.execution), attempt = execution.attempts.at(-1);
      if (attempt?.state === "submitted" && textSubmissionOutcome(error) !== "rejected") {
        attempt.state = "unknown"; attempt.finishedAt = new Date().toISOString(); execution.reviewRequired = true;
        await tx.generationTask.update({ where: { id: task.id }, data: { status: "pending", errorReason: CREATION_REVIEW_MESSAGE, execution: JSON.parse(JSON.stringify(execution)) } });
        return;
      }
      await releaseTaskCredits(tx, { taskId: task.id, userId: project.userId, description: `${title}：失败退回冻结积分` });
      await tx.generationTask.update({ where: { id: task.id }, data: { status: "failed", errorReason: failureMessage(error).slice(0, 2000) } });
    });
    throw error;
  }
}
