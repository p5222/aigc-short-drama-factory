import {
  Activity,
  BookOpen,
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
  Megaphone,
  Plus,
  Trash2,
  PlayCircle,
  RefreshCw,
  ReceiptText,
  Search,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  ToggleLeft,
  ToggleRight,
  MessageSquareText,
  UserRound,
  Video,
  WalletCards,
  X
} from "lucide-react";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  AdminSummary,
  AdminUserRow,
  EvaluationDataset,
  ExperimentRun,
  EvaluationStage,
  EvaluationOverview,
  EvaluationRun,
  HelpArticle,
  ImageModelTestResult,
  MembershipPlan,
  ModelPrice,
  ModelProvider,
  ModelTestResult,
  PlatformAnnouncement,
  PromptVersion,
  Plan,
  PromptTemplate,
  QualityCenterOverview,
  QualityEvaluationRunResult,
  QualityProjectRow,
  RedeemCode,
  RelayGatewayPolicy,
  ShowcaseWork,
  VideoModelTestResult,
  OpenSourceAdapterInfo,
  UserFeedback,
  VisualPipelineDescriptor,
  VisualPipelineTestResult
} from "@aifilm/shared";
import { creditPriceUnit } from "@aifilm/shared";
import { api, type AdminContentProject } from "../lib/api";
import { HttpError } from "../lib/httpClient";
import { AdminEvaluationPage, AdminMasterDetail, AdminTablePage } from "../admin";
import { closeAfterAdminSuccess, createAdminActionRunner, createCreditAdjustmentAttempt, isValidCreditAdjustment, isValidModelPriceDraft, runAdminBatch, type AdminActionResult } from "../admin/adminActionModel";
import { AdminDialog, AdminDialogActions } from "../admin/AdminDialog";
import { confirmAdminAction } from "../admin/AdminConfirm";
import { fetchAdminUserPage } from "../admin/adminApi";
import type { AdminColumn } from "../admin/AdminTablePage";
import { AdminAuditLogPage } from "../admin/AdminAuditLogPage";
import { formatAdminMoney, formatAdminTaskSuccess, qualityMetricAvailability } from "../admin/adminMetricsModel";
import { providerTestAvailability, testSavedProvider } from "../admin/adminProviderTestModel";
import { scopedAdminNotice } from "../admin/adminNoticeModel";
import { announcementDateInput, announcementScheduleStatus, announcementStatusLabels, buildAnnouncementSchedule, selectAnnouncementRows } from "../admin/announcementScheduleModel";
import { SupportAdminPanel } from "../support/SupportTicketPanel";
import { PageHeader, StatePanel, InlineNotice } from "../design-system/ui";
import { AdminPagination, useAdminPagination } from "../admin/AdminPagination";
import { BEFORE_CREATOR_NAVIGATION } from "../lib/creatorNavigation";
import { canLeaveAdminEditor } from "../admin/adminDirtyState";
import { navigateAdminHash, readAcceptedAdminHash, subscribeAdminNavigation } from "../admin/adminNavigation";
import { hasFeedbackDraftChanges, hasShowcaseDraftChanges } from "../admin/adminEditorDraftModel";
import { ModelRoutePicker } from "../components/ModelRoutePicker";
import { ModelIdentity } from "../components/ModelIdentity";
import { ModelLibrary } from "../components/ModelLibrary";
import { CreditCenter } from "../admin/CreditCenter";
import { AdminCommercialIdentity, membershipLabels } from "../admin/AdminCommercialIdentity";

const AdminActionContext = createContext({ pending: false, message: "", error: "", version: 0 });
type ProviderTestResult = ModelTestResult | ImageModelTestResult | VideoModelTestResult;
type ProviderTestState = {
  loading: boolean;
  result?: ProviderTestResult;
};
type PipelineTestState = {
  loading: boolean;
  result?: VisualPipelineTestResult;
};

const adminModules = ["运营总览", "用户管理", "平台公告", "支持工单", "创作现场管理", "创作质量中心", "提示词评分", "兑换码", "套餐会员", "订阅会员", "积分中心", "模型路由", "价格策略", "操作记录"];

const moduleCopy: Record<string, { title: string; subtitle: string }> = {
  积分中心: { title: "积分中心", subtitle: "核对官方成本、40%毛利、账户资金和每一次任务结算。" },
  操作记录: { title: "操作记录", subtitle: "查看管理员配置和运营操作的执行记录，用于核对变更、排查失败。" },
  运营总览: { title: "运营总览", subtitle: "查看用户、积分、模型成本和任务健康度。" },
  用户管理: { title: "用户管理", subtitle: "管理账号状态、身份权限、积分余额、密码重置和运营入账。" },
  平台公告: { title: "平台公告", subtitle: "维护前台工作台公告，并在子模块管理帮助中心教程与 FAQ。" },
  支持工单: { title: "支持工单", subtitle: "查看创作者的问题、补充记录与处理回复。回复会保存在站内工单中。" },
  创作现场管理: { title: "创作现场管理", subtitle: "审核创作者提交的真实作品，维护封面、视频、精选和前台展示顺序。" },
  创作质量中心: { title: "创作质量中心", subtitle: "根据真实创作内容定位阶段瓶颈，对比模型与提示词版本，持续验证优化效果。" },
  兑换码: { title: "兑换码", subtitle: "批量生成唯一兑换码，控制额度、次数和启停状态。" },
  套餐会员: { title: "充值套餐", subtitle: "管理一次性积分充值包、售价与购买链接。" },
  订阅会员: { title: "订阅会员", subtitle: "预留方案配置。订阅购买、自动月度发放、折扣与优先队列尚未开放。" },
  模型路由: { title: "模型路由", subtitle: "管理文本、生图、视频供应商，测试模型连接。" },
  提示词评分: { title: "提示词评分", subtitle: "维护各阶段 LLM 评测提示词、评分标准和输出 JSON 约束。" },
  价格策略: { title: "价格策略", subtitle: "按供应商、模型和计费单位配置积分单价与成本。" }
};

export function AdminPage({
  userId,
  summary,
  providers,
  modelPrices,
  templates,
  plans,
  membershipPlans,
  redeemCodes,
  announcements,
  helpArticles,
  users,
  evaluation,
  qualityProjects,
  onRefresh
}: {
  userId: string;
  summary?: AdminSummary;
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  templates: PromptTemplate[];
  plans: Plan[];
  membershipPlans: MembershipPlan[];
  redeemCodes: RedeemCode[];
  announcements: PlatformAnnouncement[];
  helpArticles: HelpArticle[];
  users: AdminUserRow[];
  evaluation?: EvaluationOverview;
  qualityProjects: QualityProjectRow[];
  onRefresh: () => void | Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [noticeVersion, setNoticeVersion] = useState(0);
  const actionRunner = useRef(createAdminActionRunner((state) => {
    setNoticeVersion((version) => version + 1);
    setActionPending(state.pending);
    setMessage(state.message);
    setError(state.error);
  }));
  const providerTestPending = useRef(new Set<string>());
  const pipelineTestPending = useRef(new Set<string>());
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null);
  const [imageTestResult, setImageTestResult] = useState<ImageModelTestResult | null>(null);
  const [videoTestResult, setVideoTestResult] = useState<VideoModelTestResult | null>(null);
  const [providerTests, setProviderTests] = useState<Record<string, ProviderTestState>>({});
  const [openSourceAdapters, setOpenSourceAdapters] = useState<OpenSourceAdapterInfo[]>([]);
  const [visualPipelines, setVisualPipelines] = useState<VisualPipelineDescriptor[]>([]);
  const [pipelineTests, setPipelineTests] = useState<Record<string, PipelineTestState>>({});
  const [relayPolicy, setRelayPolicy] = useState<RelayGatewayPolicy | null>(null);
  const [activeModule, setActiveModule] = useState(() => {
    const hash = readAcceptedAdminHash();
    if (hash === "用户积分") return "用户管理";
    if (hash === "智能体接入") return "提示词评分";
    if (qualityPanelFromHash(hash)) return "创作质量中心";
    return adminModules.includes(hash) ? hash : "运营总览";
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.querySelector(".adm-main")?.scrollTo({ top: 0, behavior: "instant" });
    document.querySelector(".adm-content")?.scrollTo({ top: 0, behavior: "instant" });
  }, [activeModule]);

  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (document.querySelector('[data-admin-dirty="true"]')) { event.preventDefault(); event.returnValue = ""; }
    };
    const protectNavigation = (event: Event) => {
      if (!canLeaveAdminEditor()) event.preventDefault();
    };
    window.addEventListener("beforeunload", protectDraft);
    window.addEventListener(BEFORE_CREATOR_NAVIGATION, protectNavigation);
    return () => {
      window.removeEventListener("beforeunload", protectDraft);
      window.removeEventListener(BEFORE_CREATOR_NAVIGATION, protectNavigation);
    };
  }, []);

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
      const hash = readAcceptedAdminHash();
      if (hash === "用户积分") {
        setActiveModule("用户管理");
        return;
      }
      if (hash === "智能体接入") {
        setActiveModule("提示词评分");
        return;
      }
      if (qualityPanelFromHash(hash)) {
        setActiveModule("创作质量中心");
        return;
      }
      setActiveModule(adminModules.includes(hash) ? hash : "运营总览");
    }
    const unsubscribe = subscribeAdminNavigation(syncHashModule);
    syncHashModule();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (activeModule !== "模型路由") return;
    void loadPluginStatus();
  }, [activeModule, providers.length]);

  async function runAction(action: () => Promise<unknown>, success: string) {
    return actionRunner.current(action, success, onRefresh);
  }

  async function refreshQualitySnapshot() {
    try { await onRefresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "后台数据刷新失败"); }
  }

  async function runModelTest(provider: ModelProvider, model: string, dirty = false) {
    const testKey = `${provider.id}:${model}`;
    if ([...providerTestPending.current].some((key) => key.startsWith(`${provider.id}:`))) return;
    providerTestPending.current.add(testKey);
    setMessage("");
    setError("");
    setTestResult(null);
    setImageTestResult(null);
    setVideoTestResult(null);
    setProviderTests((current) => ({ ...current, [testKey]: { loading: true } }));
    try {
      const result = await testSavedProvider(provider, model, api, { dirty });
      if (provider.modality === "image") setImageTestResult(result as ImageModelTestResult);
      else if (provider.modality === "video") setVideoTestResult(result as VideoModelTestResult);
      else if (provider.modality === "text") setTestResult(result as ModelTestResult);
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
    } finally {
      providerTestPending.current.delete(testKey);
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
    const failures = [adapterRes, pipelineRes].filter((result) => result.status === "rejected");
    if (failures.length) setError("部分模型接入状态读取失败，请刷新重试；空列表不代表尚未配置。");
  }

  async function runPipelineTest(pipelineId: string) {
    if (pipelineTestPending.current.has(pipelineId)) return;
    pipelineTestPending.current.add(pipelineId);
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
    } finally {
      pipelineTestPending.current.delete(pipelineId);
    }
  }

  const current = moduleCopy[activeModule] ?? moduleCopy.运营总览;

  useEffect(() => { setMessage(""); setError(""); }, [activeModule]);

  return (
    <AdminActionContext.Provider value={{ pending: actionPending, message, error, version: noticeVersion }}>
    <div className="admin-v2-page" aria-busy={actionPending}>
      <PageHeader eyebrow="运营控制台" title={current.title} description={current.subtitle} actions={
        <div className="admin-v2-title-actions">
          {activeModule !== "支持工单" ? <button className="admin-icon-btn" disabled={actionPending} onClick={() => void actionRunner.current(async () => { await onRefresh(); }, "后台数据已刷新。") } title="刷新" aria-label="刷新后台数据">
            <RefreshCw size={18} />
          </button> : null}
        </div>
      } />

      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      <fieldset className="admin-action-scope" disabled={actionPending}>
      {activeModule === "操作记录" ? <AdminAuditLogPage /> : null}
      {activeModule === "积分中心" ? <CreditCenter /> : null}
      {activeModule === "支持工单" ? <SupportAdminPanel userId={userId} /> : null}
      {activeModule === "运营总览" ? <DashboardSection summary={summary} providers={providers} modelPrices={modelPrices} /> : null}
      {activeModule === "创作现场管理" ? <ContentOperationsSection /> : null}
      {activeModule === "创作质量中心" ? <QualityCenterSection evaluation={evaluation} projects={qualityProjects} providers={providers} onRefresh={refreshQualitySnapshot} /> : null}
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
          currentUserId={userId}
          onDeleteUser={(id) => runAction(() => api.deleteAdminUser(id), "用户已移入回收站；作品和账务记录保留，可恢复为停用状态。")}
          onCreateUser={(input) => runAction(() => api.createAdminUser(input), "用户账号已创建，初始积分和密码已写入。")}
          onUserSave={(userId, input) => runAction(() => api.updateAdminUser(userId, input), "用户资料已保存。")}
          onPasswordReset={(userId, password) => runAction(() => api.resetAdminUserPassword(userId, { password }), "用户密码已重置，旧会话已失效。")}
          onCreditAdjust={(input) => runAction(() => api.adjustUserCredits(input), "用户积分已调整，流水已写入。")}
        />
      ) : null}
      {activeModule === "平台公告" ? (
        <AnnouncementsSection
          announcements={announcements}
          helpArticles={helpArticles}
          onCreate={(input) => runAction(() => api.createAnnouncement(input), "平台公告已创建，前台工作台会按置顶和时间展示。")}
          onSave={(id, input) => runAction(() => api.updateAnnouncement(id, input), "平台公告已保存。")}
          onDelete={(id) => runAction(() => api.deleteAnnouncement(id), "平台公告已删除。")}
          onHelpCreate={(input) => runAction(() => api.createHelpArticle(input), "帮助文章已创建，前台帮助中心会自动展示。")}
          onHelpSave={(id, input) => runAction(() => api.updateHelpArticle(id, input), "帮助文章已保存。")}
          onHelpDelete={(id) => runAction(() => api.deleteHelpArticle(id), "帮助文章已删除。")}
        />
      ) : null}
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
          modelPrices={modelPrices}
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
          onSave={async (id, input) => {
            const saved = await runAction(() => api.updateProvider(id, input), "供应商配置已保存，请重新测试当前配置。");
            if (saved) {
              setProviderTests((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${id}:`))));
              setTestResult(null); setImageTestResult(null); setVideoTestResult(null);
            }
            return saved;
          }}
          onDelete={(id) => runAction(() => api.deleteProvider(id), "模型渠道已删除；存在价格记录时自动停用。")}
          onTest={(provider, model, dirty) => void runModelTest(provider, model, dirty)}
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
      </fieldset>
    </div>
    </AdminActionContext.Provider>
  );
}

function DashboardSection({ summary, providers, modelPrices }: { summary?: AdminSummary; providers: ModelProvider[]; modelPrices: ModelPrice[] }) {
  const enabledProviders = providers.filter((item) => item.enabled).length;
  const enabledPrices = modelPrices.filter((item) => item.enabled).length;
  return (
    <section className="admin-v2-section">
      <div className="adm-metric-heading"><h2>运营待办</h2><span>{summary?.operations?.updatedAt ? `更新于 ${new Date(summary.operations.updatedAt).toLocaleString("zh-CN")}` : "等待读取全量待办"}</span></div>
      <div className="admin-product-metrics">
        <AdminMetric icon={<MessageSquareText size={22} />} label="待处理工单" value={summary?.operations?.openTickets ?? "未读取"} hint="用户等待平台回复" tone="blue" />
        <AdminMetric icon={<ShieldCheck size={22} />} label="待审核作品" value={summary?.operations?.pendingWorks ?? "未读取"} hint="审核通过后才公开展示" tone="amber" />
        <AdminMetric icon={<ReceiptText size={22} />} label="待确认订单" value={summary?.operations?.pendingOrders ?? "未读取"} hint="非模拟订单；尚未确认收款" tone="violet" />
        <AdminMetric icon={<Activity size={22} />} label="活动任务" value={summary?.operations?.activeTasks ?? "未读取"} hint="排队与运行，不含内部操作锁" tone="green" />
      </div>
      <div className="admin-setup-links" aria-label="待办处理入口">
        <button className="ghost-button" type="button" onClick={() => navigateAdminHash("支持工单")}><MessageSquareText size={16} />回复待处理工单</button>
        <button className="ghost-button" type="button" onClick={() => navigateAdminHash("创作现场管理")}><ShieldCheck size={16} />审核待发布作品</button>
        <button className="ghost-button" type="button" onClick={() => navigateAdminHash("用户管理")}><UserRound size={16} />查看用户与账单</button>
      </div>
      <p className="admin-list-note">待确认订单不是已收款；支付由签名回调或主动查单核对。失败任务请结合用户账单、模型配置和工单排查，不手动重复提交上游生成。</p>
      <div className="adm-metric-heading"><h2>创作与服务</h2><span>当前系统记录 · 今日任务按北京时间统计</span></div>
      <div className="admin-product-metrics">
        <AdminMetric icon={<UserRound size={22} />} label="注册用户" value={summary?.users ?? "未读取"} hint="当前系统用户" tone="blue" />
        <AdminMetric icon={<DatabaseZap size={22} />} label="项目数量" value={summary?.projects ?? "未读取"} hint={`今日 ${summary?.tasksToday ?? "—"} 个生成任务（北京时间）`} tone="amber" />
        <AdminMetric icon={<CheckCircle2 size={22} />} label="任务成功率" value={formatAdminTaskSuccess(summary?.successRate, summary?.completedTasks)} hint={`仅统计 ${summary?.completedTasks ?? "—"} 个成功或失败任务`} tone="green" />
        <AdminMetric icon={<Activity size={22} />} label="启用渠道" value={enabledProviders} hint={`${enabledPrices} 条价格启用`} tone="violet" />
      </div>

      <div className="adm-metric-heading"><h2>积分与收款</h2><span>实扣积分、现金实收和供应商成本分别核算</span></div>
      <div className="admin-product-metrics compact">
        <AdminMetric icon={<WalletCards size={20} />} label="实扣积分" value={summary?.creditsConsumed.toLocaleString() ?? "未读取"} hint="以消耗流水为准" tone="blue" />
        <AdminMetric icon={<CircleDollarSign size={20} />} label="充值实收" value={formatAdminMoney(summary?.paidRechargeCny, "未读取")} hint="已支付的真实订单金额" tone="green" />
        <AdminMetric icon={<ChartNoAxesCombined size={20} />} label="供应商成本" value={formatAdminMoney(summary?.providerCost)} hint={summary?.providerCostStatus === "recorded" ? "已记录供应商实际成本" : "尚未接入实际用量账单"} tone="amber" />
        <AdminMetric icon={<ShieldCheck size={20} />} label="解冻积分" value={summary?.refundCredits?.toLocaleString() ?? "未读取"} hint="释放冻结额度，不代表现金退款" tone="violet" />
      </div>

      <div className="admin-v2-card admin-dashboard-grid">
        <div className="admin-v2-card-head">
          <div>
            <h2>运营健康度</h2>
            <p>从任务成功率、渠道启用、价格覆盖和积分消耗判断后台是否可稳定运营。</p>
          </div>
        </div>
        <div className="admin-policy-strip">
          <PolicyItem title="任务统计" body={`累计 ${summary?.totalTasks ?? "—"} 个生成任务；今日 ${summary?.tasksToday ?? "—"} 个（北京时间），不含内部操作锁。`} />
          <PolicyItem title="渠道覆盖" body={`${enabledProviders}/${providers.length} 个供应商启用，${enabledPrices} 条价格策略可用。`} />
          <PolicyItem title="收款与成本" body={`充值实收 ${formatAdminMoney(summary?.paidRechargeCny, "未读取")}；尚未按消耗确认收入。${summary?.grossMarginEstimate == null ? "供应商账单未完成核对，毛利暂不可计算。" : `已记录毛利 ${formatAdminMoney(summary.grossMarginEstimate)}。`}`} />
        </div>
        <div className="admin-setup-links" aria-label="运营处理入口">
          <button className="ghost-button" type="button" onClick={() => navigateAdminHash("模型路由")}><SlidersHorizontal size={16} />检查模型渠道</button>
          <button className="ghost-button" type="button" onClick={() => navigateAdminHash("价格策略")}><CircleDollarSign size={16} />核对计费价格</button>
          <button className="ghost-button" type="button" onClick={() => navigateAdminHash("支持工单")}><MessageSquareText size={16} />处理支持工单</button>
          <button className="ghost-button" type="button" onClick={() => navigateAdminHash("操作记录")}><ReceiptText size={16} />追溯操作记录</button>
        </div>
        {summary?.metricsNote ? <p className="admin-list-note">{summary.metricsNote}</p> : null}
        {(summary?.unreconciledCredits ?? 0) > 0 ? <p className="admin-toast danger" role="status">积分账户累计值与消耗流水相差 {summary!.unreconciledCredits!.toLocaleString()} 积分，需核对历史数据。</p> : null}
      </div>

      <AdminTablePage
        title="模型渠道健康"
        summary="只展示当前真实配置，便于快速发现停用渠道和未覆盖价格。"
        columns={[
          { key: "provider", label: "供应商", render: (row) => <strong>{row.name}</strong> },
          { key: "modality", label: "能力", render: (row) => ({ text: "文本", image: "图片", video: "视频", tts: "配音", embedding: "向量" }[row.modality] ?? row.modality) },
          { key: "models", label: "模型数", render: (row) => row.models.length },
          { key: "status", label: "状态", render: (row) => <span className="adm-status" data-status={row.enabled ? "active" : "disabled"}>{row.enabled ? "已启用" : "已停用"}</span> },
          { key: "prices", label: "价格覆盖", render: (row) => modelPrices.filter((price) => price.providerId === row.id && price.enabled).length },
          { key: "action", label: "配置", sticky: "right", render: () => <button className="adm-row-open" type="button" onClick={() => navigateAdminHash("模型路由")}>管理渠道<ChevronRight size={14} /></button> }
        ]}
        rows={providers}
        rowKey={(row) => row.id}
        emptyText="暂无模型渠道配置"
      />

    </section>
  );
}

function ContentOperationsSection() {
  const [view, setView] = useState("review");
  return <div className="admin-content-operations"><div className="admin-section-tabs" role="group" aria-label="内容运营视图"><button type="button" aria-pressed={view === "review"} onClick={() => { if (canLeaveAdminEditor()) setView("review"); }}>作品审核</button><button type="button" aria-pressed={view === "projects"} onClick={() => { if (canLeaveAdminEditor()) setView("projects"); }}>内容创作进度</button></div>{view === "review" ? <ShowcaseWorksSection /> : <ContentProjectsAdminSection />}</div>;
}

function ContentProjectsAdminSection() {
  const [rows, setRows] = useState<AdminContentProject[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [reload, setReload] = useState(0), [keyword, setKeyword] = useState("");
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    void api.adminContentProjects().then(result => { if (active) setRows(result); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "内容项目读取失败"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const filtered = rows.filter(row => `${row.title} ${row.user?.name || ""} ${row.user?.email || ""} ${row.id}`.toLowerCase().includes(keyword.toLowerCase()));
  const pagination = useAdminPagination(filtered, keyword);
  const steps: Record<string, string> = { source: "创作意图", analysis: "内容分析", strategy: "创作策略", outline: "章节大纲", chapter: "正文", script: "剧本", entity: "人物与场景" };
  const statuses: Record<string, string> = { draft: "草稿", active: "进行中", planning: "策划中", generating: "生成中", running: "生成中", succeeded: "已生成", confirmed: "已确认", stale: "内容待更新", completed: "已完成", failed: "生成失败", archived: "已归档" };
  return <><AdminTablePage title="内容创作进度" summary={`在已读取项目中匹配 ${filtered.length} 条。此处只读查看创作进度，作品发布请进入审核队列。`} filters={<SearchField value={keyword} onChange={setKeyword} placeholder="搜索项目、创作者或项目编号" />} actions={<button className="admin-secondary-btn" disabled={loading} type="button" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} />刷新</button>} columns={[
    { key: "title", label: "项目", render: row => <div><strong>{row.title}</strong><small>{row.id}</small></div> },
    { key: "owner", label: "创作者", render: row => row.user?.name || row.user?.email || "未记录" },
    { key: "step", label: "当前阶段", render: row => steps[row.activeStep] || row.activeStep },
    { key: "status", label: "状态", render: row => <span className="adm-status" data-status={row.status}>{statuses[row.status] || row.status}</span> },
    { key: "content", label: "内容数量", render: row => <div className="adm-content-counts"><span>分析 <b>{row.counts.analyses}</b></span><span>大纲 <b>{row.counts.outlines}</b></span><span>正文 <b>{row.counts.chapters}</b></span><span>剧本 <b>{row.counts.scripts}</b></span></div> },
    { key: "updated", label: "更新时间", render: row => <AdminDate value={row.updatedAt} /> }
  ]} rows={pagination.items} rowKey={row => row.id} loading={loading} error={error} emptyText="没有匹配的内容项目，可调整关键词后重试。" /><TableFooter total={filtered.length} page={pagination.page} pageSize={pagination.pageSize} onPageChange={pagination.setPage} /></>;
}

function ShowcaseWorksSection() {
  const [items, setItems] = useState<ShowcaseWork[]>([]);
  const [status, setStatus] = useState("pending");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<ShowcaseWork | null>(null);
  const [draft, setDraft] = useState<ShowcaseWork | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewNoteError, setReviewNoteError] = useState("");
  const reviewNoteRef = useRef<HTMLTextAreaElement>(null);
  const reviewNoteHintId = useId();
  const [working, setWorking] = useState(false);
  const showcasePending = useRef(false);
  const [versionConflict, setVersionConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setPage(1);
  }, [status, keyword]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void api.adminShowcaseWorks(page, 20, status, keyword)
        .then((result) => {
          if (!active) return;
          if (page > Math.max(1, result.totalPages)) { setPage(Math.max(1, result.totalPages)); return; }
          setItems(result.items);
          setTotal(result.total);
          setTotalPages(result.totalPages);
        })
        .catch((reason) => active && setError(reason instanceof Error ? reason.message : "作品列表读取失败"))
        .finally(() => active && setLoading(false));
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [keyword, page, reloadKey, status]);

  function openWork(work: ShowcaseWork) {
    if (selected?.id !== work.id && !canLeaveAdminEditor()) return;
    setVersionConflict(false);
    setSelected(work);
    setDraft({ ...work });
    setReviewNote(work.reviewNote ?? "");
    setReviewNoteError("");
    setMessage("");
    setError("");
  }

  async function refreshSelected(next?: ShowcaseWork) {
    if (next && (status === "all" || next.status === status)) {
      setSelected(next);
      setDraft({ ...next });
    } else if (next) {
      setSelected(null);
      setDraft(null);
    }
    try {
      const result = await api.adminShowcaseWorks(page, 20, status, keyword);
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch {
      setError("操作已完成，审核队列刷新失败；请刷新队列确认最新状态，无需重复提交。");
    }
  }

  async function saveDraft() {
    if (!selected || !draft || showcasePending.current || versionConflict) return;
    showcasePending.current = true;
    setWorking(true);
    setMessage("");
    setError("");
    try {
      const updated = await api.updateAdminShowcaseWork(selected.id, {
        expectedUpdatedAt: selected.updatedAt,
        title: draft.title,
        description: draft.description,
        category: draft.category,
        creatorName: draft.creatorName,
        coverUrl: draft.coverUrl,
        videoUrl: draft.videoUrl,
        durationLabel: draft.durationLabel,
        featured: draft.featured,
        sortOrder: draft.sortOrder
      });
      setMessage("作品展示信息已保存。");
      await refreshSelected(updated);
    } catch (reason) {
      if (reason instanceof HttpError && reason.status === 409) setVersionConflict(true);
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setWorking(false);
      showcasePending.current = false;
    }
  }

  async function review(decision: "approve" | "reject") {
    if (!selected || !draft || showcasePending.current || versionConflict) return;
    if (decision === "reject" && !reviewNote.trim()) {
      setReviewNoteError("请填写驳回原因，方便创作者修改后重新提交。");
      reviewNoteRef.current?.focus();
      return;
    }
    setReviewNoteError("");
    showcasePending.current = true;
    setWorking(true);
    setMessage("");
    setError("");
    try {
      let expectedUpdatedAt = selected.updatedAt;
      if (decision === "approve") {
        const saved = await api.updateAdminShowcaseWork(selected.id, {
          expectedUpdatedAt,
          title: draft.title,
          description: draft.description,
          category: draft.category,
          creatorName: draft.creatorName,
          coverUrl: draft.coverUrl,
          videoUrl: draft.videoUrl,
          durationLabel: draft.durationLabel,
          featured: draft.featured,
          sortOrder: draft.sortOrder
        });
        expectedUpdatedAt = saved.updatedAt;
        setSelected(saved);
        setDraft({ ...saved });
      }
      const updated = await api.reviewAdminShowcaseWork(selected.id, { decision, note: reviewNote, expectedUpdatedAt });
      setMessage(decision === "approve" ? "作品已通过审核并发布到前台。" : "作品已驳回，创作者可以修改后重新提交。");
      await refreshSelected(updated);
    } catch (reason) {
      if (reason instanceof HttpError && reason.status === 409) setVersionConflict(true);
      setError(reason instanceof Error ? reason.message : "审核失败");
    } finally {
      setWorking(false);
      showcasePending.current = false;
    }
  }

  return (
    <section className="admin-v2-section showcase-admin-section">
      {message ? <p className="admin-toast success">{message}</p> : null}
      <AdminTablePage
        title="作品审核队列"
        summary={`共 ${total} 条真实记录；仅已通过作品会在前台展示。`}
        filters={<><label><Search size={16} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} aria-label="搜索作品或作者" placeholder="搜索作品或作者" /></label><select aria-label="审核状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option><option value="all">全部</option></select></>}
        actions={<button className="admin-icon-btn" type="button" title="刷新审核队列" onClick={() => setReloadKey((current) => current + 1)}><RefreshCw size={17} /></button>}
        columns={[
          { key: "work", label: "作品", render: (work) => <strong>{work.title}</strong> },
          { key: "creator", label: "创作者", render: (work) => work.creatorName },
          { key: "category", label: "分类", render: (work) => work.category },
          { key: "duration", label: "时长", render: (work) => work.durationLabel },
          { key: "status", label: "审核状态", render: (work) => <span className="adm-status" data-status={work.status}>{showcaseStatusLabel(work.status)}</span> },
          { key: "featured", label: "前台精选", render: (work) => work.featured ? "是" : "否" },
          { key: "submitted", label: "提交时间", render: (work) => work.submittedAt ? new Date(work.submittedAt).toLocaleString() : "官方初始化" }
        ]}
        rows={items}
        rowKey={(work) => work.id}
        loading={loading}
        error={error}
        emptyText="当前筛选条件下没有作品"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        onRowClick={openWork}
      />

      <AdminMasterDetail
        open={Boolean(selected && draft)}
        busy={working}
        title={selected?.title ?? "作品审核"}
        meta={selected ? <span className="adm-status" data-status={selected.status}>{showcaseStatusLabel(selected.status)}</span> : null}
        onClose={() => { setSelected(null); setDraft(null); }}
        footer={<>{message ? <span>{message}</span> : <span /> }<button className="admin-secondary-btn" type="button" disabled={working || versionConflict} onClick={() => void saveDraft()}>保存信息</button><button className="showcase-reject-btn" type="button" disabled={working || versionConflict} onClick={() => void review("reject")}><X size={16} />驳回</button><button className="admin-primary-btn" type="button" disabled={working || versionConflict} onClick={() => void review("approve")}><CheckCircle2 size={16} />通过并发布</button></>}
      >
        {working ? <p className="admin-toast" role="status">正在保存或审核，完成后可继续编辑。</p> : null}
        {error ? <p className="admin-toast danger" role="alert">{error}</p> : null}
        {versionConflict ? <p className="admin-toast" role="status">当前草稿和审核意见已保留在此窗口。请先复制需要保留的修改，关闭窗口后从最新队列重新打开作品审阅。<button className="admin-secondary-btn" type="button" onClick={() => setReloadKey(value => value + 1)}>刷新审核队列</button></p> : null}
        {draft ? <div className="showcase-admin-modal-body adm-showcase-detail" data-admin-dirty={hasShowcaseDraftChanges(selected, draft, reviewNote) || undefined}>
              <div className="showcase-admin-preview">
                <video src={draft.videoUrl} poster={draft.coverUrl} controls playsInline preload="metadata" />
                <p>提交项目：{draft.projectId || "官方初始化"}</p>
              </div>
              <fieldset className="showcase-admin-form adm-review-fields" disabled={working} aria-label="作品审核字段">
                <label><span>作品标题</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
                <label><span>作者显示名</span><input value={draft.creatorName} onChange={(event) => setDraft({ ...draft, creatorName: event.target.value })} /></label>
                <label><span>分类</span><input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
                <label><span>时长</span><input value={draft.durationLabel} onChange={(event) => setDraft({ ...draft, durationLabel: event.target.value })} /></label>
                <label className="wide"><span>作品说明</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
                <label className="wide"><span>封面地址</span><input value={draft.coverUrl} onChange={(event) => setDraft({ ...draft, coverUrl: event.target.value })} /></label>
                <label className="wide"><span>视频地址</span><input value={draft.videoUrl} onChange={(event) => setDraft({ ...draft, videoUrl: event.target.value })} /></label>
                <label><span>展示顺序</span><input type="number" min={0} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} /></label>
                <label className="showcase-featured-toggle"><input type="checkbox" checked={draft.featured} onChange={(event) => setDraft({ ...draft, featured: event.target.checked })} /><span>设为官方精选</span></label>
                <label className="wide"><span>审核意见</span><textarea ref={reviewNoteRef} value={reviewNote} aria-invalid={Boolean(reviewNoteError)} aria-describedby={reviewNoteHintId} onChange={(event) => { setReviewNote(event.target.value); if (event.target.value.trim()) setReviewNoteError(""); }} placeholder="驳回时说明需要修改的内容" /><small id={reviewNoteHintId} role={reviewNoteError ? "alert" : undefined}>{reviewNoteError || "驳回时必填，创作者可据此修改后重新提交。"}</small></label>
              </fieldset>
            </div> : null}
      </AdminMasterDetail>
    </section>
  );
}

function showcaseStatusLabel(status: ShowcaseWork["status"]) {
  return status === "approved" ? "已通过" : status === "rejected" ? "已驳回" : status === "draft" ? "草稿" : "待审核";
}

function CostBreakdownCard({
  title,
  rows
}: {
  title: string;
  rows: Array<{ name: string; sub?: string; tasks: number; credits: number; cost: number | null; failed: number; successRate: number }>;
}) {
  return (
    <article className="admin-v2-card cost-breakdown-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>{title}</h2>
          <p>按任务记录聚合积分和失败数；缺少供应商实际账单时，成本显示待对账。</p>
        </div>
      </div>
      <div className="cost-breakdown-table">
        <div className="cost-breakdown-row header"><span>对象</span><span>任务</span><span>积分</span><span>成本</span><span>成功率</span></div>
        {rows.length ? rows.slice(0, 8).map((row) => (
          <div className="cost-breakdown-row" key={`${title}-${row.name}-${row.sub ?? ""}`}>
            <strong>{row.name}<small>{row.sub || `${row.failed} 失败`}</small></strong>
            <span>{row.tasks}</span>
            <span>{row.credits}</span>
            <span>{formatAdminMoney(row.cost)}</span>
            <span>{row.successRate}%</span>
          </div>
        )) : <div className="empty-state">暂无任务统计；实际成本需接入供应商账单后核对。</div>}
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

type QualityPanelKey = "overview" | "signals" | "datasets" | "experiments" | "models" | "release";

const qualityPanelHashes: Record<QualityPanelKey, string> = {
  overview: "质量总览",
  signals: "事件与VOC",
  datasets: "质量数据集",
  experiments: "实验评测",
  models: "模型与成本",
  release: "优化回流"
};

function qualityPanelFromHash(hash: string): QualityPanelKey | undefined {
  if (hash === "用户反馈") return "signals";
  if (hash === "评测闭环") return "experiments";
  if (hash === "发布与溯源") return "release";
  return (Object.entries(qualityPanelHashes).find(([, value]) => value === hash)?.[0] as QualityPanelKey | undefined);
}

function QualityCenterSection({
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
  const [activePanel, setActivePanel] = useState<QualityPanelKey>(() => qualityPanelFromHash(readAcceptedAdminHash()) ?? "overview");
  const [snapshot, setSnapshot] = useState<QualityCenterOverview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadQualityCenter(false);
  }, []);

  useEffect(() => {
    function syncQualityPanel() {
      const panel = qualityPanelFromHash(readAcceptedAdminHash());
      setActivePanel(panel ?? "overview");
    }
    return subscribeAdminNavigation(syncQualityPanel);
  }, []);

  async function loadQualityCenter(refreshParent = true) {
    setLoading(true);
    setError("");
    try {
      setSnapshot(await api.adminQualityCenter());
      if (refreshParent) onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "质量中心读取失败");
    } finally {
      setLoading(false);
    }
  }

  function navigatePanel(panel: QualityPanelKey) {
    navigateAdminHash(qualityPanelHashes[panel]);
  }

  function refreshQualityData() {
    onRefresh();
    void loadQualityCenter(false);
  }

  const available = qualityMetricAvailability(snapshot);
  const panelItems: Array<{ id: QualityPanelKey; label: string; count?: ReactNode; meta?: string; tone?: "default" | "blue" | "green" | "amber" | "violet" | "danger" }> = [
    { id: "overview", label: "总览", meta: "待处理与下一步", tone: "blue" },
    { id: "signals", label: "事件与 VOC", count: snapshot?.summary.openEvents ?? "—", meta: "处置/归因/回访", tone: (snapshot?.summary.openEvents ?? 0) ? "amber" : "green" },
    { id: "datasets", label: "数据集", count: snapshot?.samples.length ?? "—", meta: "标杆/问题/回归", tone: "green" },
    { id: "experiments", label: "实验评测", count: snapshot?.lab.runs.length ?? "—", meta: "规则/LLM/横评", tone: "blue" },
    { id: "models", label: "模型与成本", count: snapshot?.modelMonitoring.length ?? "—", meta: "可用性/耗时/成本", tone: (snapshot?.modelMonitoring.some((row) => row.healthStatus === "blocked")) ? "danger" : "green" },
    { id: "release", label: "优化回流", count: snapshot?.stageOptimization.bottleneck ? snapshot.stageOptimization.rows.find((row) => row.key === snapshot.stageOptimization.bottleneck)?.label : "-", meta: "瓶颈/实验/复测", tone: "violet" }
  ];

  return (
    <section className="admin-v2-section quality-center-section">
      <div className="admin-product-metrics">
        <AdminMetric icon={<CheckCircle2 size={22} />} label="成功率" value={snapshot && available.completedTasks ? `${snapshot.summary.successRate}%` : "—"} hint={!snapshot ? "等待快照" : available.completedTasks ? `失败率 ${snapshot.summary.failureRate}% · 最近任务` : "无已结束任务"} tone="green" />
        <AdminMetric icon={<ChartNoAxesCombined size={22} />} label="平均评分" value={snapshot && available.reports ? snapshot.summary.averageScore : "—"} hint={available.reports ? "最近质量报告均分" : "无评分样本"} tone="blue" />
        <AdminMetric icon={<Activity size={22} />} label="P95 耗时" value={snapshot && available.latency ? formatDuration(snapshot.summary.p95LatencyMs) : "—"} hint={available.latency ? "最近任务耗时分位数" : "无耗时样本"} tone="amber" />
        <AdminMetric icon={<DatabaseZap size={22} />} label="模型健康" value={snapshot && available.models ? `${snapshot.summary.modelHealth}%` : "—"} hint={snapshot && available.models ? `${snapshot.summary.costAnomalies} 个成本异常` : "无模型监控样本"} tone="violet" />
      </div>

      <AdminModuleWorkbench
        railTitle="质量工作区"
        railDescription="信号、样本、实验和优化复测共用一条质量链路。"
        railItems={panelItems}
        activeRail={activePanel}
        protectDraft={false}
        onRailChange={(id) => navigatePanel(id as QualityPanelKey)}
        railFooter={<button className="admin-primary-btn compact" onClick={() => void loadQualityCenter()} disabled={loading}>{loading ? <Loader2 size={15} className="spin-icon" /> : <RefreshCw size={15} />}刷新质量快照</button>}
      >
        {error ? <p className="admin-toast danger">{error}</p> : null}
        {!snapshot && !error ? <StatePanel kind={loading ? "loading" : "empty"} title={loading ? "正在读取质量快照" : "暂无质量中心数据"} compact /> : null}
        {snapshot && activePanel === "overview" ? <QualityOverviewPanel snapshot={snapshot} onNavigate={navigatePanel} /> : null}
        {snapshot && activePanel === "signals" ? <QualitySignalsPanel snapshot={snapshot} evaluation={evaluation} projects={projects} onRefresh={refreshQualityData} /> : null}
        {snapshot && activePanel === "datasets" ? <QualityDatasetWorkspace snapshot={snapshot} /> : null}
        {snapshot && activePanel === "experiments" ? <QualityLabPanel snapshot={snapshot} evaluation={evaluation} projects={projects} providers={providers} onRefresh={refreshQualityData} /> : null}
        {snapshot && activePanel === "models" ? <QualityModelMonitorPanel rows={snapshot.modelMonitoring} /> : null}
        {snapshot && activePanel === "release" ? <QualityOptimizationWorkspace snapshot={snapshot} /> : null}
      </AdminModuleWorkbench>
    </section>
  );
}

function QualityOverviewPanel({ snapshot, onNavigate }: { snapshot: QualityCenterOverview; onNavigate: (panel: QualityPanelKey) => void }) {
  const blockedModels = snapshot.modelMonitoring.filter((row) => row.healthStatus === "blocked").length;
  const openPriorityEvents = snapshot.events.filter((event) => ["p0", "p1"].includes(event.priority) && !["resolved", "ignored", "converted"].includes(event.status)).length;
  const bottleneck = snapshot.stageOptimization.rows.find((row) => row.key === snapshot.stageOptimization.bottleneck);
  const readySamples = snapshot.samples.filter((sample) => sample.readiness === "pass").length;
  const activeSamples = snapshot.samples.reduce((sum, sample) => sum + sample.sampleCount, 0);
  const rows: Array<{ title: string; body: string; status: string; action: string; panel: QualityPanelKey }> = [
    { title: "事件处置", body: `${snapshot.summary.openEvents} 个未关闭事件，${openPriorityEvents} 个 P0/P1 待优先复核。`, status: snapshot.summary.openEvents ? "待处理" : "暂无待处理", action: "查看事件", panel: "signals" },
    { title: "回归样本", body: `${snapshot.samples.length} 个数据集 / ${activeSamples} 条样本，${readySamples} 个数据集可用于回归。`, status: readySamples ? "可开展回归" : "待建立样本", action: "管理数据集", panel: "datasets" },
    { title: "实验评测", body: `${snapshot.lab.runs.length} 次最近运行；使用已确认的样本比较模型与提示词。`, status: snapshot.lab.runs.length ? "查看运行结果" : "尚未运行", action: "查看实验", panel: "experiments" },
    { title: "模型与成本", body: snapshot.modelMonitoring.length ? `${snapshot.modelMonitoring.length} 条监控记录，${blockedModels} 条阻塞，${snapshot.summary.costAnomalies} 个成本异常。` : "暂无监控样本；有实际生成记录后可判断模型状态。", status: blockedModels ? "需排查" : snapshot.modelMonitoring.length ? "已有观测" : "无样本", action: "查看监控", panel: "models" },
    { title: "阶段优化", body: bottleneck ? `${bottleneck.label}：${bottleneck.recommendation}` : "建立剧本、素材、分镜与成片的质量基线后，再定位优化重点。", status: bottleneck ? "已有优化建议" : "待建基线", action: "查看阶段", panel: "release" }
  ];
  return (
    <div className="admin-quality-overview">
      <section className="admin-quality-queue">
        <header><div><h2>待处理与下一步</h2><p>快照更新于 {formatDate(snapshot.generatedAt)}</p></div></header>
        {rows.map((row) => <article key={row.title}>
          <div><strong>{row.title}</strong><p>{row.body}</p></div>
          <span>{row.status}</span>
          <button className="admin-text-btn primary" type="button" onClick={() => onNavigate(row.panel)}>{row.action}<ChevronRight size={14} /></button>
        </article>)}
      </section>
      <section className="admin-quality-queue">
        <header><div><h2>最近质量信号</h2><p>来自用户反馈、任务和评测记录。</p></div><button className="admin-text-btn primary" type="button" onClick={() => onNavigate("signals")}>查看全部</button></header>
        {snapshot.events.slice(0, 6).map((event) => <article key={event.id}>
          <div><strong>{event.title}</strong><p>{event.sourceLabel} · {stageLabelSafe(event.stage)} · {formatDate(event.createdAt)}</p></div>
          <span>{feedbackPriorityLabel(event.priority)}</span>
          <button className="admin-text-btn primary" type="button" onClick={() => onNavigate("signals")}>查看信号<ChevronRight size={14} /></button>
        </article>)}
        {!snapshot.events.length ? <StatePanel kind="empty" title="暂无质量信号" description="实际生成、反馈或评测产生记录后会在这里显示。" compact /> : null}
      </section>
      <details className="admin-advanced-panel"><summary>阶段基线与验收条件<ChevronDown size={16} /></summary><QualityStageContractMatrix snapshot={snapshot} /></details>
    </div>
  );
}

function QualitySignalsPanel({
  snapshot,
  evaluation,
  projects,
  onRefresh
}: {
  snapshot: QualityCenterOverview;
  evaluation?: EvaluationOverview;
  projects: QualityProjectRow[];
  onRefresh: () => void;
}) {
  const [view, setView] = useState<"workorders" | "signals" | "voc" | "attribution">("workorders");
  const systemEvents = snapshot.events.filter((event) => event.source !== "user_feedback" && event.source !== "manual_review");
  return (
    <div className="quality-panel-stack">
      <section className="quality-workspace-head">
        <div>
          <span>发现与处置</span>
          <h2>事件与 VOC</h2>
          <p>用户反馈作为可流转工单处理；任务失败、模型错误和评测失败保留为系统信号，避免把只读快照误当成已落库工单。</p>
        </div>
        <div className="quality-subnav" role="group" aria-label="事件与 VOC 视图">
          {[
            ["workorders", "工单处置", snapshot.voc.length],
            ["signals", "系统信号", systemEvents.length],
            ["voc", "VOC 视图", snapshot.voc.length],
            ["attribution", "归因趋势", snapshot.attribution.length]
          ].map(([key, label, count]) => (
            <button key={key} type="button" className={view === key ? "active" : ""} aria-pressed={view === key} onClick={() => { if (key === view || canLeaveAdminEditor()) setView(key as typeof view); }}>
              {label}<b>{count}</b>
            </button>
          ))}
        </div>
      </section>
      {view === "workorders" ? <FeedbackOpsSection evaluation={evaluation} projects={projects} onRefresh={onRefresh} /> : null}
      {view === "signals" ? <QualityEventPoolPanel events={systemEvents} /> : null}
      {view === "voc" ? <QualityVocPanel rows={snapshot.voc} /> : null}
      {view === "attribution" ? <QualityAttributionPanel rows={snapshot.attribution} /> : null}
    </div>
  );
}

function QualityDatasetWorkspace({ snapshot }: { snapshot: QualityCenterOverview }) {
  return (
    <div className="quality-panel-stack">
      <section className="quality-workspace-head">
        <div>
          <span>可复用质量资产</span>
          <h2>数据集</h2>
          <p>将标杆案例、线上 badcase、回归案例和边界案例统一版本化；每次评测运行会保存不可变数据集快照。</p>
        </div>
      </section>
      <QualityStageContractMatrix snapshot={snapshot} />
      <QualitySampleLibraryPanel rows={snapshot.samples} />
    </div>
  );
}

function QualityOptimizationWorkspace({ snapshot }: { snapshot: QualityCenterOverview }) {
  return (
    <div className="quality-panel-stack">
      <section className="quality-workspace-head">
        <div>
          <span>诊断与复测</span>
          <h2>优化回流</h2>
          <p>按四阶段定位主要瓶颈，查看高频问题与根因，再用同一批样本对比模型或提示词；优化结果回到下一轮评测，不干预创作者是否发布。</p>
        </div>
      </section>
      <QualityStageOptimizationPanel data={snapshot.stageOptimization} />
      <QualityAssetLineagePanel rows={snapshot.lineage} />
    </div>
  );
}

function QualityStageOptimizationPanel({ data }: { data: QualityCenterOverview["stageOptimization"] }) {
  const bottleneck = data.rows.find((row) => row.key === data.bottleneck);
  return (
    <section className="quality-optimization-panel">
      <header>
        <div>
          <span>最近 {data.windowDays} 天</span>
          <h2>阶段优化诊断</h2>
          <p>综合阶段评分、通过率、用户不可用反馈和生成失败，优先处理影响最大的环节。</p>
        </div>
        <div className={`quality-bottleneck ${bottleneck?.health ?? "warning"}`}>
          <span>当前主要瓶颈</span>
          <strong>{bottleneck?.label ?? "待建立基线"}</strong>
        </div>
      </header>
      <div className="quality-optimization-grid">
        {data.rows.map((row) => (
          <article key={row.key} className={row.health}>
            <header><strong>{row.label}</strong><span>{qualityGateLabel(row.health)}</span></header>
            <div className="quality-optimization-metrics">
              <MetricPill label="均分" value={row.averageScore || "-"} strong />
              <MetricPill label="通过率" value={row.reportCount ? `${row.passRate}%` : "待评测"} />
              <MetricPill label="待处理反馈" value={row.openFeedback} />
              <MetricPill label="生成失败" value={row.failedTasks} />
            </div>
            <div className="quality-chip-row">
              {[...row.topProblems, ...row.topRootCauses].slice(0, 4).map((item) => <span key={item}>{item}</span>)}
              {!row.topProblems.length && !row.topRootCauses.length ? <span>暂无高频问题</span> : null}
            </div>
            <p>{row.recommendation}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function QualityStageContractMatrix({ snapshot }: { snapshot: QualityCenterOverview }) {
  const contracts: Array<{
    key: string;
    label: string;
    stages: EvaluationStage[];
    output: string;
    gate: string;
  }> = [
    { key: "content", label: "内容", stages: ["script"], output: "故事结构 / 分集 / 对白", gate: "结构完整、角色动机成立、内容可拍" },
    { key: "assets", label: "资产", stages: ["character", "image"], output: "角色设定 / 参考图 / 场景资产", gate: "角色锁定、引用清晰、视觉一致" },
    { key: "storyboard", label: "分镜", stages: ["storyboard"], output: "镜头表 / 画面提示 / 节奏", gate: "镜头覆盖、时空连续、可生成" },
    { key: "final", label: "成片", stages: ["video"], output: "视频片段 / 配音 / 导出", gate: "片段可用、音画连续、成本可控" }
  ];
  return (
    <section className="quality-stage-contract" aria-label="前后台四阶段质量契约">
      <header>
        <div><span>前后台统一口径</span><strong>四阶段质量契约</strong></div>
        <p>前台保持四步创作，后台保留五个细粒度评分项；“资产”聚合角色与图片评测，不改写历史数据。</p>
      </header>
      <div className="quality-contract-grid">
        {contracts.map((contract, index) => {
          const diagnosis = snapshot.stageOptimization.rows.find((row) => row.key === contract.key);
          const reports = snapshot.lab.recentReports.filter((report) => contract.stages.includes(report.stage));
          const openEvents = snapshot.events.filter((event) => contract.stages.includes(event.stage as EvaluationStage) && !["resolved", "ignored", "converted"].includes(event.status));
          const urgent = openEvents.filter((event) => event.priority === "p0" || event.priority === "p1").length;
          const passRate = diagnosis?.passRate ?? (reports.length ? Math.round((reports.filter((report) => report.pass).length / reports.length) * 100) : 0);
          const averageScore = diagnosis?.averageScore ?? average(reports.map((report) => report.totalScore));
          const datasets = snapshot.samples.filter((sample) => sample.stages.some((stage) => contract.stages.includes(stage))).length;
          const status = urgent ? "blocked" : diagnosis?.health ?? (!reports.length || passRate < 80 || openEvents.length ? "warning" : "pass");
          return (
            <article key={contract.key} className={status}>
              <div className="quality-contract-index">{index + 1}</div>
              <div className="quality-contract-copy">
                <strong>{contract.label}</strong>
                <span>{contract.output}</span>
                <small>{contract.gate}</small>
              </div>
              <dl>
                <div><dt>均分</dt><dd>{averageScore || "-"}</dd></div>
                <div><dt>通过率</dt><dd>{reports.length ? `${passRate}%` : "待评测"}</dd></div>
                <div><dt>待优化</dt><dd>{diagnosis?.openFeedback ?? openEvents.length}</dd></div>
                <div><dt>数据集</dt><dd>{datasets}</dd></div>
              </dl>
              <em>{status === "blocked" ? "阻塞" : status === "warning" ? "待验证" : "通过"}</em>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function QualityEventPoolPanel({ events }: { events: QualityCenterOverview["events"] }) {
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState("all");
  const [rootCause, setRootCause] = useState("all");
  const sourceOptions = ["all", ...uniqueStrings(events.map((event) => event.source))];
  const rootOptions = ["all", ...uniqueStrings(events.map((event) => event.rootCause))];
  const filtered = events.filter((event) =>
    (source === "all" || event.source === source) &&
    (rootCause === "all" || event.rootCause === rootCause) &&
    `${event.title} ${event.description} ${event.projectName ?? ""} ${event.provider ?? ""} ${event.model ?? ""}`.toLowerCase().includes(keyword.toLowerCase())
  );
  return (
    <article className="admin-v2-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>质量事件池</h2>
          <p>统一收集用户反馈、任务失败、模型错误、评测失败、人工复核，按根因进入修复或样本沉淀。</p>
        </div>
        <MetricPill label="当前匹配" value={filtered.length} strong />
      </div>
      <AdminToolbar>
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索事件、作品、模型或错误..." />
        <SelectFilter value={source} onChange={setSource} options={sourceOptions} labels={{ all: "全部来源", user_feedback: "用户反馈", task_failure: "任务失败", model_error: "模型错误", evaluation_failure: "评测失败", manual_review: "人工复核" }} />
        <SelectFilter value={rootCause} onChange={setRootCause} options={rootOptions} labels={{ all: "全部根因" }} />
      </AdminToolbar>
      <div className="quality-event-list">
        {filtered.map((event) => <QualityEventCard key={event.id} event={event} />)}
        {!filtered.length ? <EmptyHint text="暂无匹配质量事件。" /> : null}
      </div>
    </article>
  );
}

function QualityEventCard({ event }: { event: QualityCenterOverview["events"][number] }) {
  return (
    <article className="quality-event-card">
      <div>
        <span className={`feedback-priority ${event.priority}`}>{feedbackPriorityLabel(event.priority)}</span>
        <strong>{event.title}</strong>
        <small>{event.sourceLabel} · {stageLabelSafe(event.stage)} · {formatDate(event.createdAt)}</small>
      </div>
      <p>{event.description}</p>
      <div className="quality-chip-row">
        <span>{event.rootCause}</span>
        <span>{qualityEventStatusLabel(event.status)}</span>
        {event.provider || event.model ? <span>{event.provider ?? "未知渠道"} / {event.model ?? "未知模型"}</span> : null}
        {event.score ? <span>{event.score}分</span> : null}
        {event.latencyMs ? <span>{formatDuration(event.latencyMs)}</span> : null}
      </div>
      <footer>
        <span>{event.projectName ?? event.userName ?? "未关联上下文"}</span>
        <b>{event.actionLabel}</b>
      </footer>
    </article>
  );
}

function QualityVocPanel({ rows }: { rows: QualityCenterOverview["voc"] }) {
  const [keyword, setKeyword] = useState("");
  const [priority, setPriority] = useState("all");
  const filtered = rows.filter((row) =>
    (priority === "all" || row.priority === priority) &&
    `${row.content} ${row.projectName ?? ""} ${row.userName ?? ""} ${row.tags.join(" ")}`.toLowerCase().includes(keyword.toLowerCase())
  );
  return (
    <article className="admin-v2-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>用户反馈 VOC</h2>
          <p>这里只处理用户声音、投诉建议、客服回访和补偿结论；可复现的代表性问题再进入事件池和样本库。</p>
        </div>
        <MetricPill label="需补偿" value={rows.filter((row) => row.compensationNeeded).length} strong />
      </div>
      <AdminToolbar>
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索用户、作品、反馈、标签..." />
        <SelectFilter value={priority} onChange={setPriority} options={["all", "p0", "p1", "p2", "p3"]} labels={{ all: "全部优先级", p0: "P0 阻塞", p1: "P1 高", p2: "P2 中", p3: "P3 低" }} />
      </AdminToolbar>
      <div className="quality-voc-list">
        {filtered.map((row) => (
          <article key={row.id}>
            <header>
              <span className={`feedback-priority ${row.priority}`}>{feedbackPriorityLabel(row.priority)}</span>
              <strong>{row.projectName ?? "未关联作品"}</strong>
              <small>{row.userName ?? row.userId} · {feedbackStatusLabel(row.status)} · {formatDate(row.createdAt)}</small>
            </header>
            <p>{row.content || "用户未填写补充说明。"}</p>
            <div className="quality-chip-row">
              <span>{feedbackUsabilityLabel(row.usability)}</span>
              {row.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
              {row.compensationNeeded ? <span className="danger">需补偿核实</span> : null}
            </div>
            <footer>{row.customerAction}</footer>
          </article>
        ))}
        {!filtered.length ? <EmptyHint text="暂无匹配 VOC 反馈。" /> : null}
      </div>
    </article>
  );
}

function QualityModelMonitorPanel({ rows }: { rows: QualityCenterOverview["modelMonitoring"] }) {
  const [keyword, setKeyword] = useState("");
  const [stage, setStage] = useState("all");
  const filtered = rows.filter((row) =>
    qualityFrontStageMatches(row.stage, row.modality, stage) &&
    `${row.provider} ${row.model} ${row.topErrors.map((item) => item.reason).join(" ")}`.toLowerCase().includes(keyword.toLowerCase())
  );
  return (
    <article className="admin-v2-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>模型监控</h2>
          <p>按文本、生图、视频、TTS、导出查看模型可用性、错误码、P95 耗时、积分消耗和成本异常。</p>
        </div>
      </div>
      <AdminToolbar>
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索渠道、模型、错误原因..." />
        <SelectFilter value={stage} onChange={setStage} options={["all", "content", "assets", "storyboard", "final"]} labels={{ all: "全部阶段", content: "内容", assets: "资产", storyboard: "分镜", final: "成片" }} />
      </AdminToolbar>
      <div className="quality-model-monitor-grid">
        {filtered.map((row) => (
          <article key={`${row.provider}:${row.model}:${row.stage}`} className={`quality-monitor-card ${row.healthStatus}`}>
            <header>
              <strong>{row.provider}</strong>
              <span>{row.model}</span>
              <em>{qualityGateLabel(row.healthStatus)}</em>
            </header>
            <div className="quality-monitor-metrics">
              <MetricPill label="成功率" value={`${row.successRate}%`} strong />
              <MetricPill label="失败率" value={`${row.failureRate}%`} />
              <MetricPill label="P95" value={formatDuration(row.p95LatencyMs)} />
              <MetricPill label="积分" value={row.credits} />
              <MetricPill label="成本" value={`¥${row.costCny.toFixed(2)}`} />
            </div>
            <footer>
              {row.topErrors.length ? row.topErrors.map((error) => <span key={error.reason}>{error.reason} × {error.count}</span>) : <span>暂无主要错误</span>}
            </footer>
          </article>
        ))}
        {!filtered.length ? <EmptyHint text="暂无模型监控记录。" /> : null}
      </div>
    </article>
  );
}

function QualityLabPanel({ snapshot, evaluation, projects, providers, onRefresh }: { snapshot: QualityCenterOverview; evaluation?: EvaluationOverview; projects: QualityProjectRow[]; providers: ModelProvider[]; onRefresh: () => void }) {
  return (
    <div className="quality-panel-stack">
      <EvaluationSection evaluation={evaluation} projects={projects} providers={providers} onRefresh={onRefresh} />
    </div>
  );
}

function QualitySampleLibraryPanel({ rows }: { rows: QualityCenterOverview["samples"] }) {
  const [sampleType, setSampleType] = useState("all");
  const filtered = rows.filter((row) => sampleType === "all" || row.sampleType === sampleType);
  return (
    <article className="admin-v2-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>样本库</h2>
          <p>维护 golden sample、badcase sample、regression sample 和边界样本，支撑离线评测与发布门禁。</p>
        </div>
      </div>
      <AdminToolbar>
        <SelectFilter value={sampleType} onChange={setSampleType} options={["all", "golden", "badcase", "regression", "boundary", "manual"]} labels={{ all: "全部样本", golden: "Golden", badcase: "Badcase", regression: "Regression", boundary: "边界样本", manual: "人工样本" }} />
      </AdminToolbar>
      <div className="quality-sample-grid">
        {filtered.map((row) => (
          <article key={row.id} className={`quality-sample-card ${row.readiness}`}>
            <header>
              <strong>{row.name}</strong>
              <span>{sampleTypeLabel(row.sampleType)} · {row.sampleCount} 项</span>
            </header>
            <p>{row.description || "暂无样本说明。"}</p>
            <div className="quality-chip-row">
              {row.stages.map((stage) => <span key={stage}>{stageLabel(stage)}</span>)}
            </div>
            <footer>
              <span>{row.latestRunName ? `${row.latestRunName} · ${row.latestRunPassRate}%` : "尚未运行评测"}</span>
              <b>{qualityGateLabel(row.readiness)}</b>
            </footer>
          </article>
        ))}
        {!filtered.length ? <EmptyHint text="暂无该类型样本。" /> : null}
      </div>
    </article>
  );
}

function QualityAttributionPanel({ rows }: { rows: QualityCenterOverview["attribution"] }) {
  return (
    <article className="admin-v2-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>归因看板</h2>
          <p>按模型失败、提示词问题、角色一致性、工作流问题、UI误导、成本异常等根因观察问题集中度。</p>
        </div>
      </div>
      <div className="quality-attribution-grid">
        {rows.map((row) => (
          <article key={row.rootCause}>
            <header>
              <strong>{row.rootCause}</strong>
              <span>{row.count} 个事件 · {row.open} 未关闭</span>
            </header>
            <div className="quality-attribution-bar"><span style={{ width: `${Math.min(100, row.count * 8)}%` }} /></div>
            <p>{row.recommendation}</p>
            <div className="quality-chip-row">
              {row.stages.map((stage) => <span key={stage}>{stageLabelSafe(stage)}</span>)}
            </div>
          </article>
        ))}
        {!rows.length ? <EmptyHint text="暂无归因数据。" /> : null}
      </div>
    </article>
  );
}

function QualityReleaseGatePanel({ rows }: { rows: QualityCenterOverview["releaseGates"] }) {
  return (
    <article className="admin-v2-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>发布门禁</h2>
          <p>新 prompt、新模型、新流程上线前，必须检查核心样本、最近评测、P0/P1、模型健康、成本异常和溯源覆盖。</p>
        </div>
      </div>
      <div className="quality-gate-grid">
        {rows.map((row) => (
          <article key={row.id} className={`quality-gate-card ${row.status}`}>
            <header>
              <strong>{row.name}</strong>
              <span>{qualityGateLabel(row.status)}</span>
            </header>
            <p>{row.target}</p>
            <dl>
              <div><dt>指标</dt><dd>{row.metric}</dd></div>
              <div><dt>阈值</dt><dd>{row.threshold}</dd></div>
              <div><dt>当前</dt><dd>{row.current}</dd></div>
              <div><dt>负责人</dt><dd>{row.owner}</dd></div>
            </dl>
            <footer>{row.action}</footer>
          </article>
        ))}
      </div>
    </article>
  );
}

function QualityAssetLineagePanel({ rows }: { rows: QualityCenterOverview["lineage"] }) {
  const [keyword, setKeyword] = useState("");
  const filtered = rows.filter((row) => `${row.projectName} ${row.userName} ${row.userEmail ?? ""} ${row.artStyle} ${row.modelRoutes.text ?? ""} ${row.modelRoutes.image ?? ""} ${row.modelRoutes.video ?? ""}`.toLowerCase().includes(keyword.toLowerCase()));
  return (
    <article className="admin-v2-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>真实效果预览</h2>
          <p>按用户和项目查看真实生成效果、角色小图、分镜小图、模型路由、最近评测和反馈，方便整理 badcase。</p>
        </div>
      </div>
      <AdminToolbar>
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索作品、用户、模型或风格..." />
      </AdminToolbar>
      <div className="quality-preview-list">
        {filtered.map((row) => (
          <article key={row.projectId} className={`quality-preview-card ${row.safetyStatus}`}>
            <header>
              <div>
                <strong>{row.projectName}</strong>
                <span>{row.userName}{row.userEmail ? ` · ${row.userEmail}` : ""} · {row.artStyle} · {row.videoRatio} · {formatDate(row.updatedAt)}</span>
              </div>
              <b>{qualityGateLabel(row.safetyStatus)} · {row.totalCredits} 积分</b>
            </header>
            <div className="quality-preview-route-row">
              <span>文本：{row.modelRoutes.text ?? "未记录"}</span>
              <span>生图：{row.modelRoutes.image ?? "未记录"}</span>
              <span>视频：{row.modelRoutes.video ?? "未记录"}</span>
            </div>
            <div className="quality-preview-media-grid">
              <section>
                <strong>角色效果</strong>
                <div className="quality-thumb-strip">
                  {row.roleThumbs.map((asset) => (
                    <figure key={asset.assetId}>
                      {asset.url ? <AdminStableImage src={asset.url} alt={asset.name} /> : <span />}
                      <figcaption>{asset.type === "role_reference" ? "参考" : asset.type === "role_derivative" ? "三视图" : "角色"}</figcaption>
                    </figure>
                  ))}
                  {!row.roleThumbs.length ? <small>暂无角色图</small> : null}
                </div>
              </section>
              <section>
                <strong>分镜首帧</strong>
                <div className="quality-thumb-strip storyboard">
                  {row.storyboardThumbs.map((asset) => (
                    <figure key={asset.assetId}>
                      {asset.url ? <AdminStableImage src={asset.url} alt={asset.name} /> : <span />}
                      <figcaption>{asset.shotNo ?? "镜头"}</figcaption>
                    </figure>
                  ))}
                  {!row.storyboardThumbs.length ? <small>暂无分镜图</small> : null}
                </div>
              </section>
            </div>
            <div className="quality-preview-signal-grid">
              <section>
                <strong>最近评测</strong>
                {row.latestReports.map((report) => (
                  <span key={report.id} className={report.pass ? "pass" : "warning"}>{stageLabelSafe(report.stage)} {report.score}分 · {report.action}</span>
                ))}
                {!row.latestReports.length ? <span>未评测</span> : null}
              </section>
              <section>
                <strong>最近任务</strong>
                {row.latestTasks.slice(0, 3).map((task) => (
                  <span key={task.id}>{task.type} · {task.provider}/{task.model} · {task.status} · {task.credits}积分</span>
                ))}
                {!row.latestTasks.length ? <span>暂无任务</span> : null}
              </section>
              <section>
                <strong>反馈摘要</strong>
                <span>{row.feedbackSummary.total} 条反馈 · {row.feedbackSummary.unusable} 条不可用</span>
                <div className="quality-chip-row">{row.feedbackSummary.topTags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              </section>
            </div>
            <div className="quality-lineage-stage-grid">
              {row.stages.map((stage) => (
                <section key={stage.stage} className={stage.status}>
                  <strong>{stageLabelSafe(stage.stage)}</strong>
                  <span>{stage.provider ?? "未记录渠道"} / {stage.model ?? "未记录模型"}</span>
                  <small>{stage.promptVersion ?? "未记录 prompt"}</small>
                  <em>{stage.tasks} 任务 · {stage.assets} 资产 · {stage.score || "-"}分</em>
                </section>
              ))}
            </div>
          </article>
        ))}
        {!filtered.length ? <EmptyHint text="暂无匹配资产溯源记录。" /> : null}
      </div>
    </article>
  );
}

function AdminStableImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [src]);
  return (
    <span className={loaded ? "stable-image loaded" : "stable-image"}>
      <span />
      <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} />
    </span>
  );
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
  const [activeEvalTab, setActiveEvalTab] = useState<"run" | "experiments" | "records" | "projects" | "models">("run");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(defaultProjectIds);
  const [selectedStages, setSelectedStages] = useState<EvaluationStage[]>(["script", "character", "image", "storyboard", "video"]);
  const [mode, setMode] = useState<"rules" | "hybrid" | "llm">("rules");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [maxLlmCalls, setMaxLlmCalls] = useState(3);
  const [datasets, setDatasets] = useState<EvaluationDataset[]>([]);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [selectedPromptVersionId, setSelectedPromptVersionId] = useState("");
  const [selectedGenerationPromptVersionId, setSelectedGenerationPromptVersionId] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [datasetDescription, setDatasetDescription] = useState("");
  const [running, setRunning] = useState(false);
  const [savingDataset, setSavingDataset] = useState(false);
  const [runResult, setRunResult] = useState<QualityEvaluationRunResult | null>(null);
  const [runError, setRunError] = useState("");
  const [datasetMessage, setDatasetMessage] = useState("");
  const [sampleKeyword, setSampleKeyword] = useState("");
  const evaluationPending = useRef(false);
  const datasetPending = useRef(false);

  useEffect(() => {
    setSelectedProjectIds((current) => current.length ? current.filter((id) => projects.some((row) => row.project.id === id)) : projects.slice(0, 3).map((row) => row.project.id));
  }, [projects]);

  useEffect(() => {
    void refreshEvaluationSnapshots();
  }, []);

  async function refreshEvaluationSnapshots() {
    try {
      const [datasetPage, runPage, promptPage] = await Promise.all([
        api.adminEvaluationDatasetsPage(1, 100),
        api.adminEvaluationRunsPage(1, 100),
        api.adminPromptVersions(1, 100)
      ]);
      setDatasets(datasetPage.items);
      setRuns(runPage.items);
      setPromptVersions(promptPage.items);
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
    if (datasetPending.current) return;
    if (!selectedProjectIds.length || !selectedStages.length) { setRunError("请先选择样本项目和评测阶段。"); return; }
    datasetPending.current = true;
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
      datasetPending.current = false;
    }
  }

  async function runEvaluation() {
    if (evaluationPending.current) return;
    if (!selectedProjectIds.length || !selectedStages.length) { setRunError("请先选择样本项目和评测阶段。"); return; }
    if (mode !== "rules" && !selectedModels.length) { setRunError("请先选择用于评分的文本模型。"); return; }
    evaluationPending.current = true;
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
        promptVersionId: selectedPromptVersionId || undefined,
        generationPromptVersionId: selectedGenerationPromptVersionId || undefined,
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
      evaluationPending.current = false;
    }
  }

  return (
    <section className="admin-v2-section admin-evaluation-section">
      <div className="admin-product-metrics">
        <AdminMetric icon={<ChartNoAxesCombined size={22} />} label="有效作品" value={evaluation?.northStar.effectiveProjects ?? 0} hint={`总项目 ${evaluation?.northStar.totalProjects ?? 0}`} tone="blue" />
        <AdminMetric icon={<CheckCircle2 size={22} />} label="最近评测均分" value={latestRun?.summary.averageScore ? `${latestRun.summary.averageScore}分` : "-"} hint={latestRun ? `${latestRun.summary.reportCount} 条报告` : "暂无评测记录"} tone="green" />
        <AdminMetric icon={<Activity size={22} />} label="评测记录" value={runs.length} hint={`LLM ${llmCallsTotal} 次 · 失败 ${failedRuns}`} tone="amber" />
        <AdminMetric icon={<DatabaseZap size={22} />} label="待处理项目" value={blockedProjects.length} hint="低分或不可用反馈" tone="violet" />
      </div>

      <div className="evaluation-tabbar">
        {[
          ["run", "运行评测"],
          ["experiments", "版本与实验"],
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
              <span>{selectedProjectIds.length} 项 · {selectedFrontendStageLabels(selectedStages).join(" / ")}</span>
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
                {frontendEvaluationStages.map((group) => (
                  <button type="button" key={group.key} className={group.stages.every((stage) => selectedStages.includes(stage)) ? "active" : ""} onClick={() => toggleFrontendStageGroup(selectedStages, group.stages, setSelectedStages)}>
                    {group.label}<small>{group.detail}</small>
                  </button>
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
            <div>
              <strong>评测提示词版本</strong>
              <select className="evaluation-dataset-select" value={selectedPromptVersionId} onChange={(event) => setSelectedPromptVersionId(event.target.value)}>
                <option value="">使用当前启用评分模板</option>
                {promptVersions.filter((prompt) => prompt.purpose === "evaluation" && selectedStages.includes(prompt.stage)).map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>{stageLabel(prompt.stage)} · {prompt.name} · {prompt.version} · {prompt.status === "active" ? "启用" : "草稿"}</option>
                ))}
              </select>
              <small className="evaluation-config-hint">这里只控制评分标准；生成提示词效果应使用对应版本生成样本后，再比较两次评测运行。</small>
            </div>
            <div>
              <strong>样本生成提示词版本</strong>
              <select className="evaluation-dataset-select" value={selectedGenerationPromptVersionId} onChange={(event) => setSelectedGenerationPromptVersionId(event.target.value)}>
                <option value="">未记录 / 使用项目现有版本</option>
                {promptVersions.filter((prompt) => prompt.purpose === "generation" && selectedStages.includes(prompt.stage)).map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>{stageLabel(prompt.stage)} · {prompt.name} · {prompt.version}</option>
                ))}
              </select>
              <small className="evaluation-config-hint">用于标记当前样本由哪个生成提示词产出，方便后续提示词效果对比。</small>
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
                        <button type="button" key={item.key} aria-pressed={selectedModels.includes(item.key)} className={selectedModels.includes(item.key) ? "active" : ""} onClick={() => toggleString(selectedModels, item.key, setSelectedModels)} disabled={mode === "rules"}>
                          <ModelIdentity model={item.model} modality="text" compact />
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

      {activeEvalTab === "experiments" ? <EvaluationExperimentWorkspace runs={runs} promptVersions={promptVersions} onRefresh={refreshEvaluationSnapshots} /> : null}
      {activeEvalTab === "records" ? <EvaluationRecordsCard runs={runs} datasets={datasets} onDeleteRun={async (id) => { await api.deleteEvaluationRun(id); await refreshEvaluationSnapshots(); onRefresh(); }} onDeleteDataset={async (id) => { await api.deleteEvaluationDataset(id); await refreshEvaluationSnapshots(); }} onRefresh={refreshEvaluationSnapshots} /> : null}
      {activeEvalTab === "projects" ? <ProjectQualityPool projects={projects} onDeleteQuality={async (projectId) => { await api.deleteProjectQualityData(projectId); onRefresh(); }} /> : null}
      {activeEvalTab === "models" ? <ModelQualityCard modelQuality={modelQuality} providers={providers} /> : null}
    </section>
  );
}

function EvaluationExperimentWorkspace({
  runs,
  promptVersions,
  onRefresh
}: {
  runs: EvaluationRun[];
  promptVersions: PromptVersion[];
  onRefresh: () => Promise<void>;
}) {
  const completedRuns = runs.filter((run) => run.status === "completed");
  const [selectedPromptVersionId, setSelectedPromptVersionId] = useState<string>();
  const [experiments, setExperiments] = useState<ExperimentRun[]>([]);
  const [experimentPage, setExperimentPage] = useState(1);
  const [experimentPages, setExperimentPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [promptDraft, setPromptDraft] = useState({ key: "quality-script", name: "内容评分提示词", stage: "script" as EvaluationStage, purpose: "evaluation" as PromptVersion["purpose"], version: "v1", content: "", notes: "" });
  const [experimentDraft, setExperimentDraft] = useState({
    name: "模型/提示词对比实验",
    stage: "script" as EvaluationStage,
    experimentType: "model" as ExperimentRun["experimentType"],
    baselineRunId: "",
    candidateRunId: "",
    hypothesis: "候选版本在相同或可比样本上的平均分与通过率不低于基线。"
  });

  useEffect(() => {
    void loadExperiments(1);
  }, []);

  async function loadExperiments(page = experimentPage) {
    setLoading(true);
    setError("");
    try {
      const result = await api.adminExperiments(page, 12);
      setExperiments(result.items);
      setExperimentPage(result.page);
      setExperimentPages(result.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "实验记录读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function savePromptVersion() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await api.createPromptVersion({ ...promptDraft, status: "draft" });
      setPromptDraft((current) => ({ ...current, version: nextPromptVersion(current.version), content: "", notes: "" }));
      setMessage("提示词版本已保存，可在运行评测时选择。生成提示词实验请先用该版本生成对应样本。");
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提示词版本保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function activatePrompt(prompt: PromptVersion) {
    setLoading(true);
    setError("");
    try {
      await api.updatePromptVersion(prompt.id, { status: "active" });
      setMessage(`已启用 ${prompt.name} ${prompt.version}，同一提示词 Key 的旧启用版本已归档。`);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提示词启用失败");
    } finally {
      setLoading(false);
    }
  }

  async function createExperiment() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const experiment = await api.createExperiment({
        name: experimentDraft.name,
        stage: experimentDraft.stage,
        hypothesis: experimentDraft.hypothesis,
        experimentType: experimentDraft.experimentType,
        baselineRunId: experimentDraft.baselineRunId,
        candidateRunId: experimentDraft.candidateRunId,
        successMetric: "候选平均分与通过率不低于基线"
      });
      setMessage(experiment.resultSummary);
      await loadExperiments(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "实验创建失败");
    } finally {
      setLoading(false);
    }
  }

  const stageRuns = completedRuns.filter((run) => run.stages.includes(experimentDraft.stage));
  return (
    <div className="evaluation-experiment-workspace">
      {error ? <p className="admin-toast danger">{error}</p> : null}
      {message ? <p className="admin-toast success">{message}</p> : null}
      <section className="evaluation-experiment-intro">
        <div><span>迭代方法</span><h2>同样本、单变量、可复现</h2></div>
        <p>先建立基线运行，再只替换一个模型或提示词生成候选运行。系统比较两次真实评测结果，不用主观印象判断优化是否有效。</p>
      </section>

      <div className="evaluation-experiment-builder-grid">
        <article id="prompt-version-builder" className="admin-v2-card evaluation-version-builder">
          <div className="admin-v2-card-head"><div><h2>提示词版本库</h2><p>保存评分提示词版本；生成提示词也可记录版本，但必须用对应版本生成样本后再做运行对比。</p></div></div>
          <div className="evaluation-version-form">
            <input value={promptDraft.key} onChange={(event) => setPromptDraft({ ...promptDraft, key: event.target.value })} placeholder="版本 Key，例如 storyboard-generate" />
            <input value={promptDraft.name} onChange={(event) => setPromptDraft({ ...promptDraft, name: event.target.value })} placeholder="提示词名称" />
            <select value={promptDraft.purpose} onChange={(event) => setPromptDraft({ ...promptDraft, purpose: event.target.value as PromptVersion["purpose"] })}><option value="evaluation">评分提示词</option><option value="generation">生成提示词</option></select>
            <select value={promptDraft.stage} onChange={(event) => setPromptDraft({ ...promptDraft, stage: event.target.value as EvaluationStage })}>{frontendEvaluationStages.flatMap((group) => group.stages).map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}</select>
            <input value={promptDraft.version} onChange={(event) => setPromptDraft({ ...promptDraft, version: event.target.value })} placeholder="版本，例如 v2" />
            <textarea value={promptDraft.content} onChange={(event) => setPromptDraft({ ...promptDraft, content: event.target.value })} placeholder="提示词正文或评分 rubric" />
            <input value={promptDraft.notes} onChange={(event) => setPromptDraft({ ...promptDraft, notes: event.target.value })} placeholder="本版改动说明" />
            <button className="admin-primary-btn" type="button" disabled={loading || !promptDraft.key.trim() || !promptDraft.name.trim() || !promptDraft.content.trim()} onClick={() => void savePromptVersion()}><Plus size={16} />保存版本</button>
          </div>
          <div className="evaluation-version-list">
            {promptVersions.slice(0, 10).map((prompt) => (
              <div key={prompt.id}>
                <strong>{stageLabel(prompt.stage)} · {prompt.name} · {prompt.version}</strong>
                <span>{prompt.purpose === "generation" ? "生成" : "评分"} · {prompt.key} · {prompt.status === "active" ? "当前启用" : prompt.status === "archived" ? "已归档" : "草稿"}</span>
                {prompt.status !== "active" ? <button type="button" onClick={() => void activatePrompt(prompt)} disabled={loading}>设为启用</button> : <b>启用中</b>}
              </div>
            ))}
            {!promptVersions.length ? <EmptyHint text="还没有提示词版本，先保存一个基线版本。" /> : null}
          </div>
        </article>

        <article id="experiment-builder" className="admin-v2-card evaluation-comparison-builder">
          <div className="admin-v2-card-head"><div><h2>创建对比实验</h2><p>选择覆盖同一阶段的两次已完成评测，自动计算候选相对基线的分数与通过率变化。</p></div></div>
          <div className="evaluation-comparison-form">
            <input value={experimentDraft.name} onChange={(event) => setExperimentDraft({ ...experimentDraft, name: event.target.value })} placeholder="实验名称" />
            <select value={experimentDraft.experimentType} onChange={(event) => setExperimentDraft({ ...experimentDraft, experimentType: event.target.value as ExperimentRun["experimentType"] })}>
              <option value="model">模型对比</option><option value="prompt">提示词对比</option><option value="combined">组合策略对比</option>
            </select>
            <select value={experimentDraft.stage} onChange={(event) => setExperimentDraft({ ...experimentDraft, stage: event.target.value as EvaluationStage, baselineRunId: "", candidateRunId: "" })}>{frontendEvaluationStages.flatMap((group) => group.stages).map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}</select>
            <select value={experimentDraft.baselineRunId} onChange={(event) => setExperimentDraft({ ...experimentDraft, baselineRunId: event.target.value })}><option value="">选择基线运行</option>{stageRuns.map((run) => <option key={run.id} value={run.id}>{run.name} · {run.summary.averageScore || "-"}分 · {run.summary.passRate}%</option>)}</select>
            <select value={experimentDraft.candidateRunId} onChange={(event) => setExperimentDraft({ ...experimentDraft, candidateRunId: event.target.value })}><option value="">选择候选运行</option>{stageRuns.map((run) => <option key={run.id} value={run.id}>{run.name} · {run.summary.averageScore || "-"}分 · {run.summary.passRate}%</option>)}</select>
            <textarea value={experimentDraft.hypothesis} onChange={(event) => setExperimentDraft({ ...experimentDraft, hypothesis: event.target.value })} placeholder="这次只改了什么，预期改善哪个指标？" />
            <button className="admin-primary-btn" type="button" disabled={loading || !experimentDraft.baselineRunId || !experimentDraft.candidateRunId || experimentDraft.baselineRunId === experimentDraft.candidateRunId} onClick={() => void createExperiment()}><ChartNoAxesCombined size={16} />生成对比结论</button>
          </div>
        </article>
      </div>

      <AdminEvaluationPage
        prompts={promptVersions}
        experiments={experiments}
        selectedPromptId={selectedPromptVersionId}
        onSelectPrompt={setSelectedPromptVersionId}
        onCreatePrompt={() => document.querySelector<HTMLInputElement>("#prompt-version-builder input")?.focus()}
        onCreateExperiment={() => document.querySelector<HTMLInputElement>("#experiment-builder input")?.focus()}
      />
      <div className="admin-pagination"><button type="button" disabled={experimentPage <= 1 || loading} onClick={() => void loadExperiments(experimentPage - 1)}>‹</button><button className="active" type="button">{experimentPage} / {experimentPages}</button><button type="button" disabled={experimentPage >= experimentPages || loading} onClick={() => void loadExperiments(experimentPage + 1)}>›</button></div>
    </div>
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
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [feedbackPages, setFeedbackPages] = useState(1);
  const [feedbackTotal, setFeedbackTotal] = useState(evaluation?.recentFeedback.length ?? 0);
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
    void loadFeedback(false, 1);
  }, []);

  async function loadFeedback(refreshParent = true, targetPage = feedbackPage) {
    setLoading(true);
    setError("");
    try {
      const result = await api.adminFeedbackPage(targetPage, 50, keyword, stage, status);
      setFeedbacks(result.items);
      setFeedbackPage(result.page);
      setFeedbackPages(result.totalPages);
      setFeedbackTotal(result.total);
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
  const settledSamples = feedbacks.filter((item) => item.status === "converted" || item.convertedDatasetId).length;
  const topTags = topFeedbackTags(feedbacks);
  const selectedProject = selectedFeedback?.projectId ? projectById.get(selectedFeedback.projectId) : undefined;
  const selectedRootCause = selectedFeedback ? (draft.rootCause || inferRootCause(selectedFeedback)) : "";
  const hasAttribution = Boolean(draft.rootCause.trim());
  const hasResolution = draft.resolution.trim().length >= 8;
  const hasLinkedProject = Boolean(selectedFeedback?.projectId);
  const canSettleSample = Boolean(selectedFeedback && hasLinkedProject && hasAttribution && hasResolution);
  const handlingSelected = selectedFeedback ? handlingId === selectedFeedback.id : false;

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

  async function persistFeedbackUpdate(
    input: Partial<Pick<UserFeedback, "status" | "priority" | "rootCause" | "assignee" | "resolution" | "convertedDatasetId">>,
    fallbackMessage = "反馈处理保存失败"
  ) {
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
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackMessage);
    } finally {
      setHandlingId("");
    }
  }

  async function saveFeedback(input: Partial<Pick<UserFeedback, "status" | "priority" | "rootCause" | "assignee" | "resolution" | "convertedDatasetId">>) {
    await persistFeedbackUpdate(input);
  }

  async function createReviewTask() {
    if (!selectedFeedback) return;
    await persistFeedbackUpdate({
      status: "processing",
      priority: draft.priority,
      rootCause: selectedRootCause,
      assignee: draft.assignee,
      resolution: draft.resolution.trim() || "已创建人工复核任务，待复现后补充影响范围、修复方案和验证结果。"
    }, "复核任务创建失败");
  }

  async function settleFeedbackSample() {
    if (!selectedFeedback) return;
    if (!selectedFeedback.projectId) {
      setError("该反馈未关联作品，无法沉淀为评测样本。");
      return;
    }
    if (!draft.rootCause.trim() || !draft.resolution.trim()) {
      setError("请先补齐根因归类和处理结论，再沉淀为评测样本。");
      return;
    }

    setHandlingId(selectedFeedback.id);
    setError("");
    try {
      let datasetId = selectedFeedback.convertedDatasetId;
      if (!datasetId) {
        const dataset = await api.createEvaluationDataset({
          name: `反馈样本-${stageLabel(selectedFeedback.stage)}-${selectedProject?.project.name ?? selectedFeedback.id.slice(-6)}`.slice(0, 80),
          description: [
            `来源反馈：${selectedFeedback.content || "用户未填写补充说明。"}`,
            `根因：${draft.rootCause}`,
            `处理结论：${draft.resolution}`
          ].join("\n").slice(0, 500),
          source: "feedback",
          projectIds: [selectedFeedback.projectId],
          stages: [selectedFeedback.stage],
          filters: {
            feedbackId: selectedFeedback.id,
            priority: draft.priority,
            rootCause: draft.rootCause,
            usability: selectedFeedback.usability,
            rating: selectedFeedback.rating,
            tags: selectedFeedback.tags
          },
          owner: draft.assignee.trim() || "feedback-ops"
        });
        datasetId = dataset.id;
      }

      const updated = await api.updateAdminFeedback(selectedFeedback.id, {
        status: "converted",
        priority: draft.priority,
        rootCause: draft.rootCause,
        assignee: draft.assignee,
        resolution: draft.resolution,
        convertedDatasetId: datasetId
      });
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
      setError(err instanceof Error ? err.message : "评测样本沉淀失败");
    } finally {
      setHandlingId("");
    }
  }

  return (
    <section className="admin-v2-section feedback-ops-section">
      <div className="admin-product-metrics">
        <AdminMetric icon={<MessageSquareText size={22} />} label="反馈池" value={feedbackTotal} hint={`数据库分页 · 第 ${feedbackPage}/${feedbackPages} 页`} tone="blue" />
        <AdminMetric icon={<Activity size={22} />} label="待归因" value={pending} hint={`${urgent} 条 P0/P1`} tone="amber" />
        <AdminMetric icon={<CheckCircle2 size={22} />} label="平均评分" value={average(feedbacks.map((item) => item.rating)) || "-"} hint={`${unusable} 条不可用`} tone="green" />
        <AdminMetric icon={<DatabaseZap size={22} />} label="已沉淀" value={settledSamples} hint="可用于回归评测" tone="violet" />
      </div>

      <p className="admin-filter-scope">关键词、阶段、状态查询全部反馈；可用性和优先级进一步筛选当前页，切换页可继续查看。</p>
      <AdminToolbar
        right={<button className="admin-primary-btn" onClick={() => { if (canLeaveAdminEditor()) void loadFeedback(true, 1); }} disabled={loading}>{loading ? <Loader2 className="spin-icon" size={16} /> : <Search size={16} />}查询反馈</button>}
      >
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索反馈内容、标签、作品或用户..." />
        <SelectFilter value={stage} onChange={(value) => setStage(value as typeof stage)} options={["all", "script", "character", "storyboard", "image", "video"]} labels={{ all: "全部阶段", script: "剧本", character: "角色", storyboard: "分镜", image: "图片", video: "视频" }} />
        <SelectFilter value={usability} onChange={(value) => setUsability(value as typeof usability)} options={["all", "usable", "barely_usable", "unusable"]} labels={{ all: "全部可用性", usable: "可用", barely_usable: "勉强可用", unusable: "不可用" }} />
        <SelectFilter value={status} onChange={(value) => setStatus(value as typeof status)} options={["all", "open", "triaged", "processing", "resolved", "converted", "ignored"]} labels={{ all: "全部状态", open: "待分析", triaged: "已归因", processing: "复核中", resolved: "已解决", converted: "已沉淀", ignored: "已关闭" }} />
        <SelectFilter value={priority} onChange={(value) => setPriority(value as typeof priority)} options={["all", "p0", "p1", "p2", "p3"]} labels={{ all: "全部优先级", p0: "P0 阻塞", p1: "P1 高", p2: "P2 中", p3: "P3 低" }} />
      </AdminToolbar>

      <div className="feedback-tag-summary">
        {topTags.length ? topTags.map((item) => <button key={item.tag} type="button" onClick={() => { if (canLeaveAdminEditor()) setKeyword(item.tag); }}>{item.tag}<span>{item.count}</span></button>) : <span>暂无高频标签</span>}
      </div>
      {error ? <p className="admin-toast danger">{error}</p> : null}

      <div className="feedback-workbench-grid">
        <div className="feedback-ops-list">
          {rows.map((feedback) => {
            const project = feedback.projectId ? projectById.get(feedback.projectId) : undefined;
            return (
              <button className={feedback.id === selectedFeedback?.id ? "feedback-ops-card active" : "feedback-ops-card"} key={feedback.id} onClick={() => { if (feedback.id === selectedFeedback?.id || canLeaveAdminEditor()) setSelectedId(feedback.id); }} type="button">
                <div className="feedback-ops-head">
                  <span className={`feedback-priority ${feedback.priority}`}>{feedbackPriorityLabel(feedback.priority)}</span>
                  <strong>{project?.project.name ?? "未关联作品"}</strong>
                  <small>{stageLabel(feedback.stage)} · {feedback.rating} 分 · {formatDate(feedback.createdAt)}</small>
                </div>
                <p>{feedback.content || "用户未填写补充说明。"}</p>
                <div className="feedback-ops-tags">
                  <span>{feedbackStatusLabel(feedback.status)}</span>
                  <span>{feedbackUsabilityLabel(feedback.usability)}</span>
                  {feedback.convertedDatasetId ? <span>已入评测样本</span> : null}
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

        <aside className="feedback-detail-panel" data-admin-dirty={hasFeedbackDraftChanges(selectedFeedback, draft, selectedFeedback ? inferRootCause(selectedFeedback) : "") || undefined}>
          {selectedFeedback ? (
            <>
              <div className="feedback-detail-head">
                <div>
                  <span className={`feedback-priority ${draft.priority}`}>{feedbackPriorityLabel(draft.priority)}</span>
                  <h2>{selectedProject?.project.name ?? "未关联作品"}</h2>
                  <p>{stageLabel(selectedFeedback.stage)} · {feedbackUsabilityLabel(selectedFeedback.usability)} · 来源 {selectedFeedback.source}</p>
                </div>
                <button className="admin-secondary-btn compact" type="button" onClick={() => navigateAdminHash("评测闭环")}>查看评测闭环</button>
              </div>
              <div className="feedback-flow-strip" aria-label="反馈处理流程">
                <span className="done">收集 badcase</span>
                <span className={draft.rootCause ? "done" : ""}>归因分析</span>
                <span className={draft.status === "processing" || draft.status === "resolved" || draft.status === "converted" ? "done" : ""}>复核处理</span>
                <span className={selectedFeedback.convertedDatasetId || draft.status === "converted" ? "done" : ""}>样本沉淀</span>
              </div>
              <blockquote>{selectedFeedback.content || "用户未填写补充说明。"}</blockquote>
              <div className="feedback-detail-meta">
                <span>ID：{selectedFeedback.id}</span>
                <span>用户：{selectedProject?.userName ?? selectedFeedback.userId}</span>
                <span>创建：{formatDate(selectedFeedback.createdAt)}</span>
                {selectedFeedback.processedAt ? <span>处理：{formatDate(selectedFeedback.processedAt)}</span> : null}
                {selectedFeedback.convertedDatasetId ? <span>样本：{selectedFeedback.convertedDatasetId}</span> : null}
              </div>
              <div className="feedback-section-title">
                <ShieldCheck size={17} />
                <div>
                  <strong>归因处理</strong>
                  <span>记录根因、优化动作和复测结果，形成你自己的迭代闭环。</span>
                </div>
              </div>
              <div className="feedback-edit-grid">
                <label><span>处理状态</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as UserFeedback["status"] })}>{feedbackStatusOptions.map((item) => <option key={item} value={item}>{feedbackStatusLabel(item)}</option>)}</select></label>
                <label><span>优先级</span><select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as UserFeedback["priority"] })}>{feedbackPriorityOptions.map((item) => <option key={item} value={item}>{feedbackPriorityLabel(item)}</option>)}</select></label>
                <label><span>根因归类</span><select value={draft.rootCause} onChange={(event) => setDraft({ ...draft, rootCause: event.target.value })}><option value="">未归因</option>{feedbackRootCauseOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              </div>
              <label className="feedback-resolution-field">
                <span>处理结论</span>
                <textarea value={draft.resolution} onChange={(event) => setDraft({ ...draft, resolution: event.target.value })} placeholder="记录复现情况、影响范围、修复方案、补偿结论或回归验证结果。" />
              </label>
              <div className="feedback-closure-grid">
                <section>
                  <div className="feedback-section-title compact">
                    <FilePenLine size={16} />
                    <div>
                      <strong>复测记录</strong>
                      <span>将当前 badcase 标记为优化中，完成后补充复测结论。</span>
                    </div>
                  </div>
                  <button className="admin-secondary-btn compact" disabled={handlingSelected} onClick={() => void createReviewTask()} type="button">开始优化复测</button>
                </section>
                <section>
                  <div className="feedback-section-title compact">
                    <DatabaseZap size={16} />
                    <div>
                      <strong>评测样本沉淀</strong>
                      <span>仅沉淀有代表性、可复现且已归因的反馈。</span>
                    </div>
                  </div>
                  <div className="feedback-sample-checklist">
                    <span className={hasLinkedProject ? "done" : ""}><CheckCircle2 size={13} />关联作品</span>
                    <span className={hasAttribution ? "done" : ""}><CheckCircle2 size={13} />完成归因</span>
                    <span className={hasResolution ? "done" : ""}><CheckCircle2 size={13} />处理结论</span>
                  </div>
                  <button className="admin-secondary-btn compact" disabled={handlingSelected || !canSettleSample} title={canSettleSample ? "沉淀为评测样本" : "需关联作品、根因归类和处理结论"} onClick={() => void settleFeedbackSample()} type="button">沉淀为评测样本</button>
                </section>
              </div>
              <div className="feedback-ops-actions sticky">
                <button className="admin-secondary-btn compact" disabled={handlingSelected} onClick={() => void saveFeedback({ status: "resolved", priority: draft.priority, rootCause: selectedRootCause, assignee: draft.assignee, resolution: draft.resolution })} type="button">标记已解决</button>
                <button className="admin-secondary-btn compact" disabled={handlingSelected} onClick={() => void saveFeedback({ status: "ignored", priority: draft.priority, rootCause: draft.rootCause, assignee: draft.assignee, resolution: draft.resolution || "已关闭：不进入当前迭代处理。" })} type="button">关闭反馈</button>
                <button className="admin-primary-btn compact" disabled={handlingSelected} onClick={() => void saveFeedback({ status: draft.status, priority: draft.priority, rootCause: draft.rootCause, assignee: draft.assignee, resolution: draft.resolution })} type="button">{handlingSelected ? <Loader2 className="spin-icon" size={15} /> : <FilePenLine size={15} />}保存处理</button>
              </div>
            </>
          ) : <EmptyHint text="请选择一条反馈进行处理。" />}
        </aside>
      </div>
      <div className="admin-pagination"><button type="button" aria-label="上一页反馈" disabled={feedbackPage <= 1 || loading} onClick={() => { if (canLeaveAdminEditor()) void loadFeedback(false, feedbackPage - 1); }}>‹</button><span>{feedbackPage} / {feedbackPages}</span><button type="button" aria-label="下一页反馈" disabled={feedbackPage >= feedbackPages || loading} onClick={() => { if (canLeaveAdminEditor()) void loadFeedback(false, feedbackPage + 1); }}>›</button></div>
    </section>
  );
}

function UsersSection({
  users: refreshSnapshot,
  currentUserId,
  onDeleteUser,
  onCreateUser,
  onUserSave,
  onPasswordReset,
  onCreditAdjust
}: {
  users: AdminUserRow[];
  currentUserId: string;
  onDeleteUser: (id: string) => AdminActionResult;
  onCreateUser: (input: { name: string; email?: string; phone?: string; password: string; role?: string; status?: string; initialCredits?: number }) => AdminActionResult;
  onUserSave: (userId: string, input: Partial<Pick<AdminUserRow, "name" | "email" | "phone" | "role" | "status">>) => AdminActionResult;
  onPasswordReset: (userId: string, password: string) => AdminActionResult;
  onCreditAdjust: (input: { userId: string; amount: number; description: string; requestId?: string }) => AdminActionResult;
}) {
  const [keyword, setKeyword] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [segment, setSegment] = useState("all");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [membershipFilter, setMembershipFilter] = useState("all");
  const [commercialFilter, setCommercialFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState("created_desc");
  const [registeredFrom, setRegisteredFrom] = useState("");
  const [registeredTo, setRegisteredTo] = useState("");
  const [visibleColumns, setVisibleColumns] = useState(["role", "commercial", "credits", "projects", "status", "login", "created"]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
  const [userTab, setUserTab] = useState<"profile" | "credits" | "security">("profile");
  const batchPending = useRef(false);
  const action = useContext(AdminActionContext);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    if (registeredFrom && registeredTo && registeredFrom > registeredTo) {
      setLoadError("注册开始日期不能晚于结束日期，请调整筛选。");
      setLoading(false);
      return () => { controller.abort(); };
    }
    const timer = window.setTimeout(() => {
      void fetchAdminUserPage({ page, pageSize, keyword: keyword.trim(), role, status, sort, registeredFrom, registeredTo, membership: membershipFilter, commercial: commercialFilter }, controller.signal).then((result) => {
        if (!current) return;
        const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
        if (page > lastPage) { setPage(lastPage); return; }
        setUsers(result.items);
        setTotal(result.total);
        setSelectedUser(current => {
          const latest = result.items.find(item => item.id === current?.id);
          return current && latest ? { ...current, credits: latest.credits, frozenCredits: latest.frozenCredits, totalRecharge: latest.totalRecharge, totalConsume: latest.totalConsume, projects: latest.projects, hasPassword: latest.hasPassword, lastLoginAt: latest.lastLoginAt, createdAt: latest.createdAt, updatedAt: latest.updatedAt, commercial: latest.commercial } : current;
        });
      }).catch((reason) => {
        if (current) setLoadError(reason instanceof Error ? reason.message : "用户列表读取失败");
      }).finally(() => { if (current) setLoading(false); });
    }, 200);
    return () => { current = false; controller.abort(); window.clearTimeout(timer); };
  }, [page, pageSize, keyword, role, status, sort, registeredFrom, registeredTo, membershipFilter, commercialFilter, reloadKey, refreshSnapshot]);
  const rows = users;
  const activeUsers = users.filter((user) => user.status === "active").length;
  const paidUsers = users.filter((user) => user.totalRecharge > 0).length;
  const totalCredits = users.reduce((sum, user) => sum + user.credits, 0);
  const allVisibleSelected = rows.length > 0 && rows.every((user) => selectedUserIds.includes(user.id));
  const selectedVisibleCount = rows.filter((user) => selectedUserIds.includes(user.id)).length;
  const railItems: AdminRailItem[] = [
    { id: "all", label: "全部用户", meta: "完整账号池", tone: "blue" },
    { id: "creator", label: "创作者", meta: "前台账号" },
    { id: "admin", label: "后台成员", meta: "后台管理员", tone: "violet" },
    { id: "member", label: "有效会员", meta: "已付权益生效中", tone: "green" },
    { id: "expired-member", label: "到期会员", meta: "查看手动续费机会" },
    { id: "online-paid", label: "在线付费用户", meta: "已确认微信付费" },
    { id: "active", label: "正常", meta: "可登录账号", tone: "green" },
    { id: "disabled", label: "停用", meta: "不可登录", tone: "danger" },
    { id: "deleted", label: "回收站", meta: "保留记录，可恢复", tone: "danger" }
  ];

  function toggleVisibleUsers() {
    setSelectedUserIds((current) => {
      if (allVisibleSelected) return current.filter((id) => !rows.some((user) => user.id === id));
      return [...new Set([...current, ...rows.map((user) => user.id)])];
    });
  }

  async function batchSetStatus(nextStatus: "active" | "disabled") {
    if (batchPending.current) return;
    const targetIds = selectedUserIds.filter((id) => id !== currentUserId && rows.some((user) => user.id === id && user.status !== "deleted"));
    if (!targetIds.length) return;
    if (!await confirmAdminAction(`确认将 ${targetIds.length} 个用户批量改为「${adminStatusLabels[nextStatus]}」？`, { title: "批量修改账号状态", confirmLabel: nextStatus === "active" ? "启用用户" : "停用用户" })) return;
    batchPending.current = true;
    try {
      const completed = await runAdminBatch(targetIds, (id) => onUserSave(id, { status: nextStatus }));
      setSelectedUserIds((current) => current.filter((id) => !completed.includes(id)));
    } finally {
      batchPending.current = false;
    }
  }

  function openUser(user: AdminUserRow, tab: "profile" | "credits" | "security" = "profile") {
    if (user.id === selectedUserId || canLeaveAdminEditor()) { setSelectedUserId(user.id); setSelectedUser(user); setUserTab(tab); }
  }
  function resetQuery() {
    if (!canLeaveAdminEditor()) return;
    setKeyword(""); setRole("all"); setStatus("all"); setSegment("all"); setMembershipFilter("all"); setCommercialFilter("all"); setRegisteredFrom(""); setRegisteredTo(""); setSort("created_desc"); setPage(1); setSelectedUserIds([]);
  }
  const optionalColumns: AdminColumn<AdminUserRow>[] = [
    { key: "commercial", label: "商业身份", render: user => <AdminCommercialIdentity user={user} /> },
    { key: "phone", label: "手机号", render: user => user.phone || "未绑定" },
    { key: "role", label: "角色", render: user => <span className="adm-role" data-role={user.role}>{adminRoleLabels[user.role] ?? user.role}</span> },
    { key: "credits", label: "可用 / 冻结积分", align: "right", render: user => <div className="adm-balance"><strong>{user.credits.toLocaleString()}</strong><small>冻结 {user.frozenCredits.toLocaleString()}</small></div> },
    { key: "recharge", label: "累计入账积分", align: "right", render: user => user.totalRecharge.toLocaleString() },
    { key: "consumed", label: "累计消耗积分", align: "right", render: user => user.totalConsume.toLocaleString() },
    { key: "projects", label: "项目", align: "right", render: user => user.projects.toLocaleString() },
    { key: "status", label: "状态", render: user => <span className="adm-status" data-status={user.status}>{adminStatusLabels[user.status] ?? user.status}</span> },
    { key: "login", label: "最近登录", render: user => <AdminDate value={user.lastLoginAt} empty="暂无登录记录" /> },
    { key: "created", label: "注册时间", render: user => <AdminDate value={user.createdAt} /> }
  ];
  const columns: AdminColumn<AdminUserRow>[] = [
    { key: "select", label: "选择", width: "48px", render: user => <input type="checkbox" aria-label={`选择${user.name}`} checked={selectedUserIds.includes(user.id)} onChange={() => setSelectedUserIds(current => current.includes(user.id) ? current.filter(id => id !== user.id) : [...current, user.id])} /> },
    { key: "user", label: "用户", render: user => <div className="adm-user-cell"><span className="adm-user-avatar" aria-hidden="true">{user.name.trim().slice(0, 1).toUpperCase()}</span><div><strong>{user.name}{user.id === currentUserId ? <em>我</em> : null}</strong><small title={user.email || user.phone || user.id}>{user.email || user.phone || user.id}</small></div></div> },
    ...optionalColumns.filter(column => visibleColumns.includes(column.key)),
    { key: "actions", label: "操作", width: "132px", sticky: "right", render: user => <div className="adm-user-row-actions"><button className="adm-row-open" type="button" aria-label={`管理用户 ${user.name}`} title="编辑用户资料" onClick={() => openUser(user)}><FilePenLine size={17} /></button><button className="adm-row-open" type="button" aria-label={`调整积分 ${user.name}`} title="积分与流水概况" onClick={() => openUser(user, "credits")}><WalletCards size={17} /></button><button className="adm-row-open" type="button" aria-label={`账号安全 ${user.name}`} title="密码与账号安全" onClick={() => openUser(user, "security")}><ShieldCheck size={17} /></button></div> }
  ];

  return (
    <section className="admin-v2-section adm-users-section">
      <AdminModuleWorkbench
        railTitle="用户分层"
        railDescription="先选运营视角，再用搜索和筛选精确定位账号。"
        railItems={railItems}
        activeRail={segment}
        onRailChange={(next) => { setSegment(next); setPage(1); setRole(next === "admin" || next === "creator" ? next : "all"); setStatus(["active", "disabled", "deleted"].includes(next) ? next : "all"); setMembershipFilter(next === "member" ? "active" : next === "expired-member" ? "expired" : "all"); setCommercialFilter(next === "online-paid" ? "online_paid" : "all"); setSelectedUserIds([]); }}
        railFooter={<span>账号状态与权限管理</span>}
      >
        <div className="adm-users-overview" aria-label="用户列表统计" aria-busy={loading}>
          <div><span>匹配用户</span><strong>{loading || loadError ? "—" : total.toLocaleString()}<small>位</small></strong></div>
          <div><span>本页正常账号</span><strong>{loading || loadError ? "—" : activeUsers}<small>/ {rows.length}</small></strong></div>
          <div><span>本页可用积分</span><strong>{loading || loadError ? "—" : totalCredits.toLocaleString()}</strong></div>
          <div><span>本页有入账记录</span><strong>{loading || loadError ? "—" : paidUsers}<small>含赠送与调整</small></strong></div>
        </div>
        <AdminToolbar
          right={
            <AdminActionBar>
              <button className="admin-icon-btn" aria-label="刷新用户列表" title="刷新用户列表" disabled={loading} onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={18} /></button>
              <button className="admin-secondary-btn" type="button" aria-pressed={status === "deleted"} onClick={() => { setStatus(status === "deleted" ? "all" : "deleted"); setPage(1); setSelectedUserIds([]); }}><Trash2 size={16} />回收站</button>
              <button className="admin-primary-btn" type="button" onClick={() => setCreateOpen(true)}><Plus size={18} />创建用户</button>
            </AdminActionBar>
          }
        >
          <SearchField value={keyword} onChange={(value) => { setKeyword(value); setPage(1); setSelectedUserIds([]); }} placeholder="搜索姓名、邮箱、手机号或完整 ID..." />
          <SelectFilter value={role} onChange={(value) => { setRole(value); setSegment("all"); setPage(1); setSelectedUserIds([]); }} options={["all", "creator", "admin"]} labels={{ all: "全部角色", creator: "创作者", admin: "后台管理员" }} />
          <SelectFilter value={status} onChange={(value) => { setStatus(value); setSegment("all"); setPage(1); setSelectedUserIds([]); }} options={["all", "active", "disabled", "deleted"]} labels={{ all: "未删除用户", active: "正常", disabled: "停用", deleted: "已删除" }} />
          <label>会员状态<select aria-label="会员状态筛选" value={membershipFilter} onChange={event => { setMembershipFilter(event.target.value); setSegment("all"); setPage(1); setSelectedUserIds([]); }}><option value="all">全部会员状态</option>{Object.entries(membershipLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
          <label>在线付费<select aria-label="在线付费筛选" value={commercialFilter} onChange={event => { setCommercialFilter(event.target.value); setSegment("all"); setPage(1); setSelectedUserIds([]); }}><option value="all">全部付费记录</option><option value="online_paid">有在线付费记录</option><option value="no_online_record">暂无在线付费记录</option></select></label>
        </AdminToolbar>
        <details className="adm-user-filters" open={registeredFrom || registeredTo ? true : undefined}>
          <summary><SlidersHorizontal size={15} />注册日期与排序{registeredFrom || registeredTo ? <span>已设置日期范围</span> : null}</summary>
          <div>
            <label>注册开始日期<input type="date" aria-label="注册开始日期" value={registeredFrom} max={registeredTo || undefined} onChange={event => { if (canLeaveAdminEditor()) { setRegisteredFrom(event.target.value); setPage(1); setSelectedUserIds([]); } }} /></label>
            <label>注册结束日期<input type="date" aria-label="注册结束日期" value={registeredTo} min={registeredFrom || undefined} onChange={event => { if (canLeaveAdminEditor()) { setRegisteredTo(event.target.value); setPage(1); setSelectedUserIds([]); } }} /></label>
            <label>排列顺序<select aria-label="用户排序" value={sort} onChange={event => { if (canLeaveAdminEditor()) { setSort(event.target.value); setPage(1); setSelectedUserIds([]); } }}><option value="created_desc">最近注册</option><option value="created_asc">最早注册</option><option value="login_desc">最近登录</option><option value="credits_desc">可用积分从高到低</option><option value="name_asc">用户名升序</option></select></label>
            <button type="button" className="admin-secondary-btn" onClick={resetQuery}>重置筛选</button>
          </div>
          <p>日期按当前设备时区，包含开始与结束当天；最近登录不代表最近一次使用。</p>
        </details>
        {selectedVisibleCount ? <div className="adm-selection-bar" role="region" aria-label="用户批量操作"><strong>本页已选 {selectedVisibleCount} 位</strong><span>不修改当前管理员和已删除账号</span><button className="admin-secondary-btn compact" disabled={action.pending || loading || Boolean(loadError) || status === "deleted"} type="button" onClick={() => void batchSetStatus("active")}>启用当前已选</button><button className="admin-secondary-btn compact" disabled={action.pending || loading || Boolean(loadError) || status === "deleted"} type="button" onClick={() => void batchSetStatus("disabled")}>停用当前已选</button><button className="admin-text-btn" type="button" onClick={() => setSelectedUserIds([])}>取消选择</button></div> : null}
        <AdminTablePage
          title="账号列表"
          summary="查看账号与使用概况，点击管理展开完整资料。"
          actions={<div className="adm-table-tools"><label className="admin-row-checkbox"><input type="checkbox" checked={allVisibleSelected} disabled={loading || Boolean(loadError) || !rows.length} ref={node => { if (node) node.indeterminate = Boolean(selectedVisibleCount && !allVisibleSelected); }} onChange={toggleVisibleUsers} />选择本页</label><details className="adm-column-picker"><summary><SlidersHorizontal size={15} />显示列</summary><div>{optionalColumns.map(column => <label key={column.key}><input type="checkbox" checked={visibleColumns.includes(column.key)} onChange={() => setVisibleColumns(current => current.includes(column.key) ? current.filter(key => key !== column.key) : [...current, column.key])} />{column.label}</label>)}</div></details></div>}
          columns={columns}
          rows={rows}
          rowKey={(user) => user.id}
          loading={loading}
          error={loadError}
          page={page}
          totalPages={Math.max(1, Math.ceil(total / pageSize))}
          total={total}
          pageSize={pageSize}
          onPageSizeChange={size => { setPageSize(size); setPage(1); setSelectedUserIds([]); }}
          onPageChange={(next) => { setPage(next); setSelectedUserIds([]); setSelectedUserId(null); }}
          emptyText="没有匹配的用户；请调整分层、搜索或筛选条件"
          onRowClick={openUser}
        />
      </AdminModuleWorkbench>
      <AdminMasterDetail open={Boolean(selectedUser)} title={selectedUser?.name ?? "用户详情"} meta={selectedUser ? <p>{selectedUser.email || selectedUser.phone || selectedUser.id}</p> : null} busy={action.pending} onClose={() => { setSelectedUserId(null); setSelectedUser(null); }}>
        <AdminScopedActionNotice />
        {selectedUser ? <div className="adm-user-detail-editor"><UserRow key={selectedUser.id} user={selectedUser} tab={userTab} onTabChange={setUserTab} isSelf={selectedUser.id === currentUserId} selected={selectedUserIds.includes(selectedUser.id)} onToggleSelected={() => setSelectedUserIds((current) => current.includes(selectedUser.id) ? current.filter((id) => id !== selectedUser.id) : [...current, selectedUser.id])} onUserSave={async (id, input) => { const result = await onUserSave(id, input); if (result !== false) { setSelectedUser(current => current ? { ...current, ...input } : null); setReloadKey(value => value + 1); } return result; }} onDeleteUser={async (id) => { const result = await onDeleteUser(id); if (result !== false) { setSelectedUser(null); setSelectedUserId(null); setSelectedUserIds(current => current.filter(value => value !== id)); setReloadKey(value => value + 1); } return result; }} onPasswordReset={onPasswordReset} onCreditAdjust={onCreditAdjust} /></div> : null}
      </AdminMasterDetail>
      <AdminModal open={createOpen} title="创建用户" description="创建后可立即登录；初始积分会写入流水，密码不在后台明文保存。" onClose={() => setCreateOpen(false)} wide>
        <AdminUserCreator onCreate={(input) => closeAfterAdminSuccess(() => onCreateUser(input), () => setCreateOpen(false))} />
      </AdminModal>
    </section>
  );
}

type AnnouncementInput = Pick<PlatformAnnouncement, "title" | "body" | "type" | "enabled" | "pinned"> & { startsAt?: string | null; endsAt?: string | null };
type HelpArticleInput = Pick<HelpArticle, "title" | "summary" | "content" | "category" | "tags" | "enabled" | "pinned" | "sortOrder">;

function AnnouncementsSection({
  announcements,
  helpArticles,
  onCreate,
  onSave,
  onDelete,
  onHelpCreate,
  onHelpSave,
  onHelpDelete
}: {
  announcements: PlatformAnnouncement[];
  helpArticles: HelpArticle[];
  onCreate: (input: AnnouncementInput) => AdminActionResult;
  onSave: (id: string, input: Partial<AnnouncementInput>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
  onHelpCreate: (input: HelpArticleInput) => AdminActionResult;
  onHelpSave: (id: string, input: Partial<HelpArticleInput>) => AdminActionResult;
  onHelpDelete: (id: string) => AdminActionResult;
}) {
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState("all");
  const [segment, setSegment] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [submodule, setSubmodule] = useState<"announcements" | "help">("announcements");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  // Recompute membership only after an explicit filter change or a refreshed server list.
  // The live clock below can update badges/counts without unmounting an unsaved row editor.
  const rows = useMemo(() => selectAnnouncementRows(announcements, { keyword, type, segment }), [announcements, keyword, type, segment]);
  const liveRows = announcements.filter((item) => announcementScheduleStatus(item, now) === "active");
  const railItems: AdminRailItem[] = [
    { id: "all", label: "全部公告", count: announcements.length, meta: "后台公告池", tone: "blue" },
    { id: "active", label: "前台生效", count: liveRows.length, meta: "工作台可见", tone: "green" },
    { id: "pinned", label: "置顶", count: announcements.filter((item) => item.pinned).length, meta: "优先展示", tone: "amber" },
    { id: "scheduled", label: "定时发布", count: announcements.filter((item) => announcementScheduleStatus(item, now) === "scheduled").length, meta: "等待开始", tone: "blue" },
    { id: "expired", label: "已过期", count: announcements.filter((item) => announcementScheduleStatus(item, now) === "expired").length, meta: "自动隐藏", tone: "danger" },
    { id: "disabled", label: "停用", count: announcements.filter((item) => announcementScheduleStatus(item, now) === "disabled").length, meta: "不会展示", tone: "danger" },
    { id: "update", label: "更新", count: announcements.filter((item) => item.type === "update").length, meta: "版本/能力" },
    { id: "guide", label: "指引", count: announcements.filter((item) => item.type === "guide").length, meta: "教程/说明", tone: "violet" },
    { id: "warning", label: "提醒", count: announcements.filter((item) => item.type === "warning").length, meta: "故障/风险", tone: "amber" }
  ];

  const pagination = useAdminPagination(rows, `${keyword}:${type}:${segment}`);

  return (
    <section className="admin-v2-section admin-announcement-section">
      <div className="admin-product-tabs">
        <button className={submodule === "announcements" ? "active" : undefined} type="button" onClick={() => { if (canLeaveAdminEditor()) setSubmodule("announcements"); }}>
          <Megaphone size={18} />公告管理<span>{announcements.length}</span>
        </button>
        <button className={submodule === "help" ? "active" : undefined} type="button" onClick={() => { if (canLeaveAdminEditor()) setSubmodule("help"); }}>
          <BookOpen size={18} />帮助中心<span>{helpArticles.length}</span>
        </button>
      </div>
      {submodule === "announcements" ? (
        <>
          <AdminModuleWorkbench
            railTitle="公告分层"
            railDescription="控制哪些公告进入前台工作台，并保留排期和置顶能力。"
            railItems={railItems}
            activeRail={segment}
            onRailChange={setSegment}
            railFooter={<span>当前命中 {rows.length} 条，前台生效 {liveRows.length} 条。</span>}
          >
            <div className="admin-product-metrics compact">
              <AdminMetric icon={<Megaphone size={20} />} label="公告总数" value={announcements.length} hint="后台可管理记录" tone="blue" />
              <AdminMetric icon={<CheckCircle2 size={20} />} label="前台生效" value={liveRows.length} hint="工作台正在展示" tone="green" />
              <AdminMetric icon={<ShieldCheck size={20} />} label="置顶公告" value={announcements.filter((item) => item.pinned).length} hint="优先级最高" tone="amber" />
              <AdminMetric icon={<Activity size={20} />} label="当前未展示" value={announcements.length - liveRows.length} hint="含排期、停用与过期" tone="violet" />
            </div>
            <AdminToolbar right={<button className="admin-primary-btn" type="button" onClick={() => setCreateOpen(true)}><Plus size={18} />新增公告</button>}>
              <SearchField value={keyword} onChange={setKeyword} placeholder="搜索标题或公告内容..." />
              <SelectFilter value={type} onChange={setType} options={["all", "info", "guide", "update", "warning"]} labels={{ all: "全部类型", info: "信息", guide: "指引", update: "更新", warning: "提醒" }} />
            </AdminToolbar>
            <div className="admin-announcement-list">
              {pagination.items.map((item) => (
                <AnnouncementRow key={item.id} announcement={item} now={now} onSave={onSave} onDelete={onDelete} />
              ))}
              {!rows.length ? <EmptyHint text="没有匹配的公告。可以切换上方分类，或新增一条前台公告。" /> : null}
            </div>
            <TableFooter total={rows.length} page={pagination.page} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
          </AdminModuleWorkbench>
          <AdminModal open={createOpen} title="新增平台公告" description="公告启用后会出现在前台工作台，可用置顶和生效时间控制展示顺序。" onClose={() => setCreateOpen(false)} wide>
            <AnnouncementCreator onCreate={(input) => closeAfterAdminSuccess(() => onCreate(input), () => setCreateOpen(false))} />
          </AdminModal>
        </>
      ) : (
        <HelpArticlesManager articles={helpArticles} onCreate={onHelpCreate} onSave={onHelpSave} onDelete={onHelpDelete} />
      )}
    </section>
  );
}

const helpCategoryLabels: Record<HelpArticle["category"], string> = {
  getting_started: "新手必读",
  workflow: "脚本与剧情",
  billing: "积分与账单",
  account: "账号安全",
  troubleshooting: "出问题怎么办",
  community: "创作社群"
};

const helpCategoryOptions: Array<HelpArticle["category"]> = ["getting_started", "workflow", "billing", "account", "troubleshooting", "community"];

function HelpArticlesManager({
  articles,
  onCreate,
  onSave,
  onDelete
}: {
  articles: HelpArticle[];
  onCreate: (input: HelpArticleInput) => AdminActionResult;
  onSave: (id: string, input: Partial<HelpArticleInput>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("all");
  const [segment, setSegment] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const rows = articles.filter((item) => {
    const matchedKeyword = `${item.title} ${item.summary} ${item.content} ${item.tags.join(" ")}`.toLowerCase().includes(keyword.toLowerCase());
    const matchedCategory = category === "all" || item.category === category;
    const matchedSegment =
      segment === "all" ||
      (segment === "active" && item.enabled) ||
      (segment === "pinned" && item.pinned) ||
      (segment === "disabled" && !item.enabled) ||
      item.category === segment;
    return matchedKeyword && matchedCategory && matchedSegment;
  });
  const activeRows = articles.filter((item) => item.enabled);
  const railItems: AdminRailItem[] = [
    { id: "all", label: "全部帮助", count: articles.length, meta: "帮助中心内容池", tone: "blue" },
    { id: "active", label: "前台生效", count: activeRows.length, meta: "帮助中心可见", tone: "green" },
    { id: "pinned", label: "置顶", count: articles.filter((item) => item.pinned).length, meta: "优先展示", tone: "amber" },
    { id: "disabled", label: "停用", count: articles.filter((item) => !item.enabled).length, meta: "不会展示", tone: "violet" },
    ...helpCategoryOptions.map((item) => ({
      id: item,
      label: helpCategoryLabel(item),
      count: articles.filter((article) => article.category === item).length,
      meta: "分类内容"
    }))
  ];

  const pagination = useAdminPagination(rows, `${keyword}:${category}:${segment}`);

  return (
    <AdminModuleWorkbench
      railTitle="帮助中心"
      railDescription="管理前台帮助中心的教程、FAQ 和操作说明。"
      railItems={railItems}
      activeRail={segment}
      onRailChange={setSegment}
      railFooter={<span>当前命中 {rows.length} 条，前台生效 {activeRows.length} 条。</span>}
    >
      <div className="admin-product-metrics compact">
        <AdminMetric icon={<BookOpen size={20} />} label="帮助文章" value={articles.length} hint="后台可管理记录" tone="blue" />
        <AdminMetric icon={<CheckCircle2 size={20} />} label="前台生效" value={activeRows.length} hint="帮助中心正在展示" tone="green" />
        <AdminMetric icon={<ShieldCheck size={20} />} label="置顶内容" value={articles.filter((item) => item.pinned).length} hint="优先展示给用户" tone="amber" />
        <AdminMetric icon={<Activity size={20} />} label="停用内容" value={articles.length - activeRows.length} hint="不会进入前台" tone="violet" />
      </div>
      <AdminToolbar right={<button className="admin-primary-btn" type="button" onClick={() => setCreateOpen(true)}><Plus size={18} />新增帮助</button>}>
        <SearchField value={keyword} onChange={setKeyword} placeholder="搜索标题、摘要、正文或标签..." />
        <SelectFilter value={category} onChange={setCategory} options={["all", ...helpCategoryOptions]} labels={{ all: "全部分类", ...helpCategoryLabels }} />
      </AdminToolbar>
      <div className="admin-announcement-list admin-help-article-list">
        {pagination.items.map((item) => (
          <HelpArticleRow key={item.id} article={item} onSave={onSave} onDelete={onDelete} />
        ))}
        {!rows.length ? <EmptyHint text="没有匹配的帮助内容。可以切换左侧分类，或新增一条操作帮助。" /> : null}
      </div>
      <TableFooter total={rows.length} page={pagination.page} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
      <AdminModal open={createOpen} title="新增帮助文章" description="文章启用后会进入前台帮助中心，可通过分类、排序和置顶控制展示。" onClose={() => setCreateOpen(false)} wide>
        <HelpArticleCreator onCreate={(input) => closeAfterAdminSuccess(() => onCreate(input), () => setCreateOpen(false))} />
      </AdminModal>
    </AdminModuleWorkbench>
  );
}

function HelpArticleRow({
  article,
  onSave,
  onDelete
}: {
  article: HelpArticle;
  onSave: (id: string, input: Partial<HelpArticleInput>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const [draft, setDraft] = useState(() => helpArticleDraft(article));
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(helpArticleDraft(article)), [article.id, article.updatedAt]);
  const dirty =
    draft.title !== article.title ||
    draft.summary !== article.summary ||
    draft.content !== article.content ||
    draft.category !== article.category ||
    draft.tags !== article.tags.join("，") ||
    draft.enabled !== article.enabled ||
    draft.pinned !== article.pinned ||
    Number(draft.sortOrder) !== article.sortOrder;
  return (
    <article className="admin-announcement-card admin-help-article-card" data-admin-dirty={dirty || undefined}>
      <button className="admin-record-open" type="button" aria-label={`编辑文章 ${article.title}`} onClick={() => setEditing(true)}><div><strong>{article.title}</strong><p>{article.summary || article.content}</p></div><div className="admin-record-meta"><span>{helpCategoryLabel(article.category)}</span><StatusChip active={article.enabled} /><DraftIndicator dirty={dirty} /><span>编辑文章</span><FilePenLine size={16} /></div></button>
      <AdminModal open={editing} title="编辑帮助文章" description={article.title} onClose={() => { setDraft(helpArticleDraft(article)); setEditing(false); }} wide>
        <div data-admin-dirty={dirty || undefined}>
      <div className="admin-announcement-card-head">
        <span className={`admin-chip help-${draft.category}`}>{helpCategoryLabel(draft.category)}</span>
        <StatusChip active={article.enabled} label={article.enabled ? "已展示" : "已停用"} /><DraftIndicator dirty={dirty} />
        {draft.pinned ? <span className="admin-status enabled">置顶</span> : null}
        <AdminDialogActions>
          <button className="admin-icon-btn" title={draft.enabled ? "停用" : "启用"} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>{draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button>
          <button className={dirty ? "admin-text-btn primary" : "admin-text-btn"} disabled={!dirty || !draft.title.trim() || !draft.content.trim()} onClick={() => onSave(article.id, {
            title: draft.title,
            summary: draft.summary,
            content: draft.content,
            category: draft.category,
            tags: splitTags(draft.tags),
            enabled: draft.enabled,
            pinned: draft.pinned,
            sortOrder: Number(draft.sortOrder) || 0
          })}>保存</button>
          <button className="admin-icon-btn danger" title="删除帮助" onClick={async () => { if (await confirmAdminAction("确认删除这条帮助内容？前台帮助中心会立即不再展示。", { title: "删除帮助文章", confirmLabel: "删除文章" })) void onDelete(article.id); }}><Trash2 size={16} /></button>
        </AdminDialogActions>
      </div>
      <div className="admin-announcement-form-grid admin-help-form-grid">
        <label className="wide"><span>标题</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label><span>分类</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as HelpArticle["category"] })}>
          {helpCategoryOptions.map((item) => <option value={item} key={item}>{helpCategoryLabel(item)}</option>)}
        </select></label>
        <label><span>排序</span><input type="number" min="0" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} /></label>
        <label><span>展示优先级</span><button className={draft.pinned ? "admin-secondary-btn compact active" : "admin-secondary-btn compact"} type="button" onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}>{draft.pinned ? "已置顶" : "普通"}</button></label>
        <label className="wide"><span>摘要</span><input value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
        <label className="wide"><span>正文</span><textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} /></label>
        <label className="wide"><span>标签</span><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="用逗号分隔，例如：新手必读，积分" /></label>
      </div>
    </div></AdminModal>
    </article>
  );
}

function HelpArticleCreator({ onCreate }: { onCreate: (input: HelpArticleInput) => AdminActionResult }) {
  const [draft, setDraft] = useState({
    title: "",
    summary: "",
    content: "",
    category: "getting_started" as HelpArticle["category"],
    tags: "新手必读",
    enabled: true,
    pinned: false,
    sortOrder: "10"
  });
  return (
    <div className="admin-modal-form admin-announcement-create-form">
      <div>
        <strong>发布到前台帮助中心</strong>
        <span>适合放新手教程、操作步骤、积分说明和常见故障处理，不要写成公告口吻。</span>
      </div>
      <label className="admin-create-field wide"><span>标题</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：角色长相不稳定，应该怎么处理？" /></label>
      <label className="admin-create-field wide"><span>摘要</span><input value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} placeholder="一句话说明这篇帮助解决什么问题。" /></label>
      <label className="admin-create-field wide"><span>正文</span><textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="写清楚操作步骤、注意事项和排查顺序。" /></label>
      <label className="admin-create-field"><span>分类</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as HelpArticle["category"] })}>
        {helpCategoryOptions.map((item) => <option value={item} key={item}>{helpCategoryLabel(item)}</option>)}
      </select></label>
      <label className="admin-create-field"><span>排序</span><input type="number" min="0" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} /></label>
      <label className="admin-create-field wide"><span>标签</span><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="用逗号分隔，例如：新手必读，积分" /></label>
      <label className="admin-create-field checkbox-field"><span>前台展示</span><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /></label>
      <label className="admin-create-field checkbox-field"><span>置顶</span><input type="checkbox" checked={draft.pinned} onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })} /></label>
      <AdminDialogActions><button className="admin-primary-btn" disabled={!draft.title.trim() || !draft.content.trim()} onClick={() => onCreate({
        title: draft.title,
        summary: draft.summary,
        content: draft.content,
        category: draft.category,
        tags: splitTags(draft.tags),
        enabled: draft.enabled,
        pinned: draft.pinned,
        sortOrder: Number(draft.sortOrder) || 0
      })}>
        <BookOpen size={18} />发布帮助
      </button></AdminDialogActions>
    </div>
  );
}

function helpArticleDraft(article: HelpArticle) {
  return {
    title: article.title,
    summary: article.summary,
    content: article.content,
    category: article.category,
    tags: article.tags.join("，"),
    enabled: article.enabled,
    pinned: article.pinned,
    sortOrder: String(article.sortOrder)
  };
}

function splitTags(value: string) {
  return [...new Set(value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 8);
}

function helpCategoryLabel(value: HelpArticle["category"]) {
  return helpCategoryLabels[value] ?? value;
}

function AnnouncementRow({
  announcement,
  now,
  onSave,
  onDelete
}: {
  announcement: PlatformAnnouncement;
  now: number;
  onSave: (id: string, input: Partial<AnnouncementInput>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const [draft, setDraft] = useState(() => announcementDraft(announcement));
  const [editing, setEditing] = useState(false);
  const scheduleHintId = useId();
  const scheduleErrorId = useId();
  const schedule = buildAnnouncementSchedule(draft, announcement);
  const status = announcementScheduleStatus(announcement, now);
  useEffect(() => setDraft(announcementDraft(announcement)), [announcement.id, announcement.updatedAt]);
  const dirty =
    draft.title !== announcement.title ||
    draft.body !== announcement.body ||
    draft.type !== announcement.type ||
    draft.enabled !== announcement.enabled ||
    draft.pinned !== announcement.pinned ||
    draft.startsAt !== announcementDateInput(announcement.startsAt) ||
    draft.endsAt !== announcementDateInput(announcement.endsAt);
  return (
    <article className="admin-announcement-card" data-admin-dirty={dirty || undefined}>
      <button className="admin-record-open" type="button" aria-label={`编辑公告 ${announcement.title}`} onClick={() => setEditing(true)}><div><strong>{announcement.title}</strong><p>{announcement.body}</p><div className="adm-record-subline"><span>{announcementTypeLabel(announcement.type)}</span>{announcement.pinned ? <span>已置顶</span> : null}<time dateTime={announcement.updatedAt}>更新于 {formatDate(announcement.updatedAt)}</time></div></div><div className="admin-record-meta"><StatusChip active={status === "active"} label={announcementStatusLabels[status]} /><DraftIndicator dirty={dirty} /><span>编辑公告</span><FilePenLine size={16} /></div></button>
      <AdminModal open={editing} title="编辑平台公告" description={announcement.title} onClose={() => { setDraft(announcementDraft(announcement)); setEditing(false); }} wide>
        <div data-admin-dirty={dirty || undefined}>
      <div className="admin-announcement-card-head">
        <span className={`admin-chip announcement-${draft.type}`}>{announcementTypeLabel(draft.type)}</span>
        <StatusChip active={status === "active"} label={announcementStatusLabels[status]} />
        {dirty ? <span className="admin-chip">未保存</span> : null}
        {draft.pinned ? <span className="admin-status enabled">置顶</span> : null}
        <AdminDialogActions>
          <button className="admin-icon-btn" title={draft.enabled ? "停用" : "启用"} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>{draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button>
          <button className={dirty ? "admin-text-btn primary" : "admin-text-btn"} disabled={!dirty || !draft.title.trim() || !draft.body.trim() || !schedule.ok} onClick={() => schedule.ok && onSave(announcement.id, {
            title: draft.title,
            body: draft.body,
            type: draft.type,
            enabled: draft.enabled,
            pinned: draft.pinned,
            ...schedule.patch
          })}>保存</button>
          <button className="admin-icon-btn danger" title="删除公告" onClick={async () => { if (await confirmAdminAction("确认删除这条平台公告？前台会立即不再展示。", { title: "删除平台公告", confirmLabel: "删除公告" })) void onDelete(announcement.id); }}><Trash2 size={16} /></button>
        </AdminDialogActions>
      </div>
      <div className="admin-announcement-form-grid">
        <label className="wide"><span>标题</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label><span>类型</span><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as PlatformAnnouncement["type"] })}>
          <option value="info">信息</option>
          <option value="guide">指引</option>
          <option value="update">更新</option>
          <option value="warning">提醒</option>
        </select></label>
        <label><span>展示优先级</span><button className={draft.pinned ? "admin-secondary-btn compact active" : "admin-secondary-btn compact"} type="button" onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}>{draft.pinned ? "已置顶" : "普通"}</button></label>
        <label><span>开始日期（北京时间）</span><input type="date" value={draft.startsAt} aria-invalid={!schedule.ok && schedule.field === "startsAt"} aria-describedby={`${scheduleHintId}${!schedule.ok ? ` ${scheduleErrorId}` : ""}`} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></label>
        <label><span>结束日期（北京时间）</span><input type="date" value={draft.endsAt} aria-invalid={!schedule.ok && schedule.field === "endsAt"} aria-describedby={`${scheduleHintId}${!schedule.ok ? ` ${scheduleErrorId}` : ""}`} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /></label>
        <small className="wide" id={scheduleHintId}>开始日零点生效，结束日全天有效；留空不设限制。未修改的日期保留原精确时刻。</small>
        {!schedule.ok ? <p className="admin-toast danger wide" id={scheduleErrorId} role="alert">{schedule.error}</p> : null}
        <label className="wide"><span>公告内容</span><textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
      </div>
    </div></AdminModal>
    </article>
  );
}

function AnnouncementCreator({ onCreate }: { onCreate: (input: AnnouncementInput) => AdminActionResult }) {
  const [draft, setDraft] = useState({
    title: "",
    body: "",
    type: "info" as PlatformAnnouncement["type"],
    enabled: true,
    pinned: false,
    startsAt: "",
    endsAt: ""
  });
  const scheduleHintId = useId();
  const scheduleErrorId = useId();
  const schedule = buildAnnouncementSchedule(draft);
  return (
    <div className="admin-modal-form admin-announcement-create-form">
      <div>
        <strong>发布到前台工作台</strong>
        <span>推荐用于模型维护、价格变更、功能更新和新手引导，不要写过长营销文案。</span>
      </div>
      <label className="admin-create-field wide"><span>标题</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：Seedance 视频通道维护通知" /></label>
      <label className="admin-create-field wide"><span>内容</span><textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder="说明影响范围、处理建议和恢复时间。" /></label>
      <label className="admin-create-field"><span>类型</span><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as PlatformAnnouncement["type"] })}>
        <option value="info">信息</option>
        <option value="guide">指引</option>
        <option value="update">更新</option>
        <option value="warning">提醒</option>
      </select></label>
      <label className="admin-create-field"><span>开始日期（北京时间）</span><input type="date" value={draft.startsAt} aria-invalid={!schedule.ok && schedule.field === "startsAt"} aria-describedby={`${scheduleHintId}${!schedule.ok ? ` ${scheduleErrorId}` : ""}`} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></label>
      <label className="admin-create-field"><span>结束日期（北京时间）</span><input type="date" value={draft.endsAt} aria-invalid={!schedule.ok && schedule.field === "endsAt"} aria-describedby={`${scheduleHintId}${!schedule.ok ? ` ${scheduleErrorId}` : ""}`} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /></label>
      <small className="wide" id={scheduleHintId}>开始日零点生效，结束日全天有效；留空不设限制。</small>
      {!schedule.ok ? <p className="admin-toast danger wide" id={scheduleErrorId} role="alert">{schedule.error}</p> : null}
      <label className="admin-create-field checkbox-field"><span>前台展示</span><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /></label>
      <label className="admin-create-field checkbox-field"><span>置顶</span><input type="checkbox" checked={draft.pinned} onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })} /></label>
      <AdminDialogActions><button className="admin-primary-btn" disabled={!draft.title.trim() || !draft.body.trim() || !schedule.ok} onClick={() => schedule.ok && onCreate({
        title: draft.title,
        body: draft.body,
        type: draft.type,
        enabled: draft.enabled,
        pinned: draft.pinned,
        ...schedule.patch
      })}>
        <Megaphone size={18} />发布公告
      </button></AdminDialogActions>
    </div>
  );
}

function announcementDraft(announcement: PlatformAnnouncement) {
  return {
    title: announcement.title,
    body: announcement.body,
    type: announcement.type,
    enabled: announcement.enabled,
    pinned: announcement.pinned,
    startsAt: announcementDateInput(announcement.startsAt),
    endsAt: announcementDateInput(announcement.endsAt)
  };
}

function announcementTypeLabel(value: PlatformAnnouncement["type"]) {
  const labels: Record<PlatformAnnouncement["type"], string> = {
    info: "信息",
    guide: "指引",
    update: "更新",
    warning: "提醒"
  };
  return labels[value] ?? value;
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
  const [visibleRuns, setVisibleRuns] = useState<EvaluationRun[]>(runs.slice(0, 12));
  const [recordPage, setRecordPage] = useState(1);
  const [recordPages, setRecordPages] = useState(1);
  const [recordTotal, setRecordTotal] = useState(runs.length);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const pageRequest = useRef(0);
  const deletePending = useRef(false);
  const exportPending = useRef(false);
  const allVisibleSelected = visibleRuns.length > 0 && visibleRuns.every((run) => selectedRunIds.includes(run.id));
  const datasetPagination = useAdminPagination(datasets, "datasets", 6);

  useEffect(() => {
    setSelectedRunIds((current) => current.filter((id) => runs.some((run) => run.id === id)));
    void loadRunPage(1);
  }, [runs]);

  async function loadRunPage(page: number) {
    const requestId = ++pageRequest.current;
    setRecordsLoading(true);
    setExportError("");
    try {
      const result = await api.adminEvaluationRunsPage(page, 12);
      if (requestId !== pageRequest.current) return;
      const lastPage = Math.max(1, result.totalPages);
      if (result.page > lastPage) { await loadRunPage(lastPage); return; }
      setVisibleRuns(result.items);
      setRecordPage(result.page);
      setRecordPages(lastPage);
      setRecordTotal(result.total);
    } catch (reason) {
      if (requestId === pageRequest.current) setExportError(reason instanceof Error ? reason.message : "评测记录读取失败");
    } finally {
      if (requestId === pageRequest.current) setRecordsLoading(false);
    }
  }

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
    if (deletePending.current) return;
    if (!await confirmAdminAction(`确认删除评测记录「${run.name}」？本次运行生成的质检报告也会一起删除。`, { title: "删除评测记录", confirmLabel: "删除记录" })) return;
    setDeleting(run.id);
    deletePending.current = true;
    setExportError("");
    try {
      await onDeleteRun(run.id);
      await loadRunPage(Math.min(recordPage, recordPages));
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : "评测记录删除失败");
    } finally {
      setDeleting("");
      deletePending.current = false;
    }
  }
  async function deleteDataset(dataset: EvaluationDataset) {
    if (deletePending.current) return;
    if (!await confirmAdminAction(`确认删除样本集「${dataset.name}」？历史运行会保留当时的快照。`, { title: "删除样本集", confirmLabel: "删除样本集" })) return;
    setDeleting(dataset.id);
    deletePending.current = true;
    setExportError("");
    try {
      await onDeleteDataset(dataset.id);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : "样本集删除失败");
    } finally {
      setDeleting("");
      deletePending.current = false;
    }
  }
  async function exportRun(run: EvaluationRun) {
    if (exportPending.current) return;
    exportPending.current = true;
    setExportError("");
    setExporting(run.id);
    try {
      const blob = await api.exportEvaluationRunExcel(run.id);
      downloadBlob(blob, `${run.name.replace(/[\\/:*?"<>|]/g, "_")}.xlsx`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "单个评测记录导出失败");
    } finally {
      setExporting("");
      exportPending.current = false;
    }
  }

  async function exportRuns(scope: "selected" | "all") {
    if (exportPending.current) return;
    const ids = scope === "selected" ? selectedRunIds : undefined;
    if (scope === "selected" && !ids?.length) return;
    exportPending.current = true;
    setExportError("");
    setExporting(scope);
    try {
      const blob = await api.exportEvaluationRunsExcel(ids);
      downloadBlob(blob, scope === "selected" ? `评测记录_已选${ids!.length}条.xlsx` : "评测记录_全部.xlsx");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "评测记录导出失败");
    } finally {
      setExporting("");
      exportPending.current = false;
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
          <button className="admin-icon-btn" onClick={() => void loadRunPage(recordPage)} title="刷新评测记录">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>
      <div className="export-scope-note">
        <strong>导出逻辑</strong>
        <span>数据库共 {recordTotal} 次运行，当前第 {recordPage}/{recordPages} 页；导出全部仍覆盖完整记录。</span>
      </div>
      {exportError ? <p className="admin-toast danger" role="alert">{exportError}</p> : null}
      {recordsLoading ? <p className="admin-toast" role="status">正在加载评测记录…</p> : null}
      <div className="evaluation-dataset-compact-list">
        {datasetPagination.items.map((dataset) => (
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
      <TableFooter total={datasets.length} page={datasetPagination.page} pageSize={datasetPagination.pageSize} onPageChange={datasetPagination.setPage} />
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
                    <button className="admin-icon-btn" disabled={exporting === run.id} onClick={() => void exportRun(run)} title="导出 Excel">
                      {exporting === run.id ? <Loader2 className="spin-icon" size={15} /> : <Download size={15} />}
                    </button>
                    <button className="admin-icon-btn danger" disabled={deleting === run.id} onClick={() => void deleteRun(run)} title="删除评测记录">{deleting === run.id ? <Loader2 className="spin-icon" size={15} /> : <Trash2 size={15} />}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visibleRuns.length && !recordsLoading && !exportError ? <EmptyHint text="暂无评测记录。先在“运行评测”里选择样本并执行一次规则评分。" /> : null}
      </div>
      <div className="admin-pagination"><button type="button" aria-label="上一页评测记录" disabled={recordsLoading || recordPage <= 1} onClick={() => void loadRunPage(recordPage - 1)}>‹</button><span>{recordPage} / {recordPages}</span><button type="button" aria-label="下一页评测记录" disabled={recordsLoading || recordPage >= recordPages} onClick={() => void loadRunPage(recordPage + 1)}>›</button></div>
    </article>
  );
}

function ProjectQualityPool({ projects, onDeleteQuality }: { projects: QualityProjectRow[]; onDeleteQuality: (projectId: string) => Promise<void> }) {
  const [deleting, setDeleting] = useState("");
  const [error, setError] = useState("");
  const deletePending = useRef(false);
  async function cleanProject(row: QualityProjectRow) {
    if (deletePending.current) return;
    if (!await confirmAdminAction(`确认清理「${row.project.name}」的质检报告和用户反馈？不会删除作品本身。`, { title: "清理质检数据", confirmLabel: "确认清理" })) return;
    setDeleting(row.project.id);
    setError("");
    deletePending.current = true;
    try {
      await onDeleteQuality(row.project.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "清理质检数据失败");
    } finally {
      setDeleting("");
      deletePending.current = false;
    }
  }
  return (
    <article className="admin-v2-card">
      <div className="admin-v2-card-head">
        <div>
          <h2>项目质检池</h2>
          <p>后台统一收集所有用户生成项目，用来筛选低分、不可用反馈和需要进入下一轮优化的作品。</p>
          {error ? <p className="admin-toast danger" role="alert">{error}</p> : null}
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
  onBatchCreate: (input: { name: string; prefix: string; credits: number; count: number; enabled?: boolean }) => AdminActionResult;
  onSave: (id: string, input: Partial<Pick<RedeemCode, "name" | "code" | "credits" | "maxRedemptions" | "enabled">> & { startsAt?: string | null; endsAt?: string | null }) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("unused");
  const [viewMode, setViewMode] = useState("codes");
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const batchPending = useRef(false);
  const [batchNotice, setBatchNotice] = useState("");
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
  const railItems: AdminRailItem[] = [
    { id: "unused", label: "未使用", count: redeemCodes.filter((code) => code.usedCount === 0 && redeemStatus(code) === "active").length, meta: "默认运营视图", tone: "green" },
    { id: "all", label: "全部兑换码", count: redeemCodes.length, meta: "所有批次" },
    { id: "used", label: "已使用", count: redeemCodes.filter((code) => code.usedCount > 0).length, meta: "已产生权益", tone: "blue" },
    { id: "active", label: "可用", count: redeemCodes.filter((code) => redeemStatus(code) === "active").length, meta: "前台可兑换", tone: "green" },
    { id: "scheduled", label: "未开始", count: redeemCodes.filter((code) => redeemStatus(code) === "scheduled").length, meta: "定时活动", tone: "amber" },
    { id: "expired", label: "已过期", count: redeemCodes.filter((code) => redeemStatus(code) === "expired").length, meta: "需复盘活动", tone: "danger" },
    { id: "disabled", label: "已停用", count: redeemCodes.filter((code) => redeemStatus(code) === "disabled").length, meta: "不可兑换", tone: "danger" },
    { id: "used_up", label: "已用完", count: redeemCodes.filter((code) => redeemStatus(code) === "used_up").length, meta: "达到上限", tone: "violet" }
  ];
  const pagination = useAdminPagination(rows, `${keyword}:${status}:${viewMode}`);
  const visibleCodes = pagination.items;
  async function batchToggle(codes: RedeemCode[], enabled: boolean) {
    if (batchPending.current) return;
    const target = codes.filter((code) => code.enabled !== enabled);
    if (!target.length) { setBatchNotice("当前筛选范围内没有需要变更的兑换码。"); return; }
    if (!await confirmAdminAction(`确认${enabled ? "启用" : "停用"}当前筛选批次中的 ${target.length} 个兑换码？`, { title: "修改兑换码状态", confirmLabel: enabled ? "启用兑换码" : "停用兑换码" })) return;
    batchPending.current = true;
    setBatchNotice(`正在处理 ${target.length} 个兑换码…`);
    try { const completed = await runAdminBatch(target, (code) => onSave(code.id, { enabled })); setBatchNotice(`批量${enabled ? "启用" : "停用"}：已完成 ${completed.length} / ${target.length} 个。${completed.length < target.length ? "其余未完成，已停止；请核对错误后再操作。" : ""}`); }
    finally { batchPending.current = false; }
  }

  async function batchDeleteUnused(codes: RedeemCode[]) {
    if (batchPending.current) return;
    const unused = codes.filter((code) => code.usedCount === 0);
    if (!unused.length) return;
    if (!await confirmAdminAction(`确认删除 ${unused.length} 个未使用兑换码？已使用记录不会被删除。`, { title: "删除未使用兑换码", confirmLabel: "删除兑换码" })) return;
    batchPending.current = true;
    setBatchNotice(`正在删除 ${unused.length} 个未使用兑换码…`);
    try { const completed = await runAdminBatch(unused, (code) => onDelete(code.id)); setBatchNotice(`批量删除：已完成 ${completed.length} / ${unused.length} 个。${completed.length < unused.length ? "其余未完成，已停止；已使用记录保留。" : "已使用记录保留。"}`); }
    finally { batchPending.current = false; }
  }

  return (
    <section className="admin-v2-section">
      <AdminModuleWorkbench
        railTitle="兑换码状态"
        railDescription="按活动生命周期管理发放、兑换和停用。"
        railItems={railItems}
        activeRail={status}
        onRailChange={setStatus}
        railFooter={<span>{batches.length} 个批次，{rows.length} 个明细。</span>}
      >
        <div className="admin-product-metrics compact">
          <AdminMetric icon={<Gift size={20} />} label="兑换码总数" value={redeemCodes.length} hint="后台记录" tone="blue" />
          <AdminMetric icon={<ShieldCheck size={20} />} label="启用中" value={redeemCodes.filter((item) => item.enabled).length} hint="另受期限与次数限制" tone="green" />
          <AdminMetric icon={<WalletCards size={20} />} label="已兑换次数" value={used} hint="累计使用" tone="amber" />
          <AdminMetric icon={<CircleDollarSign size={20} />} label="平均额度" value={averageCredits(redeemCodes)} hint="积分/码" tone="violet" />
        </div>
        <AdminToolbar
          right={
            <AdminActionBar>
              <SelectFilter value={viewMode} onChange={setViewMode} options={["codes", "batches"]} labels={{ codes: "明细视图", batches: "批次视图" }} />
              <button className="admin-primary-btn" type="button" onClick={() => setCreateOpen(true)}><Plus size={18} />生成兑换码</button>
            </AdminActionBar>
          }
        >
          <SearchField value={keyword} onChange={setKeyword} placeholder="搜索兑换码、活动名、批次..." />
        </AdminToolbar>
        {batchNotice ? <InlineNotice tone="info">{batchNotice}</InlineNotice> : null}
        {viewMode === "codes" ? (
          <div className="admin-data-card">
            <div className="admin-v2-card-head">
              <div>
                <h2>兑换码明细</h2>
                <p>适合客服定位单个兑换码，也适合运营逐条调整额度、次数、期限和启停状态。</p>
              </div>
            </div>
            <div className="admin-redeem-code-list admin-redeem-code-list-standalone">
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
              {visibleCodes.map((code) => <RedeemCodeRow key={code.id} code={code} onSave={onSave} onDelete={onDelete} />)}

              {!rows.length ? <EmptyHint text="没有匹配的兑换码。可以切换左侧状态，或重新搜索批次/活动名。" /> : null}
            </div>
          </div>
        ) : (
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
            {!batches.length ? <EmptyHint text="没有匹配的兑换码批次。" /> : null}
          </div>
        )}
        <TableFooter total={rows.length} page={viewMode === "codes" ? pagination.page : undefined} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
      </AdminModuleWorkbench>
      <AdminModal open={createOpen} title="生成兑换码" description="批量生成唯一 code，默认每个 code 只可兑换一次。" onClose={() => setCreateOpen(false)} wide>
        <RedeemBatchCreator onCreate={(input) => closeAfterAdminSuccess(() => onBatchCreate(input), () => setCreateOpen(false))} />
      </AdminModal>
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
  onCreate: (input: Pick<Plan, "name" | "price" | "credits" | "bonusCredits" | "badge" | "features" | "shopUrl" | "enabled">) => AdminActionResult;
  onSave: (id: string, input: Partial<Pick<Plan, "name" | "price" | "credits" | "bonusCredits" | "badge" | "features" | "shopUrl" | "enabled">>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const [keyword, setKeyword] = useState("");
  const [segment, setSegment] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const rows = plans.filter((plan) => {
    const matchedKeyword = `${plan.name} ${plan.badge ?? ""} ${plan.features.join(" ")}`.toLowerCase().includes(keyword.toLowerCase());
    const matchedSegment =
      segment === "all" ||
      (segment === "enabled" && plan.enabled) ||
      (segment === "disabled" && !plan.enabled) ||
      (segment === "entry" && plan.price <= 20) ||
      (segment === "growth" && plan.price > 20);
    return matchedKeyword && matchedSegment;
  });
  const enabledRows = plans.filter((plan) => plan.enabled);
  const avgPrice = plans.length ? Math.round(plans.reduce((sum, plan) => sum + plan.price, 0) / plans.length) : 0;
  const railItems: AdminRailItem[] = [
    { id: "all", label: "全部套餐", count: plans.length, meta: "充值包配置", tone: "blue" },
    { id: "enabled", label: "前台展示", count: enabledRows.length, meta: "用户可购买", tone: "green" },
    { id: "disabled", label: "已停用", count: plans.length - enabledRows.length, meta: "后台保留", tone: "danger" },
    { id: "entry", label: "低价体验", count: plans.filter((plan) => plan.price <= 20).length, meta: "拉新入口", tone: "amber" },
    { id: "growth", label: "高额套餐", count: plans.filter((plan) => plan.price > 20).length, meta: "进阶付费", tone: "violet" }
  ];
  const pagination = useAdminPagination(rows, `${keyword}:${segment}`);

  return (
    <section className="admin-v2-section">
      <AdminModuleWorkbench
        railTitle="套餐运营"
        railDescription="按售卖状态和价格带管理一次性充值包。"
        railItems={railItems}
        activeRail={segment}
        onRailChange={setSegment}
        railFooter={<span>启用套餐会自动出现在前台价格区。</span>}
      >
        <div className="admin-product-metrics compact">
          <AdminMetric icon={<ReceiptText size={20} />} label="套餐数量" value={plans.length} hint={`${enabledRows.length} 个启用`} tone="blue" />
          <AdminMetric icon={<CircleDollarSign size={20} />} label="平均售价" value={`¥${avgPrice}`} hint="一次性充值包" tone="green" />
          <AdminMetric icon={<WalletCards size={20} />} label="积分总额" value={plans.reduce((sum, plan) => sum + plan.credits + plan.bonusCredits, 0).toLocaleString()} hint="全部套餐到账额度" tone="amber" />
          <AdminMetric icon={<Gift size={20} />} label="有赠送" value={plans.filter((plan) => plan.bonusCredits > 0).length} hint="带营销权益" tone="violet" />
        </div>
        <AdminToolbar right={<button className="admin-primary-btn" type="button" onClick={() => setCreateOpen(true)}><Plus size={18} />新增套餐</button>}>
          <SearchField value={keyword} onChange={setKeyword} placeholder="搜索套餐、标签、卖点..." />
        </AdminToolbar>
        <div className="admin-table-wrap admin-data-card">
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
              {pagination.items.map((plan) => (
                <PlanRow key={plan.id} plan={plan} onSave={onSave} onDelete={onDelete} />
              ))}
            </tbody>
          </table>
          {!rows.length ? <EmptyHint text="没有匹配的充值套餐。可以切换左侧价格带，或新增一个前台套餐。" /> : null}
        </div>
        <TableFooter total={rows.length} page={pagination.page} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
      </AdminModuleWorkbench>
      <AdminModal open={createOpen} title="新增充值套餐" description="套餐启用后会按价格排序展示在前台购买区。" onClose={() => setCreateOpen(false)} wide>
        <PlanCreator onCreate={(input) => closeAfterAdminSuccess(() => onCreate(input), () => setCreateOpen(false))} />
      </AdminModal>
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
  onCreate: (input: Pick<MembershipPlan, "name" | "monthlyPrice" | "monthlyCredits" | "discountPercent" | "priorityLevel" | "badge" | "features" | "shopUrl" | "enabled">) => AdminActionResult;
  onSave: (id: string, input: Partial<Pick<MembershipPlan, "name" | "monthlyPrice" | "monthlyCredits" | "discountPercent" | "priorityLevel" | "badge" | "features" | "shopUrl" | "enabled">>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const [keyword, setKeyword] = useState("");
  const [segment, setSegment] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const rows = plans.filter((plan) => {
    const matchedKeyword = `${plan.name} ${plan.badge ?? ""} ${plan.features.join(" ")}`.toLowerCase().includes(keyword.toLowerCase());
    const matchedSegment =
      segment === "all" ||
      (segment === "enabled" && plan.enabled) ||
      (segment === "disabled" && !plan.enabled) ||
      (segment === "discount" && plan.discountPercent > 0) ||
      (segment === "priority" && plan.priorityLevel > 0);
    return matchedKeyword && matchedSegment;
  });
  const enabledRows = plans.filter((plan) => plan.enabled);
  const railItems: AdminRailItem[] = [
    { id: "all", label: "全部会员", count: plans.length, meta: "订阅方案", tone: "blue" },
    { id: "enabled", label: "已启用", count: enabledRows.length, meta: "依支付配置开放", tone: "green" },
    { id: "disabled", label: "已停用", count: plans.length - enabledRows.length, meta: "后台保留", tone: "danger" },
    { id: "discount", label: "结算折扣", count: plans.filter((plan) => plan.discountPercent > 0).length, meta: "任务开始时锁定", tone: "amber" },
    { id: "priority", label: "创作优先级", count: plans.filter((plan) => plan.priorityLevel > 0).length, meta: "平台创作队列", tone: "violet" }
  ];
  const pagination = useAdminPagination(rows, `${keyword}:${segment}`);

  return (
    <section className="admin-v2-section">
      <AdminModuleWorkbench
        railTitle="会员权益"
        railDescription="管理月卡套餐、结算折扣与创作队列优先级。"
        railItems={railItems}
        activeRail={segment}
        onRailChange={setSegment}
        railFooter={<span>价格和权益随订单保存，修改仅影响新订单。</span>}
      >
        <div className="admin-product-metrics compact">
          <AdminMetric icon={<ReceiptText size={20} />} label="会员方案" value={plans.length} hint="按月购买，同档续期" tone="blue" />
          <AdminMetric icon={<CircleDollarSign size={20} />} label="启用方案" value={enabledRows.length} hint="支付配置有效时可购买" tone="green" />
          <AdminMetric icon={<WalletCards size={20} />} label="方案积分合计" value={plans.reduce((sum, plan) => sum + plan.monthlyCredits, 0).toLocaleString()} hint="各套餐单月积分之和" tone="amber" />
          <AdminMetric icon={<ShieldCheck size={20} />} label="最高创作等级" value={Math.max(0, ...plans.map((plan) => plan.priorityLevel))} hint="平台创作队列优先级" tone="violet" />
        </div>
        <p className="admin-toast" role="status">月卡按次付费，不自动扣款；每次付款立即发放当次积分，同档续费延长一个自然月。任务按原价冻结，完成后按开始时的会员折扣结算。微信商户配置通过校验后才显示购买入口。</p>
        <AdminToolbar>
          <SearchField value={keyword} onChange={setKeyword} placeholder="搜索会员、权益、标签..." />
          <button className="admin-primary-btn" onClick={() => setCreateOpen(true)}>新增会员方案</button>
        </AdminToolbar>
        <div className="admin-table-wrap admin-data-card">
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
              {pagination.items.map((plan) => (
                <MembershipRow key={`${plan.id}:${plan.monthlyPrice}:${plan.monthlyCredits}:${plan.enabled}`} plan={plan} onSave={onSave} onDelete={onDelete} />
              ))}
            </tbody>
          </table>
          {!rows.length ? <EmptyHint text="没有匹配的会员方案，可调整筛选或新增方案。" /> : null}
        </div>
        <TableFooter total={rows.length} page={pagination.page} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
      </AdminModuleWorkbench>
      <AdminModal open={createOpen} title="新增订阅会员" description="用于管理月度积分、模型折扣、队列优先级和前台展示权益。" onClose={() => setCreateOpen(false)} wide>
        <MembershipCreator onCreate={(input) => closeAfterAdminSuccess(() => onCreate(input), () => setCreateOpen(false))} />
      </AdminModal>
    </section>
  );
}

function ProvidersSection({
  providers,
  modelPrices,
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
  modelPrices: ModelPrice[];
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
  onTest: (provider: ModelProvider, model: string, dirty?: boolean) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [modality, setModality] = useState("all");
  const [status, setStatus] = useState("all");
  const [segment, setSegment] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<"channels" | "catalog">("channels");
  const [editingProvider, setEditingProvider] = useState("");
  const rows = providers.filter((provider) => {
    const matchedKeyword = `${provider.name} ${provider.id} ${provider.models.join(" ")}`.toLowerCase().includes(keyword.toLowerCase());
    const matchedModality = modality === "all" || provider.modality === modality;
    const matchedStatus = status === "all" || (status === "enabled" ? provider.enabled : !provider.enabled);
    const matchedSegment =
      segment === "all" ||
      (segment === "enabled" && provider.enabled) ||
      (segment === "disabled" && !provider.enabled) ||
      (segment === "missing_key" && !provider.apiKeyConfigured) ||
      (segment === "manual" && provider.routing?.mode === "manual") ||
      (segment === "auto" && provider.routing?.mode !== "manual") ||
      provider.modality === segment;
    return matchedKeyword && matchedModality && matchedStatus && matchedSegment;
  });
  const enabledRows = providers.filter((provider) => provider.enabled);
  const missingKeyRows = providers.filter((provider) => !provider.apiKeyConfigured);
  const railItems: AdminRailItem[] = [
    { id: "all", label: "全部渠道", count: providers.length, meta: "模型供应商池", tone: "blue" },
    { id: "text", label: "文本", count: providers.filter((provider) => provider.modality === "text").length, meta: "剧本/评分/提示词", tone: "blue" },
    { id: "image", label: "生图", count: providers.filter((provider) => provider.modality === "image").length, meta: "角色/分镜图", tone: "green" },
    { id: "video", label: "视频", count: providers.filter((provider) => provider.modality === "video").length, meta: "图生视频/片段", tone: "violet" },
    { id: "tts", label: "配音", count: providers.filter((provider) => provider.modality === "tts").length, meta: "语音合成", tone: "amber" },
    { id: "embedding", label: "向量", count: providers.filter((provider) => provider.modality === "embedding").length, meta: "检索与记忆" },
    { id: "missing_key", label: "缺 Key", count: missingKeyRows.length, meta: "需要配置", tone: "danger" },
    { id: "enabled", label: "启用中", count: enabledRows.length, meta: "可参与生产", tone: "green" },
    { id: "disabled", label: "停用", count: providers.length - enabledRows.length, meta: "不会调用", tone: "danger" },
    { id: "auto", label: "自动路由", count: providers.filter((provider) => provider.routing?.mode !== "manual").length, meta: "额度池轮换", tone: "green" },
    { id: "manual", label: "手动固定", count: providers.filter((provider) => provider.routing?.mode === "manual").length, meta: "固定模型", tone: "amber" }
  ];

  const pagination = useAdminPagination(rows, `${keyword}:${modality}:${status}:${segment}`);

  return (
    <section className="admin-v2-section">
      <div className="model-filter-tabs admin-model-view-tabs" aria-label="模型管理视图">
        <button type="button" aria-pressed={view === "channels"} onClick={() => { if (canLeaveAdminEditor()) setView("channels"); }}>渠道管理</button>
        <button type="button" aria-pressed={view === "catalog"} onClick={() => { if (canLeaveAdminEditor()) setView("catalog"); }}>模型目录与配置检查</button>
      </div>
      {view === "catalog" ? <ModelLibrary admin providers={providers} modelPrices={modelPrices} onPrice={() => navigateAdminHash("价格策略")} onConfigure={providerId => {
        setKeyword(providerId); setModality("all"); setStatus("all"); setSegment("all"); pagination.setPage(1);
        setEditingProvider(providerId); setView("channels");
      }} /> : <AdminModuleWorkbench
        railTitle="模型能力"
        railDescription="按能力、密钥和路由模式管理生产渠道。"
        railItems={railItems}
        activeRail={segment}
        onRailChange={setSegment}
        railFooter={<span>{enabledRows.length} 个渠道可参与线上生产。</span>}
      >
        <div className="admin-product-metrics compact">
          <AdminMetric icon={<Layers3 size={20} />} label="渠道总数" value={providers.length} hint={`${enabledRows.length} 个启用`} tone="blue" />
          <AdminMetric icon={<Image size={20} />} label="视觉渠道" value={providers.filter((provider) => provider.modality === "image" || provider.modality === "video").length} hint="图片与视频生产" tone="green" />
          <AdminMetric icon={<ShieldCheck size={20} />} label="已配置 Key" value={providers.length - missingKeyRows.length} hint={`${missingKeyRows.length} 个缺 Key`} tone="amber" />
          <AdminMetric icon={<SlidersHorizontal size={20} />} label="自动路由" value={providers.filter((provider) => provider.routing?.mode !== "manual").length} hint="额度池/默认轮换" tone="violet" />
        </div>
        <details className="admin-advanced-panel"><summary>高级接入与插件状态<ChevronDown size={16} /></summary><OpenSourcePipelinePanel
          adapters={openSourceAdapters}
          pipelines={visualPipelines}
          tests={pipelineTests}
          onRefresh={onLoadPluginStatus}
          onTest={onTestPipeline}
        /></details>
        <AdminToolbar
          right={
            <AdminActionBar>
              <button className="admin-secondary-btn compact" type="button" onClick={onLoadRelayPolicy}><SlidersHorizontal size={18} />网关策略</button>
              <button className="admin-primary-btn" type="button" onClick={() => setCreateOpen(true)}><Plus size={18} />新增渠道</button>
            </AdminActionBar>
          }
        >
          <SearchField value={keyword} onChange={setKeyword} placeholder="搜索供应商、模型..." />
          <SelectFilter value={modality} onChange={setModality} options={["all", "text", "image", "video", "tts", "embedding"]} labels={{ all: "全部类型", text: "文本", image: "生图", video: "视频", tts: "配音", embedding: "向量" }} />
          <SelectFilter value={status} onChange={setStatus} options={["all", "enabled", "disabled"]} labels={{ all: "全部状态", enabled: "启用", disabled: "停用" }} />
        </AdminToolbar>
        {testResult || imageTestResult || videoTestResult ? <details className="admin-advanced-panel"><summary>最近一次测试详情<ChevronDown size={16} /></summary><ModelTestPanel text={testResult} image={imageTestResult} video={videoTestResult} /></details> : null}
        {relayPolicy ? <RelayGatewayPreview policy={relayPolicy} /> : null}
        <div className="admin-provider-card-list">
          {pagination.items.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} modelPrices={modelPrices} autoOpen={editingProvider === provider.id} onEditorClose={() => setEditingProvider("")} testStates={providerTests} onSave={onSave} onDelete={onDelete} onTest={onTest} />
          ))}
          {!rows.length ? <EmptyHint text="没有匹配的模型渠道。可以切换左侧能力分类，或新增一个渠道。" /> : null}
        </div>
        <TableFooter total={rows.length} page={pagination.page} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
      </AdminModuleWorkbench>}
      <AdminModal open={createOpen} title="新增模型渠道" description="密钥只写入服务端，后台列表只展示是否已配置和 Key 预览。" onClose={() => setCreateOpen(false)} wide>
        <ProviderCreator onCreate={(input) => closeAfterAdminSuccess(() => onCreate(input), () => setCreateOpen(false))} />
      </AdminModal>
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
      <div className="admin-product-metrics compact">
        <AdminMetric icon={<FilePenLine size={20} />} label="评分模板" value={stageTemplates.length} hint="按阶段管理" tone="blue" />
        <AdminMetric icon={<CheckCircle2 size={20} />} label="启用模板" value={stageTemplates.filter((item) => item.template.enabled).length} hint="LLM 评测优先使用" tone="green" />
        <AdminMetric icon={<ChartNoAxesCombined size={20} />} label="评分维度" value={stageTemplates.reduce((sum, item) => sum + item.dimensions.length, 0)} hint="规则 + LLM 双通道" tone="amber" />
        <AdminMetric icon={<ShieldCheck size={20} />} label="待建立模板" value={stageTemplates.filter(item => item.template.id.startsWith("missing_")).length} hint="创建后才保存到服务器" tone="violet" />
      </div>
      <div className="prompt-scoring-layout">
        <aside className="prompt-stage-list">
          {stageTemplates.map((item) => (
            <button type="button" key={item.stage} className={activeStage === item.stage ? "active" : ""} onClick={() => { if (item.stage === activeStage || canLeaveAdminEditor()) setActiveStage(item.stage); }}>
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
    <article className="admin-v2-card prompt-editor-card" data-admin-dirty={dirty || undefined}>
      <AdminScopedActionNotice />
      <div className="admin-editor-status"><StatusChip active={item.template.enabled} /><DraftIndicator dirty={dirty} /></div>
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
          <button className="admin-icon-btn danger" disabled={isMissingTemplate} title="停用模板" onClick={async () => { if (await confirmAdminAction("确认停用该评分提示词？", { title: "停用评分模板", confirmLabel: "停用模板" })) void onDelete(item.template.id); }}><Trash2 size={16} /></button>
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
  const [segment, setSegment] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const rows = prices.filter((price) => {
    const matchedKeyword = `${price.providerName} ${price.model}`.toLowerCase().includes(keyword.toLowerCase());
    const matchedModality = modality === "all" || price.modality === modality;
    const matchedStatus = status === "all" || (status === "enabled" ? price.enabled : !price.enabled);
    const matchedSegment =
      segment === "all" ||
      (segment === "enabled" && price.enabled) ||
      (segment === "disabled" && !price.enabled) ||
      (segment === "high_cost" && price.vendorCostCny >= 0.1) ||
      (segment === "high_credits" && price.unitCredits >= 50) ||
      (segment === "orphan" && !providers.some((provider) => provider.id === price.providerId || provider.name === price.providerName)) ||
      price.modality === segment;
    return matchedKeyword && matchedModality && matchedStatus && matchedSegment;
  });
  const pagination = useAdminPagination(rows, `${keyword}:${modality}:${status}:${segment}`);
  const grouped = groupPricesByProvider(pagination.items);
  const enabledRows = rows.filter((price) => price.enabled);
  const avgCredits = enabledRows.length ? Math.round(enabledRows.reduce((sum, price) => sum + price.unitCredits, 0) / enabledRows.length) : 0;
  const costTotal = rows.reduce((sum, price) => sum + price.vendorCostCny, 0);
  const modalityCount = new Set(rows.map((price) => price.modality)).size;
  const orphanCount = prices.filter((price) => !providers.some((provider) => provider.id === price.providerId || provider.name === price.providerName)).length;
  const railItems: AdminRailItem[] = [
    { id: "all", label: "全部价格", count: prices.length, meta: "计费策略池", tone: "blue" },
    { id: "text", label: "文本", count: prices.filter((price) => price.modality === "text").length, meta: "剧本/提示词", tone: "blue" },
    { id: "image", label: "生图", count: prices.filter((price) => price.modality === "image").length, meta: "角色/分镜图", tone: "green" },
    { id: "video", label: "视频", count: prices.filter((price) => price.modality === "video").length, meta: "秒级计费", tone: "violet" },
    { id: "tts", label: "配音", count: prices.filter((price) => price.modality === "tts").length, meta: "字符计费", tone: "amber" },
    { id: "embedding", label: "向量", count: prices.filter((price) => price.modality === "embedding").length, meta: "检索能力" },
    { id: "enabled", label: "前台生效", count: prices.filter((price) => price.enabled).length, meta: "可参与计费", tone: "green" },
    { id: "disabled", label: "停用", count: prices.filter((price) => !price.enabled).length, meta: "不会计费", tone: "danger" },
    { id: "high_cost", label: "高成本", count: prices.filter((price) => price.vendorCostCny >= 0.1).length, meta: "需关注毛利", tone: "danger" },
    { id: "high_credits", label: "高积分", count: prices.filter((price) => price.unitCredits >= 50).length, meta: "用户感知强", tone: "amber" },
    { id: "orphan", label: "无渠道关联", count: orphanCount, meta: "需清理/补渠道", tone: "danger" }
  ];

  return (
    <section className="admin-v2-section admin-price-section">
      <AdminModuleWorkbench
        railTitle="价格分层"
        railDescription="把模型计费、成本和前台展示放在同一个运营视角里。"
        railItems={railItems}
        activeRail={segment}
        onRailChange={setSegment}
        railFooter={<span>当前命中 {rows.length} 条，覆盖 {modalityCount || 0} 类能力。</span>}
      >
        <div className="admin-product-metrics compact">
          <AdminMetric icon={<Layers3 size={20} />} label="价格策略" value={rows.length} hint={`全部记录 ${prices.length} 条`} tone="blue" />
          <AdminMetric icon={<CheckCircle2 size={20} />} label="启用策略" value={enabledRows.length} hint="前台计费可见" tone="green" />
          <AdminMetric icon={<WalletCards size={20} />} label="计价能力" value={modalityCount} hint="按图片、秒、字符等分别定价" tone="amber" />
          <AdminMetric icon={<CircleDollarSign size={20} />} label="待核对关联" value={orphanCount} hint="没有对应模型渠道的价格" tone="violet" />
        </div>
        <AdminToolbar
          right={
            <AdminActionBar>
              <button className="admin-secondary-btn compact" type="button" onClick={() => { if (canLeaveAdminEditor()) setExpandedProvider(null); }}>收起全部</button>
              <button className="admin-primary-btn" type="button" onClick={() => setCreateOpen(true)}><Plus size={18} />新增价格</button>
            </AdminActionBar>
          }
        >
          <SearchField value={keyword} onChange={setKeyword} placeholder="搜索供应商或模型..." />
          <SelectFilter value={modality} onChange={setModality} options={["all", "text", "image", "video", "tts", "embedding"]} labels={{ all: "全部类型", text: "文本", image: "生图", video: "视频", tts: "配音", embedding: "向量" }} />
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
        {!grouped.length ? <EmptyHint text="没有匹配的价格策略。可以调整上方分类和筛选条件，或先在模型路由里新增渠道。" /> : null}
        <TableFooter total={rows.length} page={pagination.page} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
      </AdminModuleWorkbench>
      <AdminModal open={createOpen} title="新增价格策略" description="用于补充特殊模型单价；常规渠道新增后会自动生成基础价格。" onClose={() => setCreateOpen(false)} wide>
        <PriceCreator providers={providers} onCreate={(input) => closeAfterAdminSuccess(() => onCreate(input), () => setCreateOpen(false))} />
      </AdminModal>
    </section>
  );
}

function AdminMetric({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: ReactNode; hint: string; tone: "blue" | "green" | "amber" | "violet" }) {
  return (
    <article className={`admin-product-metric ${tone}`}>
      <div className="admin-product-metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong data-text-value={typeof value === "string" && /[\u3400-\u9fff]/.test(value) ? true : undefined}>{value}</strong>
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

const frontendEvaluationStages: Array<{ key: string; label: string; detail: string; stages: EvaluationStage[] }> = [
  { key: "content", label: "内容", detail: "剧本", stages: ["script"] },
  { key: "assets", label: "资产", detail: "角色 + 图片", stages: ["character", "image"] },
  { key: "storyboard", label: "分镜", detail: "镜头结构", stages: ["storyboard"] },
  { key: "final", label: "成片", detail: "视频", stages: ["video"] }
];

function selectedFrontendStageLabels(stages: EvaluationStage[]) {
  return frontendEvaluationStages
    .filter((group) => group.stages.some((stage) => stages.includes(stage)))
    .map((group) => group.label);
}

function toggleFrontendStageGroup(values: EvaluationStage[], stages: EvaluationStage[], setter: (values: EvaluationStage[]) => void) {
  const selected = stages.every((stage) => values.includes(stage));
  const next = selected ? values.filter((stage) => !stages.includes(stage)) : uniqueStrings([...values, ...stages]) as EvaluationStage[];
  const order: EvaluationStage[] = ["script", "character", "image", "storyboard", "video"];
  setter(order.filter((stage) => next.includes(stage)));
}

function qualityFrontStageMatches(rawStage: string, modality: string, selected: string) {
  if (selected === "all") return true;
  if (selected === "content") return rawStage === "script" || rawStage === "text" || modality === "text";
  if (selected === "assets") return rawStage === "character" || rawStage === "image" || modality === "image";
  if (selected === "storyboard") return rawStage === "storyboard";
  if (selected === "final") return ["video", "tts", "export"].includes(rawStage) || modality === "video" || modality === "tts";
  return false;
}

function stageLabelSafe(stage: string) {
  const labels: Record<string, string> = {
    text: "文本",
    script: "剧本",
    character: "角色",
    storyboard: "分镜",
    image: "图片",
    video: "视频",
    tts: "配音",
    export: "导出",
    unknown: "未知"
  };
  return labels[stage] ?? stage;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function formatDuration(ms: number) {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function qualityEventStatusLabel(value: QualityCenterOverview["events"][number]["status"]) {
  const labels: Record<string, string> = {
    open: "待分析",
    triaged: "已归因",
    processing: "复核中",
    resolved: "已解决",
    ignored: "已关闭",
    converted: "已沉淀",
    detected: "已发现",
    queued: "待复核"
  };
  return labels[value] ?? value;
}

function qualityGateLabel(value: QualityCenterOverview["releaseGates"][number]["status"]) {
  const labels = {
    pass: "通过",
    warning: "关注",
    blocked: "阻塞"
  };
  return labels[value] ?? value;
}

function sampleTypeLabel(value: QualityCenterOverview["samples"][number]["sampleType"]) {
  const labels = {
    golden: "Golden 标杆",
    badcase: "Badcase 问题",
    regression: "Regression 回归",
    boundary: "Boundary 边界",
    manual: "Manual 人工"
  };
  return labels[value] ?? value;
}

function modeLabel(mode: "rules" | "hybrid" | "llm") {
  const labels = {
    rules: "规则评分",
    hybrid: "规则 + LLM",
    llm: "LLM 对比"
  };
  return labels[mode];
}

function experimentTypeLabel(value: ExperimentRun["experimentType"]) {
  return value === "model" ? "模型对比" : value === "prompt" ? "提示词对比" : "组合策略对比";
}

function signedNumber(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function nextPromptVersion(value: string) {
  const match = value.match(/^(.*?)(\d+)$/);
  return match ? `${match[1]}${Number(match[2]) + 1}` : `${value || "v"}2`;
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

type AdminRailItem = {
  id: string;
  label: string;
  count?: ReactNode;
  meta?: string;
  tone?: "default" | "blue" | "green" | "amber" | "violet" | "danger";
};

function AdminModuleWorkbench({
  railTitle,
  railDescription,
  railItems,
  activeRail,
  onRailChange,
  protectDraft = true,
  railFooter,
  children
}: {
  railTitle: string;
  railDescription?: string;
  railItems: AdminRailItem[];
  activeRail: string;
  onRailChange: (id: string) => void;
  protectDraft?: boolean;
  railFooter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="admin-module-layout">
      <aside className="admin-categorybar" aria-label={railTitle}>
        <div className="admin-category-controls" aria-label={railTitle} title={railDescription}>
          {railItems.map((item) => (
            <button
              key={item.id}
              className={activeRail === item.id ? `active ${item.tone ?? "default"}` : item.tone ?? "default"}
              type="button"
              aria-pressed={activeRail === item.id}
              title={item.meta}
              onClick={() => { if (!protectDraft || item.id === activeRail || canLeaveAdminEditor()) onRailChange(item.id); }}
            >
              <span>{item.label}</span>
              {item.count !== undefined ? <b>{item.count}</b> : null}
            </button>
          ))}
        </div>
        {railFooter ? <div className="admin-category-meta">{railFooter}</div> : null}
      </aside>
      <div className="admin-module-body">{children}</div>
    </div>
  );
}

function AdminModal({
  open,
  title,
  description,
  onClose,
  children,
  wide = false
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const action = useContext(AdminActionContext);
  return <AdminDialog open={open} title={title} description={description} onClose={onClose} busy={action.pending} wide={wide} trackChanges={/^(新增|创建|生成)/.test(title)} notice={<AdminScopedActionNotice />}>{children}</AdminDialog>;
}

function AdminScopedActionNotice() {
  const action = useContext(AdminActionContext);
  const [openedAt] = useState(action.version);
  const notice = scopedAdminNotice(action, openedAt);
  return <>
    {action.pending ? <InlineNotice tone="info">正在提交，请稍候…</InlineNotice> : notice.message ? <InlineNotice tone="success">{notice.message}</InlineNotice> : null}
    {notice.error ? <InlineNotice tone="error">{notice.error}</InlineNotice> : null}
  </>;
}

function AdminActionBar({ children }: { children: ReactNode }) {
  return <div className="admin-action-bar">{children}</div>;
}

function AdminToolbar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="admin-product-toolbar">
      <div className="admin-product-filters">{children}</div>
      {right ? <div className="admin-product-toolbar-actions">{right}</div> : null}
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
    <label className="admin-product-search">
      <Search size={18} />
      <input aria-label={placeholder.replace(/\.\.\.$/, "")} value={value} onChange={(event) => { if (event.target.value === value || canLeaveAdminEditor()) onChange(event.target.value); }} placeholder={placeholder} />
    </label>
  );
}

function SelectFilter({ value, onChange, options, labels = {} }: { value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) {
  return (
    <select aria-label={labels.all || "筛选条件"} className="admin-product-filter" value={value} onChange={(event) => { if (event.target.value === value || canLeaveAdminEditor()) onChange(event.target.value); }}>
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
  admin: "后台管理员"
};

const adminStatusLabels: Record<string, string> = {
  deleted: "已删除",
  active: "正常",
  disabled: "停用"
};

function userIdentityLabel(user: AdminUserRow) {
  if (user.role !== "creator") return adminRoleLabels[user.role] ?? user.role;
  if (user.totalRecharge > 0) return "有积分入账";
  if (user.totalConsume > 0 || user.projects > 0) return "创作者";
  return "体验用户";
}

function AdminUserCreator({
  onCreate
}: {
  onCreate: (input: { name: string; email?: string; phone?: string; password: string; role?: string; status?: string; initialCredits?: number }) => AdminActionResult;
}) {
  const formId = useId();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [draft, setDraft] = useState({
    name: "新用户",
    email: "",
    phone: "",
    password: "",
    role: "creator",
    initialCredits: "300"
  });
  return (
    <form id={formId} className="admin-modal-form admin-user-create-strip" data-admin-dirty={Boolean(draft.email || draft.phone || draft.password || draft.name !== "新用户" || draft.initialCredits !== "300" || draft.role !== "creator") || undefined} onSubmit={(event) => { event.preventDefault(); void onCreate({ name: draft.name.trim(), email: draft.email.trim() || undefined, phone: draft.phone.trim() || undefined, password: draft.password, role: draft.role, status: "active", initialCredits: Number(draft.initialCredits) }); }}>
      <p className="admin-form-section-title wide">账号信息<small>邮箱和手机号至少填写一项</small></p>
      <label className="admin-create-field wide"><span>用户名</span><input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：新用户" /></label>
      <label className="admin-create-field"><span>邮箱</span><input type="email" maxLength={254} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="例如：user@example.com" /></label>
      <label className="admin-create-field"><span>手机号</span><input type="tel" pattern="1[3-9][0-9]{9}" maxLength={11} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="例如：13800138000，可选" /></label>
      <div className="admin-create-field wide"><label htmlFor={`${formId}-password`}>初始密码</label><div className="admin-password-field"><input id={`${formId}-password`} aria-describedby={`${formId}-password-hint`} type={passwordVisible ? "text" : "password"} autoComplete="new-password" required minLength={12} maxLength={1024} value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder="至少 12 位" /><button type="button" className="admin-text-btn" aria-label={passwordVisible ? "隐藏初始密码" : "显示初始密码"} aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)}>{passwordVisible ? "隐藏" : "显示"}</button></div><small id={`${formId}-password-hint`}>请通过安全方式告知用户，密码不会在列表中显示。</small></div>
      <p className="admin-form-section-title wide">权限与积分</p>
      <label className="admin-create-field"><span>角色</span><select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}>
        <option value="creator">创作者</option>
        <option value="admin">后台管理员</option>
      </select></label>
      <label className="admin-create-field"><span>初始积分</span><input type="number" min={0} max={2147483647} step={1} required value={draft.initialCredits} onChange={(event) => setDraft({ ...draft, initialCredits: event.target.value })} placeholder="例如：300" /></label>
      <AdminDialogActions><button
        className="admin-primary-btn"
        type="submit"
        form={formId}
        disabled={!draft.name.trim() || (!draft.email.trim() && !draft.phone.trim()) || draft.password.length < 12}
      >
        <UserRound size={18} />创建
      </button></AdminDialogActions>
    </form>
  );
}

function AdminDate({ value, empty = "暂无记录" }: { value?: string; empty?: string }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <span className="adm-date-empty">{empty}</span>;
  const date = new Date(value);
  return <time className="adm-date" dateTime={value} title={date.toLocaleString("zh-CN")}><span>{date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })}</span><small>{date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })}</small></time>;
}

function UserRow({
  user,
  tab,
  onTabChange,
  isSelf,
  onDeleteUser,
  selected,
  onToggleSelected,
  onUserSave,
  onPasswordReset,
  onCreditAdjust
}: {
  user: AdminUserRow;
  tab: "profile" | "credits" | "security";
  onTabChange: (tab: "profile" | "credits" | "security") => void;
  isSelf: boolean;
  onDeleteUser: (id: string) => AdminActionResult;
  selected: boolean;
  onToggleSelected: () => void;
  onUserSave: (userId: string, input: Partial<Pick<AdminUserRow, "name" | "email" | "phone" | "role" | "status">>) => AdminActionResult;
  onPasswordReset: (userId: string, password: string) => AdminActionResult;
  onCreditAdjust: (input: { userId: string; amount: number; description: string; requestId?: string }) => AdminActionResult;
}) {
  const profileFormId = useId();
  const creditsFormId = useId();
  const securityFormId = useId();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const action = useContext(AdminActionContext);
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [password, setPassword] = useState("");
  const creditAttempt = useRef(createCreditAdjustmentAttempt());
  async function adjustCredits() {
    if (!isValidCreditAdjustment(amount, description)) return;
    const input = { userId: user.id, amount: Number(amount), description: description.trim() };
    await closeAfterAdminSuccess(() => onCreditAdjust({ ...input, requestId: creditAttempt.current.getRequestId(input) }), () => {
      creditAttempt.current.complete();
      setAmount(""); setDescription("");
    });
  }
  useEffect(() => { setName(user.name); setEmail(user.email ?? ""); setPhone(user.phone ?? ""); setRole(user.role); setStatus(user.status); }, [user.name, user.email, user.phone, user.role, user.status]);
  const dirty = name !== user.name || email !== (user.email ?? "") || phone !== (user.phone ?? "") || role !== user.role || status !== user.status;
  const identity = userIdentityLabel({ ...user, role });
  return (
    <article className="adm-user-profile" data-admin-dirty={dirty || Boolean(password || amount || description) || undefined}>
      <div className="adm-user-contact">
        <div className="adm-profile-identity"><span className="adm-user-avatar" aria-hidden="true">{user.name.trim().slice(0, 1).toUpperCase()}</span><div><strong>{identity}</strong><span className="adm-status" data-status={user.status}>{adminStatusLabels[user.status] ?? user.status}</span></div></div>
        <span>邮箱：{user.email || "未绑定"}</span><span>手机号：{user.phone || "未绑定"}</span>
        <small className="adm-user-id">账号 ID：{user.id}</small>
      </div>
      <AdminCommercialIdentity user={user} detail />
      {user.status !== "deleted" ? <nav className="admin-user-tabs" aria-label="用户管理操作"><button type="button" aria-pressed={tab === "profile"} onClick={() => onTabChange("profile")}><UserRound size={16} />资料与权限</button><button type="button" aria-pressed={tab === "credits"} onClick={() => onTabChange("credits")}><WalletCards size={16} />积分调整</button><button type="button" aria-pressed={tab === "security"} onClick={() => onTabChange("security")}><ShieldCheck size={16} />账号安全</button></nav> : null}
      <dl className="adm-user-dates" aria-label="账号时间记录" hidden={tab !== "profile" && user.status !== "deleted"}>
        <div><dt>注册时间</dt><dd><AdminDate value={user.createdAt} /></dd></div>
        <div><dt>最近登录</dt><dd><AdminDate value={user.lastLoginAt} empty="暂无登录记录" /></dd></div>
        <div><dt>资料更新时间</dt><dd><AdminDate value={user.updatedAt} /></dd></div>
      </dl>
      <dl className="adm-user-stat-grid" aria-label="账号统计" hidden={tab !== "credits" && user.status !== "deleted"}>
        <div><dt>可用积分</dt><dd>{user.credits.toLocaleString()}</dd></div>
        <div><dt>冻结积分</dt><dd>{user.frozenCredits.toLocaleString()}</dd></div>
        <div><dt>累计入账积分</dt><dd>{user.totalRecharge.toLocaleString()}</dd></div>
        <div><dt>累计消耗积分</dt><dd>{user.totalConsume.toLocaleString()}</dd></div>
        <div><dt>项目数量</dt><dd>{user.projects.toLocaleString()}</dd></div>
        <div><dt>登录密码</dt><dd>{user.hasPassword ? "已设置" : "未设置"}</dd></div>
      </dl>
      {user.status === "deleted" ? <div className="adm-user-form-section"><h3>用户回收站</h3><p>账号无法登录，原作品和账务记录仍保留。恢复后为停用状态，需要手动启用。</p><button className="admin-primary-btn" disabled={action.pending} onClick={() => void closeAfterAdminSuccess(() => onUserSave(user.id, { status: "disabled" }), () => onTabChange("profile"))}>恢复用户</button></div> : <>
      <form id={profileFormId} className="adm-user-form-section" hidden={tab !== "profile"} aria-label="账号资料" onSubmit={(event) => { event.preventDefault(); if (dirty && name.trim() && (email.trim() || phone.trim())) void onUserSave(user.id, { name: name.trim(), email: email.trim(), phone: phone.trim(), role, status }); }}>
        <h3>账号资料</h3>
        <label><span>用户名</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
        <label><span>邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} /></label>
        <label><span>手机号</span><input type="tel" value={phone} pattern="1[3-9][0-9]{9}" onChange={(event) => setPhone(event.target.value)} maxLength={11} /></label>
        <p>邮箱和手机号至少保留一个；修改登录方式会使旧会话失效。</p>
        <div className="adm-user-field-pair">
          <label><span>用户角色</span><select value={role} disabled={isSelf} onChange={(event) => setRole(event.target.value)}><option value="creator">创作者</option><option value="admin">后台管理员</option></select></label>
          <label><span>账号状态</span><select value={status} disabled={isSelf} onChange={(event) => setStatus(event.target.value)}><option value="active">正常</option><option value="disabled">停用</option></select></label>
        </div>
        {tab === "profile" ? <AdminDialogActions><button className="admin-primary-btn" type="submit" form={profileFormId} disabled={action.pending || !dirty || !name.trim() || (!email.trim() && !phone.trim())}><Save size={16} />保存账号资料</button></AdminDialogActions> : null}
      </form>
      <form id={creditsFormId} className="adm-user-form-section" hidden={tab !== "credits"} aria-label="积分调整" onSubmit={(event) => { event.preventDefault(); void adjustCredits(); }}>
        <h3>积分调整</h3>
        <p>正数入账，负数扣减；操作会记录积分流水。</p>
        <label><span>调整积分</span><input type="number" step={1} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="例如：100 或 -100" required /></label>
        <label><span>调整原因</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="填写补偿或扣减原因" required /></label>
        {tab === "credits" ? <AdminDialogActions><button className="admin-primary-btn" type="submit" form={creditsFormId} disabled={action.pending || !isValidCreditAdjustment(amount, description)}><WalletCards size={16} />提交积分调整</button></AdminDialogActions> : null}
      </form>
      <form id={securityFormId} className="adm-user-form-section" hidden={tab !== "security"} aria-label="重置登录密码" onSubmit={(event) => { event.preventDefault(); if (password.length >= 12) void closeAfterAdminSuccess(() => onPasswordReset(user.id, password), () => setPassword("")); }}>
        <h3>重置登录密码</h3>
        <p>重置后旧会话会失效，用户需使用新密码登录。</p>
        <label><span>新密码</span><input type="password" autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 12 位" required /></label>
        {tab === "security" ? <AdminDialogActions><button className="admin-primary-btn" type="submit" form={securityFormId} disabled={action.pending || password.length < 12}>重置密码</button></AdminDialogActions> : null}
      </form>
      <div className="adm-user-form-section admin-user-danger-zone" hidden={tab !== "security"}><h3>删除用户</h3><p>请先停用账号。删除后移入回收站，保留作品、积分与流水，支持恢复。</p><button className="admin-secondary-btn" disabled={action.pending || dirty || isSelf || user.status !== "disabled"} onClick={async () => { if (await confirmAdminAction(`确认将用户「${user.name}」移入回收站？该账号将无法登录，作品与账务记录保留。`, { title: "删除用户", confirmLabel: "移入回收站" })) void onDeleteUser(user.id); }}><Trash2 size={16} />删除用户</button></div>
      <label className="adm-user-batch-selection" hidden={tab !== "profile"}><input type="checkbox" checked={selected} onChange={onToggleSelected} />加入当前页批量选择</label>
      </>}
    </article>
  );
}

function RedeemBatchCreator({ onCreate }: { onCreate: (input: { name: string; prefix: string; credits: number; count: number; enabled?: boolean }) => AdminActionResult }) {
  const formId = useId();
  const [draft, setDraft] = useState({ name: "新用户体验码", prefix: "TRIAL", credits: "300", count: "20", enabled: true });
  return (
    <form id={formId} className="admin-modal-form admin-redeem-create-form" data-admin-dirty={JSON.stringify(draft) !== JSON.stringify({ name: "新用户体验码", prefix: "TRIAL", credits: "300", count: "20", enabled: true }) || undefined} onSubmit={(event) => { event.preventDefault(); void onCreate({ name: draft.name.trim(), prefix: draft.prefix.trim(), credits: Number(draft.credits), count: Number(draft.count), enabled: draft.enabled }); }}>
      <div>
        <strong>批量生成唯一兑换码</strong>
        <span>每份不同 code，默认单个 code 可兑换 1 次。</span>
      </div>
      <label className="admin-create-field"><span>活动名</span><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：新用户体验码" /></label>
      <label className="admin-create-field"><span>前缀</span><input required maxLength={16} value={draft.prefix} onChange={(event) => setDraft({ ...draft, prefix: event.target.value.toUpperCase() })} placeholder="例如：TRIAL" /></label>
      <label className="admin-create-field"><span>积分/码</span><input type="number" required min={1} max={1000000} step={1} value={draft.credits} onChange={(event) => setDraft({ ...draft, credits: event.target.value })} placeholder="例如：300" /></label>
      <label className="admin-create-field"><span>生成份数</span><input type="number" required min={1} max={1000} step={1} value={draft.count} onChange={(event) => setDraft({ ...draft, count: event.target.value })} placeholder="例如：20" /></label>
      <AdminDialogActions><button className="admin-primary-btn" type="submit" form={formId} disabled={!draft.name.trim() || !draft.prefix.trim()}>
        <Gift size={18} />生成
      </button></AdminDialogActions>
    </form>
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
  const pagination = useAdminPagination(batch.codes, batch.batchId ?? batch.name);
  const previewCodes = pagination.items;
  const statusText = active ? `${active} 个可用` : disabled + expired ? `${disabled + expired} 个不可用` : "暂无可用";
  return (
    <article className="admin-redeem-batch-card compact">
      <div className="admin-redeem-batch-head">
        <button className="admin-icon-btn" onClick={() => { if (canLeaveAdminEditor()) onToggleExpand(); }} aria-expanded={expanded} aria-label={expanded ? "收起批次" : "展开批次"} title={expanded ? "收起批次" : "展开批次"}>
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
          <p className="admin-list-note">批量操作覆盖此批次当前筛选结果的全部 {batch.codes.length} 个兑换码。</p>
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
          <TableFooter total={batch.codes.length} page={pagination.page} pageSize={pagination.pageSize} onPageChange={pagination.setPage} />
        </div>
      ) : null}
    </article>
  );
}

function RedeemCodeRow({ code, onSave, onDelete }: {
  code: RedeemCode;
  onSave: (id: string, input: Partial<Pick<RedeemCode, "name" | "code" | "credits" | "maxRedemptions" | "enabled">> & { startsAt?: string | null; endsAt?: string | null }) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const initial = () => ({ code: code.code, name: code.name, credits: String(code.credits), maxRedemptions: String(code.maxRedemptions), enabled: code.enabled, startsAt: dateInputValue(code.startsAt), endsAt: dateInputValue(code.endsAt) });
  const [draft, setDraft] = useState(initial), [editing, setEditing] = useState(false), [copyState, setCopyState] = useState("");
  useEffect(() => { if (!editing) setDraft(initial()); }, [code, editing]);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(initial());
  const valid = draft.code.trim() && draft.name.trim() && Number.isSafeInteger(Number(draft.credits)) && Number(draft.credits) > 0 && Number.isSafeInteger(Number(draft.maxRedemptions)) && Number(draft.maxRedemptions) >= Math.max(1, code.usedCount);
  function closeEditor() { setDraft(initial()); setEditing(false); }
  async function copyCode() {
    try { if (!navigator.clipboard) throw new Error("当前浏览器不支持自动复制，请选中兑换码手动复制。"); await navigator.clipboard.writeText(code.code); setCopyState("已复制已保存的兑换码"); }
    catch (reason) { setCopyState(reason instanceof Error ? reason.message : "复制失败，请手动复制。"); }
  }
  return <article className="admin-redeem-record" data-admin-dirty={dirty || undefined}>
    <div className="admin-redeem-summary"><div><strong className="admin-redeem-saved-code">{code.code}</strong><small>{code.name} · {formatDate(code.createdAt)}</small><DraftIndicator dirty={dirty} /></div><div><strong>{code.credits} 积分</strong><small>已用 {code.usedCount} / {code.maxRedemptions} 次</small></div><RedeemStatusChip status={redeemStatus(code)} /><div className="admin-row-actions"><button className="admin-icon-btn subtle" type="button" title="复制已保存的兑换码" aria-label="复制已保存的兑换码" onClick={() => void copyCode()}><Copy size={15} /></button><button className="admin-text-btn primary" type="button" aria-haspopup="dialog" onClick={() => setEditing(true)}>编辑</button></div></div>
    {copyState ? <p className="admin-copy-notice" role="status">{copyState}</p> : null}
    <AdminModal open={editing} title="编辑兑换码" description="额度、次数和状态仅在保存后生效，已使用记录保留。" onClose={closeEditor} wide><div className="admin-editor-grid" data-admin-dirty={dirty || undefined}>
      <label><span>兑换码</span><input value={draft.code} onChange={event => setDraft({ ...draft, code: event.target.value.toUpperCase() })} /></label><label><span>活动名称</span><input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label><span>每次到账积分</span><input type="number" min="1" value={draft.credits} onChange={event => setDraft({ ...draft, credits: event.target.value })} /></label><label><span>可兑换总次数（已用 {code.usedCount} 次）</span><input type="number" min={Math.max(1, code.usedCount)} value={draft.maxRedemptions} onChange={event => setDraft({ ...draft, maxRedemptions: event.target.value })} /></label>
      <label><span>开始日期</span><input type="date" value={draft.startsAt} onChange={event => setDraft({ ...draft, startsAt: event.target.value })} /></label><label><span>结束日期</span><input type="date" value={draft.endsAt} onChange={event => setDraft({ ...draft, endsAt: event.target.value })} /></label>
      <label><span>保存后的状态</span><select value={draft.enabled ? "enabled" : "disabled"} onChange={event => setDraft({ ...draft, enabled: event.target.value === "enabled" })}><option value="enabled">启用</option><option value="disabled">停用</option></select></label></div>
      <AdminDialogActions><button className="admin-text-btn danger" type="button" onClick={async () => { if (await confirmAdminAction(code.usedCount > 0 ? `停用「${code.name}」兑换码并保留已使用记录？` : `删除「${code.name}」这个未使用兑换码？`, { title: "删除或停用兑换码", confirmLabel: code.usedCount > 0 ? "停用兑换码" : "删除兑换码" })) void closeAfterAdminSuccess(() => onDelete(code.id), closeEditor); }}>{code.usedCount > 0 ? "停用并保留记录" : "删除兑换码"}</button><button className="admin-primary-btn" type="button" disabled={!dirty || !valid} onClick={() => void closeAfterAdminSuccess(() => onSave(code.id, { code: draft.code, name: draft.name, credits: Number(draft.credits), maxRedemptions: Number(draft.maxRedemptions), enabled: draft.enabled, startsAt: dateToIso(draft.startsAt), endsAt: dateToIso(draft.endsAt) }), () => setEditing(false))}>保存兑换码</button></AdminDialogActions></AdminModal>
  </article>;
}

function PlanCreator({ onCreate }: { onCreate: (input: Pick<Plan, "name" | "price" | "credits" | "bonusCredits" | "badge" | "features" | "shopUrl" | "enabled">) => AdminActionResult }) {
  const formId = useId();
  const [draft, setDraft] = useState({ name: "积分充值包", price: "9.9", credits: "600", bonusCredits: "100", badge: "", features: "", shopUrl: "" });
  return (
    <form id={formId} className="admin-modal-form admin-plan-create-strip" data-admin-dirty={JSON.stringify(draft) !== JSON.stringify({ name: "积分充值包", price: "9.9", credits: "600", bonusCredits: "100", badge: "", features: "", shopUrl: "" }) || undefined} onSubmit={(event) => { event.preventDefault(); void onCreate({ name: draft.name.trim(), price: Number(draft.price), credits: Number(draft.credits), bonusCredits: Number(draft.bonusCredits), badge: draft.badge || undefined, features: splitFeatureText(draft.features), shopUrl: draft.shopUrl.trim() || undefined, enabled: true }); }}>
      <div><strong>新增充值套餐</strong><span>前台按价格自动排序，只展示启用套餐。</span></div>
      <label className="admin-create-field"><span>套餐名</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：内测体验包" /></label>
      <label className="admin-create-field"><span>售价</span><input type="number" required min={0} step="0.01" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} placeholder="例如：9.9" /></label>
      <label className="admin-create-field"><span>到账积分</span><input type="number" required min={0} max={2147483647} step={1} value={draft.credits} onChange={(event) => setDraft({ ...draft, credits: event.target.value })} placeholder="例如：600" /></label>
      <label className="admin-create-field"><span>赠送积分</span><input type="number" required min={0} max={2147483647} step={1} value={draft.bonusCredits} onChange={(event) => setDraft({ ...draft, bonusCredits: event.target.value })} placeholder="例如：100" /></label>
      <label className="admin-create-field"><span>标签</span><input value={draft.badge} onChange={(event) => setDraft({ ...draft, badge: event.target.value })} placeholder="例如：低价体验" /></label>
      <label className="admin-create-field wide"><span>卖点</span><input value={draft.features} onChange={(event) => setDraft({ ...draft, features: event.target.value })} placeholder="用分号分隔，例如：适合试用；可生成分镜图" /></label>
      <label className="admin-create-field wide"><span>店铺链接</span><input type="url" pattern="https?://.+" value={draft.shopUrl} onChange={(event) => setDraft({ ...draft, shopUrl: event.target.value })} placeholder="例如：https://pay.ldxp.cn/shop/ZHP28OV1" /></label>
      <AdminDialogActions><button className="admin-primary-btn" type="submit" form={formId} disabled={!draft.name.trim()}>
        <CircleDollarSign size={18} />新增
      </button></AdminDialogActions>
    </form>
  );
}

function PlanRow({ plan, onSave, onDelete }: {
  plan: Plan;
  onSave: (id: string, input: Partial<Pick<Plan, "name" | "price" | "credits" | "bonusCredits" | "badge" | "features" | "shopUrl" | "enabled">>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const initial = () => ({ name: plan.name, price: String(plan.price), credits: String(plan.credits), bonusCredits: String(plan.bonusCredits), badge: plan.badge ?? "", features: plan.features.join("；"), shopUrl: plan.shopUrl ?? "", enabled: plan.enabled ?? true });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  useEffect(() => { if (!editing) setDraft(initial()); }, [plan, editing]);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(initial());
  const valid = draft.name.trim() && [draft.price, draft.credits, draft.bonusCredits].every(value => value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0)
    && [draft.credits, draft.bonusCredits].every(value => Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647)
    && (!draft.shopUrl.trim() || /^https?:\/\/[^\s]+$/i.test(draft.shopUrl.trim()));
  function closeEditor() { setDraft(initial()); setEditing(false); }
  return (
    <tr className={editing ? "admin-record-selected" : undefined}>
      <td><strong>{plan.name}</strong><DraftIndicator dirty={dirty} /></td><td>¥{plan.price}</td><td>{plan.credits.toLocaleString()}</td><td>{plan.bonusCredits.toLocaleString()}</td><td>{plan.badge || "—"}</td><td><span className="admin-cell-summary">{plan.features.join(" · ") || "未填写"}</span></td><td>{plan.shopUrl ? <span className="admin-cell-summary" title={plan.shopUrl}>已配置购买链接</span> : <span className="admin-muted">未配置</span>}</td><td><StatusChip active={plan.enabled ?? true} /></td><td><button className="admin-text-btn primary" type="button" aria-haspopup="dialog" onClick={() => setEditing(true)}>编辑</button>
    <AdminModal open={editing} title="编辑充值套餐" description="保存后更新前台价格、到账积分与购买入口。" onClose={closeEditor} wide><div className="admin-editor-grid" data-admin-dirty={dirty || undefined}>
      <label><span>套餐名称</span><input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label><span>售价（元）</span><input type="number" min="0" step="0.01" value={draft.price} onChange={event => setDraft({ ...draft, price: event.target.value })} /></label>
      <label><span>基础积分</span><input type="number" min="0" value={draft.credits} onChange={event => setDraft({ ...draft, credits: event.target.value })} /></label>
      <label><span>赠送积分</span><input type="number" min="0" value={draft.bonusCredits} onChange={event => setDraft({ ...draft, bonusCredits: event.target.value })} /></label>
      <label><span>展示标签</span><input value={draft.badge} onChange={event => setDraft({ ...draft, badge: event.target.value })} /></label>
      <label><span>保存后的状态</span><select value={draft.enabled ? "enabled" : "disabled"} onChange={event => setDraft({ ...draft, enabled: event.target.value === "enabled" })}><option value="enabled">启用</option><option value="disabled">停用</option></select></label>
      <label className="wide"><span>套餐说明（分号分隔）</span><textarea rows={3} value={draft.features} onChange={event => setDraft({ ...draft, features: event.target.value })} /></label>
      <label className="wide"><span>购买链接</span><input type="url" value={draft.shopUrl} placeholder="https://" onChange={event => setDraft({ ...draft, shopUrl: event.target.value })} /></label>
    </div><AdminDialogActions><button className="admin-text-btn danger" type="button" disabled={!plan.enabled} onClick={async () => { if (await confirmAdminAction(`确认停用「${plan.name}」？前台会隐藏此充值套餐。`, { title: "停用充值套餐", confirmLabel: "停用套餐" })) void closeAfterAdminSuccess(() => onDelete(plan.id), closeEditor); }}>停用套餐</button><button className="admin-primary-btn" type="button" disabled={!dirty || !valid} onClick={() => void closeAfterAdminSuccess(() => onSave(plan.id, { name: draft.name, price: Number(draft.price), credits: Number(draft.credits), bonusCredits: Number(draft.bonusCredits), badge: draft.badge || undefined, features: splitFeatureText(draft.features), shopUrl: draft.shopUrl || undefined, enabled: draft.enabled }), () => setEditing(false))}>保存修改</button></AdminDialogActions></AdminModal></td></tr>
  );
}


function MembershipCreator({ onCreate }: { onCreate: (input: Pick<MembershipPlan, "name" | "monthlyPrice" | "monthlyCredits" | "discountPercent" | "priorityLevel" | "badge" | "features" | "shopUrl" | "enabled">) => AdminActionResult }) {
  const initial = { name: "创作者月卡", monthlyPrice: "29", monthlyCredits: "3000", discountPercent: "10", priorityLevel: "1", badge: "", features: "", shopUrl: "" };
  const [draft, setDraft] = useState(initial);
  const valid = draft.name.trim() && [draft.monthlyPrice, draft.monthlyCredits, draft.discountPercent, draft.priorityLevel].every(value => value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0)
    && Number.isSafeInteger(Number(draft.monthlyCredits)) && Number(draft.monthlyCredits) <= 2147483647 && Number.isSafeInteger(Number(draft.priorityLevel)) && Number(draft.discountPercent) <= 100
    && (!draft.shopUrl.trim() || /^https?:\/\/[^\s]+$/i.test(draft.shopUrl.trim()));
  return (
    <div className="admin-modal-form admin-membership-create-strip" data-admin-dirty={JSON.stringify(draft) !== JSON.stringify(initial) || undefined}>
      <div><strong>新增订阅方案</strong><span>仅保存预留配置，购买、自动月度发放、折扣及优先队列尚未开放。</span></div>
      <label className="admin-create-field"><span>会员名</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：创作者月卡" /></label>
      <label className="admin-create-field"><span>月费</span><input type="number" value={draft.monthlyPrice} onChange={(event) => setDraft({ ...draft, monthlyPrice: event.target.value })} placeholder="例如：29" /></label>
      <label className="admin-create-field"><span>月额度</span><input type="number" value={draft.monthlyCredits} onChange={(event) => setDraft({ ...draft, monthlyCredits: event.target.value })} placeholder="例如：3000" /></label>
      <label className="admin-create-field"><span>折扣%</span><input type="number" value={draft.discountPercent} onChange={(event) => setDraft({ ...draft, discountPercent: event.target.value })} placeholder="例如：10" /></label>
      <label className="admin-create-field"><span>队列等级</span><input type="number" value={draft.priorityLevel} onChange={(event) => setDraft({ ...draft, priorityLevel: event.target.value })} placeholder="例如：1" /></label>
      <label className="admin-create-field wide"><span>权益</span><input value={draft.features} onChange={(event) => setDraft({ ...draft, features: event.target.value })} placeholder="用分号分隔，例如：固定额度；优先队列" /></label>
      <label className="admin-create-field wide"><span>店铺链接</span><input value={draft.shopUrl} onChange={(event) => setDraft({ ...draft, shopUrl: event.target.value })} placeholder="例如：https://pay.ldxp.cn/shop/ZHP28OV1" /></label>
      <AdminDialogActions><button className="admin-primary-btn" disabled={!valid} onClick={() => onCreate({ name: draft.name.trim(), monthlyPrice: Number(draft.monthlyPrice), monthlyCredits: Number(draft.monthlyCredits), discountPercent: Number(draft.discountPercent), priorityLevel: Number(draft.priorityLevel), badge: draft.badge, features: splitFeatureText(draft.features), shopUrl: draft.shopUrl.trim() || undefined, enabled: false })}>
        <ReceiptText size={18} />新增
      </button></AdminDialogActions>
    </div>
  );
}

function MembershipRow({
  plan,
  onSave,
  onDelete
}: {
  plan: MembershipPlan;
  onSave: (id: string, input: Partial<Pick<MembershipPlan, "name" | "monthlyPrice" | "monthlyCredits" | "discountPercent" | "priorityLevel" | "badge" | "features" | "shopUrl" | "enabled">>) => AdminActionResult;
  onDelete: (id: string) => AdminActionResult;
}) {
  const initial = () => ({
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
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(initial()); }, [plan, editing]);
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
  const valid = draft.name.trim() && [draft.monthlyPrice, draft.monthlyCredits, draft.discountPercent, draft.priorityLevel].every(value => value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0)
    && Number.isSafeInteger(Number(draft.monthlyCredits)) && Number(draft.monthlyCredits) <= 2147483647 && Number.isSafeInteger(Number(draft.priorityLevel)) && Number(draft.discountPercent) <= 100
    && (!draft.shopUrl.trim() || /^https?:\/\/[^\s]+$/i.test(draft.shopUrl.trim()));
  return (
    <tr data-admin-dirty={dirty || undefined}>
      <td><strong>{plan.name}</strong></td>
      <td>¥{plan.monthlyPrice}</td><td>{plan.monthlyCredits.toLocaleString()}</td><td>{plan.discountPercent}%</td><td>{plan.priorityLevel}</td>
      <td><span className="admin-cell-summary">{plan.features.join(" · ") || "未填写"}</span></td><td>{plan.shopUrl ? "已配置" : "未配置"}</td>
      <td><StatusChip active={plan.enabled} /></td>
      <td>
        <button className="admin-text-btn primary" type="button" aria-haspopup="dialog" onClick={() => setEditing(true)}>编辑方案</button>
        <AdminModal open={editing} title="编辑订阅方案" description="仅保存预留配置，订阅购买及自动发放尚未开放。" onClose={() => { setDraft(initial()); setEditing(false); }} wide>
          <div className="admin-editor-grid" data-admin-dirty={dirty || undefined}>
            <label><span>方案名称</span><input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
            <label><span>月费（元）</span><input type="number" min={0} step=".01" value={draft.monthlyPrice} onChange={event => setDraft({ ...draft, monthlyPrice: event.target.value })} /></label>
            <label><span>月度积分</span><input type="number" min={0} value={draft.monthlyCredits} onChange={event => setDraft({ ...draft, monthlyCredits: event.target.value })} /></label>
            <label><span>折扣（%）</span><input type="number" min={0} max={100} value={draft.discountPercent} onChange={event => setDraft({ ...draft, discountPercent: event.target.value })} /></label>
            <label><span>队列等级</span><input type="number" min={0} value={draft.priorityLevel} onChange={event => setDraft({ ...draft, priorityLevel: event.target.value })} /></label>
            <label><span>展示标签</span><input value={draft.badge} onChange={event => setDraft({ ...draft, badge: event.target.value })} /></label>
            <label className="wide"><span>方案权益（分号分隔）</span><textarea value={draft.features} onChange={event => setDraft({ ...draft, features: event.target.value })} /></label>
            <label className="wide"><span>购买链接</span><input type="url" value={draft.shopUrl} onChange={event => setDraft({ ...draft, shopUrl: event.target.value })} /></label>
          </div>
        <AdminDialogActions>
          <button className="admin-icon-btn" aria-label={draft.enabled ? "设为停用（保存后生效）" : "设为启用（保存后生效）"} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>{draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}</button>
          <button className="admin-icon-btn danger" disabled={dirty || !plan.enabled} title="停用订阅方案" aria-label="停用订阅方案" onClick={async () => { if (await confirmAdminAction("确认停用该订阅方案？配置记录将保留。", { title: "停用订阅方案", confirmLabel: "停用方案" })) void closeAfterAdminSuccess(() => onDelete(plan.id), () => setDraft(current => ({ ...current, enabled: false }))); }}><Trash2 size={16} /></button>
          <button className="admin-primary-btn" disabled={!dirty || !valid} onClick={() => void closeAfterAdminSuccess(() => onSave(plan.id, { name: draft.name, monthlyPrice: Number(draft.monthlyPrice), monthlyCredits: Number(draft.monthlyCredits), discountPercent: Number(draft.discountPercent), priorityLevel: Number(draft.priorityLevel), badge: draft.badge || undefined, features: splitFeatureText(draft.features), shopUrl: draft.shopUrl || undefined, enabled: draft.enabled }), () => setEditing(false))}>保存方案</button>
        </AdminDialogActions></AdminModal>
      </td>
    </tr>
  );
}

function ProviderRow({
  provider,
  modelPrices,
  autoOpen = false,
  onEditorClose,
  testStates,
  onSave,
  onDelete,
  onTest
}: {
  provider: ModelProvider;
  modelPrices: ModelPrice[];
  autoOpen?: boolean;
  onEditorClose?: () => void;
  testStates: Record<string, ProviderTestState>;
  onSave: (id: string, input: Partial<Pick<ModelProvider, "name" | "modality" | "enabled" | "baseUrl" | "iconUrl" | "models" | "costHint">> & { apiKey?: string | null; routing?: { mode?: "auto" | "manual"; preferredModel?: string; modelPool?: string[] } }) => void;
  onDelete: (id: string) => void;
  onTest: (provider: ModelProvider, model: string, dirty?: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (autoOpen) setExpanded(true); }, [autoOpen]);
  const detailsId = useId();
  const testHintId = useId();
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
  }, [expanded, provider.id, provider.name, provider.modality, provider.enabled, provider.baseUrl, provider.iconUrl, provider.costHint, provider.models.join(" | "), provider.routing?.mode, provider.routing?.preferredModel]);
  const models = splitModelText(draft.models);
  const draftProvider: ModelProvider = { ...provider, name: draft.name, modality: draft.modality, enabled: draft.enabled, models, routing: { ...provider.routing, mode: draft.routingMode, preferredModel: draft.preferredModel, modelPool: models, quotaStatus: provider.routing?.quotaStatus ?? [] } };
  const [selectedModel, setSelectedModel] = useState(models[0] ?? "");
  const testKey = `${provider.id}:${selectedModel}`;
  const testState = testStates[testKey];
  const providerTesting = Object.entries(testStates).some(([key, state]) => key.startsWith(`${provider.id}:`) && state.loading);
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
  const testReadiness = providerTestAvailability(provider, selectedModel, { dirty, pending: providerTesting });
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
    <article data-admin-dirty={dirty || undefined} className="admin-provider-card">
      <fieldset className="admin-provider-fields" disabled={providerTesting} aria-label={`${provider.name}渠道配置`}>
      <div className="admin-provider-card-head">
        <button className="admin-icon-btn" type="button" onClick={() => setExpanded(true)} title="编辑渠道" aria-label={`展开${provider.name}渠道`} aria-haspopup="dialog">
          <FilePenLine size={18} />
        </button>
        <AdminProviderIcon provider={provider} />
        <div className="admin-provider-title">
          <strong>{provider.name}</strong>
          <span>{provider.id} · {provider.apiKeyConfigured ? provider.apiKeyPreview ? `Key ${provider.apiKeyPreview}` : "已配置 Key" : "未配置 Key"}</span>
        </div>
        <span className="admin-chip">{modalityLabel(draft.modality)}</span>
        <StatusChip active={provider.enabled} /><DraftIndicator dirty={dirty} />
        <div className="admin-provider-model-chips">
          {models.slice(0, 4).map((model) => <span key={model}><ModelIdentity model={model} modality={provider.modality} compact /></span>)}
          {models.length > 4 ? <span>+{models.length - 4}</span> : null}
        </div>
        <div className="admin-row-actions">
          <button className="admin-text-btn primary" type="button" onClick={() => setExpanded(true)}>编辑渠道</button>
          <button className="admin-secondary-btn compact admin-provider-test-button" type="button" title={testReadiness.reason} aria-label={`测试${provider.name}已保存配置`} aria-describedby={testHintId} disabled={!testReadiness.available} onClick={() => onTest(provider, selectedModel, dirty)}>
            {providerTesting ? <Loader2 className="spin-icon" size={16} /> : <PlayCircle size={16} />}<span>{providerTesting ? "测试中" : ["tts", "embedding"].includes(provider.modality) ? "暂不支持测试" : "测试已保存配置"}</span>
          </button>
          <button className="admin-icon-btn danger" title="删除/停用" onClick={async () => { if (await confirmAdminAction("确认删除该模型渠道？如果存在价格策略会自动停用保留关联。", { title: "删除模型渠道", confirmLabel: "删除／停用" })) void onDelete(provider.id); }}>
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
      <p id={testHintId} className={`admin-provider-test-hint${dirty ? " unsaved" : ""}`}>{testReadiness.reason}</p>
      <ProviderInlineTestResult state={dirty ? undefined : testState} />

      <AdminModal open={expanded} title={`编辑${provider.name}渠道`} description="修改模型连接、路由和状态，保存后生效。" onClose={() => { setExpanded(false); onEditorClose?.(); }} wide>
        <div id={detailsId} className="admin-provider-expanded admin-editor-grid" data-admin-dirty={dirty || undefined}>
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
          <div className="admin-model-field">
            <span>待测试模型</span>
            <ModelRoutePicker label="选择待测试模型" modality={draft.modality} providers={[draftProvider]} modelPrices={modelPrices} value={{ providerId: provider.id, model: selectedModel }} onChange={(_, model) => setSelectedModel(model)} allowUnavailable disabled={providerTesting} />
          </div>
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
            <div className="admin-provider-routing-select admin-model-field">
              <span>固定模型</span>
              <ModelRoutePicker label="选择固定模型" modality={draft.modality} providers={[draftProvider]} modelPrices={modelPrices} value={{ providerId: provider.id, model: draft.preferredModel }} onChange={(_, model) => setDraft({ ...draft, preferredModel: model })} allowUnavailable disabled={providerTesting} />
            </div>
            <div className="admin-provider-quota-grid">
              {quotaStatus.length ? quotaStatus.map((item) => (
                <article className={`admin-provider-quota-card ${item.available ? "ready" : item.coolingDown ? "cooling" : "limited"}`} key={item.model}>
                  <div>
                    <ModelIdentity model={item.model} modality={provider.modality} compact />
                    <small>{item.available ? "可提交" : item.coolingDown ? "冷却中" : "额度已满"}</small>
                  </div>
                  <span>{item.submissions}{item.dailyLimit ? ` / ${item.dailyLimit}` : ""}</span>
                  <p>{item.reason || "今天还可以继续提交到这个模型。"}</p>
                </article>
              )) : <p className="admin-muted">该渠道还没有提交记录，首次调用后会开始累计今日次数和冷却状态。</p>}
            </div>
          </div>
        </div>
        <AdminDialogActions><button className="admin-secondary-btn" type="button" onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>{draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}{draft.enabled ? "设为停用" : "设为启用"}</button><button className="admin-primary-btn" disabled={!dirty || !draft.name.trim() || !models.length} onClick={() => onSave(provider.id, { name: draft.name, modality: draft.modality, enabled: draft.enabled, baseUrl: draft.baseUrl || undefined, iconUrl: draft.iconUrl || undefined, apiKey: draft.apiKey || undefined, models, costHint: draft.costHint, routing: { mode: draft.routingMode as "auto" | "manual", preferredModel: draft.preferredModel || models[0] || undefined, modelPool: models } })}>保存渠道</button></AdminDialogActions>
      </AdminModal>
      </fieldset>
    </article>
  );
}

function ProviderCreator({
  onCreate
}: {
  onCreate: (input: Pick<ModelProvider, "name" | "modality" | "enabled" | "baseUrl" | "models" | "costHint"> & { id?: string; iconUrl?: string; apiKey?: string; routing?: { mode?: "auto" | "manual"; preferredModel?: string; modelPool?: string[] }; unitCredits?: number; vendorCostCny?: number }) => AdminActionResult;
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
  const presets = [
    { label: "文本中转", id: "custom-text", name: "OpenAI 兼容文本", modality: "text", models: "gpt-5.5, deepseek-chat", unitCredits: "8", vendorCostCny: "0.02" },
    { label: "生图渠道", id: "custom-image", name: "自定义生图渠道", modality: "image", models: "gpt-image-2, qwen-image", unitCredits: "12", vendorCostCny: "0.08" },
    { label: "视频渠道", id: "custom-video", name: "自定义视频渠道", modality: "video", models: "seedance-i2v, wanx-i2v", unitCredits: "16", vendorCostCny: "0.16" },
    { label: "配音渠道", id: "custom-tts", name: "自定义配音渠道", modality: "tts", models: "tts-v1", unitCredits: "1", vendorCostCny: "0.002" }
  ];
  function applyPreset(preset: typeof presets[number]) {
    setDraft((current) => ({
      ...current,
      id: preset.id,
      name: preset.name,
      modality: preset.modality,
      models: preset.models,
      unitCredits: preset.unitCredits,
      vendorCostCny: preset.vendorCostCny
    }));
  }
  return (
    <div className="admin-channel-create-layout" data-admin-dirty={Boolean(draft.id || draft.baseUrl || draft.iconUrl || draft.apiKey || draft.name !== "自定义模型渠道" || draft.modality !== "text" || draft.models !== "model-name" || draft.unitCredits !== "8" || draft.vendorCostCny !== "0.02") || undefined}>
      <aside className="admin-channel-presets">
        <strong>接入模板</strong>
        <span>先选能力类型，再补 URL、Key 和模型池。</span>
        {presets.map((preset) => (
          <button type="button" key={preset.label} className={draft.modality === preset.modality ? "active" : ""} onClick={() => applyPreset(preset)}>
            <b>{preset.label}</b>
            <small>{preset.models}</small>
          </button>
        ))}
      </aside>
      <div className="admin-channel-create-main">
        <div className="admin-channel-create-note">
          <strong>手动接入模型渠道</strong>
          <span>保存后会自动给每个模型生成基础价格策略；密钥仅服务端保存，后台列表只展示配置状态。</span>
        </div>
        <section className="admin-channel-create-card">
          <h3>基础信息</h3>
          <div className="admin-channel-field-grid">
            <label><span>渠道 ID</span><input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="例如：zml-text，可选" /></label>
            <label><span>渠道名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：ZML 中转文本" /></label>
            <label><span>模型类型</span><select value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value })}>
              <option value="text">文本</option>
              <option value="image">生图</option>
              <option value="video">视频</option>
              <option value="tts">配音</option>
              <option value="embedding">向量</option>
            </select></label>
            <label><span>模型图标</span><input value={draft.iconUrl} onChange={(event) => setDraft({ ...draft, iconUrl: event.target.value })} placeholder="图片 URL，可选" /></label>
          </div>
        </section>
        <section className="admin-channel-create-card">
          <h3>接入配置</h3>
          <div className="admin-channel-field-grid">
            <label className="wide"><span>Base URL</span><input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="例如：https://api.example.com/v1" /></label>
            <label><span>API Key</span><input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="留空则使用环境变量" /></label>
            <label className="wide"><span>模型池</span><textarea value={draft.models} onChange={(event) => setDraft({ ...draft, models: event.target.value })} placeholder="每行或逗号一个模型，例如 gpt-5.5, qwen-image" /></label>
          </div>
        </section>
        <section className="admin-channel-create-card">
          <h3>计费联动</h3>
          <div className="admin-channel-field-grid">
            <label><span>默认积分单价</span><input type="number" value={draft.unitCredits} onChange={(event) => setDraft({ ...draft, unitCredits: event.target.value })} placeholder="例如：8" /></label>
            <label><span>供应商成本</span><input type="number" step="0.001" value={draft.vendorCostCny} onChange={(event) => setDraft({ ...draft, vendorCostCny: event.target.value })} placeholder="例如：0.02" /></label>
            <label className="wide"><span>渠道说明</span><textarea value={draft.costHint} onChange={(event) => setDraft({ ...draft, costHint: event.target.value })} /></label>
          </div>
        </section>
      <AdminDialogActions><button
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
      </button></AdminDialogActions>
      </div>
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
    <div className="admin-modal-form admin-price-create-strip">
      <div><strong>新增价格策略</strong><span>模型渠道新增后会自动补齐，也可以在这里手动添加特殊模型价。</span></div>
      <label className="admin-create-field"><span>模型渠道</span><select value={draft.providerId} onChange={(event) => setDraft({ ...draft, providerId: event.target.value, model: providers.find((item) => item.id === event.target.value)?.models[0] ?? "" })}>
        <option value="">自定义渠道</option>
        {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
      </select></label>
      <label className="admin-create-field"><span>渠道名称</span><input value={draft.providerName} onChange={(event) => setDraft({ ...draft, providerName: event.target.value })} placeholder="渠道名称" /></label>
      <label className="admin-create-field"><span>模型类型</span><select disabled={Boolean(selectedProvider)} value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value as ModelPrice["modality"], unit: defaultUnitLabelValue(event.target.value) })}>
        <option value="text">文本</option>
        <option value="image">生图</option>
        <option value="video">视频</option>
        <option value="tts">配音</option>
        <option value="embedding">向量</option>
      </select></label>
      {selectedProvider ? <div className="admin-create-field admin-model-field"><span>从渠道选择模型</span><ModelRoutePicker label="选择价格策略模型" modality={selectedProvider.modality} providers={[selectedProvider]} value={{ providerId: selectedProvider.id, model: draft.model }} onChange={(_, model) => setDraft({ ...draft, model })} allowUnavailable /></div> : null}
      <label className="admin-create-field"><span>模型 ID（支持特殊模型）</span><input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="填写准确的模型 ID" /></label>
      <label className="admin-create-field"><span>积分 / {unitLabel(draft.unit)}</span><input type="number" min={0} value={draft.unitCredits} onChange={(event) => setDraft({ ...draft, unitCredits: event.target.value })} placeholder="积分单价" /></label>
      <label className="admin-create-field"><span>成本（元 / {unitLabel(draft.unit)}）</span><input type="number" min={0} step="0.001" value={draft.vendorCostCny} onChange={(event) => setDraft({ ...draft, vendorCostCny: event.target.value })} placeholder="成本" /></label>
      {!isValidModelPriceDraft(draft.unitCredits, draft.vendorCostCny) ? <p className="admin-validation-hint" role="status">积分单价需填写非负整数，配置成本需填写非负数；免费价格请明确填 0。</p> : null}
      <AdminDialogActions><button className="admin-primary-btn" disabled={!draft.providerName.trim() || !draft.model.trim() || !isValidModelPriceDraft(draft.unitCredits, draft.vendorCostCny)} onClick={() => onCreate({ providerId: draft.providerId || undefined, providerName: draft.providerName.trim(), modality: draft.modality as ModelPrice["modality"], model: draft.model.trim(), unit: draft.unit as ModelPrice["unit"], unitCredits: Number(draft.unitCredits), vendorCostCny: Number(draft.vendorCostCny), enabled: true })}>
        <Layers3 size={18} />新增价格
      </button></AdminDialogActions>
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
  const firstPrice = group.prices[0];
  return (
    <article className="admin-price-provider-card">
      <div className="admin-price-provider-head">
        <button className="admin-icon-btn" onClick={() => { if (canLeaveAdminEditor()) onToggleExpand(); }} aria-expanded={expanded} aria-label={expanded ? "收起价格" : "展开价格"} title={expanded ? "收起价格" : "展开价格"}>
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <span className={`admin-provider-icon ${firstPrice?.modality ?? "text"}`}>{group.provider.slice(0, 1).toUpperCase()}</span>
        <div className="admin-provider-title">
          <strong>{group.provider}</strong>
          <span>{modalities.map(modalityLabel).join(" / ")} · {group.enabled}/{group.total} 启用</span>
        </div>
        <div className="admin-price-modality-tags">
          {modalities.map((item) => <span className={`admin-chip modality-${item}`} key={item}>{modalityLabel(item)}</span>)}
        </div>
        <div className="admin-user-metrics compact">
          <MetricPill label="模型" value={group.total} strong />
          <MetricPill label="启用" value={group.enabled} />
          <MetricPill label="计价能力" value={modalities.length} />
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

function PriceRow({ price, onSave, onDelete }: { price: ModelPrice; onSave: (id: string, input: Partial<Pick<ModelPrice, "unitCredits" | "vendorCostCny" | "enabled">>) => AdminActionResult; onDelete: (id: string) => AdminActionResult; }) {
  const initial = () => ({ unitCredits: String(price.unitCredits), vendorCostCny: String(price.vendorCostCny), enabled: price.enabled });
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(initial);
  useEffect(() => { if (!editing) setDraft(initial()); }, [price, editing]);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(initial());
  const valid = isValidModelPriceDraft(draft.unitCredits, draft.vendorCostCny);
  function closeEditor() { setDraft(initial()); setEditing(false); }
  return <section className="admin-price-record" data-admin-dirty={dirty || undefined}>
    <div className="admin-price-summary"><ModelIdentity model={price.model} providerName={price.providerName} modality={price.modality} /><div><strong>{price.unitCredits} 积分</strong><small>每{creditPriceUnit(price)}{price.billing ? " · 自动计价" : ""}</small></div><StatusChip active={price.enabled} /><DraftIndicator dirty={dirty} /><button type="button" className="admin-text-btn primary" aria-haspopup="dialog" onClick={() => setEditing(true)}>编辑价格</button></div>
    <AdminModal open={editing} title="编辑价格策略" description={`${price.model} · 保存后用于新的生成报价，配置成本不代表实际账单。`} onClose={closeEditor}>
      <div className="admin-editor-grid" data-admin-dirty={dirty || undefined}>
        <label><span>积分 / {creditPriceUnit(price)}</span><input type="number" min="0" disabled={Boolean(price.billing)} value={draft.unitCredits} onChange={event => setDraft({ ...draft, unitCredits: event.target.value })} />{price.billing ? <small>自动价格请在积分中心预览和修改成本规则。</small> : null}</label>
        <label><span>配置成本（元 / {unitLabel(price.unit)}）</span><input type="number" min="0" step="0.001" value={draft.vendorCostCny} onChange={event => setDraft({ ...draft, vendorCostCny: event.target.value })} /></label>
        <label><span>保存后的状态</span><select value={draft.enabled ? "enabled" : "disabled"} onChange={event => setDraft({ ...draft, enabled: event.target.value === "enabled" })}><option value="enabled">启用</option><option value="disabled">停用</option></select></label>
      </div>
      {!valid ? <p className="admin-validation-hint" role="status">积分单价需填写非负整数，配置成本需填写非负数；免费价格请明确填 0。</p> : null}
      <AdminDialogActions><button type="button" className="admin-text-btn danger" onClick={async () => { if (await confirmAdminAction(`确认删除「${price.model}」的价格？新的生成将不能使用这条报价。`, { title: "删除价格策略", confirmLabel: "删除策略" })) void closeAfterAdminSuccess(() => onDelete(price.id), closeEditor); }}>删除策略</button><button type="button" className="admin-primary-btn" disabled={!dirty || !valid} onClick={() => void closeAfterAdminSuccess(() => onSave(price.id, { unitCredits: Number(draft.unitCredits), vendorCostCny: Number(draft.vendorCostCny), enabled: draft.enabled }), () => setEditing(false))}>保存价格</button></AdminDialogActions>
    </AdminModal>
  </section>;
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
      <h3>最近一次已保存配置的测试结果</h3>
      <p>结果对应测试时的配置；修改渠道后需保存并重新测试。</p>
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
      <div className="admin-provider-test-state loading" role="status">
        <Loader2 className="spin-icon" size={16} />
        <span>正在测试当前模型，请等待上游返回...</span>
      </div>
    );
  }
  if (!state.result) return null;
  const imageUrl = "hasImageUrl" in state.result ? state.result.imageUrl : undefined;
  return (
    <div className={state.result.ok ? "admin-provider-test-state success" : "admin-provider-test-state failed"} role={state.result.ok ? "status" : "alert"}>
      <div>
        {state.result.ok ? <CheckCircle2 size={16} /> : <Activity size={16} />}
        <strong>{state.result.provider} / {state.result.model}</strong>
      </div>
      <p>{state.result.message}</p>
      {imageUrl ? <img src={imageUrl} alt="模型测试预览" /> : null}
    </div>
  );
}

function DraftIndicator({ dirty }: { dirty: boolean }) {
  return dirty ? <span className="admin-draft-indicator">未保存</span> : null;
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

function TableFooter({ total, page, pageSize, onPageChange }: { total: number; page?: number; pageSize?: number; onPageChange?: (page: number) => void }) {
  return <AdminPagination total={total} page={page} pageSize={pageSize} onPageChange={onPageChange} />;
}

function EmptyHint({ text }: { text: string }) {
  return <StatePanel kind="empty" title={text} compact />;
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
const feedbackRootCauseOptions = ["模型失败", "提示词问题", "工作流问题", "UI误导", "成本异常", "用户误操作", "数据缺失", "角色一致性", "素材/参考图问题", "导出问题", "其他"];

function feedbackStatusLabel(value: UserFeedback["status"]) {
  const labels: Record<UserFeedback["status"], string> = {
    open: "待分析",
    triaged: "已归因",
    processing: "复核中",
    resolved: "已解决",
    ignored: "已关闭",
    converted: "已沉淀"
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
  if (/模型|通道|接口|失败|报错|timeout|Failed to fetch/i.test(text)) return "模型失败";
  if (/提示词|prompt|约束|不按|跑偏|剧本/.test(text)) return "提示词问题";
  if (/流程|步骤|生成顺序|继续|上次|卡住|状态/.test(text)) return "工作流问题";
  if (/按钮|点击|UI|样式|页面|看不清|错位|颜色/.test(text)) return "UI误导";
  if (/扣费|退费|充值|积分|价格|成本|余额/.test(text)) return "成本异常";
  if (/不会用|误操作|选错|删除|上传错/.test(text)) return "用户误操作";
  if (/Excel|乱码|评测|字段|表头|数据|缺失/.test(text)) return "数据缺失";
  if (/角色|三视图|参考图|换脸|串到|不像|一致/.test(text)) return "角色一致性";
  if (/素材|图片|参考图|上传|封面|资产/.test(text)) return "素材/参考图问题";
  if (/导出|下载|MP4|字幕|配音|FFmpeg/i.test(text)) return "导出问题";
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

