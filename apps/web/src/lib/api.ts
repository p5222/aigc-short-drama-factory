import type {
  AdminSummary,
  AdminUserRow,
  AnalyticsEventInput,
  AssetItem,
  BatchGenerationResult,
  CreditAccount,
  CreditTransaction,
  CreateProjectInput,
  CreationEstimate,
  DirectorStoryboardPackage,
  DirectorStoryboardRow,
  EvaluationDataset,
  EvaluationDatasetInput,
  ExperimentRun,
  EvaluationOverview,
  QualityCenterOverview,
  EvaluationRun,
  EvaluationRunDetail,
  FeedbackInput,
  ExportJob,
  GenerationTask,
  HelpArticle,
  ImageModelTestResult,
  InvoiceRecord,
  MembershipPlan,
  ModelPrice,
  ModelProvider,
  ModelTestResult,
  PaymentRecord,
  PagedResult,
  PlatformAnnouncement,
  Plan,
  Project,
  ProjectWorkflow,
  PromptTemplate,
  PromptVersion,
  QualityEvaluationRunInput,
  QualityEvaluationRunResult,
  QualityProjectRow,
  QualityReport,
  RechargeOrder,
  RelayGatewayPolicy,
  RedeemCode,
  StoryboardExportRow,
  StoryboardProductionPackage,
  StoryboardShot,
  ShowcaseWork,
  ShowcaseWorkInput,
  UserFeedback,
  VideoModelTestResult,
  OpenSourceAdapterInfo,
  VisualPipelineDescriptor,
  VisualPipelineTestResult,
  WritingAgentInput,
  WritingAgentOutput,
  CharacterConsistencyInput,
  CharacterConsistencyOutput,
  WorkbenchSummary
} from "@aifilm/shared";
import { requestBlob as httpRequestBlob, requestJson, requestText as httpRequestText } from "./httpClient";

export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  role: string;
  status: string;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

export interface AdminContentProject {
  id: string;
  title: string;
  mode: string;
  status: string;
  activeStep: string;
  styleProfile: Record<string, unknown>;
  updatedAt: string;
  user?: { id: string; name: string; email?: string };
  counts: { sources: number; analyses: number; outlines: number; chapters: number; scripts: number };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  return requestJson<T>(path, options);
}

async function requestText(path: string, options?: RequestInit): Promise<string> {
  return httpRequestText(path, options);
}

async function requestBlob(path: string, options?: RequestInit): Promise<Blob> {
  return httpRequestBlob(path, options);
}

export const api = {
  adminContentProjects: () => request<AdminContentProject[]>("/admin/content-projects"),
  login: (input: { account: string; password: string }) =>
    request<AuthResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  register: (input: { phone: string; email: string; password: string }) =>
    request<AuthResult>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  me: () => request<{ user: AuthUser }>("/auth/me"),
  updateProfile: (input: { name?: string; email?: string; avatarUrl?: string | null; currentPassword?: string }) =>
    request<{ user: AuthUser }>("/auth/profile", {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>("/auth/password", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  logout: () =>
    request<{ ok: boolean }>("/auth/logout", {
      method: "POST"
    }),
  workbench: () => request<WorkbenchSummary>("/workbench/summary"),
  projects: () => request<Project[]>("/projects"),
  pruneProjectsToLatest: () =>
    request<{ keptProjectId?: string; keptProjectName?: string; deletedProjects: number; deletedTasks: number; deletedTransactions: number }>(
      "/projects/prune-to-latest",
      { method: "POST" }
    ),
  tasks: () => request<GenerationTask[]>("/tasks"),
  creditAccount: () => request<CreditAccount>("/credits/account"),
  transactions: () => request<CreditTransaction[]>("/credits/transactions"),
  orders: () => request<RechargeOrder[]>("/billing/orders"),
  createOrder: (input: { planId: string; channel?: "wechat" | "alipay" | "manual" | "mock" }) =>
    request<RechargeOrder>("/billing/orders", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  mockRechargeCallback: (input: { orderId: string; channel?: string; providerTradeNo?: string; amountCny?: number }) =>
    request<{ order: RechargeOrder; payment: PaymentRecord }>("/billing/mock-callback", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  payments: () => request<PaymentRecord[]>("/billing/payments"),
  invoices: () => request<InvoiceRecord[]>("/billing/invoices"),
  requestInvoice: (input: { orderId: string; title: string; taxNo?: string; email?: string }) =>
    request<InvoiceRecord>("/billing/invoices", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  redeemCode: (code: string) =>
    request<CreditAccount>("/credits/redeem", {
      method: "POST",
      body: JSON.stringify({ code })
    }),
  plans: () => request<Plan[]>("/plans"),
  membershipPlans: () => request<MembershipPlan[]>("/membership-plans"),
  providers: () => request<ModelProvider[]>("/providers"),
  modelPrices: () => request<ModelPrice[]>("/model-prices"),
  templates: () => request<PromptTemplate[]>("/templates"),
  helpArticles: () => request<HelpArticle[]>("/help/articles"),
  publicShowcaseWorks: (page = 1, pageSize = 20, category = "全部", keyword = "") =>
    request<PagedResult<ShowcaseWork>>(`/showcase/works?page=${page}&pageSize=${pageSize}&category=${encodeURIComponent(category)}&keyword=${encodeURIComponent(keyword)}`),
  myShowcaseWorks: () => request<ShowcaseWork[]>("/showcase/mine"),
  createShowcaseWork: (input: ShowcaseWorkInput) =>
    request<ShowcaseWork>("/showcase/works", { method: "POST", body: JSON.stringify(input) }),
  resubmitShowcaseWork: (id: string) =>
    request<ShowcaseWork>(`/showcase/works/${id}/submit`, { method: "POST" }),
  trackEvent: (input: AnalyticsEventInput) =>
    request<{ ok: boolean }>("/analytics/events", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  submitFeedback: (input: FeedbackInput) =>
    request<UserFeedback>("/feedback", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  adminSummary: () => request<AdminSummary>("/admin/summary"),
  adminShowcaseWorks: (page = 1, pageSize = 20, status = "all", keyword = "") =>
    request<PagedResult<ShowcaseWork>>(`/admin/showcase/works?page=${page}&pageSize=${pageSize}&status=${encodeURIComponent(status)}&keyword=${encodeURIComponent(keyword)}`),
  updateAdminShowcaseWork: (id: string, input: Partial<Pick<ShowcaseWork, "title" | "description" | "category" | "creatorName" | "coverUrl" | "videoUrl" | "durationLabel" | "featured" | "sortOrder">>) =>
    request<ShowcaseWork>(`/admin/showcase/works/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...input, authorName: input.creatorName })
    }),
  reviewAdminShowcaseWork: (id: string, input: { decision: "approve" | "reject"; note?: string }) =>
    request<ShowcaseWork>(`/admin/showcase/works/${id}/review`, { method: "POST", body: JSON.stringify(input) }),
  adminAnnouncements: () => request<PlatformAnnouncement[]>("/admin/announcements"),
  adminHelpArticles: () => request<HelpArticle[]>("/admin/help-articles"),
  createAnnouncement: (input: Pick<PlatformAnnouncement, "title" | "body" | "type" | "enabled" | "pinned"> & { startsAt?: string | null; endsAt?: string | null }) =>
    request<PlatformAnnouncement>("/admin/announcements", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateAnnouncement: (
    id: string,
    input: Partial<Pick<PlatformAnnouncement, "title" | "body" | "type" | "enabled" | "pinned">> & { startsAt?: string | null; endsAt?: string | null }
  ) =>
    request<PlatformAnnouncement>(`/admin/announcements/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteAnnouncement: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/admin/announcements/${id}`, {
      method: "DELETE"
    }),
  createHelpArticle: (input: Pick<HelpArticle, "title" | "content" | "category" | "tags" | "enabled" | "pinned" | "sortOrder"> & { summary?: string }) =>
    request<HelpArticle>("/admin/help-articles", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateHelpArticle: (
    id: string,
    input: Partial<Pick<HelpArticle, "title" | "summary" | "content" | "category" | "tags" | "enabled" | "pinned" | "sortOrder">>
  ) =>
    request<HelpArticle>(`/admin/help-articles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteHelpArticle: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/admin/help-articles/${id}`, {
      method: "DELETE"
    }),
  adminEvaluationOverview: () => request<EvaluationOverview>("/admin/evaluation/overview"),
  adminQualityCenter: () => request<QualityCenterOverview>("/admin/quality-center"),
  adminQualityProjects: () => request<QualityProjectRow[]>("/admin/evaluation/projects"),
  adminEvaluationDatasets: () => request<EvaluationDataset[]>("/admin/evaluation/datasets"),
  adminEvaluationDatasetsPage: (page = 1, pageSize = 20, keyword = "") =>
    request<PagedResult<EvaluationDataset>>(`/admin/evaluation/datasets/page?page=${page}&pageSize=${pageSize}&keyword=${encodeURIComponent(keyword)}`),
  createEvaluationDataset: (input: EvaluationDatasetInput) =>
    request<EvaluationDataset>("/admin/evaluation/datasets", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deleteEvaluationDataset: (id: string) =>
    request<{ id: string; deleted: boolean; detachedRuns: number }>(`/admin/evaluation/datasets/${id}`, {
      method: "DELETE"
    }),
  adminEvaluationRuns: () => request<EvaluationRun[]>("/admin/evaluation/runs"),
  adminEvaluationRunsPage: (page = 1, pageSize = 20, keyword = "", status = "all") =>
    request<PagedResult<EvaluationRun>>(`/admin/evaluation/runs/page?page=${page}&pageSize=${pageSize}&keyword=${encodeURIComponent(keyword)}&status=${encodeURIComponent(status)}`),
  adminEvaluationRunDetail: (id: string) => request<EvaluationRunDetail>(`/admin/evaluation/runs/${id}`),
  adminFeedback: (limit = 200) => request<UserFeedback[]>(`/admin/feedback?limit=${limit}`),
  adminFeedbackPage: (page = 1, pageSize = 20, keyword = "", stage = "all", status = "all") =>
    request<PagedResult<UserFeedback>>(`/admin/feedback/page?page=${page}&pageSize=${pageSize}&keyword=${encodeURIComponent(keyword)}&stage=${encodeURIComponent(stage)}&status=${encodeURIComponent(status)}`),
  adminPromptVersions: (page = 1, pageSize = 50, stage = "all", purpose = "all") =>
    request<PagedResult<PromptVersion>>(`/admin/evaluation/prompt-versions?page=${page}&pageSize=${pageSize}&stage=${encodeURIComponent(stage)}&purpose=${encodeURIComponent(purpose)}`),
  createPromptVersion: (input: Pick<PromptVersion, "key" | "name" | "stage" | "purpose" | "version" | "content"> & Partial<Pick<PromptVersion, "status" | "owner" | "notes">>) =>
    request<PromptVersion>("/admin/evaluation/prompt-versions", { method: "POST", body: JSON.stringify(input) }),
  updatePromptVersion: (id: string, input: Partial<Pick<PromptVersion, "name" | "content" | "status" | "owner" | "notes">>) =>
    request<PromptVersion>(`/admin/evaluation/prompt-versions/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  adminExperiments: (page = 1, pageSize = 20, stage = "all") =>
    request<PagedResult<ExperimentRun>>(`/admin/evaluation/experiments?page=${page}&pageSize=${pageSize}&stage=${encodeURIComponent(stage)}`),
  createExperiment: (input: Pick<ExperimentRun, "name" | "stage" | "hypothesis" | "experimentType"> & { baselineRunId: string; candidateRunId: string; successMetric?: string }) =>
    request<ExperimentRun>("/admin/evaluation/experiments", { method: "POST", body: JSON.stringify(input) }),
  updateAdminFeedback: (
    id: string,
    input: Partial<Pick<UserFeedback, "status" | "priority" | "rootCause" | "assignee" | "resolution" | "convertedDatasetId">>
  ) =>
    request<UserFeedback>(`/admin/feedback/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteEvaluationRun: (id: string) =>
    request<{ id: string; deleted: boolean; deletedReports: number }>(`/admin/evaluation/runs/${id}`, {
      method: "DELETE"
    }),
  deleteProjectQualityData: (projectId: string) =>
    request<{ projectId: string; deletedReports: number; deletedFeedbacks: number }>(`/admin/evaluation/projects/${projectId}`, {
      method: "DELETE"
    }),
  exportEvaluationRunCsv: (id: string) => requestBlob(`/admin/evaluation/runs/${id}/export.csv`),
  exportEvaluationRunExcel: (id: string) => requestBlob(`/admin/evaluation/runs/${id}/export-excel.xlsx`),
  exportEvaluationRunsCsv: (ids?: string[]) => {
    const query = ids?.length ? `?ids=${encodeURIComponent(ids.join(","))}` : "";
    return requestBlob(`/admin/evaluation/runs/export.csv${query}`);
  },
  exportEvaluationRunsExcel: (ids?: string[]) => {
    const query = ids?.length ? `?ids=${encodeURIComponent(ids.join(","))}` : "";
    return requestBlob(`/admin/evaluation/runs/export-excel.xlsx${query}`);
  },
  runQualityEvaluation: (input: QualityEvaluationRunInput) =>
    request<QualityEvaluationRunResult>("/admin/evaluation/run", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  adminPlans: () => request<Plan[]>("/admin/plans"),
  adminMembershipPlans: () => request<MembershipPlan[]>("/admin/membership-plans"),
  adminRedeemCodes: () => request<RedeemCode[]>("/admin/redeem-codes"),
  createRedeemCodeBatch: (input: { name: string; prefix: string; credits: number; count: number; enabled?: boolean }) =>
    request<RedeemCode[]>("/admin/redeem-codes/batch", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  adminUsers: () => request<AdminUserRow[]>("/admin/users"),
  createAdminUser: (input: { name: string; email?: string; phone?: string; password: string; role?: string; status?: string; initialCredits?: number }) =>
    request<AdminUserRow>("/admin/users", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateAdminUser: (id: string, input: Partial<Pick<AdminUserRow, "name" | "role" | "status">>) =>
    request<AuthUser>(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  resetAdminUserPassword: (id: string, input: { password: string }) =>
    request<AuthUser>(`/admin/users/${id}/password`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  adjustUserCredits: (input: { userId: string; amount: number; description: string }) =>
    request<CreditAccount>("/admin/users/credits/adjust", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateModelPrice: (id: string, input: Partial<Pick<ModelPrice, "unitCredits" | "vendorCostCny" | "enabled">>) =>
    request<ModelPrice>(`/admin/model-prices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  createModelPrice: (input: Pick<ModelPrice, "providerName" | "modality" | "model" | "unit" | "unitCredits" | "vendorCostCny" | "enabled"> & { providerId?: string }) =>
    request<ModelPrice>("/admin/model-prices", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deleteModelPrice: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/admin/model-prices/${id}`, {
      method: "DELETE"
    }),
  updatePlan: (id: string, input: Partial<Pick<Plan, "name" | "price" | "credits" | "bonusCredits" | "badge" | "features" | "shopUrl" | "enabled">>) =>
    request<Plan>(`/admin/plans/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  createPlan: (input: Pick<Plan, "name" | "price" | "credits" | "bonusCredits" | "badge" | "features" | "shopUrl" | "enabled">) =>
    request<Plan>("/admin/plans", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deletePlan: (id: string) =>
    request<Plan>(`/admin/plans/${id}`, {
      method: "DELETE"
    }),
  updateMembershipPlan: (
    id: string,
    input: Partial<Pick<MembershipPlan, "name" | "monthlyPrice" | "monthlyCredits" | "discountPercent" | "priorityLevel" | "badge" | "features" | "shopUrl" | "enabled">>
  ) =>
    request<MembershipPlan>(`/admin/membership-plans/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  createMembershipPlan: (input: Pick<MembershipPlan, "name" | "monthlyPrice" | "monthlyCredits" | "discountPercent" | "priorityLevel" | "badge" | "features" | "shopUrl" | "enabled">) =>
    request<MembershipPlan>("/admin/membership-plans", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deleteMembershipPlan: (id: string) =>
    request<MembershipPlan>(`/admin/membership-plans/${id}`, {
      method: "DELETE"
    }),
  updateRedeemCode: (
    id: string,
    input: Partial<Pick<RedeemCode, "name" | "code" | "credits" | "maxRedemptions" | "enabled">> & { startsAt?: string | null; endsAt?: string | null }
  ) =>
    request<RedeemCode>(`/admin/redeem-codes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  deleteRedeemCode: (id: string) =>
    request<{ id: string; deleted?: boolean } | RedeemCode>(`/admin/redeem-codes/${id}`, {
      method: "DELETE"
    }),
  updateProvider: (
    id: string,
    input: Partial<Pick<ModelProvider, "name" | "modality" | "enabled" | "baseUrl" | "iconUrl" | "models" | "costHint">> & {
      apiKey?: string | null;
      routing?: { mode?: "auto" | "manual"; preferredModel?: string; modelPool?: string[] };
    }
  ) =>
    request<ModelProvider>(`/admin/providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  createProvider: (
    input: Pick<ModelProvider, "name" | "modality" | "enabled" | "baseUrl" | "models" | "costHint"> & {
      id?: string;
      iconUrl?: string;
      apiKey?: string;
      routing?: { mode?: "auto" | "manual"; preferredModel?: string; modelPool?: string[] };
      unitCredits?: number;
      vendorCostCny?: number;
    }
  ) =>
    request<ModelProvider>("/admin/providers", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deleteProvider: (id: string) =>
    request<{ id: string; deleted?: boolean } | ModelProvider>(`/admin/providers/${id}`, {
      method: "DELETE"
    }),
  updatePromptTemplate: (id: string, input: Partial<Pick<PromptTemplate, "name" | "type" | "version" | "enabled" | "summary" | "content">>) =>
    request<PromptTemplate>(`/admin/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  createPromptTemplate: (input: Pick<PromptTemplate, "name" | "type" | "version" | "enabled" | "summary" | "content">) =>
    request<PromptTemplate>("/admin/templates", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deletePromptTemplate: (id: string) =>
    request<PromptTemplate>(`/admin/templates/${id}`, {
      method: "DELETE"
    }),
  workflow: (projectId: string) => request<ProjectWorkflow>(`/projects/${projectId}/workflow`),
  updateProjectModelRoutes: (projectId: string, input: Partial<Pick<CreateProjectInput, "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">>) =>
    request<Project>(`/projects/${projectId}/model-routes`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  qualityReports: (projectId: string) => request<QualityReport[]>(`/projects/${projectId}/quality-reports`),
  generateQualityReports: (projectId: string, input?: { stages?: Array<"script" | "character" | "storyboard" | "image" | "video"> }) =>
    request<QualityReport[]>(`/projects/${projectId}/quality-reports/generate`, {
      method: "POST",
      body: JSON.stringify(input ?? {})
    }),
  estimate: (input: Pick<CreateProjectInput, "content" | "mode" | "targetEpisodes" | "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">) =>
    request<CreationEstimate>("/creation/estimate", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  startCreation: (input: CreateProjectInput) =>
    request<{ project: Project; task: GenerationTask; estimate: CreationEstimate; mode: "real" | "local" | "queued" }>(
      "/creation/start",
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    ),
  generateStoryboards: (projectId: string, input: Partial<Pick<CreateProjectInput, "artStyle" | "mode" | "videoRatio">>) =>
    request<BatchGenerationResult>(`/projects/${projectId}/storyboards/generate`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  updateStoryboardShot: (projectId: string, shotId: string, input: Partial<StoryboardShot>) =>
    request<StoryboardShot>(`/projects/${projectId}/storyboards/${shotId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  regenerateShotImage: (projectId: string, shotId: string) =>
    request<BatchGenerationResult>(`/projects/${projectId}/storyboards/${shotId}/image/regenerate`, {
      method: "POST"
    }),
  generateCharacterImages: (projectId: string, input?: { characterIds?: string[]; forceRegenerate?: boolean }) =>
    request<BatchGenerationResult>(`/projects/${projectId}/characters/images/generate`, {
      method: "POST",
      body: JSON.stringify(input ?? {})
    }),
  generateSceneImage: (projectId: string, assetId: string) =>
    request<BatchGenerationResult>(`/projects/${projectId}/scenes/${assetId}/image/generate`, {
      method: "POST"
    }),
  setCharacterReferenceImage: (projectId: string, characterId: string, input: { referenceUrl: string; description?: string }) =>
    request<AssetItem>(`/projects/${projectId}/characters/${characterId}/reference`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  deleteCharacterReferenceImage: (projectId: string, characterId: string) =>
    request<{ ok: boolean; characterId: string; deletedAssets: number }>(`/projects/${projectId}/characters/${characterId}/reference`, {
      method: "DELETE"
    }),
  generateImages: (projectId: string, input?: { shotIds?: string[]; forceRegenerate?: boolean }) =>
    request<BatchGenerationResult>(`/projects/${projectId}/images/generate`, {
      method: "POST",
      body: JSON.stringify(input ?? {})
    }),
  generateVideos: (projectId: string) =>
    request<BatchGenerationResult>(`/projects/${projectId}/videos/generate`, {
      method: "POST"
    }),
  exportStoryboard: (projectId: string) => request<StoryboardExportRow[]>(`/projects/${projectId}/export/storyboard`),
  directorStoryboard: (projectId: string) => request<DirectorStoryboardRow[]>(`/projects/${projectId}/director-storyboard`),
  storyboardProductionPackage: (projectId: string) => request<StoryboardProductionPackage>(`/projects/${projectId}/storyboard-production-package`),
  exportDirectorStoryboard: (projectId: string) =>
    request<DirectorStoryboardPackage>(`/projects/${projectId}/director-storyboard/export`, { method: "POST" }),
  exportJobs: (projectId: string) => request<ExportJob[]>(`/projects/${projectId}/export/jobs`),
  downloadExportJob: (projectId: string, jobId: string) => requestBlob(`/projects/${projectId}/export/jobs/${jobId}/download`),
  createExportJob: (projectId: string, input: { type: "tts" | "subtitle" | "video_export" }) =>
    request<ExportJob>(`/projects/${projectId}/export/jobs`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  retryTask: (taskId: string) =>
    request<GenerationTask>(`/tasks/${taskId}/retry`, {
      method: "POST"
    }),
  cancelTask: (taskId: string) =>
    request<GenerationTask>(`/tasks/${taskId}/cancel`, {
      method: "POST"
    }),
  modelTest: (input?: Pick<CreateProjectInput, "textProvider" | "textModel">) =>
    request<ModelTestResult>("/settings/model-test", {
      method: "POST",
      body: JSON.stringify(input ?? {})
    }),
  imageModelTest: (input?: Pick<CreateProjectInput, "imageProvider" | "imageModel">) =>
    request<ImageModelTestResult>("/settings/image-model-test", {
      method: "POST",
      body: JSON.stringify(input ?? {})
    }),
  videoModelTest: (input?: Pick<CreateProjectInput, "videoProvider" | "videoModel">) =>
    request<VideoModelTestResult>("/settings/video-model-test", {
      method: "POST",
      body: JSON.stringify(input ?? {})
    }),
  relayGatewayPolicy: () => request<RelayGatewayPolicy>("/admin/relay-gateway/policy"),
  writingAgentPlan: (input: WritingAgentInput) =>
    request<WritingAgentOutput>("/agents/writing/plan", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  characterConsistencyPlan: (input: CharacterConsistencyInput) =>
    request<CharacterConsistencyOutput>("/agents/character-consistency/plan", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  openSourceAdapters: () => request<OpenSourceAdapterInfo[]>("/agents/open-source-adapters"),
  visualPipelines: () => request<VisualPipelineDescriptor[]>("/admin/plugins/visual-pipelines"),
  testVisualPipeline: (pipelineId: string) =>
    request<VisualPipelineTestResult>("/admin/plugins/visual-pipelines/test", {
      method: "POST",
      body: JSON.stringify({ pipelineId })
    })
};

