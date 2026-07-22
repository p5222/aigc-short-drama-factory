import crypto from "node:crypto";
import sharp from "sharp";
import type { AdminUserRow, AssetItem, BatchGenerationResult, CreateProjectInput, GenerationTask, HelpArticle, PlatformAnnouncement, ProjectWorkflow, StoryboardExportRow, StoryboardShot, WorkbenchSummary } from "@aifilm/shared";
import { textModelName, textProviderName } from "../agents/generator.js";
import { buildSeedanceVideoPrompt, buildStoryboardFirstFramePrompt, createStoryboardProductionPackage } from "../agents/storyboardProduction.js";
import { estimateCreation } from "../agents/workflow.js";
import { estimateImageCredits, normalizeImageOutputQuality, normalizeImageOutputSize, normalizeImageProviderId, resolveImageUnitCredits } from "@aifilm/shared";
import { hashPassword } from "../auth/password.js";
import { buildDirectorStoryboardRow, createDirectorStoryboardPackage } from "../export/directorStoryboard.js";
import { createSubtitleAsset, createTtsManifest, createVideoExportPackage, type MediaExportResult } from "../export/mediaExport.js";
import { generateImage } from "../providers/dashscopeImage.js";
import type { ImageGenerationResult } from "../providers/types.js";
import { generateVideo, queryVideoTaskResult } from "../providers/video.js";
import { persistImageBuffer, persistImageReference, persistVideoReference, readStoredAsset } from "../storage/objectStorage.js";
import { prisma } from "./client.js";
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
  const [user, projects, tasks, account, announcements] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.project.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 6 }),
    prisma.generationTask.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 8 }),
    prisma.creditAccount.findUniqueOrThrow({ where: { userId } }),
    listPublicAnnouncements()
  ]);

  return {
    userName: user.name,
    projects: projects.length,
    storyboards: projects.reduce((sum, project) => sum + project.storyboards, 0),
    runningTasks: tasks.filter((task) => task.status === "running" || task.status === "pending").length,
    credits: account.balance,
    recentProjects: projects.map(mapProject),
    recentTasks: tasks.map(mapTask),
    announcements: announcements.map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      type: item.type
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
}) {
  const announcement = await prisma.platformAnnouncement.create({
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
  }>
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
  return mapPlatformAnnouncement(await prisma.platformAnnouncement.update({ where: { id }, data }));
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

export async function updateProjectModelRoutes(
  projectId: string,
  userId = DEMO_USER_ID,
  data: Partial<Pick<CreateProjectInput, "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">>
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
    ...(data.videoModel !== undefined ? { videoModel: data.videoModel || null } : {})
  };

  return mapProject(
    await prisma.project.update({
      where: { id: projectId },
      data: clean
    })
  );
}

export async function pruneUserProjectsToLatest(userId = DEMO_USER_ID) {
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, updatedAt: true }
  });
  const latest = projects[0];
  const staleProjectIds = projects.slice(1).map((project) => project.id);

  if (!staleProjectIds.length) {
    return {
      keptProjectId: latest?.id,
      keptProjectName: latest?.name,
      deletedProjects: 0,
      deletedTasks: 0,
      deletedTransactions: 0
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const deletedTasks = await tx.generationTask.deleteMany({
      where: { userId, projectId: { in: staleProjectIds } }
    });
    const deletedTransactions = await tx.creditTransaction.deleteMany({
      where: { userId, projectId: { in: staleProjectIds } }
    });
    const deletedProjects = await tx.project.deleteMany({
      where: { userId, id: { in: staleProjectIds } }
    });

    return {
      deletedProjects: deletedProjects.count,
      deletedTasks: deletedTasks.count,
      deletedTransactions: deletedTransactions.count
    };
  });

  return {
    keptProjectId: latest?.id,
    keptProjectName: latest?.name,
    ...result
  };
}

export async function getProjectWorkflow(projectId: string, userId = DEMO_USER_ID) {
  const [project, script, characters, assets, storyboards, tasks, qualityReports, feedbacks] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, userId } }),
    prisma.scriptDraft.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    prisma.character.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    prisma.asset.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    prisma.storyboard.findMany({ where: { projectId }, orderBy: [{ episodeNo: "asc" }, { sceneNo: "asc" }, { shotNo: "asc" }] }),
    prisma.generationTask.findMany({ where: { projectId, userId }, orderBy: { createdAt: "desc" } }),
    prisma.qualityReport.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.userFeedback.findMany({ where: { projectId, userId }, orderBy: { createdAt: "desc" }, take: 30 })
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
  orderId: string;
  userId?: string;
  channel?: string;
  providerTradeNo?: string;
  amountCny?: number;
  payload?: unknown;
}) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const order = input.userId
      ? await tx.rechargeOrder.findFirst({ where: { id: input.orderId, userId: input.userId } })
      : await tx.rechargeOrder.findUnique({ where: { id: input.orderId } });
    if (!order) throw new Error("充值订单不存在");

    if (input.channel && input.channel !== order.channel) throw new Error("Payment channel mismatch");
    if (input.amountCny !== undefined && Math.abs(input.amountCny - order.amountCny) > 0.01) {
      throw new Error("Payment amount mismatch");
    }

    const payment = await tx.paymentRecord.create({
      data: {
        id: `pay_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        orderId: order.id,
        channel: input.channel || order.channel,
        providerTradeNo: input.providerTradeNo,
        amountCny: input.amountCny ?? order.amountCny,
        status: "succeeded",
        callbackPayload: input.payload ? JSON.stringify(input.payload).slice(0, 4000) : undefined
      }
    });

    if (order.status !== "paid") {
      const totalCredits = order.credits + order.bonusCredits;
      const account = await tx.creditAccount.upsert({
        where: { userId: order.userId },
        update: {},
        create: {
          id: `credit_${order.userId}`,
          userId: order.userId,
          balance: 0,
          frozenBalance: 0,
          totalRecharge: 0,
          totalConsume: 0
        }
      });
      const updated = await tx.creditAccount.update({
        where: { userId: order.userId },
        data: {
          balance: { increment: totalCredits },
          totalRecharge: { increment: totalCredits }
        }
      });
      await tx.creditTransaction.create({
        data: {
          id: `tx_${Date.now()}_order`,
          userId: order.userId,
          type: "recharge",
          amount: totalCredits,
          balanceAfter: updated.balance,
          description: `充值订单 ${order.id} 入账：${order.planName}，支付前余额 ${account.balance}`
        }
      });
      await tx.rechargeOrder.update({
        where: { id: order.id },
        data: {
          status: "paid",
          paidAt: now,
          providerTradeNo: input.providerTradeNo
        }
      });
    }

    const refreshed = await tx.rechargeOrder.findUniqueOrThrow({ where: { id: order.id } });
    return { order: mapRechargeOrder(refreshed), payment: mapPaymentRecord(payment) };
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
  const users = await prisma.user.findMany({
    include: { credit: true, _count: { select: { projects: true } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return users.map((user) => ({
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

  const initialCredits = Math.max(0, Math.floor(input.initialCredits ?? 0));
  const passwordHash = await hashPassword(input.password);
  const userId = `user_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const user = await prisma.$transaction(async (tx) => {
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
          id: `tx_${Date.now()}_new_user_credit`,
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
  data: Partial<{ name: string; role: string; status: string }>
) {
  const cleanData: Partial<{ name: string; role: string; status: string }> = {};
  if (data.name !== undefined) cleanData.name = data.name.trim();
  if (data.role !== undefined) {
    if (!["creator", "admin"].includes(data.role)) throw new Error("用户角色不在允许范围内");
    cleanData.role = data.role;
  }
  if (data.status !== undefined) {
    if (!["active", "disabled"].includes(data.status)) throw new Error("用户状态只能是 active 或 disabled");
    cleanData.status = data.status;
  }
  if (cleanData.name === "") throw new Error("用户昵称不能为空");

  const user = await prisma.user.update({ where: { id }, data: cleanData });
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
  await prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  const user = await prisma.user.update({ where: { id }, data: { passwordHash } });
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

export async function listProviders() {
  return Promise.all((await prisma.modelProvider.findMany({ orderBy: { createdAt: "asc" } })).map((row) => mapProvider(row)));
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
  return mapModelPrice(await prisma.modelPrice.update({ where: { id }, data }));
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
  return mapModelPrice(await prisma.modelPrice.create({
    data: {
      id: `price_${safeId(data.providerId || data.providerName)}_${safeId(data.model)}_${Date.now()}`,
      providerId: data.providerId,
      providerName: data.providerName.trim(),
      modality: data.modality,
      model: data.model.trim(),
      unit: data.unit ?? defaultBillingUnit(data.modality),
      unitCredits: Math.max(0, Math.floor(data.unitCredits)),
      vendorCostCny: Math.max(0, data.vendorCostCny ?? 0),
      enabled: data.enabled ?? true
    }
  }));
}

export async function deleteModelPrice(id: string) {
  await prisma.modelPrice.delete({ where: { id } });
  return { id, deleted: true };
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
  const existing = await prisma.membershipPlan.findUnique({ where: { id } });
  if (!existing) throw new Error("会员方案不存在");
  await prisma.membershipPlan.delete({ where: { id } });
  return mapMembershipPlan(existing);
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
  return mapRedeemCode(await prisma.redeemCode.update({ where: { id }, data }));
}

export async function deleteRedeemCode(id: string) {
  const code = await prisma.redeemCode.findUnique({ where: { id } });
  if (!code) throw new Error("兑换码不存在");
  if (code.usedCount > 0) {
    return mapRedeemCode(await prisma.redeemCode.update({ where: { id }, data: { enabled: false } }));
  }
  await prisma.redeemCode.delete({ where: { id } });
  return { id, deleted: true };
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
  const existing = await prisma.modelProvider.findUnique({ where: { id } });
  if (!existing) throw new Error("模型渠道不存在");
  const cleanData = cleanProviderData(existing, data);
  const updated = await prisma.modelProvider.update({ where: { id }, data: cleanData });
  await ensureProviderPriceRows(updated.id, updated.name, updated.modality, updated.models);
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
  const provider = await prisma.modelProvider.create({
    data: {
      id: providerId,
      name: data.name.trim(),
      modality,
      enabled: data.enabled ?? true,
      baseUrl: data.baseUrl?.trim() || null,
      iconUrl: data.iconUrl?.trim() || null,
      apiKey: data.apiKey?.trim() || null,
      models,
      capability: buildProviderCapability(defaultProviderCapability(modality), models, data.routing) as any,
      costHint: data.costHint?.trim() || "后台手动接入模型渠道。"
    }
  });
  await ensureProviderPriceRows(provider.id, provider.name, provider.modality, provider.models, data.unitCredits, data.vendorCostCny);
  return mapProvider(provider);
}

export async function deleteProvider(id: string) {
  const provider = await prisma.modelProvider.findUnique({ where: { id }, include: { prices: true } });
  if (!provider) throw new Error("供应商不存在");
  if (provider.prices.length > 0) {
    return mapProvider(await prisma.modelProvider.update({ where: { id }, data: { enabled: false } }));
  }
  await prisma.modelProvider.delete({ where: { id } });
  return { id, deleted: true };
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

export async function getAdminSummary(userId = DEMO_USER_ID) {
  const [users, projects, tasks, creditAgg, refunds, prices] = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.generationTask.findMany(),
    prisma.creditAccount.aggregate({ _sum: { totalConsume: true } }),
    prisma.creditTransaction.aggregate({ where: { type: "refund" }, _sum: { amount: true } }),
    prisma.modelPrice.findMany({ where: { enabled: true } })
  ]);
  const done = tasks.filter((task) => task.status === "succeeded").length;
  const failedTasks = tasks.filter((task) => task.status === "failed").length;
  const providerCost = tasks.reduce((sum, task) => sum + estimateProviderCostForTask(task, prices), 0);
  const creditsConsumed = creditAgg._sum.totalConsume ?? 0;
  const creditsRevenueEstimate = estimateCreditsRevenueCny(creditsConsumed);
  const costByStage = summarizeTaskCosts(tasks, prices, "stage");
  const costByModel = summarizeTaskCosts(tasks, prices, "model");
  return {
    users,
    projects,
    tasksToday: tasks.length,
    successRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    creditsConsumed,
    providerCost,
    creditsRevenueEstimate,
    refundCredits: Math.abs(refunds._sum.amount ?? 0),
    failedTasks,
    grossMarginEstimate: creditsRevenueEstimate - providerCost,
    grossMarginRate: creditsRevenueEstimate ? Math.round(((creditsRevenueEstimate - providerCost) / creditsRevenueEstimate) * 100) : 0,
    costByStage,
    costByModel
  };
}

function estimateCreditsRevenueCny(credits: number) {
  return credits * Number(process.env.CREDIT_REVENUE_CNY_UNIT ?? 0.01);
}

function defaultVendorCostPerCredit(modality: string) {
  if (modality === "video") return Number(process.env.DEFAULT_VIDEO_VENDOR_COST_PER_CREDIT ?? 0.006);
  if (modality === "image" || modality === "character") return Number(process.env.DEFAULT_IMAGE_VENDOR_COST_PER_CREDIT ?? 0.004);
  if (modality === "tts") return Number(process.env.DEFAULT_TTS_VENDOR_COST_PER_CREDIT ?? 0.002);
  return Number(process.env.DEFAULT_TEXT_VENDOR_COST_PER_CREDIT ?? 0.0015);
}

function estimateProviderCostForTask(
  task: { type: string; provider: string; model: string; finalCredits: number | null; estimatedCredits: number },
  prices: Array<{ providerId: string | null; providerName: string; modality: string; model: string; unitCredits: number; vendorCostCny: number }>
) {
  const credits = task.finalCredits ?? task.estimatedCredits ?? 0;
  const price = findTaskPrice(task, prices);
  if (price?.unitCredits && price.vendorCostCny > 0) {
    return (Math.max(0, credits) / Math.max(1, price.unitCredits)) * price.vendorCostCny;
  }
  return Math.max(0, credits) * defaultVendorCostPerCredit(task.type);
}

function summarizeTaskCosts(
  tasks: Array<{ type: string; provider: string; model: string; status: string; finalCredits: number | null; estimatedCredits: number }>,
  prices: Array<{ providerId: string | null; providerName: string; modality: string; model: string; unitCredits: number; vendorCostCny: number }>,
  mode: "stage" | "model"
) {
  const groups = new Map<string, { stage: string; provider: string; model: string; modality: string; tasks: number; done: number; failed: number; credits: number; providerCost: number }>();
  tasks.forEach((task) => {
    const price = findTaskPrice(task, prices);
    const key = mode === "stage" ? task.type : `${task.provider || price?.providerName || "-"}::${task.model || price?.model || "-"}::${task.type}`;
    const current = groups.get(key) ?? {
      stage: task.type,
      provider: task.provider || price?.providerName || "-",
      model: task.model || price?.model || "-",
      modality: task.type,
      tasks: 0,
      done: 0,
      failed: 0,
      credits: 0,
      providerCost: 0
    };
    const credits = task.finalCredits ?? task.estimatedCredits ?? 0;
    current.tasks += 1;
    current.done += task.status === "succeeded" ? 1 : 0;
    current.failed += task.status === "failed" ? 1 : 0;
    current.credits += credits;
    current.providerCost += estimateProviderCostForTask(task, prices);
    groups.set(key, current);
  });
  return Array.from(groups.values())
    .map((group) => ({
      ...(mode === "stage"
        ? { stage: group.stage }
        : { provider: group.provider, model: group.model, modality: group.modality }),
      tasks: group.tasks,
      credits: group.credits,
      providerCost: Number(group.providerCost.toFixed(2)),
      failed: group.failed,
      successRate: group.tasks ? Math.round((group.done / group.tasks) * 100) : 0
    }))
    .sort((a, b) => b.providerCost - a.providerCost || b.credits - a.credits)
    .slice(0, 12);
}

function findTaskPrice(
  task: { type: string; provider: string; model: string },
  prices: Array<{ providerId: string | null; providerName: string; modality: string; model: string; unitCredits: number; vendorCostCny: number }>
) {
  const modality = task.type === "image" || task.type === "character" ? "image" : task.type === "video" ? "video" : task.type === "tts" ? "tts" : "text";
  return prices.find((price) => price.modality === modality && price.model === task.model && (price.providerId === task.provider || price.providerName === task.provider))
    ?? prices.find((price) => price.modality === modality && price.model === task.model)
    ?? prices.find((price) => price.modality === modality);
}

export async function adjustUserCredits({
  userId,
  amount,
  description,
  type = amount >= 0 ? "recharge" : "adjust"
}: {
  userId: string;
  amount: number;
  description: string;
  type?: "recharge" | "adjust";
}) {
  if (!Number.isInteger(amount) || amount === 0) throw new Error("调整积分必须为非零整数");
  const cleanDescription = description.trim() || (amount > 0 ? "后台手动充值" : "后台手动扣减");

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("用户不存在");

    const account = await tx.creditAccount.upsert({
      where: { userId },
      update: {},
      create: {
        id: `credit_${userId}`,
        userId,
        balance: 0,
        frozenBalance: 0,
        totalRecharge: 0,
        totalConsume: 0
      }
    });

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
        id: `tx_${Date.now()}_admin_${Math.abs(amount)}`,
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
    const redeemCode = await tx.redeemCode.findUnique({ where: { code } });
    if (!redeemCode || !redeemCode.enabled) throw new Error("兑换码不存在或已停用");
    if (redeemCode.startsAt && redeemCode.startsAt > now) throw new Error("兑换码尚未开始");
    if (redeemCode.endsAt && redeemCode.endsAt < now) throw new Error("兑换码已过期");
    if (redeemCode.usedCount >= redeemCode.maxRedemptions) throw new Error("兑换码额度已用完");

    const existing = await tx.redeemRedemption.findFirst({ where: { userId, redeemCodeId: redeemCode.id } });
    if (existing) throw new Error("该兑换码已使用过");

    const account = await tx.creditAccount.upsert({
      where: { userId },
      update: {},
      create: {
        id: `credit_${userId}`,
        userId,
        balance: 0,
        frozenBalance: 0,
        totalRecharge: 0,
        totalConsume: 0
      }
    });

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
        id: `redemption_${Date.now()}_${userId}`,
        redeemCodeId: redeemCode.id,
        userId,
        credits: redeemCode.credits
      }
    });

    await tx.creditTransaction.create({
      data: {
        id: `tx_${Date.now()}_redeem`,
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

export async function createProjectAndTask(
  input: CreateProjectInput,
  userId = DEMO_USER_ID
): Promise<{ projectId: string; taskId: string; task: GenerationTask; estimatedCredits: number }> {
  const baseEstimate = estimateCreation(input);
  const estimatedCredits = await resolveTextRunCredits(input, baseEstimate.suggestedEpisodes);
  const estimate = { ...baseEstimate, estimatedCredits };
  const projectId = `proj_${Date.now()}`;
  const taskId = `task_${Date.now()}`;

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId } });
    if (account.balance - account.frozenBalance < estimate.estimatedCredits) {
      throw new Error("积分余额不足");
    }

    await tx.creditAccount.update({
      where: { userId },
      data: { frozenBalance: { increment: estimate.estimatedCredits } }
    });

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
        textProvider: input.textProvider,
        textModel: input.textModel,
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
        provider: textProviderName(input),
        model: textModelName(input),
        status: "pending",
        progress: 0,
        estimatedCredits: estimate.estimatedCredits
      }
    });

    await tx.creditTransaction.create({
      data: {
        id: `tx_${Date.now()}`,
        userId,
        projectId,
        taskId,
        type: "freeze",
        amount: -estimate.estimatedCredits,
        balanceAfter: account.balance,
        description: "生成任务冻结积分"
      }
    });

    return task;
  });

  return { projectId, taskId, task: mapTask(result), estimatedCredits: estimate.estimatedCredits };
}

export async function runProjectImageTasks(
  projectId: string,
  userId = DEMO_USER_ID,
  options: { shotIds?: string[]; forceRegenerate?: boolean } = {}
): Promise<BatchGenerationResult> {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("项目不存在");
  const existingImageAssetIds = new Set(workflow.assets.filter((asset) => asset.type === "image").map((asset) => asset.id));
  const selectedShotIds = new Set(options.shotIds?.filter(Boolean) ?? []);
  const imageProvider = workflow.project.imageProvider || process.env.IMAGE_PROVIDER || "mock";
  const imageProviderConfig = await prisma.modelProvider.findUnique({ where: { id: imageProvider } });
  const imageRouting = readProviderRoutingState(
    imageProviderConfig?.capability,
    imageProviderConfig?.models ?? [workflow.project.imageModel || currentImageModelName(imageProvider)].filter(Boolean)
  );
  const imageModel = workflow.project.imageModel || imageRouting.preferredModel || currentImageModelName(imageProvider);
  const imageModelPool = imageRouting.mode === "manual"
    ? [imageModel]
    : uniqueModelPool([imageModel, ...imageRouting.modelPool, ...(imageProviderConfig?.models ?? [])]);
  const assetById = new Map(workflow.assets.map((asset) => [asset.id, asset]));
  const shotsPerEpisode = Math.max(1, Math.round(workflow.storyboards.length / Math.max(1, workflow.project.episodes)));
  const candidateShots = workflow.storyboards
    .filter((shot) => selectedShotIds.size === 0 || selectedShotIds.has(shot.id))
    .filter((shot) => options.forceRegenerate || !existingImageAssetIds.has(`image_${shot.id}`));
  const characterGate = assertCharacterGateForStoryboardImages(workflow, selectedShotIds.size > 0 || Boolean(options.forceRegenerate));
  if (!characterGate.pass) throw new Error(characterGate.message);
  const useNineGridCandidate = selectedShotIds.size === 0 && !options.forceRegenerate && shotsPerEpisode === 9 && candidateShots.length >= 9 && !isMockImageProvider(imageProvider);
  const shotsToGenerate = candidateShots.slice(0, useNineGridCandidate ? 9 : imageBatchLimit(workflow.storyboards.length, imageProvider));
  const imageSize = normalizeImageOutputSize(workflow.project.imageSize);
  const imageQuality = normalizeImageOutputQuality(workflow.project.imageQuality);
  const creditsPerShot = await resolveImageCreditPerShot(imageProvider, imageModel, imageSize, imageQuality);
  const useNineGridSheet = useNineGridCandidate;
  const billableImageCount = useNineGridSheet ? Math.ceil(shotsToGenerate.length / 9) : shotsToGenerate.length;
  const credits = billableImageCount * creditsPerShot;

  if (credits > 0) {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
    if (account.balance - account.frozenBalance < credits) throw new Error("积分余额不足");
  }

  const imageResults: ImageGenerationResult[] = useNineGridSheet
    ? await generateNineGridSheetImages(projectId, workflow, shotsToGenerate, imageProvider, imageModel, imageModelPool, assetById, imageSize, imageQuality)
    : [];
  if (!useNineGridSheet) {
    const generated = await Promise.all(
      shotsToGenerate.map((shot, index) =>
        generateImage({
          prompt: buildStoryboardFirstFramePrompt({ workflow, shot, assetById }),
          negativePrompt: "字幕, 水印, Logo, 低清晰度, 畸形手, 多余手指, 换脸, 同款分身, 过暗, 欠曝, 模糊, 脏污画面",
          referenceImageUrls: shot.referenceAssetIds.map((assetId) => assetById.get(assetId)?.referenceUrl).filter(Boolean) as string[],
          ratio: workflow.project.videoRatio,
          seed: 30000 + index,
          provider: workflow.project.imageProvider,
          model: imageModel,
          modelPool: imageModelPool,
          size: imageSize,
          quality: imageQuality,
          baseUrl: imageProviderConfig?.baseUrl ?? undefined,
          apiKey: imageProviderConfig?.apiKey ?? undefined
        }).catch((error) => {
          if (isMockImageProvider(imageProvider)) {
            console.warn("[image] mock provider fallback:", error);
            return {
              taskId: `mock_image_${Date.now()}_${index}`,
              status: "succeeded" as const,
              imageUrl: undefined,
              provider: "Mock Image Adapter",
              model: "mock-image-v1"
            };
          }
          throw error;
        })
      )
    );
    imageResults.push(...generated);
  }
  const missingImageResult = imageResults.find((result) => !result.imageUrl);
  if (missingImageResult && !isMockImageProvider(imageProvider)) {
    throw new Error(
      `真实生图渠道未返回图片 URL：${missingImageResult.provider || imageProvider} / ${missingImageResult.model || imageModel}。请在后台“测试生图模型”查看上游任务状态。`
    );
  }
  const storedImageUrls = await Promise.all(
    imageResults.map((result, index) =>
      persistImageReference(result.imageUrl, `shot-${projectId}-${shotsToGenerate[index]?.shotNo ?? index + 1}`)
    )
  );
  const taskId = `task_image_${Date.now()}`;

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId } });
    if (account.balance - account.frozenBalance < credits) throw new Error("积分余额不足");

    const task = await tx.generationTask.create({
      data: {
        id: taskId,
        userId,
        projectId,
        projectName: workflow.project.name,
        type: "image",
        title: useNineGridSheet ? "9宫格总图裁切生成" : "分镜图批量生成",
        provider: imageResults[0]?.provider || currentImageProviderName(imageProvider),
        model: imageResults[0]?.model || currentImageModelName(imageProvider, imageModel),
        status: "succeeded",
        progress: 100,
        estimatedCredits: credits,
        finalCredits: credits
      }
    });

    const imageAssets = shotsToGenerate.map((shot, index) => ({
      id: `image_${shot.id}`,
      projectId,
      type: "image",
      name: `镜头 ${shot.episodeNo}-${shot.sceneNo}-${shot.shotNo} 分镜图`,
      description: shot.pictureDesc,
      prompt: shot.imagePrompt,
      referenceUrl: storedImageUrls[index] || imageResults[index]?.imageUrl || createSvgDataUrl(`镜头 ${index + 1}`, shot.pictureDesc, workflow.project.artStyle),
      status: "succeeded",
      relatedCharacterId: null
    }));

    let created = { count: 0 };
    for (const imageAsset of imageAssets) {
      await tx.asset.upsert({
        where: { id: imageAsset.id },
        create: imageAsset,
        update: {
          description: imageAsset.description,
          prompt: imageAsset.prompt,
          referenceUrl: imageAsset.referenceUrl,
          status: "succeeded"
        }
      });
      created = { count: created.count + 1 };
    }

    await tx.asset.updateMany({
      where: { projectId, type: { in: ["role", "scene"] } },
      data: { status: "succeeded" }
    });

    await tx.storyboard.updateMany({
      where: { projectId, id: { in: shotsToGenerate.map((shot) => shot.id) } },
      data: { status: "succeeded" }
    });

    const totalImageAssets = await tx.asset.count({
      where: { projectId, type: { in: ["role", "role_derivative", "scene", "prop", "image", "cover"] } }
    });

    await tx.project.update({
      where: { id: projectId },
      data: {
        status: "asseting",
        imageAssets: totalImageAssets,
        creditsSpent: { increment: credits }
      }
    });

    await tx.creditAccount.update({
      where: { userId },
      data: {
        balance: { decrement: credits },
        totalConsume: { increment: credits }
      }
    });

    await tx.creditTransaction.create({
      data: {
        id: `tx_${Date.now()}_image`,
        userId,
        projectId,
        taskId,
        type: "consume",
        amount: -credits,
        balanceAfter: account.balance - credits,
        description: "分镜图批量生成扣费"
      }
    });

    return { task, created: created.count };
  });

  const refreshed = await getProjectWorkflow(projectId, userId);
  return {
    project: refreshed!.project,
    task: mapTask(result.task),
    assetsCreated: result.created
  };
}

export async function runProjectVideoTasks(projectId: string, userId = DEMO_USER_ID): Promise<BatchGenerationResult> {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("项目不存在");
  const taskId = `task_video_${Date.now()}`;
  const imageAssetByShotId = new Map(workflow.assets.filter((asset) => asset.type === "image").map((asset) => [asset.id.replace(/^image_/, ""), asset]));
  const videoAssetByShotId = new Map(workflow.assets.filter((asset) => asset.type === "video").map((asset) => [asset.id.replace(/^video_/, ""), asset]));
  const videoProvider = workflow.project.videoProvider || process.env.VIDEO_PROVIDER || "dashscope-video";
  const videoProviderConfig = await prisma.modelProvider.findUnique({ where: { id: videoProvider } });
  const videoRouting = readProviderRoutingState(
    videoProviderConfig?.capability,
    videoProviderConfig?.models ?? [workflow.project.videoModel || currentVideoModelName(videoProvider)].filter(Boolean)
  );
  const videoModel = workflow.project.videoModel || videoRouting.preferredModel || currentVideoModelName(videoProvider);
  const videoModelPool = videoRouting.mode === "manual"
    ? [videoModel]
    : uniqueModelPool([videoModel, ...videoRouting.modelPool, ...(videoProviderConfig?.models ?? [])]);
  const shotsToGenerate = workflow.storyboards
    .filter((shot) => !isPlayableVideoUrl(videoAssetByShotId.get(shot.id)?.referenceUrl))
    .filter((shot) => imageAssetByShotId.has(shot.id))
    .slice(0, videoBatchLimit(workflow.storyboards.length, videoProvider));
  if (!shotsToGenerate.length) {
    throw new Error("没有可用于图生视频的分镜图。请先在“分镜图评估”里生成至少一张镜头首帧，再生成视频。");
  }
  const creditsPerSecond = await resolveVideoCreditPerSecond(videoProvider, videoModel);
  const credits = shotsToGenerate.reduce((sum, shot) => sum + Math.max(1, shot.duration) * creditsPerSecond, 0);

  if (credits > 0) {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
    if (account.balance - account.frozenBalance < credits) throw new Error("积分余额不足");
  }

  const videoResults = await Promise.all(
    shotsToGenerate.map(async (shot) => {
      const imageAsset = imageAssetByShotId.get(shot.id);
      const existingVideoAsset = videoAssetByShotId.get(shot.id);
      const queuedTaskId = existingVideoAsset?.referenceUrl && !isPlayableVideoUrl(existingVideoAsset.referenceUrl)
        ? existingVideoAsset.referenceUrl
        : undefined;
      const queried = queuedTaskId
        ? await queryVideoTaskResult({
            taskId: queuedTaskId,
            provider: videoProvider,
            model: videoModel,
            baseUrl: videoProviderConfig?.baseUrl ?? undefined,
            apiKey: videoProviderConfig?.apiKey ?? undefined
          }).catch((error) => ({
            taskId: queuedTaskId,
            status: "failed" as const,
            videoUrl: undefined,
            provider: currentVideoProviderName(videoProvider),
            model: videoModel,
            message: `视频任务查询失败：${error instanceof Error ? error.message : String(error)}`,
            failureCategory: "unknown" as const,
            retryable: true
          }))
        : undefined;
      const result = queuedTaskId
        ? queried ?? {
            taskId: queuedTaskId,
            status: "running" as const,
            videoUrl: undefined,
            provider: currentVideoProviderName(videoProvider),
            model: videoModel,
            message: "上游视频任务仍在生成中，稍后可继续刷新查询。"
          }
      : await generateVideo({
            prompt: buildSeedanceVideoPrompt({ workflow, shot, firstFrameAsset: imageAsset, assetById: new Map(workflow.assets.map((asset) => [asset.id, asset])) }),
            imageUrl: imageAsset?.referenceUrl,
            ratio: workflow.project.videoRatio,
            duration: shot.duration,
            provider: videoProvider,
            model: videoModel,
            modelPool: videoModelPool,
            baseUrl: videoProviderConfig?.baseUrl ?? undefined,
            apiKey: videoProviderConfig?.apiKey ?? undefined
          });
      const storedVideoUrl = await persistVideoReference(result.videoUrl, `video-${projectId}-${shot.shotNo}`);
      return { shot, result, videoUrl: storedVideoUrl || result.videoUrl };
    })
  );

  const hasQueuedVideo = videoResults.some((item) => !item.videoUrl);
  const failedVideoResults = videoResults.filter((item) => item.result.status === "failed" || item.result.status === "timeout" || item.result.status === "canceled");
  const succeededVideoResults = videoResults.filter((item) => item.videoUrl);
  const billableCredits = succeededVideoResults.reduce((sum, item) => sum + Math.max(1, item.shot.duration) * creditsPerSecond, 0);
  const taskStatus = failedVideoResults.length && !succeededVideoResults.length
    ? "failed"
    : hasQueuedVideo
      ? "running"
      : "succeeded";
  const taskProgress = taskStatus === "succeeded" ? 100 : taskStatus === "failed" ? 0 : Math.max(35, Math.round((succeededVideoResults.length / Math.max(1, videoResults.length)) * 100));
  const taskErrorReason = buildVideoTaskErrorReason(videoResults);

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId } });
    if (account.balance - account.frozenBalance < billableCredits) throw new Error("积分余额不足");

    const task = await tx.generationTask.create({
      data: {
        id: taskId,
        userId,
        projectId,
        projectName: workflow.project.name,
        type: "video",
        title: "图生视频生成",
        provider: videoResults[0]?.result.provider || currentVideoProviderName(videoProvider),
        model: videoResults[0]?.result.model || videoModel,
        status: taskStatus,
        progress: taskProgress,
        estimatedCredits: credits,
        finalCredits: billableCredits > 0 ? billableCredits : undefined,
        errorReason: taskErrorReason
      }
    });

    const videoAssets = videoResults.map((item) => ({
      id: `video_${item.shot.id}`,
      projectId,
      type: "video",
      name: `镜头 ${item.shot.episodeNo}-${item.shot.sceneNo}-${item.shot.shotNo} 视频`,
      description: item.result.message || `基于分镜图生成视频：${item.shot.pictureDesc}`,
      prompt: item.shot.videoPrompt,
      referenceUrl: item.videoUrl || item.result.taskId,
      status: item.videoUrl ? "succeeded" : item.result.status === "failed" || item.result.status === "timeout" || item.result.status === "canceled" ? "failed" : "running",
      relatedCharacterId: null
    }));

    let created = { count: 0 };
    for (const videoAsset of videoAssets) {
      await tx.asset.upsert({
        where: { id: videoAsset.id },
        create: videoAsset,
        update: {
          description: videoAsset.description,
          prompt: videoAsset.prompt,
          referenceUrl: videoAsset.referenceUrl,
          status: videoAsset.status
        }
      });
      created = { count: created.count + 1 };
    }

    const totalVideoAssets = await tx.asset.count({ where: { projectId, type: "video" } });

    await tx.project.update({
      where: { id: projectId },
      data: {
        status: "rendering",
        videoClips: totalVideoAssets,
        creditsSpent: { increment: billableCredits }
      }
    });

    if (billableCredits > 0) {
      await tx.creditAccount.update({
        where: { userId },
        data: {
          balance: { decrement: billableCredits },
          totalConsume: { increment: billableCredits }
        }
      });
      await tx.creditTransaction.create({
        data: {
          id: `tx_${Date.now()}_video`,
          userId,
          projectId,
          taskId,
          type: "consume",
          amount: -billableCredits,
          balanceAfter: account.balance - billableCredits,
          description: `图生视频生成扣费（${succeededVideoResults.length}/${videoResults.length} 条已返回可播放视频）`
        }
      });
    }

    return { task, created: created.count };
  });

  const refreshed = await getProjectWorkflow(projectId, userId);
  return {
    project: refreshed!.project,
    task: mapTask(result.task),
    assetsCreated: result.created
  };
}

async function resolveVideoCreditPerSecond(provider: string, model: string) {
  const price = await prisma.modelPrice.findFirst({
    where: {
      providerId: videoProviderId(provider),
      model,
      enabled: true
    }
  });
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

export async function listExportJobs(userId = DEMO_USER_ID, projectId?: string) {
  return (
    await prisma.exportJob.findMany({
      where: {
        userId,
        ...(projectId ? { projectId } : {})
      },
      orderBy: { createdAt: "desc" }
    })
  ).map(mapExportJob);
}

export async function getExportJobForDownload(projectId: string, jobId: string, userId = DEMO_USER_ID) {
  const job = await prisma.exportJob.findFirst({
    where: {
      id: jobId,
      projectId,
      userId,
      status: "succeeded"
    }
  });
  if (!job || !job.outputUrl) throw new Error("导出记录不存在或尚未生成下载文件");
  return mapExportJob(job);
}

export async function createProjectExportJob(
  projectId: string,
  userId = DEMO_USER_ID,
  type: "tts" | "subtitle" | "video_export"
) {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("项目不存在");
  const job = await prisma.exportJob.create({
    data: {
      id: `export_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      userId,
      projectId,
      type,
      status: "running"
    }
  });

  try {
    const exportResult =
      type === "tts"
        ? await createTtsManifest(workflow)
        : type === "subtitle"
          ? await createSubtitleAsset(workflow)
          : await createVideoExportPackage(workflow);

    const refreshed = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        outputUrl: exportResult.outputUrl,
        errorReason: exportDiagnosticsMessage(type, exportResult)
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

    await prisma.asset.create({
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
      await prisma.project.update({
        where: { id: projectId },
        data: { status: isVideoMp4 ? "completed" : "rendering" }
      });
    }

    return mapExportJob(refreshed);
  } catch (error) {
    const failed = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorReason: error instanceof Error ? error.message : "导出失败"
      }
    });
    return mapExportJob(failed);
  }
}

function exportDiagnosticsMessage(type: "tts" | "subtitle" | "video_export", result: MediaExportResult) {
  const warningText = result.warnings?.length ? result.warnings.slice(0, 3).join("；") : "";
  const message = type === "video_export"
    ? result.outputKind === "mp4"
      ? "MP4 成片已生成，可预览和下载。"
      : "已生成诊断包：包含视频片段、配音、字幕、FFmpeg 状态和复盘清单；配置 FFmpeg 后可重新导出 MP4。"
    : type === "tts"
      ? "多角色配音资产已生成，可被最终 MP4 合成复用。"
      : "SRT 字幕资产已生成，可被最终 MP4 合成复用。";
  return JSON.stringify({
    kind: "export_diagnostics",
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

export async function retryTask(taskId: string, userId = DEMO_USER_ID) {
  const task = await prisma.generationTask.findFirst({ where: { id: taskId, userId } });
  if (!task) throw new Error("任务不存在");
  if (task.status === "succeeded") throw new Error("已成功任务不需要重试");
  if (task.status === "pending" || task.status === "running") return mapTask(task);
  return mapTask(await prisma.$transaction(async (tx) => {
    if (task.type === "text" && task.finalCredits == null && task.estimatedCredits > 0) {
      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId } });
      if (account.balance - account.frozenBalance < task.estimatedCredits) throw new Error("积分余额不足，无法重试任务");
      await tx.creditAccount.update({
        where: { userId },
        data: { frozenBalance: { increment: task.estimatedCredits } }
      });
      await tx.creditTransaction.create({
        data: {
          id: `tx_${Date.now()}_retry_freeze`,
          userId,
          projectId: task.projectId,
          taskId,
          type: "freeze",
          amount: -task.estimatedCredits,
          balanceAfter: account.balance,
          description: "重试生成任务，重新冻结预计积分"
        }
      });
    }

    return tx.generationTask.update({
      where: { id: taskId },
      data: { status: "pending", progress: 0, errorReason: null }
    });
  }));
}

export async function cancelTask(taskId: string, userId = DEMO_USER_ID) {
  const task = await prisma.generationTask.findFirst({ where: { id: taskId, userId } });
  if (!task) throw new Error("任务不存在");
  if (task.status === "succeeded") throw new Error("已成功任务不能取消");
  if (task.status === "canceled") return mapTask(task);

  return mapTask(await prisma.$transaction(async (tx) => {
    const account = await tx.creditAccount.findUnique({ where: { userId } });
    const refundable = task.finalCredits == null && account
      ? Math.min(account.frozenBalance, Math.max(0, task.estimatedCredits))
      : 0;

    if (refundable > 0) {
      await tx.creditAccount.update({
        where: { userId },
        data: { frozenBalance: { decrement: refundable } }
      });
      await tx.creditTransaction.create({
        data: {
          id: `tx_${Date.now()}_cancel_refund`,
          userId,
          projectId: task.projectId,
          taskId,
          type: "refund",
          amount: refundable,
          balanceAfter: account!.balance,
          description: "任务取消，退回未消耗冻结积分"
        }
      });
    }

    return tx.generationTask.update({
      where: { id: taskId },
      data: {
        status: "canceled",
        progress: 0,
        errorReason: refundable > 0 ? `用户取消，已退回 ${refundable} 积分。` : "用户取消任务。"
      }
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
  if (data.baseUrl !== undefined) clean.baseUrl = data.baseUrl?.trim() || null;
  if (data.iconUrl !== undefined) clean.iconUrl = data.iconUrl?.trim() || null;
  if (data.apiKey !== undefined) clean.apiKey = data.apiKey?.trim() || null;
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
  vendorCostCny?: number
) {
  const existing = await prisma.modelPrice.findMany({ where: { providerId }, select: { id: true, model: true } });
  const existingModels = new Set(existing.map((price) => price.model));
  await prisma.modelPrice.updateMany({
    where: { providerId },
    data: { providerName, modality, unit: defaultBillingUnit(modality) }
  });
  const missing = models.filter((model) => !existingModels.has(model));
  if (!missing.length) return;
  await prisma.modelPrice.createMany({
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

async function resolveTextRunCredits(input: CreateProjectInput, suggestedEpisodes: number) {
  const model = textModelName(input);
  const price = await prisma.modelPrice.findFirst({
    where: {
      modality: "text",
      model,
      enabled: true
    }
  });
  return (price?.unitCredits ?? estimateCreation(input).estimatedCredits) * Math.max(1, suggestedEpisodes);
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

function isPlayableVideoUrl(url?: string) {
  if (!url) return false;
  return url.startsWith("/storage/") || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:video");
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
