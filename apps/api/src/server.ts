import "./config/env.js";
import crypto from "node:crypto";
import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import cors from "cors";
import express from "express";
import { Redis as RedisClient } from "ioredis";
import { z } from "zod";
import { storyboardQualityRules, roleConsistencyRules, productionPipeline } from "@aifilm/shared";
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
  createPlatformAnnouncement,
  createHelpArticle,
  createProvider,
  createProjectExportJob,
  quoteProjectExport,
  createPromptTemplate,
  exportDirectorStoryboardPackage,
  createRedeemCodeBatch,
  createRechargeOrder,
  createProjectAndTask,
  quoteCreationStart,
  adjustUserCredits,
  deleteMembershipPlan,
  deleteModelPrice,
  deletePlan,
  deleteProject,
  deletePlatformAnnouncement,
  deleteHelpArticle,
  deletePromptTemplate,
  deleteProvider,
  deleteRedeemCode,
  exportStoryboardRows,
  getExportJobForDownload,
  getDirectorStoryboardRows,
  getStoryboardProductionPackage,
  getAdminSummary,
  getCreditAccount,
  getProjectWorkflow,
  getWorkbenchSummary,
  handleRechargeCallback,
  listAdminUsers,
  listAdminUsersPage,
  listAdminPlans,
  listCreditTransactions,
  listExportJobs,
  listInvoices,
  listMembershipPlans,
  listModelPrices,
  listPaymentRecords,
  listPlans,
  listAdminAnnouncements,
  listAdminHelpArticles,
  listProjects,
  listPublicHelpArticles,
  listProviders,
  listRechargeOrders,
  ProjectRequestError,
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
  updatePlatformAnnouncement,
  updateHelpArticle,
  updateProvider,
  updatePromptTemplate,
  updateRedeemCode
} from "./db/repository.js";
import { prisma } from "./db/client.js";
import { beginAdminAudit, finishAdminAudit, listAdminAuditLogs } from "./admin/audit.js";
import { captureStoryboardTailFrame, deleteCharacterReferenceImageV2, generateCharacterReferenceImages, generateSceneEnvironmentImage, regenerateStoryboardShotImage, runProjectStoryboardTasks, setCharacterReferenceImageV2, updateStoryboardShot } from "./db/storyboardActions.js";
import { MediaSourceConflict } from "./db/mediaSource.js";
import { AnnouncementScheduleError } from "./db/announcementSafety.js";
import { closeSupportTicket, createSupportTicket, getSupportTicket, listSupportTickets, replySupportTicket, SupportTicketError } from "./db/supportTickets.js";
import {
  createEvaluationDataset,
  createExperimentRun,
  createPromptVersion,
  createUserFeedback,
  deleteEvaluationDataset,
  deleteEvaluationRun,
  deleteProjectQualityData,
  generateProjectQualityReports,
  getAdminQualityCenter,
  getAdminEvaluationOverview,
  getEvaluationRun,
  getProjectQualityReports,
  listAdminFeedback,
  listAdminFeedbackPage,
  listEvaluationDatasets,
  listEvaluationDatasetsPage,
  listEvaluationRuns,
  listEvaluationRunsPage,
  listExperimentRunsPage,
  listPromptVersionsPage,
  listAdminQualityProjects,
  recordAnalyticsEvent,
  runQualityEvaluation,
  updateAdminFeedback,
  updatePromptVersion
} from "./db/evaluation.js";
import {
  createCreatorShowcaseWork,
  listAdminShowcaseWorks,
  listCreatorShowcaseWorks,
  listPublicShowcaseWorks,
  resubmitCreatorShowcaseWork,
  reviewAdminShowcaseWork,
  updateAdminShowcaseWork
} from "./db/showcase.js";
import { testImageModelConnection } from "./providers/dashscopeImage.js";
import { testVideoModelConnection } from "./providers/video.js";
import { listVisualPipelines, testVisualPipeline } from "./providers/visualPipelineRegistry.js";
import { generationQueue, generationQueueEvents, queueConnection, startGenerationWorker, getGenerationWorkerReady } from "./queue/generationQueue.js";
import { enqueueCreationTask, recoverCreationDispatches } from "./queue/creationDispatch.js";
import { syncContentToProduction } from "./content/service.js";
import { ensureStorageBuckets, storageRoot } from "./storage/objectStorage.js";
import { MEDIA_COOKIE, localMediaPath, isPublishedMedia, userCanReadMedia, resolveMediaSession, verifyProviderMediaUrl } from "./storage/mediaAccess.js";
import { handleActivateEpisodeVersion, handleAddSource, handleAnalyzeContentProject, handleConfirmContentOutline, handleCreateContentProject, handleDeleteContentProject, handleDevelopContentProject, handleGenerateContentChapterBatch, handleGenerateContentOutline, handleGenerateContentPackage, handleGenerateEpisodes, handleGetContentPackage, handleGetContentVersions, handleListEpisodes, handleListEpisodeVersions, handleListContentProjects, handleRegenerateEpisode, handleUpdateContentChapter, handleUpdateContentModelRoute } from "./content/routes.js";

const app = express();
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY, process.env.NODE_ENV === "production"));
const port = Number(process.env.API_PORT ?? 4000);

function parseTrustProxy(raw: string | undefined, productionDefault: boolean): boolean | number | string {
  const value = raw?.trim();
  if (!value) return productionDefault ? 1 : false;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
const authSessionTtlDays = Number(process.env.AUTH_SESSION_TTL_DAYS ?? 30);
const rateLimitWindowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS ?? 60_000);
const rateLimitMax = Number(process.env.API_RATE_LIMIT_MAX ?? 180);
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const isProduction = process.env.NODE_ENV === "production";
const mockPaymentEnabled = process.env.ENABLE_MOCK_PAYMENT === "true" || !isProduction;

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Request-ID", crypto.randomUUID());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-Frame-Options", "DENY");
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true
  })
);
app.use(express.json({ limit: "12mb" }));
app.use(
  "/storage",
  asyncRoute(async (req, res, next) => {
    const path = localMediaPath(`/storage${req.path}`);
    if (!path) return res.status(404).json({ message: "文件不存在" });
    const publicMedia = await isPublishedMedia(path);
    const signed = await verifyProviderMediaUrl(path, req.query.expires, req.query.signature);
    if (!publicMedia && !signed) {
      const user = await resolveMediaSession(req.headers.cookie) || await resolveAuthUser(req);
      if (!user || (user.role !== "admin" && !(await userCanReadMedia(user.id, path)))) {
        return res.status(404).json({ message: "文件不存在或无权访问" });
      }
    }
    res.setHeader("Cache-Control", "private, no-store");
    next();
  }),
  express.static(storageRoot, { fallthrough: false, index: false, cacheControl: false, dotfiles: "deny" })
);

app.use((req, res, next) => {
  if (req.path === "/health" || req.path === "/ready") return next();
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
  targetEpisodes: z.coerce.number().int().min(1).max(100).optional(),
  textProvider: z.string().optional(),
  textModel: z.string().optional(),
  imageProvider: z.string().optional(),
  imageModel: z.string().optional(),
  imageSize: z.string().optional(),
  imageQuality: z.string().optional(),
  videoProvider: z.string().optional(),
  videoModel: z.string().optional(),
  episodeScripts: z.array(z.object({ episodeNo: z.number().int().positive(), title: z.string(), content: z.string() })).optional(),
  entityHints: z.object({ characters: z.array(z.string()).optional(), scenes: z.array(z.string()).optional(), props: z.array(z.string()).optional() }).optional()
});

const creationStartSchema = createProjectSchema.extend({
  maxCredits: z.number().finite().nonnegative(),
  requestId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/)
});

const projectRouteUpdateSchema = z.object({
  textProvider: z.string().nullable().optional(),
  textModel: z.string().nullable().optional(),
  imageProvider: z.string().nullable().optional(),
  imageModel: z.string().nullable().optional(),
  imageSize: z.string().nullable().optional(),
  imageQuality: z.string().nullable().optional(),
  videoProvider: z.string().nullable().optional(),
  videoModel: z.string().nullable().optional(),
  segmentProfile: z.enum(["jimeng_15s", "doubao_10s"]).optional()
});

const registerSchema = z.object({
  name: z.string().optional(),
  // 手机号改为选填：支持 QQ 邮箱等纯邮箱注册；填了就必须是合法手机号。
  phone: z.union([z.string().regex(/^1[3-9]\d{9}$/, "请输入 11 位中国大陆手机号"), z.literal("")]).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(1024)
});

const loginSchema = z.object({
  account: z.string().min(1),
  password: z.string().min(6).max(1024)
});

const profileUpdateSchema = z.object({
  name: z.string().trim().min(1, "用户名不能为空").max(40, "用户名最多 40 个字符").optional(),
  email: z.string().trim().email("请输入有效邮箱").max(120, "邮箱最多 120 个字符").optional(),
  avatarUrl: z.string().max(120_000, "头像文件过大").nullable().optional(),
  currentPassword: z.string().min(1, "请输入当前密码").optional()
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  newPassword: z.string().min(8, "新密码至少 8 个字符").max(72, "新密码最多 72 个字符")
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
  description: z.string().default(""),
  requestId: z.string().trim().min(1).max(128)
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
  type: z.enum(["tts", "subtitle", "video_export"]),
  storyboardIds: z.array(z.string().min(1)).min(1).max(2000).optional(),
  maxCredits: z.number().int().nonnegative().optional()
});

const adminUserUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["creator", "admin"]).optional(),
  status: z.enum(["active", "disabled"]).optional()
});

const adminUserCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().regex(/^1[3-9]\d{9}$/, "请输入 11 位中国大陆手机号").optional(),
  password: z.string().min(12).max(1024),
  role: z.enum(["creator", "admin"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  initialCredits: z.coerce.number().int().min(0).optional()
});

const resetPasswordSchema = z.object({
  password: z.string().min(12).max(1024)
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

const storyboardTailFrameSchema = z.object({
  frameUrl: z.string().min(1).max(12_000_000),
  sourceVideoUrl: z.string().min(1).max(12_000)
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

const videoGenerateSchema = z.object({
  storyboardIds: z.array(z.string()).min(1).max(20).optional(),
  regenerate: z.boolean().optional()
});

const evaluationStageSchema = z.enum(["script", "character", "storyboard", "image", "video"]);

const qualityReportGenerateSchema = z.object({
  stages: z.array(evaluationStageSchema).optional()
});

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

const announcementTypeSchema = z.enum(["info", "guide", "update", "warning"]);

const announcementCreateSchema = z.object({
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(600),
  type: announcementTypeSchema.default("info"),
  enabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional()
});

const announcementUpdateSchema = announcementCreateSchema.partial();

const supportRequestIdSchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const supportVersionSchema = z.number().int().min(1).max(2_147_483_646);
const supportBodySchema = z.string().trim().min(1).max(5000).refine(value => !value.includes("\0"), "正文不能包含空字符");
const supportCreateSchema = z.object({ requestId: supportRequestIdSchema, subject: z.string().trim().min(1).max(120),
  category: z.enum(["account", "billing", "generation", "export", "other"]), body: supportBodySchema }).strict();
const supportReplySchema = z.object({ requestId: supportRequestIdSchema, expectedVersion: supportVersionSchema, body: supportBodySchema }).strict();
const supportCloseSchema = z.object({ expectedVersion: supportVersionSchema }).strict();
const supportListSchema = z.object({ page: z.coerce.number().int().min(1).max(100_000).optional(), pageSize: z.coerce.number().int().min(1).max(50).optional(),
  status: z.enum(["open", "answered", "closed"]).optional() });

const helpArticleCategorySchema = z.enum(["getting_started", "workflow", "billing", "account", "troubleshooting", "community"]);

const helpArticleCreateSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().max(160).optional(),
  content: z.string().min(1).max(3000),
  category: helpArticleCategorySchema.default("getting_started"),
  tags: z.array(z.string().max(24)).max(8).optional(),
  enabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional()
});

const helpArticleUpdateSchema = helpArticleCreateSchema.partial();

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
  promptVersionId: z.string().max(120).optional(),
  generationPromptVersionId: z.string().max(120).optional(),
  maxLlmCalls: z.coerce.number().int().min(0).max(50).optional(),
  maxShotsPerPrompt: z.coerce.number().int().min(1).max(25).optional(),
  includeFeedback: z.boolean().optional()
});

const promptVersionCreateSchema = z.object({
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(100),
  stage: evaluationStageSchema,
  purpose: z.enum(["generation", "evaluation"]),
  version: z.string().trim().min(1).max(40),
  content: z.string().trim().min(1).max(20_000),
  status: z.enum(["draft", "active", "archived"]).optional(),
  owner: z.string().max(80).optional(),
  notes: z.string().max(800).optional()
});

const promptVersionUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  content: z.string().trim().min(1).max(20_000).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  owner: z.string().max(80).nullable().optional(),
  notes: z.string().max(800).optional()
});

const experimentRunCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  stage: evaluationStageSchema,
  hypothesis: z.string().trim().min(1).max(1000),
  experimentType: z.enum(["model", "prompt", "combined"]),
  baselineRunId: z.string().min(1).max(120),
  candidateRunId: z.string().min(1).max(120),
  successMetric: z.string().max(200).optional()
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

const showcaseCreateSchema = z.object({
  projectId: z.string().min(1),
  sourceAssetId: z.string().min(1).optional(),
  videoUrl: z.string().min(1).max(2048).optional(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1200).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  coverUrl: z.string().trim().max(2048).optional(),
  durationLabel: z.string().trim().max(20).optional()
}).refine((data) => Boolean(data.sourceAssetId || data.videoUrl), { message: "请选择视频资产或 MP4 导出文件。" });

const showcaseAdminUpdateSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1200).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  authorName: z.string().trim().max(80).optional(),
  coverUrl: z.string().trim().min(1).max(2048).optional(),
  videoUrl: z.string().trim().min(1).max(2048).optional(),
  durationLabel: z.string().trim().max(20).optional(),
  featured: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional()
});

const showcaseReviewSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).optional()
}).refine(data => data.decision !== "reject" || Boolean(data.note?.trim()), { message: "请填写驳回原因。", path: ["note"] });

const paramId = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value ?? "");

function toAnnouncementPayload(data: z.infer<typeof announcementCreateSchema>) {
  return {
    ...data,
    startsAt: data.startsAt === undefined ? undefined : data.startsAt ? new Date(data.startsAt) : null,
    endsAt: data.endsAt === undefined ? undefined : data.endsAt ? new Date(data.endsAt) : null
  };
}

function toAnnouncementUpdatePayload(data: z.infer<typeof announcementUpdateSchema>) {
  return {
    ...data,
    startsAt: data.startsAt === undefined ? undefined : data.startsAt ? new Date(data.startsAt) : null,
    endsAt: data.endsAt === undefined ? undefined : data.endsAt ? new Date(data.endsAt) : null
  };
}

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
  handler: (req: TReq, res: TRes, next: express.NextFunction) => Promise<unknown>
) {
  return (req: TReq, res: TRes, next: express.NextFunction) => {
    void (async () => {
      const actor = requestAuthUser(req);
      const audited = actor && !["GET", "HEAD", "OPTIONS"].includes(req.method)
        && (req.path.startsWith("/api/admin/") || req.path.startsWith("/api/settings/"));
      // Persist the intent before any administrator mutation. A process crash
      // leaves a visible unfinished record instead of silently losing history.
      const audit = audited ? await beginAdminAudit({ actorId: actor.id, actorRole: actor.role,
        // Ticket transcripts remain only in their access-controlled message table, never the admin audit payload.
        method: req.method, path: req.path, body: req.path.startsWith("/api/admin/support/tickets") ? {} : req.body, ip: req.ip }) : null;
      if (audit) {
        // The error middleware can map a thrown error to 409/404/503. Record
        // the actual response, never a guessed 500 before that mapping runs.
        // A disconnect before finish remains "started" for operator review.
        res.once("finish", () => {
          void finishAdminAudit(audit.id, res.statusCode).catch(error => console.error("[audit] completion pending", audit.id, error));
        });
      }
      await handler(req, res, next);
    })().catch(next);
  };
}

function hashAuthToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionExpiresAt() {
  const ttlMs = Math.max(1, authSessionTtlDays) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ttlMs);
}

async function issueToken(userId: string, req: express.Request, expectedPasswordHash?: string) {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== "active" || (expectedPasswordHash && user.passwordHash !== expectedPasswordHash)) {
      throw new Error("账号状态或密码已发生变化，请重新登录。");
    }
    await tx.authSession.create({ data: {
      id: `session_${crypto.randomUUID()}`, userId, tokenHash: hashAuthToken(token),
      userAgent: req.get("user-agent")?.slice(0, 500), ipAddress: req.ip, expiresAt: sessionExpiresAt()
    } });
  });
  return token;
}

function setMediaCookie(res: express.Response, token: string) {
  res.cookie(MEDIA_COOKIE, token, { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/storage" });
}

function bearerToken(req: express.Request) {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function publicUser(user: { id: string; name: string; email?: string | null; phone?: string | null; avatarUrl?: string | null; role: string; status: string }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? undefined,
    phone: user.phone ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
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
  const configuredCredits = Number(process.env.REGISTRATION_CREDITS ?? (isProduction ? 0 : 1000));
  const starterCredits = Number.isSafeInteger(configuredCredits) && configuredCredits >= 0 ? configuredCredits : 0;
  await prisma.creditAccount.upsert({
    where: { userId },
    update: {},
    create: {
      id: `credit_${userId}`,
      userId,
      balance: starterCredits,
      frozenBalance: 0,
      totalRecharge: starterCredits,
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

let catalogReady = false;
app.get("/ready", asyncRoute(async (_req, res) => {
  const database = prisma.$queryRaw`SELECT 1`;
  const results = await Promise.allSettled([
    Promise.race([database, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("Database readiness timeout")), 3000);
      timer.unref();
      void database.finally(() => clearTimeout(timer)).catch(() => undefined);
    })]),
    pingRedis()
  ]);
  const checks = {
    database: results[0].status === "fulfilled",
    redis: results[1].status === "fulfilled",
    worker: getGenerationWorkerReady(),
    catalog: catalogReady
  };
  const ok = Object.values(checks).every(Boolean);
  res.setHeader("Cache-Control", "no-store");
  res.status(ok ? 200 : 503).json({ ok, checks, revision: process.env.APP_REVISION || "development" });
}));

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
    const includeDetails = process.env.API_HEALTH_DETAILS === "true" || !isProduction;
    res.status(ok ? 200 : 503).json(includeDetails ? { ok, checks, errors } : { ok, checks });
  })
);

app.post(
  "/api/auth/register",
  asyncRoute(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const email = parsed.data.email.trim().toLowerCase();
    const phone = parsed.data.phone?.trim() || null;
    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] } });
    if (existing?.email === email) return res.status(409).json({ message: "该邮箱已注册，请直接登录。" });
    if (phone && existing?.phone === phone) return res.status(409).json({ message: "该手机号已注册，请直接登录。" });

    const user = await prisma.user.create({
      data: {
        id: `user_${crypto.randomUUID()}`,
        name: parsed.data.name?.trim() || (phone ? `用户${phone.slice(-4)}` : email.split("@")[0].slice(0, 20) || "创作者"),
        email,
        phone,
        passwordHash: await hashPassword(parsed.data.password),
        role: "creator",
        status: "active"
      }
    });

    await ensureCreditForUser(user.id);
    const token = await issueToken(user.id, req, user.passwordHash ?? undefined);
    setMediaCookie(res, token);
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
    if (user.status !== "active") return res.status(403).json({ message: "账号已停用，请联系平台支持。" });

    await ensureCreditForUser(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = await issueToken(user.id, req, user.passwordHash ?? undefined);
    setMediaCookie(res, token);
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
    setMediaCookie(res, bearerToken(req));
    res.json({ user: publicUser(user) });
  })
);

app.use("/api/content", (req, res, next) => {
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

app.get("/api/content/projects", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.json(await handleListContentProjects(userId));
}));

app.post("/api/content/projects", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.status(201).json(await handleCreateContentProject(userId, req.body));
}));

app.post("/api/content/projects/:id/sources", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.status(201).json(await handleAddSource(userId, paramId(req.params.id), req.body));
}));

app.get("/api/content/projects/:id/package", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.json(await handleGetContentPackage(userId, paramId(req.params.id)));
}));

app.get("/api/content/projects/:id/versions", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.json(await handleGetContentVersions(userId, paramId(req.params.id)));
}));

app.post("/api/content/projects/:id/production/sync", asyncRoute(async (req, res) => {
  const productionProjectId = await syncContentToProduction(requestUserId(req)!, paramId(req.params.id));
  res.json({ productionProjectId });
}));

app.post("/api/content/projects/:id/generate", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.json(await handleGenerateContentPackage(userId, paramId(req.params.id), req.body));
}));

app.get("/api/content/projects/:id/episodes", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.json(await handleListEpisodes(userId, paramId(req.params.id)));
}));

app.post("/api/content/projects/:id/episodes/generate", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.json(await handleGenerateEpisodes(userId, paramId(req.params.id), req.body));
}));

app.post("/api/content/projects/:id/episodes/:episodeNo/regenerate", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.json(await handleRegenerateEpisode(userId, paramId(req.params.id), Number(req.params.episodeNo)));
}));

app.get("/api/content/projects/:id/episodes/:episodeNo/versions", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.json(await handleListEpisodeVersions(userId, paramId(req.params.id), Number(req.params.episodeNo)));
}));

app.post("/api/content/projects/:id/episodes/:episodeNo/versions/:version/activate", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.json(await handleActivateEpisodeVersion(userId, paramId(req.params.id), Number(req.params.episodeNo), Number(req.params.version)));
}));

app.post("/api/content/projects/:id/develop", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  try {
    res.json(await handleDevelopContentProject(userId, paramId(req.params.id), req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "模型生成失败";
    res.status(422).json({ message: "内容生成失败", detail: message });
  }
}));

app.post("/api/content/projects/:id/analyze", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  try { res.json(await handleAnalyzeContentProject(userId, paramId(req.params.id), req.body)); }
  catch (error) { res.status(422).json({ message: "结构拆解失败", detail: error instanceof Error ? error.message : "模型生成失败" }); }
}));

app.post("/api/content/projects/:id/outline/generate", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  try { res.json(await handleGenerateContentOutline(userId, paramId(req.params.id))); }
  catch (error) { res.status(422).json({ message: "大纲生成失败", detail: error instanceof Error ? error.message : "模型生成失败" }); }
}));

app.post("/api/content/projects/:id/outline/confirm", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  try { res.json(await handleConfirmContentOutline(userId, paramId(req.params.id), req.body)); }
  catch (error) { res.status(422).json({ message: "大纲确认失败", detail: error instanceof Error ? error.message : "保存失败" }); }
}));

app.patch("/api/content/projects/:id/model-route", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  res.json(await handleUpdateContentModelRoute(userId, paramId(req.params.id), req.body));
}));

app.patch("/api/content/projects/:id/chapters/:chapterNo", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  const chapterNo = Number(req.params.chapterNo);
  if (!Number.isInteger(chapterNo) || chapterNo < 1) return res.status(400).json({ message: "章节号不合法" });
  res.json(await handleUpdateContentChapter(userId, paramId(req.params.id), chapterNo, req.body));
}));

app.post("/api/content/projects/:id/chapters/generate", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  try {
    res.json(await handleGenerateContentChapterBatch(userId, paramId(req.params.id), req.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "章节生成失败";
    res.status(422).json({ message: "章节生成失败", detail: message });
  }
}));

app.delete("/api/content/projects/:id", asyncRoute(async (req, res) => {
  const userId = requestUserId(req);
  if (!userId) return res.status(401).json({ message: "请先登录。" });
  await handleDeleteContentProject(userId, paramId(req.params.id));
  res.status(204).end();
}));

app.patch(
  "/api/auth/profile",
  asyncRoute(async (req, res) => {
    const authUser = await resolveAuthUser(req);
    if (!authUser) return res.status(401).json({ message: "登录已过期，请重新登录。" });
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const data: { name?: string; email?: string; avatarUrl?: string | null } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.avatarUrl !== undefined) data.avatarUrl = parsed.data.avatarUrl || null;

    if (parsed.data.email !== undefined) {
      const nextEmail = parsed.data.email.trim().toLowerCase();
      if (!parsed.data.currentPassword) return res.status(400).json({ message: "修改邮箱需要输入当前密码。" });

      const currentUser = await prisma.user.findUnique({ where: { id: authUser.id } });
      if (!currentUser) return res.status(401).json({ message: "用户不存在，请重新登录。" });
      const validPassword = await verifyPassword(parsed.data.currentPassword, currentUser.passwordHash);
      if (!validPassword) return res.status(400).json({ message: "当前密码不正确，无法修改邮箱。" });

      const existingEmail = await prisma.user.findFirst({
        where: { email: nextEmail, id: { not: authUser.id } },
        select: { id: true }
      });
      if (existingEmail) return res.status(409).json({ message: "该邮箱已绑定其他账号。" });
      data.email = nextEmail;
    }

    const user = await prisma.user.update({
      where: { id: authUser.id },
      data
    });

    res.json({ user: publicUser(user) });
  })
);

app.post(
  "/api/projects/:id/storyboards/:shotId/tail-frame",
  asyncRoute(async (req, res) => {
    const parsed = storyboardTailFrameSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await captureStoryboardTailFrame(paramId(req.params.id), paramId(req.params.shotId), requestUserId(req), parsed.data.frameUrl, parsed.data.sourceVideoUrl));
  })
);

app.post(
  "/api/auth/password",
  asyncRoute(async (req, res) => {
    const authUser = await resolveAuthUser(req);
    if (!authUser) return res.status(401).json({ message: "登录已过期，请重新登录。" });
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const user = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (!user) return res.status(401).json({ message: "用户不存在，请重新登录。" });
    const validPassword = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!validPassword) return res.status(400).json({ message: "当前密码不正确。" });

    const token = bearerToken(req);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(parsed.data.newPassword) }
      }),
      prisma.authSession.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
          ...(token ? { tokenHash: { not: hashAuthToken(token) } } : {})
        },
        data: { revokedAt: new Date() }
      })
    ]);

    res.json({ ok: true });
  })
);

app.post(
  "/api/auth/logout",
  asyncRoute(async (req, res) => {
    res.clearCookie(MEDIA_COOKIE, { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/storage" });
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

app.get(
  "/api/help/articles",
  asyncRoute(async (_req, res) => {
    res.json(await listPublicHelpArticles());
  })
);

app.get(
  "/api/showcase/works",
  asyncRoute(async (req, res) => {
    res.json(await listPublicShowcaseWorks({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 20),
      keyword: String(req.query.keyword ?? ""),
      category: String(req.query.category ?? "全部")
    }));
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

app.get("/api/admin/content-projects", asyncRoute(async (_req, res) => {
  const rows = await prisma.contentProject.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      _count: { select: { sources: true, analyses: true, outlines: true, chapters: true, scripts: true } }
    }
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.userId))] } }, select: { id: true, name: true, email: true } });
  const userMap = new Map(users.map((user) => [user.id, user]));
  res.json(rows.map((row) => ({ id: row.id, title: row.title, mode: row.mode, status: row.status, activeStep: row.activeStep, styleProfile: row.styleProfile, updatedAt: row.updatedAt.toISOString(), user: userMap.get(row.userId), counts: row._count })));
}));

app.get(
  "/api/showcase/mine",
  asyncRoute(async (req, res) => {
    res.json(await listCreatorShowcaseWorks(requestUserId(req)!, typeof req.query.projectId === "string" ? req.query.projectId : undefined));
  })
);

app.post(
  "/api/showcase/works",
  asyncRoute(async (req, res) => {
    const parsed = showcaseCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const coverPath = parsed.data.coverUrl ? localMediaPath(parsed.data.coverUrl) : undefined;
    if (coverPath && !(await userCanReadMedia(requestUserId(req)!, coverPath))) {
      return res.status(403).json({ message: "只能发布本人项目中的私有素材" });
    }
    res.status(201).json(await createCreatorShowcaseWork(requestUserId(req)!, parsed.data));
  })
);

app.post(
  "/api/showcase/works/:id/submit",
  asyncRoute(async (req, res) => {
    const hasRevision = req.body && Object.keys(req.body).length > 0;
    const parsed = hasRevision ? showcaseCreateSchema.safeParse(req.body) : undefined;
    if (parsed && !parsed.success) return res.status(400).json(parsed.error.flatten());
    const revision = parsed?.success ? parsed.data : undefined;
    const coverPath = revision?.coverUrl ? localMediaPath(revision.coverUrl) : undefined;
    if (coverPath && !(await userCanReadMedia(requestUserId(req)!, coverPath))) {
      return res.status(403).json({ message: "只能发布本人项目中的私有素材" });
    }
    res.json(await resubmitCreatorShowcaseWork(requestUserId(req)!, paramId(req.params.id), revision));
  })
);

app.get(
  "/api/admin/showcase/works",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    res.json(await listAdminShowcaseWorks({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 20),
      keyword: String(req.query.keyword ?? ""),
      status: String(req.query.status ?? "all")
    }));
  })
);

app.patch(
  "/api/admin/showcase/works/:id",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const parsed = showcaseAdminUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updateAdminShowcaseWork(paramId(req.params.id), parsed.data));
  })
);

app.post(
  "/api/admin/showcase/works/:id/review",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const parsed = showcaseReviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await reviewAdminShowcaseWork(paramId(req.params.id), parsed.data.decision, parsed.data.note ?? "", parsed.data.expectedUpdatedAt));
  })
);

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
  (_req, res) => res.status(410).json({ message: "批量清理旧项目已停用。请在作品列表逐项删除，任务与积分流水会保留。" })
);

app.get(
  "/api/projects/:id",
  asyncRoute(async (req, res) => {
    const workflow = await getProjectWorkflow(paramId(req.params.id), requestUserId(req));
    if (!workflow) return res.status(404).json({ message: "项目不存在" });
    res.json({ project: workflow.project, storyboards: workflow.storyboards });
  })
);

app.delete("/api/projects/:id", asyncRoute(async (req, res) => {
  res.json(await deleteProject(paramId(req.params.id), requestUserId(req)));
}));

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
      videoModel: parsed.data.videoModel ?? undefined,
      segmentProfile: parsed.data.segmentProfile
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
    const parsed = qualityReportGenerateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await generateProjectQualityReports(paramId(req.params.id), requestUserId(req), parsed.data.stages));
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
  "/api/projects/:id/scenes/:assetId/image/generate",
  asyncRoute(async (req, res) => {
    res.json(await generateSceneEnvironmentImage(paramId(req.params.id), paramId(req.params.assetId), requestUserId(req)));
  })
);

app.post(
  "/api/projects/:id/characters/:characterId/reference",
  asyncRoute(async (req, res) => {
    const parsed = characterReferenceSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const localReference = localMediaPath(parsed.data.referenceUrl);
    if (localReference && !(await userCanReadMedia(requestUserId(req)!, localReference))) {
      return res.status(403).json({ message: "只能引用本人项目中的私有素材" });
    }
    if (localReference) parsed.data.referenceUrl = localReference;
    res.json(await setCharacterReferenceImageV2(paramId(req.params.id), paramId(req.params.characterId), requestUserId(req), parsed.data));
  })
);

app.delete(
  "/api/projects/:id/characters/:characterId/reference",
  asyncRoute(async (req, res) => {
    res.json(await deleteCharacterReferenceImageV2(paramId(req.params.id), paramId(req.params.characterId), requestUserId(req)));
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
    const parsed = videoGenerateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await runProjectVideoTasks(paramId(req.params.id), requestUserId(req), parsed.data));
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

app.get(
  "/api/projects/:id/storyboard-production-package",
  asyncRoute(async (req, res) => {
    res.json(await getStoryboardProductionPackage(paramId(req.params.id), requestUserId(req)));
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

app.post("/api/projects/:id/exports/quote", asyncRoute(async (req, res) => {
  const parsed = exportJobCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  res.json(await quoteProjectExport(paramId(req.params.id), requestUserId(req)!, parsed.data.type, parsed.data.storyboardIds));
}));

app.post(
  "/api/projects/:id/export/jobs",
  asyncRoute(async (req, res) => {
    const parsed = exportJobCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createProjectExportJob(paramId(req.params.id), requestUserId(req), parsed.data.type, parsed.data.storyboardIds, parsed.data.maxCredits));
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
        sourceType: true,
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
    res.json(await quoteCreationStart(parsed.data));
  })
);

app.post(
  "/api/creation/start",
  asyncRoute(async (req, res) => {
    const parsed = creationStartSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());

    const userId = requestUserId(req)!;
    const { projectId, taskId, task, estimate, replayed } = await createProjectAndTask(parsed.data, userId, parsed.data.maxCredits);

    // The request and reservation already exist in PostgreSQL. A failed Redis
    // dispatch stays pending and is recovered by the outbox loop.
    const job = await enqueueCreationTask(taskId).catch(() => undefined);

    const result = (await (job ? job.waitUntilFinished(generationQueueEvents, 60_000).catch(() => ({ mode: "queued" })) : Promise.resolve({ mode: "queued" }))) as {
      mode?: "real" | "local" | "queued";
    };
    const workflow = await getProjectWorkflow(projectId, userId);
    res.status(replayed ? 200 : 201).json({ project: workflow?.project, task, estimate, mode: result.mode ?? "queued", replayed });
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
    if (/^(content|media):/.test(task.jobId ?? "")) return res.status(409).json({ message: "请回到对应创作步骤继续生成，视频会优先查询已有任务结果。" });

    if (task.type === "text") {
      const originalJob = !task.requestPayload && task.jobId ? await generationQueue.getJob(task.jobId) : null;
      if (!originalJob?.data && !task.requestPayload) {
        return res.status(409).json({ message: "该文本任务缺少队列快照，无法自动重试。请新建项目或重新提交剧本。" });
      }
      const storedInput = task.requestPayload as unknown as import("@aifilm/shared").CreateProjectInput | null;
      const originalInput = storedInput || originalJob!.data.input;
      // Retries retain the original model and quoted task budget. Changing the
      // project's route must not silently change an existing task's purchase.
      const retryInput = originalInput;
      const updated = await retryTask(taskId, userId, retryInput);
      await enqueueCreationTask(taskId).catch(() => undefined);
      return res.json(updated);
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
    if (!mockPaymentEnabled) return res.status(404).json({ message: "Mock payment callback is disabled." });
    const parsed = rechargeCallbackSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await handleRechargeCallback({ ...parsed.data, userId: requestUserId(req), payload: parsed.data.payload ?? req.body }));
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
  asyncRoute(async (req, res) => {
    res.json(await listProviders(requestAuthUser(req)?.role === "admin"));
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
  requireAdminPermission("models:manage"),
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
  requireAdminPermission("models:manage"),
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
  requireAdminPermission("models:manage"),
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
    const providers = await listProviders(true);
    res.json(createRelayGatewayPolicy(providers));
  })
);

app.get(
  "/api/admin/plugins/visual-pipelines",
  requireAdminPermission("models:manage"),
  asyncRoute(async (_req, res) => {
    const providers = await listProviders(true);
    res.json(listVisualPipelines(providers));
  })
);

app.post(
  "/api/admin/plugins/visual-pipelines/test",
  requireAdminPermission("models:manage"),
  asyncRoute(async (req, res) => {
    const parsed = visualPipelineTestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    const providers = await listProviders(true);
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

app.get("/api/support/tickets", asyncRoute(async (req, res) => {
  const parsed = supportListSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "工单列表查询参数无效。" });
  res.json(await listSupportTickets({ id: requestUserId(req)! }, parsed.data));
}));

app.post("/api/support/tickets", asyncRoute(async (req, res) => {
  const parsed = supportCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "请检查问题标题、分类、正文和提交标识。" });
  const result = await createSupportTicket(requestUserId(req)!, parsed.data);
  res.status(result.replayed ? 200 : 201).json(result);
}));

app.get("/api/support/tickets/:id", asyncRoute(async (req, res) => {
  res.json(await getSupportTicket({ id: requestUserId(req)! }, paramId(req.params.id)));
}));

app.post("/api/support/tickets/:id/messages", asyncRoute(async (req, res) => {
  const parsed = supportReplySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "请检查回复正文、工单版本和提交标识。" });
  res.json(await replySupportTicket({ id: requestUserId(req)! }, paramId(req.params.id), parsed.data));
}));

app.post("/api/support/tickets/:id/close", asyncRoute(async (req, res) => {
  const parsed = supportCloseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "工单版本无效，请刷新后重试。" });
  res.json(await closeSupportTicket({ id: requestUserId(req)! }, paramId(req.params.id), parsed.data));
}));

app.get("/api/admin/support/tickets", requireAdminPermission("support:read"), asyncRoute(async (req, res) => {
  const parsed = supportListSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "工单列表查询参数无效。" });
  res.json(await listSupportTickets({ id: requestUserId(req)!, staff: true }, parsed.data));
}));

app.get("/api/admin/support/tickets/:id", requireAdminPermission("support:read"), asyncRoute(async (req, res) => {
  res.json(await getSupportTicket({ id: requestUserId(req)!, staff: true }, paramId(req.params.id)));
}));

app.post("/api/admin/support/tickets/:id/messages", requireAdminPermission("support:manage"), asyncRoute(async (req, res) => {
  const parsed = supportReplySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "请检查回复正文、工单版本和提交标识。" });
  res.json(await replySupportTicket({ id: requestUserId(req)!, staff: true }, paramId(req.params.id), parsed.data));
}));

app.post("/api/admin/support/tickets/:id/close", requireAdminPermission("support:manage"), asyncRoute(async (req, res) => {
  const parsed = supportCloseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "工单版本无效，请刷新后重试。" });
  res.json(await closeSupportTicket({ id: requestUserId(req)!, staff: true }, paramId(req.params.id), parsed.data));
}));

app.get(
  "/api/admin/announcements",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (_req, res) => {
    res.json(await listAdminAnnouncements());
  })
);

app.post(
  "/api/admin/announcements",
  requireAdminPermission("announcements:manage"),
  asyncRoute(async (req, res) => {
    const parsed = announcementCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createPlatformAnnouncement(toAnnouncementPayload(parsed.data)));
  })
);

app.patch(
  "/api/admin/announcements/:id",
  requireAdminPermission("announcements:manage"),
  asyncRoute(async (req, res) => {
    const parsed = announcementUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updatePlatformAnnouncement(paramId(req.params.id), toAnnouncementUpdatePayload(parsed.data)));
  })
);

app.delete(
  "/api/admin/announcements/:id",
  requireAdminPermission("announcements:manage"),
  asyncRoute(async (req, res) => {
    res.json(await deletePlatformAnnouncement(paramId(req.params.id)));
  })
);

app.get(
  "/api/admin/help-articles",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (_req, res) => {
    res.json(await listAdminHelpArticles());
  })
);

app.post(
  "/api/admin/help-articles",
  requireAdminPermission("announcements:manage"),
  asyncRoute(async (req, res) => {
    const parsed = helpArticleCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createHelpArticle(parsed.data));
  })
);

app.patch(
  "/api/admin/help-articles/:id",
  requireAdminPermission("announcements:manage"),
  asyncRoute(async (req, res) => {
    const parsed = helpArticleUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updateHelpArticle(paramId(req.params.id), parsed.data));
  })
);

app.delete(
  "/api/admin/help-articles/:id",
  requireAdminPermission("announcements:manage"),
  asyncRoute(async (req, res) => {
    res.json(await deleteHelpArticle(paramId(req.params.id)));
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
  "/api/admin/quality-center",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (_req, res) => {
    res.json(await getAdminQualityCenter());
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

app.get(
  "/api/admin/evaluation/datasets/page",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    res.json(await listEvaluationDatasetsPage({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 20),
      keyword: String(req.query.keyword ?? "")
    }));
  })
);

app.post(
  "/api/admin/evaluation/datasets",
  requireAdminPermission("evaluation:manage"),
  asyncRoute(async (req, res) => {
    const parsed = evaluationDatasetCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createEvaluationDataset(parsed.data));
  })
);

app.delete(
  "/api/admin/evaluation/datasets/:id",
  requireAdminPermission("evaluation:manage"),
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
  "/api/admin/evaluation/runs/page",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    res.json(await listEvaluationRunsPage({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 20),
      keyword: String(req.query.keyword ?? ""),
      status: String(req.query.status ?? "all")
    }));
  })
);

app.get(
  "/api/admin/evaluation/prompt-versions",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    res.json(await listPromptVersionsPage({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 20),
      keyword: String(req.query.keyword ?? ""),
      stage: String(req.query.stage ?? "all"),
      status: String(req.query.status ?? "all"),
      purpose: String(req.query.purpose ?? "all")
    }));
  })
);

app.post(
  "/api/admin/evaluation/prompt-versions",
  requireAdminPermission("evaluation:manage"),
  asyncRoute(async (req, res) => {
    const parsed = promptVersionCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createPromptVersion(parsed.data));
  })
);

app.patch(
  "/api/admin/evaluation/prompt-versions/:id",
  requireAdminPermission("evaluation:manage"),
  asyncRoute(async (req, res) => {
    const parsed = promptVersionUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updatePromptVersion(paramId(req.params.id), parsed.data));
  })
);

app.get(
  "/api/admin/evaluation/experiments",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    res.json(await listExperimentRunsPage({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 20),
      keyword: String(req.query.keyword ?? ""),
      stage: String(req.query.stage ?? "all")
    }));
  })
);

app.post(
  "/api/admin/evaluation/experiments",
  requireAdminPermission("evaluation:manage"),
  asyncRoute(async (req, res) => {
    const parsed = experimentRunCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.status(201).json(await createExperimentRun(parsed.data));
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
    const xlsx = await buildEvaluationRunsXlsx(details);
    const fileName = ids.length ? `evaluation-runs-${ids.length}` : "evaluation-runs-all";
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", contentDisposition(`${fileName}.xlsx`));
    res.send(xlsx);
  })
);

app.get(
  "/api/admin/evaluation/runs/export-excel.xlsx",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const ids = String(req.query.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const runs = await listEvaluationRuns();
    const selectedRuns = ids.length ? runs.filter((run) => ids.includes(run.id)) : runs;
    const details = (await Promise.all(selectedRuns.map((run) => getEvaluationRun(run.id)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof getEvaluationRun>>>[];
    const xlsx = await buildEvaluationRunsXlsx(details);
    const fileName = ids.length ? `evaluation-runs-${ids.length}` : "evaluation-runs-all";
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", contentDisposition(`${fileName}.xlsx`));
    res.send(xlsx);
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
    const xlsx = await buildEvaluationRunsXlsx([detail]);
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", contentDisposition(`${safeDownloadName(detail.run.name || detail.run.id)}.xlsx`));
    res.send(xlsx);
  })
);

app.get(
  "/api/admin/evaluation/runs/:id/export-excel.xlsx",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    const detail = await getEvaluationRun(paramId(req.params.id));
    if (!detail) return res.status(404).json({ message: "评测运行记录不存在。" });
    const xlsx = await buildEvaluationRunsXlsx([detail]);
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", contentDisposition(`${safeDownloadName(detail.run.name || detail.run.id)}.xlsx`));
    res.send(xlsx);
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

app.get(
  "/api/admin/feedback/page",
  requireAdminPermission("dashboard:read"),
  asyncRoute(async (req, res) => {
    res.json(await listAdminFeedbackPage({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 20),
      keyword: String(req.query.keyword ?? ""),
      stage: String(req.query.stage ?? "all"),
      status: String(req.query.status ?? "all")
    }));
  })
);

app.patch(
  "/api/admin/feedback/:id",
  requireAdminPermission("evaluation:manage"),
  asyncRoute(async (req, res) => {
    const parsed = feedbackUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(parsed.error.flatten());
    res.json(await updateAdminFeedback(paramId(req.params.id), parsed.data));
  })
);

app.delete(
  "/api/admin/evaluation/runs/:id",
  requireAdminPermission("evaluation:manage"),
  asyncRoute(async (req, res) => {
    res.json(await deleteEvaluationRun(paramId(req.params.id)));
  })
);

app.delete(
  "/api/admin/evaluation/projects/:id",
  requireAdminPermission("evaluation:manage"),
  asyncRoute(async (req, res) => {
    res.json(await deleteProjectQualityData(paramId(req.params.id)));
  })
);

app.post(
  "/api/admin/evaluation/run",
  requireAdminPermission("evaluation:manage"),
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

const adminPageQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  keyword: z.string().max(120).optional(), role: z.string().max(30).optional(),
  status: z.string().max(30).optional(), actorId: z.string().max(100).optional()
});
app.get("/api/admin/users/page", requireAdminPermission("users:read"), asyncRoute(async (req, res) => {
  const parsed = adminPageQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  res.json(await listAdminUsersPage(parsed.data));
}));
app.get("/api/admin/audit-logs", requireAdminPermission("audit:read"), asyncRoute(async (req, res) => {
  const parsed = adminPageQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  res.json(await listAdminAuditLogs({ ...parsed.data, status: parsed.data.status === "all" ? undefined : parsed.data.status }));
}));

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
    res.json(await updateAdminUser(paramId(req.params.id), parsed.data, requestUserId(req)));
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

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ProjectRequestError || error instanceof MediaSourceConflict || error instanceof AnnouncementScheduleError || error instanceof SupportTicketError) return res.status(error.status).json({ message: error.message });
  const message = error instanceof Error ? error.message : "服务器异常";
  const cause = error instanceof Error && "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
  const causeMessage = cause instanceof Error ? `${cause.name}: ${cause.message}` : typeof cause === "object" && cause ? JSON.stringify(cause).slice(0, 240) : "";
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  const operationalError = classifyOperationalError(message, causeMessage);

  console.error(`[api] ${req.method} ${req.path} failed`, {
    code: code || undefined,
    message,
    detail: causeMessage || undefined
  });

  if (
    code === "P1001" ||
    message.includes("Can't reach database") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ECONNRESET") ||
    message.includes("connection") ||
    causeMessage.includes("ConnectionReset") ||
    causeMessage.includes("ECONNREFUSED")
  ) {
    return res.status(503).json({ message: "服务暂时不可用，请稍后重试或联系管理员。" });
  }
  if (code === "P2002") {
    return res.status(409).json({ message: "数据已存在，请检查邮箱、兑换码或唯一配置是否重复。" });
  }
  if (code === "P2025") {
    return res.status(404).json({ message: "要操作的数据不存在或已被删除。" });
  }
  if (operationalError) {
    return res.status(operationalError.status).json({ message: operationalError.message });
  }

  if (isProduction) {
    return res.status(500).json({ message: "暂时无法完成操作，请稍后重试。" });
  }
  res.status(500).json({ message, detail: causeMessage || undefined });
});

function classifyOperationalError(message: string, detail: string) {
  const safeMessage = redactSensitiveText(message || detail || "请求处理失败");
  if (!safeMessage) return null;
  const clientErrorPatterns = [
    /积分|余额|额度|未定稿|请先|请选择|不存在|not found|Insufficient credits/i,
    /没有可用于|暂无|可播放|无法重试|不能取消|已成功任务/i,
    /模型|供应商|上游|渠道|未返回|超时|配置|prompt|URL|生成失败|测试失败/i
  ];
  if (!clientErrorPatterns.some((pattern) => pattern.test(safeMessage))) return null;
  const isUpstream = /模型|供应商|上游|渠道|未返回|超时|配置|URL|生成失败|测试失败/i.test(safeMessage);
  return { status: isUpstream ? 502 : 400, message: safeMessage };
}

function redactSensitiveText(value: string) {
  return value
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;&]+/gi, "$1***")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;&]+/gi, "$1***")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .slice(0, 360);
}

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
    "问题摘要",
    "修复建议",
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
          evaluationStageLabel(stage),
          "",
          "",
          "",
          "未生成",
          detail.run.errorReason ? "运行失败" : "等待结果",
          detail.run.errorReason ? "评测运行失败" : "待评测",
          "中",
          detail.run.errorReason ?? detail.run.skipped.map((item) => item.reason).join("；"),
          detail.run.errorReason ? "检查失败原因" : "等待评测结果",
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
        evaluationStageLabel(report.stage),
        report.provider ?? "",
        report.model ?? "",
        String(report.totalScore),
        report.pass ? "通过" : "未通过",
        rootCause,
        report.recommendedAction,
        evaluationSampleValue(report),
        report.problems.join("；"),
        report.suggestions.join("；"),
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

async function buildEvaluationRunsXlsx(details: Array<NonNullable<Awaited<ReturnType<typeof getEvaluationRun>>>>) {
  const { header, rows } = await buildEvaluationRunTable(details);
  return buildSimpleXlsx("评测情况", [header, ...rows]);
}

function buildSimpleXlsx(sheetName: string, rows: unknown[][]) {
  const safeSheetName = escapeXml(sheetName.slice(0, 31) || "Sheet1");
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const lastCell = `${columnName(Math.max(1, maxCols))}${Math.max(1, rows.length)}`;
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row.map((value, colIndex) => {
        const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
        const style = rowIndex === 0 ? ' s="1"' : "";
        return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(String(value ?? ""))}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const cols = Array.from({ length: maxCols }, (_, index) => {
    const width = index <= 1 ? 24 : index === 15 || index === 16 || index === 17 ? 34 : 16;
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    {
      name: "xl/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${cols}</cols>
  <sheetData>${sheetRows}</sheetData>
  <autoFilter ref="A1:${lastCell}"/>
</worksheet>`
    }
  ];
  return createZip(files.map((file) => ({ name: file.name, data: Buffer.from(file.data, "utf8") })));
}

function columnName(index: number) {
  let current = index;
  let name = "";
  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + (current % 26)) + name;
    current = Math.floor(current / 26);
  }
  return name;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function createZip(files: Array<{ name: string; data: Buffer }>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function evaluationStageLabel(stage: string) {
  const labels: Record<string, string> = {
    script: "剧本",
    character: "角色",
    storyboard: "分镜",
    image: "图片",
    video: "视频"
  };
  return labels[stage] ?? stage;
}

function safeDownloadName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "evaluation-runs";
}

function contentDisposition(fileName: string) {
  const fallback = safeDownloadName(fileName).replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function startBackgroundServices() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (!catalogReady) {
        await ensureSeedData();
        catalogReady = true;
      }
      await pingRedis();
      await startGenerationWorker();
      await recoverCreationDispatches();
      const recoveryTimer = setInterval(() => {
        void recoverCreationDispatches().catch(() => console.warn("[api] creation dispatch recovery will retry"));
      }, 15_000);
      recoveryTimer.unref();
      console.log("[api] catalog and generation worker ready");
      return;
    } catch (error) {
      console.warn(`[api] background startup failed; retrying: ${formatStartupError(error)}`);
      await new Promise(resolve => setTimeout(resolve, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))));
    }
  }
}

await ensureStorageBuckets();
void startBackgroundServices();

app.listen(port, () => {
  console.log(`[api] http://localhost:${port}`);
});
