import {
  Activity,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ChartNoAxesCombined,
  CircleDollarSign,
  Copy,
  DatabaseZap,
  Download,
  FilePenLine,
  Gift,
  Image,
  Layers3,
  Loader2,
  Trash2,
  PlayCircle,
  RefreshCw,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  ToggleLeft,
  ToggleRight,
  MessageSquareText,
  UserRound,
  Video,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AdminSummary,
  AdminUserRow,
  EvaluationDataset,
  EvaluationStage,
  EvaluationOverview,
  EvaluationRun,
  ImageModelTestResult,
  MembershipPlan,
  ModelPrice,
  ModelProvider,
  ModelTestResult,
  Plan,
  PromptTemplate,
  QualityEvaluationRunResult,
  QualityProjectRow,
  RedeemCode,
  RelayGatewayPolicy,
  VideoModelTestResult,
  OpenSourceAdapterInfo,
  UserFeedback,
  VisualPipelineDescriptor,
  VisualPipelineTestResult
} from "@aifilm/shared";
import { api } from "../lib/api";

type AdminActionResult = void | Promise<void>;
type ProviderTestResult = ModelTestResult | ImageModelTestResult | VideoModelTestResult;
type ProviderTestState = {
  loading: boolean;
  result?: ProviderTestResult;
};
type PipelineTestState = {
  loading: boolean;
  result?: VisualPipelineTestResult;
};

const adminModules = ["运营总览", "用户管理", "用户反馈", "评测闭环", "提示词评分", "兑换码", "套餐会员", "订阅会员", "模型路由", "价格策略"];

const moduleCopy: Record<string, { title: string; subtitle: string }> = {
  运营总览: { title: "运营总览", subtitle: "查看用户、积分、模型成本和任务健康度。" },
  用户管理: { title: "用户管理", subtitle: "管理账号状态、身份权限、积分余额、密码重置和运营入账。" },
  用户反馈: { title: "用户反馈处理", subtitle: "查看手机端和创作者提交的问题，按阶段、标签和可用性定位产品阻塞。" },
  评测闭环: { title: "评测闭环", subtitle: "按项目、阶段、模型和用户反馈评估生成质量，用数据决定下一轮迭代。" },
  兑换码: { title: "兑换码", subtitle: "批量生成唯一兑换码，控制额度、次数和启停状态。" },
  套餐会员: { title: "套餐会员", subtitle: "管理前台充值包，启停后前端自动适配展示。" },
  订阅会员: { title: "订阅会员", subtitle: "管理月度额度、折扣、优先队列和会员权益。" },
  模型路由: { title: "模型路由", subtitle: "管理文本、生图、视频供应商，测试模型连接。" },
  提示词评分: { title: "提示词评分", subtitle: "维护各阶段 LLM 评测提示词、评分标准和输出 JSON 约束。" },
  价格策略: { title: "价格策略", subtitle: "按供应商、模型和计费单位配置积分单价与成本。" }
};

export function AdminPage({
  summary,
  providers,
  modelPrices,
  templates,
  plans,
  membershipPlans,
  redeemCodes,
  users,
  evaluation,
  qualityProjects,
  onRefresh
}: {
  summary?: AdminSummary;
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  templates: PromptTemplate[];
  plans: Plan[];
  membershipPlans: MembershipPlan[];
  redeemCodes: RedeemCode[];
  users: AdminUserRow[];
  evaluation?: EvaluationOverview;
  qualityProjects: QualityProjectRow[];
  onRefresh: () => void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null);
  const [imageTestResult, setImageTestResult] = useState<ImageModelTestResult | null>(null);
  const [videoTestResult, setVideoTestResult] = useState<VideoModelTestResult | null>(null);
  const [providerTests, setProviderTests] = useState<Record<string, ProviderTestState>>({});
  const [openSourceAdapters, setOpenSourceAdapters] = useState<OpenSourceAdapterInfo[]>([]);
  const [visualPipelines, setVisualPipelines] = useState<VisualPipelineDescriptor[]>([]);
  const [pipelineTests, setPipelineTests] = useState<Record<string, PipelineTestState>>({});
  const [relayPolicy, setRelayPolicy] = useState<RelayGatewayPolicy | null>(null);
  const [activeModule, setActiveModule] = useState(() => {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (hash === "用户积分") return "用户管理";
    if (hash === "智能体接入") return "提示词评分";
    return adminModules.includes(hash) ? hash : "运营总览";
  });

  const groupedPrices = useMemo(() => {
    const order = ["text", "image", "video", "tts", "embedding"];
    return [...modelPrices].sort(
      (a, b) =>
        order.indexOf(a.modality) - order.indexOf(b.modality) ||
        a.providerName.localeCompare(b.providerName) ||
        a.model.localeCompare(b.model)
    );
  }, [modelPrices]);

  useEffect(() => {
    function syncHashModule() {
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (hash === "用户积分") {
        setActiveModule("用户管理");
        return;
      }
      if (hash === "智能体接入") {
        setActiveModule("提示词评分");
        return;
      }
      if (adminModules.includes(hash)) setActiveModule(hash);
    }
    window.addEventListener("hashchange", syncHashModule);
    syncHashModule();
    return () => window.removeEventListener("hashchange", syncHashModule);
  }, []);

  useEffect(() => {
    if (activeModule !== "模型路由") return;
    void loadPluginStatus();
  }, [activeModule, providers.length]);

  async function runAction(action: () => Promise<unknown>, success: string) {
    setMessage("");
    setError("");
    try {
      await action();
      setMessage(success);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function runModelTest(provider: ModelProvider, model: string) {
    const testKey = `${provider.id}:${model}`;
    setMessage("");
    setError("");
    setTestResult(null);
    setImageTestResult(null);
    setVideoTestResult(null);
    setProviderTests((current) => ({ ...current, [testKey]: { loading: true } }));
    try {
      let result: ProviderTestResult;
      if (provider.modality === "image") {
        const imageResult = await api.imageModelTest({ imageProvider: provider.id, imageModel: model });
        result = imageResult;
        setImageTestResult(imageResult);
      } else if (provider.modality === "video") {
        const videoResult = await api.videoModelTest({ videoProvider: provider.id, videoModel: model });
        result = videoResult;
        setVideoTestResult(videoResult);
      } else {
        const textResult = await api.modelTest({ textProvider: provider.id, textModel: model });
        result = textResult;
        setTestResult(textResult);
      }
      setProviderTests((current) => ({ ...current, [testKey]: { loading: false, result } }));
    } catch (err) {
      const result: ProviderTestResult = {
        ok: false,
        mode: "failed",
        provider: provider.name,
        model,
        message: err instanceof Error ? err.message : "模型测试失败"
      };
      setProviderTests((current) => ({ ...current, [testKey]: { loading: false, result } }));
    }
  }

  async function loadRelayPolicy() {
    setMessage("");
    setError("");
    try {
      const result = await api.relayGatewayPolicy();
      setRelayPolicy(result);
      setMessage("网关策略预览已刷新。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "网关策略读取失败");
    }
  }

  async function loadPluginStatus() {
    const [adapterRes, pipelineRes] = await Promise.allSettled([api.openSourceAdapters(), api.visualPipelines()]);
    if (adapterRes.status === "fulfilled") setOpenSourceAdapters(adapterRes.value);
    if (pipelineRes.status === "fulfilled") setVisualPipelines(pipelineRes.value);
  }

  async function runPipelineTest(pipelineId: string) {
    setPipelineTests((current) => ({ ...current, [pipelineId]: { loading: true } }));
    try {
      const result = await api.testVisualPipeline(pipelineId);
      setPipelineTests((current) => ({ ...current, [pipelineId]: { loading: false, result } }));
      await loadPluginStatus();
    } catch (err) {
      const fallback = visualPipelines.find((item) => item.id === pipelineId);
      setPipelineTests((current) => ({
        ...current,
        [pipelineId]: {
          loading: false,
          result: {
            ...(fallback ?? {
              id: pipelineId,
              name: pipelineId,
              kind: "workflow" as const,
              providerAliases: [],
              envKeys: [],
              capability: [],
              status: "missing_key" as const,
              message: ""
            }),
            ok: false,
            latencyMs: 0,
            message: err instanceof Error ? err.message : "插件测试失败"
          }
        }
      }));
    }
  }

  const current = moduleCopy[activeModule] ?? moduleCopy.运营总览;

  return (
    <div className="admin-v2-page">
      <header className="admin-v2-titlebar">
        <div>
          <h1>{current.title}</h1>
          <p>{current.subtitle}</p>
        </div>
        <div className="admin-v2-title-actions">
          <button className="admin-icon-btn" onClick={onRefresh} title="刷新">
            <RefreshCw size={18} />
          </button>
          <span className="admin-balance-pill">
            <CircleDollarSign size={18} />
            ¥{(summary?.providerCost ?? 0).toFixed(2)}
          </span>
        </div>
      </header>

      {message ? <p className="admin-toast success">{message}</p> : null}
      {error ? <p className="admin-toast danger">{error}</p> : null}

      {activeModule === "运营总览" ? <DashboardSection summary={summary} providers={providers} modelPrices={modelPrices} /> : null}
      {activeModule === "评测闭环" ? <EvaluationSection evaluation={evaluation} projects={qualityProjects} providers={providers} onRefresh={onRefresh} /> : null}
      {activeModule === "提示词评分" ? (
        <PromptScoringSection
          templates={templates}
          onCreate={(input) => runAction(() => api.createPromptTemplate(input), "评分提示词已创建。")}
          onSave={(id, input) => runAction(() => api.updatePromptTemplate(id, input), "评分提示词已保存，后续 LLM 评测会使用最新启用版本。")}
          onDelete={(id) => runAction(() => api.deletePromptTemplate(id), "评分提示词已停用。")}
        />
      ) : null}
      {activeModule === "用户管理" ? (
        <UsersSection
          users={users}
          onCreateUser={(input) => runAction(() => api.createAdminUser(input), "用户账号已创建，初始积分和密码已写入。")}
          onUserSave={(userId, input) => runAction(() => api.updateAdminUser(userId, input), "用户资料已保存。")}
          onPasswordReset={(userId, password) => runAction(() => api.resetAdminUserPassword(userId, { password }), "用户密码已重置，旧会话已失效。")}
          onCreditAdjust={(input) => runAction(() => api.adjustUserCredits(input), "用户积分已调整，流水已写入。")}
        />
      ) : null}
      {activeModule === "用户反馈" ? <FeedbackOpsSection evaluation={evaluation} projects={qualityProjects} onRefresh={onRefresh} /> : null}
      {activeModule === "兑换码" ? (
        <RedeemSection
          redeemCodes={redeemCodes}
          onBatchCreate={(input) => runAction(() => api.createRedeemCodeBatch(input), "已批量生成唯一兑换码。")}
          onSave={(id, input) => runAction(() => api.updateRedeemCode(id, input), "兑换码配置已保存。")}
          onDelete={(id) => runAction(() => api.deleteRedeemCode(id), "兑换码已删除；已使用兑换码会自动停用保留记录。")}
        />
      ) : null}
      {activeModule === "套餐会员" ? (
        <PlansSection
          plans={plans}
          onCreate={(input) => runAction(() => api.createPlan(input), "充值套餐已创建，前台会自动按价格排序展示。")}
          onSave={(id, input) => runAction(() => api.updatePlan(id, input), "套餐配置已保存。")}
          onDelete={(id) => runAction(() => api.deletePlan(id), "套餐已停用，前台不再展示。")}
        />
      ) : null}
      {activeModule === "订阅会员" ? (
        <MembershipSection
          plans={membershipPlans}
          onCreate={(input) => runAction(() => api.createMembershipPlan(input), "订阅会员方案已创建。")}
          onSave={(id, input) => runAction(() => api.updateMembershipPlan(id, input), "会员方案已保存。")}
          onDelete={(id) => runAction(() => api.deleteMembershipPlan(id), "会员方案已停用。")}
        />
      ) : null}
      {activeModule === "模型路由" ? (
        <ProvidersSection
          providers={providers}
          relayPolicy={relayPolicy}
          testResult={testResult}
          imageTestResult={imageTestResult}
          videoTestResult={videoTestResult}
          providerTests={providerTests}
          openSourceAdapters={openSourceAdapters}
          visualPipelines={visualPipelines}
          pipelineTests={pipelineTests}
          onLoadRelayPolicy={() => void loadRelayPolicy()}
          onLoadPluginStatus={() => void loadPluginStatus()}
          onTestPipeline={(pipelineId) => void runPipelineTest(pipelineId)}
          onCreate={(input) => runAction(() => api.createProvider(input), "模型渠道已创建，并自动补齐价格策略。")}
          onSave={(id, input) => runAction(() => api.updateProvider(id, input), "供应商配置已保存。")}
          onDelete={(id) => runAction(() => api.deleteProvider(id), "模型渠道已删除；存在价格记录时自动停用。")}
          onTest={(provider, model) => void runModelTest(provider, model)}
        />
      ) : null}
      {activeModule === "价格策略" ? (
        <PricesSection
          prices={groupedPrices}
          providers={providers}
          onCreate={(input) => runAction(() => api.createModelPrice(input), "模型价格策略已创建。")}
          onSave={(id, input) => runAction(() => api.updateModelPrice(id, input), "模型价格已保存。")}
          onDelete={(id) => runAction(() => api.deleteModelPrice(id), "模型价格策略已删除。")}
        />
      ) : null}
    </div>
  );
}

function DashboardSection({ summary, providers, modelPrices }: { summary?: AdminSummary; providers: ModelProvider[]; modelPrices: ModelPrice[] }) {
  const enabledProviders = providers.filter((item) => item.enabled).length;
  const enabledPrices = modelPrices.filter((item) => item.enabled).length;
  const disabledProviders = providers.length - enabledProviders;
  const avgCredits = enabledPrices ? Math.round(modelPrices.filter((item) => item.enabled).reduce((sum, item) => sum + item.unitCredits, 0) / enabledPrices) : 0;
  const providerCost = summary?.providerCost ?? 0;
  const revenue = summary?.creditsRevenueEstimate ?? 0;
  const grossMargin = summary?.grossMarginEstimate ?? revenue - providerCost;
  return (
    <section className="admin-v2-section">
      <div className="admin-v2-metrics">
        <AdminMetric icon={<UserRound size={22} />} label="注册用户" value={summary?.users ?? 0} hint="当前系统用户" tone="blue" />
        <AdminMetric icon={<DatabaseZap size={22} />} label="项目数量" value={summary?.projects ?? 0} hint={`${summary?.tasksToday ?? 0} 个今日任务`} tone="amber" />
        <AdminMetric icon={<CheckCircle2 size={22} />} label="任务成功率" value={`${summary?.successRate ?? 0}%`} hint="生成任务健康度" tone="green" />
        <AdminMetric icon={<Activity size={22} />} label="启用渠道" value={enabledProviders} hint={`${enabledPrices} 条价格启用`} tone="violet" />
      </div>

      <div className="admin-v2-metrics small">
        <AdminMetric icon={<WalletCards size={20} />} label="积分消耗" value={(summary?.creditsConsumed ?? 0).toLocaleString()} hint="累计消耗积分" tone="blue" />
        <AdminMetric icon={<CircleDollarSign size={20} />} label="供应商成本" value={`¥${providerCost.toFixed(2)}`} hint="已记录成本" tone="amber" />
        <AdminMetric icon={<ChartNoAxesCombined size={20} />} label="毛利估算" value={`¥${grossMargin.toFixed(2)}`} hint={`${summary?.grossMarginRate ?? 0}% 毛利率`} tone="green" />
        <AdminMetric icon={<ShieldCheck size={20} />} label="退款积分" value={(summary?.refundCredits ?? 0).toLocaleString()} hint={`${summary?.failedTasks ?? 0} 个失败任务`} tone="violet" />
      </div>

      <div className="admin-v2-card admin-dashboard-grid">
        <div className="admin-v2-card-head">
          <div>
            <h2>运营健康度</h2>
            <p>从任务成功率、渠道启用、价格覆盖和积分消耗判断后台是否可稳定运营。</p>
          </div>
        </div>
        <div className="admin-policy-strip">
          <PolicyItem title="任务队列" body={`${summary?.tasksToday ?? 0} 个任务已记录，成功率 ${summary?.successRate ?? 0}%。`} />
          <PolicyItem title="渠道覆盖" body={`${enabledProviders}/${providers.length} 个供应商启用，${enabledPrices} 条价格策略可用。`} />
          <PolicyItem title="收入与成本" body={`积分收入估算 ¥${revenue.toFixed(2)}，供应商成本 ¥${providerCost.toFixed(2)}，平均单价 ${avgCredits} 积分。`} />
        </div>
      </div>

      <div className="admin-cost-grid">
        <CostBreakdownCard title="阶段成本" rows={(summary?.costByStage ?? []).map((row) => ({ name: costStageLabel(row.stage), tasks: row.tasks, credits: row.credits, cost: row.providerCost, failed: row.failed, successRate: row.successRate }))} />
        <CostBreakdownCard title="模型毛利风险" rows={(summary?.costByModel ?? []).map((row) => ({ name: `${row.provider} / ${row.model}`, sub: costStageLabel(row.modality), tasks: row.tasks, credits: row.credits, cost: row.providerCost, failed: row.failed, successRate: row.successRate }))} />
      </div>
    </section>
  );
}

function CostBreakdownCard({
  title,
  rows
}: {
  title: string;
  rows: Array<{ name: string; sub?: string; tasks: number; credits: number; cost: number; failed: number; successRate: number }>;
}) {
  return (
    <article className="admin-v2-card cost-breakdown-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>{title}</h2>
          <p>按真实任务记录聚合积分、供应商成本、失败数和成功率。</p>
        </div>
      </div>
      <div className="cost-breakdown-table">
        <div className="cost-breakdown-row header"><span>对象</span><span>任务</span><span>积分</span><span>成本</span><span>成功率</span></div>
        {rows.length ? rows.slice(0, 8).map((row) => (
          <div className="cost-breakdown-row" key={`${title}-${row.name}-${row.sub ?? ""}`}>
            <strong>{row.name}<small>{row.sub || `${row.failed} 失败`}</small></strong>
            <span>{row.tasks}</span>
            <span>{row.credits}</span>
            <span>¥{row.cost.toFixed(2)}</span>
            <span>{row.successRate}%</span>
          </div>
        )) : <div className="empty-state">暂无成本记录，生成任务后会自动汇总。</div>}
      </div>
    </article>
  );
}

function costStageLabel(stage: string) {
  const labels: Record<string, string> = {
    text: "文本",
    script: "剧本",
    storyboard: "分镜",
    character: "角色",
    image: "分镜图",
    video: "视频",
    tts: "配音",
    export: "导出"
  };
  return labels[stage] ?? stage;
}

function EvaluationSection({
  evaluation,
  projects,
  providers,
  onRefresh
}: {
  evaluation?: EvaluationOverview;
  projects: QualityProjectRow[];
  providers: ModelProvider[];
  onRefresh: () => void;
}) {
  const modelQuality = evaluation?.modelQuality ?? [];
  const blockedProjects = projects.filter((project) => project.blockedReasons.length > 0 || project.feedbacks.some((feedback) => feedback.usability !== "usable"));
  const textProviders = providers.filter((provider) => provider.modality === "text" && provider.enabled && !isDeprecatedChannel(provider.id, provider.name));
  const defaultProjectIds = projects.slice(0, 3).map((row) => row.project.id);
  const [activeEvalTab, setActiveEvalTab] = useState<"run" | "records" | "projects" | "models">("run");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(defaultProjectIds);
  const [selectedStages, setSelectedStages] = useState<EvaluationStage[]>(["script", "character", "storyboard", "image"]);
  const [mode, setMode] = useState<"rules" | "hybrid" | "llm">("rules");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [maxLlmCalls, setMaxLlmCalls] = useState(3);
  const [datasets, setDatasets] = useState<EvaluationDataset[]>([]);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [datasetDescription, setDatasetDescription] = useState("");
  const [running, setRunning] = useState(false);
  const [savingDataset, setSavingDataset] = useState(false);
  const [runResult, setRunResult] = useState<QualityEvaluationRunResult | null>(null);
  const [runError, setRunError] = useState("");
  const [datasetMessage, setDatasetMessage] = useState("");
  const [sampleKeyword, setSampleKeyword] = useState("");

  useEffect(() => {
    setSelectedProjectIds((current) => current.length ? current.filter((id) => projects.some((row) => row.project.id === id)) : projects.slice(0, 3).map((row) => row.project.id));
  }, [projects]);

  useEffect(() => {
    void refreshEvaluationSnapshots();
  }, []);

  async function refreshEvaluationSnapshots() {
    try {
      const [datasetRows, runRows] = await Promise.all([api.adminEvaluationDatasets(), api.adminEvaluationRuns()]);
      setDatasets(datasetRows);
      setRuns(runRows);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "评测快照读取失败");
    }
  }

  function selectDataset(datasetId: string) {
    setSelectedDatasetId(datasetId);
    const dataset = datasets.find((item) => item.id === datasetId);
    if (!dataset) return;
    setSelectedProjectIds(dataset.projectIds.filter((id) => projects.some((row) => row.project.id === id)));
    setSelectedStages(dataset.stages);
  }

  const evaluatorGroups = buildEvaluatorGroups(textProviders);
  const evaluatorOptions = evaluatorGroups.flatMap((group) => group.models);
  const selectedDataset = datasets.find((item) => item.id === selectedDatasetId);
  const selectedProjectRows = projects.filter((row) => selectedProjectIds.includes(row.project.id));
  const sampleProjectRows = projects
    .filter((row) => `${row.project.name} ${row.userName} ${row.userEmail ?? ""}`.toLowerCase().includes(sampleKeyword.toLowerCase()))
    .slice(0, 18);
  const latestRun = runs[0];
  const llmCallsTotal = runs.reduce((sum, run) => sum + run.usage.llmCalls, 0);
  const failedRuns = runs.filter((run) => run.status === "failed").length;
  const projectedLlmCalls = mode === "rules" ? 0 : selectedProjectIds.length * selectedStages.length * Math.max(1, selectedModels.length);

  async function saveCurrentDataset() {
    setSavingDataset(true);
    setRunError("");
    setDatasetMessage("");
    try {
      const dataset = await api.createEvaluationDataset({
        name: datasetName || `样本集 ${new Date().toLocaleString()}`,
        description: datasetDescription,
        source: "manual",
        projectIds: selectedProjectIds,
        stages: selectedStages,
        filters: { mode, from: "admin_evaluation_console" }
      });
      setDatasets((current) => [dataset, ...current.filter((item) => item.id !== dataset.id)]);
      setSelectedDatasetId(dataset.id);
      setDatasetName("");
      setDatasetDescription("");
      setDatasetMessage(`已保存样本集：${dataset.name}`);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "保存样本集失败");
    } finally {
      setSavingDataset(false);
    }
  }

  async function runEvaluation() {
    setRunning(true);
    setRunError("");
    try {
      const evaluatorModels = evaluatorOptions
        .filter((item) => selectedModels.includes(item.key))
        .map((item) => ({ provider: item.provider, model: item.model, name: item.name }));
      const result = await api.runQualityEvaluation({
        datasetId: selectedDatasetId || undefined,
        runName: `${stageLabel(selectedStages[0] ?? "none")}评测 ${new Date().toLocaleString()}`,
        projectIds: selectedProjectIds,
        stages: selectedStages,
        mode,
        evaluatorModels,
        maxLlmCalls: mode === "rules" ? 0 : maxLlmCalls,
        maxShotsPerPrompt: 8,
        includeFeedback: true
      });
      setRunResult(result);
      await refreshEvaluationSnapshots();
      onRefresh();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "评测运行失败");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="admin-v2-section admin-evaluation-section">
      <div className="admin-v2-metrics">
        <AdminMetric icon={<ChartNoAxesCombined size={22} />} label="有效作品" value={evaluation?.northStar.effectiveProjects ?? 0} hint={`总项目 ${evaluation?.northStar.totalProjects ?? 0}`} tone="blue" />
        <AdminMetric icon={<CheckCircle2 size={22} />} label="最近评测均分" value={latestRun?.summary.averageScore ? `${latestRun.summary.averageScore}分` : "-"} hint={latestRun ? `${latestRun.summary.reportCount} 条报告` : "暂无评测记录"} tone="green" />
        <AdminMetric icon={<Activity size={22} />} label="评测记录" value={runs.length} hint={`LLM ${llmCallsTotal} 次 · 失败 ${failedRuns}`} tone="amber" />
        <AdminMetric icon={<DatabaseZap size={22} />} label="待处理项目" value={blockedProjects.length} hint="低分或不可用反馈" tone="violet" />
      </div>

      <div className="evaluation-product-loop">
        <PolicyItem title="样本集筛选" body={`${datasets.length} 个样本集，当前选择 ${selectedProjectIds.length} 个作品，可按项目/用户关键词过滤。`} />
        <PolicyItem title="多模型评测" body={mode === "rules" ? "当前为规则评分；切到 Hybrid/LLM 后可同时选择多个文本模型横评。" : `已选择 ${selectedModels.length} 个评测模型，上限 ${maxLlmCalls} 次调用。`} />
        <PolicyItem title="提示词版本" body="后台“提示词评分”维护各阶段启用版本，评测报告会记录 provider/model/promptVersion。" />
        <PolicyItem title="反馈回流" body={`${blockedProjects.length} 个项目带低分或人工反馈，可回流到提示词、模型路由和角色质量门禁。`} />
      </div>

      <div className="evaluation-tabbar">
        {[
          ["run", "运行评测"],
          ["records", "评测记录"],
          ["projects", "项目质检池"],
          ["models", "模型表现"]
        ].map(([key, label]) => (
          <button key={key} type="button" className={activeEvalTab === key ? "active" : ""} onClick={() => setActiveEvalTab(key as typeof activeEvalTab)}>{label}</button>
        ))}
      </div>

      {activeEvalTab === "run" ? <article className="admin-v2-card evaluation-runner-card compact">
        <div className="admin-v2-card-head">
          <div>
            <h2>运行评测</h2>
            <p>先选样本，再选阶段和评测方式。默认规则评分不消耗 LLM，只有切到 LLM 模式才会调用模型。</p>
          </div>
          <button className="admin-primary-btn" onClick={() => void runEvaluation()} disabled={running || !selectedProjectIds.length || !selectedStages.length || (mode !== "rules" && (!selectedModels.length || maxLlmCalls <= 0))}>
            {running ? <Loader2 size={18} className="spin" /> : <PlayCircle size={18} />}
            {running ? "评测中" : "运行评测"}
          </button>
        </div>
        <div className="evaluation-run-workspace">
          <div className="evaluation-sample-panel">
            <div className="evaluation-sample-toolbar">
              <select className="evaluation-dataset-select" value={selectedDatasetId} onChange={(event) => selectDataset(event.target.value)}>
                <option value="">手动选择项目样本</option>
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.sampleCount} 项</option>
                ))}
              </select>
              <input value={sampleKeyword} onChange={(event) => setSampleKeyword(event.target.value)} placeholder="搜索作品 / 用户" />
            </div>
            <div className="evaluation-selected-strip">
              <strong>{selectedDataset?.name ?? "当前样本"}</strong>
              <span>{selectedProjectIds.length} 项 · {selectedStages.map(stageLabel).join(" / ")}</span>
              <div>
                {selectedProjectRows.slice(0, 5).map((row) => <em key={row.project.id}>{row.project.name}</em>)}
                {selectedProjectRows.length > 5 ? <em>+{selectedProjectRows.length - 5}</em> : null}
              </div>
            </div>
            <div className="evaluation-project-picker">
              {sampleProjectRows.map((row) => (
                <label key={row.project.id} className={selectedProjectIds.includes(row.project.id) ? "active" : ""}>
                  <input type="checkbox" checked={selectedProjectIds.includes(row.project.id)} onChange={() => toggleString(selectedProjectIds, row.project.id, setSelectedProjectIds)} />
                  <span>{row.project.name}</span>
                  <small>{row.averageScore || "未评测"}分 · {row.userName} · {row.feedbacks.length}条反馈</small>
                </label>
              ))}
            </div>
            <div className="evaluation-dataset-form inline">
              <input value={datasetName} onChange={(event) => setDatasetName(event.target.value)} placeholder="保存为样本集名称" />
              <input value={datasetDescription} onChange={(event) => setDatasetDescription(event.target.value)} placeholder="样本说明，可选" />
              <button type="button" onClick={() => void saveCurrentDataset()} disabled={savingDataset || !selectedProjectIds.length || !selectedStages.length}>
                {savingDataset ? <Loader2 size={16} className="spin" /> : <DatabaseZap size={16} />}
                保存
              </button>
            </div>
            {datasetMessage ? <small className="evaluation-inline-message">{datasetMessage}</small> : null}
          </div>

          <div className="evaluation-config-panel">
            <div>
              <strong>评测阶段</strong>
              <div className="evaluation-chip-row">
                {(["script", "character", "storyboard", "image", "video"] as EvaluationStage[]).map((stage) => (
                  <button type="button" key={stage} className={selectedStages.includes(stage) ? "active" : ""} onClick={() => toggleStage(selectedStages, stage, setSelectedStages)}>{stageLabel(stage)}</button>
                ))}
              </div>
            </div>
            <div>
              <strong>评测方式</strong>
              <div className="evaluation-mode-cards">
                {[
                  ["rules", "规则评分", "快速、稳定、零 token"],
                  ["hybrid", "规则 + LLM", "抽样复核，适合迭代验证"],
                  ["llm", "LLM 对比", "只看模型评审差异"]
                ].map(([value, label, desc]) => (
                  <button type="button" className={mode === value ? "active" : ""} onClick={() => setMode(value as typeof mode)} key={value}>
                    <span>{label}</span>
                    <small>{desc}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className={mode === "rules" ? "evaluation-llm-panel disabled" : "evaluation-llm-panel"}>
              <div className="evaluation-budget-row">
                <strong>LLM 评测模型</strong>
                <label><span>上限</span><input type="number" min={0} max={50} value={maxLlmCalls} onChange={(event) => setMaxLlmCalls(Number(event.target.value) || 0)} disabled={mode === "rules"} /></label>
              </div>
              <div className="evaluation-model-group-grid">
                {evaluatorGroups.map((group) => (
                  <article className="evaluation-model-group" key={group.provider.id}>
                    <div>
                      <strong>{group.provider.name}</strong>
                      <span>{group.models.length} 个可选评测模型</span>
                    </div>
                    <div className="evaluation-model-chip-grid">
                      {group.models.map((item) => (
                        <button type="button" key={item.key} className={selectedModels.includes(item.key) ? "active" : ""} onClick={() => toggleString(selectedModels, item.key, setSelectedModels)} disabled={mode === "rules"}>
                          {item.model}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
                {!evaluatorOptions.length ? <small>暂无启用的文本模型。</small> : null}
              </div>
            </div>
            <div className="evaluation-runner-summary">
              <span>样本 {selectedProjectIds.length} 项</span>
              <span>{selectedStages.length} 阶段</span>
              <span>{modeLabel(mode)}</span>
              <span>理论 LLM {projectedLlmCalls} 次 / 上限 {mode === "rules" ? 0 : maxLlmCalls}</span>
            </div>
          </div>
        </div>
        {runError ? <p className="admin-toast danger">{runError}</p> : null}
        {runResult ? (
          <div className="evaluation-run-result">
            <strong>{runResult.run?.name ?? "本次评测"} · 生成 {runResult.reports.length} 条报告</strong>
            <span>规则 {runResult.usage.ruleReports} · LLM {runResult.usage.llmReports} · 调用 {runResult.usage.llmCalls} · 失败 {runResult.usage.llmFailures}</span>
            {runResult.skipped.slice(0, 4).map((item, index) => <small key={`${item.projectId}-${item.stage}-${index}`}>{item.projectId ?? "项目"} {item.stage ?? ""}：{item.reason}</small>)}
          </div>
        ) : null}
      </article> : null}

      {activeEvalTab === "records" ? <EvaluationRecordsCard runs={runs} datasets={datasets} onDeleteRun={async (id) => { await api.deleteEvaluationRun(id); await refreshEvaluationSnapshots(); onRefresh(); }} onDeleteDataset={async (id) => { await api.deleteEvaluationDataset(id); await refreshEvaluationSnapshots(); }} onRefresh={refreshEvaluationSnapshots} /> : null}
      {activeEvalTab === "projects" ? <ProjectQualityPool projects={projects} onDeleteQuality={async (projectId) => { await api.deleteProjectQualityData(projectId); onRefresh(); }} /> : null}
      {activeEvalTab === "models" ? <ModelQualityCard modelQuality={modelQuality} providers={providers} /> : null}
    </section>
  );
}

function FeedbackOpsSection({
  evaluation,
  projects,
  onRefresh
}: {
  evaluation?: EvaluationOverview;
  projects: QualityProjectRow[];
  onRefresh: () => void;
}) {
  const [feedbacks, setFeedbacks] = useState<UserFeedback[]>(evaluation?.recentFeedback ?? []);
  const [stage, setStage] = useState<EvaluationStage | "all">("all");
  const [usability, setUsability] = useState<UserFeedback["usability"] | "all">("all");
  const [status, setStatus] = useState<UserFeedback["status"] | "all">("all");
  const [priority, setPriority] = useState<UserFeedback["priority"] | "all">("all");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedFullFeedback, setLoadedFullFeedback] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [handlingId, setHandlingId] = useState("");
  const [draft, setDraft] = useState({
    status: "open" as UserFeedback["status"],
    priority: "p2" as UserFeedback["priority"],
    rootCause: "",
    assignee: "",
    resolution: ""
  });

  useEffect(() => {
    if (!loadedFullFeedback) setFeedbacks(evaluation?.recentFeedback ?? []);
  }, [evaluation?.recentFeedback, loadedFullFeedback]);

  useEffect(() => {
    void loadFeedback(false);
  }, []);

  async function loadFeedback(refreshParent = true) {
    setLoading(true);
    setError("");
    try {
      setFeedbacks(await api.adminFeedback(300));
      setLoadedFullFeedback(true);
      if (refreshParent) onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "反馈读取失败");
    } finally {
      setLoading(false);
    }
  }

  const projectById = new Map(projects.map((row) => [row.project.id, row]));
  const rows = feedbacks.filter((item) => {
    const project = item.projectId ? projectById.get(item.projectId) : undefined;
    const haystack = `${item.content} ${item.tags.join(" ")} ${item.rootCause ?? ""} ${item.resolution ?? ""} ${project?.project.name ?? ""} ${project?.userName ?? ""} ${project?.userEmail ?? ""}`.toLowerCase();
    return (stage === "all" || item.stage === stage) &&
      (usability === "all" || item.usability === usability) &&
      (status === "all" || item.status === status) &&
      (priority === "all" || item.priority === priority) &&
      haystack.includes(keyword.toLowerCase());
  });
  const selectedFeedback = rows.find((item) => item.id === selectedId) ?? rows[0];
  const unusable = feedbacks.filter((item) => item.usability === "unusable").length;
  const pending = feedbacks.filter((item) => ["open", "triaged", "processing"].includes(item.status)).length;
  const urgent = feedbacks.filter((item) => item.priority === "p0" || item.priority === "p1").length;
  const converted = feedbacks.filter((item) => item.status === "converted").length;
  const topTags = topFeedbackTags(feedbacks);

  useEffect(() => {
    if (!selectedFeedback) return;
    setSelectedId(selectedFeedback.id);
    setDraft({
      status: selectedFeedback.status,
      priority: selectedFeedback.priority,
      rootCause: selectedFeedback.rootCause ?? inferRootCause(selectedFeedback),
      assignee: selectedFeedback.assignee ?? "",
      resolution: selectedFeedback.resolution ?? ""
    });
  }, [selectedFeedback?.id]);

  async function saveFeedback(input: Partial<Pick<UserFeedback, "status" | "priority" | "rootCause" | "assignee" | "resolution" | "convertedDatasetId">>) {
    if (!selectedFeedback) return;
    setHandlingId(selectedFeedback.id);
    setError("");
    try {
      const updated = await api.updateAdminFeedback(selectedFeedback.id, input);
      setFeedbacks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDraft({
        status: updated.status,
        priority: updated.priority,
        rootCause: updated.rootCause ?? "",
        assignee: updated.assignee ?? "",
        resolution: updated.resolution ?? ""
      });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "反馈处理保存失败");
    } finally {
      setHandlingId("");
    }
  }

  return (
    <section className="admin-v2-section feedback-ops-section">
      <div className="admin-v2-metrics">
        <AdminMetric icon={<MessageSquareText size={22} />} label="反馈总数" value={feedbacks.length} hint="最近最多 300 条" tone="blue" />
        <AdminMetric icon={<Activity size={22} />} label="待处理" value={pending} hint={`${urgent} 条 P0/P1`} tone="amber" />
        <AdminMetric icon={<CheckCircle2 size={22} />} label="平均评分" value={average(feedbacks.map((item) => item.rating)) || "-"} hint={`${unusable} 条不可用`} tone="green" />
        <AdminMetric icon={<DatabaseZap size={22} />} label="已转样本" value={converted} hint="可回流评测池" tone="violet" />
      </div>

      <AdminToolbar
        right={<button className="admin-primary-btn" onClick={() => void loadFeedback()} disabled={loading}>{loading ? <Loader2 className="spin-icon" size={16} /> : <RefreshCw size={16} />}刷新反馈</button>}
      >
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索反馈内容、标签、作品或用户..." />
        <SelectFilter value={stage} onChange={(value) => setStage(value as typeof stage)} options={["all", "script", "character", "storyboard", "image", "video"]} labels={{ all: "全部阶段", script: "剧本", character: "角色", storyboard: "分镜", image: "图片", video: "视频" }} />
        <SelectFilter value={usability} onChange={(value) => setUsability(value as typeof usability)} options={["all", "usable", "barely_usable", "unusable"]} labels={{ all: "全部可用性", usable: "可用", barely_usable: "勉强可用", unusable: "不可用" }} />
        <SelectFilter value={status} onChange={(value) => setStatus(value as typeof status)} options={["all", "open", "triaged", "processing", "resolved", "converted", "ignored"]} labels={{ all: "全部状态", open: "待处理", triaged: "已分诊", processing: "处理中", resolved: "已解决", converted: "已转样本", ignored: "忽略" }} />
        <SelectFilter value={priority} onChange={(value) => setPriority(value as typeof priority)} options={["all", "p0", "p1", "p2", "p3"]} labels={{ all: "全部优先级", p0: "P0 阻塞", p1: "P1 高", p2: "P2 中", p3: "P3 低" }} />
      </AdminToolbar>

      <div className="feedback-tag-summary">
        {topTags.length ? topTags.map((item) => <button key={item.tag} type="button" onClick={() => setKeyword(item.tag)}>{item.tag}<span>{item.count}</span></button>) : <span>暂无高频标签</span>}
      </div>
      {error ? <p className="admin-toast danger">{error}</p> : null}

      <div className="feedback-workbench-grid">
        <div className="feedback-ops-list">
          {rows.map((feedback) => {
            const project = feedback.projectId ? projectById.get(feedback.projectId) : undefined;
            return (
              <button className={feedback.id === selectedFeedback?.id ? "feedback-ops-card active" : "feedback-ops-card"} key={feedback.id} onClick={() => setSelectedId(feedback.id)} type="button">
                <div className="feedback-ops-head">
                  <span className={`feedback-priority ${feedback.priority}`}>{feedbackPriorityLabel(feedback.priority)}</span>
                  <strong>{project?.project.name ?? "未关联作品"}</strong>
                  <small>{stageLabel(feedback.stage)} · {feedback.rating} 分 · {formatDate(feedback.createdAt)}</small>
                </div>
                <p>{feedback.content || "用户未填写补充说明。"}</p>
                <div className="feedback-ops-tags">
                  <span>{feedbackStatusLabel(feedback.status)}</span>
                  <span>{feedbackUsabilityLabel(feedback.usability)}</span>
                  {(feedback.rootCause ? [feedback.rootCause] : feedback.tags).slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <div className="feedback-ops-meta">
                  <span>用户：{project?.userName ?? feedback.userId}</span>
                  {project?.averageScore ? <span>质检均分 {project.averageScore}</span> : null}
                </div>
              </button>
            );
          })}
          {!rows.length ? <EmptyHint text="暂无匹配反馈。刷新后仍为空，说明最近还没有用户提交该类问题。" /> : null}
        </div>

        <aside className="feedback-detail-panel">
          {selectedFeedback ? (
            <>
              <div className="feedback-detail-head">
                <div>
                  <span className={`feedback-priority ${draft.priority}`}>{feedbackPriorityLabel(draft.priority)}</span>
                  <h2>{projectById.get(selectedFeedback.projectId ?? "")?.project.name ?? "未关联作品"}</h2>
                  <p>{stageLabel(selectedFeedback.stage)} · {feedbackUsabilityLabel(selectedFeedback.usability)} · 来源 {selectedFeedback.source}</p>
                </div>
                <button className="admin-secondary-btn compact" type="button" onClick={() => window.location.hash = "评测闭环"}>进入质检池</button>
              </div>
              <blockquote>{selectedFeedback.content || "用户未填写补充说明。"}</blockquote>
              <div className="feedback-detail-meta">
                <span>ID：{selectedFeedback.id}</span>
                <span>用户：{projectById.get(selectedFeedback.projectId ?? "")?.userName ?? selectedFeedback.userId}</span>
                <span>创建：{formatDate(selectedFeedback.createdAt)}</span>
                {selectedFeedback.processedAt ? <span>处理：{formatDate(selectedFeedback.processedAt)}</span> : null}
              </div>
              <div className="feedback-edit-grid">
                <label><span>处理状态</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as UserFeedback["status"] })}>{feedbackStatusOptions.map((item) => <option key={item} value={item}>{feedbackStatusLabel(item)}</option>)}</select></label>
                <label><span>优先级</span><select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as UserFeedback["priority"] })}>{feedbackPriorityOptions.map((item) => <option key={item} value={item}>{feedbackPriorityLabel(item)}</option>)}</select></label>
                <label><span>根因归类</span><select value={draft.rootCause} onChange={(event) => setDraft({ ...draft, rootCause: event.target.value })}>{feedbackRootCauseOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label><span>负责人</span><input value={draft.assignee} onChange={(event) => setDraft({ ...draft, assignee: event.target.value })} placeholder="运营/产品/研发姓名" /></label>
              </div>
              <label className="feedback-resolution-field">
                <span>处理结论</span>
                <textarea value={draft.resolution} onChange={(event) => setDraft({ ...draft, resolution: event.target.value })} placeholder="记录排查结论、修复方案、是否需要补偿或回流评测。" />
              </label>
              <div className="feedback-ops-actions sticky">
                <button className="admin-secondary-btn compact" disabled={handlingId === selectedFeedback.id} onClick={() => void saveFeedback({ status: "processing", priority: draft.priority, rootCause: draft.rootCause, assignee: draft.assignee, resolution: draft.resolution })} type="button">标记处理中</button>
                <button className="admin-secondary-btn compact" disabled={handlingId === selectedFeedback.id} onClick={() => void saveFeedback({ status: "converted", priority: draft.priority, rootCause: draft.rootCause || inferRootCause(selectedFeedback), assignee: draft.assignee, resolution: draft.resolution || "已纳入下一轮评测样本池，后续用于提示词/模型路由归因。" })} type="button">转评测样本</button>
                <button className="admin-primary-btn compact" disabled={handlingId === selectedFeedback.id} onClick={() => void saveFeedback({ status: draft.status, priority: draft.priority, rootCause: draft.rootCause, assignee: draft.assignee, resolution: draft.resolution })} type="button">{handlingId === selectedFeedback.id ? <Loader2 className="spin-icon" size={15} /> : <FilePenLine size={15} />}保存处理</button>
              </div>
            </>
          ) : <EmptyHint text="请选择一条反馈进行处理。" />}
        </aside>
      </div>
    </section>
  );
}

function UsersSection({
  users,
  onCreateUser,
  onUserSave,
  onPasswordReset,
  onCreditAdjust
}: {
  users: AdminUserRow[];
  onCreateUser: (input: { name: string; email?: string; phone?: string; password: string; role?: string; status?: string; initialCredits?: number }) => void;
  onUserSave: (userId: string, input: Partial<Pick<AdminUserRow, "name" | "role" | "status">>) => void;
  onPasswordReset: (userId: string, password: string) => void;
  onCreditAdjust: (input: { userId: string; amount: number; description: string }) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const rows = users.filter((user) => {
    const matchedKeyword = [user.name, user.email, user.phone, user.id].filter(Boolean).join(" ").toLowerCase().includes(keyword.toLowerCase());
    const matchedRole = role === "all" || user.role === role;
    const matchedStatus = status === "all" || user.status === status;
    return matchedKeyword && matchedRole && matchedStatus;
  });

  return (
    <section className="admin-v2-section">
      <AdminUserCreator onCreate={onCreateUser} />
      <AdminToolbar>
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索用户、邮箱、手机号..." />
        <SelectFilter value={role} onChange={setRole} options={["all", "creator", "admin", "operator", "finance", "support"]} labels={{ all: "全部角色" }} />
        <SelectFilter value={status} onChange={setStatus} options={["all", "active", "disabled"]} labels={{ all: "全部状态" }} />
      </AdminToolbar>
      <div className="admin-user-management-table">
        <div className="admin-user-management-head">
          <span>用户</span>
          <span>手机号</span>
          <span>身份</span>
          <span>状态</span>
          <span>积分余额</span>
          <span>累计充值</span>
          <span>累计消耗</span>
          <span>项目</span>
          <span>密码</span>
          <span>操作</span>
        </div>
        {rows.map((user) => (
          <UserRow key={user.id} user={user} onUserSave={onUserSave} onPasswordReset={onPasswordReset} onCreditAdjust={onCreditAdjust} />
        ))}
        {!rows.length ? <EmptyHint text="没有匹配的用户。" /> : null}
      </div>
      <TableFooter total={rows.length} />
    </section>
  );
}

function EvaluationRecordsCard({
  runs,
  datasets,
  onDeleteRun,
  onDeleteDataset,
  onRefresh
}: {
  runs: EvaluationRun[];
  datasets: EvaluationDataset[];
  onDeleteRun: (id: string) => Promise<void>;
  onDeleteDataset: (id: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const [deleting, setDeleting] = useState("");
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const visibleRuns = runs.slice(0, 12);
  const allVisibleSelected = visibleRuns.length > 0 && visibleRuns.every((run) => selectedRunIds.includes(run.id));

  useEffect(() => {
    setSelectedRunIds((current) => current.filter((id) => runs.some((run) => run.id === id)));
  }, [runs]);

  function toggleRun(id: string) {
    setSelectedRunIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleVisibleRuns() {
    setSelectedRunIds((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleRuns.some((run) => run.id === id));
      return [...new Set([...current, ...visibleRuns.map((run) => run.id)])];
    });
  }

  async function deleteRun(run: EvaluationRun) {
    if (!window.confirm(`确认删除评测记录「${run.name}」？本次运行生成的质检报告也会一起删除。`)) return;
    setDeleting(run.id);
    try {
      await onDeleteRun(run.id);
    } finally {
      setDeleting("");
    }
  }
  async function deleteDataset(dataset: EvaluationDataset) {
    if (!window.confirm(`确认删除样本集「${dataset.name}」？历史运行会保留当时的快照。`)) return;
    setDeleting(dataset.id);
    try {
      await onDeleteDataset(dataset.id);
    } finally {
      setDeleting("");
    }
  }
  async function exportRun(run: EvaluationRun) {
    setExportError("");
    setExporting(run.id);
    try {
      const blob = await api.exportEvaluationRunExcel(run.id);
      downloadBlob(blob, `${run.name.replace(/[\\/:*?"<>|]/g, "_")}.xls`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "单个评测记录导出失败");
    } finally {
      setExporting("");
    }
  }

  async function exportRuns(scope: "selected" | "all") {
    const ids = scope === "selected" ? selectedRunIds : undefined;
    if (scope === "selected" && !ids?.length) return;
    setExportError("");
    setExporting(scope);
    try {
      const blob = await api.exportEvaluationRunsExcel(ids);
      downloadBlob(blob, scope === "selected" ? `评测记录_已选${ids!.length}条.xls` : "评测记录_全部.xls");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "评测记录导出失败");
    } finally {
      setExporting("");
    }
  }

  return (
    <article className="admin-v2-card evaluation-snapshot-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>评测记录</h2>
          <p>每次运行都会保存样本、阶段、模式、评测模型、预算和结果摘要，用来复盘哪一轮改动真的变好。</p>
        </div>
        <div className="admin-row-actions">
          <button className="admin-secondary-btn compact" disabled={!selectedRunIds.length || exporting === "selected"} onClick={() => void exportRuns("selected")}>
            {exporting === "selected" ? <Loader2 className="spin-icon" size={15} /> : <Download size={15} />}
            导出已选 {selectedRunIds.length || ""}
          </button>
          <button className="admin-secondary-btn compact" disabled={!runs.length || exporting === "all"} onClick={() => void exportRuns("all")}>
            {exporting === "all" ? <Loader2 className="spin-icon" size={15} /> : <Download size={15} />}
            导出全部
          </button>
          <button className="admin-icon-btn" onClick={() => void onRefresh()} title="刷新评测记录">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>
      <div className="export-scope-note">
        <strong>导出逻辑</strong>
        <span>默认下载 Excel 兼容的 UTF-16LE 表格，中文不会乱码；程序二次分析仍可调用 CSV 接口。</span>
      </div>
      {exportError ? <p className="admin-toast danger">{exportError}</p> : null}
      <div className="evaluation-dataset-compact-list">
        {datasets.slice(0, 6).map((dataset) => (
          <div key={dataset.id}>
            <strong>{dataset.name}</strong>
            <span>{dataset.sampleCount} 项 · {dataset.stages.map(stageLabel).join(" / ")}</span>
            <button className="admin-icon-btn danger" disabled={deleting === dataset.id} onClick={() => void deleteDataset(dataset)} title="删除样本集">
              {deleting === dataset.id ? <Loader2 className="spin-icon" size={15} /> : <Trash2 size={15} />}
            </button>
          </div>
        ))}
        {!datasets.length ? <small>暂无保存的样本集。</small> : null}
      </div>
      <div className="admin-table-wrap">
        <table className="admin-v2-table evaluation-runs-table">
          <thead><tr><th><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleRuns} /></th><th>运行</th><th>样本</th><th>模型</th><th>结果</th><th>LLM</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {visibleRuns.map((run) => (
              <tr key={run.id}>
                <td><input type="checkbox" checked={selectedRunIds.includes(run.id)} onChange={() => toggleRun(run.id)} /></td>
                <td><strong>{run.name}</strong><small>{new Date(run.startedAt).toLocaleString()}</small></td>
                <td><strong>{run.datasetName ?? "手动样本"}</strong><small>{run.projectIds.length} 项 · {run.stages.map(stageLabel).join(" / ")}</small></td>
                <td><span className="admin-chip">{modeLabel(run.mode)}</span><small>{run.evaluatorModels.map((item) => item.model).join(" / ") || "规则"}</small></td>
                <td><ScoreBadge score={run.summary.averageScore} /><small>{run.summary.passRate}% 通过 · {run.summary.reportCount} 报告</small></td>
                <td>{run.usage.llmCalls}/{run.maxLlmCalls}<small>{run.usage.llmFailures} 失败</small></td>
                <td><EvaluationRunStatusChip status={run.status} /></td>
                <td>
                  <div className="admin-row-actions">
                    <button className="admin-icon-btn" disabled={exporting === run.id} onClick={() => void exportRun(run)} title="导出 CSV">
                      {exporting === run.id ? <Loader2 className="spin-icon" size={15} /> : <Download size={15} />}
                    </button>
                    <button className="admin-icon-btn danger" disabled={deleting === run.id} onClick={() => void deleteRun(run)} title="删除评测记录">{deleting === run.id ? <Loader2 className="spin-icon" size={15} /> : <Trash2 size={15} />}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!runs.length ? <EmptyHint text="暂无评测记录。先在“运行评测”里选择样本并执行一次规则评分。" /> : null}
      </div>
    </article>
  );
}

function ProjectQualityPool({ projects, onDeleteQuality }: { projects: QualityProjectRow[]; onDeleteQuality: (projectId: string) => Promise<void> }) {
  const [deleting, setDeleting] = useState("");
  async function cleanProject(row: QualityProjectRow) {
    if (!window.confirm(`确认清理「${row.project.name}」的质检报告和用户反馈？不会删除作品本身。`)) return;
    setDeleting(row.project.id);
    try {
      await onDeleteQuality(row.project.id);
    } finally {
      setDeleting("");
    }
  }
  return (
    <article className="admin-v2-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>项目质检池</h2>
          <p>后台统一收集所有用户生成项目，用来筛选低分、不可用反馈和需要进入下一轮优化的作品。</p>
        </div>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-v2-table">
          <thead><tr><th>作品</th><th>用户</th><th>阶段</th><th>均分</th><th>反馈</th><th>待优化点</th><th>操作</th></tr></thead>
          <tbody>
            {projects.map((row) => (
              <tr key={row.project.id}>
                <td><strong>{row.project.name}</strong><small>{row.project.type} · {row.project.updatedAt.slice(0, 10)}</small></td>
                <td><strong>{row.userName}</strong><small>{row.userEmail ?? "未绑定邮箱"}</small></td>
                <td><span className="admin-chip">{stageLabel(row.latestStage)}</span></td>
                <td><ScoreBadge score={row.averageScore} /></td>
                <td>{row.feedbacks.length} 条</td>
                <td><div className="quality-reason-list">{row.blockedReasons.slice(0, 3).map((reason) => <span key={reason}>{reason}</span>)}{!row.blockedReasons.length ? <small>暂无明显阻塞</small> : null}</div></td>
                <td><button className="admin-text-btn danger" disabled={deleting === row.project.id} onClick={() => void cleanProject(row)}>{deleting === row.project.id ? "清理中" : "清理质检"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!projects.length ? <EmptyHint text="暂无项目质检数据。" /> : null}
      </div>
    </article>
  );
}

function ModelQualityCard({ modelQuality, providers }: { modelQuality: NonNullable<EvaluationOverview["modelQuality"]>; providers: ModelProvider[] }) {
  const [keyword, setKeyword] = useState("");
  const [stage, setStage] = useState("all");
  const filtered = modelQuality.filter((row) => {
    const matchedKeyword = `${row.provider} ${row.model}`.toLowerCase().includes(keyword.toLowerCase());
    const matchedStage = stage === "all" || row.stage === stage;
    return matchedKeyword && matchedStage;
  });
  const groups = groupModelQuality(filtered);
  const totals = {
    providers: groups.length,
    models: filtered.length,
    tasks: filtered.reduce((sum, row) => sum + row.tasks, 0),
    credits: filtered.reduce((sum, row) => sum + row.credits, 0)
  };
  const providerByName = new Map(providers.flatMap((provider) => [[provider.name, provider], [provider.id, provider]]));
  return (
    <article className="admin-v2-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>模型表现</h2>
          <p>同一模型同时看成功率、平均质量分和积分消耗，避免只凭主观体验选模型。</p>
        </div>
      </div>
      <div className="model-quality-summary">
        <MetricPill label="渠道" value={totals.providers} strong />
        <MetricPill label="模型记录" value={totals.models} />
        <MetricPill label="任务" value={totals.tasks} />
        <MetricPill label="积分" value={totals.credits} />
      </div>
      <AdminToolbar>
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索渠道或模型..." />
        <SelectFilter value={stage} onChange={setStage} options={["all", "script", "character", "storyboard", "image", "video"]} labels={{ all: "全部阶段", script: "剧本", character: "角色", storyboard: "分镜", image: "图片", video: "视频" }} />
      </AdminToolbar>
      <div className="model-quality-provider-grid refined">
        {groups.map((group) => (
          <article key={group.provider} className="model-quality-provider-card">
            <div className="model-quality-provider-head">
              <AdminProviderIcon provider={providerByName.get(group.provider)} fallback={group.provider} />
              <div>
                <strong>{group.provider}</strong>
                <span>{group.models.length} 个模型 · {group.tasks} 次任务</span>
              </div>
            </div>
            <div className="model-quality-provider-metrics">
              <MetricPill label="平均成功率" value={`${group.successRate}%`} strong />
              <MetricPill label="质量均分" value={group.averageScore || "-"} />
              <MetricPill label="积分" value={group.credits} />
            </div>
            <div className="model-quality-model-list">
              {group.models.map((row) => (
                <div key={`${row.model}-${row.stage}`}>
                  <strong>{row.model}</strong>
                  <span>{stageLabel(row.stage as EvaluationStage)} · 成功 {row.successRate}% · 质量 {row.averageScore || "-"} · {row.credits} 积分</span>
                  <div className="model-quality-bars">
                    <i style={{ width: `${Math.min(100, row.successRate)}%` }} />
                    <b style={{ width: `${Math.min(100, row.averageScore || 0)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
        {!groups.length ? <EmptyHint text="暂无模型质量数据。" /> : null}
      </div>
    </article>
  );
}

function RedeemSection({
  redeemCodes,
  onBatchCreate,
  onSave,
  onDelete
}: {
  redeemCodes: RedeemCode[];
  onBatchCreate: (input: { name: string; prefix: string; credits: number; count: number; enabled?: boolean }) => void;
  onSave: (id: string, input: Partial<Pick<RedeemCode, "name" | "code" | "credits" | "maxRedemptions" | "enabled">> & { startsAt?: string | null; endsAt?: string | null }) => void;
  onDelete: (id: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("unused");
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const rows = redeemCodes.filter((code) => {
    const matchedKeyword = `${code.code} ${code.name} ${code.batchId ?? ""}`.toLowerCase().includes(keyword.toLowerCase());
    const codeStatus = redeemStatus(code);
    const matchedStatus =
      status === "all" ||
      (status === "unused" && code.usedCount === 0 && codeStatus === "active") ||
      (status === "used" && code.usedCount > 0) ||
      codeStatus === status;
    return matchedKeyword && matchedStatus;
  });
  const batches = groupRedeemCodes(rows);
  const used = redeemCodes.reduce((sum, code) => sum + code.usedCount, 0);
  async function batchToggle(codes: RedeemCode[], enabled: boolean) {
    const target = codes.filter((code) => code.enabled !== enabled);
    for (const code of target) {
      await onSave(code.id, { enabled });
    }
  }

  async function batchDeleteUnused(codes: RedeemCode[]) {
    const unused = codes.filter((code) => code.usedCount === 0);
    if (!unused.length) return;
    if (!window.confirm(`确认删除 ${unused.length} 个未使用兑换码？已使用记录不会被删除。`)) return;
    for (const code of unused) {
      await onDelete(code.id);
    }
  }

  return (
    <section className="admin-v2-section">
      <div className="admin-v2-metrics small">
        <AdminMetric icon={<Gift size={20} />} label="兑换码总数" value={redeemCodes.length} hint="后台记录" tone="blue" />
        <AdminMetric icon={<ShieldCheck size={20} />} label="启用中" value={redeemCodes.filter((item) => item.enabled).length} hint="前台可用" tone="green" />
        <AdminMetric icon={<WalletCards size={20} />} label="已兑换次数" value={used} hint="累计使用" tone="amber" />
        <AdminMetric icon={<CircleDollarSign size={20} />} label="平均额度" value={averageCredits(redeemCodes)} hint="积分/码" tone="violet" />
      </div>
      <RedeemBatchCreator onCreate={onBatchCreate} />
      <AdminToolbar>
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索兑换码、活动名、批次..." />
        <SelectFilter value={status} onChange={setStatus} options={["unused", "all", "used", "active", "used_up", "scheduled", "expired", "disabled"]} labels={{ unused: "默认：未使用", all: "全部状态", used: "已使用", active: "可用", used_up: "已用完", scheduled: "未开始", expired: "已过期", disabled: "停用" }} />
      </AdminToolbar>
      <div className="admin-redeem-batch-list">
        {batches.map((batch) => (
          <RedeemBatchCard
            key={batch.id}
            batch={batch}
            expanded={expandedBatch === batch.id}
            onToggleExpand={() => setExpandedBatch(expandedBatch === batch.id ? null : batch.id)}
            onSave={onSave}
            onDelete={onDelete}
            onBatchEnable={() => void batchToggle(batch.codes, true)}
            onBatchDisable={() => void batchToggle(batch.codes, false)}
            onBatchDeleteUnused={() => void batchDeleteUnused(batch.codes)}
          />
        ))}
      </div>
      <TableFooter total={rows.length} />
    </section>
  );
}

function PlansSection({
  plans,
  onCreate,
  onSave,
  onDelete
}: {
  plans: Plan[];
  onCreate: (input: Pick<Plan, "name" | "price" | "credits" | "bonusCredits" | "badge" | "features" | "shopUrl" | "enabled">) => void;
  onSave: (id: string, input: Partial<Pick<Plan, "name" | "price" | "credits" | "bonusCredits" | "badge" | "features" | "shopUrl" | "enabled">>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="admin-v2-section">
      <PlanCreator onCreate={onCreate} />
      <div className="admin-table-wrap">
        <table className="admin-v2-table admin-plans-table">
          <thead>
            <tr>
              <th>套餐</th>
              <th>售价</th>
              <th>到账积分</th>
              <th>赠送</th>
              <th>标签</th>
              <th>卖点</th>
              <th>店铺链接</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <PlanRow key={plan.id} plan={plan} onSave={onSave} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      </div>
      <TableFooter total={plans.length} />
    </section>
  );
}

function MembershipSection({
  plans,
  onCreate,
  onSave,
  onDelete
}: {
  plans: MembershipPlan[];
  onCreate: (input: Pick<MembershipPlan, "name" | "monthlyPrice" | "monthlyCredits" | "discountPercent" | "priorityLevel" | "badge" | "features" | "shopUrl" | "enabled">) => void;
  onSave: (id: string, input: Partial<Pick<MembershipPlan, "name" | "monthlyPrice" | "monthlyCredits" | "discountPercent" | "priorityLevel" | "badge" | "features" | "shopUrl" | "enabled">>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="admin-v2-section">
      <MembershipCreator onCreate={onCreate} />
      <div className="admin-table-wrap">
        <table className="admin-v2-table admin-membership-table">
          <thead>
            <tr>
              <th>会员</th>
              <th>月费</th>
              <th>月额度</th>
              <th>折扣</th>
              <th>队列</th>
              <th>权益</th>
              <th>店铺链接</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <MembershipRow key={plan.id} plan={plan} onSave={onSave} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      </div>
      <TableFooter total={plans.length} />
    </section>
  );
}

function ProvidersSection({
  providers,
  relayPolicy,
  testResult,
  imageTestResult,
  videoTestResult,
  providerTests,
  openSourceAdapters,
  visualPipelines,
  pipelineTests,
  onLoadRelayPolicy,
  onLoadPluginStatus,
  onTestPipeline,
  onCreate,
  onSave,
  onDelete,
  onTest
}: {
  providers: ModelProvider[];
  relayPolicy: RelayGatewayPolicy | null;
  testResult: ModelTestResult | null;
  imageTestResult: ImageModelTestResult | null;
  videoTestResult: VideoModelTestResult | null;
  providerTests: Record<string, ProviderTestState>;
  openSourceAdapters: OpenSourceAdapterInfo[];
  visualPipelines: VisualPipelineDescriptor[];
  pipelineTests: Record<string, PipelineTestState>;
  onLoadRelayPolicy: () => void;
  onLoadPluginStatus: () => void;
  onTestPipeline: (pipelineId: string) => void;
  onCreate: (input: Pick<ModelProvider, "name" | "modality" | "enabled" | "baseUrl" | "models" | "costHint"> & { id?: string; iconUrl?: string; apiKey?: string; routing?: { mode?: "auto" | "manual"; preferredModel?: string; modelPool?: string[] }; unitCredits?: number; vendorCostCny?: number }) => void;
  onSave: (id: string, input: Partial<Pick<ModelProvider, "name" | "modality" | "enabled" | "baseUrl" | "iconUrl" | "models" | "costHint">> & { apiKey?: string | null; routing?: { mode?: "auto" | "manual"; preferredModel?: string; modelPool?: string[] } }) => void;
  onDelete: (id: string) => void;
  onTest: (provider: ModelProvider, model: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [modality, setModality] = useState("all");
  const [status, setStatus] = useState("all");
  const rows = providers.filter((provider) => {
    const matchedKeyword = `${provider.name} ${provider.id} ${provider.models.join(" ")}`.toLowerCase().includes(keyword.toLowerCase());
    const matchedModality = modality === "all" || provider.modality === modality;
    const matchedStatus = status === "all" || (status === "enabled" ? provider.enabled : !provider.enabled);
    return matchedKeyword && matchedModality && matchedStatus;
  });

  return (
    <section className="admin-v2-section">
      <ProviderCreator onCreate={onCreate} />
      <OpenSourcePipelinePanel
        adapters={openSourceAdapters}
        pipelines={visualPipelines}
        tests={pipelineTests}
        onRefresh={onLoadPluginStatus}
        onTest={onTestPipeline}
      />
      <AdminToolbar right={<button className="admin-primary-btn" onClick={onLoadRelayPolicy}><SlidersHorizontal size={18} />网关策略</button>}>
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索供应商、模型..." />
        <SelectFilter value={modality} onChange={setModality} options={["all", "text", "image", "video", "tts", "embedding"]} labels={{ all: "全部类型" }} />
        <SelectFilter value={status} onChange={setStatus} options={["all", "enabled", "disabled"]} labels={{ all: "全部状态", enabled: "启用", disabled: "停用" }} />
      </AdminToolbar>
      {relayPolicy ? <RelayGatewayPreview policy={relayPolicy} /> : null}
      <div className="admin-provider-card-list">
        {rows.map((provider) => (
          <ProviderRow key={provider.id} provider={provider} testStates={providerTests} onSave={onSave} onDelete={onDelete} onTest={onTest} />
        ))}
      </div>
      <TableFooter total={rows.length} />
    </section>
  );
}

function PromptScoringSection({
  templates,
  onCreate,
  onSave,
  onDelete
}: {
  templates: PromptTemplate[];
  onCreate: (input: Pick<PromptTemplate, "name" | "type" | "version" | "enabled" | "summary" | "content">) => AdminActionResult;
  onSave: (id: string, input: Partial<Pick<PromptTemplate, "name" | "type" | "version" | "enabled" | "summary" | "content">>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const stageTemplates = evaluationPromptTemplates(templates);
  const [activeStage, setActiveStage] = useState<EvaluationStage>(stageTemplates[0]?.stage ?? "script");
  const active = stageTemplates.find((item) => item.stage === activeStage) ?? stageTemplates[0];
  return (
    <section className="admin-v2-section prompt-scoring-section">
      <div className="admin-v2-metrics small">
        <AdminMetric icon={<FilePenLine size={20} />} label="评分模板" value={stageTemplates.length} hint="按阶段管理" tone="blue" />
        <AdminMetric icon={<CheckCircle2 size={20} />} label="启用模板" value={stageTemplates.filter((item) => item.template.enabled).length} hint="LLM 评测优先使用" tone="green" />
        <AdminMetric icon={<ChartNoAxesCombined size={20} />} label="评分维度" value={stageTemplates.reduce((sum, item) => sum + item.dimensions.length, 0)} hint="规则 + LLM 双通道" tone="amber" />
        <AdminMetric icon={<ShieldCheck size={20} />} label="输出约束" value="JSON" hint="便于自动入库复盘" tone="violet" />
      </div>
      <div className="prompt-scoring-layout">
        <aside className="prompt-stage-list">
          {stageTemplates.map((item) => (
            <button type="button" key={item.stage} className={activeStage === item.stage ? "active" : ""} onClick={() => setActiveStage(item.stage)}>
              <strong>{stageLabel(item.stage)}</strong>
              <span>{item.template.enabled ? "启用" : "停用"} · {item.template.version}</span>
              <small>{item.template.summary}</small>
            </button>
          ))}
        </aside>
        {active ? <PromptTemplateEditor item={active} onCreate={onCreate} onSave={onSave} onDelete={onDelete} /> : <EmptyHint text="暂无评分模板。" />}
      </div>
    </section>
  );
}

function OpenSourcePipelinePanel({
  adapters,
  pipelines,
  tests,
  onRefresh,
  onTest
}: {
  adapters: OpenSourceAdapterInfo[];
  pipelines: VisualPipelineDescriptor[];
  tests: Record<string, PipelineTestState>;
  onRefresh: () => void;
  onTest: (pipelineId: string) => void;
}) {
  return (
    <section className="admin-plugin-panel">
      <div className="admin-plugin-head">
        <div>
          <h3>开源 Agent 与视觉插件</h3>
          <p>Toonflow 负责编剧/分镜拆解，LingGuo 负责配音、字幕、合成和外部视觉插件编排；缺 Key 的插件只显示待配置，不会假装成功。</p>
        </div>
        <button className="admin-icon-btn" onClick={onRefresh} title="刷新插件状态"><RefreshCw size={16} /></button>
      </div>
      <div className="admin-plugin-grid">
        <div className="admin-plugin-column">
          <strong>已内嵌能力</strong>
          {adapters.length ? adapters.map((adapter) => (
            <article className="admin-adapter-card" key={adapter.id}>
              <div>
                <b>{adapter.name}</b>
                <span>{adapter.sourceRepo}</span>
              </div>
              <p>{adapter.capabilities.slice(0, 5).join(" / ")}</p>
            </article>
          )) : <p className="admin-muted">正在读取适配器状态...</p>}
        </div>
        <div className="admin-plugin-column wide">
          <strong>可插拔模型/后期能力</strong>
          <div className="admin-pipeline-list">
            {pipelines.map((pipeline) => {
              const test = tests[pipeline.id];
              const result = test?.result;
              return (
                <article className="admin-pipeline-row" key={pipeline.id}>
                  <div>
                    <b>{pipeline.name}</b>
                    <span>{pipelineKindLabel(pipeline.kind)} · {pipeline.defaultModel || "待配置模型"}</span>
                    <small>{result?.message || pipeline.message}</small>
                  </div>
                  <div className="admin-pipeline-meta">
                    <span className={`admin-pipeline-status ${result ? (result.ok ? "ready" : "failed") : pipeline.status}`}>{result ? (result.ok ? "可用" : "失败") : pipelineStatusLabel(pipeline.status)}</span>
                    <button className="admin-icon-btn" disabled={test?.loading} onClick={() => onTest(pipeline.id)} title="测试配置">
                      {test?.loading ? <Loader2 className="spin-icon" size={15} /> : <PlayCircle size={15} />}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function PromptTemplateEditor({
  item,
  onCreate,
  onSave,
  onDelete
}: {
  item: ReturnType<typeof evaluationPromptTemplates>[number];
  onCreate: (input: Pick<PromptTemplate, "name" | "type" | "version" | "enabled" | "summary" | "content">) => AdminActionResult;
  onSave: (id: string, input: Partial<Pick<PromptTemplate, "name" | "type" | "version" | "enabled" | "summary" | "content">>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const [draft, setDraft] = useState(() => promptDraftFromTemplate(item.template));
  useEffect(() => {
    setDraft(promptDraftFromTemplate(item.template));
  }, [item.template.id]);
  const dirty =
    draft.name !== item.template.name ||
    draft.version !== item.template.version ||
    draft.enabled !== item.template.enabled ||
    draft.summary !== item.template.summary ||
    draft.content !== (item.template.content ?? item.fallbackContent);
  const isMissingTemplate = item.template.id.startsWith("missing_");
  function saveTemplate() {
    const payload = { ...draft, type: item.stage };
    return isMissingTemplate ? onCreate(payload) : onSave(item.template.id, payload);
  }
  return (
    <article className="admin-v2-card prompt-editor-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>{stageLabel(item.stage)}评测提示词</h2>
          <p>用于 LLM 评测：先按规则评分，再用所选模型做抽样复核；输出必须是可入库 JSON。</p>
        </div>
        <div className="admin-row-actions">
          <button className="admin-icon-btn" title={draft.enabled ? "停用" : "启用"} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>
            {draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          </button>
          <button className={dirty || isMissingTemplate ? "admin-text-btn primary" : "admin-text-btn"} disabled={!dirty && !isMissingTemplate} onClick={() => saveTemplate()}>{isMissingTemplate ? "创建" : "保存"}</button>
          <button className="admin-icon-btn danger" disabled={isMissingTemplate} title="停用模板" onClick={() => { if (window.confirm("确认停用该评分提示词？")) onDelete(item.template.id); }}><Trash2 size={16} /></button>
        </div>
      </div>
      <div className="prompt-editor-meta">
        <label><span>名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label><span>版本</span><input value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} /></label>
        <label className="wide"><span>摘要</span><input value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
      </div>
      <div className="prompt-rubric-grid">
        <div>
          <strong>推荐评分维度</strong>
          <div className="prompt-dimension-list">
            {item.dimensions.map((dimension) => <span key={dimension}>{dimension}</span>)}
          </div>
        </div>
        <div>
          <strong>建议动作</strong>
          <div className="prompt-dimension-list actions">
            {item.actions.map((action) => <span key={action}>{action}</span>)}
          </div>
        </div>
      </div>
      <label className="prompt-content-editor">
        <span>评分标准与提示词正文</span>
        <textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
      </label>
      <div className="prompt-output-contract">
        <strong>输出约束</strong>
        <code>{`{ "totalScore": 0-100, "pass": boolean, "dimensionScores": {}, "mainProblems": [], "suggestedFixes": [], "recommendedAction": "..." }`}</code>
      </div>
    </article>
  );
}
function PricesSection({
  prices,
  providers,
  onCreate,
  onSave,
  onDelete
}: {
  prices: ModelPrice[];
  providers: ModelProvider[];
  onCreate: (input: Pick<ModelPrice, "providerName" | "modality" | "model" | "unit" | "unitCredits" | "vendorCostCny" | "enabled"> & { providerId?: string }) => AdminActionResult;
  onSave: (id: string, input: Partial<Pick<ModelPrice, "unitCredits" | "vendorCostCny" | "enabled">>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const [keyword, setKeyword] = useState("");
  const [modality, setModality] = useState("all");
  const [status, setStatus] = useState("all");
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const rows = prices.filter((price) => {
    const matchedKeyword = `${price.providerName} ${price.model}`.toLowerCase().includes(keyword.toLowerCase());
    const matchedModality = modality === "all" || price.modality === modality;
    const matchedStatus = status === "all" || (status === "enabled" ? price.enabled : !price.enabled);
    return matchedKeyword && matchedModality && matchedStatus;
  });
  const grouped = groupPricesByProvider(rows);

  return (
    <section className="admin-v2-section">
      <PriceCreator providers={providers} onCreate={onCreate} />
      <AdminToolbar>
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索供应商或模型..." />
        <SelectFilter value={modality} onChange={setModality} options={["all", "text", "image", "video", "tts", "embedding"]} labels={{ all: "全部类型" }} />
        <SelectFilter value={status} onChange={setStatus} options={["all", "enabled", "disabled"]} labels={{ all: "全部状态", enabled: "启用", disabled: "停用" }} />
      </AdminToolbar>
      <div className="admin-price-provider-list">
        {grouped.map((group) => (
          <PriceProviderCard
            key={group.provider}
            group={group}
            expanded={expandedProvider === group.provider}
            onToggleExpand={() => setExpandedProvider(expandedProvider === group.provider ? null : group.provider)}
            onSave={onSave}
            onDelete={onDelete}
          />
        ))}
      </div>
      <TableFooter total={rows.length} />
    </section>
  );
}

function AdminMetric({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: ReactNode; hint: string; tone: "blue" | "green" | "amber" | "violet" }) {
  return (
    <article className={`admin-v2-metric ${tone}`}>
      <div className="admin-v2-metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </article>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const level = score >= 80 ? "good" : score >= 60 ? "warn" : "bad";
  return <span className={`score-badge ${level}`}>{score || "-"}{score ? "分" : ""}</span>;
}

function stageLabel(stage: QualityProjectRow["latestStage"]) {
  const labels: Record<string, string> = {
    script: "剧本",
    character: "角色",
    storyboard: "分镜",
    image: "图片",
    video: "视频",
    none: "未评测"
  };
  return labels[stage] ?? stage;
}

function modeLabel(mode: "rules" | "hybrid" | "llm") {
  const labels = {
    rules: "规则评分",
    hybrid: "规则 + LLM",
    llm: "LLM 对比"
  };
  return labels[mode];
}

function modalityLabel(value: string) {
  const labels: Record<string, string> = {
    text: "文本",
    image: "生图",
    video: "视频",
    tts: "配音",
    embedding: "向量"
  };
  return labels[value] ?? value;
}

function unitLabel(value: string) {
  const labels: Record<string, string> = {
    text_run: "每次文本生成",
    image: "每张图片",
    image2: "每张图生图",
    video_second: "每秒视频",
    tts_character: "每字符配音",
    export: "每次导出"
  };
  return labels[value] ?? value;
}

function defaultUnitLabelValue(modality: string) {
  if (modality === "image") return "image";
  if (modality === "video") return "video_second";
  if (modality === "tts") return "tts_character";
  return "text_run";
}

function PolicyItem({ title, body }: { title: string; body: string }) {
  return (
    <article>
      <strong>{title}</strong>
      <span>{body}</span>
    </article>
  );
}

function AdminToolbar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="admin-v2-toolbar">
      <div className="admin-v2-filters">{children}</div>
      {right ? <div className="admin-v2-toolbar-right">{right}</div> : null}
    </div>
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="admin-search-field">
      <Search size={18} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function SelectFilter({ value, onChange, options, labels = {} }: { value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) {
  return (
    <select className="admin-filter-select" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((item) => <option key={item} value={item}>{labels[item] ?? item}</option>)}
    </select>
  );
}

function AdminProviderIcon({ provider, fallback }: { provider?: Pick<ModelProvider, "name" | "modality" | "iconUrl">; fallback?: string }) {
  const label = (provider?.name || fallback || "M").slice(0, 1).toUpperCase();
  return (
    <span className={`admin-provider-icon ${provider?.modality ?? "text"}`}>
      {provider?.iconUrl ? <img src={provider.iconUrl} alt={provider.name || fallback || "模型"} /> : label}
    </span>
  );
}

function readAdminImageFile(file?: File) {
  if (!file || !file.type.startsWith("image/")) return Promise.resolve("");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图标读取失败"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

const adminRoleLabels: Record<string, string> = {
  creator: "创作者",
  admin: "超级管理员",
  operator: "运营",
  finance: "财务",
  support: "客服"
};

const adminStatusLabels: Record<string, string> = {
  active: "正常",
  disabled: "停用"
};

function userIdentityLabel(user: AdminUserRow) {
  if (user.role !== "creator") return adminRoleLabels[user.role] ?? user.role;
  if (user.totalRecharge > 0) return "购买者";
  if (user.totalConsume > 0 || user.projects > 0) return "创作者";
  return "体验用户";
}

function AdminUserCreator({
  onCreate
}: {
  onCreate: (input: { name: string; email?: string; phone?: string; password: string; role?: string; status?: string; initialCredits?: number }) => void;
}) {
  const [draft, setDraft] = useState({
    name: "新用户",
    email: "",
    phone: "",
    password: "user123456",
    role: "creator",
    initialCredits: "300"
  });
  return (
    <div className="admin-create-strip admin-user-create-strip">
      <div>
        <strong>新建用户账号</strong>
        <span>创建后立即可登录，初始积分会写入流水。</span>
      </div>
      <label className="admin-create-field"><span>用户名</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：新用户" /></label>
      <label className="admin-create-field"><span>邮箱</span><input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="例如：user@example.com" /></label>
      <label className="admin-create-field"><span>手机号</span><input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="例如：13800138000，可选" /></label>
      <label className="admin-create-field"><span>角色</span><select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}>
        <option value="creator">创作者</option>
        <option value="admin">超级管理员</option>
        <option value="operator">运营</option>
        <option value="finance">财务</option>
        <option value="support">客服</option>
      </select></label>
      <label className="admin-create-field"><span>初始积分</span><input type="number" value={draft.initialCredits} onChange={(event) => setDraft({ ...draft, initialCredits: event.target.value })} placeholder="例如：300" /></label>
      <label className="admin-create-field"><span>初始密码</span><input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder="至少 6 位" /></label>
      <button
        className="admin-primary-btn"
        disabled={!draft.name.trim() || (!draft.email.trim() && !draft.phone.trim()) || draft.password.length < 6}
        onClick={() => onCreate({
          name: draft.name,
          email: draft.email || undefined,
          phone: draft.phone || undefined,
          password: draft.password,
          role: draft.role,
          status: "active",
          initialCredits: Number(draft.initialCredits)
        })}
      >
        <UserRound size={18} />创建
      </button>
    </div>
  );
}

function UserRow({
  user,
  onUserSave,
  onPasswordReset,
  onCreditAdjust
}: {
  user: AdminUserRow;
  onUserSave: (userId: string, input: Partial<Pick<AdminUserRow, "name" | "role" | "status">>) => void;
  onPasswordReset: (userId: string, password: string) => void;
  onCreditAdjust: (input: { userId: string; amount: number; description: string }) => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [amount, setAmount] = useState("100");
  const [description, setDescription] = useState("运营补偿");
  const [password, setPassword] = useState("");
  const dirty = name !== user.name || role !== user.role || status !== user.status;
  const identity = userIdentityLabel({ ...user, role });
  return (
    <article className="admin-user-management-row">
      <div className="admin-user-account-cell">
        <input className="admin-user-name-input" value={name} onChange={(event) => setName(event.target.value)} aria-label="用户名" />
        <span>{user.email ?? "未绑定邮箱"}</span>
        <small>最近登录：{formatDate(user.lastLoginAt)}</small>
      </div>

      <span className="admin-user-muted-cell">{user.phone ?? "未绑定"}</span>

      <div className="admin-user-identity-cell">
        <strong>{identity}</strong>
        <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="用户角色">
          <option value="creator">创作者</option>
          <option value="admin">超级管理员</option>
          <option value="operator">运营</option>
          <option value="finance">财务</option>
          <option value="support">客服</option>
        </select>
      </div>

      <div className="admin-user-status-cell">
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="账号状态">
          <option value="active">正常</option>
          <option value="disabled">停用</option>
        </select>
        <StatusChip active={status === "active"} label={adminStatusLabels[status] ?? status} />
      </div>

      <div className="admin-user-credit-cell">
        <strong>{user.credits.toLocaleString()}</strong>
        <span>冻结 {user.frozenCredits.toLocaleString()}</span>
      </div>
      <span className="admin-user-number-cell">{user.totalRecharge.toLocaleString()}</span>
      <span className="admin-user-number-cell">{user.totalConsume.toLocaleString()}</span>
      <span className="admin-user-number-cell">{user.projects.toLocaleString()}</span>
      <StatusChip active={Boolean(user.hasPassword)} label={user.hasPassword ? "已设置" : "未设置"} />

      <details className="admin-user-action-drawer">
        <summary>管理</summary>
        <div className="admin-user-action-panel">
          <label>
            <span>重置密码</span>
            <div className="admin-inline-actions compact">
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入 6 位以上新密码" />
              <button className="admin-text-btn" disabled={password.length < 6} onClick={() => { onPasswordReset(user.id, password); setPassword(""); }}>重置</button>
            </div>
          </label>
          <label>
            <span>积分调整</span>
            <div className="admin-inline-actions compact triple">
              <input className="mini-number" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
              <input value={description} onChange={(event) => setDescription(event.target.value)} />
              <button className="admin-icon-btn teal" title="积分入账" onClick={() => onCreditAdjust({ userId: user.id, amount: Number(amount), description })}>
                <WalletCards size={16} />
              </button>
            </div>
          </label>
          <div className="admin-inline-actions compact">
            <button className={dirty ? "admin-text-btn primary" : "admin-text-btn"} disabled={!dirty} title="保存账号" onClick={() => onUserSave(user.id, { name, role, status })}>
              保存账号资料
            </button>
          </div>
        </div>
      </details>
    </article>
  );
}

function RedeemBatchCreator({ onCreate }: { onCreate: (input: { name: string; prefix: string; credits: number; count: number; enabled?: boolean }) => void }) {
  const [draft, setDraft] = useState({ name: "新用户体验码", prefix: "TRIAL", credits: "300", count: "20", enabled: true });
  return (
    <div className="admin-batch-strip">
      <div>
        <strong>批量生成唯一兑换码</strong>
        <span>每份不同 code，默认单个 code 可兑换 1 次。</span>
      </div>
      <label className="admin-create-field"><span>活动名</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：新用户体验码" /></label>
      <label className="admin-create-field"><span>前缀</span><input value={draft.prefix} onChange={(event) => setDraft({ ...draft, prefix: event.target.value.toUpperCase() })} placeholder="例如：TRIAL" /></label>
      <label className="admin-create-field"><span>积分/码</span><input type="number" value={draft.credits} onChange={(event) => setDraft({ ...draft, credits: event.target.value })} placeholder="例如：300" /></label>
      <label className="admin-create-field"><span>生成份数</span><input type="number" value={draft.count} onChange={(event) => setDraft({ ...draft, count: event.target.value })} placeholder="例如：20" /></label>
      <button className="admin-primary-btn" onClick={() => onCreate({ name: draft.name, prefix: draft.prefix, credits: Number(draft.credits), count: Number(draft.count), enabled: draft.enabled })}>
        <Gift size={18} />生成
      </button>
    </div>
  );
}

function RedeemBatchCard({
  batch,
  expanded,
  onToggleExpand,
  onSave,
  onDelete,
  onBatchEnable,
  onBatchDisable,
  onBatchDeleteUnused
}: {
  batch: ReturnType<typeof groupRedeemCodes>[number];
  expanded: boolean;
  onToggleExpand: () => void;
  onSave: (id: string, input: Partial<Pick<RedeemCode, "name" | "code" | "credits" | "maxRedemptions" | "enabled">> & { startsAt?: string | null; endsAt?: string | null }) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
  onBatchEnable: () => void;
  onBatchDisable: () => void;
  onBatchDeleteUnused: () => void;
}) {
  const used = batch.codes.reduce((sum, code) => sum + code.usedCount, 0);
  const active = batch.codes.filter((code) => redeemStatus(code) === "active").length;
  const disabled = batch.codes.filter((code) => !code.enabled).length;
  const expired = batch.codes.filter((code) => redeemStatus(code) === "expired").length;
  const unused = batch.codes.filter((code) => code.usedCount === 0).length;
  const previewCodes = batch.codes.slice(0, 20);
  const statusText = active ? `${active} 个可用` : disabled + expired ? `${disabled + expired} 个不可用` : "暂无可用";
  return (
    <article className="admin-redeem-batch-card compact">
      <div className="admin-redeem-batch-head">
        <button className="admin-icon-btn" onClick={onToggleExpand} title={expanded ? "收起批次" : "展开批次"}>
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <div className="admin-redeem-batch-title">
          <strong>{batch.name}</strong>
          <span>{batch.batchId ?? "历史单码"} / 前缀 {batch.prefix}</span>
        </div>
        <div className="admin-redeem-batch-summary">
          <span><b>{batch.codes.length}</b> 总数</span>
          <span><b>{unused}</b> 未使用</span>
          <span><b>{used}</b> 已兑换</span>
          <span><b>{batch.credits}</b> 积分/码</span>
          <StatusChip active={active > 0} label={statusText} />
        </div>
        <div className="admin-row-actions">
          <button className="admin-text-btn" onClick={onBatchEnable}>启用全部</button>
          <button className="admin-text-btn" onClick={onBatchDisable}>停用全部</button>
          <button className="admin-text-btn danger" disabled={!unused} onClick={onBatchDeleteUnused}>删除未使用</button>
        </div>
      </div>
      {expanded ? (
        <div className="admin-redeem-code-list">
          {batch.codes.length > previewCodes.length ? <p className="admin-list-note">当前批次共 {batch.codes.length} 个兑换码，先显示前 {previewCodes.length} 个；可用搜索进一步定位。</p> : null}
          <div className="admin-redeem-code-head">
            <span />
            <span>兑换码</span>
            <span>活动</span>
            <span>类型</span>
            <span>额度</span>
            <span>使用</span>
            <span>状态</span>
            <span>创建</span>
            <span>操作</span>
          </div>
          {previewCodes.map((code) => (
            <RedeemCodeRow key={code.id} code={code} onSave={onSave} onDelete={onDelete} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function RedeemCodeRow({
  code,
  onSave,
  onDelete
}: {
  code: RedeemCode;
  onSave: (id: string, input: Partial<Pick<RedeemCode, "name" | "code" | "credits" | "maxRedemptions" | "enabled">> & { startsAt?: string | null; endsAt?: string | null }) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const [draft, setDraft] = useState({
    code: code.code,
    name: code.name,
    credits: String(code.credits),
    maxRedemptions: String(code.maxRedemptions),
    enabled: code.enabled,
    startsAt: dateInputValue(code.startsAt),
    endsAt: dateInputValue(code.endsAt)
  });
  const status = redeemStatus(code);
  const dirty =
    draft.code !== code.code ||
    draft.name !== code.name ||
    Number(draft.credits) !== code.credits ||
    Number(draft.maxRedemptions) !== code.maxRedemptions ||
    draft.enabled !== code.enabled ||
    draft.startsAt !== dateInputValue(code.startsAt) ||
    draft.endsAt !== dateInputValue(code.endsAt);
  function copyCode() {
    void navigator.clipboard?.writeText(code.code);
  }
  return (
    <div className="admin-redeem-code-row compact">
      <span className="admin-row-check" aria-hidden="true" />
      <div className="admin-redeem-code-cell">
        <input className="code-input" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })} />
        <button className="admin-icon-btn subtle" type="button" title="复制兑换码" onClick={copyCode}><Copy size={15} /></button>
      </div>
      <input className="activity-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      <span className="admin-redeem-tag">积分</span>
      <input className="mini-number" type="number" value={draft.credits} onChange={(event) => setDraft({ ...draft, credits: event.target.value })} />
      <span className="admin-redeem-use-count">{code.usedCount} / <input className="mini-number" type="number" value={draft.maxRedemptions} onChange={(event) => setDraft({ ...draft, maxRedemptions: event.target.value })} /></span>
      <RedeemStatusChip status={status} />
      <span className="muted-cell">{formatDate(code.createdAt)}</span>
      <div className="admin-row-actions">
        <button className="admin-icon-btn" title={draft.enabled ? "停用" : "启用"} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>
          {draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
        </button>
        <details className="admin-redeem-expire-editor">
          <summary>期限</summary>
          <div className="admin-date-range inline">
            <input type="date" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} />
            <input type="date" value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} />
          </div>
        </details>
        <button className={dirty ? "admin-text-btn primary" : "admin-text-btn"} disabled={!dirty} title="保存" onClick={() => onSave(code.id, { code: draft.code, name: draft.name, credits: Number(draft.credits), maxRedemptions: Number(draft.maxRedemptions), enabled: draft.enabled, startsAt: dateToIso(draft.startsAt), endsAt: dateToIso(draft.endsAt) })}>保存</button>
        <button className="admin-icon-btn danger" title={code.usedCount > 0 ? "停用并保留记录" : "删除"} onClick={() => onDelete(code.id)}><Trash2 size={16} /></button>
      </div>
    </div>
  );
}

function PlanCreator({ onCreate }: { onCreate: (input: Pick<Plan, "name" | "price" | "credits" | "bonusCredits" | "badge" | "features" | "shopUrl" | "enabled">) => void }) {
  const [draft, setDraft] = useState({ name: "内测体验包", price: "9.9", credits: "600", bonusCredits: "100", badge: "低价体验", features: "适合小红书引流试用；可生成一轮剧本和分镜图", shopUrl: "https://pay.ldxp.cn/shop/ZHP28OV1" });
  return (
    <div className="admin-create-strip admin-plan-create-strip">
      <div><strong>新增充值套餐</strong><span>前台按价格自动排序，只展示启用套餐。</span></div>
      <label className="admin-create-field"><span>套餐名</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：内测体验包" /></label>
      <label className="admin-create-field"><span>售价</span><input type="number" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} placeholder="例如：9.9" /></label>
      <label className="admin-create-field"><span>到账积分</span><input type="number" value={draft.credits} onChange={(event) => setDraft({ ...draft, credits: event.target.value })} placeholder="例如：600" /></label>
      <label className="admin-create-field"><span>赠送积分</span><input type="number" value={draft.bonusCredits} onChange={(event) => setDraft({ ...draft, bonusCredits: event.target.value })} placeholder="例如：100" /></label>
      <label className="admin-create-field"><span>标签</span><input value={draft.badge} onChange={(event) => setDraft({ ...draft, badge: event.target.value })} placeholder="例如：低价体验" /></label>
      <label className="admin-create-field wide"><span>卖点</span><input value={draft.features} onChange={(event) => setDraft({ ...draft, features: event.target.value })} placeholder="用分号分隔，例如：适合试用；可生成分镜图" /></label>
      <label className="admin-create-field wide"><span>店铺链接</span><input value={draft.shopUrl} onChange={(event) => setDraft({ ...draft, shopUrl: event.target.value })} placeholder="例如：https://pay.ldxp.cn/shop/ZHP28OV1" /></label>
      <button className="admin-primary-btn" onClick={() => onCreate({ name: draft.name, price: Number(draft.price), credits: Number(draft.credits), bonusCredits: Number(draft.bonusCredits), badge: draft.badge || undefined, features: splitFeatureText(draft.features), shopUrl: draft.shopUrl || undefined, enabled: true })}>
        <CircleDollarSign size={18} />新增
      </button>
    </div>
  );
}

function PlanRow({
  plan,
  onSave,
  onDelete
}: {
  plan: Plan;
  onSave: (id: string, input: Partial<Pick<Plan, "name" | "price" | "credits" | "bonusCredits" | "badge" | "features" | "shopUrl" | "enabled">>) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState({
    name: plan.name,
    price: String(plan.price),
    credits: String(plan.credits),
    bonusCredits: String(plan.bonusCredits),
    badge: plan.badge ?? "",
    features: plan.features.join("；"),
    shopUrl: plan.shopUrl ?? "",
    enabled: plan.enabled ?? true
  });
  const dirty =
    draft.name !== plan.name ||
    Number(draft.price) !== plan.price ||
    Number(draft.credits) !== plan.credits ||
    Number(draft.bonusCredits) !== plan.bonusCredits ||
    draft.badge !== (plan.badge ?? "") ||
    draft.features !== plan.features.join("；") ||
    draft.shopUrl !== (plan.shopUrl ?? "") ||
    draft.enabled !== (plan.enabled ?? true);
  return (
    <tr>
      <td><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></td>
      <td><input className="mini-number" type="number" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></td>
      <td><input className="mini-number" type="number" value={draft.credits} onChange={(event) => setDraft({ ...draft, credits: event.target.value })} /></td>
      <td><input className="mini-number" type="number" value={draft.bonusCredits} onChange={(event) => setDraft({ ...draft, bonusCredits: event.target.value })} /></td>
      <td><input value={draft.badge} onChange={(event) => setDraft({ ...draft, badge: event.target.value })} /></td>
      <td><input value={draft.features} onChange={(event) => setDraft({ ...draft, features: event.target.value })} /></td>
      <td><input value={draft.shopUrl} onChange={(event) => setDraft({ ...draft, shopUrl: event.target.value })} placeholder="https://..." /></td>
      <td><StatusChip active={draft.enabled} /></td>
      <td>
        <div className="admin-row-actions">
          <button className="admin-icon-btn" onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>{draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button>
          <button className={dirty ? "admin-text-btn primary" : "admin-text-btn"} disabled={!dirty} onClick={() => onSave(plan.id, { name: draft.name, price: Number(draft.price), credits: Number(draft.credits), bonusCredits: Number(draft.bonusCredits), badge: draft.badge || undefined, features: splitFeatureText(draft.features), shopUrl: draft.shopUrl || undefined, enabled: draft.enabled })}>保存</button>
          <button className="admin-text-btn danger" onClick={() => { if (window.confirm("确认停用该充值套餐？")) onDelete(plan.id); }}>停用</button>
        </div>
      </td>
    </tr>
  );
}

function MembershipCreator({ onCreate }: { onCreate: (input: Pick<MembershipPlan, "name" | "monthlyPrice" | "monthlyCredits" | "discountPercent" | "priorityLevel" | "badge" | "features" | "shopUrl" | "enabled">) => void }) {
  const [draft, setDraft] = useState({ name: "创作者月卡", monthlyPrice: "29", monthlyCredits: "3000", discountPercent: "10", priorityLevel: "1", badge: "推荐", features: "每月固定额度；模型调用折扣；优先队列", shopUrl: "https://pay.ldxp.cn/shop/ZHP28OV1" });
  return (
    <div className="admin-create-strip admin-membership-create-strip">
      <div><strong>新增订阅会员</strong><span>用于月额度、折扣和队列优先级管理。</span></div>
      <label className="admin-create-field"><span>会员名</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：创作者月卡" /></label>
      <label className="admin-create-field"><span>月费</span><input type="number" value={draft.monthlyPrice} onChange={(event) => setDraft({ ...draft, monthlyPrice: event.target.value })} placeholder="例如：29" /></label>
      <label className="admin-create-field"><span>月额度</span><input type="number" value={draft.monthlyCredits} onChange={(event) => setDraft({ ...draft, monthlyCredits: event.target.value })} placeholder="例如：3000" /></label>
      <label className="admin-create-field"><span>折扣%</span><input type="number" value={draft.discountPercent} onChange={(event) => setDraft({ ...draft, discountPercent: event.target.value })} placeholder="例如：10" /></label>
      <label className="admin-create-field"><span>队列等级</span><input type="number" value={draft.priorityLevel} onChange={(event) => setDraft({ ...draft, priorityLevel: event.target.value })} placeholder="例如：1" /></label>
      <label className="admin-create-field wide"><span>权益</span><input value={draft.features} onChange={(event) => setDraft({ ...draft, features: event.target.value })} placeholder="用分号分隔，例如：固定额度；优先队列" /></label>
      <label className="admin-create-field wide"><span>店铺链接</span><input value={draft.shopUrl} onChange={(event) => setDraft({ ...draft, shopUrl: event.target.value })} placeholder="例如：https://pay.ldxp.cn/shop/ZHP28OV1" /></label>
      <button className="admin-primary-btn" onClick={() => onCreate({ name: draft.name, monthlyPrice: Number(draft.monthlyPrice), monthlyCredits: Number(draft.monthlyCredits), discountPercent: Number(draft.discountPercent), priorityLevel: Number(draft.priorityLevel), badge: draft.badge, features: splitFeatureText(draft.features), shopUrl: draft.shopUrl || undefined, enabled: true })}>
        <ReceiptText size={18} />新增
      </button>
    </div>
  );
}

function MembershipRow({
  plan,
  onSave,
  onDelete
}: {
  plan: MembershipPlan;
  onSave: (id: string, input: Partial<Pick<MembershipPlan, "name" | "monthlyPrice" | "monthlyCredits" | "discountPercent" | "priorityLevel" | "badge" | "features" | "shopUrl" | "enabled">>) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState({
    name: plan.name,
    monthlyPrice: String(plan.monthlyPrice),
    monthlyCredits: String(plan.monthlyCredits),
    discountPercent: String(plan.discountPercent),
    priorityLevel: String(plan.priorityLevel),
    badge: plan.badge ?? "",
    features: plan.features.join("；"),
    shopUrl: plan.shopUrl ?? "",
    enabled: plan.enabled
  });
  const dirty =
    draft.name !== plan.name ||
    Number(draft.monthlyPrice) !== plan.monthlyPrice ||
    Number(draft.monthlyCredits) !== plan.monthlyCredits ||
    Number(draft.discountPercent) !== plan.discountPercent ||
    Number(draft.priorityLevel) !== plan.priorityLevel ||
    draft.badge !== (plan.badge ?? "") ||
    draft.features !== plan.features.join("；") ||
    draft.shopUrl !== (plan.shopUrl ?? "") ||
    draft.enabled !== plan.enabled;
  return (
    <tr>
      <td><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></td>
      <td><input className="mini-number" type="number" value={draft.monthlyPrice} onChange={(event) => setDraft({ ...draft, monthlyPrice: event.target.value })} /></td>
      <td><input className="mini-number" type="number" value={draft.monthlyCredits} onChange={(event) => setDraft({ ...draft, monthlyCredits: event.target.value })} /></td>
      <td><input className="mini-number" type="number" value={draft.discountPercent} onChange={(event) => setDraft({ ...draft, discountPercent: event.target.value })} />%</td>
      <td><input className="mini-number" type="number" value={draft.priorityLevel} onChange={(event) => setDraft({ ...draft, priorityLevel: event.target.value })} /></td>
      <td><input value={draft.features} onChange={(event) => setDraft({ ...draft, features: event.target.value })} /></td>
      <td><input value={draft.shopUrl} onChange={(event) => setDraft({ ...draft, shopUrl: event.target.value })} placeholder="https://..." /></td>
      <td><StatusChip active={draft.enabled} /></td>
      <td>
        <div className="admin-row-actions">
          <button className="admin-icon-btn" onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>{draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button>
          <button className={dirty ? "admin-text-btn primary" : "admin-text-btn"} disabled={!dirty} onClick={() => onSave(plan.id, { name: draft.name, monthlyPrice: Number(draft.monthlyPrice), monthlyCredits: Number(draft.monthlyCredits), discountPercent: Number(draft.discountPercent), priorityLevel: Number(draft.priorityLevel), badge: draft.badge || undefined, features: splitFeatureText(draft.features), shopUrl: draft.shopUrl || undefined, enabled: draft.enabled })}>保存</button>
          <button className="admin-icon-btn danger" title="删除订阅会员" onClick={() => { if (window.confirm("确认删除该订阅会员方案？删除后后台列表不再保留。")) onDelete(plan.id); }}><Trash2 size={16} /></button>
        </div>
      </td>
    </tr>
  );
}

function ProviderRow({
  provider,
  testStates,
  onSave,
  onDelete,
  onTest
}: {
  provider: ModelProvider;
  testStates: Record<string, ProviderTestState>;
  onSave: (id: string, input: Partial<Pick<ModelProvider, "name" | "modality" | "enabled" | "baseUrl" | "iconUrl" | "models" | "costHint">> & { apiKey?: string | null; routing?: { mode?: "auto" | "manual"; preferredModel?: string; modelPool?: string[] } }) => void;
  onDelete: (id: string) => void;
  onTest: (provider: ModelProvider, model: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState({
    name: provider.name,
    modality: provider.modality,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl ?? "",
    iconUrl: provider.iconUrl ?? "",
    apiKey: "",
    models: provider.models.join(", "),
    costHint: provider.costHint,
    routingMode: provider.routing?.mode ?? "auto",
    preferredModel: provider.routing?.preferredModel ?? provider.models[0] ?? ""
  });
  useEffect(() => {
    setDraft({
      name: provider.name,
      modality: provider.modality,
      enabled: provider.enabled,
      baseUrl: provider.baseUrl ?? "",
      iconUrl: provider.iconUrl ?? "",
      apiKey: "",
      models: provider.models.join(", "),
      costHint: provider.costHint,
      routingMode: provider.routing?.mode ?? "auto",
      preferredModel: provider.routing?.preferredModel ?? provider.models[0] ?? ""
    });
    setSelectedModel(provider.models[0] ?? "");
  }, [provider.id, provider.name, provider.modality, provider.enabled, provider.baseUrl, provider.iconUrl, provider.costHint, provider.models.join(" | "), provider.routing?.mode, provider.routing?.preferredModel]);
  const models = splitModelText(draft.models);
  const [selectedModel, setSelectedModel] = useState(models[0] ?? "");
  const testKey = `${provider.id}:${selectedModel}`;
  const testState = testStates[testKey];
  useEffect(() => {
    if (!models.length) return;
    if (!models.includes(draft.preferredModel)) {
      setDraft((current) => ({ ...current, preferredModel: models[0] ?? "" }));
    }
    if (!models.includes(selectedModel)) {
      setSelectedModel(models[0] ?? "");
    }
  }, [draft.preferredModel, models.join(" | "), selectedModel]);
  const dirty =
    draft.enabled !== provider.enabled ||
    draft.name !== provider.name ||
    draft.modality !== provider.modality ||
    draft.baseUrl !== (provider.baseUrl ?? "") ||
    draft.iconUrl !== (provider.iconUrl ?? "") ||
    Boolean(draft.apiKey) ||
    draft.models !== provider.models.join(", ") ||
    draft.costHint !== provider.costHint ||
    draft.routingMode !== (provider.routing?.mode ?? "auto") ||
    draft.preferredModel !== (provider.routing?.preferredModel ?? provider.models[0] ?? "");
  const capability = [
    provider.capability.supportsReferenceImage ? "参考图" : "",
    provider.capability.supportsSeed ? "Seed" : "",
    provider.capability.supportsAsyncTask ? "异步" : "",
    provider.capability.supportsImageToVideo ? "图生视频" : ""
  ].filter(Boolean);
  const quotaStatus = provider.routing?.quotaStatus ?? [];
  const submissionTotal = quotaStatus.reduce((sum, item) => sum + item.submissions, 0);
  const coolingCount = quotaStatus.filter((item) => item.coolingDown).length;
  const availableCount = quotaStatus.filter((item) => item.available).length;
  const activeModel = draft.routingMode === "manual"
    ? (draft.preferredModel || models[0] || "")
    : (provider.routing?.activeModel || quotaStatus.find((item) => item.available)?.model || models[0] || "");

  return (
    <article className="admin-provider-card">
      <div className="admin-provider-card-head">
        <button className="admin-icon-btn" onClick={() => setExpanded(!expanded)} title={expanded ? "收起渠道" : "展开渠道"}>
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <AdminProviderIcon provider={{ ...provider, iconUrl: draft.iconUrl }} />
        <div className="admin-provider-title">
          <strong>{draft.name}</strong>
          <span>{provider.id} · {provider.apiKeyConfigured ? `Key ${provider.apiKeyPreview}` : "未配置 Key"}</span>
        </div>
        <span className="admin-chip">{modalityLabel(draft.modality)}</span>
        <StatusChip active={draft.enabled} />
        <div className="admin-provider-model-chips">
          {models.slice(0, 4).map((model) => <span key={model}>{model}</span>)}
          {models.length > 4 ? <span>+{models.length - 4}</span> : null}
        </div>
        <div className="admin-row-actions">
          <button className="admin-icon-btn" title="启停" onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>{draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button>
          <button className={dirty ? "admin-text-btn primary" : "admin-text-btn"} disabled={!dirty} title="保存" onClick={() => onSave(provider.id, {
            name: draft.name,
            modality: draft.modality,
            enabled: draft.enabled,
            baseUrl: draft.baseUrl || undefined,
            iconUrl: draft.iconUrl || undefined,
            apiKey: draft.apiKey || undefined,
            models,
            costHint: draft.costHint,
            routing: {
              mode: draft.routingMode as "auto" | "manual",
              preferredModel: draft.preferredModel || models[0] || undefined,
              modelPool: models
            }
          })}>保存</button>
          <button className="admin-icon-btn" title="测试当前模型" disabled={!selectedModel || testState?.loading} onClick={() => onTest(provider, selectedModel)}>
            {testState?.loading ? <Loader2 className="spin-icon" size={16} /> : provider.modality === "image" ? <Image size={16} /> : provider.modality === "video" ? <Video size={16} /> : <PlayCircle size={16} />}
          </button>
          <button className="admin-icon-btn danger" title="删除/停用" onClick={() => { if (window.confirm("确认删除该模型渠道？如果存在价格策略会自动停用保留关联。")) onDelete(provider.id); }}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="admin-provider-compact">
        <span>{draft.baseUrl || "使用环境变量 Base URL"}</span>
        <span>{capability.join(" / ") || "基础能力"}</span>
        <span>{draft.routingMode === "manual" ? `手动固定：${draft.preferredModel || "未选模型"}` : `自动额度池：${availableCount}/${Math.max(1, quotaStatus.length)} 可用`}</span>
        <span>{draft.costHint}</span>
      </div>
      <ProviderInlineTestResult state={testState} />

      {expanded ? (
        <div className="admin-provider-expanded">
          <label>
            <span>渠道名称</span>
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label>
            <span>模型类型</span>
            <select value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value as ModelProvider["modality"] })}>
              <option value="text">文本</option>
              <option value="image">生图</option>
              <option value="video">视频</option>
              <option value="tts">配音</option>
              <option value="embedding">向量</option>
            </select>
          </label>
          <label>
            <span>渠道说明</span>
            <input value={draft.costHint} onChange={(event) => setDraft({ ...draft, costHint: event.target.value })} />
          </label>
          <label>
            <span>Base URL</span>
            <input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="使用环境变量" />
          </label>
          <label>
            <span>模型图标</span>
            <div className="admin-icon-upload-field">
              <input value={draft.iconUrl} onChange={(event) => setDraft({ ...draft, iconUrl: event.target.value })} placeholder="图片 URL / data-url" />
              <input type="file" accept="image/*" onChange={(event) => void readAdminImageFile(event.target.files?.[0]).then((iconUrl) => iconUrl && setDraft({ ...draft, iconUrl }))} />
            </div>
          </label>
          <label>
            <span>API Key</span>
            <input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={provider.apiKeyConfigured ? "留空表示不修改" : "填写服务端密钥"} />
          </label>
          <label className="wide">
            <span>模型列表</span>
            <textarea value={draft.models} onChange={(event) => setDraft({ ...draft, models: event.target.value })} placeholder="每行或逗号一个模型" />
          </label>
          <label>
            <span>测试模型</span>
            <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              {models.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
          <div className="admin-provider-routing-panel wide">
            <div className="admin-provider-routing-head">
              <div>
                <strong>免费额度池与路由</strong>
                <span>展示今日提交次数、冷却状态，并决定当前渠道是自动轮换还是固定单模型。</span>
              </div>
              <div className="admin-provider-routing-summary">
                <span>今日提交 {submissionTotal}</span>
                <span>冷却 {coolingCount}</span>
                <span>当前生效 {activeModel || "未命中"}</span>
              </div>
            </div>
            <div className="admin-provider-routing-mode">
              <button type="button" className={draft.routingMode === "auto" ? "active" : ""} onClick={() => setDraft({ ...draft, routingMode: "auto" })}>自动轮换</button>
              <button type="button" className={draft.routingMode === "manual" ? "active" : ""} onClick={() => setDraft({ ...draft, routingMode: "manual" })}>手动固定</button>
            </div>
            <label className="admin-provider-routing-select">
              <span>固定模型</span>
              <select value={draft.preferredModel} onChange={(event) => setDraft({ ...draft, preferredModel: event.target.value })}>
                {models.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <div className="admin-provider-quota-grid">
              {quotaStatus.length ? quotaStatus.map((item) => (
                <article className={`admin-provider-quota-card ${item.available ? "ready" : item.coolingDown ? "cooling" : "limited"}`} key={item.model}>
                  <div>
                    <strong>{item.model}</strong>
                    <small>{item.available ? "可提交" : item.coolingDown ? "冷却中" : "额度已满"}</small>
                  </div>
                  <span>{item.submissions}{item.dailyLimit ? ` / ${item.dailyLimit}` : ""}</span>
                  <p>{item.reason || "今天还可以继续提交到这个模型。"}</p>
                </article>
              )) : <p className="admin-muted">该渠道还没有提交记录，首次调用后会开始累计今日次数和冷却状态。</p>}
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ProviderCreator({
  onCreate
}: {
  onCreate: (input: Pick<ModelProvider, "name" | "modality" | "enabled" | "baseUrl" | "models" | "costHint"> & { id?: string; iconUrl?: string; apiKey?: string; routing?: { mode?: "auto" | "manual"; preferredModel?: string; modelPool?: string[] }; unitCredits?: number; vendorCostCny?: number }) => void;
}) {
  const [draft, setDraft] = useState({
    id: "",
    name: "自定义模型渠道",
    modality: "text",
    baseUrl: "",
    iconUrl: "",
    apiKey: "",
    models: "model-name",
    unitCredits: "8",
    vendorCostCny: "0.02",
    costHint: "后台手动接入渠道，支持测试连接和价格联动。"
  });
  return (
    <div className="admin-create-strip admin-provider-create-strip">
      <div>
        <strong>手动接入模型渠道</strong>
        <span>保存后自动生成模型价格策略；密钥仅服务端保存，不在列表明文展示。</span>
      </div>
      <label className="admin-create-field"><span>渠道ID</span><input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="例如：zml-text，可选" /></label>
      <label className="admin-create-field"><span>渠道名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：ZML 中转文本" /></label>
      <label className="admin-create-field"><span>模型类型</span><select value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value })}>
        <option value="text">文本</option>
        <option value="image">生图</option>
        <option value="video">视频</option>
        <option value="tts">配音</option>
        <option value="embedding">向量</option>
      </select></label>
      <label className="admin-create-field wide"><span>Base URL</span><input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="例如：https://api.example.com/v1" /></label>
      <label className="admin-create-field wide"><span>模型图标</span><input value={draft.iconUrl} onChange={(event) => setDraft({ ...draft, iconUrl: event.target.value })} placeholder="图片 URL，可选" /></label>
      <label className="admin-create-field"><span>API Key</span><input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="留空则使用环境变量" /></label>
      <label className="admin-create-field wide"><span>模型ID</span><input value={draft.models} onChange={(event) => setDraft({ ...draft, models: event.target.value })} placeholder="逗号/换行分隔，例如 gpt-5.5, qwen-image" /></label>
      <label className="admin-create-field"><span>默认积分</span><input type="number" value={draft.unitCredits} onChange={(event) => setDraft({ ...draft, unitCredits: event.target.value })} placeholder="例如：8" /></label>
      <button
        className="admin-primary-btn"
        disabled={!draft.name.trim() || !splitModelText(draft.models).length}
        onClick={() => onCreate({
          id: draft.id || undefined,
          name: draft.name,
          modality: draft.modality as ModelProvider["modality"],
          enabled: true,
          baseUrl: draft.baseUrl || undefined,
          iconUrl: draft.iconUrl || undefined,
          apiKey: draft.apiKey || undefined,
          models: splitModelText(draft.models),
          costHint: draft.costHint,
          unitCredits: Number(draft.unitCredits),
          vendorCostCny: Number(draft.vendorCostCny)
        })}
      >
        <SlidersHorizontal size={18} />新增渠道
      </button>
    </div>
  );
}

function PriceCreator({
  providers,
  onCreate
}: {
  providers: ModelProvider[];
  onCreate: (input: Pick<ModelPrice, "providerName" | "modality" | "model" | "unit" | "unitCredits" | "vendorCostCny" | "enabled"> & { providerId?: string }) => AdminActionResult;
}) {
  const [draft, setDraft] = useState({
    providerId: providers[0]?.id ?? "",
    providerName: providers[0]?.name ?? "",
    modality: providers[0]?.modality ?? "text",
    model: providers[0]?.models[0] ?? "",
    unit: "text_run",
    unitCredits: "8",
    vendorCostCny: "0.02"
  });
  const selectedProvider = providers.find((provider) => provider.id === draft.providerId);
  useEffect(() => {
    if (!selectedProvider) return;
    setDraft((current) => ({
      ...current,
      providerName: selectedProvider.name,
      modality: selectedProvider.modality,
      model: current.model || selectedProvider.models[0] || "",
      unit: defaultUnitLabelValue(selectedProvider.modality)
    }));
  }, [selectedProvider]);
  return (
    <div className="admin-create-strip admin-price-create-strip">
      <div><strong>新增价格策略</strong><span>模型渠道新增后会自动补齐，也可以在这里手动添加特殊模型价。</span></div>
      <select value={draft.providerId} onChange={(event) => setDraft({ ...draft, providerId: event.target.value, model: providers.find((item) => item.id === event.target.value)?.models[0] ?? "" })}>
        <option value="">自定义渠道</option>
        {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
      </select>
      <input value={draft.providerName} onChange={(event) => setDraft({ ...draft, providerName: event.target.value })} placeholder="渠道名称" />
      <select value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value as ModelPrice["modality"], unit: defaultUnitLabelValue(event.target.value) })}>
        <option value="text">文本</option>
        <option value="image">生图</option>
        <option value="video">视频</option>
        <option value="tts">配音</option>
        <option value="embedding">向量</option>
      </select>
      <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="模型 ID" list="admin-price-models" />
      <datalist id="admin-price-models">
        {selectedProvider?.models.map((model) => <option key={model} value={model} />)}
      </datalist>
      <input type="number" value={draft.unitCredits} onChange={(event) => setDraft({ ...draft, unitCredits: event.target.value })} placeholder="积分单价" />
      <input type="number" step="0.001" value={draft.vendorCostCny} onChange={(event) => setDraft({ ...draft, vendorCostCny: event.target.value })} placeholder="成本" />
      <button className="admin-primary-btn" disabled={!draft.providerName.trim() || !draft.model.trim()} onClick={() => onCreate({ providerId: draft.providerId || undefined, providerName: draft.providerName, modality: draft.modality as ModelPrice["modality"], model: draft.model, unit: draft.unit as ModelPrice["unit"], unitCredits: Number(draft.unitCredits), vendorCostCny: Number(draft.vendorCostCny), enabled: true })}>
        <Layers3 size={18} />新增价格
      </button>
    </div>
  );
}

function PriceProviderCard({
  group,
  expanded,
  onToggleExpand,
  onSave,
  onDelete
}: {
  group: ReturnType<typeof groupPricesByProvider>[number];
  expanded: boolean;
  onToggleExpand: () => void;
  onSave: (id: string, input: Partial<Pick<ModelPrice, "unitCredits" | "vendorCostCny" | "enabled">>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const modalities = [...new Set(group.prices.map((price) => price.modality))];
  const avgCredits = group.total ? Math.round(group.prices.reduce((sum, price) => sum + price.unitCredits, 0) / group.total) : 0;
  const totalCost = group.prices.reduce((sum, price) => sum + price.vendorCostCny, 0);
  return (
    <article className="admin-price-provider-card">
      <div className="admin-price-provider-head">
        <button className="admin-icon-btn" onClick={onToggleExpand} title={expanded ? "收起价格" : "展开价格"}>
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <div className="admin-provider-title">
          <strong>{group.provider}</strong>
          <span>{modalities.map(modalityLabel).join(" / ")}</span>
        </div>
        <div className="admin-user-metrics compact">
          <MetricPill label="模型" value={group.total} strong />
          <MetricPill label="启用" value={group.enabled} />
          <MetricPill label="均价" value={avgCredits} />
          <MetricPill label="成本合计" value={`¥${totalCost.toFixed(3)}`} />
        </div>
      </div>
      {expanded ? (
        <div className="admin-price-row-list">
          {group.prices.map((price) => (
            <PriceRow key={price.id} price={price} onSave={onSave} onDelete={onDelete} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PriceRow({
  price,
  onSave,
  onDelete
}: {
  price: ModelPrice;
  onSave: (id: string, input: Partial<Pick<ModelPrice, "unitCredits" | "vendorCostCny" | "enabled">>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const [draft, setDraft] = useState({ unitCredits: String(price.unitCredits), vendorCostCny: String(price.vendorCostCny), enabled: price.enabled });
  const dirty =
    Number(draft.unitCredits) !== price.unitCredits ||
    Number(draft.vendorCostCny) !== price.vendorCostCny ||
    draft.enabled !== price.enabled;
  return (
    <div className="admin-price-row">
      <div>
        <strong>{price.model}</strong>
        <span>{unitLabel(price.unit)}</span>
      </div>
      <span className="admin-chip">{modalityLabel(price.modality)}</span>
      <label>
        <span>积分单价</span>
        <input className="mini-number" type="number" value={draft.unitCredits} onChange={(event) => setDraft({ ...draft, unitCredits: event.target.value })} />
      </label>
      <label>
        <span>成本</span>
        <input className="mini-number" type="number" step="0.001" value={draft.vendorCostCny} onChange={(event) => setDraft({ ...draft, vendorCostCny: event.target.value })} />
      </label>
      <StatusChip active={draft.enabled} />
      <div className="admin-row-actions">
        <button className="admin-icon-btn" onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>{draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button>
        <button className={dirty ? "admin-text-btn primary" : "admin-text-btn"} disabled={!dirty} onClick={() => onSave(price.id, { unitCredits: Number(draft.unitCredits), vendorCostCny: Number(draft.vendorCostCny), enabled: draft.enabled })}>保存</button>
        <button className="admin-icon-btn danger" title="删除价格策略" onClick={() => { if (window.confirm("确认删除该模型价格策略？删除后前台不会再按此策略计费。")) onDelete(price.id); }}>
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

function RelayGatewayPreview({ policy }: { policy: RelayGatewayPolicy }) {
  return (
    <article className="admin-v2-card relay-v2-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>Sub2API 风格网关策略</h2>
          <p>兼容入口 {policy.compatibleEndpoint} / {policy.routingMode} / {policy.billingUnit}</p>
        </div>
        <span className="admin-chip green">{policy.accountSharing === "internal_pool" ? "账号池" : "未启用账号池"}</span>
      </div>
      <div className="relay-v2-grid">
        {policy.routes.slice(0, 6).map((route) => (
          <div key={route.id}>
            <strong>{route.name}</strong>
            <span>{route.modality} / 权重 {route.routingWeight}</span>
            <StatusChip active={route.health === "ready"} label={route.health} />
          </div>
        ))}
      </div>
    </article>
  );
}

function ModelTestPanel({
  text,
  image,
  video
}: {
  text: ModelTestResult | null;
  image: ImageModelTestResult | null;
  video: VideoModelTestResult | null;
}) {
  if (!text && !image && !video) return null;
  return (
    <article className="admin-v2-card admin-test-result-card">
      {text ? <p><strong>{text.provider} / {text.model}</strong><span>{text.message}</span></p> : null}
      {video ? <p><strong>{video.provider} / {video.model}</strong><span>{video.message}</span></p> : null}
      {image ? (
        <div className="admin-image-test-result">
          <p><strong>{image.provider} / {image.model}</strong><span>{image.message}</span></p>
          {image.imageUrl ? <img src={image.imageUrl} alt="分镜测试图" /> : null}
        </div>
      ) : null}
    </article>
  );
}

function ProviderInlineTestResult({ state }: { state?: ProviderTestState }) {
  if (!state) return null;
  if (state.loading) {
    return (
      <div className="admin-provider-test-state loading">
        <Loader2 className="spin-icon" size={16} />
        <span>正在测试当前模型，请等待上游返回...</span>
      </div>
    );
  }
  if (!state.result) return null;
  const imageUrl = "hasImageUrl" in state.result ? state.result.imageUrl : undefined;
  return (
    <div className={state.result.ok ? "admin-provider-test-state success" : "admin-provider-test-state failed"}>
      <div>
        {state.result.ok ? <CheckCircle2 size={16} /> : <Activity size={16} />}
        <strong>{state.result.provider} / {state.result.model}</strong>
      </div>
      <p>{state.result.message}</p>
      {imageUrl ? <img src={imageUrl} alt="模型测试预览" /> : null}
    </div>
  );
}

function StatusChip({ active, label }: { active: boolean; label?: string }) {
  return <span className={active ? "admin-status enabled" : "admin-status disabled"}>{label ?? (active ? "启用" : "停用")}</span>;
}

function RedeemStatusChip({ status }: { status: NonNullable<RedeemCode["status"]> }) {
  const labels: Record<NonNullable<RedeemCode["status"]>, string> = {
    active: "可用",
    disabled: "停用",
    used_up: "已用完",
    expired: "已过期",
    scheduled: "未开始"
  };
  const active = status === "active" || status === "scheduled";
  return <span className={active ? "admin-status enabled" : "admin-status disabled"}>{labels[status]}</span>;
}

function EvaluationRunStatusChip({ status }: { status: EvaluationRun["status"] }) {
  const labels: Record<EvaluationRun["status"], string> = {
    running: "运行中",
    completed: "已完成",
    failed: "失败"
  };
  const active = status === "completed";
  return <span className={active ? "admin-status enabled" : "admin-status disabled"}>{labels[status]}</span>;
}

function TableFooter({ total }: { total: number }) {
  return (
    <div className="admin-table-footer">
      <span>显示 1 至 {Math.min(total, 20)} 共 {total} 条结果</span>
      <div className="admin-pagination"><button disabled>‹</button><button className="active">1</button><button disabled>›</button></div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="admin-empty-hint">{text}</div>;
}

const defaultEvaluationRubrics: Record<EvaluationStage, { dimensions: string[]; actions: string[]; content: string }> = {
  script: {
    dimensions: ["叙事结构 20", "开篇钩子 20", "集数节奏 15", "角色动机 15", "画面可视化 15", "生产可拆解 15"],
    actions: ["继续进入角色定稿", "重写剧本", "补清角色动机", "降低设定复杂度"],
    content: "评测剧本是否适合进入角色定稿和分镜生产。重点看主线、开篇钩子、集数结构、角色动机、可视化动作和生产可拆解性。输出 JSON 的 recommendedAction 请使用中文动作。"
  },
  character: {
    dimensions: ["身份清晰 15", "外貌锚点 20", "多视图完整 25", "剧情匹配 15", "参考图跟随 15", "负面提示 10"],
    actions: ["锁定角色", "重生多视图", "修改角色提示词", "上传参考图"],
    content: "评测角色定稿是否适合进入分镜批量出图。重点看身份、外貌锚点、多视图、参考图跟随、负面提示词和剧情匹配。输出 JSON 的 recommendedAction 请使用中文动作。"
  },
  storyboard: {
    dimensions: ["编号稳定 10", "画面可生成 20", "镜头承接 20", "参数简洁 15", "节奏明确 15", "提示词完整 20"],
    actions: ["生成分镜图", "编辑问题镜头", "重拆分镜"],
    content: "评测分镜表是否适合进入分镜图生成。重点看编号、角色场景动作、镜头承接、提示词完整度和用户是否能理解。输出 JSON 的 recommendedAction 请使用中文动作。"
  },
  image: {
    dimensions: ["提示词匹配 20", "角色一致性 25", "构图画幅 15", "崩坏水印 20", "视频首帧可用 20"],
    actions: ["接受使用", "同提示词重生", "修改镜头提示词", "重生角色参考"],
    content: "评测分镜图是否可作为视频首帧。重点看真实图片 URL、角色一致性、画幅构图、崩坏水印和后续图生视频可用性。输出 JSON 的 recommendedAction 请使用中文动作。"
  },
  video: {
    dimensions: ["首帧继承 20", "身份稳定 20", "动作自然 20", "剧情意图 20", "剪辑可用 20"],
    actions: ["接受使用", "重生视频片段", "修改视频提示词", "重生首帧"],
    content: "评测视频草稿是否可剪辑发布或继续合成。重点看首帧、角色身份、动作自然度、剧情意图和可剪辑性。输出 JSON 的 recommendedAction 请使用中文动作。"
  }
};

function evaluationPromptTemplates(templates: PromptTemplate[]) {
  return (["script", "character", "storyboard", "image", "video"] as EvaluationStage[]).map((stage) => {
    const rubric = defaultEvaluationRubrics[stage];
    const existing = templates.find((template) => template.type === stage && (template.name.includes("评测") || template.name.includes("评分") || template.content?.includes("recommendedAction")));
    const template = existing ?? {
      id: `missing_${stage}`,
      name: `${stageLabel(stage)}阶段 LLM 评测评分标准`,
      type: stage,
      version: "1.0.0",
      enabled: false,
      summary: rubric.content,
      content: rubric.content
    };
    return {
      stage,
      template,
      dimensions: rubric.dimensions,
      actions: rubric.actions,
      fallbackContent: rubric.content
    };
  });
}

function promptDraftFromTemplate(template: PromptTemplate) {
  return {
    name: template.name,
    version: template.version,
    enabled: template.enabled,
    summary: template.summary,
    content: template.content ?? template.summary
  };
}

function isDeprecatedChannel(id: string, name = "") {
  const value = `${id} ${name}`.toLowerCase();
  return value.includes("jxb");
}

function buildEvaluatorGroups(providers: ModelProvider[]) {
  return providers
    .filter((provider) => !isDeprecatedChannel(provider.id, provider.name))
    .map((provider) => {
      const preferred = preferredEvaluatorModels(provider);
      const models = (preferred.length ? preferred : provider.models).slice(0, 4).map((model) => ({
        key: `${provider.id}:${model}`,
        provider: provider.id,
        model,
        name: `${provider.name} / ${model}`
      }));
      return { provider, models };
    })
    .filter((group) => group.models.length > 0);
}

function preferredEvaluatorModels(provider: ModelProvider) {
  const id = provider.id.toLowerCase();
  const models = provider.models;
  if (id === "deepseek") return pickExisting(models, ["deepseek-v4-pro", "deepseek-chat", "deepseek-v4-flash"]);
  if (id === "doubao-text") return pickExisting(models, ["doubao-seed-1-6-250615"]);
  if (id === "zml-text") return pickExisting(models, ["gpt-5.5", "gpt-5.4"]);
  if (id === "google-ai-studio") return pickExisting(models, ["gemini-3.1-pro-preview"]);
  return models.slice(0, 2);
}

function pickExisting(models: string[], preferred: string[]) {
  const picked = preferred.filter((model) => models.includes(model));
  return picked.length ? picked : models.slice(0, 2);
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : 0;
}

function topFeedbackTags(feedbacks: UserFeedback[]) {
  const counts = new Map<string, number>();
  feedbacks.flatMap((item) => item.tags).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 10);
}

function feedbackUsabilityLabel(value: UserFeedback["usability"]) {
  const labels: Record<UserFeedback["usability"], string> = {
    usable: "可用",
    barely_usable: "勉强可用",
    unusable: "不可用"
  };
  return labels[value] ?? value;
}

const feedbackStatusOptions: UserFeedback["status"][] = ["open", "triaged", "processing", "resolved", "converted", "ignored"];
const feedbackPriorityOptions: UserFeedback["priority"][] = ["p0", "p1", "p2", "p3"];
const feedbackRootCauseOptions = ["角色漂移", "参考图未锁定", "提示词约束弱", "模型失败", "视频生成失败", "导出下载失败", "扣费/退费争议", "UI 不可用", "评测字段噪声", "其他"];

function feedbackStatusLabel(value: UserFeedback["status"]) {
  const labels: Record<UserFeedback["status"], string> = {
    open: "待处理",
    triaged: "已分诊",
    processing: "处理中",
    resolved: "已解决",
    ignored: "已忽略",
    converted: "已转样本"
  };
  return labels[value] ?? value;
}

function feedbackPriorityLabel(value: UserFeedback["priority"]) {
  const labels: Record<UserFeedback["priority"], string> = {
    p0: "P0 阻塞",
    p1: "P1 高",
    p2: "P2 中",
    p3: "P3 低"
  };
  return labels[value] ?? value;
}

function inferRootCause(feedback: UserFeedback) {
  const text = `${feedback.content} ${feedback.tags.join(" ")}`;
  if (/角色|三视图|参考图|换脸|串到|不像/.test(text)) return "角色漂移";
  if (/视频|Failed to fetch|生成失败/.test(text)) return "视频生成失败";
  if (/导出|下载|MP4|字幕|配音|FFmpeg/i.test(text)) return "导出下载失败";
  if (/扣费|退费|充值|积分/.test(text)) return "扣费/退费争议";
  if (/Excel|乱码|评测|字段/.test(text)) return "评测字段噪声";
  if (/按钮|点击|UI|样式|页面/.test(text)) return "UI 不可用";
  return "其他";
}

function MetricPill({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <span className={strong ? "admin-metric-pill strong" : "admin-metric-pill"}>
      <small>{label}</small>
      <b>{value}</b>
    </span>
  );
}

function averageCredits(codes: RedeemCode[]) {
  if (!codes.length) return 0;
  return Math.round(codes.reduce((sum, code) => sum + code.credits, 0) / codes.length);
}

function redeemStatus(code: RedeemCode): NonNullable<RedeemCode["status"]> {
  if (code.status) return code.status;
  const now = Date.now();
  if (!code.enabled) return "disabled";
  if (code.startsAt && new Date(code.startsAt).getTime() > now) return "scheduled";
  if (code.endsAt && new Date(code.endsAt).getTime() < now) return "expired";
  if (code.usedCount >= code.maxRedemptions) return "used_up";
  return "active";
}

function dateInputValue(value?: string) {
  if (!value) return "";
  return value.slice(0, 10);
}

function dateToIso(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function pipelineKindLabel(kind: VisualPipelineDescriptor["kind"]) {
  const labels: Record<VisualPipelineDescriptor["kind"], string> = {
    video: "视频生成",
    workflow: "工作流",
    lipsync: "唇形同步",
    tts: "配音"
  };
  return labels[kind] ?? kind;
}

function pipelineStatusLabel(status: VisualPipelineDescriptor["status"]) {
  const labels: Record<VisualPipelineDescriptor["status"], string> = {
    ready: "已配置",
    missing_key: "缺少 Key",
    disabled: "已停用",
    not_configured: "未配置"
  };
  return labels[status] ?? status;
}

function groupPricesByProvider(prices: ModelPrice[]) {
  const map = new Map<string, { provider: string; total: number; enabled: number; prices: ModelPrice[] }>();
  prices.forEach((price) => {
    const current = map.get(price.providerName) ?? { provider: price.providerName, total: 0, enabled: 0, prices: [] };
    current.total += 1;
    if (price.enabled) current.enabled += 1;
    current.prices.push(price);
    map.set(price.providerName, current);
  });
  return [...map.values()];
}

function groupModelQuality(rows: NonNullable<EvaluationOverview["modelQuality"]>) {
  const map = new Map<string, { provider: string; tasks: number; successRate: number; averageScore: number; credits: number; models: typeof rows }>();
  rows.forEach((row) => {
    const current = map.get(row.provider) ?? { provider: row.provider, tasks: 0, successRate: 0, averageScore: 0, credits: 0, models: [] };
    current.tasks += row.tasks;
    current.credits += row.credits;
    current.models.push(row);
    map.set(row.provider, current);
  });
  return [...map.values()].map((group) => {
    const taskBase = Math.max(1, group.tasks);
    const weightedSuccess = group.models.reduce((sum, row) => sum + row.successRate * row.tasks, 0) / taskBase;
    const scored = group.models.filter((row) => row.averageScore > 0);
    const weightedScore = scored.length ? scored.reduce((sum, row) => sum + row.averageScore * Math.max(1, row.tasks), 0) / scored.reduce((sum, row) => sum + Math.max(1, row.tasks), 0) : 0;
    return {
      ...group,
      successRate: Math.round(weightedSuccess),
      averageScore: Math.round(weightedScore)
    };
  }).sort((a, b) => b.tasks - a.tasks);
}

function groupRedeemCodes(codes: RedeemCode[]) {
  const map = new Map<string, { id: string; batchId?: string; name: string; prefix: string; credits: number; codes: RedeemCode[] }>();
  codes.forEach((code) => {
    const id = code.batchId ?? `single-${code.id}`;
    const current = map.get(id) ?? {
      id,
      batchId: code.batchId,
      name: code.batchId ? code.name : "历史单码",
      prefix: code.code.split("-")[0] || code.code.slice(0, 4),
      credits: code.credits,
      codes: []
    };
    current.codes.push(code);
    current.name = current.name || code.name;
    current.credits = current.codes.length === 1 ? code.credits : current.credits;
    map.set(id, current);
  });
  return [...map.values()].sort((a, b) => {
    const newestA = Math.max(...a.codes.map((code) => new Date(code.createdAt).getTime()));
    const newestB = Math.max(...b.codes.map((code) => new Date(code.createdAt).getTime()));
    return newestB - newestA;
  });
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("zh-CN");
}

function splitFeatureText(value: string) {
  return value.split(/[\n；;]/).map((item) => item.trim()).filter(Boolean);
}

function splitModelText(value: string) {
  return value.split(/[,\n；;]/).map((item) => item.trim()).filter(Boolean);
}

function toggleString(values: string[], value: string, setter: (values: string[]) => void) {
  setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
}

function toggleStage(values: EvaluationStage[], value: EvaluationStage, setter: (values: EvaluationStage[]) => void) {
  setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
}

