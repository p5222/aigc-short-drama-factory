import crypto from "node:crypto";
import type { ExportJob as ExportJobRow, Prisma, PrismaClient } from "@prisma/client";
import { lockCreditAccount } from "../billing/accountCredits.js";
import { grantMembership } from "../billing/membership.js";
import { assertProductionMediaProvider, mediaCheckpoint, runMediaTask } from "../billing/mediaTask.js";
import sharp from "sharp";
import type { AdminSummary, AdminUserRow, AssetItem, BatchGenerationResult, CreateProjectInput, CreationEstimate, GenerationTask, HelpArticle, PlatformAnnouncement, ProjectWorkflow, SegmentProfile, StoryboardExportRow, StoryboardShot, WorkbenchSummary } from "@aifilm/shared";
import { textModelName, textProviderName } from "../agents/generator.js";
import { buildSeedanceVideoPrompt, buildStoryboardFirstFramePrompt, createStoryboardProductionPackage, resolveStoryboardReferenceAssets } from "../agents/storyboardProduction.js";
import { estimateCreation } from "../agents/workflow.js";
import { estimateImageCredits, isPersistedPlayableVideoReference, normalizeImageOutputQuality, normalizeImageOutputSize, normalizeImageProviderId, resolveImageUnitCredits } from "@aifilm/shared";
import { hashPassword } from "../auth/password.js";
import { buildDirectorStoryboardRow, createDirectorStoryboardPackage } from "../export/directorStoryboard.js";
import { selectExportWorkflow } from "../export/exportSelection.js";
import { assessVideoExportCompletion, captureVideoExportSnapshot, readVideoExportSnapshot, type VideoExportSnapshot } from "../export/exportCompletion.js";
import { captureExportSource, createExportSourceContext, exportSourceFromDiagnostics, exportSourceStatus, type ExportSourceSnapshot } from "../export/exportSource.js";
import { lockTaskCredits, reserveTaskCredits, releaseTaskCredits } from "../billing/taskCredits.js";
import { createSubtitleAsset, createTtsManifest, createVideoExportPackage, type MediaExportResult } from "../export/mediaExport.js";
import { getOrCreatePaidNarration, quoteProjectNarration } from "../export/narrationBilling.js";
import { assertVideoExportReady } from "../export/exportRequirements.js";
import { probeFfmpeg } from "../export/videoComposer.js";
import { generateImage } from "../providers/dashscopeImage.js";
import type { ImageGenerationResult, VideoGenerationResult } from "../providers/types.js";
import { generateVideo, queryVideoTaskResult } from "../providers/video.js";
import { persistImageBuffer, persistImageReference, persistVideoReference, readStoredAsset } from "../storage/objectStorage.js";
import { prisma } from "./client.js";
import { AnnouncementScheduleError, assertAnnouncementSchedule } from "./announcementSafety.js";
import { captureMediaSource } from "./mediaSource.js";
import { persistCurrentShotImages, persistCurrentShotVideo, persistStaleShotOutputs } from "./mediaPersistence.js";
import { DEMO_USER_ID } from "./seed.js";
import {
  mapAsset,
  mapCharacter,
  mapCreditAccount,
  mapCreditTransaction,
  mapMembershipPlan,
  mapModelPrice,
  mapExportJob,
  mapHelpArticle,
  mapInvoice,
  mapPaymentRecord,
  mapPlatformAnnouncement,
  mapPlan,
  mapProject,
  mapProvider,
  mapQualityReport,
  mapRechargeOrder,
  mapRedeemCode,
  mapScript,
  mapStoryboard,
  mapTask,
  mapTemplate,
  mapUserFeedback,
  readProviderRoutingState
} from "./mappers.js";

export async function getWorkbenchSummary(userId = DEMO_USER_ID): Promise<WorkbenchSummary> {
  const taskWhere = { userId, NOT: { id: { startsWith: "content_operation_" } } };
  const [user, projects, tasks, account, announcements, projectCount, storyboardCount, runningTaskCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.project.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 6 }),
    prisma.generationTask.findMany({ where: taskWhere, orderBy: { updatedAt: "desc" }, take: 8 }),
    prisma.creditAccount.findUniqueOrThrow({ where: { userId } }),
    listPublicAnnouncements(),
    prisma.project.count({ where: { userId } }),
    prisma.storyboard.count({ where: { project: { userId } } }),
    prisma.generationTask.count({ where: { ...taskWhere, status: { in: ["running", "pending"] } } })
  ]);

  return {
    userName: user.name,
    projects: projectCount,
    storyboards: storyboardCount,
    runningTasks: runningTaskCount,
    credits: account.balance,
    recentProjects: projects.map(mapProject),
    recentTasks: tasks.map(mapTask),
    announcements: announcements.map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      type: item.type,
      pinned: item.pinned
    }))
  };
}

export async function listPublicAnnouncements(): Promise<PlatformAnnouncement[]> {
  const now = new Date();
  return (
    await prisma.platformAnnouncement.findMany({
      where: {
        enabled: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }]
      },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 5
    })
  ).map(mapPlatformAnnouncement);
}

export async function listAdminAnnouncements(): Promise<PlatformAnnouncement[]> {
  return (await prisma.platformAnnouncement.findMany({ orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] })).map(mapPlatformAnnouncement);
}

export async function createPlatformAnnouncement(input: {
  title: string;
  body: string;
  type?: string;
  enabled?: boolean;
  pinned?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}, db: PrismaClient = prisma) {
  assertAnnouncementSchedule(input.startsAt, input.endsAt);
  const announcement = await db.platformAnnouncement.create({
    data: {
      id: `ann_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      title: input.title.trim(),
      body: input.body.trim(),
      type: normalizeAnnouncementType(input.type),
      enabled: input.enabled ?? true,
      pinned: input.pinned ?? false,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null
    }
  });
  return mapPlatformAnnouncement(announcement);
}

export async function updatePlatformAnnouncement(
  id: string,
  input: Partial<{
    title: string;
    body: string;
    type: string;
    enabled: boolean;
    pinned: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
  }>,
  db: PrismaClient = prisma
) {
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.body !== undefined) data.body = input.body.trim();
  if (input.type !== undefined) data.type = normalizeAnnouncementType(input.type);
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.pinned !== undefined) data.pinned = input.pinned;
  if (input.startsAt !== undefined) data.startsAt = input.startsAt;
  if (input.endsAt !== undefined) data.endsAt = input.endsAt;
  if (data.title === "") throw new Error("公告标题不能为空");
  if (data.body === "") throw new Error("公告内容不能为空");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "PlatformAnnouncement" WHERE "id" = ${id} FOR UPDATE`;
    const current = await tx.platformAnnouncement.findUnique({ where: { id } });
    if (!current) throw new AnnouncementScheduleError(404, "公告不存在或已被删除，请刷新后重试。");
    assertAnnouncementSchedule(input.startsAt === undefined ? current.startsAt : input.startsAt,
      input.endsAt === undefined ? current.endsAt : input.endsAt);
    return mapPlatformAnnouncement(await tx.platformAnnouncement.update({ where: { id }, data }));
  });
}

export async function deletePlatformAnnouncement(id: string) {
  await prisma.platformAnnouncement.delete({ where: { id } });
  return { id, deleted: true };
}

export async function listPublicHelpArticles(): Promise<HelpArticle[]> {
  return (
    await prisma.helpArticle.findMany({
      where: { enabled: true },
      orderBy: [{ pinned: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }]
    })
  ).map(mapHelpArticle);
}

export async function listAdminHelpArticles(): Promise<HelpArticle[]> {
  return (
    await prisma.helpArticle.findMany({
      orderBy: [{ enabled: "desc" }, { pinned: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }]
    })
  ).map(mapHelpArticle);
}

export async function createHelpArticle(input: {
  title: string;
  summary?: string;
  content: string;
  category?: string;
  tags?: string[];
  enabled?: boolean;
  pinned?: boolean;
  sortOrder?: number;
}) {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw new Error("帮助标题不能为空");
  if (!content) throw new Error("帮助内容不能为空");
  const article = await prisma.helpArticle.create({
    data: {
      id: `help_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      title,
      summary: (input.summary ?? "").trim() || content.slice(0, 80),
      content,
      category: normalizeHelpCategory(input.category),
      tags: normalizeTextList(input.tags ?? []),
      enabled: input.enabled ?? true,
      pinned: input.pinned ?? false,
      sortOrder: Math.max(0, Math.floor(input.sortOrder ?? 0))
    }
  });
  return mapHelpArticle(article);
}

export async function updateHelpArticle(
  id: string,
  input: Partial<{
    title: string;
    summary: string;
    content: string;
    category: string;
    tags: string[];
    enabled: boolean;
    pinned: boolean;
    sortOrder: number;
  }>
) {
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.summary !== undefined) data.summary = input.summary.trim();
  if (input.content !== undefined) data.content = input.content.trim();
  if (input.category !== undefined) data.category = normalizeHelpCategory(input.category);
  if (input.tags !== undefined) data.tags = normalizeTextList(input.tags);
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.pinned !== undefined) data.pinned = input.pinned;
  if (input.sortOrder !== undefined) data.sortOrder = Math.max(0, Math.floor(input.sortOrder));
  if (data.title === "") throw new Error("帮助标题不能为空");
  if (data.content === "") throw new Error("帮助内容不能为空");
  return mapHelpArticle(await prisma.helpArticle.update({ where: { id }, data }));
}

export async function deleteHelpArticle(id: string) {
  await prisma.helpArticle.delete({ where: { id } });
  return { id, deleted: true };
}

export async function listProjects(userId = DEMO_USER_ID) {
  return (await prisma.project.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } })).map(mapProject);
}

export class ProjectRequestError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); this.name = "ProjectRequestError"; }
}

export async function deleteProject(projectId: string, userId = DEMO_USER_ID, db: PrismaClient = prisma) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`project-lifecycle:${projectId}`}))`;
    // FK inserts for new work cannot race past this lock and the final deletion.
    await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} AND "userId" = ${userId} FOR UPDATE`;
    if (!await tx.project.findFirst({ where: { id: projectId, userId } })) throw new ProjectRequestError(404, "项目不存在或无权删除");
    const terminal = ["succeeded", "completed", "failed", "canceled", "cancelled", "refunded"];
    const activeTask = await tx.generationTask.findFirst({ where: { projectId, status: { notIn: terminal } }, select: { id: true } });
    const activeExport = await tx.exportJob.findFirst({ where: { projectId, status: { notIn: terminal } }, select: { id: true } });
    if (activeTask || activeExport) throw new ProjectRequestError(409, "项目仍有生成或导出任务，请等待结束或取消后再删除。");
    const ledger = await tx.creditTransaction.findMany({ where: { projectId, userId, type: { in: ["freeze", "refund", "consume"] } }, select: { taskId: true, type: true, amount: true } });
    const reservations = new Map<string | null, number>();
    for (const entry of ledger) reservations.set(entry.taskId, (reservations.get(entry.taskId) ?? 0) + (entry.type === "consume" ? entry.amount : -entry.amount));
    if ([...reservations.values()].some(amount => amount > 0)) throw new ProjectRequestError(409, "项目仍有未结算的冻结积分，请先在任务页核对或联系管理员。");
    // GenerationTask and CreditTransaction use ON DELETE SET NULL, preserving history.
    await tx.project.delete({ where: { id: projectId } });
    return { id: projectId, deleted: true };
  });
}

export async function updateProjectModelRoutes(
  projectId: string,
  userId = DEMO_USER_ID,
  data: Partial<Pick<CreateProjectInput, "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">> & { segmentProfile?: SegmentProfile }
) {
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new Error("项目不存在");

  const clean = {
    ...(data.textProvider !== undefined ? { textProvider: data.textProvider || null } : {}),
    ...(data.textModel !== undefined ? { textModel: data.textModel || null } : {}),
    ...(data.imageProvider !== undefined ? { imageProvider: data.imageProvider || null } : {}),
    ...(data.imageModel !== undefined ? { imageModel: data.imageModel || null } : {}),
    ...(data.imageSize !== undefined ? { imageSize: data.imageSize ? normalizeImageOutputSize(data.imageSize) : null } : {}),
    ...(data.imageQuality !== undefined ? { imageQuality: data.imageQuality ? normalizeImageOutputQuality(data.imageQuality) : null } : {}),
    ...(data.videoProvider !== undefined ? { videoProvider: data.videoProvider || null } : {}),
    ...(data.videoModel !== undefined ? { videoModel: data.videoModel || null } : {}),
    ...(data.segmentProfile !== undefined ? { segmentProfile: data.segmentProfile } : {})
  };

  return mapProject(
    await prisma.project.update({
      where: { id: projectId },
      data: clean
    })
  );
}

export async function getProjectWorkflow(projectId: string, userId = DEMO_USER_ID, db: PrismaClient | Prisma.TransactionClient = prisma) {
  const [project, script, characters, assets, storyboards, tasks, qualityReports, feedbacks] = await Promise.all([
    db.project.findFirst({ where: { id: projectId, userId } }),
    db.scriptDraft.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    db.character.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    db.asset.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    db.storyboard.findMany({ where: { projectId }, orderBy: [{ episodeNo: "asc" }, { sceneNo: "asc" }, { shotNo: "asc" }] }),
    db.generationTask.findMany({ where: { projectId, userId }, orderBy: { createdAt: "desc" } }),
    db.qualityReport.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.userFeedback.findMany({ where: { projectId, userId }, orderBy: { createdAt: "desc" }, take: 30 })
  ]);

  if (!project) return null;

  return {
    project: mapProject(project),
    script: script ? mapScript(script) : undefined,
    characters: characters.map(mapCharacter),
    assets: assets.map(mapAsset),
    storyboards: storyboards.map(mapStoryboard),
    tasks: tasks.map(mapTask),
    qualityReports: qualityReports.map(mapQualityReport),
    feedbacks: feedbacks.map(mapUserFeedback)
  };
}

export async function listTasks(userId = DEMO_USER_ID, status?: string, type?: string) {
  return (
    await prisma.generationTask.findMany({
      where: {
        userId,
        ...(status && status !== "all" ? { status } : {}),
        ...(type && type !== "all" ? { type } : {})
      },
      orderBy: { createdAt: "desc" }
    })
  ).map(mapTask);
}

export async function getCreditAccount(userId = DEMO_USER_ID) {
  return mapCreditAccount(await prisma.creditAccount.findUniqueOrThrow({ where: { userId } }));
}

export async function listCreditTransactions(userId = DEMO_USER_ID) {
  return (await prisma.creditTransaction.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })).map(mapCreditTransaction);
}

export async function listRechargeOrders(userId = DEMO_USER_ID) {
  return (await prisma.rechargeOrder.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })).map(mapRechargeOrder);
}

export async function listPaymentRecords(userId = DEMO_USER_ID) {
  const orders = await prisma.rechargeOrder.findMany({
    where: { userId },
    include: { payments: true },
    orderBy: { createdAt: "desc" }
  });
  return orders.flatMap((order) => order.payments.map(mapPaymentRecord));
}

export async function listInvoices(userId = DEMO_USER_ID) {
  return (await prisma.invoice.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })).map(mapInvoice);
}

export async function createRechargeOrder(userId = DEMO_USER_ID, input: { planId: string; channel?: "wechat" | "alipay" | "manual" | "mock" }) {
  const plan = await prisma.plan.findFirst({ where: { id: input.planId, enabled: true } });
  if (!plan) throw new Error("充值套餐不存在或已停用");
  const order = await prisma.rechargeOrder.create({
    data: {
      id: `order_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      userId,
      planId: plan.id,
      planName: plan.name,
      channel: input.channel || "mock",
      amountCny: plan.price,
      credits: plan.credits,
      bonusCredits: plan.bonusCredits,
      status: "pending"
    }
  });
  return mapRechargeOrder(order);
}

export async function handleRechargeCallback(input: {
  orderId: string; userId?: string; channel?: string; providerTradeNo?: string; amountCny?: number; amountFen?: number; paidAt?: Date; payload?: unknown;
}) {
  if (input.amountCny !== undefined && (!Number.isFinite(input.amountCny) || input.amountCny < 0)) throw new Error("支付金额无效");
  const tradeNo = input.providerTradeNo?.trim() || undefined;
  return prisma.$transaction(async (tx) => {
    if (tradeNo) await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`payment:${tradeNo}`}))`;
    await tx.$queryRaw`SELECT "id" FROM "RechargeOrder" WHERE "id" = ${input.orderId} FOR UPDATE`;
    const order = await tx.rechargeOrder.findFirst({ where: { id: input.orderId, ...(input.userId ? { userId: input.userId } : {}) } });
    if (!order) throw new Error("充值订单不存在");
    if (input.channel && input.channel !== order.channel) throw new Error("Payment channel mismatch");
    if (input.amountFen !== undefined && (!Number.isSafeInteger(input.amountFen) || input.amountFen <= 0 ||
        input.amountFen !== (order.amountFen ?? Math.round(order.amountCny * 100)))) throw new Error("Payment amount mismatch");
    if (order.channel === "wechat" && order.amountFen !== null && (!tradeNo || input.amountFen === undefined || !input.paidAt))
      throw new Error("真实支付必须提供完整的已验证凭证");
    if (input.amountCny !== undefined && Math.round(input.amountCny * 100) !== Math.round(order.amountCny * 100)) throw new Error("Payment amount mismatch");
    if (tradeNo) {
      const reused = await tx.paymentRecord.findFirst({ where: { channel: order.channel, providerTradeNo: tradeNo, orderId: { not: order.id }, status: "succeeded" } });
      if (reused) throw new Error("该支付流水已关联其他订单");
      if (order.providerTradeNo && order.providerTradeNo !== tradeNo) throw new Error("订单支付流水不匹配");
    }
    if (order.status === "paid") {
      const payment = await tx.paymentRecord.findFirst({ where: { orderId: order.id, status: "succeeded" }, orderBy: { createdAt: "asc" } });
      if (!payment) throw new Error("已支付订单缺少支付流水，请联系管理员核对");
      return { order: mapRechargeOrder(order), payment: mapPaymentRecord(payment) };
    }
    if (order.status !== "pending" && !(order.status === "expired" && input.amountFen !== undefined)) throw new Error("订单当前状态不允许入账");
    const credits = order.credits + order.bonusCredits;
    if (!Number.isSafeInteger(credits) || credits < 0) throw new Error("订单积分配置无效");
    const account = await lockCreditAccount(tx, order.userId);
    const updated = await tx.creditAccount.update({ where: { userId: order.userId }, data: { balance: { increment: credits }, totalRecharge: { increment: credits } } });
    const payment = await tx.paymentRecord.create({ data: {
      id: `pay_${crypto.randomUUID()}`, orderId: order.id, channel: order.channel, providerTradeNo: tradeNo,
      amountCny: order.amountCny, status: "succeeded", callbackPayload: input.payload ? JSON.stringify(input.payload).slice(0, 4000) : undefined
    } });
    await tx.creditTransaction.create({ data: {
      id: `tx_${crypto.randomUUID()}`, userId: order.userId, type: "recharge", amount: credits, balanceAfter: updated.balance,
      description: `充值订单 ${order.id} 入账：${order.planName}，支付前余额 ${account.balance}`
    } });
    const membershipPeriod = await grantMembership(tx, order);
    const paid = await tx.rechargeOrder.update({ where: { id: order.id }, data: {
      status: "paid", paidAt: input.paidAt ?? new Date(), providerTradeNo: tradeNo, reconcileError: null, ...membershipPeriod
    } });
    return { order: mapRechargeOrder(paid), payment: mapPaymentRecord(payment) };
  });
}

export async function requestInvoice(userId = DEMO_USER_ID, input: { orderId: string; title: string; taxNo?: string; email?: string }) {
  const order = await prisma.rechargeOrder.findFirst({ where: { id: input.orderId, userId } });
  if (!order) throw new Error("充值订单不存在");
  if (order.status !== "paid") throw new Error("订单未支付，不能申请发票");
  const invoice = await prisma.invoice.create({
    data: {
      id: `invoice_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      orderId: order.id,
      userId,
      title: input.title.trim(),
      taxNo: input.taxNo?.trim(),
      email: input.email?.trim(),
      amountCny: order.amountCny,
      status: "requested"
    }
  });
  await prisma.rechargeOrder.update({ where: { id: order.id }, data: { invoiceStatus: "requested" } });
  return mapInvoice(invoice);
}

export async function listPlans() {
  return (await prisma.plan.findMany({ where: { enabled: true }, orderBy: { price: "asc" } })).map(mapPlan);
}

export async function listAdminPlans() {
  return (await prisma.plan.findMany({ orderBy: { price: "asc" } })).map(mapPlan);
}

export async function listMembershipPlans() {
  return (await prisma.membershipPlan.findMany({ orderBy: { monthlyPrice: "asc" } })).map(mapMembershipPlan);
}

export async function listRedeemCodes() {
  return (await prisma.redeemCode.findMany({ orderBy: { createdAt: "desc" } })).map(mapRedeemCode);
}

export async function createRedeemCodeBatch(input: {
  name: string;
  prefix: string;
  credits: number;
  count: number;
  enabled?: boolean;
}) {
  const prefix = normalizeRedeemPrefix(input.prefix);
  const name = input.name.trim() || `${prefix} 批量兑换码`;
  const credits = Math.max(1, Math.floor(input.credits));
  const count = Math.max(1, Math.min(1000, Math.floor(input.count)));
  const existing = await prisma.redeemCode.findMany({
    where: { code: { startsWith: `${prefix}-` } },
    select: { code: true }
  });
  const codeSet = new Set(existing.map((item) => item.code));
  const newCodes: string[] = [];

  while (newCodes.length < count) {
    const code = `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    if (codeSet.has(code)) continue;
    codeSet.add(code);
    newCodes.push(code);
  }

  const batchId = `redeem_batch_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  await prisma.redeemBatch.create({
    data: {
      id: batchId,
      name,
      prefix,
      credits,
      totalCodes: count,
      enabled: input.enabled ?? true,
      codes: {
        create: newCodes.map((code) => ({
          id: `redeem_${crypto.randomUUID()}`,
          code,
          name,
          credits,
          maxRedemptions: 1,
          enabled: input.enabled ?? true
        }))
      }
    }
  });

  return (await prisma.redeemCode.findMany({ where: { batchId }, orderBy: { code: "asc" } })).map(mapRedeemCode);
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  return (await listAdminUsersPage({ pageSize: 100 })).items;
}

export async function listAdminUsersPage(options: { page?: number; pageSize?: number; keyword?: string; role?: string; status?: string } = {}) {
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(options.pageSize) || 20)));
  const keyword = options.keyword?.trim().slice(0, 200);
  const where: Prisma.UserWhereInput = {
    ...(options.role && ["admin", "creator"].includes(options.role) ? { role: options.role } : {}),
    status: options.status && ["active", "disabled", "deleted"].includes(options.status) ? options.status : { not: "deleted" },
    ...(keyword ? { OR: [{ name: { contains: keyword, mode: "insensitive" } }, { email: { contains: keyword, mode: "insensitive" } }, { phone: { contains: keyword } }, { id: keyword }] } : {})
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, include: { credit: true, _count: { select: { projects: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.user.count({ where })
  ]);
  const items = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email ?? undefined,
    phone: user.phone ?? undefined,
    role: user.role,
    credits: user.credit?.balance ?? 0,
    frozenCredits: user.credit?.frozenBalance ?? 0,
    totalRecharge: user.credit?.totalRecharge ?? 0,
    totalConsume: user.credit?.totalConsume ?? 0,
    projects: user._count.projects,
    status: user.status,
    hasPassword: Boolean(user.passwordHash),
    lastLoginAt: user.lastLoginAt?.toISOString()
  }));
  return { items, total, page, pageSize };
}

export async function createAdminUser(input: {
  name: string;
  email?: string;
  phone?: string;
  password: string;
  role?: string;
  status?: string;
  initialCredits?: number;
}): Promise<AdminUserRow> {
  const email = input.email?.trim().toLowerCase() || undefined;
  const phone = input.phone?.trim() || undefined;
  if (!email && !phone) throw new Error("邮箱和手机号至少填写一个");
  if (input.password.length < 12) throw new Error("Password must be at least 12 characters");
  if (input.role && !["creator", "admin"].includes(input.role)) throw new Error("用户角色不在允许范围内");
  if (input.status && !["active", "disabled"].includes(input.status)) throw new Error("用户状态只能是 active 或 disabled");

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("邮箱格式不正确");
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) throw new Error("手机号格式不正确");
  const initialCredits = input.initialCredits ?? 0;
  if (!Number.isSafeInteger(initialCredits) || initialCredits < 0 || initialCredits > 2147483647) throw new Error("初始积分必须是有效非负整数");
  const passwordHash = await hashPassword(input.password);
  const userId = `user_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const user = await prisma.$transaction(async (tx) => {
    if (input.role === "admin") await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext('active-admin-membership'))`;
    const created = await tx.user.create({
      data: {
        id: userId,
        name: input.name.trim() || email || phone || "新用户",
        email,
        phone,
        passwordHash,
        role: input.role ?? "creator",
        status: input.status ?? "active",
        credit: {
          create: {
            id: `credit_${userId}`,
            balance: initialCredits,
            frozenBalance: 0,
            totalRecharge: initialCredits,
            totalConsume: 0
          }
        }
      },
      include: { credit: true, _count: { select: { projects: true } } }
    });
    if (initialCredits > 0) {
      await tx.creditTransaction.create({
        data: {
          id: `tx_${crypto.randomUUID()}`,
          userId,
          type: "recharge",
          amount: initialCredits,
          balanceAfter: initialCredits,
          description: "后台创建账号初始积分"
        }
      });
    }
    return created;
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email ?? undefined,
    phone: user.phone ?? undefined,
    role: user.role,
    credits: user.credit?.balance ?? 0,
    frozenCredits: user.credit?.frozenBalance ?? 0,
    totalRecharge: user.credit?.totalRecharge ?? 0,
    totalConsume: user.credit?.totalConsume ?? 0,
    projects: user._count.projects,
    status: user.status,
    hasPassword: true,
    lastLoginAt: user.lastLoginAt?.toISOString()
  };
}

export async function updateAdminUser(
  id: string,
  data: Partial<{ name: string; email: string; phone: string; role: string; status: string }>,
  actorId?: string
) {
  const cleanData: Partial<{ name: string; email: string | null; phone: string | null; role: string; status: string }> = {};
  if (data.name !== undefined) cleanData.name = data.name.trim();
  if (data.email !== undefined) {
    cleanData.email = data.email.trim().toLowerCase() || null;
    if (cleanData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanData.email)) throw new Error("邮箱格式不正确");
  }
  if (data.phone !== undefined) {
    cleanData.phone = data.phone.trim() || null;
    if (cleanData.phone && !/^1[3-9]\d{9}$/.test(cleanData.phone)) throw new Error("手机号格式不正确");
  }
  if (data.role !== undefined) {
    if (!["creator", "admin"].includes(data.role)) throw new Error("用户角色不在允许范围内");
    cleanData.role = data.role;
  }
  if (data.status !== undefined) {
    if (!["active", "disabled", "deleted"].includes(data.status)) throw new Error("用户状态不在允许范围内");
    cleanData.status = data.status;
  }
  if (cleanData.name === "") throw new Error("用户昵称不能为空");

  const user = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext('active-admin-membership'))`;
    const current = await tx.user.findUnique({ where: { id } });
    if (!current) throw new Error("用户不存在");
    if ((data.email !== undefined || data.phone !== undefined) && !(data.email === undefined ? current.email : cleanData.email) && !(data.phone === undefined ? current.phone : cleanData.phone)) throw new Error("邮箱和手机号至少保留一个");
    if (current.status === "deleted" && cleanData.status !== "disabled") throw new Error("请先恢复已删除用户，再编辑资料");
    if (current.status === "deleted" && Object.keys(cleanData).some(key => key !== "status")) throw new Error("恢复账号时不能同时修改其他资料");
    if (cleanData.status === "deleted" && current.status !== "disabled") throw new Error("请先停用账号，再删除用户");
    if (actorId === id && ((cleanData.role !== undefined && cleanData.role !== current.role) || (cleanData.status !== undefined && cleanData.status !== "active"))) throw new Error("不能修改自己的管理员角色或停用、删除当前操作账号，请由其他管理员处理。");
    const losesAccess = current.role === "admin" && current.status === "active"
      && ((cleanData.role !== undefined && cleanData.role !== "admin") || (cleanData.status !== undefined && cleanData.status !== "active"));
    if (losesAccess && await tx.user.count({ where: { role: "admin", status: "active" } }) <= 1) throw new Error("至少保留一位启用的管理员，不能停用或降级最后一位管理员。");
    const updated = await tx.user.update({ where: { id }, data: cleanData });
    if ((cleanData.role !== undefined && cleanData.role !== current.role) || (cleanData.status !== undefined && cleanData.status !== current.status) || (cleanData.email !== undefined && cleanData.email !== current.email) || (cleanData.phone !== undefined && cleanData.phone !== current.phone)) {
      await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return updated;
  });
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? undefined,
    phone: user.phone ?? undefined,
    role: user.role,
    status: user.status
  };
}

export async function resetAdminUserPassword(id: string, password: string) {
  if (password.length < 12) throw new Error("Password must be at least 12 characters");
  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id } });
    if (current.status === "deleted") throw new Error("请先恢复已删除用户，再重置密码");
    const updated = await tx.user.update({ where: { id }, data: { passwordHash } });
    await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    return updated;
  });
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? undefined,
    phone: user.phone ?? undefined,
    role: user.role,
    status: user.status,
    hasPassword: true
  };
}

export async function listProviders(includeAdminMetadata = false) {
  const providers = await Promise.all((await prisma.modelProvider.findMany({ orderBy: { createdAt: "asc" } })).map((row) => mapProvider(row)));
  if (includeAdminMetadata) return providers;
  return providers.map((provider) => {
    const { baseUrl: _baseUrl, apiKeyPreview: _apiKeyPreview, ...publicProvider } = provider;
    return { ...publicProvider, capability: providerCapabilityBase(provider.capability, provider.modality) };
  });
}

export async function listModelPrices() {
  return (await prisma.modelPrice.findMany({ orderBy: [{ modality: "asc" }, { providerName: "asc" }, { model: "asc" }] })).map(mapModelPrice);
}

export async function listTemplates() {
  return (await prisma.promptTemplate.findMany({ orderBy: { createdAt: "asc" } })).map(mapTemplate);
}

export async function createPromptTemplate(
  data: { name: string; type: string; version: string; enabled?: boolean; summary: string; content?: string }
) {
  return mapTemplate(await prisma.promptTemplate.create({
    data: {
      id: `tpl_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      name: data.name.trim(),
      type: data.type,
      version: data.version.trim(),
      enabled: data.enabled ?? true,
      summary: data.summary.trim(),
      content: data.content?.trim() ?? data.summary.trim()
    }
  }));
}

export async function updateModelPrice(
  id: string,
  data: Partial<{ unitCredits: number; vendorCostCny: number; enabled: boolean }>
) {
  validateModelPriceAmounts(data.unitCredits, data.vendorCostCny);
  return mapModelPrice(await prisma.$transaction(async (tx) => {
    const current = await tx.modelPrice.findUniqueOrThrow({ where: { id } });
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`price:${current.providerId ?? current.providerName}:${current.model}`}))`;
    if (data.enabled === true && await tx.modelPrice.findFirst({ where: { id: { not: id }, providerId: current.providerId, model: current.model, enabled: true } })) throw new Error("同一渠道与模型只能启用一条价格配置");
    return tx.modelPrice.update({ where: { id }, data });
  }));
}

function validateModelPriceAmounts(unitCredits?: number, vendorCostCny?: number) {
  if (unitCredits !== undefined && (!Number.isSafeInteger(unitCredits) || unitCredits < 0 || unitCredits > 2147483647)) throw new Error("模型积分单价必须是有效非负整数");
  if (vendorCostCny !== undefined && (!Number.isFinite(vendorCostCny) || vendorCostCny < 0)) throw new Error("模型成本必须是有效非负金额");
}

export async function createModelPrice(
  data: {
    providerId?: string;
    providerName: string;
    modality: string;
    model: string;
    unit?: string;
    unitCredits: number;
    vendorCostCny?: number;
    enabled?: boolean;
  }
) {
  validateModelPriceAmounts(data.unitCredits, data.vendorCostCny);
  const modality = normalizeModality(data.modality);
  const model = data.model.trim();
  if (!model || !data.providerName.trim()) throw new Error("渠道名称和模型 ID 不能为空");
  if (data.unit && data.unit !== defaultBillingUnit(modality)) throw new Error("计费单位与模型类型不匹配");
  return mapModelPrice(await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`price:${data.providerId ?? data.providerName}:${model}`}))`;
    const provider = data.providerId ? await tx.modelProvider.findUniqueOrThrow({ where: { id: data.providerId } }) : null;
    if (provider && (provider.modality !== modality || !provider.models.includes(model))) throw new Error("价格配置必须使用渠道已配置的模型和类型");
    if (await tx.modelPrice.findFirst({ where: { providerId: data.providerId ?? null, ...(data.providerId ? {} : { providerName: data.providerName.trim() }), model } })) throw new Error("该渠道的模型价格已存在，请修改或重新启用原配置");
    return tx.modelPrice.create({
    data: {
      id: `price_${crypto.randomUUID()}`,
      providerId: data.providerId,
      providerName: data.providerName.trim(),
      modality,
      model,
      unit: data.unit ?? defaultBillingUnit(data.modality),
      unitCredits: data.unitCredits,
      vendorCostCny: data.vendorCostCny ?? 0,
      enabled: data.enabled ?? true
    }
    });
  }));
}

export async function deleteModelPrice(id: string) {
  return mapModelPrice(await prisma.modelPrice.update({ where: { id }, data: { enabled: false } }));
}

export async function createPlan(
  data: { name: string; price: number; credits: number; bonusCredits?: number; badge?: string | null; features?: string[]; shopUrl?: string | null; enabled?: boolean }
) {
  return mapPlan(await prisma.plan.create({
    data: {
      id: `plan_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      name: data.name.trim(),
      price: Math.max(0, data.price),
      credits: Math.max(0, Math.floor(data.credits)),
      bonusCredits: Math.max(0, Math.floor(data.bonusCredits ?? 0)),
      badge: data.badge?.trim() || null,
      features: data.features?.map((item) => item.trim()).filter(Boolean) ?? [],
      shopUrl: data.shopUrl?.trim() || null,
      enabled: data.enabled ?? true
    }
  }));
}

export async function updatePlan(
  id: string,
  data: Partial<{ name: string; price: number; credits: number; bonusCredits: number; badge: string | null; features: string[]; shopUrl: string | null; enabled: boolean }>
) {
  return mapPlan(await prisma.plan.update({ where: { id }, data: normalizePlanUpdate(data) }));
}

export async function deletePlan(id: string) {
  return mapPlan(await prisma.plan.update({ where: { id }, data: { enabled: false } }));
}

export async function createMembershipPlan(
  data: { name: string; monthlyPrice: number; monthlyCredits: number; discountPercent?: number; priorityLevel?: number; badge?: string | null; features?: string[]; shopUrl?: string | null; enabled?: boolean }
) {
  return mapMembershipPlan(await prisma.membershipPlan.create({
    data: {
      id: `membership_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      name: data.name.trim(),
      monthlyPrice: Math.max(0, data.monthlyPrice),
      monthlyCredits: Math.max(0, Math.floor(data.monthlyCredits)),
      discountPercent: Math.max(0, Math.min(100, Math.floor(data.discountPercent ?? 0))),
      priorityLevel: Math.max(0, Math.floor(data.priorityLevel ?? 0)),
      badge: data.badge?.trim() || null,
      features: data.features?.map((item) => item.trim()).filter(Boolean) ?? [],
      shopUrl: data.shopUrl?.trim() || null,
      enabled: data.enabled ?? true
    }
  }));
}

export async function updateMembershipPlan(
  id: string,
  data: Partial<{ name: string; monthlyPrice: number; monthlyCredits: number; discountPercent: number; priorityLevel: number; badge: string | null; features: string[]; shopUrl: string | null; enabled: boolean }>
) {
  return mapMembershipPlan(await prisma.membershipPlan.update({ where: { id }, data: normalizePlanUpdate(data) }));
}

export async function deleteMembershipPlan(id: string) {
  return mapMembershipPlan(await prisma.membershipPlan.update({ where: { id }, data: { enabled: false } }));
}

function normalizePlanUpdate<T extends { shopUrl?: string | null; badge?: string | null; features?: string[] }>(data: T): T {
  return {
    ...data,
    ...(Object.prototype.hasOwnProperty.call(data, "shopUrl") ? { shopUrl: data.shopUrl?.trim() || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(data, "badge") ? { badge: data.badge?.trim() || null } : {}),
    ...(Array.isArray(data.features) ? { features: data.features.map((item) => item.trim()).filter(Boolean) } : {})
  };
}

export async function updateRedeemCode(
  id: string,
  data: Partial<{ name: string; code: string; credits: number; maxRedemptions: number; enabled: boolean; startsAt: Date | null; endsAt: Date | null }>
) {
  return mapRedeemCode(await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "RedeemCode" WHERE "id" = ${id} FOR UPDATE`;
    const current = await tx.redeemCode.findUniqueOrThrow({ where: { id } });
    const clean = { ...data, ...(data.name !== undefined ? { name: data.name.trim() } : {}), ...(data.code !== undefined ? { code: data.code.trim().toUpperCase() } : {}) };
    const next = { ...current, ...clean };
    if (!next.name || !next.code) throw new Error("兑换码及名称不能为空");
    if (!Number.isSafeInteger(next.credits) || next.credits <= 0 || next.credits > 2147483647) throw new Error("兑换积分必须是有效正整数");
    if (!Number.isSafeInteger(next.maxRedemptions) || next.maxRedemptions < Math.max(1, current.usedCount) || next.maxRedemptions > 2147483647) throw new Error("兑换上限不能小于已兑换次数，且必须为有效正整数");
    if (next.startsAt && next.endsAt && next.startsAt >= next.endsAt) throw new Error("兑换结束时间必须晚于开始时间");
    return tx.redeemCode.update({ where: { id }, data: clean });
  }));
}

export async function deleteRedeemCode(id: string) {
  return mapRedeemCode(await prisma.redeemCode.update({ where: { id }, data: { enabled: false } }));
}

export async function updateProvider(
  id: string,
  data: Partial<{
    name: string;
    modality: string;
    enabled: boolean;
    baseUrl: string | null;
    iconUrl: string | null;
    apiKey: string | null;
    models: string[];
    costHint: string;
    routing: { mode?: "auto" | "manual"; preferredModel?: string | null; modelPool?: string[] };
  }>
) {
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ModelProvider" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await tx.modelProvider.findUnique({ where: { id } });
    if (!existing) throw new Error("模型渠道不存在");
    const cleanData = cleanProviderData(existing, data);
    const provider = await tx.modelProvider.update({ where: { id }, data: cleanData });
    await ensureProviderPriceRows(provider.id, provider.name, provider.modality, provider.models, undefined, undefined, tx);
    return provider;
  });
  return mapProvider(updated);
}

export async function createProvider(
  data: {
    id?: string;
    name: string;
    modality: string;
    enabled?: boolean;
    baseUrl?: string | null;
    iconUrl?: string | null;
    apiKey?: string | null;
    models: string[];
    costHint?: string;
    routing?: { mode?: "auto" | "manual"; preferredModel?: string | null; modelPool?: string[] };
    unitCredits?: number;
    vendorCostCny?: number;
  }
) {
  const providerId = safeId(data.id || data.name || `provider_${Date.now()}`);
  const models = [...new Set(data.models.map((model) => model.trim()).filter(Boolean))];
  if (!models.length) throw new Error("至少填写一个模型 ID");
  const modality = normalizeModality(data.modality);
  if (!data.name.trim()) throw new Error("渠道名称不能为空");
  validateModelPriceAmounts(data.unitCredits, data.vendorCostCny);
  const provider = await prisma.$transaction(async (tx) => {
  const created = await tx.modelProvider.create({
    data: {
      id: providerId,
      name: data.name.trim(),
      modality,
      enabled: data.enabled ?? true,
      baseUrl: normalizeProviderBaseUrl(data.baseUrl),
      iconUrl: data.iconUrl?.trim() || null,
      apiKey: data.apiKey?.trim() || null,
      models,
      capability: buildProviderCapability(defaultProviderCapability(modality), models, data.routing) as any,
      costHint: data.costHint?.trim() || "后台手动接入模型渠道。"
    }
  });
  await ensureProviderPriceRows(created.id, created.name, created.modality, created.models, data.unitCredits, data.vendorCostCny, tx);
  return created;
  });
  return mapProvider(provider);
}

export async function deleteProvider(id: string) {
  return mapProvider(await prisma.modelProvider.update({ where: { id }, data: { enabled: false } }));
}

export async function updatePromptTemplate(
  id: string,
  data: Partial<{ name: string; type: string; version: string; enabled: boolean; summary: string; content: string }>
) {
  return mapTemplate(await prisma.promptTemplate.update({ where: { id }, data }));
}

export async function deletePromptTemplate(id: string) {
  return mapTemplate(await prisma.promptTemplate.update({ where: { id }, data: { enabled: false } }));
}

export async function getAdminSummary(_userId = DEMO_USER_ID): Promise<AdminSummary> {
  // All-time ledger totals are separate from the explicitly China-time daily count.
  const dayMs = 86_400_000;
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const dayStart = new Date(Math.floor((Date.now() + chinaOffsetMs) / dayMs) * dayMs - chinaOffsetMs);
  const taskWhere = { NOT: { id: { startsWith: "content_operation_" } } };
  const [users, projects, tasksToday, groups, accountTotals, consumed, refunds, paidOrders] = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.generationTask.count({ where: { ...taskWhere, createdAt: { gte: dayStart, lt: new Date(dayStart.getTime() + dayMs) } } }),
    prisma.generationTask.groupBy({ by: ["type", "provider", "model", "status"], where: taskWhere, _count: { _all: true }, _sum: { finalCredits: true } }),
    prisma.creditAccount.findMany({ select: { userId: true, totalConsume: true } }),
    prisma.creditTransaction.groupBy({ by: ["userId"], where: { type: "consume", amount: { lt: 0 } }, _sum: { amount: true } }),
    prisma.creditTransaction.aggregate({ where: { type: "refund", amount: { gt: 0 } }, _sum: { amount: true } }),
    prisma.rechargeOrder.aggregate({ where: { status: "paid", channel: { not: "mock" } }, _sum: { amountCny: true } })
  ]);
  const totalTasks = groups.reduce((sum, group) => sum + group._count._all, 0);
  const done = groups.filter(group => group.status === "succeeded").reduce((sum, group) => sum + group._count._all, 0);
  const failedTasks = groups.filter(group => group.status === "failed").reduce((sum, group) => sum + group._count._all, 0);
  const completedTasks = done + failedTasks;
  const consumptionByUser = new Map(consumed.map(row => [row.userId, Math.abs(row._sum.amount ?? 0)]));
  const creditsConsumed = [...consumptionByUser.values()].reduce((sum, value) => sum + value, 0);
  let unreconciledCredits = 0;
  for (const account of accountTotals) {
    unreconciledCredits += Math.abs(account.totalConsume - (consumptionByUser.get(account.userId) ?? 0));
    consumptionByUser.delete(account.userId);
  }
  unreconciledCredits += [...consumptionByUser.values()].reduce((sum, value) => sum + value, 0);
  const summarize = (mode: "stage" | "model") => {
    const rows = new Map<string, { stage: string; provider: string; model: string; modality: string; tasks: number; credits: number; failed: number; done: number }>();
    for (const group of groups) {
      const key = mode === "stage" ? group.type : `${group.provider}::${group.model}::${group.type}`;
      const row = rows.get(key) ?? { stage: group.type, provider: group.provider, model: group.model, modality: group.type, tasks: 0, credits: 0, failed: 0, done: 0 };
      row.tasks += group._count._all;
      row.credits += group._sum.finalCredits ?? 0;
      if (group.status === "failed") row.failed += group._count._all;
      if (group.status === "succeeded") row.done += group._count._all;
      rows.set(key, row);
    }
    return [...rows.values()].map(row => ({ ...row, providerCost: null, successRate: row.done + row.failed ? Math.round(100 * row.done / (row.done + row.failed)) : 0 }))
      .sort((a, b) => b.credits - a.credits || b.tasks - a.tasks).slice(0, 12);
  };
  return {
    users, projects, tasksToday, totalTasks, completedTasks,
    successRate: completedTasks ? Math.round(100 * done / completedTasks) : 0,
    creditsConsumed, unreconciledCredits,
    // Recharge receipts are cash inflow, not earned credit consumption revenue.
    paidRechargeCny: Math.round((paidOrders._sum.amountCny ?? 0) * 100) / 100,
    creditsRevenueEstimate: null,
    providerCost: null,
    providerCostStatus: "unavailable",
    grossMarginEstimate: null,
    grossMarginRate: null,
    refundCredits: refunds._sum.amount ?? 0,
    failedTasks,
    metricTimezone: "Asia/Shanghai",
    metricsNote: "累计实扣积分以 consume 流水为准；充值实收为已支付且非模拟订单金额，尚未按消耗确认收入；尚未接入供应商实际用量账单，成本与毛利不可计算。解冻积分不代表现金退款。今日任务按北京时间统计，成功率仅统计已成功或失败的生成任务，不含内部操作锁。",
    costByStage: summarize("stage"),
    costByModel: summarize("model")
  };
}

export async function adjustUserCredits({
  userId,
  amount,
  description,
  requestId,
  type = amount >= 0 ? "recharge" : "adjust"
}: {
  userId: string;
  amount: number;
  description: string;
  requestId?: string;
  type?: "recharge" | "adjust";
}) {
  if (!Number.isSafeInteger(amount) || amount === 0) throw new Error("调整积分必须为非零整数");
  if (requestId !== undefined && (!requestId.trim() || requestId.length > 128)) throw new Error("请求标识必须是 1 到 128 个字符");
  const transactionId = requestId ? `tx_admin_${crypto.createHash("sha256").update(`${userId}:${requestId}`).digest("hex")}` : `tx_${crypto.randomUUID()}`;
  const cleanDescription = description.trim() || (amount > 0 ? "后台手动充值" : "后台手动扣减");

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("用户不存在");

    const account = await lockCreditAccount(tx, userId);
    const replay = await tx.creditTransaction.findUnique({ where: { id: transactionId } });
    if (replay) {
      if (replay.userId !== userId || replay.amount !== amount || replay.type !== type || replay.description !== cleanDescription) throw new Error("该请求标识已用于不同的积分调整");
      return mapCreditAccount(account);
    }

    const nextBalance = account.balance + amount;
    if (nextBalance < account.frozenBalance || nextBalance < 0) throw new Error("调整后余额不能小于冻结积分或 0");

    const updated = await tx.creditAccount.update({
      where: { userId },
      data: {
        balance: { increment: amount },
        ...(amount > 0 && type === "recharge" ? { totalRecharge: { increment: amount } } : {}),
        ...(amount < 0 ? { totalConsume: { increment: Math.abs(amount) } } : {})
      }
    });

    await tx.creditTransaction.create({
      data: {
        id: transactionId,
        userId,
        type,
        amount,
        balanceAfter: updated.balance,
        description: cleanDescription
      }
    });

    return mapCreditAccount(updated);
  });
}

export async function redeemExperienceCode(userId = DEMO_USER_ID, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new Error("请输入兑换码");
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "RedeemCode" WHERE "code" = ${code} FOR UPDATE`;
    const redeemCode = await tx.redeemCode.findUnique({ where: { code }, include: { batch: { select: { enabled: true } } } });
    if (!redeemCode || !redeemCode.enabled) throw new Error("兑换码不存在或已停用");
    if (redeemCode.batch && !redeemCode.batch.enabled) throw new Error("兑换码批次已停用");
    if (!Number.isSafeInteger(redeemCode.credits) || redeemCode.credits < 0) throw new Error("兑换码积分配置无效");
    if (redeemCode.startsAt && redeemCode.startsAt > now) throw new Error("兑换码尚未开始");
    if (redeemCode.endsAt && redeemCode.endsAt < now) throw new Error("兑换码已过期");
    if (redeemCode.usedCount >= redeemCode.maxRedemptions) throw new Error("兑换码额度已用完");

    const existing = await tx.redeemRedemption.findFirst({ where: { userId, redeemCodeId: redeemCode.id } });
    if (existing) throw new Error("该兑换码已使用过");

    const account = await lockCreditAccount(tx, userId);

    const updated = await tx.creditAccount.update({
      where: { userId },
      data: {
        balance: { increment: redeemCode.credits },
        totalRecharge: { increment: redeemCode.credits }
      }
    });

    await tx.redeemCode.update({
      where: { id: redeemCode.id },
      data: { usedCount: { increment: 1 } }
    });

    await tx.redeemRedemption.create({
      data: {
        id: `redemption_${crypto.randomUUID()}`,
        redeemCodeId: redeemCode.id,
        userId,
        credits: redeemCode.credits
      }
    });

    await tx.creditTransaction.create({
      data: {
        id: `tx_${crypto.randomUUID()}`,
        userId,
        type: "recharge",
        amount: redeemCode.credits,
        balanceAfter: account.balance + redeemCode.credits,
        description: `兑换码 ${redeemCode.code} 入账：${redeemCode.name}`
      }
    });

    return mapCreditAccount(updated);
  });
}

type CreationQuoteInput = Parameters<typeof estimateCreation>[0];

async function resolveCreationTextInput<T extends CreationQuoteInput>(input: T, db: Pick<Prisma.TransactionClient, "modelProvider"> = prisma) {
  const providerId = input.textProvider || process.env.TEXT_PROVIDER;
  const provider = providerId ? await db.modelProvider.findUnique({ where: { id: providerId } }) : null;
  const model = input.textModel || readProviderRoutingState(provider?.capability, provider?.models ?? []).preferredModel || textModelName(input);
  assertProductionMediaProvider(provider, providerId || "local", model, "text");
  return { ...input, textProvider: providerId, textModel: model };
}

async function buildCreationStartQuote(input: CreationQuoteInput, db: Pick<Prisma.TransactionClient, "modelPrice"> = prisma): Promise<CreationEstimate> {
  const baseEstimate = estimateCreation(input);
  const estimatedCredits = await resolveTextRunCredits(input, baseEstimate.suggestedEpisodes, db);
  return {
    words: baseEstimate.words, suggestedEpisodes: baseEstimate.suggestedEpisodes, mode: baseEstimate.mode, estimatedCredits,
    notes: [
      ...baseEstimate.notes.slice(0, 2),
      "本次仅冻结文本解析、全局设定、剧本整理、角色与场景提取的积分；成功后结算，最终失败解冻。",
      "角色图、分镜图、视频和配音会在对应生成步骤单独报价与确认，本次不收取这些费用。"
    ],
    breakdown: [{ label: "文本解析与项目结构化", providerId: input.textProvider, model: input.textModel,
      quantity: baseEstimate.suggestedEpisodes, unitCredits: estimatedCredits / baseEstimate.suggestedEpisodes,
      totalCredits: estimatedCredits, hint: "按本次选择集数及实际文本渠道、模型的启用价格计费。" }]
  };
}

export async function quoteCreationStart(input: CreationQuoteInput): Promise<CreationEstimate> {
  return buildCreationStartQuote(await resolveCreationTextInput(input));
}

export async function createProjectAndTask(
  input: CreateProjectInput,
  userId = DEMO_USER_ID,
  maxCredits = Number.POSITIVE_INFINITY,
  db: PrismaClient = prisma
): Promise<{ projectId: string; taskId: string; task: GenerationTask; estimatedCredits: number; estimate: CreationEstimate; replayed: boolean }> {
  const requestId = input.requestId?.trim();
  if (!requestId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(requestId)) throw new ProjectRequestError(400, "请提供有效的创建请求标识，网络重试时保留同一标识。");
  if ((maxCredits !== Number.POSITIVE_INFINITY && !Number.isFinite(maxCredits)) || maxCredits < 0) throw new Error("积分确认上限无效，请重新获取报价。");
  const { requestId: _requestId, maxCredits: _maxCredits, ...generationInput } = input;
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
    return value;
  }
  const requestHash = crypto.createHash("sha256").update(JSON.stringify(canonical(generationInput))).digest("hex");

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`creation-request:${userId}:${requestId}`}))`;
    const previous = await tx.creationRequest.findUnique({ where: { userId_requestId: { userId, requestId } } });
    if (previous) {
      if (previous.requestHash !== requestHash) throw new ProjectRequestError(409, "此创建请求标识已用于不同内容，请为新的创作使用新标识。");
      const task = await tx.generationTask.findFirst({ where: { id: previous.taskId, userId } });
      const project = await tx.project.findFirst({ where: { id: previous.projectId, userId } });
      if (!project || !task || task.projectId !== project.id) throw new ProjectRequestError(409, "原创建项目已删除或不可用，请明确新建创作后重新提交。");
      const estimate = previous.estimate as unknown as CreationEstimate;
      return { projectId: project.id, taskId: task.id, task: mapTask(task), estimatedCredits: estimate.estimatedCredits, estimate, replayed: true };
    }
    const resolvedInput = await resolveCreationTextInput(input, tx);
    const estimate = await buildCreationStartQuote(resolvedInput, tx);
    if (estimate.estimatedCredits > maxCredits) throw new Error("价格或创建内容已变化，请重新获取报价并确认冻结积分。");
    const projectId = `proj_${crypto.randomUUID()}`;
    const taskId = `task_${crypto.randomUUID()}`;
    await tx.project.create({
      data: {
        id: projectId,
        userId,
        name: input.title || "未命名作品",
        type: input.genre,
        intro: input.content.slice(0, 120) || "由创作向导创建的项目。",
        sourceType: input.sourceType,
        artStyle: input.artStyle,
        videoRatio: input.videoRatio,
        textProvider: resolvedInput.textProvider,
        textModel: resolvedInput.textModel,
        imageProvider: input.imageProvider,
        imageModel: input.imageModel,
        imageSize: input.imageSize ? normalizeImageOutputSize(input.imageSize) : null,
        imageQuality: input.imageQuality ? normalizeImageOutputQuality(input.imageQuality) : null,
        videoProvider: input.videoProvider,
        videoModel: input.videoModel,
        status: "planning",
        episodes: estimate.suggestedEpisodes
      }
    });

    const task = await tx.generationTask.create({
      data: {
        id: taskId,
        userId,
        projectId,
        projectName: input.title || "未命名作品",
        type: "text",
        title: "核心剧情、剧本与角色卡生成",
        jobId: `creation-${crypto.randomUUID()}`,
        requestPayload: JSON.parse(JSON.stringify(resolvedInput)),
        provider: textProviderName(resolvedInput),
        model: textModelName(resolvedInput),
        status: "pending",
        progress: 0,
        estimatedCredits: estimate.estimatedCredits
      }
    });

    await reserveTaskCredits(tx, { taskId, userId, description: "生成任务冻结积分" });
    await tx.creationRequest.create({ data: { id: `creation_request_${crypto.randomUUID()}`, userId, requestId, requestHash, projectId, taskId, estimate: JSON.parse(JSON.stringify(estimate)) } });
    return { projectId, taskId, task: mapTask(task), estimatedCredits: estimate.estimatedCredits, estimate, replayed: false };
  }, { timeout: 15_000 });
}

export async function runProjectImageTasks(
  projectId: string, userId = DEMO_USER_ID, options: { shotIds?: string[]; forceRegenerate?: boolean } = {}
): Promise<BatchGenerationResult> {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("项目不存在");
  const selected = new Set(options.shotIds?.filter(Boolean) ?? []);
  if (selected.size && !workflow.storyboards.some((shot) => selected.has(shot.id))) throw new Error("所选镜头不属于当前项目");
  const existing = new Set(workflow.assets.filter((asset) => asset.type === "image" && asset.status === "succeeded").map((asset) => asset.id));
  const provider = workflow.project.imageProvider || process.env.IMAGE_PROVIDER || "mock";
  const config = await prisma.modelProvider.findUnique({ where: { id: provider } });
  const model = workflow.project.imageModel || config?.models[0] || currentImageModelName(provider);
  assertProductionMediaProvider(config, provider, model, "image");
  const assetById = new Map(workflow.assets.map((asset) => [asset.id, asset]));
  const candidates = workflow.storyboards.filter((shot) => (!selected.size || selected.has(shot.id)) && (options.forceRegenerate || !existing.has(`image_${shot.id}`)));
  const gate = assertCharacterGateForStoryboardImages(workflow, selected.size > 0 || Boolean(options.forceRegenerate));
  if (!gate.pass) throw new Error(gate.message);
  const nineGrid = !selected.size && !options.forceRegenerate && Math.round(workflow.storyboards.length / Math.max(1, workflow.project.episodes)) === 9 && candidates.length >= 9 && !isMockImageProvider(provider);
  const shots = candidates.slice(0, nineGrid ? 9 : imageBatchLimit(workflow.storyboards.length, provider));
  if (!shots.length) throw new Error("没有需要生成的分镜图；已有图片可选择单镜头重新生成。");
  const size = normalizeImageOutputSize(workflow.project.imageSize);
  const quality = normalizeImageOutputQuality(workflow.project.imageQuality);
  const unitCredits = await resolveImageCreditPerShot(provider, model, size, quality);
  const estimatedCredits = (nineGrid ? 1 : shots.length) * unitCredits;
  const source = captureMediaSource(workflow, "image", shots.map(shot => shot.id));
  return runMediaTask({ userId, projectId, projectName: workflow.project.name, type: "image", scope: "image", provider, model, estimatedCredits, source, title: nineGrid ? "九宫格分镜图生成" : "分镜图生成" }, async (billing) => {
    const successes: Array<{ shot: StoryboardShot; url: string }> = [];
    const failures: string[] = [];
    if (nineGrid) {
      const results = await generateNineGridSheetImages(projectId, workflow, shots, provider, model, [model], assetById, size, quality);
      for (const [index, result] of results.entries()) {
        if (!result.imageUrl) throw new Error("真实九宫格模型未返回图片");
        const url = await persistImageReference(result.imageUrl, `shot-${projectId}-${shots[index]!.shotNo}`);
        successes.push({ shot: shots[index]!, url: url || result.imageUrl });
      }
      if (successes.length !== shots.length) throw new Error("九宫格图片裁切数量不完整，请重试。");
    } else {
      await Promise.all(shots.map(async (shot, index) => {
        try {
          const result = await generateImage({
            prompt: buildStoryboardFirstFramePrompt({ workflow, shot, assetById }),
            negativePrompt: "字幕, 水印, Logo, 低清晰度, 畸形手, 多余手指, 换脸, 同款分身, 过暗, 欠曝, 模糊",
            referenceImageUrls: resolveStoryboardReferenceAssets(workflow, shot, assetById).map((asset) => asset.referenceUrl).filter(Boolean) as string[],
            ratio: workflow.project.videoRatio, seed: 30000 + index, provider, model, modelPool: [model], size, quality,
            baseUrl: config?.baseUrl ?? undefined, apiKey: config?.apiKey ?? undefined
          });
          if (!result.imageUrl && !isMockImageProvider(provider)) throw new Error("真实生图渠道未返回图片");
          const source = result.imageUrl || createSvgDataUrl(`镜头 ${shot.shotNo}`, shot.pictureDesc, workflow.project.artStyle);
          const url = await persistImageReference(source, `shot-${projectId}-${shot.shotNo}`);
          successes.push({ shot, url: url || source });
        } catch (error) { failures.push(`镜头 ${shot.shotNo}：${error instanceof Error ? error.message : "生成失败"}`); }
      }));
    }
    if (!successes.length) throw new Error(failures.join("；") || "未生成可用图片");
    const billed = (nineGrid ? 1 : successes.length) * unitCredits;
    const result = await billing.complete(billed, (tx, settledCredits) => persistCurrentShotImages(tx, projectId, successes, settledCredits), {
      status: failures.length ? "failed" : "succeeded", errorReason: failures.length ? `成功 ${successes.length} 张，失败 ${failures.length} 张；只对成功项扣费。${failures.join("；")}` : null,
      onStale: tx => persistStaleShotOutputs(tx, { projectId, taskId: billing.taskId, type: "image", outputs: successes })
    });
    const refreshed = await getProjectWorkflow(projectId, userId);
    return { project: refreshed!.project, task: mapTask(result.task), assetsCreated: result.created };
  });
}

export async function runProjectVideoTasks(
  projectId: string, userId = DEMO_USER_ID, options: { storyboardIds?: string[]; regenerate?: boolean } = {}
): Promise<BatchGenerationResult> {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("项目不存在");
  const known = new Set(workflow.storyboards.map((shot) => shot.id));
  const requested = new Set(options.storyboardIds ?? []);
  if (requested.size && ![...requested].some((id) => known.has(id))) throw new Error("所选镜头不属于当前项目");
  const images = new Map(workflow.assets.filter((asset) => asset.type === "image" && asset.status === "succeeded" && asset.referenceUrl
    && /^(?:https?:\/\/|\/storage\/|data:image\/)/i.test(asset.referenceUrl)).map((asset) => [asset.id.replace(/^image_/, ""), asset]));
  const videos = new Map(workflow.assets.filter((asset) => asset.type === "video").map((asset) => [asset.id.replace(/^video_/, ""), asset]));
  const pending = await prisma.generationTask.findMany({ where: { userId, projectId, jobId: { startsWith: "media:video:" }, status: { in: ["pending", "running"] } } });
  const pendingShots = new Set(pending.map((task) => task.jobId!.slice("media:video:".length)));
  const regenerate = Boolean(options.regenerate && requested.size);
  const provider = workflow.project.videoProvider || process.env.VIDEO_PROVIDER || "dashscope-video";
  const config = await prisma.modelProvider.findUnique({ where: { id: provider } });
  const model = workflow.project.videoModel || config?.models[0] || currentVideoModelName(provider);
  const candidates = workflow.storyboards.filter((shot) => (!requested.size || requested.has(shot.id))
    && (pendingShots.has(shot.id) || (images.has(shot.id) && (regenerate || !isPersistedPlayableVideoReference(videos.get(shot.id)?.referenceUrl)))));
  const shots = candidates.slice(0, videoBatchLimit(workflow.storyboards.length, provider));
  if (!shots.length) throw new Error("没有可生成的镜头，请先生成首帧；已有视频需显式选择重新生成。");
  const unitCredits = await resolveVideoCreditPerSecond(provider, model);
  const outcomes: Array<{ task: GenerationTask; created: number }> = [];
  const errors: string[] = [];
  for (const shot of shots) {
    try {
      if (!pendingShots.has(shot.id)) assertProductionMediaProvider(config, provider, model, "video");
      const result = await runMediaTask({
        userId, projectId, projectName: workflow.project.name, type: "video", scope: `video:${shot.id}`,
        title: `镜头 ${shot.episodeNo}-${shot.shotNo} 视频生成`, provider, model,
        estimatedCredits: Math.max(1, shot.duration) * unitCredits, resume: true,
        source: captureMediaSource(workflow, "video", [shot.id])
      }, async (billing) => {
        let checkpoint = mediaCheckpoint(billing.task);
        const runtimeProvider = typeof checkpoint.provider === "string" ? checkpoint.provider : provider;
        const runtimeModel = typeof checkpoint.model === "string" ? checkpoint.model : model;
        const runtimeConfig = runtimeProvider === provider ? config : await prisma.modelProvider.findUnique({ where: { id: runtimeProvider } });
        let generated: VideoGenerationResult;
        if (typeof checkpoint.remoteVideoUrl === "string") {
          generated = { taskId: String(checkpoint.remoteTaskId || "stored-result"), status: "succeeded", videoUrl: checkpoint.remoteVideoUrl, provider: runtimeProvider, model: runtimeModel };
        } else if (typeof checkpoint.remoteTaskId === "string") {
          generated = await queryVideoTaskResult({ taskId: checkpoint.remoteTaskId, provider: runtimeProvider, model: runtimeModel, baseUrl: runtimeConfig?.baseUrl ?? undefined, apiKey: runtimeConfig?.apiKey ?? undefined });
        } else {
          await billing.checkpoint({ submissionStarted: true, provider: runtimeProvider, model: runtimeModel, shotId: shot.id });
          generated = await generateVideo({
            prompt: buildSeedanceVideoPrompt({ workflow, shot, firstFrameAsset: images.get(shot.id), assetById: new Map(workflow.assets.map((asset) => [asset.id, asset])) }),
            imageUrl: images.get(shot.id)?.referenceUrl, ratio: workflow.project.videoRatio, duration: shot.duration,
            provider: runtimeProvider, model: runtimeModel, modelPool: [runtimeModel], baseUrl: runtimeConfig?.baseUrl ?? undefined, apiKey: runtimeConfig?.apiKey ?? undefined,
            onTaskSubmitted: async (remote) => {
              checkpoint = { ...checkpoint, remoteTaskId: remote.taskId, provider: remote.provider, model: remote.model, shotId: shot.id };
              await billing.checkpoint(checkpoint);
            }
          });
        }
        if (!generated.videoUrl) {
          const definitiveFailure = ["failed", "canceled"].includes(generated.status)
            && ["auth", "config", "provider_failed", "canceled", "no_output"].includes(generated.failureCategory ?? "");
          if (definitiveFailure) {
            const failed = await billing.complete(0, async () => ({ created: 0 }), { status: "failed", errorReason: generated.message || "上游任务失败，积分已释放。" });
            return { task: mapTask(failed.task), created: 0 };
          }
          const taskId = checkpoint.remoteTaskId || (["queued", "running"].includes(generated.status) ? generated.taskId : undefined);
          const pendingTask = await billing.defer({ ...checkpoint, remoteTaskId: taskId, provider: runtimeProvider, model: runtimeModel,
            shotId: shot.id, submissionStarted: true, lastError: generated.message, needsReconciliation: !taskId });
          return { task: mapTask(pendingTask), created: 0 };
        }
        await billing.checkpoint({ ...checkpoint, remoteVideoUrl: generated.videoUrl, provider: runtimeProvider, model: runtimeModel, shotId: shot.id });
        const videoUrl = await persistVideoReference(generated.videoUrl, `video-${projectId}-${shot.shotNo}`);
        if (!videoUrl) throw new Error("视频已生成但保存失败，请刷新继续保存。");
        const completed = await billing.complete(billing.task.estimatedCredits,
          (tx, settledCredits) => persistCurrentShotVideo(tx, { projectId, shot, url: videoUrl, credits: settledCredits, description: generated.message }),
          { onStale: tx => persistStaleShotOutputs(tx, { projectId, taskId: billing.taskId, type: "video", outputs: [{ shot, url: videoUrl }] }) });
        return { task: mapTask(completed.task), created: completed.created };
      });
      outcomes.push(result);
    } catch (error) { errors.push(`镜头 ${shot.shotNo}：${error instanceof Error ? error.message : "生成失败"}`); }
  }
  if (!outcomes.length) throw new Error(errors.join("；") || "没有可处理的视频任务");
  const refreshed = await getProjectWorkflow(projectId, userId);
  return { project: refreshed!.project, task: outcomes[outcomes.length - 1]!.task,
    assetsCreated: outcomes.reduce((sum, result) => sum + result.created, 0),
    message: [...errors, candidates.length > shots.length ? `本次处理 ${shots.length} 个镜头，其余可继续提交。` : "", outcomes.some((result) => result.task.status === "pending") ? "上游视频仍在生成；积分保持冻结，再次点击生成会查询原任务，不会重复提交。" : ""].filter(Boolean).join("；") };
}

async function resolveVideoCreditPerSecond(provider: string, model: string) {
  const price = await prisma.modelPrice.findFirst({
    where: {
      providerId: videoProviderId(provider),
      model,
      enabled: true
    }
  });
  if (!price && process.env.NODE_ENV === "production") throw new Error("该视频模型尚未配置价格，请联系管理员。");
  return price?.unitCredits ?? videoCreditPerSecond(provider);
}

function buildVideoTaskErrorReason(
  videoResults: Array<{
    result: {
      status: string;
      taskId: string;
      message?: string;
      failureCategory?: string;
      retryable?: boolean;
    };
    videoUrl?: string;
  }>
) {
  const pending = videoResults.filter((item) => !item.videoUrl && (item.result.status === "queued" || item.result.status === "running"));
  const failed = videoResults.filter((item) => item.result.status === "failed" || item.result.status === "timeout" || item.result.status === "canceled");
  if (!pending.length && !failed.length) return null;
  const parts: string[] = [];
  if (pending.length) {
    parts.push(`${pending.length} 条上游异步视频仍在生成中，可稍后刷新继续轮询；未返回可播放 URL 前不正式扣除这部分积分。`);
  }
  if (failed.length) {
    const categories = Array.from(new Set(failed.map((item) => item.result.failureCategory).filter(Boolean))).join("、") || "unknown";
    const firstMessage = failed.find((item) => item.result.message)?.result.message;
    parts.push(`${failed.length} 条视频生成失败（分类：${categories}）。可切换阶段内视频模型，沿用已生成首帧继续生成。${firstMessage ? `首条原因：${firstMessage}` : ""}`);
  }
  return parts.join(" ");
}

export async function exportStoryboardRows(projectId: string, userId = DEMO_USER_ID): Promise<StoryboardExportRow[]> {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("项目不存在");

  return workflow.storyboards.map((shot) => ({
    shot: `${shot.episodeNo}-${shot.sceneNo}-${shot.shotNo}`,
    duration: shot.duration,
    shotSize: shot.shotSize,
    cameraMovement: shot.cameraMovement,
    characters: shot.characters.join("、"),
    scene: shot.scene,
    pictureDesc: shot.pictureDesc,
    dialogue: shot.dialogue,
    voiceOver: shot.voiceOver,
    soundEffect: [shot.environmentSound, shot.soundEffect].filter(Boolean).join(" + "),
    imagePrompt: shot.imagePrompt,
    videoPrompt: shot.videoPrompt,
    referenceAssetIds: shot.referenceAssetIds.join(",")
  }));
}

export async function getDirectorStoryboardRows(projectId: string, userId = DEMO_USER_ID) {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("项目不存在");
  return workflow.storyboards.map((shot, index) => buildDirectorStoryboardRow(workflow, shot, index));
}

export async function getStoryboardProductionPackage(projectId: string, userId = DEMO_USER_ID) {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("项目不存在");
  return createStoryboardProductionPackage(workflow);
}

export async function exportDirectorStoryboardPackage(projectId: string, userId = DEMO_USER_ID) {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("项目不存在");
  return createDirectorStoryboardPackage(workflow);
}

export async function listExportJobs(userId = DEMO_USER_ID, projectId?: string, db: PrismaClient = prisma) {
  return db.$transaction(async tx => {
    const jobs = await tx.exportJob.findMany({
      where: {
        userId,
        ...(projectId ? { projectId } : {})
      },
      orderBy: { createdAt: "desc" }
    });
    return mapExportsWithCurrentSource(tx, jobs, userId);
  }, { isolationLevel: "RepeatableRead" });
}

async function mapExportsWithCurrentSource(tx: Prisma.TransactionClient, jobs: ExportJobRow[], userId: string) {
  const contexts = new Map<string, ReturnType<typeof createExportSourceContext>>();
  await Promise.all([...new Set(jobs.map(job => job.projectId))].map(async projectId => {
    contexts.set(projectId, createExportSourceContext(await getProjectWorkflow(projectId, userId, tx)));
  }));
  return jobs.map(job => mapExportJob(job, contexts.get(job.projectId)!(exportSourceFromDiagnostics(job.errorReason), job.type as "tts" | "subtitle" | "video_export")));
}

async function readCurrentExportJob(projectId: string, jobId: string, userId: string, db: PrismaClient = prisma) {
  return db.$transaction(async tx => {
    const job = await tx.exportJob.findFirst({ where: { id: jobId, projectId, userId } });
    return job ? (await mapExportsWithCurrentSource(tx, [job], userId))[0]! : null;
  }, { isolationLevel: "RepeatableRead" });
}

export async function getExportJobForDownload(projectId: string, jobId: string, userId = DEMO_USER_ID, db: PrismaClient = prisma) {
  const job = await readCurrentExportJob(projectId, jobId, userId, db);
  if (!job || job.status !== "succeeded" || !job.outputUrl) throw new Error("导出记录不存在或尚未生成下载文件");
  return job;
}

export async function quoteProjectExport(projectId: string, userId: string, type: "tts" | "subtitle" | "video_export", storyboardIds?: string[]) {
  const fullWorkflow = await getProjectWorkflow(projectId, userId);
  if (!fullWorkflow) throw new Error("项目不存在");
  const workflow = selectExportWorkflow(fullWorkflow, storyboardIds);
  if (type === "video_export") assertVideoExportReady(workflow);
  if (type === "subtitle") return { type, providerId: "local-subtitle", providerName: "字幕导出", model: "srt", characters: 0, estimatedCredits: 0, unitCredits: 0, unit: "tts_character" as const, cached: false, cueCount: 0 };
  return { type, ...await quoteProjectNarration(workflow, userId) };
}

export async function createProjectExportJob(
  projectId: string,
  userId = DEMO_USER_ID,
  type: "tts" | "subtitle" | "video_export",
  storyboardIds?: string[],
  maxCredits = 0
) {
  const fullWorkflow = await getProjectWorkflow(projectId, userId);
  if (!fullWorkflow) throw new Error("项目不存在");
  const workflow = selectExportWorkflow(fullWorkflow, storyboardIds);
  if (!Number.isSafeInteger(maxCredits) || maxCredits < 0) throw new Error("请提供有效的导出积分上限");
  const videoSnapshot = type === "video_export" ? captureVideoExportSnapshot(workflow) : undefined;
  const sourceSnapshot = captureExportSource(workflow, type, storyboardIds === undefined ? "project" : "selection");
  if (type !== "subtitle" && (await quoteProjectNarration(workflow, userId)).estimatedCredits > maxCredits) throw new Error("配音价格或内容已变化，请重新获取报价并确认积分上限。");
  if (type === "video_export") {
    assertVideoExportReady(workflow);
    if (!(await probeFfmpeg()).ready) throw new Error("成片服务缺少可用 FFmpeg，请管理员完成部署配置后重试");
  }
  const scope = crypto.createHash("sha256").update(JSON.stringify({ projectId, type, shots: workflow.storyboards, assets: workflow.assets.map(asset => [asset.id, asset.referenceUrl]) })).digest("hex").slice(0, 24);
  const acquired = await prisma.$transaction(async tx => {
    // Take the project first: stale-job takeover must not hold ExportJob while waiting on a new job's project FK.
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`project-lifecycle:${projectId}`}))`;
    await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} AND "userId" = ${userId} FOR UPDATE`;
    if (!await tx.project.findFirst({ where: { id: projectId, userId } })) throw new Error("项目不存在");
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`export:${userId}:${scope}`}))`;
    const current = await tx.exportJob.findFirst({ where: { userId, projectId, type, id: { startsWith: `export_${scope}_` }, status: "running" } });
    if (current && current.updatedAt.getTime() > Date.now() - 120_000) return { job: current, acquired: false };
    if (current) await tx.exportJob.update({ where: { id: current.id }, data: { status: "failed", errorReason: JSON.stringify({ kind: "export_diagnostics", sourceSnapshot: exportSourceFromDiagnostics(current.errorReason) ?? undefined, message: "导出进程中断，可重新导出，已完成的配音将复用。" }) } });
    const job = await tx.exportJob.create({
    data: {
      id: `export_${scope}_${crypto.randomUUID()}`,
      userId,
      projectId,
      type,
      status: "running",
      errorReason: JSON.stringify({ kind: "export_diagnostics", storyboardIds: sourceSnapshot.storyboardIds, sourceSnapshot, message: "导出处理中" })
    }
    });
    return { job, acquired: true };
  });
  const job = acquired.job;
  if (!acquired.acquired) return (await readCurrentExportJob(projectId, job.id, userId))!;
  const heartbeat = setInterval(() => {
    void prisma.exportJob.updateMany({ where: { id: job.id, status: "running" }, data: { updatedAt: new Date() } }).catch(() => undefined);
  }, 20_000);
  heartbeat.unref();

  try {
    const narration = type === "subtitle" ? undefined : await getOrCreatePaidNarration(workflow, userId, prisma, { maximumCredits: maxCredits });
    const exportResult =
      type === "tts"
        ? await createTtsManifest(workflow, narration!)
        : type === "subtitle"
          ? await createSubtitleAsset(workflow)
          : await createVideoExportPackage(workflow, narration!);

    if (type === "video_export" && exportResult.outputKind !== "mp4") {
      await prisma.exportJob.update({
        where: { id: job.id },
        data: { status: "failed", outputUrl: exportResult.outputUrl, errorReason: exportDiagnosticsMessage(type, exportResult, workflow.storyboards.map(shot => shot.id), undefined, videoSnapshot, false, sourceSnapshot) }
      });
      return (await readCurrentExportJob(projectId, job.id, userId))!;
    }

    const refreshed = await persistProjectExportSuccess({ projectId, userId, jobId: job.id, type, workflow, exportResult, videoSnapshot, sourceSnapshot });
    return mapExportJob(refreshed, refreshed.sourceStatus);
  } catch (error) {
    const failed = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorReason: JSON.stringify({ kind: "export_diagnostics", sourceSnapshot, storyboardIds: sourceSnapshot.storyboardIds, message: error instanceof Error ? error.message : "导出失败" })
      }
    });
    return (await readCurrentExportJob(projectId, failed.id, userId))!;
  } finally { clearInterval(heartbeat); }
}

/** Persist the already-produced output atomically; no provider or file work may run while these locks are held. */
export async function persistProjectExportSuccess(input: {
  projectId: string;
  userId: string;
  jobId: string;
  type: "tts" | "subtitle" | "video_export";
  workflow: ProjectWorkflow;
  exportResult: MediaExportResult;
  videoSnapshot?: VideoExportSnapshot;
  sourceSnapshot?: ExportSourceSnapshot;
}, db: PrismaClient = prisma) {
  const { projectId, userId, jobId, type, workflow, exportResult, videoSnapshot } = input;
  const sourceSnapshot = input.sourceSnapshot ?? captureExportSource(workflow, type);
  if (type === "video_export" && (!videoSnapshot || exportResult.outputKind !== "mp4")) throw new Error("缺少有效的成片导出快照或 MP4 结果");
  return db.$transaction(async tx => {
    // Share the lifecycle ordering with deletion and manual shot edits before locking the export job.
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`project-lifecycle:${projectId}`}))`;
    await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} AND "userId" = ${userId} FOR UPDATE`;
    const currentWorkflow = await getProjectWorkflow(projectId, userId, tx);
    if (!currentWorkflow) throw new Error("项目不存在");
    await tx.$queryRaw`SELECT "id" FROM "ExportJob" WHERE "id" = ${jobId} FOR UPDATE`;
    const current = await tx.exportJob.findUniqueOrThrow({ where: { id: jobId } });
    if (current.projectId !== projectId || current.userId !== userId || current.type !== type) throw new Error("导出任务不属于当前项目");
    if (current.status !== "running") throw new Error("导出已由新的请求接管，请刷新查看结果");
    const completion = type === "video_export"
      ? assessVideoExportCompletion(videoSnapshot!, currentWorkflow, { ...exportResult, status: "succeeded" })
      : undefined;
    const previousComplete = Boolean(completion && !completion.complete && currentWorkflow.project.status === "completed"
      && await hasCurrentCompleteExport(tx, userId, currentWorkflow));
    const sourceStatus = exportSourceStatus(sourceSnapshot, currentWorkflow, type);
    const updated = await tx.exportJob.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        outputUrl: exportResult.outputUrl,
        errorReason: exportDiagnosticsMessage(type, exportResult, workflow.storyboards.map(shot => shot.id), completion, videoSnapshot, previousComplete, sourceSnapshot)
      }
    });

    const isVideoMp4 = exportResult.outputKind === "mp4";
    const assetName = type === "tts"
      ? "TTS 配音音轨"
      : type === "subtitle"
        ? "字幕文件"
        : isVideoMp4
          ? "合成导出成片"
          : "合成诊断清单";
    const assetDescription = type === "tts"
      ? "与镜头时长对齐的配音 WAV，可被最终视频合成复用"
      : type === "subtitle"
        ? "SRT 字幕文件"
        : isVideoMp4
          ? "已完成片段、配音和字幕封装的 MP4"
          : "FFmpeg 不可用或合成失败时生成的可复盘诊断清单";

    await tx.asset.create({
      data: {
        id: `asset_${type}_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
        projectId,
        type: type === "tts" ? "audio" : type === "subtitle" ? "subtitle" : "video",
        name: assetName,
        description: assetDescription,
        prompt: workflow.project.name,
        referenceUrl: exportResult.outputUrl,
        status: "succeeded",
        relatedCharacterId: null
      }
    });

    if (type === "video_export") {
      await tx.project.update({
        where: { id: projectId },
        // A partial export preserves proven full delivery; a late export cannot undo a return to storyboarding.
        data: { status: completion!.complete || previousComplete ? "completed" : currentWorkflow.project.status === "completed" ? "rendering" : currentWorkflow.project.status }
      });
    }
    return { ...updated, sourceStatus };
  });
}

async function hasCurrentCompleteExport(tx: Prisma.TransactionClient, userId: string, workflow: ProjectWorkflow) {
  const candidates = await tx.exportJob.findMany({
    where: { projectId: workflow.project.id, userId, type: "video_export", status: "succeeded", errorReason: { contains: '"projectCompletion":"complete"' } },
    orderBy: { createdAt: "desc" }
  });
  return candidates.some(job => {
    try {
      const snapshot = readVideoExportSnapshot(JSON.parse(job.errorReason!).videoSnapshot);
      return snapshot !== null && assessVideoExportCompletion(snapshot, workflow, mapExportJob(job)).complete;
    } catch { return false; }
  });
}

function exportDiagnosticsMessage(type: "tts" | "subtitle" | "video_export", result: MediaExportResult, storyboardIds: string[], completion?: ReturnType<typeof assessVideoExportCompletion>, videoSnapshot?: VideoExportSnapshot, previousComplete = false, sourceSnapshot?: ExportSourceSnapshot) {
  const warningText = result.warnings?.length ? result.warnings.slice(0, 3).join("；") : "";
  const completionMessage = completion?.complete
    ? "MP4 成片已生成，当前项目全部镜头已完成导出，可预览和下载。"
    : previousComplete
      ? "本次选定镜头的 MP4 已生成；项目已有与当前内容一致的完整成片，可继续预览和下载。"
      : completion?.reason === "source_changed"
      ? "MP4 已生成，但镜头或素材在导出期间发生变化；该文件保留为历史成片，请基于当前内容重新导出。"
      : completion
        ? "本次选定镜头的 MP4 已生成；当前项目尚未完成全部镜头和集数的导出，可继续制作。"
        : "MP4 成片已生成，可预览和下载。";
  const message = type === "video_export"
    ? result.outputKind === "mp4"
      ? completionMessage
      : "已生成诊断包：包含视频片段、配音、字幕、FFmpeg 状态和复盘清单；配置 FFmpeg 后可重新导出 MP4。"
    : type === "tts"
      ? "多角色配音资产已生成，可被最终 MP4 合成复用。"
      : "SRT 字幕资产已生成，可被最终 MP4 合成复用。";
  return JSON.stringify({
    kind: "export_diagnostics",
    storyboardIds,
    projectCompletion: completion?.reason,
    videoSnapshot: completion?.complete ? videoSnapshot : undefined,
    sourceSnapshot,
    message: warningText ? `${message} ${warningText}` : message,
    outputKind: result.outputKind,
    manifestUrl: result.manifestUrl,
    subtitleUrl: result.subtitleUrl,
    audioUrl: result.audioUrl,
    previewUrl: result.previewUrl || (result.outputKind === "mp4" ? result.outputUrl : undefined),
    ffmpegReady: result.ffmpegReady,
    clipCount: result.clipCount,
    warnings: result.warnings ?? []
  });
}

export async function retryTask(taskId: string, userId = DEMO_USER_ID, input?: CreateProjectInput, db: PrismaClient = prisma) {
  return mapTask(await db.$transaction(async (tx) => {
    const candidate = await tx.generationTask.findFirst({ where: { id: taskId, userId } });
    if (candidate?.projectId) {
      await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`project-lifecycle:${candidate.projectId}`}))`;
      if (!await tx.project.findFirst({ where: { id: candidate.projectId, userId } })) throw new ProjectRequestError(409, "原项目已删除，不能重新冻结积分或重试任务。");
    }
    const { task } = await lockTaskCredits(tx, taskId, userId);
    if (task.status === "succeeded") throw new Error("已成功任务不需要重试");
    if (task.status === "pending" || task.status === "running") return task;
    if (task.type !== "text" || !task.projectId || !task.jobId) {
      throw new Error("请回到对应创作步骤重新生成此任务");
    }
    await reserveTaskCredits(tx, { taskId, userId, description: "重试生成任务，重新冻结预计积分" });
    return tx.generationTask.update({
      where: { id: taskId },
      data: { status: "pending", progress: 0, errorReason: null,
        jobId: `creation-${crypto.randomUUID()}`,
        ...(input ? { requestPayload: JSON.parse(JSON.stringify(input)) } : {}) }
    });
  }));
}

export async function cancelTask(taskId: string, userId = DEMO_USER_ID) {
  return mapTask(await prisma.$transaction(async (tx) => {
    const { task } = await lockTaskCredits(tx, taskId, userId);
    if (/^(content|media):/.test(task.jobId ?? "")) throw new Error("此生成正在独立处理中，请在对应创作步骤查看结果或重试");
    if (task.status === "succeeded") throw new Error("已成功任务不能取消");
    if (task.status === "canceled") return task;
    const release = await releaseTaskCredits(tx, { taskId, userId, description: "任务取消，退回本任务未消耗冻结积分" });
    return tx.generationTask.update({
      where: { id: taskId },
      data: { status: "canceled", progress: 0,
        errorReason: release.credits > 0 ? `用户取消，已退回 ${release.credits} 积分。` : "用户取消任务。" }
    });
  }));
}

function createSvgDataUrl(title: string, desc: string, style: string) {
  const shortDesc = desc.length > 42 ? `${desc.slice(0, 42)}...` : desc;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#eef8ef"/>
      <stop offset="48%" stop-color="#d9eee1"/>
      <stop offset="100%" stop-color="#b7d9c7"/>
    </linearGradient>
  </defs>
  <rect width="720" height="1280" fill="url(#bg)"/>
  <rect x="76" y="110" width="568" height="880" rx="28" fill="#ffffff" opacity="0.72"/>
  <circle cx="246" cy="414" r="92" fill="#7eab8d" opacity="0.88"/>
  <circle cx="436" cy="430" r="104" fill="#315f54" opacity="0.82"/>
  <rect x="170" y="560" width="390" height="160" rx="22" fill="#f6fbf5" opacity="0.88"/>
  <text x="360" y="1055" text-anchor="middle" font-size="36" font-family="Microsoft YaHei, Arial" fill="#23443b">${escapeSvg(title)}</text>
  <text x="360" y="1116" text-anchor="middle" font-size="24" font-family="Microsoft YaHei, Arial" fill="#4e685d">${escapeSvg(style)}</text>
  <text x="360" y="1172" text-anchor="middle" font-size="22" font-family="Microsoft YaHei, Arial" fill="#315f54">${escapeSvg(shortDesc)}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function generateNineGridSheetImages(
  projectId: string,
  workflow: ProjectWorkflow,
  shots: StoryboardShot[],
  imageProvider: string,
  imageModel: string,
  imageModelPool: string[],
  assetById: Map<string, AssetItem>,
  imageSize: string,
  imageQuality: string
): Promise<ImageGenerationResult[]> {
  const results: ImageGenerationResult[] = [];
  for (let groupIndex = 0; groupIndex < shots.length; groupIndex += 9) {
    const group = shots.slice(groupIndex, groupIndex + 9);
    const sheetPrompt = buildNineGridSheetPrompt(group, workflow.project.artStyle, workflow.project.videoRatio, assetById);
    const sheet = await generateImage({
      prompt: sheetPrompt,
      negativePrompt: "字幕, 水印, Logo, 漫画格文字, 对话框, 低清晰度, 畸形手, 多余手指, 换脸, 同款分身",
      referenceImageUrls: uniqueReferenceUrls(group, assetById),
      ratio: "1:1",
      seed: 39000 + groupIndex,
      provider: workflow.project.imageProvider,
      model: imageModel,
      modelPool: imageModelPool,
      size: imageSize,
      quality: imageQuality
    });
    if (!sheet.imageUrl) {
      throw new Error(`9宫格总图未返回图片 URL：${sheet.provider || imageProvider} / ${sheet.model || imageModel}`);
    }
    const sheetUrl = await persistImageReference(sheet.imageUrl, `nine-grid-sheet-${projectId}-${Math.floor(groupIndex / 9) + 1}`);
    if (!sheetUrl?.startsWith("/storage/")) {
      throw new Error(`9宫格总图无法保存到本地，不能裁切：${sheetUrl || sheet.imageUrl}`);
    }
    const tiles = await cropNineGridSheet(sheetUrl, `shot-${projectId}-${Math.floor(groupIndex / 9) + 1}`);
    group.forEach((shot, index) => {
      results.push({
        taskId: `${sheet.taskId}_${index + 1}`,
        status: "succeeded",
        imageUrl: tiles[index],
        provider: `${sheet.provider || currentImageProviderName(imageProvider)} / 9宫格裁切`,
        model: sheet.model || imageModel
      });
    });
  }
  return results;
}

function buildNineGridSheetPrompt(
  shots: StoryboardShot[],
  artStyle: string,
  videoRatio: string,
  assetById: Map<string, AssetItem>
) {
  const shotLines = shots.map((shot, index) => `${index + 1}. ${buildReferencedShotPrompt(shot.imagePrompt, shot.referenceAssetIds, assetById)}`);
  return [
    "生成一张 3x3 九宫格 AI 漫剧分镜总图，正方形画布，九个等大的无边框画面区域。",
    "每个格子对应一个镜头，按从左到右、从上到下的顺序排列。",
    "每格都必须是完整独立画面，禁止字幕、文字、水印、对话框、编号。",
    "同一角色的五官、发型、服装主色必须一致；场景光线和画风统一。",
    `画风：${artStyle}；最终视频画幅：${videoRatio}，但本总图必须为 1:1 方便裁切。`,
    shotLines.join("\n")
  ].join("\n");
}

function uniqueReferenceUrls(shots: StoryboardShot[], assetById: Map<string, Pick<AssetItem, "referenceUrl">>) {
  return [...new Set(shots.flatMap((shot) => shot.referenceAssetIds.map((assetId) => assetById.get(assetId)?.referenceUrl).filter(Boolean) as string[]))];
}

async function cropNineGridSheet(sheetUrl: string, nameHint: string) {
  const buffer = await readStoredAsset(sheetUrl);
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 300 || height < 300) throw new Error("9宫格总图尺寸过小，无法裁切。");
  const tileWidth = Math.floor(width / 3);
  const tileHeight = Math.floor(height / 3);
  const urls: string[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const tile = await sharp(buffer)
        .extract({ left: col * tileWidth, top: row * tileHeight, width: tileWidth, height: tileHeight })
        .jpeg({ quality: 92 })
        .toBuffer();
      urls.push(await persistImageBuffer(tile, `${nameHint}-${row * 3 + col + 1}`, "jpg"));
    }
  }
  return urls;
}

function escapeSvg(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildReferencedShotPrompt(prompt: string, referenceAssetIds: string[], assetById: Map<string, { name: string; type: string; referenceUrl?: string }>) {
  const references = referenceAssetIds
    .map((assetId) => assetById.get(assetId))
    .filter((asset): asset is { name: string; type: string; referenceUrl?: string } => Boolean(asset?.referenceUrl));
  if (!references.length) return prompt;
  const referenceText = references.map((asset) => `${asset.name}(${asset.type})`).join("、");
  return [
    `使用参考图保持角色/场景一致：${referenceText}。角色脸型、发型、服装主色必须与参考图一致，只改变当前镜头动作、构图和环境光。`,
    prompt
  ].join("\n");
}

function safeId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `custom-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeModality(value: string) {
  if (["text", "image", "video", "tts", "embedding"].includes(value)) return value;
  throw new Error("模型类型只能是 text、image、video、tts 或 embedding");
}

function defaultBillingUnit(modality: string) {
  if (modality === "image") return "image";
  if (modality === "video") return "video_second";
  if (modality === "tts") return "tts_character";
  return "text_run";
}

function defaultProviderCapability(modality: string) {
  return {
    supportsReferenceImage: modality === "image" || modality === "video",
    supportsSeed: modality === "image",
    supportsImageToImage: modality === "image",
    supportsImageToVideo: modality === "video",
    supportsAsyncTask: modality === "image" || modality === "video",
    maxDuration: modality === "video" ? 5 : undefined,
    ratios: modality === "image" || modality === "video" ? ["9:16", "16:9", "1:1"] : []
  };
}

function normalizeProviderBaseUrl(value?: string | null) {
  const clean = value?.trim();
  if (!clean) return null;
  let url: URL;
  try { url = new URL(clean); } catch { throw new Error("渠道地址必须是有效的 HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("渠道地址只支持 HTTP(S)，且不能嵌入账号密码或片段");
  return clean;
}

function cleanProviderData(
  current: { modality: string; models: string[]; capability: unknown },
  data: Partial<{
    name: string;
    modality: string;
    enabled: boolean;
    baseUrl: string | null;
    iconUrl: string | null;
    apiKey: string | null;
    models: string[];
    costHint: string;
    routing: { mode?: "auto" | "manual"; preferredModel?: string | null; modelPool?: string[] };
  }>
) {
  const clean: Partial<{ name: string; modality: string; enabled: boolean; baseUrl: string | null; iconUrl: string | null; apiKey: string | null; models: string[]; costHint: string; capability: any }> = {};
  const nextModality = data.modality !== undefined ? normalizeModality(data.modality) : current.modality;
  if (data.name !== undefined) clean.name = data.name.trim();
  if (data.modality !== undefined) clean.modality = nextModality;
  if (data.enabled !== undefined) clean.enabled = data.enabled;
  if (data.baseUrl !== undefined) clean.baseUrl = normalizeProviderBaseUrl(data.baseUrl);
  if (data.iconUrl !== undefined) clean.iconUrl = data.iconUrl?.trim() || null;
  if (data.apiKey !== undefined && !/^\*{3,}/.test(data.apiKey ?? "")) clean.apiKey = data.apiKey?.trim() || null;
  if (data.models !== undefined) clean.models = [...new Set(data.models.map((model) => model.trim()).filter(Boolean))];
  if (data.costHint !== undefined) clean.costHint = data.costHint.trim();
  if (clean.name === "") throw new Error("渠道名称不能为空");
  if (clean.models && clean.models.length === 0) throw new Error("至少保留一个模型 ID");
  const nextModels = clean.models ?? current.models;
  if (data.modality !== undefined || data.models !== undefined || data.routing !== undefined) {
    const capabilityBase = data.modality !== undefined
      ? defaultProviderCapability(nextModality)
      : providerCapabilityBase(current.capability, nextModality);
    clean.capability = buildProviderCapability(capabilityBase, nextModels, data.routing, current.capability);
  }
  return clean;
}

function buildProviderCapability(
  capabilityBase: Record<string, unknown>,
  models: string[],
  routing?: { mode?: "auto" | "manual"; preferredModel?: string | null; modelPool?: string[] },
  existingCapability?: unknown
) {
  const existingRouting = readProviderRoutingState(existingCapability, models);
  const preferredCandidate = routing?.preferredModel?.trim() || existingRouting.preferredModel || models[0];
  const preferredModel = models.includes(preferredCandidate) ? preferredCandidate : models[0];
  const poolInput = routing?.modelPool ?? existingRouting.modelPool;
  const modelPool = uniqueModelPool((poolInput.length ? poolInput : models).filter((model) => models.includes(model)));
  return {
    ...capabilityBase,
    routing: {
      mode: routing?.mode === "manual" ? "manual" : routing?.mode === "auto" ? "auto" : existingRouting.mode,
      preferredModel,
      modelPool: uniqueModelPool([preferredModel, ...modelPool])
    }
  };
}

function providerCapabilityBase(capability: unknown, modality: string) {
  const fallback = defaultProviderCapability(modality);
  const source = capability && typeof capability === "object" ? capability as Record<string, unknown> : {};
  return {
    supportsReferenceImage: typeof source.supportsReferenceImage === "boolean" ? source.supportsReferenceImage : fallback.supportsReferenceImage,
    supportsSeed: typeof source.supportsSeed === "boolean" ? source.supportsSeed : fallback.supportsSeed,
    supportsImageToImage: typeof source.supportsImageToImage === "boolean" ? source.supportsImageToImage : fallback.supportsImageToImage,
    supportsImageToVideo: typeof source.supportsImageToVideo === "boolean" ? source.supportsImageToVideo : fallback.supportsImageToVideo,
    supportsAsyncTask: typeof source.supportsAsyncTask === "boolean" ? source.supportsAsyncTask : fallback.supportsAsyncTask,
    maxDuration: typeof source.maxDuration === "number" ? source.maxDuration : fallback.maxDuration,
    ratios: Array.isArray(source.ratios) && source.ratios.length
      ? source.ratios.filter((item): item is string => typeof item === "string")
      : fallback.ratios
  };
}

async function ensureProviderPriceRows(
  providerId: string,
  providerName: string,
  modality: string,
  models: string[],
  unitCredits?: number,
  vendorCostCny?: number,
  db: Prisma.TransactionClient = prisma
) {
  const existing = await db.modelPrice.findMany({ where: { providerId }, select: { id: true, model: true } });
  const existingModels = new Set(existing.map((price) => price.model));
  await db.modelPrice.updateMany({
    where: { providerId },
    data: { providerName, modality, unit: defaultBillingUnit(modality) }
  });
  const missing = models.filter((model) => !existingModels.has(model));
  if (!missing.length) return;
  await db.modelPrice.createMany({
    data: missing.map((model) => ({
      id: `price_${safeId(providerId)}_${safeId(model)}_${crypto.randomUUID().slice(0, 6)}`,
      providerId,
      providerName,
      modality,
      model,
      unit: defaultBillingUnit(modality),
      unitCredits: Math.max(0, Math.floor(unitCredits ?? defaultUnitCredits(modality))),
      vendorCostCny: Math.max(0, vendorCostCny ?? defaultVendorCost(modality)),
      enabled: true
    }))
  });
}

function defaultUnitCredits(modality: string) {
  if (modality === "text") return 8;
  if (modality === "image") return 12;
  if (modality === "video") return 16;
  if (modality === "tts") return 1;
  return 2;
}

function defaultVendorCost(modality: string) {
  if (modality === "text") return 0.02;
  if (modality === "image") return 0.08;
  if (modality === "video") return 0.16;
  if (modality === "tts") return 0.002;
  return 0.001;
}

async function resolveTextRunCredits(input: CreationQuoteInput, suggestedEpisodes: number, db: Pick<Prisma.TransactionClient, "modelPrice"> = prisma) {
  const model = textModelName(input);
  const price = await db.modelPrice.findFirst({ where: {
    modality: "text", model, providerId: input.textProvider || process.env.TEXT_PROVIDER || null, enabled: true
  } });
  if (!price && process.env.NODE_ENV === "production") throw new Error("该文本渠道与模型尚未配置启用价格，请联系管理员。");
  const defaultUnit = estimateCreation(input).breakdown?.[0]?.unitCredits ?? 50;
  return (price?.unitCredits ?? defaultUnit) * Math.max(1, suggestedEpisodes);
}

async function resolveImageBaseCreditPerShot(provider: string, model: string) {
  const providerId = normalizeImageProviderId(provider);
  const price = await prisma.modelPrice.findFirst({
    where: {
      providerId,
      model,
      enabled: true
    }
  });
  if (!price && process.env.NODE_ENV === "production") throw new Error("该图片模型尚未配置价格，请联系管理员。");
  return resolveImageUnitCredits(price ? [price] : [], provider, model);
}

async function resolveImageCreditPerShot(provider: string, model: string, size?: string, quality?: string) {
  const baseCredits = await resolveImageBaseCreditPerShot(provider, model);
  return estimateImageCredits(baseCredits, size, quality);
}

function assertCharacterGateForStoryboardImages(workflow: ProjectWorkflow, scopedRegeneration: boolean) {
  if (process.env.CHARACTER_GATE_BYPASS === "true") return { pass: true, message: "" };
  const enforceGate = process.env.CHARACTER_GATE_ENFORCE === "true";
  if (!enforceGate) return { pass: true, message: "" };
  if (scopedRegeneration) return { pass: true, message: "" };
  const threshold = Number(process.env.CHARACTER_GATE_MIN_SCORE ?? 80);
  const latestCharacterReport = (workflow.qualityReports ?? [])
    .filter((report) => report.stage === "character")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (latestCharacterReport && (!latestCharacterReport.pass || latestCharacterReport.totalScore < threshold)) {
    return {
      pass: false,
      message: `角色一致性评测未达标（${latestCharacterReport.totalScore}/${threshold}），请先在“角色定稿”修复参考图/多视图/负面提示词，再批量生成分镜图。`
    };
  }
  const lockedRoleAssets = workflow.assets.filter((asset) =>
    (asset.type === "role" || asset.type === "role_derivative" || asset.type === "role_reference") &&
    asset.status === "succeeded" &&
    asset.referenceUrl
  );
  const missingCharacters = workflow.characters
    .filter((character) => !characterHasLockedReference(character, lockedRoleAssets))
    .map((character) => character.name);
  if (workflow.characters.length && missingCharacters.length) {
    return {
      pass: false,
      message: `角色参考图未定稿：${missingCharacters.join("、")}。请先完成角色定稿，再进入批量分镜图，避免角色漂移导致废图。`
    };
  }
  return { pass: true, message: "" };
}

function characterHasLockedReference(
  character: ProjectWorkflow["characters"][number],
  lockedAssets: Array<Pick<AssetItem, "id" | "name" | "relatedCharacterId" | "referenceUrl" | "status" | "type">>
) {
  if (character.referenceAssetId && lockedAssets.some((asset) => asset.id === character.referenceAssetId)) return true;
  return lockedAssets.some((asset) => asset.relatedCharacterId === character.id || asset.name.includes(character.name));
}

function videoProviderId(provider: string) {
  if (provider === "dashscope" || provider === "dashscope-video" || provider === "wanxiang" || provider === "wanx") return "dashscope-video";
  if (provider === "doubao" || provider === "doubao-seedance" || provider === "seedance") return "doubao-seedance";
  if (provider === "embedded" || provider === "embedded-video" || provider === "local-video" || provider === "local-mjpeg") return "embedded-video";
  return "mock-video";
}

function currentImageProviderName(provider: string) {
  if (provider === "dashscope" || provider === "dashscope-image") return "DashScope / Qwen Image";
  if (provider === "google" || provider === "google-ai-studio" || provider === "google-gemini-image") return "Google AI Studio / Gemini Image";
  if (provider === "zml" || provider === "zml-image" || provider === "zml-relay") return "ZML Image Relay";
  if (provider === "doubao" || provider === "doubao-seedream") return "Doubao Seedream Image";
  if (provider === "openai-compatible" || provider === "relay" || provider === "relay-image") return "OpenAI-compatible Image Relay";
  return "Mock Image Adapter";
}

function currentVideoProviderName(provider: string) {
  if (provider === "dashscope" || provider === "dashscope-video" || provider === "wanxiang" || provider === "wanx") return "通义万相 / DashScope 视频";
  if (provider === "doubao" || provider === "doubao-seedance" || provider === "seedance") return "豆包 Seedance 视频";
  if (provider === "embedded" || provider === "embedded-video" || provider === "local-video" || provider === "local-mjpeg") return "内嵌最小视频生成器";
  return "Mock Video Adapter";
}

function currentImageModelName(provider: string, selectedModel?: string) {
  if (provider === "dashscope" || provider === "dashscope-image") return selectedModel || process.env.DASHSCOPE_IMAGE_MODEL || "qwen-image";
  if (provider === "google" || provider === "google-ai-studio" || provider === "google-gemini-image") return selectedModel || process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
  if (provider === "zml" || provider === "zml-image" || provider === "zml-relay") return selectedModel || process.env.ZML_IMAGE_MODEL || "gpt-image-2";
  if (provider === "doubao" || provider === "doubao-seedream") return selectedModel || process.env.DOUBAO_SEEDREAM_MODEL || "doubao-seedream-5-0-lite-260128";
  if (provider === "openai-compatible" || provider === "relay" || provider === "relay-image") return selectedModel || process.env.OPENAI_IMAGE_MODEL || "openai-compatible-image";
  return "mock-image-v1";
}

function currentVideoModelName(provider: string, selectedModel?: string) {
  if (provider === "dashscope" || provider === "dashscope-video" || provider === "wanxiang" || provider === "wanx") return selectedModel || process.env.DASHSCOPE_VIDEO_MODEL || "wanx2.1-i2v-turbo";
  if (provider === "doubao" || provider === "doubao-seedance" || provider === "seedance") return selectedModel || process.env.DOUBAO_SEEDANCE_MODEL || "doubao-seedance-1-5-pro-251215";
  if (provider === "embedded" || provider === "embedded-video" || provider === "local-video" || provider === "local-mjpeg") return selectedModel || "embedded-mjpeg-v1";
  return "mock-video-v1";
}

function imageBatchLimit(total: number, provider: string) {
  if (["dashscope", "dashscope-image", "google", "google-ai-studio", "google-gemini-image", "zml", "zml-image", "zml-relay", "doubao", "doubao-seedream", "openai-compatible", "relay", "relay-image"].includes(provider)) {
    return Math.max(1, Math.min(total, Number(process.env.IMAGE_BATCH_LIMIT ?? 1)));
  }
  return total;
}

function videoBatchLimit(total: number, provider: string) {
  if (["dashscope", "dashscope-video", "wanxiang", "wanx", "doubao", "doubao-seedance", "seedance"].includes(provider)) {
    return Math.max(1, Math.min(total, Number(process.env.VIDEO_BATCH_LIMIT ?? 1)));
  }
  return total;
}

function videoCreditPerSecond(provider: string) {
  if (provider === "dashscope" || provider === "dashscope-video" || provider === "wanxiang" || provider === "wanx") return 16;
  if (provider === "doubao" || provider === "doubao-seedance" || provider === "seedance") return 18;
  return 0;
}

function isMockImageProvider(provider: string) {
  return provider === "mock" || provider === "mock-image" || provider === "mock-image-v1";
}

function isMockVideoProvider(provider: string) {
  return provider === "mock" || provider === "mock-video" || provider === "mock-video-v1";
}

function normalizeRedeemPrefix(value: string) {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
  return normalized || "GIFT";
}

function normalizeAnnouncementType(value?: string) {
  if (value === "guide" || value === "update" || value === "warning") return value;
  return "info";
}

function normalizeHelpCategory(value?: string) {
  if (value === "workflow" || value === "billing" || value === "account" || value === "troubleshooting" || value === "community") return value;
  return "getting_started";
}

function normalizeTextList(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 8);
}

function uniqueModelPool(models: string[]) {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}
