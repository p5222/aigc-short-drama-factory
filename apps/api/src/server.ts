import "./config/env.js";
import crypto from "node:crypto";
import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import cors from "cors";
import express from "express";
import { Redis as RedisClient } from "ioredis";
import { z } from "zod";
import { storyboardQualityRules, roleConsistencyRules, productionPipeline } from "@aifilm/shared";
import { estimateCreation } from "./agents/workflow.js";
import { testTextModelConnection } from "./agents/generator.js";
import { createCharacterConsistencyPlan, createRelayGatewayPolicy, createWebNovelWritingPlan } from "./agents/openSourceAgents.js";
import { getLingGuoAdapterMetadata } from "./agents/lingguoAdapter.js";
import { getToonflowAdapterMetadata } from "./agents/toonflowAdapter.js";
import { hashPassword, verifyPassword } from "./auth/password.js";
import { ensureSeedData, DEMO_USER_ID } from "./db/seed.js";
import {
  cancelTask,
  createAdminUser,
  createMembershipPlan,
  createModelPrice,
  createPlan,
  createProvider,
  createProjectExportJob,
  createPromptTemplate,
  exportDirectorStoryboardPackage,
  createRedeemCodeBatch,
  createRechargeOrder,
  createProjectAndTask,
  adjustUserCredits,
  deleteMembershipPlan,
  deleteModelPrice,
  deletePlan,
  deletePromptTemplate,
  deleteProvider,
  deleteRedeemCode,
  exportStoryboardRows,
  getExportJobForDownload,
  getDirectorStoryboardRows,
  getAdminSummary,
  getCreditAccount,
  getProjectWorkflow,
  getWorkbenchSummary,
  handleRechargeCallback,
  listAdminUsers,
  listAdminPlans,
  listCreditTransactions,
  listExportJobs,
  listInvoices,
  listMembershipPlans,
  listModelPrices,
  listPaymentRecords,
  listPlans,
  listProjects,
  listProviders,
  listRechargeOrders,
  pruneUserProjectsToLatest,
  requestInvoice,
  listRedeemCodes,
  listTasks,
  listTemplates,
  updateAdminUser,
  updateProjectModelRoutes,
  redeemExperienceCode,
  retryTask,
  resetAdminUserPassword,
  runProjectImageTasks,
  runProjectVideoTasks,
  updateMembershipPlan,
  updateModelPrice,
  updatePlan,
  updateProvider,
  updatePromptTemplate,
  updateRedeemCode
} from "./db/repository.js";
import { prisma } from "./db/client.js";
import { deleteCharacterReferenceImage, generateCharacterReferenceImages, regenerateStoryboardShotImage, runProjectStoryboardTasks, setCharacterReferenceImage, updateStoryboardShot } from "./db/storyboardActions.js";
import {
  createEvaluationDataset,
  createUserFeedback,
  deleteEvaluationDataset,
  deleteEvaluationRun,
  deleteProjectQualityData,
  generateProjectQualityReports,
  getAdminEvaluationOverview,
  getEvaluationRun,
  getProjectQualityReports,
  listAdminFeedback,
  listEvaluationDatasets,
  listEvaluationRuns,
  listAdminQualityProjects,
  recordAnalyticsEvent,
  runQualityEvaluation,
  updateAdminFeedback
} from "./db/evaluation.js";
import { testImageModelConnection } from "./providers/dashscopeImage.js";
import { testVideoModelConnection } from "./providers/video.js";
import { listVisualPipelines, testVisualPipeline } from "./providers/visualPipelineRegistry.js";
import { generationQueue, generationQueueEvents, queueConnection, startGenerationWorker } from "./queue/generationQueue.js";
import { ensureStorageBuckets, storageRoot } from "./storage/objectStorage.js";

const app = express();
const port = Number(process.env.API_PORT ?? 4000);
const authSessionTtlDays = Number(process.env.AUTH_SESSION_TTL_DAYS ?? 30);
const rateLimitWindowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS ?? 60_000);
const rateLimitMax = Number(process.env.API_RATE_LIMIT_MAX ?? 180);
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true
  })
);
app.use(express.json({ limit: "12mb" }));
app.use("/storage", express.static(storageRoot));
app.use((req, res, next) => {
  const key = `${req.ip}:${req.path.startsWith("/api/auth") ? "auth" : "api"}`;
  const now = Date.now();
  const bucket = rateLimitMap.get(key);
  const max = req.path.startsWith("/api/auth") ? Math.min(rateLimitMax, 30) : rateLimitMax;
  if (!bucket || bucket.resetAt <= now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return res.status(429).json({ message: "请求过于频繁，请稍后再试。" });
  }
  next();
});
app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - started;
    if (res.statusCode >= 400 || process.env.API_ACCESS_LOG === "true") {
      console.log(`[api] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

const createProjectSchema = z.object({
  title: z.string().min(1),
  sourceType: z.enum(["novel", "short_story", "idea", "script", "excel"]),
  content: z.string().default(""),
  mode: z.enum(["nine_grid", "twenty_five_grid", "director"]),
  genre: z.string().default("短剧"),
  videoRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  artStyle: z.string().default("国漫写实"),
  targetEpisodes: z.coerce.number().int().min(1).max(20).optional(),
  textProvider: z.string().optional(),
  textModel: z.string().optional(),
  imageProvider: z.string().optional(),
  imageModel: z.string().optional(),
  imageSize: z.string().optional(),
  imageQuality: z.string().optional(),
  videoProvider: z.string().optional(),
  videoModel: z.string().optional()
});

const projectRouteUpdateSchema = z.object({
  textProvider: z.string().nullable().optional(),
  textModel: z.string().nullable().optional(),
  imageProvider: z.string().nullable().optional(),
  imageModel: z.string().nullable().optional(),
  imageSize: z.string().nullable().optional(),
  imageQuality: z.string().nullable().optional(),
  videoProvider: z.string().nullable().optional(),
  videoModel: z.string().nullable().optional()
});

const registerSchema = z.object({
  name: z.string().optional(),
  phone: z.string().regex(/^1[3-9]\d{9}$/, "请输入 11 位中国大陆手机号"),
  email: z.string().email(),
  password: z.string().min(6)
});

const loginSchema = z.object({
  account: z.string().min(1),
  password: z.string().min(6)
});

const modelPriceUpdateSchema = z.object({
  unitCredits: z.coerce.number().int().min(0).optional(),
  vendorCostCny: z.coerce.number().min(0).optional(),
  enabled: z.boolean().optional()
});

const modelPriceCreateSchema = z.object({
  providerId: z.string().optional(),
  providerName: z.string().min(1),
  modality: z.enum(["text", "image", "video", "tts", "embedding"]),
  model: z.string().min(1),
  unit: z.enum(["text_run", "image", "image2", "video_second", "tts_character", "export"]).optional(),
  unitCredits: z.coerce.number().int().min(0),
  vendorCostCny: z.coerce.number().min(0).optional(),
  enabled: z.boolean().optional()
});

const planUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  price: z.coerce.number().min(0).optional(),
  credits: z.coerce.number().int().min(0).optional(),
  bonusCredits: z.coerce.number().int().min(0).optional(),
  badge: z.string().nullable().optional(),
  features: z.array(z.string()).optional(),
  shopUrl: z.string().nullable().optional(),
  enabled: z.boolean().optional()
});

const planCreateSchema = z.object({
  name: z.string().min(1),
  price: z.coerce.number().min(0),
  credits: z.coerce.number().int().min(0),
  bonusCredits: z.coerce.number().int().min(0).optional(),
  badge: z.string().nullable().optional(),
  features: z.array(z.string()).optional(),
  shopUrl: z.string().nullable().optional(),
  enabled: z.boolean().optional()
});

const providerRoutingSchema = z.object({
  mode: z.enum(["auto", "manual"]).optional(),
  preferredModel: z.string().nullable().optional(),
  modelPool: z.array(z.string()).optional()
});

const providerUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  modality: z.enum(["text", "image", "video", "tts", "embedding"]).optional(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().nullable().optional(),
  iconUrl: z.string().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  models: z.array(z.string()).optional(),
  costHint: z.string().optional(),
  routing: providerRoutingSchema.optional()
});

const providerCreateSchema = z.object({
  id: z.string().min(2).max(80).optional(),
  name: z.string().min(1),
  modality: z.enum(["text", "image", "video", "tts", "embedding"]),
  enabled: z.boolean().optional(),
  baseUrl: z.string().nullable().optional(),
  iconUrl: z.string().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  models: z.array(z.string()).min(1),
  costHint: z.string().optional(),
  routing: providerRoutingSchema.optional(),
  unitCredits: z.coerce.number().int().min(0).optional(),
  vendorCostCny: z.coerce.number().min(0).optional()
});

const membershipPlanUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  monthlyPrice: z.coerce.number().min(0).optional(),
  monthlyCredits: z.coerce.number().int().min(0).optional(),
  discountPercent: z.coerce.number().int().min(0).max(100).optional(),
  priorityLevel: z.coerce.number().int().min(0).optional(),
  badge: z.string().nullable().optional(),
  features: z.array(z.string()).optional(),
  shopUrl: z.string().nullable().optional(),
  enabled: z.boolean().optional()
});

const membershipPlanCreateSchema = z.object({
  name: z.string().min(1),
  monthlyPrice: z.coerce.number().min(0),
  monthlyCredits: z.coerce.number().int().min(0),
  discountPercent: z.coerce.number().int().min(0).max(100).optional(),
  priorityLevel: z.coerce.number().int().min(0).optional(),
  badge: z.string().nullable().optional(),
  features: z.array(z.string()).optional(),
  shopUrl: z.string().nullable().optional(),
  enabled: z.boolean().optional()
});

const redeemCodeUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(3).optional(),
  credits: z.coerce.number().int().min(1).optional(),
  maxRedemptions: z.coerce.number().int().min(1).optional(),
  enabled: z.boolean().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional()
});

const redeemBatchCreateSchema = z.object({
  name: z.string().min(1).default("批量体验码"),
  prefix: z.string().min(1).max(16).default("GIFT"),
  credits: z.coerce.number().int().min(1).max(1_000_000),
  count: z.coerce.number().int().min(1).max(1000),
  enabled: z.boolean().optional()
});

const adjustCreditsSchema = z.object({
  userId: z.string().min(1),
  amount: z.coerce.number().int(),
  description: z.string().default("")
});

const rechargeOrderCreateSchema = z.object({
  planId: z.string().min(1),
  channel: z.enum(["wechat", "alipay", "manual", "mock"]).default("mock")
});

const rechargeCallbackSchema = z.object({
  orderId: z.string().min(1),
  channel: z.string().optional(),
  providerTradeNo: z.string().optional(),
  amountCny: z.coerce.number().min(0).optional(),
  payload: z.unknown().optional()
});

const invoiceRequestSchema = z.object({
  orderId: z.string().min(1),
  title: z.string().min(2),
  taxNo: z.string().optional(),
  email: z.string().email().optional()
});

const exportJobCreateSchema = z.object({
  type: z.enum(["tts", "subtitle", "video_export"])
});

const adminUserUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["creator", "admin", "operator", "finance", "support"]).optional(),
  status: z.enum(["active", "disabled"]).optional()
});

const adminUserCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().regex(/^1[3-9]\d{9}$/, "请输入 11 位中国大陆手机号").optional(),
  password: z.string().min(6),
  role: z.enum(["creator", "admin", "operator", "finance", "support"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  initialCredits: z.coerce.number().int().min(0).optional()
});

const resetPasswordSchema = z.object({
  password: z.string().min(6)
});

const promptTemplateUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["planning", "script", "storyboard", "character", "image", "video", "review"]).optional(),
  version: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  summary: z.string().min(1).optional(),
  content: z.string().optional()
});

const promptTemplateCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["planning", "script", "storyboard", "character", "image", "video", "review"]),
  version: z.string().min(1),
  enabled: z.boolean().optional(),
  summary: z.string().min(1),
  content: z.string().optional()
});

const redeemSchema = z.object({
  code: z.string().min(1)
});

const storyboardGenerateSchema = z.object({
  artStyle: z.string().optional(),
  mode: z.enum(["nine_grid", "twenty_five_grid", "director"]).optional(),
  videoRatio: z.enum(["9:16", "16:9", "1:1"]).optional()
});

const storyboardUpdateSchema = z.object({
  duration: z.coerce.number().int().min(1).max(30).optional(),
  shotSize: z.string().optional(),
  cameraAngle: z.string().optional(),
  cameraMovement: z.string().optional(),
  characters: z.array(z.string()).optional(),
  scene: z.string().optional(),
  pictureDesc: z.string().optional(),
  action: z.string().optional(),
  orientation: z.string().optional(),
  spatialRelation: z.string().optional(),
  emotion: z.string().optional(),
  dialogue: z.string().optional(),
  voiceOver: z.string().optional(),
  environmentSound: z.string().optional(),
  soundEffect: z.string().optional(),
  imagePrompt: z.string().optional(),
  videoPrompt: z.string().optional()
});

const characterReferenceSchema = z.object({
  referenceUrl: z.string().min(1, "请上传图片或粘贴图片地址"),
  description: z.string().optional()
});

const characterImageGenerateSchema = z.object({
  characterIds: z.array(z.string()).optional(),
  forceRegenerate: z.boolean().optional()
});

const imageGenerateSchema = z.object({
  shotIds: z.array(z.string()).optional(),
  forceRegenerate: z.boolean().optional()
});

const evaluationStageSchema = z.enum(["script", "character", "storyboard", "image", "video"]);

const analyticsEventSchema = z.object({
  sessionId: z.string().max(120).optional(),
  eventName: z.string().min(1).max(120),
  entityType: z.string().max(80).optional(),
  entityId: z.string().max(160).optional(),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  sourceChannel: z.string().max(80).optional(),
  campaignCode: z.string().max(80).optional(),
  properties: z.record(z.string(), z.unknown()).optional()
});

const feedbackCreateSchema = z.object({
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  assetId: z.string().optional(),
  stage: evaluationStageSchema,
  rating: z.coerce.number().int().min(1).max(5),
  usability: z.enum(["usable", "barely_usable", "unusable"]),
  tags: z.array(z.string()).default([]),
  content: z.string().max(1000).optional(),
  source: z.string().max(40).optional()
});

const feedbackUpdateSchema = z.object({
  status: z.enum(["open", "triaged", "processing", "resolved", "ignored", "converted"]).optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).optional(),
  rootCause: z.string().max(80).nullable().optional(),
  assignee: z.string().max(80).nullable().optional(),
  resolution: z.string().max(800).nullable().optional(),
  convertedDatasetId: z.string().max(120).nullable().optional()
});

const evaluationDatasetCreateSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  source: z.string().max(40).optional(),
  projectIds: z.array(z.string()).min(1).max(100),
  stages: z.array(evaluationStageSchema).min(1).max(5),
  filters: z.record(z.string(), z.unknown()).optional(),
  owner: z.string().max(80).optional()
});

const evaluationRunSchema = z.object({
  datasetId: z.string().optional(),
  runName: z.string().max(100).optional(),
  projectIds: z.array(z.string()).max(50).optional().default([]),
  stages: z.array(evaluationStageSchema).max(5).optional().default([]),
  mode: z.enum(["rules", "hybrid", "llm"]).default("rules"),
  evaluatorModels: z.array(z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    name: z.string().optional()
  })).max(6).optional(),
  maxLlmCalls: z.coerce.number().int().min(0).max(50).optional(),
  maxShotsPerPrompt: z.coerce.number().int().min(1).max(25).optional(),
  includeFeedback: z.boolean().optional()
});

const writingAgentSchema = z.object({
  title: z.string().min(1),
  premise: z.string().default(""),
  genre: z.string().optional(),
  targetChapters: z.coerce.number().int().min(3).max(60).optional(),
  chapterWords: z.coerce.number().int().min(800).max(6000).optional()
});

const characterConsistencySchema = z.object({
  projectId: z.string().optional(),
  storyTitle: z.string().min(1),
  artStyle: z.string().default("国漫写实"),
  characters: z
    .array(
      z.object({
        name: z.string().min(1),
        identity: z.string().default("角色"),
        appearance: z.string().default("稳定五官"),
        costume: z.string().default("稳定服装"),
        personality: z.string().default("性格明确"),
        seed: z.coerce.number().int().optional(),
        consistencyLevel: z.enum(["low", "medium", "high"]).default("high")
      })
    )
    .min(1)
});

const visualPipelineTestSchema = z.object({
  pipelineId: z.string().min(1)
});

const paramId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value ?? "");

function localStorageDownloadPath(storageUrl: string) {
  if (!storageUrl.startsWith("/storage/")) return undefined;
  const relativePath = storageUrl.replace(/^\/storage\//, "").split(/[?#]/)[0]?.replace(/\\/g, "/").replace(/\.\./g, "");
  if (!relativePath) return undefined;
  const target = resolve(storageRoot, relativePath);
  const rel = relative(storageRoot, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return target;
}

function exportDownloadFileName(job: { id: string; type: string; outputUrl?: string }) {
  const ext = job.outputUrl?.split(/[?#]/)[0]?.match(/\.([a-z0-9]+)$/i)?.[1] || (job.type === "subtitle" ? "srt" : job.type === "tts" ? "wav" : "json");
  const prefix = job.type === "video_export" ? "video-export" : job.type;
  return `${prefix}-${job.id}.${ext}`;
}

function asyncRoute<TReq extends express.Request, TRes extends express.Response>(
  handler: (req: TReq, res: TRes) => Promise<unknown>
) {
  return (req: TReq, res: TRes, next: express.NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

function hashAuthToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionExpiresAt() {
  const ttlMs = Math.max(1, authSessionTtlDays) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ttlMs);
}

async function issueToken(userId: string, req: express.Request) {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.authSession.create({
    data: {
      id: `session_${crypto.randomUUID()}`,
      userId,
      tokenHash: hashAuthToken(token),
      userAgent: req.get("user-agent")?.slice(0, 500),
      ipAddress: req.ip,
      expiresAt: sessionExpiresAt()
    }
  });
  return token;
}

function bearerToken(req: express.Request) {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function publicUser(user: { id: string; name: string; email?: string | null; phone?: string | null; role: string; status: string }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? undefined,
    phone: user.phone ?? undefined,
    role: user.role,
    status: user.status
  };
}

function requestUserId(req: express.Request) {
  return (req as express.Request & { userId?: string }).userId;
}

function requestAuthUser(req: express.Request) {
  return (req as express.Request & { authUser?: { id: string; role: string; status: string } }).authUser;
}

const adminRolePermissions: Record<string, string[]> = {
  admin: ["*"],
  operator: ["dashboard:read", "models:manage", "redeem:manage", "templates:read", "templates:manage", "users:read", "users:manage", "credits:adjust"],
  finance: ["dashboard:read", "billing:manage", "credits:adjust", "users:read"],
  support: ["dashboard:read", "users:read", "credits:adjust"],
  creator: []
};

function canEnterAdmin(role = "creator") {
  return (adminRolePermissions[role] ?? []).length > 0;
}

function hasAdminPermission(role = "creator", permission: string) {
  const permissions = adminRolePermissions[role] ?? [];
  return permissions.includes("*") || permissions.includes(permission);
}

function requireAdminPermission(permission: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!hasAdminPermission(requestAuthUser(req)?.role, permission)) {
      return res.status(403).json({ message: "当前后台角色没有此模块权限。" });
    }
    next();
  };
}

async function resolveAuthUser(req: express.Request) {
  const token = bearerToken(req);
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashAuthToken(token) },
    include: { user: { select: { id: true, role: true, status: true } } }
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== "active") return null;

  await prisma.authSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date(), expiresAt: sessionExpiresAt() }
  });

  return session.user;
}

async function ensureCreditForUser(userId: string) {
  await prisma.creditAccount.upsert({
    where: { userId },
    update: {},
    create: {
      id: `credit_${userId}`,
      userId,
      balance: 1000,
      frozenBalance: 0,
      totalRecharge: 1000,
      totalConsume: 0
    }
  });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "aigc-short-drama-api",
    storage: "postgresql",
    queue: "bullmq",
    time: new Date().toISOString()
  });
});

app.get(
  "/api/system/health/dependencies",
  asyncRoute(async (_req, res) => {
    const checks = {
      database: false,
      redis: false
    };
    const errors: Record<string, string> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch (error) {
      errors.database = error instanceof Error ? error.message : String(error);
    }

    try {
      await pingRedis();
      checks.redis = true;
    } catch (error) {
      errors.redis = error instanceof Error ? error.message : String(error);
    }

    const ok = checks.database && checks.redis;
    res.status(ok ? 200 : 503).json({ ok, checks, errors });
  })
);

app.post(
  "/api/auth/register",
  asyncRoute(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const email = parsed.data.email.trim().toLowerCase();
    const phone = parsed.data.phone.trim();
    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
    if (existing?.email === email) return res.status(409).json({ message: "该邮箱已注册，请直接登录。" });
    if (existing?.phone === phone) return res.status(409).json({ message: "该手机号已注册，请直接登录。" });

    const user = await prisma.user.create({
      data: {
        id: `user_${crypto.randomUUID()}`,
        name: parsed.data.name?.trim() || `用户${phone.slice(-4)}`,
        email,
        phone,
        passwordHash: await hashPassword(parsed.data.password),
        role: "creator",
        status: "active"
      }
    });

    await ensureCreditForUser(user.id);
    const token = await issueToken(user.id, req);
    res.status(201).json({ token, user: publicUser(user) });
  })
);

app.post(
  "/api/auth/login",
  asyncRoute(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const account = parsed.data.account.trim().toLowerCase();
    let user = account === "demo@aifilm.local" ? await prisma.user.findUnique({ where: { id: DEMO_USER_ID } }) : null;
    if (!user && account.includes("@")) {
      user = await prisma.user.findUnique({ where: { email: account } });
    }
    if (!user && /^1[3-9]\d{9}$/.test(account)) {
      user = await prisma.user.findUnique({ where: { phone: account } });
    }
    if (!user) return res.status(401).json({ message: "账号不存在，请先注册或使用演示账号。" });

    const validPassword = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!validPassword) return res.status(401).json({ message: "密码不正确，请重新输入。" });

    await ensureCreditForUser(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = await issueToken(user.id, req);
    res.json({ token, user: publicUser(user) });
  })
);

app.get(
  "/api/auth/me",
  asyncRoute(async (req, res) => {
    const authUser = await resolveAuthUser(req);
    if (!authUser) return res.status(401).json({ message: "登录已过期，请重新登录。" });
    const user = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (!user) return res.status(401).json({ message: "用户不存在，请重新登录。" });
    res.json({ user: publicUser(user) });
  })
);

app.post(
  "/api/auth/logout",
  asyncRoute(async (req, res) => {
    const token = bearerToken(req);
    if (token) {
      await prisma.authSession.updateMany({
        where: { tokenHash: hashAuthToken(token), revokedAt: null },
        data: { revokedAt: new Date() }
      });
    }
    res.json({ ok: true });
  })
);

app.use("/api", (req, res, next) => {
  void resolveAuthUser(req)
    .then((user) => {
      if (!user) return res.status(401).json({ message: "登录已过期，请重新登录。" });
      const authedReq = req as express.Request & { userId?: string; authUser?: { id: string; role: string; status: string } };
      authedReq.userId = user.id;
      authedReq.authUser = user;
      next();
    })
    .catch(next);
});

app.use("/api/admin", (req, res, next) => {
  if (!canEnterAdmin(requestAuthUser(req)?.role)) {
    return res.status(403).json({ message: "无后台管理权限。" });
  }
  next();
});

app.get(
  "/api/workbench/summary",
  asyncRoute(async (req, res) => {
    res.json(await getWorkbenchSummary(requestUserId(req)));
  })
);

app.get(
  "/api/projects",
  asyncRoute(async (req, res) => {
    res.json(await listProjects(requestUserId(req)));
  })
);

app.post(
  "/api/projects/prune-to-latest",
  asyncRoute(async (req, res) => {
    res.json(await pruneUserProjectsToLatest(requestUserId(req)));
  })
);

app.get(
  "/api/projects/:id",
  asyncRoute(async (req, res) => {
    const workflow = await getProjectWorkflow(paramId(req.params.id), requestUserId(req));
    if (!workflow) return res.status(404).json({ message: "项目不存在" });
    res.json({ project: workflow.project, storyboards: workflow.storyboards });
  })
);

app.get(
  "/api/projects/:id/workflow",
  asyncRoute(async (req, res) => {
    const workflow = await getProjectWorkflow(paramId(req.params.id), requestUserId(req));
    if (!workflow) return res.status(404).json({ message: "项目不存在" });
    res.json(workflow);
  })
);

app.patch(
  "/api/projects/:id/model-routes",
  asyncRoute(async (req, res) => {
    const parsed = projectRouteUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updateProjectModelRoutes(paramId(req.params.id), requestUserId(req), {
      textProvider: parsed.data.textProvider ?? undefined,
      textModel: parsed.data.textModel ?? undefined,
      imageProvider: parsed.data.imageProvider ?? undefined,
      imageModel: parsed.data.imageModel ?? undefined,
      imageSize: parsed.data.imageSize ?? undefined,
      imageQuality: parsed.data.imageQuality ?? undefined,
      videoProvider: parsed.data.videoProvider ?? undefined,
      videoModel: parsed.data.videoModel ?? undefined
    }));
  })
);

app.get(
  "/api/projects/:id/quality-reports",
  asyncRoute(async (req, res) => {
    res.json(await getProjectQualityReports(paramId(req.params.id), requestUserId(req)));
  })
);

app.post(
  "/api/projects/:id/quality-reports/generate",
  asyncRoute(async (req, res) => {
    res.status(201).json(await generateProjectQualityReports(paramId(req.params.id), requestUserId(req)));
  })
);

app.get(
  "/api/projects/:id/storyboards",
  asyncRoute(async (req, res) => {
    const workflow = await getProjectWorkflow(paramId(req.params.id), requestUserId(req));
    if (!workflow) return res.status(404).json({ message: "项目不存在" });
    res.json(workflow.storyboards);
  })
);

app.get(
  "/api/projects/:id/characters",
  asyncRoute(async (req, res) => {
    const workflow = await getProjectWorkflow(paramId(req.params.id), requestUserId(req));
    if (!workflow) return res.status(404).json({ message: "项目不存在" });
    res.json(workflow.characters);
  })
);

app.get(
  "/api/projects/:id/assets",
  asyncRoute(async (req, res) => {
    const workflow = await getProjectWorkflow(paramId(req.params.id), requestUserId(req));
    if (!workflow) return res.status(404).json({ message: "项目不存在" });
    res.json(workflow.assets);
  })
);

app.post(
  "/api/projects/:id/storyboards/generate",
  asyncRoute(async (req, res) => {
    const parsed = storyboardGenerateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await runProjectStoryboardTasks(paramId(req.params.id), requestUserId(req), parsed.data));
  })
);

app.patch(
  "/api/projects/:id/storyboards/:shotId",
  asyncRoute(async (req, res) => {
    const parsed = storyboardUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updateStoryboardShot(paramId(req.params.id), paramId(req.params.shotId), requestUserId(req), parsed.data));
  })
);

app.post(
  "/api/projects/:id/storyboards/:shotId/image/regenerate",
  asyncRoute(async (req, res) => {
    res.json(await regenerateStoryboardShotImage(paramId(req.params.id), paramId(req.params.shotId), requestUserId(req)));
  })
);

app.post(
  "/api/projects/:id/characters/images/generate",
  asyncRoute(async (req, res) => {
    const parsed = characterImageGenerateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await generateCharacterReferenceImages(paramId(req.params.id), requestUserId(req), parsed.data));
  })
);

app.post(
  "/api/projects/:id/characters/:characterId/reference",
  asyncRoute(async (req, res) => {
    const parsed = characterReferenceSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await setCharacterReferenceImage(paramId(req.params.id), paramId(req.params.characterId), requestUserId(req), parsed.data));
  })
);

app.delete(
  "/api/projects/:id/characters/:characterId/reference",
  asyncRoute(async (req, res) => {
    res.json(await deleteCharacterReferenceImage(paramId(req.params.id), paramId(req.params.characterId), requestUserId(req)));
  })
);

app.post(
  "/api/projects/:id/images/generate",
  asyncRoute(async (req, res) => {
    const parsed = imageGenerateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await runProjectImageTasks(paramId(req.params.id), requestUserId(req), parsed.data));
  })
);

app.post(
  "/api/projects/:id/videos/generate",
  asyncRoute(async (req, res) => {
    res.json(await runProjectVideoTasks(paramId(req.params.id), requestUserId(req)));
  })
);

app.get(
  "/api/projects/:id/export/storyboard",
  asyncRoute(async (req, res) => {
    res.json(await exportStoryboardRows(paramId(req.params.id), requestUserId(req)));
  })
);

app.get(
  "/api/projects/:id/director-storyboard",
  asyncRoute(async (req, res) => {
    res.json(await getDirectorStoryboardRows(paramId(req.params.id), requestUserId(req)));
  })
);

app.post(
  "/api/projects/:id/director-storyboard/export",
  asyncRoute(async (req, res) => {
    res.status(201).json(await exportDirectorStoryboardPackage(paramId(req.params.id), requestUserId(req)));
  })
);

app.get(
  "/api/projects/:id/export/jobs",
  asyncRoute(async (req, res) => {
    res.json(await listExportJobs(requestUserId(req), paramId(req.params.id)));
  })
);

app.post(
  "/api/projects/:id/export/jobs",
  asyncRoute(async (req, res) => {
    const parsed = exportJobCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createProjectExportJob(paramId(req.params.id), requestUserId(req), parsed.data.type));
  })
);

app.get(
  "/api/projects/:id/export/jobs/:jobId/download",
  asyncRoute(async (req, res) => {
    const job = await getExportJobForDownload(paramId(req.params.id), paramId(req.params.jobId), requestUserId(req));
    if (!job.outputUrl) return res.status(404).json({ message: "导出文件不存在。" });
    if (job.outputUrl.startsWith("http://") || job.outputUrl.startsWith("https://")) {
      return res.redirect(job.outputUrl);
    }
    const filePath = localStorageDownloadPath(job.outputUrl);
    if (!filePath) return res.status(400).json({ message: "导出地址不支持下载。" });
    await access(filePath);
    return res.download(filePath, exportDownloadFileName(job));
  })
);

app.post(
  "/api/creation/estimate",
  asyncRoute(async (req, res) => {
    const parsed = createProjectSchema
      .pick({
        content: true,
        mode: true,
        targetEpisodes: true,
        textProvider: true,
        textModel: true,
        imageProvider: true,
        imageModel: true,
        imageSize: true,
        imageQuality: true,
        videoProvider: true,
        videoModel: true
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const pricing = await prisma.modelPrice.findMany({
      where: { enabled: true },
      select: { providerId: true, model: true, modality: true, unitCredits: true, enabled: true }
    });
    res.json(estimateCreation({
      ...parsed.data,
      pricing: pricing.map((item) => ({ ...item, providerId: item.providerId ?? undefined }))
    }));
  })
);

app.post(
  "/api/creation/start",
  asyncRoute(async (req, res) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const userId = requestUserId(req)!;
    const estimate = estimateCreation(parsed.data);
    const { projectId, taskId, task, estimatedCredits } = await createProjectAndTask(parsed.data, userId);

    const job = await generationQueue.add(
      "create-project",
      { projectId, taskId, userId, input: parsed.data, estimatedCredits },
      {
        attempts: Number(process.env.GENERATION_JOB_ATTEMPTS ?? 3),
        backoff: { type: "exponential", delay: Number(process.env.GENERATION_JOB_BACKOFF_MS ?? 5000) },
        removeOnComplete: 100,
        removeOnFail: 100
      }
    );
    await prisma.generationTask.update({ where: { id: taskId }, data: { jobId: job.id } });

    const result = (await job.waitUntilFinished(generationQueueEvents, 60_000).catch(() => ({ mode: "queued" }))) as {
      mode?: "real" | "local" | "queued";
    };
    const workflow = await getProjectWorkflow(projectId, userId);
    res.status(201).json({ project: workflow?.project, task, estimate, mode: result.mode ?? "queued" });
  })
);

app.get(
  "/api/tasks",
  asyncRoute(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    res.json(await listTasks(requestUserId(req), status, type));
  })
);

app.post(
  "/api/analytics/events",
  asyncRoute(async (req, res) => {
    const parsed = analyticsEventSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    await recordAnalyticsEvent(requestUserId(req), parsed.data);
    res.status(201).json({ ok: true });
  })
);

app.post(
  "/api/feedback",
  asyncRoute(async (req, res) => {
    const parsed = feedbackCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createUserFeedback(requestUserId(req)!, parsed.data));
  })
);

app.post(
  "/api/tasks/:id/retry",
  asyncRoute(async (req, res) => {
    const taskId = paramId(req.params.id);
    const userId = requestUserId(req)!;
    const task = await prisma.generationTask.findFirst({ where: { id: taskId, userId } });
    if (!task) return res.status(404).json({ message: "任务不存在。" });
    if (task.status === "succeeded") return res.status(409).json({ message: "已成功任务不需要重试。" });

    if (task.type === "text") {
      const originalJob = task.jobId ? await generationQueue.getJob(task.jobId) : null;
      if (!originalJob?.data) {
        return res.status(409).json({ message: "该文本任务缺少队列快照，无法自动重试。请新建项目或重新提交剧本。" });
      }
      const project = task.projectId
        ? await prisma.project.findFirst({ where: { id: task.projectId, userId } })
        : null;
      const retryInput = project
        ? {
            ...originalJob.data.input,
            textProvider: project.textProvider ?? originalJob.data.input.textProvider,
            textModel: project.textModel ?? originalJob.data.input.textModel,
            imageProvider: project.imageProvider ?? originalJob.data.input.imageProvider,
            imageModel: project.imageModel ?? originalJob.data.input.imageModel,
            imageSize: project.imageSize ?? originalJob.data.input.imageSize,
            imageQuality: project.imageQuality ?? originalJob.data.input.imageQuality,
            videoProvider: project.videoProvider ?? originalJob.data.input.videoProvider,
            videoModel: project.videoModel ?? originalJob.data.input.videoModel
          }
        : originalJob.data.input;
      const retryData = { ...originalJob.data, input: retryInput };
      const updated = await retryTask(taskId, userId);
      const retryJob = await generationQueue.add(
        "create-project",
        retryData,
        {
          attempts: Number(process.env.GENERATION_JOB_ATTEMPTS ?? 3),
          backoff: { type: "exponential", delay: Number(process.env.GENERATION_JOB_BACKOFF_MS ?? 5000) },
          removeOnComplete: 100,
          removeOnFail: 100
        }
      );
      const refreshed = await prisma.generationTask.update({ where: { id: taskId }, data: { jobId: retryJob.id } });
      return res.json({ ...updated, jobId: refreshed.jobId ?? updated.jobId });
    }

    if (!task.projectId) return res.status(409).json({ message: "该任务没有绑定作品，无法按阶段重试。" });
    if (task.type === "storyboard") return res.json((await runProjectStoryboardTasks(task.projectId, userId)).task);
    if (task.type === "character") return res.json((await generateCharacterReferenceImages(task.projectId, userId)).task);
    if (task.type === "image") return res.json((await runProjectImageTasks(task.projectId, userId, { forceRegenerate: true })).task);
    if (task.type === "video") return res.json((await runProjectVideoTasks(task.projectId, userId)).task);

    res.json(await retryTask(taskId, userId));
  })
);

app.post(
  "/api/tasks/:id/cancel",
  asyncRoute(async (req, res) => {
    const taskId = paramId(req.params.id);
    const userId = requestUserId(req);
    const task = await prisma.generationTask.findFirst({ where: { id: taskId, userId } });
    if (task?.jobId) {
      const job = await generationQueue.getJob(task.jobId);
      await job?.remove().catch(() => undefined);
    }
    res.json(await cancelTask(taskId, userId));
  })
);

app.get(
  "/api/credits/account",
  asyncRoute(async (req, res) => {
    res.json(await getCreditAccount(requestUserId(req)));
  })
);

app.get(
  "/api/credits/transactions",
  asyncRoute(async (req, res) => {
    res.json(await listCreditTransactions(requestUserId(req)));
  })
);

app.get(
  "/api/billing/orders",
  asyncRoute(async (req, res) => {
    res.json(await listRechargeOrders(requestUserId(req)));
  })
);

app.post(
  "/api/billing/orders",
  asyncRoute(async (req, res) => {
    const parsed = rechargeOrderCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createRechargeOrder(requestUserId(req), parsed.data));
  })
);

app.post(
  "/api/billing/mock-callback",
  asyncRoute(async (req, res) => {
    const parsed = rechargeCallbackSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await handleRechargeCallback({ ...parsed.data, payload: parsed.data.payload ?? req.body }));
  })
);

app.get(
  "/api/billing/payments",
  asyncRoute(async (req, res) => {
    res.json(await listPaymentRecords(requestUserId(req)));
  })
);

app.get(
  "/api/billing/invoices",
  asyncRoute(async (req, res) => {
    res.json(await listInvoices(requestUserId(req)));
  })
);

app.post(
  "/api/billing/invoices",
  asyncRoute(async (req, res) => {
    const parsed = invoiceRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await requestInvoice(requestUserId(req), parsed.data));
  })
);

app.post(
  "/api/credits/redeem",
  asyncRoute(async (req, res) => {
    const parsed = redeemSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await redeemExperienceCode(requestUserId(req), parsed.data.code));
  })
);

app.get(
  "/api/plans",
  asyncRoute(async (_req, res) => {
    res.json(await listPlans());
  })
);

app.get(
  "/api/membership-plans",
  asyncRoute(async (_req, res) => {
    res.json(await listMembershipPlans());
  })
);

app.get(
  "/api/providers",
  asyncRoute(async (_req, res) => {
    res.json(await listProviders());
  })
);

app.get(
  "/api/model-prices",
  asyncRoute(async (_req, res) => {
    res.json(await listModelPrices());
  })
);

app.post(
  "/api/settings/model-test",
  asyncRoute(async (req, res) => {
    const parsed = z.object({ textProvider: z.string().optional(), textModel: z.string().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const provider = parsed.data.textProvider
      ? await prisma.modelProvider.findUnique({ where: { id: parsed.data.textProvider } })
      : null;
    if (provider?.enabled === false) throw new Error("该文本模型渠道已在后台停用");
    if (provider?.modality && provider.modality !== "text") throw new Error("请选择文本模型渠道");
    if (provider?.models.length && parsed.data.textModel && !provider.models.includes(parsed.data.textModel)) {
      throw new Error("该渠道不包含当前文本模型");
    }
    try {
      res.json(await testTextModelConnection({ ...parsed.data, baseUrl: provider?.baseUrl ?? undefined, apiKey: provider?.apiKey ?? undefined }));
    } catch (error) {
      res.json({
        ok: false,
        mode: "failed",
        provider: provider?.name || parsed.data.textProvider || process.env.TEXT_PROVIDER || "text-provider",
        model: parsed.data.textModel || process.env.TEXT_MODEL || "text-model",
        message: `文本模型测试失败：${formatStartupError(error)}`
      });
    }
  })
);

app.post(
  "/api/settings/image-model-test",
  asyncRoute(async (req, res) => {
    const parsed = z.object({ imageProvider: z.string().optional(), imageModel: z.string().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const provider = parsed.data.imageProvider
      ? await prisma.modelProvider.findUnique({ where: { id: parsed.data.imageProvider } })
      : null;
    if (provider?.enabled === false) throw new Error("该生图渠道已在后台停用");
    if (provider?.modality && provider.modality !== "image") throw new Error("请选择生图模型渠道");
    if (provider?.models.length && parsed.data.imageModel && !provider.models.includes(parsed.data.imageModel)) {
      throw new Error("该渠道不包含当前生图模型");
    }
    res.json(await testImageModelConnection({ provider: parsed.data.imageProvider, model: parsed.data.imageModel, baseUrl: provider?.baseUrl ?? undefined, apiKey: provider?.apiKey ?? undefined }));
  })
);

app.post(
  "/api/settings/video-model-test",
  asyncRoute(async (req, res) => {
    const parsed = z.object({ videoProvider: z.string().optional(), videoModel: z.string().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const provider = parsed.data.videoProvider
      ? await prisma.modelProvider.findUnique({ where: { id: parsed.data.videoProvider } })
      : null;
    if (provider?.enabled === false) throw new Error("该视频渠道已在后台停用");
    if (provider?.modality && provider.modality !== "video") throw new Error("请选择视频模型渠道");
    if (provider?.models.length && parsed.data.videoModel && !provider.models.includes(parsed.data.videoModel)) {
      throw new Error("该渠道不包含当前视频模型");
    }
    res.json(await testVideoModelConnection({ provider: parsed.data.videoProvider, model: parsed.data.videoModel, baseUrl: provider?.baseUrl ?? undefined, apiKey: provider?.apiKey ?? undefined }));
  })
);

app.get(
  "/api/templates",
  asyncRoute(async (_req, res) => {
    res.json(await listTemplates());
  })
);

app.get("/api/agents/storyboard/rules", (_req, res) => {
  res.json({
    pipeline: productionPipeline,
    storyboardQualityRules,
    roleConsistencyRules,
    adapters: [getToonflowAdapterMetadata(), getLingGuoAdapterMetadata()]
  });
});

app.get("/api/agents/open-source-adapters", (_req, res) => {
  res.json([getToonflowAdapterMetadata(), getLingGuoAdapterMetadata()]);
});

app.post(
  "/api/agents/writing/plan",
  asyncRoute(async (req, res) => {
    const parsed = writingAgentSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(createWebNovelWritingPlan(parsed.data));
  })
);

app.post(
  "/api/agents/character-consistency/plan",
  asyncRoute(async (req, res) => {
    const parsed = characterConsistencySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(createCharacterConsistencyPlan(parsed.data));
  })
);

app.get(
  "/api/admin/relay-gateway/policy",
  requireAdminPermission("models:manage"),
  asyncRoute(async (_req, res) => {
    const providers = await listProviders();
    res.json(createRelayGatewayPolicy(providers));
  })
);

app.get(
  "/api/admin/plugins/visual-pipelines",
  requireAdminPermission("models:manage"),
  asyncRoute(async (_req, res) => {
    const providers = await listProviders();
    res.json(listVisualPipelines(providers));
  })
);

app.post(
  "/api/admin/plugins/visual-pipelines/test",
  requireAdminPermission("models:manage"),
  asyncRoute(async (req, res) => {
    const parsed = visualPipelineTestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const providers = await listProviders();
    res.json(await testVisualPipeline(parsed.data.pipelineId, providers));
  })
);

app.get(
  "/api/admin/summary",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    res.json(await getAdminSummary(requestUserId(req)));
  })
);

app.get(
  "/api/admin/evaluation/overview",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (_req, res) => {
    res.json(await getAdminEvaluationOverview());
  })
);

app.get(
  "/api/admin/evaluation/projects",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (_req, res) => {
    res.json(await listAdminQualityProjects());
  })
);

app.get(
  "/api/admin/evaluation/datasets",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (_req, res) => {
    res.json(await listEvaluationDatasets());
  })
);

app.post(
  "/api/admin/evaluation/datasets",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const parsed = evaluationDatasetCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createEvaluationDataset(parsed.data));
  })
);

app.delete(
  "/api/admin/evaluation/datasets/:id",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    res.json(await deleteEvaluationDataset(paramId(req.params.id)));
  })
);

app.get(
  "/api/admin/evaluation/runs",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (_req, res) => {
    res.json(await listEvaluationRuns());
  })
);

app.get(
  "/api/admin/evaluation/runs/export.csv",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const ids = String(req.query.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const runs = await listEvaluationRuns();
    const selectedRuns = ids.length ? runs.filter((run) => ids.includes(run.id)) : runs;
    const details = (await Promise.all(selectedRuns.map((run) => getEvaluationRun(run.id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof getEvaluationRun>>>[];
    const csv = await buildEvaluationRunsCsv(details);
    const fileName = ids.length ? `evaluation-runs-${ids.length}` : "evaluation-runs-all";
    res.type("text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}.csv"`);
    res.send(csv);
  })
);

app.get(
  "/api/admin/evaluation/runs/export-excel.tsv",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const ids = String(req.query.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const runs = await listEvaluationRuns();
    const selectedRuns = ids.length ? runs.filter((run) => ids.includes(run.id)) : runs;
    const details = (await Promise.all(selectedRuns.map((run) => getEvaluationRun(run.id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof getEvaluationRun>>>[];
    const tsv = await buildEvaluationRunsTsv(details);
    const fileName = ids.length ? `evaluation-runs-${ids.length}` : "evaluation-runs-all";
    res.type("application/vnd.ms-excel; charset=utf-8");
    res.setHeader("Content-Disposition", contentDisposition(`${fileName}.xls`));
    res.send(Buffer.from("\uFEFF" + tsv, "utf8"));
  })
);

app.get(
  "/api/admin/evaluation/runs/:id/export.csv",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const detail = await getEvaluationRun(paramId(req.params.id));
    if (!detail) return res.status(404).json({ message: "评测运行记录不存在。" });
    const csv = await buildEvaluationRunsCsv([detail]);
    res.type("text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(detail.run.name || detail.run.id)}.csv"`);
    res.send(csv);
  })
);

app.get(
  "/api/admin/evaluation/runs/:id/export-excel.tsv",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const detail = await getEvaluationRun(paramId(req.params.id));
    if (!detail) return res.status(404).json({ message: "评测运行记录不存在。" });
    const tsv = await buildEvaluationRunsTsv([detail]);
    res.type("application/vnd.ms-excel; charset=utf-8");
    res.setHeader("Content-Disposition", contentDisposition(`${safeDownloadName(detail.run.name || detail.run.id)}.xls`));
    res.send(Buffer.from("\uFEFF" + tsv, "utf8"));
  })
);

app.get(
  "/api/admin/evaluation/runs/:id",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const detail = await getEvaluationRun(paramId(req.params.id));
    if (!detail) return res.status(404).json({ message: "评测运行记录不存在。" });
    res.json(detail);
  })
);

app.get(
  "/api/admin/feedback",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    res.json(await listAdminFeedback(Number(req.query.limit ?? 200)));
  })
);

app.patch(
  "/api/admin/feedback/:id",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const parsed = feedbackUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updateAdminFeedback(paramId(req.params.id), parsed.data));
  })
);

app.delete(
  "/api/admin/evaluation/runs/:id",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    res.json(await deleteEvaluationRun(paramId(req.params.id)));
  })
);

app.delete(
  "/api/admin/evaluation/projects/:id",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    res.json(await deleteProjectQualityData(paramId(req.params.id)));
  })
);

app.post(
  "/api/admin/evaluation/run",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const parsed = evaluationRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await runQualityEvaluation(parsed.data));
  })
);

app.get(
  "/api/admin/plans",
  requireAdminPermission("billing:manage"),
  asyncRoute(async (_req, res) => {
    res.json(await listAdminPlans());
  })
);

app.post(
  "/api/admin/plans",
  requireAdminPermission("billing:manage"),
  asyncRoute(async (req, res) => {
    const parsed = planCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createPlan(parsed.data));
  })
);

app.get(
  "/api/admin/membership-plans",
  requireAdminPermission("billing:manage"),
  asyncRoute(async (_req, res) => {
    res.json(await listMembershipPlans());
  })
);

app.post(
  "/api/admin/membership-plans",
  requireAdminPermission("billing:manage"),
  asyncRoute(async (req, res) => {
    const parsed = membershipPlanCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createMembershipPlan(parsed.data));
  })
);

app.get(
  "/api/admin/redeem-codes",
  requireAdminPermission("redeem:manage"),
  asyncRoute(async (_req, res) => {
    res.json(await listRedeemCodes());
  })
);

app.post(
  "/api/admin/redeem-codes/batch",
  requireAdminPermission("redeem:manage"),
  asyncRoute(async (req, res) => {
    const parsed = redeemBatchCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createRedeemCodeBatch(parsed.data));
  })
);

app.patch(
  "/api/admin/model-prices/:id",
  requireAdminPermission("billing:manage"),
  asyncRoute(async (req, res) => {
    const parsed = modelPriceUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updateModelPrice(paramId(req.params.id), parsed.data));
  })
);

app.post(
  "/api/admin/model-prices",
  requireAdminPermission("billing:manage"),
  asyncRoute(async (req, res) => {
    const parsed = modelPriceCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createModelPrice(parsed.data));
  })
);

app.delete(
  "/api/admin/model-prices/:id",
  requireAdminPermission("billing:manage"),
  asyncRoute(async (req, res) => {
    res.json(await deleteModelPrice(paramId(req.params.id)));
  })
);

app.patch(
  "/api/admin/plans/:id",
  requireAdminPermission("billing:manage"),
  asyncRoute(async (req, res) => {
    const parsed = planUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updatePlan(paramId(req.params.id), parsed.data));
  })
);

app.delete(
  "/api/admin/plans/:id",
  requireAdminPermission("billing:manage"),
  asyncRoute(async (req, res) => {
    res.json(await deletePlan(paramId(req.params.id)));
  })
);

app.patch(
  "/api/admin/membership-plans/:id",
  requireAdminPermission("billing:manage"),
  asyncRoute(async (req, res) => {
    const parsed = membershipPlanUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updateMembershipPlan(paramId(req.params.id), parsed.data));
  })
);

app.delete(
  "/api/admin/membership-plans/:id",
  requireAdminPermission("billing:manage"),
  asyncRoute(async (req, res) => {
    res.json(await deleteMembershipPlan(paramId(req.params.id)));
  })
);

app.patch(
  "/api/admin/redeem-codes/:id",
  requireAdminPermission("redeem:manage"),
  asyncRoute(async (req, res) => {
    const parsed = redeemCodeUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const redeemUpdate: Parameters<typeof updateRedeemCode>[1] = {
      name: parsed.data.name,
      code: parsed.data.code?.trim().toUpperCase(),
      credits: parsed.data.credits,
      maxRedemptions: parsed.data.maxRedemptions,
      enabled: parsed.data.enabled,
      startsAt: parsed.data.startsAt === undefined ? undefined : parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
      endsAt: parsed.data.endsAt === undefined ? undefined : parsed.data.endsAt ? new Date(parsed.data.endsAt) : null
    };
    res.json(
      await updateRedeemCode(paramId(req.params.id), redeemUpdate)
    );
  })
);

app.delete(
  "/api/admin/redeem-codes/:id",
  requireAdminPermission("redeem:manage"),
  asyncRoute(async (req, res) => {
    res.json(await deleteRedeemCode(paramId(req.params.id)));
  })
);

app.post(
  "/api/admin/providers",
  requireAdminPermission("models:manage"),
  asyncRoute(async (req, res) => {
    const parsed = providerCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createProvider(parsed.data));
  })
);

app.patch(
  "/api/admin/providers/:id",
  requireAdminPermission("models:manage"),
  asyncRoute(async (req, res) => {
    const parsed = providerUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updateProvider(paramId(req.params.id), parsed.data));
  })
);

app.delete(
  "/api/admin/providers/:id",
  requireAdminPermission("models:manage"),
  asyncRoute(async (req, res) => {
    res.json(await deleteProvider(paramId(req.params.id)));
  })
);

app.patch(
  "/api/admin/templates/:id",
  requireAdminPermission("templates:manage"),
  asyncRoute(async (req, res) => {
    const parsed = promptTemplateUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updatePromptTemplate(paramId(req.params.id), parsed.data));
  })
);

app.post(
  "/api/admin/templates",
  requireAdminPermission("templates:manage"),
  asyncRoute(async (req, res) => {
    const parsed = promptTemplateCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createPromptTemplate(parsed.data));
  })
);

app.delete(
  "/api/admin/templates/:id",
  requireAdminPermission("templates:manage"),
  asyncRoute(async (req, res) => {
    res.json(await deletePromptTemplate(paramId(req.params.id)));
  })
);

app.get(
  "/api/admin/users",
  requireAdminPermission("users:read"),
  asyncRoute(async (_req, res) => {
    res.json(await listAdminUsers());
  })
);

app.post(
  "/api/admin/users",
  requireAdminPermission("users:manage"),
  asyncRoute(async (req, res) => {
    const parsed = adminUserCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createAdminUser(parsed.data));
  })
);

app.patch(
  "/api/admin/users/:id",
  requireAdminPermission("users:manage"),
  asyncRoute(async (req, res) => {
    const parsed = adminUserUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updateAdminUser(paramId(req.params.id), parsed.data));
  })
);

app.post(
  "/api/admin/users/:id/password",
  requireAdminPermission("users:manage"),
  asyncRoute(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await resetAdminUserPassword(paramId(req.params.id), parsed.data.password));
  })
);

app.post(
  "/api/admin/users/credits/adjust",
  requireAdminPermission("credits:adjust"),
  asyncRoute(async (req, res) => {
    const parsed = adjustCreditsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await adjustUserCredits(parsed.data));
  })
);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "服务器异常";
  const cause = error instanceof Error && "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
  const causeMessage = cause instanceof Error ? `${cause.name}: ${cause.message}` : typeof cause === "object" && cause ? JSON.stringify(cause).slice(0, 240) : "";
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";

  if (
    code === "P1001" ||
    message.includes("Can't reach database") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ECONNRESET") ||
    message.includes("connection") ||
    causeMessage.includes("ConnectionReset") ||
    causeMessage.includes("ECONNREFUSED")
  ) {
    return res.status(503).json({ message: "后端依赖未就绪：请先打开 Docker Desktop，并启动 PostgreSQL 与 Redis。可运行 start_admin_server.bat 自动启动。" });
  }
  if (code === "P2002") {
    return res.status(409).json({ message: "数据已存在，请检查邮箱、兑换码或唯一配置是否重复。" });
  }
  if (code === "P2025") {
    return res.status(404).json({ message: "要操作的数据不存在或已被删除。" });
  }

  res.status(500).json({ message, detail: causeMessage || undefined });
});

function createRedisHealthClient() {
  const client = new RedisClient({
    ...queueConnection,
    connectTimeout: Number(process.env.REDIS_HEALTH_TIMEOUT_MS ?? 1000),
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });
  client.on("error", () => undefined);
  return client;
}

async function pingRedis() {
  const client = createRedisHealthClient();
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = windowlessTimeout(() => reject(new Error("Redis health check timed out")), Number(process.env.REDIS_HEALTH_TIMEOUT_MS ?? 1000));
      client.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });
      client.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    await client.ping();
  } finally {
    client.disconnect();
  }
}

function windowlessTimeout(handler: () => void, timeoutMs: number) {
  return setTimeout(handler, timeoutMs);
}

function formatStartupError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

function tsvCell(value: unknown) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
}

async function buildEvaluationRunTable(details: Array<NonNullable<Awaited<ReturnType<typeof getEvaluationRun>>>>) {
  const allProjectIds = [...new Set(details.flatMap((detail) => detail.run.projectIds))];
  const projects = allProjectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: allProjectIds } },
        include: { user: true, feedbacks: true }
      })
    : [];
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const header = [
    "评测记录",
    "样本集",
    "运行状态",
    "评测模式",
    "项目ID",
    "作品名称",
    "用户",
    "阶段",
    "渠道",
    "模型",
    "总分",
    "结论",
    "根因分类",
    "建议动作",
    "样本价值",
    "下一步",
    "创建时间"
  ];
  const rows = details.flatMap((detail) => {
    if (!detail.reports.length) {
      const runProjectIds = detail.run.projectIds.length ? detail.run.projectIds : [""];
      return runProjectIds.flatMap((projectId) => {
        const project = projectMap.get(projectId);
        return detail.run.stages.map((stage) => [
          `${detail.run.name}(${detail.run.id})`,
          detail.run.datasetName ?? "手动样本",
          detail.run.status,
          detail.run.mode,
          projectId,
          project?.name ?? "",
          project?.user?.name ?? "",
          stage,
          "",
          "",
          "",
          "未生成",
          detail.run.errorReason ? "运行失败" : "等待结果",
          detail.run.errorReason ? "评测运行失败" : "待评测",
          detail.run.errorReason ? "检查失败原因" : "等待评测结果",
          "中",
          detail.run.skipped.map((item) => item.reason).join("；") || "重新运行评测",
          detail.run.createdAt
        ]);
      });
    }

    return detail.reports.map((report) => {
      const project = projectMap.get(report.projectId);
      const rootCause = classifyEvaluationRootCause(report, project?.feedbacks ?? []);
      return [
        `${detail.run.name}(${detail.run.id})`,
        detail.run.datasetName ?? "手动样本",
        detail.run.status,
        detail.run.mode,
        report.projectId,
        project?.name ?? "",
        project?.user?.name ?? "",
        report.stage,
        report.provider ?? "",
        report.model ?? "",
        String(report.totalScore),
        report.pass ? "通过" : "未通过",
        rootCause,
        report.recommendedAction,
        evaluationSampleValue(report),
        report.suggestions[0] || report.problems[0] || "继续观察",
        report.createdAt
      ];
    });
  });
  return { header, rows };
}

function classifyEvaluationRootCause(report: NonNullable<Awaited<ReturnType<typeof getEvaluationRun>>>["reports"][number], feedbacks: Array<{ tags: string[]; content: string; stage: string; usability: string }>) {
  const relatedFeedback = feedbacks.filter((feedback) => feedback.stage === report.stage);
  const text = `${report.problems.join(" ")} ${report.suggestions.join(" ")} ${relatedFeedback.flatMap((feedback) => [...feedback.tags, feedback.content]).join(" ")}`;
  if (/角色|参考图|三视图|身份|漂移|脸型|服装/.test(text)) return "角色一致性";
  if (/视频|首帧|动作|Failed|生成失败|片段/.test(text)) return "视频生成";
  if (/提示词|prompt|画面描述|镜头|FOV|机位/.test(text)) return "提示词/分镜";
  if (/水印|畸形|崩坏|画幅|构图|图片/.test(text)) return "图片质量";
  if (/扣费|积分|成本|退款|退费/.test(text)) return "商业化/扣费";
  if (/导出|下载|字幕|配音|FFmpeg|MP4/i.test(text)) return "成片导出";
  return report.pass ? "通过样本" : "待人工归因";
}

function evaluationSampleValue(report: NonNullable<Awaited<ReturnType<typeof getEvaluationRun>>>["reports"][number]) {
  if (!report.pass || report.totalScore < 60) return "高";
  if (report.totalScore < 80) return "中";
  return "观察";
}

async function buildEvaluationRunsCsv(details: Array<NonNullable<Awaited<ReturnType<typeof getEvaluationRun>>>>) {
  const { header, rows } = await buildEvaluationRunTable(details);
  const body = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return "\uFEFFsep=,\r\n" + body + "\r\n";
}

async function buildEvaluationRunsTsv(details: Array<NonNullable<Awaited<ReturnType<typeof getEvaluationRun>>>>) {
  const { header, rows } = await buildEvaluationRunTable(details);
  return [header, ...rows].map((row) => row.map(tsvCell).join("\t")).join("\r\n") + "\r\n";
}

function safeDownloadName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "evaluation-runs";
}

function contentDisposition(fileName: string) {
  const fallback = safeDownloadName(fileName).replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function startBackgroundServices() {
  try {
    await ensureSeedData();
    console.log("[api] seed data ready");
  } catch (error) {
    console.warn(`[api] seed data skipped: ${formatStartupError(error)}`);
  }

  try {
    await pingRedis();
    startGenerationWorker();
    console.log("[api] generation worker ready");
  } catch (error) {
    console.warn(`[api] generation worker skipped: ${formatStartupError(error)}`);
  }
}

await ensureStorageBuckets();
void startBackgroundServices();

app.listen(port, () => {
  console.log(`[api] http://localhost:${port}`);
});




