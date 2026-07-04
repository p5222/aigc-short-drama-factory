export * from "./imageGeneration.js";

export type ProjectStatus = "draft" | "planning" | "scripting" | "storyboarding" | "asseting" | "rendering" | "completed";

export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "canceled" | "refunded";

export type TaskType = "text" | "storyboard" | "character" | "image" | "video" | "tts" | "export";

export type ModelModality = "text" | "image" | "video" | "tts" | "embedding";

export type CreditTransactionType = "recharge" | "freeze" | "consume" | "refund" | "adjust";
export type OrderStatus = "pending" | "paid" | "closed" | "refunded";
export type PaymentStatus = "pending" | "succeeded" | "failed";
export type InvoiceStatus = "none" | "requested" | "issued" | "rejected";
export type ExportJobStatus = "pending" | "running" | "succeeded" | "failed";
export type EvaluationStage = "script" | "character" | "storyboard" | "image" | "video";
export type FeedbackUsability = "usable" | "barely_usable" | "unusable";
export type FeedbackHandlingStatus = "open" | "triaged" | "processing" | "resolved" | "ignored" | "converted";
export type FeedbackPriority = "p0" | "p1" | "p2" | "p3";
export type QualityEvaluationMode = "rules" | "hybrid" | "llm";
export type EvaluationRunStatus = "running" | "completed" | "failed";

export interface Project {
  id: string;
  name: string;
  type: string;
  intro: string;
  sourceType: string;
  artStyle: string;
  videoRatio: "9:16" | "16:9" | "1:1";
  textProvider?: string;
  textModel?: string;
  imageProvider?: string;
  imageModel?: string;
  imageSize?: string;
  imageQuality?: string;
  videoProvider?: string;
  videoModel?: string;
  status: ProjectStatus;
  episodes: number;
  storyboards: number;
  characters: number;
  imageAssets: number;
  videoClips: number;
  creditsSpent: number;
  updatedAt: string;
}

export interface CharacterProfile {
  id: string;
  projectId: string;
  name: string;
  identity: string;
  appearance: string;
  costume: string;
  personality: string;
  prompt: string;
  negativePrompt: string;
  referenceAssetId?: string;
  voiceId?: string;
  seed?: number;
  consistencyLevel: "low" | "medium" | "high";
}

export interface ScriptDraft {
  id: string;
  projectId: string;
  name: string;
  content: string;
  synopsis: string;
  version: number;
  createdAt: string;
}

export interface AssetItem {
  id: string;
  projectId: string;
  type: "role" | "role_derivative" | "scene" | "prop" | "image" | "video" | "audio" | "subtitle" | "cover";
  name: string;
  description: string;
  prompt: string;
  referenceUrl?: string;
  status: TaskStatus;
  relatedCharacterId?: string;
}

export interface StoryboardShot {
  id: string;
  projectId: string;
  episodeNo: number;
  sceneNo: number;
  shotNo: number;
  duration: number;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  characters: string[];
  scene: string;
  pictureDesc: string;
  dialogue: string;
  voiceOver: string;
  environmentSound: string;
  soundEffect: string;
  imagePrompt: string;
  videoPrompt: string;
  referenceAssetIds: string[];
  status: TaskStatus;
  action?: string;
  orientation?: string;
  spatialRelation?: string;
  emotion?: string;
}

export interface ProjectWorkflow {
  project: Project;
  script?: ScriptDraft;
  characters: CharacterProfile[];
  assets: AssetItem[];
  storyboards: StoryboardShot[];
  tasks: GenerationTask[];
  qualityReports?: QualityReport[];
  feedbacks?: UserFeedback[];
}

export interface GenerationTask {
  id: string;
  projectId?: string;
  projectName?: string;
  jobId?: string;
  type: TaskType;
  title: string;
  provider: string;
  model: string;
  status: TaskStatus;
  progress: number;
  estimatedCredits: number;
  finalCredits?: number;
  errorReason?: string;
  estimatedSeconds?: number;
  refundPolicy?: string;
  retryable?: boolean;
  cancelable?: boolean;
  fallbackAvailable?: boolean;
  fallbackHint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditAccount {
  userId: string;
  balance: number;
  frozenBalance: number;
  totalRecharge: number;
  totalConsume: number;
}

export interface CreditTransaction {
  id: string;
  type: CreditTransactionType;
  amount: number;
  balanceAfter: number;
  description: string;
  taskId?: string;
  projectId?: string;
  createdAt: string;
}

export interface RechargeOrder {
  id: string;
  userId: string;
  planId?: string;
  planName: string;
  channel: "wechat" | "alipay" | "manual" | "mock";
  amountCny: number;
  credits: number;
  bonusCredits: number;
  status: OrderStatus;
  paidAt?: string;
  invoiceStatus: InvoiceStatus;
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  channel: string;
  providerTradeNo?: string;
  amountCny: number;
  status: PaymentStatus;
  callbackPayload?: string;
  createdAt: string;
}

export interface InvoiceRecord {
  id: string;
  orderId: string;
  title: string;
  taxNo?: string;
  email?: string;
  amountCny: number;
  status: InvoiceStatus;
  issuedAt?: string;
  createdAt: string;
}

export interface ExportJob {
  id: string;
  projectId: string;
  type: "tts" | "subtitle" | "video_export";
  status: ExportJobStatus;
  outputUrl?: string;
  downloadUrl?: string;
  previewUrl?: string;
  manifestUrl?: string;
  subtitleUrl?: string;
  audioUrl?: string;
  outputKind?: "mp4" | "diagnostic_bundle" | "audio" | "subtitle";
  ffmpegReady?: boolean;
  clipCount?: number;
  warnings?: string[];
  errorReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  credits: number;
  bonusCredits: number;
  badge?: string;
  features: string[];
  shopUrl?: string;
  enabled?: boolean;
}

export interface MembershipPlan {
  id: string;
  name: string;
  monthlyPrice: number;
  monthlyCredits: number;
  discountPercent: number;
  priorityLevel: number;
  badge?: string;
  features: string[];
  shopUrl?: string;
  enabled: boolean;
}

export interface RedeemCode {
  id: string;
  batchId?: string;
  code: string;
  name: string;
  credits: number;
  maxRedemptions: number;
  usedCount: number;
  enabled: boolean;
  startsAt?: string;
  endsAt?: string;
  status?: "active" | "disabled" | "used_up" | "expired" | "scheduled";
  createdAt: string;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  credits: number;
  frozenCredits: number;
  totalRecharge: number;
  totalConsume: number;
  projects: number;
  status: string;
  hasPassword?: boolean;
  lastLoginAt?: string;
}

export interface ProviderCapability {
  supportsReferenceImage: boolean;
  supportsSeed: boolean;
  supportsImageToImage: boolean;
  supportsImageToVideo: boolean;
  supportsAsyncTask: boolean;
  maxDuration?: number;
  ratios: string[];
}

export interface ModelQuotaStatus {
  model: string;
  submissions: number;
  dailyLimit?: number;
  blockedUntil?: string;
  lastError?: string;
  updatedAt?: string;
  available: boolean;
  coolingDown: boolean;
  reason?: string;
}

export interface ModelProviderRouting {
  mode: "auto" | "manual";
  preferredModel?: string;
  modelPool: string[];
  activeModel?: string;
  quotaStatus: ModelQuotaStatus[];
}

export interface ModelProvider {
  id: string;
  name: string;
  modality: ModelModality;
  enabled: boolean;
  baseUrl?: string;
  iconUrl?: string;
  apiKeyConfigured?: boolean;
  apiKeyPreview?: string;
  models: string[];
  capability: ProviderCapability;
  costHint: string;
  routing?: ModelProviderRouting;
}

export interface ModelPrice {
  id: string;
  providerId?: string;
  providerName: string;
  modality: ModelModality;
  model: string;
  unit: "text_run" | "image" | "image2" | "video_second" | "tts_character" | "export";
  unitCredits: number;
  vendorCostCny: number;
  enabled: boolean;
}

export interface PromptTemplate {
  id: string;
  name: string;
  type: "planning" | "script" | "storyboard" | "character" | "image" | "video" | "review";
  version: string;
  enabled: boolean;
  summary: string;
  content?: string;
}

export interface AnalyticsEvent {
  id: string;
  userId?: string;
  sessionId?: string;
  eventName: string;
  entityType?: string;
  entityId?: string;
  projectId?: string;
  taskId?: string;
  sourceChannel?: string;
  campaignCode?: string;
  properties: Record<string, unknown>;
  createdAt: string;
}

export interface UserFeedback {
  id: string;
  userId: string;
  projectId?: string;
  taskId?: string;
  assetId?: string;
  stage: EvaluationStage;
  rating: number;
  usability: FeedbackUsability;
  tags: string[];
  content: string;
  source: string;
  status: FeedbackHandlingStatus;
  priority: FeedbackPriority;
  rootCause?: string;
  assignee?: string;
  resolution?: string;
  convertedDatasetId?: string;
  processedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface QualityReport {
  id: string;
  projectId: string;
  evaluationRunId?: string;
  taskId?: string;
  assetId?: string;
  stage: EvaluationStage;
  evaluatorType: "system" | "ai" | "user" | "admin";
  totalScore: number;
  pass: boolean;
  dimensionScores: Record<string, number>;
  problems: string[];
  suggestions: string[];
  recommendedAction: string;
  promptVersion?: string;
  provider?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptVersion {
  id: string;
  key: string;
  name: string;
  stage: EvaluationStage;
  version: string;
  content: string;
  status: "draft" | "active" | "archived";
  owner?: string;
  notes: string;
  createdAt: string;
}

export interface ExperimentRun {
  id: string;
  name: string;
  stage: EvaluationStage;
  hypothesis: string;
  baselineVersion: string;
  candidateVersion: string;
  trafficRatio: number;
  successMetric: string;
  resultSummary: string;
  status: "draft" | "running" | "completed" | "paused";
  startAt?: string;
  endAt?: string;
}

export interface EvaluationDataset {
  id: string;
  name: string;
  description: string;
  source: string;
  projectIds: string[];
  stages: EvaluationStage[];
  filters: Record<string, unknown>;
  sampleCount: number;
  owner?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationDatasetInput {
  name: string;
  description?: string;
  source?: string;
  projectIds: string[];
  stages: EvaluationStage[];
  filters?: Record<string, unknown>;
  owner?: string;
}

export interface EvaluationRunUsage {
  ruleReports: number;
  llmReports: number;
  llmCalls: number;
  llmFailures: number;
  estimatedPromptItems: number;
}

export interface EvaluationRunSummary {
  reportCount: number;
  passCount: number;
  passRate: number;
  averageScore: number;
  projectCount: number;
  stageScores: Array<{ stage: EvaluationStage; reports: number; passRate: number; averageScore: number }>;
}

export interface EvaluationRun {
  id: string;
  name: string;
  datasetId?: string;
  datasetName?: string;
  datasetSnapshot: Partial<EvaluationDataset>;
  projectIds: string[];
  stages: EvaluationStage[];
  mode: QualityEvaluationMode;
  evaluatorModels: QualityEvaluatorModel[];
  maxLlmCalls: number;
  maxShotsPerPrompt: number;
  includeFeedback: boolean;
  status: EvaluationRunStatus;
  usage: EvaluationRunUsage;
  skipped: Array<{ projectId?: string; stage?: EvaluationStage; reason: string }>;
  summary: EvaluationRunSummary;
  errorReason?: string;
  primaryProjectId?: string;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationRunDetail {
  run: EvaluationRun;
  reports: QualityReport[];
}

export interface EvaluationOverview {
  northStar: {
    effectiveProjects: number;
    totalProjects: number;
    completionRate: number;
  };
  funnel: Array<{
    stage: EvaluationStage;
    label: string;
    total: number;
    pass: number;
    passRate: number;
    averageScore: number;
  }>;
  feedback: {
    total: number;
    unusable: number;
    topTags: Array<{ tag: string; count: number }>;
  };
  failures: Array<{
    provider: string;
    model: string;
    stage: string;
    count: number;
    reason: string;
  }>;
  modelQuality: Array<{
    provider: string;
    model: string;
    stage: string;
    tasks: number;
    successRate: number;
    averageScore: number;
    credits: number;
  }>;
  recentReports: QualityReport[];
  recentFeedback: UserFeedback[];
}

export interface QualityProjectRow {
  project: Project;
  userName: string;
  userEmail?: string;
  reports: QualityReport[];
  feedbacks: UserFeedback[];
  latestStage: EvaluationStage | "none";
  averageScore: number;
  blockedReasons: string[];
}

export interface QualityEvaluatorModel {
  provider: string;
  model: string;
  name?: string;
}

export interface QualityEvaluationRunInput {
  datasetId?: string;
  runName?: string;
  projectIds?: string[];
  stages?: EvaluationStage[];
  mode: QualityEvaluationMode;
  evaluatorModels?: QualityEvaluatorModel[];
  maxLlmCalls?: number;
  maxShotsPerPrompt?: number;
  includeFeedback?: boolean;
}

export interface QualityEvaluationRunResult {
  run?: EvaluationRun;
  projects: number;
  stages: EvaluationStage[];
  mode: QualityEvaluationMode;
  reports: QualityReport[];
  skipped: Array<{ projectId?: string; stage?: EvaluationStage; reason: string }>;
  usage: EvaluationRunUsage;
}

export interface FeedbackInput {
  projectId?: string;
  taskId?: string;
  assetId?: string;
  stage: EvaluationStage;
  rating: number;
  usability: FeedbackUsability;
  tags: string[];
  content?: string;
  source?: string;
}

export interface AnalyticsEventInput {
  sessionId?: string;
  eventName: string;
  entityType?: string;
  entityId?: string;
  projectId?: string;
  taskId?: string;
  sourceChannel?: string;
  campaignCode?: string;
  properties?: Record<string, unknown>;
}

export interface WorkbenchSummary {
  userName: string;
  projects: number;
  storyboards: number;
  runningTasks: number;
  credits: number;
  recentProjects: Project[];
  recentTasks: GenerationTask[];
  announcements: Array<{
    id: string;
    title: string;
    body: string;
    type: "info" | "guide" | "update";
  }>;
}

export interface CreationEstimate {
  words: number;
  suggestedEpisodes: number;
  estimatedCredits: number;
  mode: "nine_grid" | "twenty_five_grid" | "director";
  notes: string[];
  breakdown?: Array<{
    label: string;
    providerId?: string;
    model?: string;
    quantity: number;
    unitCredits: number;
    totalCredits: number;
    hint: string;
  }>;
  assumptions?: {
    shotsPerEpisode: number;
    totalShots: number;
    videoSecondsPerShot: number;
    includeVideo: boolean;
  };
}

export interface CreateProjectInput {
  title: string;
  sourceType: "novel" | "short_story" | "idea" | "script" | "excel";
  content: string;
  mode: "nine_grid" | "twenty_five_grid" | "director";
  genre: string;
  videoRatio: "9:16" | "16:9" | "1:1";
  artStyle: string;
  targetEpisodes?: number;
  textProvider?: string;
  textModel?: string;
  imageProvider?: string;
  imageModel?: string;
  imageSize?: string;
  imageQuality?: string;
  videoProvider?: string;
  videoModel?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface AdminSummary {
  users: number;
  projects: number;
  tasksToday: number;
  successRate: number;
  creditsConsumed: number;
  providerCost: number;
  creditsRevenueEstimate?: number;
  refundCredits?: number;
  failedTasks?: number;
  grossMarginEstimate?: number;
  grossMarginRate?: number;
  costByStage?: Array<{
    stage: string;
    tasks: number;
    credits: number;
    providerCost: number;
    failed: number;
    successRate: number;
  }>;
  costByModel?: Array<{
    provider: string;
    model: string;
    modality: string;
    tasks: number;
    credits: number;
    providerCost: number;
    failed: number;
    successRate: number;
  }>;
}

export interface ModelTestResult {
  ok: boolean;
  mode: "real" | "local" | "failed";
  provider: string;
  model: string;
  message: string;
}

export interface ImageModelTestResult {
  ok: boolean;
  mode: "real" | "local" | "queued" | "failed";
  provider: string;
  model: string;
  hasImageUrl: boolean;
  imageUrl?: string;
  prompt?: string;
  latencyMs?: number;
  message: string;
}

export interface VideoModelTestResult {
  ok: boolean;
  mode: "real" | "local" | "queued" | "config" | "failed";
  provider: string;
  model: string;
  latencyMs?: number;
  taskId?: string;
  videoUrl?: string;
  message: string;
}

export interface OpenSourceAdapterInfo {
  id: string;
  name: string;
  sourceRepo: string;
  licenseNote: string;
  capabilities: string[];
  workflow?: string[];
  rules?: string[];
  requiredEnv?: string[];
}

export interface VisualPipelineDescriptor {
  id: string;
  name: string;
  kind: "video" | "workflow" | "lipsync" | "tts";
  providerAliases: string[];
  defaultBaseUrl?: string;
  defaultModel?: string;
  envKeys: string[];
  capability: string[];
  status: "ready" | "missing_key" | "disabled" | "not_configured";
  message: string;
}

export interface VisualPipelineTestResult extends VisualPipelineDescriptor {
  ok: boolean;
  latencyMs: number;
}

export interface BatchGenerationResult {
  project: Project;
  task: GenerationTask;
  assetsCreated: number;
}

export interface StoryboardExportRow {
  shot: string;
  duration: number;
  shotSize: string;
  cameraMovement: string;
  characters: string;
  scene: string;
  pictureDesc: string;
  dialogue: string;
  voiceOver: string;
  soundEffect: string;
  imagePrompt: string;
  videoPrompt: string;
  referenceAssetIds: string;
}

export interface DirectorStoryboardRow {
  id: string;
  shotId: string;
  shotNo: string;
  duration: number;
  lens: string;
  fov: number;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  sketchPrompt: string;
  directorNotes: string[];
  blockingNotes: string[];
  seedancePrompt: string;
  blockingSvg: string;
}

export interface DirectorStoryboardPackage {
  title: string;
  htmlUrl: string;
  markdownUrl: string;
  rows: DirectorStoryboardRow[];
  stats: {
    shots: number;
    duration: number;
    avgShotDuration: number;
  };
}

export interface WritingAgentInput {
  title: string;
  premise: string;
  genre?: string;
  targetChapters?: number;
  chapterWords?: number;
}

export interface WritingAgentChapter {
  chapterNo: number;
  title: string;
  goal: string;
  conflict: string;
  hook: string;
  continuityNotes: string[];
}

export interface WritingAgentOutput {
  title: string;
  logline: string;
  worldRules: string[];
  characterArcs: Array<{
    name: string;
    role: string;
    desire: string;
    wound: string;
    change: string;
  }>;
  volumeOutline: Array<{
    volumeNo: number;
    title: string;
    promise: string;
    turningPoint: string;
  }>;
  chapters: WritingAgentChapter[];
  memoryCards: Array<{
    key: string;
    value: string;
    updateRule: string;
  }>;
  reviewChecklist: string[];
}

export interface CharacterConsistencyInput {
  projectId?: string;
  storyTitle: string;
  characters: Array<Pick<CharacterProfile, "name" | "identity" | "appearance" | "costume" | "personality" | "seed" | "consistencyLevel">>;
  artStyle: string;
}

export interface CharacterConsistencyOutput {
  projectId?: string;
  referencePlan: Array<{
    characterName: string;
    anchorPrompt: string;
    negativePrompt: string;
    seed: number;
    requiredViews: string[];
    lockedTraits: string[];
    driftRisks: string[];
  }>;
  shotUsageRules: string[];
  derivativeRules: string[];
}

export interface RelayRoutePreview {
  id: string;
  name: string;
  modality: ModelModality;
  enabled: boolean;
  models: string[];
  health: "ready" | "missing_key" | "disabled" | "unknown";
  pricingHint: string;
  routingWeight: number;
}

export interface RelayGatewayPolicy {
  compatibleEndpoint: string;
  routingMode: "cost_first" | "quality_first" | "latency_first" | "manual";
  accountSharing: "disabled" | "internal_pool";
  billingUnit: "credits";
  routes: RelayRoutePreview[];
  notes: string[];
}

export const supportedInputTypes = [
  "长篇小说",
  "短篇故事",
  "一句话脑洞",
  "已有剧本",
  "Excel 分镜表"
] as const;

export const productionPipeline = [
  "输入解析",
  "策划拆解",
  "剧本改编",
  "角色一致性",
  "镜头分镜",
  "分镜图",
  "图生视频",
  "配音字幕",
  "合成导出"
] as const;

export const roleConsistencyRules = [
  "角色先生成稳定身份卡，再生成参考资产，后续分镜只引用角色资产，不在分镜里重新发明外貌。",
  "角色提示词必须包含身份、五官气质、发型、服装主色、稳定配饰和负面约束。",
  "同一角色在同一项目内固定 seed；换装、变身等需要建立衍生角色资产，而不是直接改主资产。",
  "分镜提示词主要描述动作、情绪、空间关系和镜头语言，外貌由角色资产承接。",
  "多人同框时必须写清左右站位、朝向和可辨识特征，避免同款分身。"
] as const;

export const storyboardQualityRules = [
  "台词零删改：剧本台词进入分镜后不得合并、精简或省略。",
  "单镜头建议 2-8 秒，长台词或长 VO 必须拆镜；特殊长镜头最多 12 秒。",
  "场内人物不能无故消失，必须有视觉落点、动作承接或声音留痕。",
  "同场镜头需要景别、视角、动作或情绪变化，避免连续 3 个同景别。",
  "每条分镜必须包含景别、运镜、画面描述、台词/旁白、音效、图片提示词、视频提示词和关联资产。",
  "角色外观由角色资产提供，分镜提示词主要描述动作、状态、情绪、空间和镜头。",
  "跨场转场优先使用动作、情绪、视线或声音承接；不滥用花哨转场。",
  "图片/视频提示词必须引用真实资产 ID，不虚构不存在的角色、场景和道具。"
] as const;
