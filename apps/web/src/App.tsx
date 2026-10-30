import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, ChartNoAxesCombined, ChevronDown, CircleDollarSign, FilePenLine, Gift, LayoutDashboard, Layers3, LogOut, Megaphone, Moon, ReceiptText, SlidersHorizontal, UserRound, Video, WalletCards } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { firstAdminRefreshFailure } from "./admin/adminRefreshModel";
import { useLayoutEffect } from "react";
import { lazy, useRef } from "react";
import type {
  AdminUserRow,
  AdminSummary,
  ContentProjectSummary,
  CreditAccount,
  CreditTransaction,
  EvaluationOverview,
  GenerationTask,
  HelpArticle,
  MembershipPlan,
  ModelPrice,
  ModelProvider,
  Plan,
  PlatformAnnouncement,
  Project,
  PromptTemplate,
  ProjectWorkflow,
  QualityProjectRow,
  RechargeOrder,
  WorkbenchSummary
} from "@aifilm/shared";
import { Shell, type PageKey } from "./components/Shell";
import { ProductTour, type ProductTourStep } from "./components/ProductTour";
import { api, type AuthUser } from "./lib/api";
import { contentApi } from "./lib/contentApi";
import { RoutePageBoundary } from "./components/RoutePageBoundary";
import { routePageLoader } from "./lib/routePageLoader";
import { AdminShell } from "./admin";
import { navigateAdminHash, readAcceptedAdminHash, subscribeAdminNavigation } from "./admin/adminNavigation";
import { canManageModelTests } from "./pages/wizardRequestModel";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { resolveThemePreference, type WorkbenchTheme } from "./workbench/model";
import { AUTH_SESSION_EXPIRED_EVENT, HttpError } from "./lib/httpClient";
import { clearAuthToken, readAuthToken } from "./lib/authStorage";
import { authResumeStorage } from "./lib/authResumeStorage";
import { clearWizardDraft } from "./pages/wizardDraftStorage";
import { BEFORE_CREATOR_NAVIGATION, createRequestEpoch, refreshResources } from "./lib/creatorNavigation";
import { useCreatorNavigation } from "./lib/useCreatorNavigation";
import { InlineNotice, StatePanel } from "./design-system/ui";
import type { SupportTicketIntent } from "./support/SupportTicketPanel";
import { taskSupportDraft } from "./pages/taskActionModel";

const AdminPage = lazy(routePageLoader(() => import("./pages/AdminPage").then(module => ({ default: module.AdminPage }))));
const ProjectWorkbenchPage = lazy(routePageLoader(() => import("./pages/ProjectWorkbenchPage").then(module => ({ default: module.ProjectWorkbenchPage }))));
const ContentCreatorPage = lazy(routePageLoader(() => import("./pages/ContentCreatorPage").then(module => ({ default: module.ContentCreatorPage }))));
const ModelLibrary = lazy(routePageLoader(() => import("./components/ModelLibrary").then(module => ({ default: module.ModelLibrary }))));
const WizardPage = lazy(routePageLoader(() => import("./pages/WizardPage").then(module => ({ default: module.WizardPage }))));
const LoginPage = lazy(routePageLoader(() => import("./pages/LoginPage").then(module => ({ default: module.LoginPage }))));
const ScriptsPage = lazy(routePageLoader(() => import("./pages/ScriptsPage").then(module => ({ default: module.ScriptsPage }))));
const StudioPage = lazy(routePageLoader(() => import("./pages/StudioPage").then(module => ({ default: module.StudioPage }))));
const TaskCenterPage = lazy(routePageLoader(() => import("./pages/TaskCenterPage").then(module => ({ default: module.TaskCenterPage }))));
const LedgerPage = lazy(routePageLoader(() => import("./pages/CreditsPage").then(module => ({ default: module.LedgerPage }))));
const RechargePage = lazy(routePageLoader(() => import("./pages/CreditsPage").then(module => ({ default: module.RechargePage }))));
const HelpPage = lazy(routePageLoader(() => import("./pages/StaticPages").then(module => ({ default: module.HelpPage }))));
const ProfilePage = lazy(routePageLoader(() => import("./pages/StaticPages").then(module => ({ default: module.ProfilePage }))));
const SettingsPage = lazy(routePageLoader(() => import("./pages/StaticPages").then(module => ({ default: module.SettingsPage }))));

const THEME_STORAGE_KEY = "manjiao-theme";

const creatorPageResources: Partial<Record<PageKey, string[]>> = {
  models: ["模型渠道", "模型价格"],
  workbench: ["工作台"], scripts: ["漫剧作品", "内容作品"], studio: ["漫剧作品", "生成队列"],
  tasks: ["生成队列"], profile: ["账户积分", "工作台", "积分明细", "充值记录"],
  recharge: ["充值套餐", "会员配置", "模型价格"], ledger: ["账户积分", "积分明细"],
  help: ["帮助文章"], wizard: ["模型渠道"], content: ["模型渠道"]
};
const adminResourceLabels = ["充值套餐", "会员配置", "平台公告", "帮助文章", "用户列表", "模型渠道", "模型价格", "提示词模板", "运营概况", "质量概况", "质量项目"];
const adminPageResources: Record<string, string[]> = {
  "运营总览": ["运营概况", "模型渠道", "模型价格"], "用户管理": ["用户列表"], "平台公告": ["平台公告", "帮助文章"],
  "创作质量中心": ["质量概况", "质量项目", "模型渠道"], "兑换码": [],
  "套餐会员": ["充值套餐"], "订阅会员": ["会员配置"], "模型路由": ["模型渠道"],
  "价格策略": ["模型价格", "模型渠道"], "提示词评分": ["提示词模板"]
};

function getInitialTheme(): WorkbenchTheme {
  let storedTheme: string | null = null;

  if (typeof window !== "undefined") {
    try {
      storedTheme = window.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
    } catch {
      storedTheme = null;
    }
  }

  return resolveThemePreference(storedTheme, () => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });
}

export function App() {
  const isAdminRoute = window.location.pathname.startsWith("/admin");
  const adminRoles = useMemo(() => new Set(["admin"]), []);
  const adminNavGroups = useMemo<Array<{ label: string; items: Array<{ name: string; icon: LucideIcon }> }>>(() => [
    {
      label: "核心运营",
      items: [
        { name: "运营总览", icon: LayoutDashboard },
        { name: "用户管理", icon: UserRound },
        { name: "操作记录", icon: ReceiptText },
        { name: "平台公告", icon: Megaphone },
        { name: "支持工单", icon: Bell },
        { name: "创作现场管理", icon: Video },
        { name: "创作质量中心", icon: ChartNoAxesCombined }
      ]
    },
    {
      label: "商业化",
      items: [
        { name: "积分中心", icon: WalletCards },
        { name: "兑换码", icon: Gift },
        { name: "套餐会员", icon: CircleDollarSign },
        { name: "订阅会员", icon: ReceiptText }
      ]
    },
    {
      label: "模型与生产",
      items: [
        { name: "模型路由", icon: SlidersHorizontal },
        { name: "价格策略", icon: Layers3 },
        { name: "提示词评分", icon: FilePenLine }
      ]
    }
  ], []);
  const { route, routeRef, navigate } = useCreatorNavigation(!isAdminRoute);
  const activePage = route.page;
  const [creationSession, setCreationSession] = useState(0);
  const setActivePage = useCallback((page: PageKey) => {
    if (navigate({ page }, false, false, page === "wizard") && page === "wizard") {
      setCreationSession(current => current + 1);
    }
  }, [navigate]);
  const [adminHash, setAdminHash] = useState(() => isAdminRoute ? normalizeAdminHash(readAcceptedAdminHash()) : "运营总览");
  const [adminMobileOpen, setAdminMobileOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authRecoveryFailed, setAuthRecoveryFailed] = useState(false);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [summary, setSummary] = useState<WorkbenchSummary>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [contentProjects, setContentProjects] = useState<ContentProjectSummary[]>([]);
  const contentFocusId = route.contentId ?? "";
  const [openingProjectId, setOpeningProjectId] = useState("");
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [supportIntent, setSupportIntent] = useState<(SupportTicketIntent & { userId: string })>();
  const consumeSupportIntent = useCallback(() => setSupportIntent(undefined), []);
  const [account, setAccount] = useState<CreditAccount>();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [adminPlans, setAdminPlans] = useState<Plan[]>([]);
  const [membershipPlans, setMembershipPlans] = useState<MembershipPlan[]>([]);
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>([]);
  const [helpArticles, setHelpArticles] = useState<HelpArticle[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [modelPrices, setModelPrices] = useState<ModelPrice[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [adminSummary, setAdminSummary] = useState<AdminSummary>();
  const [evaluationOverview, setEvaluationOverview] = useState<EvaluationOverview>();
  const [qualityProjects, setQualityProjects] = useState<QualityProjectRow[]>([]);
  const [workflow, setWorkflow] = useState<ProjectWorkflow>();
  const [theme, setTheme] = useState<WorkbenchTheme>(getInitialTheme);
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [dataRefreshing, setDataRefreshing] = useState(false);
  const [readResources, setReadResources] = useState<Set<string>>(() => new Set());
  const markResourcesRead = useCallback((labels: string[]) => {
    setReadResources((current) => new Set([...current, ...labels]));
  }, []);
  const [projectError, setProjectError] = useState("");
  const [projectRetry, setProjectRetry] = useState(0);
  const refreshEpoch = useRef(createRequestEpoch()).current;
  const projectEpoch = useRef(createRequestEpoch()).current;
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    refreshEpoch.invalidate();
    projectEpoch.invalidate();
    return () => { refreshEpoch.invalidate(); projectEpoch.invalidate(); };
  }, [user?.id, refreshEpoch, projectEpoch]);

  useLayoutEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // Theme still applies when storage is unavailable or blocked.
      }
    }
  }, [theme]);

  const handleThemeChange = useCallback((nextTheme: WorkbenchTheme) => {
    setTheme(nextTheme);
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    if (!isAdminRoute) return;
    const syncAdminHash = () => setAdminHash(normalizeAdminHash(readAcceptedAdminHash()));
    const unsubscribe = subscribeAdminNavigation(syncAdminHash);
    syncAdminHash();
    return unsubscribe;
  }, [isAdminRoute]);

  useEffect(() => {
    let active = true;
    setAuthRecoveryFailed(false);
    const token = readAuthToken();
    if (!token) {
      setAuthReady(true);
      return;
    }
    setAuthReady(false);
    void api
      .me()
      .then((result) => { if (active) { setUser(result.user); setError(""); } })
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof HttpError && reason.status === 401) clearAuthToken();
        else { setAuthRecoveryFailed(true); setError("暂时无法连接工作台。请稍后重试连接，无需重新填写账号和密码。"); }
      })
      .finally(() => { if (active) setAuthReady(true); });
    return () => { active = false; };
  }, [authAttempt]);

  useEffect(() => {
    const handleSessionExpired = () => {
      authResumeStorage.write({ userId: user?.id ?? "", page: activePage,
        ...(activePage === "project" && workflow?.project.id ? { projectId: workflow.project.id } : {}) });
      refreshEpoch.invalidate();
      projectEpoch.invalidate();
      userRef.current = null;
      setSessionExpired(true);
      setError("");
      setUser(null);
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [activePage, workflow?.project.id, user?.id]);

  const loadAdmin = useCallback(async () => {
    if (!user || !adminRoles.has(user.role)) return;
    const token = refreshEpoch.begin();
    setDataRefreshing(true);
    try {
      const [
        adminPlansRes,
        adminMembershipPlansRes,
        announcementsRes,
        helpArticlesRes,
        adminUsersRes,
        providersRes,
        modelPricesRes,
        templatesRes,
        adminRes,
        evaluationRes,
        qualityProjectsRes
      ] =
        await Promise.allSettled([
          api.adminPlans(),
          api.adminMembershipPlans(),
          api.adminAnnouncements(),
          api.adminHelpArticles(),
          api.adminUsers(),
          api.providers(),
          api.modelPrices(),
          api.templates(),
          api.adminSummary(),
          api.adminEvaluationOverview(),
          api.adminQualityProjects()
        ]);

      if (!refreshEpoch.current(token) || userRef.current?.id !== user.id) return;
      setPlans([]);
      if (adminPlansRes.status === "fulfilled") setAdminPlans(adminPlansRes.value);
      if (adminMembershipPlansRes.status === "fulfilled") setMembershipPlans(adminMembershipPlansRes.value);
      if (announcementsRes.status === "fulfilled") setAnnouncements(announcementsRes.value);
      if (helpArticlesRes.status === "fulfilled") setHelpArticles(helpArticlesRes.value);
      if (adminUsersRes.status === "fulfilled") setAdminUsers(adminUsersRes.value);
      if (providersRes.status === "fulfilled") setProviders(providersRes.value);
      if (modelPricesRes.status === "fulfilled") setModelPrices(modelPricesRes.value);
      if (templatesRes.status === "fulfilled") setTemplates(templatesRes.value);
      if (adminRes.status === "fulfilled") setAdminSummary(adminRes.value);
      if (evaluationRes.status === "fulfilled") setEvaluationOverview(evaluationRes.value);
      if (qualityProjectsRes.status === "fulfilled") setQualityProjects(qualityProjectsRes.value);

      const failure = firstAdminRefreshFailure([adminPlansRes, adminMembershipPlansRes, announcementsRes, helpArticlesRes, adminUsersRes, providersRes, modelPricesRes, templatesRes, adminRes, evaluationRes, qualityProjectsRes]);
      markResourcesRead([adminPlansRes, adminMembershipPlansRes, announcementsRes, helpArticlesRes, adminUsersRes, providersRes, modelPricesRes, templatesRes, adminRes, evaluationRes, qualityProjectsRes].flatMap((result, index) => result.status === "fulfilled" ? [adminResourceLabels[index]] : []));
      if (failure) throw failure;
      setError("");
    } catch (err) {
      if (refreshEpoch.current(token)) setError(err instanceof Error ? err.message : "API 连接异常");
      throw err;
    } finally {
      if (refreshEpoch.current(token)) { setDataReady(true); setDataRefreshing(false); }
    }
  }, [adminRoles, user, refreshEpoch, markResourcesRead]);

  const load = useCallback(async () => {
    if (!user) return;
    if (isAdminRoute) {
      await loadAdmin();
      return;
    }

    const token = refreshEpoch.begin();
    setDataRefreshing(true);
    try {
      await refreshResources([
        { label: "工作台", read: () => api.workbench(), apply: setSummary },
        { label: "漫剧作品", read: () => api.projects(), apply: setProjects },
        { label: "生成队列", read: () => api.tasks(), apply: setTasks },
        { label: "账户积分", read: () => api.creditAccount(), apply: setAccount },
        { label: "积分明细", read: () => api.transactions(), apply: setTransactions },
        { label: "充值记录", read: () => api.orders(), apply: setOrders },
        { label: "充值套餐", read: () => api.plans(), apply: setPlans },
        { label: "会员配置", read: () => api.membershipPlans(), apply: setMembershipPlans },
        { label: "模型渠道", read: () => api.providers(), apply: setProviders },
        { label: "模型价格", read: () => api.modelPrices(), apply: setModelPrices },
        { label: "帮助文章", read: () => api.helpArticles(), apply: setHelpArticles },
        { label: "内容作品", read: () => contentApi.projects(), apply: setContentProjects }
      ], () => refreshEpoch.current(token) && userRef.current?.id === user.id, markResourcesRead);
      if (refreshEpoch.current(token)) setError("");
    } catch (err) {
      if (refreshEpoch.current(token)) setError(err instanceof Error ? err.message : "数据刷新失败，请稍后重试。");
      throw err;
    } finally {
      if (refreshEpoch.current(token)) { setDataReady(true); setDataRefreshing(false); }
    }
  }, [isAdminRoute, loadAdmin, user, refreshEpoch, markResourcesRead]);

  const openProject = useCallback(async (projectId: string) => {
    navigate({ page: "project", projectId });
  }, [navigate]);

  useEffect(() => {
    if (isAdminRoute || !user || route.page !== "project" || !route.projectId) return;
    const projectId = route.projectId;
    const token = projectEpoch.begin();
    setWorkflow(undefined);
    setOpeningProjectId(projectId);
    setProjectError("");
    void api.workflow(projectId).then((nextWorkflow) => {
      if (projectEpoch.current(token) && userRef.current?.id === user.id) setWorkflow(nextWorkflow);
    }).catch((reason) => {
      if (projectEpoch.current(token)) setProjectError(reason instanceof Error ? reason.message : "项目读取失败，请重试。");
    }).finally(() => {
      if (projectEpoch.current(token)) setOpeningProjectId("");
    });
    return () => { projectEpoch.invalidate(); };
  }, [isAdminRoute, user?.id, route.page, route.projectId, projectRetry, projectEpoch]);

  async function refreshCurrentProject(projectId: string) {
    const nextWorkflow = await api.workflow(projectId);
    if (routeRef.current.page === "project" && routeRef.current.projectId === projectId && userRef.current?.id === user?.id) setWorkflow(nextWorkflow);
    await load();
    return nextWorkflow;
  }

  async function applyTaskAction(action: () => Promise<GenerationTask>) {
    const updated = await action();
    setTasks(current => current.map(task => task.id === updated.id ? updated : task));
    setWorkflow(current => current ? { ...current, tasks: current.tasks.map(task => task.id === updated.id ? updated : task) } : current);
  }

  function clearAuthState(preserveToken = false) {
    if (!preserveToken) clearAuthToken();
    clearWizardDraft();
    authResumeStorage.clear();
    refreshEpoch.invalidate();
    projectEpoch.invalidate();
    userRef.current = null;
    setUser(null);
    setAuthRecoveryFailed(false);
    setDataReady(false);
    setDataRefreshing(false);
    setReadResources(new Set());
    setSummary(undefined);
    setProjects([]);
    setContentProjects([]);
    setTasks([]);
    setAccount(undefined);
    setTransactions([]);
    setOrders([]);
    setPlans([]);
    setAdminPlans([]);
    setMembershipPlans([]);
    setAnnouncements([]);
    setHelpArticles([]);
    setAdminUsers([]);
    setProviders([]);
    setModelPrices([]);
    setTemplates([]);
    setAdminSummary(undefined);
    setEvaluationOverview(undefined);
    setQualityProjects([]);
    setWorkflow(undefined);
    navigate({ page: "workbench" }, true, true);
  }

  function logout() {
    if (!window.dispatchEvent(new CustomEvent(BEFORE_CREATOR_NAVIGATION, { cancelable: true, detail: { page: "logout" } }))) return;
    void api.logout().catch(() => undefined).finally(clearAuthState);
  }

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    // 旧实现每 4 秒跑一次 load()（12+ 个接口），恰好打满每分钟 180 次限流，
    // 触发"API 连接异常：请求过于频繁"。改为：只轮询轻量的 tasks（+当前项目 workflow），
    // 8 秒一次，页面不可见时暂停；任务全部结束时做一次全量收尾刷新。
    const hasActiveTask = tasks.some((task) => task.status === "running" || task.status === "pending");
    if (!hasActiveTask && activePage !== "project") return;

    let active = true;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void api.tasks().then((nextTasks) => {
        if (!active) return;
        setTasks(nextTasks);
        const stillActive = nextTasks.some((task) => task.status === "running" || task.status === "pending");
        if (hasActiveTask && !stillActive) void load().catch(() => undefined);
      }).catch(() => undefined);
      if (activePage === "project" && workflow?.project.id) {
        void api.workflow(workflow.project.id).then((next) => { if (active && routeRef.current.projectId === next.project.id) setWorkflow(next); }).catch(() => undefined);
      }
    }, 8000);

    return () => { active = false; window.clearInterval(timer); };
  }, [activePage, load, tasks, workflow?.project.id]);

  const page = useMemo(() => {
    const openFreshWizard = () => {
      setActivePage("wizard");
    };
    const openFreshContent = () => {
      navigate({ page: "content", contentId: "__new__" });
    };
    switch (activePage) {
      case "workbench":
        return <WorkbenchPage summary={summary} contentProjects={readResources.has("内容作品") ? contentProjects : undefined} onOpenContent={id => navigate({ page: "content", contentId: id })} onRefresh={() => void load().catch(() => undefined)} onStart={openFreshWizard} onStartContent={openFreshContent} onOpenWorks={() => setActivePage("scripts")} onOpen={(projectId) => void openProject(projectId)} onOpenTasks={(taskFilter, taskId) => navigate({ page: "tasks", taskFilter, taskId })} onRecharge={() => setActivePage("recharge")} />;
      case "content":
        return <ContentCreatorPage key={`${user?.id ?? "anonymous"}:${contentFocusId || "default"}`} providers={providers} modelPrices={modelPrices} initialSelectedId={contentFocusId} onProjectsChange={setContentProjects} onBack={() => setActivePage("scripts")} onEnterProduction={async (projectId) => {
                await openProject(projectId);
          void load().catch(() => undefined);
        }} />;
      case "wizard":
        return (
          <WizardPage
            key={`${user?.id ?? "anonymous"}:${creationSession}`}
            providers={providers}
            modelPrices={modelPrices}
            canManageModels={canManageModelTests(user?.role)}
            onCreateContent={openFreshContent}
            onCreated={(projectId) => {
              void openProject(projectId);
              void load().catch(() => undefined);
            }}
          />
        );
      case "scripts":
        return <ScriptsPage projects={projects} contentProjects={contentProjects} openingId={openingProjectId} onOpen={(projectId) => void openProject(projectId)} onOpenContent={(contentProjectId) => { navigate({ page: "content", contentId: contentProjectId }); }} onNew={openFreshWizard} onNewContent={openFreshContent} onDelete={async (projectId) => {
          await api.deleteProject(projectId);
          setProjects((current) => current.filter((project) => project.id !== projectId));
          try { await load(); } catch { setError("作品已删除，部分统计未能刷新。请稍后重新加载。"); }
        }} onDeleteContent={async projectId => {
          await contentApi.deleteProject(projectId);
          setContentProjects(current => current.filter(project => project.id !== projectId));
          try { await load(); } catch { setError("故事已删除，部分统计未能刷新。请稍后重新加载。"); }
        }} />;
      case "project":
        return (
          <ProjectWorkbenchPage
            key={route.projectId}
            workflow={workflow?.project.id === route.projectId ? workflow : undefined}
            loading={openingProjectId === route.projectId}
            error={projectError}
            onRetry={() => setProjectRetry((value) => value + 1)}
            providers={providers}
            modelPrices={modelPrices}
            theme={theme}
            onThemeChange={handleThemeChange}
            onBack={() => setActivePage("scripts")}
            onRefresh={(projectId) => refreshCurrentProject(projectId)}
          />
        );
      case "studio":
        return <StudioPage projects={projects} tasks={tasks} onOpenProject={(projectId) => void openProject(projectId)} onRefresh={() => load()} />;
      case "models":
        return <ModelLibrary providers={providers} modelPrices={modelPrices} onCreate={openFreshWizard} />;
      case "tasks":
        return (
          <TaskCenterPage
            key={`${user?.id}:${route.taskFilter ?? "all"}:${route.taskId ?? ""}`}
            tasks={tasks}
            initialFilter={route.taskFilter}
            initialTaskId={route.taskId}
            onOpenProject={(id) => void openProject(id)}
            onOpenSupport={task => {
              if (!user) return;
              setSupportIntent({ userId: user.id, view: "new", key: Date.now(), prefill: taskSupportDraft(task) });
              setActivePage("help");
            }}
            onRetry={(taskId) => applyTaskAction(() => api.retryTask(taskId))}
            onCancel={(taskId) => applyTaskAction(() => api.cancelTask(taskId))}
            onRefresh={() => load()}
          />
        );
      case "profile":
        return user ? <ProfilePage user={user} account={account} summary={summary} transactions={transactions} orders={orders} onNavigate={setActivePage} onLogout={logout} onUserUpdate={setUser} /> : null;
      case "recharge":
        return <RechargePage account={account} plans={plans} membershipPlans={membershipPlans} modelPrices={modelPrices} onRefresh={() => load()} />;
      case "ledger":
        return <LedgerPage account={account} transactions={transactions} />;
      case "settings":
        return <SettingsPage theme={theme} onThemeChange={handleThemeChange} onNavigate={setActivePage} />;
      case "help":
        return user ? <HelpPage key={user.id} articles={helpArticles} userId={user.id} initialSupportIntent={supportIntent?.userId === user.id ? supportIntent : undefined} onSupportIntentConsumed={consumeSupportIntent} /> : null;
      case "admin":
        return (
          <AdminPage
            userId={user?.id ?? ""}
            summary={adminSummary}
            providers={providers}
            modelPrices={modelPrices}
            templates={templates}
            plans={adminPlans}
            membershipPlans={membershipPlans}
            announcements={announcements}
            helpArticles={helpArticles}
            users={adminUsers}
            evaluation={evaluationOverview}
            qualityProjects={qualityProjects}
            onRefresh={() => loadAdmin()}
          />
        );
      default:
        return null;
    }
  }, [navigate, setActivePage, creationSession, openProject, projectError, route.projectId, route.taskFilter, route.taskId, readResources, supportIntent, consumeSupportIntent, account, activePage, adminPlans, adminSummary, adminUsers, announcements, contentFocusId, contentProjects, handleThemeChange, helpArticles, membershipPlans, modelPrices, openingProjectId, orders, plans, projects, providers, summary, tasks, templates, theme, transactions, workflow, load, user]);

  const unreadResources = (isAdminRoute ? adminPageResources[adminHash] ?? [] : creatorPageResources[activePage] ?? []).filter((label) => !readResources.has(label));
  const initialReadState = !dataReady || unreadResources.length ? <div className="page-stack"><StatePanel
    kind={!dataReady || dataRefreshing ? "loading" : "error"}
    title={!dataReady || dataRefreshing ? "正在读取页面数据" : "页面数据尚未读取成功"}
    description={!dataReady || dataRefreshing ? "请稍候，读取完成后会展示内容。" : `${unreadResources.join("、")}暂时无法读取，当前无法判断是否有内容。请重试。`}
    action={dataReady && !dataRefreshing ? <button type="button" className="primary-button" onClick={() => void load().catch(() => undefined)}>重试读取</button> : undefined}
  /></div> : null;

  if (!authReady) {
    return <main className="ui-connection-page"><StatePanel kind="loading" title="正在连接工作空间" description="正在确认登录状态，请稍候。" /></main>;
  }

  if (!user) {
    if (authRecoveryFailed) return <main className="ui-connection-page"><StatePanel kind="error" title="暂时无法连接工作台" description={error || "网络连接未能完成，登录信息暂未更改。"} action={<><button type="button" className="primary-button" onClick={() => setAuthAttempt((value) => value + 1)}>重试连接</button><button type="button" className="ghost-button" onClick={() => clearAuthState()}>返回登录</button></>} /></main>;
    return <LoginPage
      variant={isAdminRoute ? "admin" : "creator"}
      initialAuthOpen={sessionExpired || Boolean(error)}
      sessionMessage={sessionExpired ? "登录已过期，请重新登录。未保存的修改可能需要重新填写；新建项目输入会在当前标签页临时保留。" : error}
      onAuthed={(_token, nextUser) => {
        const resume = authResumeStorage.read();
        const resumePage = resume?.page as PageKey | undefined;
        const resumeProjectId = resume?.projectId;
        const resumeUserId = resume?.userId;
        const canResume = resumeUserId === nextUser.id;
        if ((sessionExpired || resumeUserId) && !canResume) clearAuthState(true);
        setUser(nextUser);
        setSessionExpired(false);
        authResumeStorage.clear();
        if (canResume && resumePage === "project" && resumeProjectId) {
          void openProject(resumeProjectId);
        } else if (canResume && resumePage) {
          setActivePage(resumePage);
        }
      }}
    />;
  }

  if (isAdminRoute) {
    if (!adminRoles.has(user.role)) {
      return (
        <main className="admin-denied-page">
          <section className="panel admin-denied-card">
            <span className="section-kicker">NO ACCESS</span>
            <h1>当前账号没有后台权限</h1>
            <p>请退出后使用管理员账号登录后台管理系统。</p>
            <button className="primary-button large" onClick={logout}>退出登录</button>
          </section>
        </main>
      );
    }

    return (
      <AdminShell
        title="后台管理系统"
        userName={user.name}
        description="创作、质量、模型与商业化统一运营"
          items={adminNavGroups.flatMap((group) => group.items.map(({ name, icon: Icon }) => ({ id: name, label: name === "套餐会员" ? "充值套餐" : name === "订阅会员" ? "订阅方案 · 未开放" : name === "提示词评分" ? "提示词工作室" : name, group: group.label, icon: <Icon size={17} /> })))}
        activeId={adminHash}
        onNavigate={navigateAdminHash}
        onThemeToggle={handleToggleTheme}
        mobileOpen={adminMobileOpen}
        onMobileOpenChange={setAdminMobileOpen}
        actions={<><button className="adm-primary-btn" type="button" onClick={() => { window.location.href = "/"; }}>返回前台</button><button className="adm-icon-btn" type="button" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={18} /></button></>}
      >
        {error ? <InlineNotice tone="error">{error} <button type="button" className="ui-text-button" onClick={() => void load().catch(() => undefined)}>重新加载</button></InlineNotice> : null}
        <RoutePageBoundary routeId={`admin:${adminHash}`} onBack={() => { window.location.href = "/"; }} backLabel="返回前台">
        {initialReadState ?? <AdminPage
          userId={user.id}
          summary={adminSummary}
          providers={providers}
          modelPrices={modelPrices}
          templates={templates}
          plans={adminPlans}
          membershipPlans={membershipPlans}
          announcements={announcements}
          helpArticles={helpArticles}
          users={adminUsers}
          evaluation={evaluationOverview}
          qualityProjects={qualityProjects}
          onRefresh={() => loadAdmin()}
        />}
        </RoutePageBoundary>
      </AdminShell>
    );
  }

  if (activePage === "project") {
    return (
      <>
        {error ? <InlineNotice tone="error">{error} <button type="button" className="ui-text-button" onClick={() => void load().catch(() => undefined)}>重新加载</button></InlineNotice> : null}
        <RoutePageBoundary routeId={route.projectId ?? "project"} onBack={() => setActivePage("scripts")}>{page}</RoutePageBoundary>
        {tourOpen ? (
          <ProductTour
            activePage={activePage}
            currentIndex={tourIndex}
            steps={creatorTourSteps}
            onNavigate={setActivePage}
            onStepChange={setTourIndex}
            onClose={() => setTourOpen(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <Shell
      active={activePage}
      onNavigate={setActivePage}
      onStartGuide={() => {
        setTourIndex(0);
        setTourOpen(true);
      }}
      credits={account ? account.balance - account.frozenBalance : summary?.credits}
      theme={theme}
      onToggleTheme={handleToggleTheme}
      userName={user.name}
      projects={projects}
      contentProjects={contentProjects}
      tasks={tasks}
      onOpenProject={(id) => void openProject(id)}
      onOpenContent={(id) => navigate({ page: "content", contentId: id })}
      onLogout={logout}
    >
      {error ? <div className="ui-page-notice"><InlineNotice tone="error">{error} <button type="button" className="ui-text-button" onClick={() => void load().catch(() => undefined)}>重新加载</button></InlineNotice></div> : null}
      {initialReadState ?? <RoutePageBoundary routeId={`${activePage}:${route.contentId ?? ""}`} onBack={() => setActivePage("scripts")}>{page}</RoutePageBoundary>}
      {tourOpen ? (
        <ProductTour
          activePage={activePage}
          currentIndex={tourIndex}
          steps={creatorTourSteps}
          onNavigate={setActivePage}
          onStepChange={setTourIndex}
          onClose={() => setTourOpen(false)}
        />
      ) : null}
    </Shell>
  );
}

function normalizeAdminHash(hash: string) {
  if (["用户反馈", "评测闭环", "质量总览", "事件与VOC", "质量数据集", "实验评测", "模型与成本", "发布与溯源", "优化回流"].includes(hash)) return "创作质量中心";
  if (hash === "用户积分") return "用户管理";
  if (hash === "智能体接入") return "提示词评分";
  return hash;
}

const creatorTourSteps: ProductTourStep[] = [
  { id: "workspace", page: "workbench", targetId: "nav-workbench", title: "从工作台继续创作", body: "在这里查看最近作品、正在生成的任务和需要处理的问题。", placement: "right" },
  { id: "create", page: "wizard", targetId: "creation-entry", title: "选择故事的起点", body: "可以从灵感创作新内容，或导入小说和剧本。进入制作后选择画面风格和模型，先获取报价，确认积分上限才开始生成。", placement: "bottom" },
  { id: "tasks", page: "tasks", targetId: "task-center", title: "随时查看生成进度", body: "生成任务会在后台继续运行。这里可以查看结果和失败原因，并对允许重试或取消的任务进行操作。", placement: "left" },
  { id: "recharge", page: "recharge", targetId: "recharge-plans", title: "购买后兑换积分", body: "已开放的套餐会链接到店铺。购买后获取卡密，回到积分充值页兑换并核对余额。", placement: "bottom" },
  { id: "scripts", page: "scripts", targetId: "project-list", title: "从作品进入完整制作流程", body: "创建作品后，点击卡片继续内容、资产、分镜、成片四个阶段。还没有作品时，可直接新建漫剧。", placement: "bottom" }
];
