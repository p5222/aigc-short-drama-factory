import type {
  AssetItem,
  CharacterProfile,
  CreditAccount,
  CreditTransaction,
  EvaluationDataset,
  ExperimentRun,
  EvaluationRun,
  ExportJob,
  HelpArticle,
  InvoiceRecord,
  GenerationTask,
  MembershipPlan,
  ModelPrice,
  ModelProvider,
  PaymentRecord,
  Plan,
  PlatformAnnouncement,
  Project,
  RechargeOrder,
  RedeemCode,
  PromptTemplate,
  PromptVersion,
  QualityReport,
  ScriptDraft,
  StoryboardShot,
  TaskStatus,
  UserFeedback,
  AnalyticsEvent
} from "@aifilm/shared";
import { getProviderQuotaSnapshot } from "../providers/modelQuota.js";
import { providerEnvApiKey } from "../providers/credentials.js";
import { isHistoricalAssetId } from "./mediaAssetIdentity.js";

export function mapProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    intro: row.intro,
    sourceType: row.sourceType,
    artStyle: row.artStyle,
    videoRatio: row.videoRatio,
    textProvider: row.textProvider ?? undefined,
    textModel: row.textModel ?? undefined,
    imageProvider: row.imageProvider ?? undefined,
    imageModel: row.imageModel ?? undefined,
    imageSize: row.imageSize ?? undefined,
    imageQuality: row.imageQuality ?? undefined,
    videoProvider: row.videoProvider ?? undefined,
    videoModel: row.videoModel ?? undefined,
    status: row.status,
    episodes: row.episodes,
    segmentProfile: row.segmentProfile ?? undefined,
    episodeDurationSeconds: row.episodeDurationSeconds ?? undefined,
    sourceCharactersPerEpisode: row.sourceCharactersPerEpisode ?? undefined,
    allowExpansion: row.allowExpansion ?? undefined,
    activeStoryboardVersion: row.activeStoryboardVersion ?? undefined,
    storyboards: row.storyboards,
    characters: row.characters,
    imageAssets: row.imageAssets,
    videoClips: row.videoClips,
    creditsSpent: row.creditsSpent,
    updatedAt: row.updatedAt.toISOString()
  };
}

export function mapTask(row: any): GenerationTask {
  const status = normalizeTaskStatus(row.status);
  const type = String(row.type ?? "text");
  const estimatedSeconds = estimateTaskSeconds(type, Number(row.estimatedCredits) || 0);
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    projectName: row.projectName ?? undefined,
    jobId: row.jobId ?? undefined,
    type: row.type,
    title: row.title,
    provider: row.provider,
    model: row.model,
    status,
    progress: row.progress,
    estimatedCredits: row.estimatedCredits,
    finalCredits: row.finalCredits ?? undefined,
    ...(row.billingQuote ? { billing: {
        mode: row.billingQuote.mode, listCredits: row.billingQuote.listCredits,
        payableCredits: row.billingQuote.payableCredits, maximumCredits: row.billingQuote.maximumCredits,
        discountPercent: row.billingQuote.discountPercent, policyVersion: row.billingQuote.policy.version,
        releasedCredits: row.billingSettlement?.releasedCredits, usage: row.billingSettlement?.usage,
        costStatus: row.billingSettlement?.costStatus
      } } : {}),
    errorReason: publicTaskError(row.errorReason),
    estimatedSeconds,
    refundPolicy: refundPolicyForTask(status),
    retryable: !/^(content|media):/.test(String(row.jobId ?? "")) && ["failed", "canceled", "refunded"].includes(status),
    cancelable: !/^(content|media):/.test(String(row.jobId ?? "")) && ["pending", "running"].includes(status),
    fallbackAvailable: ["text", "storyboard", "character", "image", "video"].includes(type),
    fallbackHint: fallbackHintForTask(type, row.provider, row.model),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function publicTaskError(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.kind === "creation_lease") return undefined;
    if (parsed?.kind === "media_checkpoint") {
      return typeof parsed.metadata?.lastError === "string" ? parsed.metadata.lastError : undefined;
    }
  } catch { /* Plain-language errors are already suitable for the task view. */ }
  return value;
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  return ["pending", "running", "succeeded", "failed", "canceled", "refunded"].includes(String(value))
    ? String(value) as TaskStatus
    : "pending";
}

function estimateTaskSeconds(type: string, credits: number) {
  const base: Record<string, number> = {
    text: 45,
    storyboard: 35,
    character: 90,
    image: 75,
    video: 180,
    tts: 30,
    export: 20
  };
  return Math.max(base[type] ?? 40, Math.round((credits || 1) * (type === "video" ? 8 : 3)));
}

function refundPolicyForTask(status: string) {
  if (status === "succeeded") return "生成成功后正式扣费，不退回。";
  if (status === "failed" || status === "refunded") return "失败任务会退回未消耗的冻结积分。";
  if (status === "canceled") return "取消后会退回未消耗的冻结积分。";
  return "排队或生成失败前只冻结积分，失败/取消自动解冻。";
}

function fallbackHintForTask(type: string, provider?: string, model?: string) {
  if (type === "text" || type === "storyboard") return "重试沿用本次任务的模型与报价；更换模型后请重新发起生成。";
  if (type === "character" || type === "image") return "可切换生图模型，继续使用已上传角色参考图和分镜引用资产。";
  if (type === "video") return "可切换视频模型，沿用已生成分镜图首帧继续生成。";
  return provider || model ? "可在后台检查渠道配置后重试。" : "可重试或改用备用处理方式。";
}

export function mapCreditAccount(row: any): CreditAccount {
  return {
    userId: row.userId,
    balance: row.balance,
    frozenBalance: row.frozenBalance,
    totalRecharge: row.totalRecharge,
    totalConsume: row.totalConsume
  };
}

export function mapCreditTransaction(row: any): CreditTransaction {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    description: row.description,
    taskId: row.taskId ?? undefined,
    projectId: row.projectId ?? undefined,
    createdAt: row.createdAt.toISOString()
  };
}

export function mapRechargeOrder(row: any): RechargeOrder {
  return {
    id: row.id,
    userId: row.userId,
    planId: row.planId ?? undefined,
    planName: row.planName,
    channel: row.channel,
    amountCny: row.amountCny,
    amountFen: row.amountFen ?? undefined,
    kind: row.kind ?? "recharge",
    codeUrl: row.status === "pending" ? row.codeUrl ?? undefined : undefined,
    expiresAt: row.expiresAt?.toISOString(),
    reconcileError: row.reconcileError ?? undefined,
    membershipStartsAt: row.membershipStartsAt?.toISOString(),
    membershipEndsAt: row.membershipEndsAt?.toISOString(),
    credits: row.credits,
    bonusCredits: row.bonusCredits,
    status: row.status,
    paidAt: row.paidAt?.toISOString(),
    invoiceStatus: row.invoiceStatus,
    createdAt: row.createdAt.toISOString()
  };
}

export function mapPaymentRecord(row: any): PaymentRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    channel: row.channel,
    providerTradeNo: row.providerTradeNo ?? undefined,
    amountCny: row.amountCny,
    status: row.status,
    callbackPayload: row.callbackPayload ?? undefined,
    createdAt: row.createdAt.toISOString()
  };
}

export function mapInvoice(row: any): InvoiceRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    title: row.title,
    taxNo: row.taxNo ?? undefined,
    email: row.email ?? undefined,
    amountCny: row.amountCny,
    status: row.status,
    issuedAt: row.issuedAt?.toISOString(),
    createdAt: row.createdAt.toISOString()
  };
}

export function mapPlatformAnnouncement(row: any): PlatformAnnouncement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type,
    enabled: row.enabled,
    pinned: row.pinned,
    startsAt: row.startsAt?.toISOString(),
    endsAt: row.endsAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function mapHelpArticle(row: any): HelpArticle {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? "",
    content: row.content,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    enabled: row.enabled,
    pinned: row.pinned,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function mapExportJob(row: any, sourceStatus: NonNullable<ExportJob["sourceStatus"]> = "unknown"): ExportJob {
  const diagnostics = parseExportDiagnostics(row.errorReason);
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    status: row.status,
    sourceStatus,
    outputUrl: row.outputUrl ?? undefined,
    downloadUrl: row.outputUrl ? `/api/projects/${row.projectId}/export/jobs/${row.id}/download` : undefined,
    previewUrl: diagnostics.previewUrl ?? (row.outputUrl?.endsWith(".mp4") ? row.outputUrl : undefined),
    manifestUrl: diagnostics.manifestUrl,
    subtitleUrl: diagnostics.subtitleUrl,
    audioUrl: diagnostics.audioUrl,
    outputKind: diagnostics.outputKind,
    ffmpegReady: diagnostics.ffmpegReady,
    clipCount: diagnostics.clipCount,
    storyboardIds: diagnostics.storyboardIds,
    warnings: diagnostics.warnings,
    errorReason: diagnostics.message,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function parseExportDiagnostics(value?: string | null) {
  if (!value) return {} as {
    message?: string;
    outputKind?: ExportJob["outputKind"];
    manifestUrl?: string;
    subtitleUrl?: string;
    audioUrl?: string;
    previewUrl?: string;
    ffmpegReady?: boolean;
    clipCount?: number;
    storyboardIds?: string[];
    warnings?: string[];
  };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.kind !== "export_diagnostics") return { message: value };
    return {
      message: typeof parsed.message === "string" ? parsed.message : undefined,
      outputKind: isExportOutputKind(parsed.outputKind) ? parsed.outputKind : undefined,
      manifestUrl: typeof parsed.manifestUrl === "string" ? parsed.manifestUrl : undefined,
      subtitleUrl: typeof parsed.subtitleUrl === "string" ? parsed.subtitleUrl : undefined,
      audioUrl: typeof parsed.audioUrl === "string" ? parsed.audioUrl : undefined,
      previewUrl: typeof parsed.previewUrl === "string" ? parsed.previewUrl : undefined,
      ffmpegReady: typeof parsed.ffmpegReady === "boolean" ? parsed.ffmpegReady : undefined,
      clipCount: typeof parsed.clipCount === "number" ? parsed.clipCount : undefined,
      storyboardIds: Array.isArray(parsed.storyboardIds) && parsed.storyboardIds.length > 0 && parsed.storyboardIds.every((id) => typeof id === "string" && id.trim().length > 0) && new Set(parsed.storyboardIds).size === parsed.storyboardIds.length
        ? parsed.storyboardIds as string[] : undefined,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === "string") : undefined
    };
  } catch {
    return { message: value };
  }
}

function isExportOutputKind(value: unknown): value is NonNullable<ExportJob["outputKind"]> {
  return value === "mp4" || value === "diagnostic_bundle" || value === "audio" || value === "subtitle";
}

export function mapPlan(row: any): Plan {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    credits: row.credits,
    bonusCredits: row.bonusCredits,
    badge: row.badge ?? undefined,
    features: row.features,
    shopUrl: row.shopUrl ?? undefined,
    enabled: row.enabled
  };
}

export function mapMembershipPlan(row: any): MembershipPlan {
  return {
    id: row.id,
    name: row.name,
    monthlyPrice: row.monthlyPrice,
    monthlyCredits: row.monthlyCredits,
    discountPercent: row.discountPercent,
    priorityLevel: row.priorityLevel,
    badge: row.badge ?? undefined,
    features: row.features,
    shopUrl: row.shopUrl ?? undefined,
    enabled: row.enabled
  };
}

export function mapRedeemCode(row: any): RedeemCode {
  const now = new Date();
  const status =
    !row.enabled ? "disabled" :
    row.startsAt && row.startsAt > now ? "scheduled" :
    row.endsAt && row.endsAt < now ? "expired" :
    row.usedCount >= row.maxRedemptions ? "used_up" :
    "active";
  return {
    id: row.id,
    batchId: row.batchId ?? undefined,
    code: row.code,
    name: row.name,
    credits: row.credits,
    maxRedemptions: row.maxRedemptions,
    usedCount: row.usedCount,
    enabled: row.enabled,
    startsAt: row.startsAt?.toISOString(),
    endsAt: row.endsAt?.toISOString(),
    status,
    createdAt: row.createdAt.toISOString()
  };
}

export async function mapProvider(row: any): Promise<ModelProvider> {
  const apiKey = typeof row.apiKey === "string" ? row.apiKey : "";
  const envKey = providerEnvApiKey(row.id, row.modality);
  const effectiveKey = apiKey || envKey;
  const routing = readProviderRoutingState(row.capability, row.models);
  const quotaModels = routing.mode === "manual"
    ? [routing.preferredModel].filter(Boolean)
    : routing.modelPool;
  const quotaStatus = await getProviderQuotaSnapshot(row.id, quotaModels);
  const activeModel = routing.mode === "manual"
    ? routing.preferredModel
    : quotaStatus.find((item) => item.available)?.model || quotaStatus[0]?.model || routing.preferredModel;
  return {
    id: row.id,
    name: row.name,
    modality: row.modality,
    enabled: row.enabled,
    baseUrl: row.baseUrl ?? undefined,
    iconUrl: row.iconUrl ?? undefined,
    apiKeyConfigured: Boolean(effectiveKey),
    apiKeyPreview: effectiveKey ? `****${effectiveKey.slice(-4)}` : undefined,
    models: row.models,
    capability: row.capability,
    costHint: row.costHint,
    routing: {
      mode: routing.mode,
      preferredModel: routing.preferredModel,
      modelPool: routing.modelPool,
      activeModel,
      quotaStatus
    }
  };
}

export function readProviderRoutingState(capability: unknown, models: string[]) {
  const availableModels = uniqueStrings(Array.isArray(models) ? models : []);
  const storedRouting = capability && typeof capability === "object" && "routing" in capability
    ? (capability as { routing?: { mode?: unknown; preferredModel?: unknown; modelPool?: unknown } }).routing
    : undefined;
  const mode: "auto" | "manual" = storedRouting?.mode === "manual" ? "manual" : "auto";
  const preferredModelCandidate = typeof storedRouting?.preferredModel === "string" ? storedRouting.preferredModel.trim() : "";
  const preferredModel = availableModels.includes(preferredModelCandidate)
    ? preferredModelCandidate
    : availableModels[0];
  const storedPool = Array.isArray(storedRouting?.modelPool)
    ? storedRouting!.modelPool.filter((model): model is string => typeof model === "string")
    : [];
  const modelPool = uniqueStrings((storedPool.length ? storedPool : availableModels).filter((model) => availableModels.includes(model)));
  return {
    mode,
    preferredModel,
    modelPool: uniqueStrings([preferredModel, ...modelPool])
  };
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

export function mapModelPrice(row: any): ModelPrice {
  return {
    id: row.id,
    providerId: row.providerId ?? undefined,
    providerName: row.providerName,
    modality: row.modality,
    model: row.model,
    unit: row.unit,
    unitCredits: row.unitCredits,
    vendorCostCny: row.vendorCostCny,
    billing: row.billing ?? undefined,
    enabled: row.enabled
  };
}

export function mapTemplate(row: any): PromptTemplate {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    version: row.version,
    enabled: row.enabled,
    summary: row.summary,
    content: row.content ?? undefined
  };
}

export function mapScript(row: any): ScriptDraft {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    content: row.content,
    synopsis: row.synopsis,
    version: row.version,
    createdAt: row.createdAt.toISOString()
  };
}

export function mapCharacter(row: any): CharacterProfile {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    identity: row.identity,
    appearance: row.appearance,
    costume: row.costume,
    personality: row.personality,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    referenceAssetId: row.referenceAssetId ?? undefined,
    voiceId: row.voiceId ?? undefined,
    seed: row.seed ?? undefined,
    consistencyLevel: row.consistencyLevel
  };
}

export function mapAsset(row: any): AssetItem {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    referenceUrl: row.referenceUrl ?? undefined,
    status: row.status,
    relatedCharacterId: row.relatedCharacterId ?? undefined,
    isHistorical: isHistoricalAssetId(row.id)
  };
}

export function mapStoryboard(row: any): StoryboardShot {
  return {
    id: row.id,
    projectId: row.projectId,
    episodeNo: row.episodeNo,
    sceneNo: row.sceneNo,
    shotNo: row.shotNo,
    duration: row.duration,
    shotSize: row.shotSize,
    cameraAngle: row.cameraAngle,
    cameraMovement: row.cameraMovement,
    characters: row.characters,
    scene: row.scene,
    pictureDesc: row.pictureDesc,
    action: row.action ?? undefined,
    orientation: row.orientation ?? undefined,
    spatialRelation: row.spatialRelation ?? undefined,
    emotion: row.emotion ?? undefined,
    dialogue: row.dialogue,
    voiceOver: row.voiceOver,
    environmentSound: row.environmentSound,
    soundEffect: row.soundEffect,
    imagePrompt: row.imagePrompt,
    videoPrompt: row.videoPrompt,
    referenceAssetIds: row.referenceAssetIds,
    status: row.status,
    segmentProfile: row.segmentProfile ?? undefined,
    sequenceNo: row.sequenceNo ?? undefined,
    startSeconds: row.startSeconds ?? undefined,
    endSeconds: row.endSeconds ?? undefined,
    boundaryType: row.boundaryType ?? undefined,
    startState: row.startState ?? undefined,
    endState: row.endState ?? undefined,
    firstFramePrompt: row.firstFramePrompt ?? undefined,
    lastFramePrompt: row.lastFramePrompt ?? undefined,
    firstFrameAssetId: row.firstFrameAssetId ?? undefined,
    lastFrameAssetId: row.lastFrameAssetId ?? undefined,
    continuitySourceShotId: row.continuitySourceShotId ?? undefined,
    promptVersion: row.promptVersion ?? undefined
  };
}

export function mapAnalyticsEvent(row: any): AnalyticsEvent {
  return {
    id: row.id,
    userId: row.userId ?? undefined,
    sessionId: row.sessionId ?? undefined,
    eventName: row.eventName,
    entityType: row.entityType ?? undefined,
    entityId: row.entityId ?? undefined,
    projectId: row.projectId ?? undefined,
    taskId: row.taskId ?? undefined,
    sourceChannel: row.sourceChannel ?? undefined,
    campaignCode: row.campaignCode ?? undefined,
    properties: normalizeObject(row.properties),
    createdAt: row.createdAt.toISOString()
  };
}

export function mapUserFeedback(row: any): UserFeedback {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId ?? undefined,
    taskId: row.taskId ?? undefined,
    assetId: row.assetId ?? undefined,
    stage: row.stage,
    rating: row.rating,
    usability: row.usability,
    tags: normalizeStringArray(row.tags),
    content: row.content,
    source: row.source ?? "creator",
    status: normalizeFeedbackStatus(row.status),
    priority: normalizeFeedbackPriority(row.priority),
    rootCause: row.rootCause ?? undefined,
    assignee: row.assignee ?? undefined,
    resolution: row.resolution ?? undefined,
    convertedDatasetId: row.convertedDatasetId ?? undefined,
    processedAt: row.processedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString()
  };
}

export function mapQualityReport(row: any): QualityReport {
  return {
    id: row.id,
    projectId: row.projectId,
    evaluationRunId: row.evaluationRunId ?? undefined,
    taskId: row.taskId ?? undefined,
    assetId: row.assetId ?? undefined,
    stage: row.stage,
    evaluatorType: row.evaluatorType,
    totalScore: row.totalScore,
    pass: row.pass,
    dimensionScores: normalizeNumberRecord(row.dimensionScores),
    problems: normalizeStringArray(row.problems),
    suggestions: normalizeStringArray(row.suggestions),
    recommendedAction: row.recommendedAction,
    promptVersion: row.promptVersion ?? undefined,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function mapEvaluationDataset(row: any): EvaluationDataset {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source,
    projectIds: normalizeStringArray(row.projectIds),
    stages: normalizeStringArray(row.stages).filter(isEvaluationStage) as EvaluationDataset["stages"],
    filters: normalizeObject(row.filters),
    sampleCount: row.sampleCount,
    owner: row.owner ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function mapEvaluationRun(row: any): EvaluationRun {
  const datasetSnapshot = normalizeObject(row.datasetSnapshot) as Partial<EvaluationDataset>;
  const promptSnapshot = normalizeObject(row.promptSnapshot) as Partial<PromptVersion>;
  const generationPromptSnapshot = normalizeObject(row.generationPromptSnapshot) as Partial<PromptVersion>;
  return {
    id: row.id,
    name: row.name,
    datasetId: row.datasetId ?? undefined,
    datasetName: row.dataset?.name ?? datasetSnapshot.name,
    datasetSnapshot,
    projectIds: normalizeStringArray(row.projectIds),
    stages: normalizeStringArray(row.stages).filter(isEvaluationStage) as EvaluationRun["stages"],
    mode: isEvaluationMode(row.mode) ? row.mode : "rules",
    evaluatorModels: normalizeEvaluatorModels(row.evaluatorModels),
    promptVersionId: row.promptVersionId ?? undefined,
    promptVersionName: row.promptVersion?.name ?? promptSnapshot.name,
    promptSnapshot,
    generationPromptVersionId: row.generationPromptVersionId ?? undefined,
    generationPromptVersionName: generationPromptSnapshot.name,
    generationPromptSnapshot,
    maxLlmCalls: row.maxLlmCalls,
    maxShotsPerPrompt: row.maxShotsPerPrompt,
    includeFeedback: Boolean(row.includeFeedback),
    status: isEvaluationRunStatus(row.status) ? row.status : "running",
    usage: normalizeEvaluationUsage(row.usage),
    skipped: normalizeSkipped(row.skipped),
    summary: normalizeEvaluationSummary(row.summary),
    errorReason: row.errorReason ?? undefined,
    primaryProjectId: row.primaryProjectId ?? undefined,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function mapPromptVersion(row: any): PromptVersion {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    stage: row.stage,
    purpose: ["generation", "evaluation"].includes(row.purpose) ? row.purpose : "evaluation",
    version: row.version,
    content: row.content,
    status: ["draft", "active", "archived"].includes(row.status) ? row.status : "draft",
    owner: row.owner ?? undefined,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  } as PromptVersion;
}

export function mapExperimentRun(row: any): ExperimentRun {
  const metrics = normalizeObject(row.metrics);
  const stageDeltas = Array.isArray(metrics.stageDeltas)
    ? metrics.stageDeltas.map((item: any) => ({
        stage: item.stage,
        baseline: Number(item.baseline) || 0,
        candidate: Number(item.candidate) || 0,
        delta: Number(item.delta) || 0
      }))
    : [];
  const sampleDeltas = Array.isArray(metrics.sampleDeltas)
    ? metrics.sampleDeltas.map((item: any) => ({
        projectId: String(item.projectId ?? ""),
        projectName: item.projectName ? String(item.projectName) : undefined,
        stage: item.stage,
        baseline: item.baseline === undefined ? undefined : Number(item.baseline) || 0,
        candidate: item.candidate === undefined ? undefined : Number(item.candidate) || 0,
        delta: item.delta === undefined ? undefined : Number(item.delta) || 0,
        status: item.status
      }))
    : [];
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    hypothesis: row.hypothesis,
    baselineVersion: row.baselineVersion,
    candidateVersion: row.candidateVersion,
    experimentType: ["model", "prompt", "combined"].includes(row.experimentType) ? row.experimentType : "model",
    datasetId: row.datasetId ?? undefined,
    datasetName: row.dataset?.name ?? undefined,
    baselineRunId: row.baselineRunId ?? undefined,
    candidateRunId: row.candidateRunId ?? undefined,
    baselineConfig: normalizeObject(row.baselineConfig),
    candidateConfig: normalizeObject(row.candidateConfig),
    metrics: {
      baselineScore: Number(metrics.baselineScore) || 0,
      candidateScore: Number(metrics.candidateScore) || 0,
      scoreDelta: Number(metrics.scoreDelta) || 0,
      baselinePassRate: Number(metrics.baselinePassRate) || 0,
      candidatePassRate: Number(metrics.candidatePassRate) || 0,
      passRateDelta: Number(metrics.passRateDelta) || 0,
      baselineReports: Number(metrics.baselineReports) || 0,
      candidateReports: Number(metrics.candidateReports) || 0,
      stageDeltas,
      sampleDeltas
    },
    winner: ["baseline", "candidate", "tie", "pending"].includes(row.winner) ? row.winner : "pending",
    trafficRatio: row.trafficRatio,
    successMetric: row.successMetric,
    resultSummary: row.resultSummary,
    status: ["draft", "running", "completed", "paused"].includes(row.status) ? row.status : "draft",
    startAt: row.startAt?.toISOString(),
    endAt: row.endAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  } as ExperimentRun;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  const object = normalizeObject(value);
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [key, typeof item === "number" ? item : Number(item) || 0])
  );
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function isEvaluationStage(value: string) {
  return ["script", "character", "storyboard", "image", "video"].includes(value);
}

function isEvaluationMode(value: string) {
  return ["rules", "hybrid", "llm"].includes(value);
}

function isEvaluationRunStatus(value: string) {
  return ["running", "completed", "failed"].includes(value);
}

function normalizeFeedbackStatus(value: string): UserFeedback["status"] {
  return ["open", "triaged", "processing", "resolved", "ignored", "converted"].includes(value)
    ? value as UserFeedback["status"]
    : "open";
}

function normalizeFeedbackPriority(value: string): UserFeedback["priority"] {
  return ["p0", "p1", "p2", "p3"].includes(value)
    ? value as UserFeedback["priority"]
    : "p2";
}

function normalizeEvaluatorModels(value: unknown): EvaluationRun["evaluatorModels"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeObject(item))
    .filter((item) => typeof item.provider === "string" && typeof item.model === "string")
    .map((item) => ({
      provider: String(item.provider),
      model: String(item.model),
      name: typeof item.name === "string" ? item.name : undefined
    }));
}

function normalizeEvaluationUsage(value: unknown): EvaluationRun["usage"] {
  const object = normalizeObject(value);
  return {
    ruleReports: Number(object.ruleReports) || 0,
    llmReports: Number(object.llmReports) || 0,
    llmCalls: Number(object.llmCalls) || 0,
    llmFailures: Number(object.llmFailures) || 0,
    estimatedPromptItems: Number(object.estimatedPromptItems) || 0
  };
}

function normalizeSkipped(value: unknown): EvaluationRun["skipped"] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeObject(item)).map((item) => ({
    projectId: typeof item.projectId === "string" ? item.projectId : undefined,
    stage: typeof item.stage === "string" && isEvaluationStage(item.stage) ? item.stage as EvaluationRun["stages"][number] : undefined,
    reason: typeof item.reason === "string" ? item.reason : ""
  })).filter((item) => item.reason);
}

function normalizeEvaluationSummary(value: unknown): EvaluationRun["summary"] {
  const object = normalizeObject(value);
  const stageScores = Array.isArray(object.stageScores)
    ? object.stageScores.map((item) => normalizeObject(item)).map((item) => ({
      stage: typeof item.stage === "string" && isEvaluationStage(item.stage) ? item.stage as EvaluationRun["stages"][number] : "script",
      reports: Number(item.reports) || 0,
      passRate: Number(item.passRate) || 0,
      averageScore: Number(item.averageScore) || 0
    }))
    : [];
  return {
    reportCount: Number(object.reportCount) || 0,
    passCount: Number(object.passCount) || 0,
    passRate: Number(object.passRate) || 0,
    averageScore: Number(object.averageScore) || 0,
    projectCount: Number(object.projectCount) || 0,
    stageScores
  };
}
