import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, ChartNoAxesCombined, ChevronDown, CircleDollarSign, FilePenLine, Gift, LayoutDashboard, Layers3, Megaphone, Moon, ReceiptText, SlidersHorizontal, UserRound, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { firstAdminRefreshFailure } from "./admin/adminRefreshModel";
import { useLayoutEffect } from "react";
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
  RedeemCode,
  WorkbenchSummary
} from "@aifilm/shared";
import { Shell, type PageKey } from "./components/Shell";
import { ProductTour, type ProductTourStep } from "./components/ProductTour";
import { api, type AuthUser } from "./lib/api";
import { contentApi } from "./lib/contentApi";
import { AdminPage } from "./pages/AdminPage";
import { AdminShell } from "./admin";
import { readAdminHash } from "./admin/adminActionModel";
import { LedgerPage, RechargePage } from "./pages/CreditsPage";
import { LoginPage } from "./pages/LoginPage";
import { ScriptsPage } from "./pages/ScriptsPage";
import { ProjectWorkbenchPage } from "./pages/ProjectWorkbenchPage";
import { HelpPage, ProfilePage, SettingsPage } from "./pages/StaticPages";
import { StudioPage } from "./pages/StudioPage";
import { TaskCenterPage } from "./pages/TaskCenterPage";
import { WizardPage } from "./pages/WizardPage";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { ContentCreatorPage } from "./pages/ContentCreatorPage";
import { resolveThemePreference, type WorkbenchTheme } from "./workbench/model";
import { AUTH_SESSION_EXPIRED_EVENT, HttpError } from "./lib/httpClient";
import { clearAuthToken, readAuthToken } from "./lib/authStorage";
import { clearWizardDraft } from "./pages/wizardDraftStorage";

const THEME_STORAGE_KEY = "manjiao-theme";
const AUTH_RESUME_PAGE_KEY = "manjiao-auth-resume-page";
const AUTH_RESUME_PROJECT_KEY = "manjiao-auth-resume-project";
const AUTH_RESUME_USER_KEY = "manjiao-auth-resume-user";

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
        { name: "创作现场管理", icon: Video },
        { name: "创作质量中心", icon: ChartNoAxesCombined }
      ]
    },
    {
      label: "商业化",
      items: [
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
  const [activePage, setActivePage] = useState<PageKey>("workbench");
  const [adminHash, setAdminHash] = useState(() => normalizeAdminHash(readAdminHash(window.location.hash)));
  const [adminMobileOpen, setAdminMobileOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [summary, setSummary] = useState<WorkbenchSummary>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [contentProjects, setContentProjects] = useState<ContentProjectSummary[]>([]);
  const [contentFocusId, setContentFocusId] = useState("");
  const [openingProjectId, setOpeningProjectId] = useState("");
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [account, setAccount] = useState<CreditAccount>();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [adminPlans, setAdminPlans] = useState<Plan[]>([]);
  const [membershipPlans, setMembershipPlans] = useState<MembershipPlan[]>([]);
  const [redeemCodes, setRedeemCodes] = useState<RedeemCode[]>([]);
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
    const syncAdminHash = () => setAdminHash(normalizeAdminHash(readAdminHash(window.location.hash)));
    window.addEventListener("hashchange", syncAdminHash);
    syncAdminHash();
    return () => window.removeEventListener("hashchange", syncAdminHash);
  }, [isAdminRoute]);

  useEffect(() => {
    const token = readAuthToken();
    if (!token) {
      setAuthReady(true);
      return;
    }
    void api
      .me()
      .then((result) => setUser(result.user))
      .catch((reason) => {
        if (reason instanceof HttpError && reason.status === 401) clearAuthToken();
        else setError(reason instanceof Error ? reason.message : "暂时无法恢复登录，请检查网络后刷新页面。");
      })
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      sessionStorage.setItem(AUTH_RESUME_PAGE_KEY, activePage);
      if (user?.id) sessionStorage.setItem(AUTH_RESUME_USER_KEY, user.id);
      if (activePage === "project" && workflow?.project.id) sessionStorage.setItem(AUTH_RESUME_PROJECT_KEY, workflow.project.id);
      setSessionExpired(true);
      setError("");
      setUser(null);
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [activePage, workflow?.project.id, user?.id]);

  const loadAdmin = useCallback(async () => {
    if (!user || !adminRoles.has(user.role)) return;
    try {
      const [
        adminPlansRes,
        adminMembershipPlansRes,
        redeemCodesRes,
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
          api.adminRedeemCodes(),
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

      setPlans([]);
      if (adminPlansRes.status === "fulfilled") setAdminPlans(adminPlansRes.value);
      if (adminMembershipPlansRes.status === "fulfilled") setMembershipPlans(adminMembershipPlansRes.value);
      if (redeemCodesRes.status === "fulfilled") setRedeemCodes(redeemCodesRes.value);
      if (announcementsRes.status === "fulfilled") setAnnouncements(announcementsRes.value);
      if (helpArticlesRes.status === "fulfilled") setHelpArticles(helpArticlesRes.value);
      if (adminUsersRes.status === "fulfilled") setAdminUsers(adminUsersRes.value);
      if (providersRes.status === "fulfilled") setProviders(providersRes.value);
      if (modelPricesRes.status === "fulfilled") setModelPrices(modelPricesRes.value);
      if (templatesRes.status === "fulfilled") setTemplates(templatesRes.value);
      if (adminRes.status === "fulfilled") setAdminSummary(adminRes.value);
      if (evaluationRes.status === "fulfilled") setEvaluationOverview(evaluationRes.value);
      if (qualityProjectsRes.status === "fulfilled") setQualityProjects(qualityProjectsRes.value);

      const failure = firstAdminRefreshFailure([adminPlansRes, adminMembershipPlansRes, redeemCodesRes, announcementsRes, helpArticlesRes, adminUsersRes, providersRes, modelPricesRes, templatesRes, adminRes, evaluationRes, qualityProjectsRes]);
      if (failure) throw failure;
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "API 连接异常");
      throw err;
    }
  }, [adminRoles, user]);

  const load = useCallback(async () => {
    if (!user) return;
    if (isAdminRoute) {
      await loadAdmin();
      return;
    }

    try {
      const [summaryRes, projectsRes, tasksRes, accountRes, txRes, ordersRes, plansRes, membershipPlansRes, providersRes, modelPricesRes, helpArticlesRes, contentProjectsRes] =
        await Promise.all([
          api.workbench(),
          api.projects(),
          api.tasks(),
          api.creditAccount(),
          api.transactions(),
          api.orders(),
          api.plans(),
          api.membershipPlans(),
          api.providers(),
          api.modelPrices(),
          api.helpArticles(),
          contentApi.projects().catch(() => [] as ContentProjectSummary[])
        ]);

      setSummary(summaryRes);
      setProjects(projectsRes);
      setContentProjects(contentProjectsRes);
      setTasks(tasksRes);
      setAccount(accountRes);
      setTransactions(txRes);
      setOrders(ordersRes);
      setPlans(plansRes);
      setMembershipPlans(membershipPlansRes);
      setProviders(providersRes);
      setModelPrices(modelPricesRes);
      setHelpArticles(helpArticlesRes);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "API 连接异常");
    }
  }, [isAdminRoute, loadAdmin, user]);

  async function openProject(projectId: string) {
    // 之前无 catch：workflow 请求一失败就静默吞掉，用户点击"没有任何反应"。
    if (openingProjectId) return;
    setOpeningProjectId(projectId);
    setError("");
    try {
      const nextWorkflow = await api.workflow(projectId);
      setWorkflow(nextWorkflow);
      setActivePage("project");
    } catch (err) {
      setError(err instanceof Error ? `打开作品失败：${err.message}` : "打开作品失败，请稍后重试");
    } finally {
      setOpeningProjectId("");
    }
  }

  async function refreshCurrentProject(projectId: string) {
    const nextWorkflow = await api.workflow(projectId);
    setWorkflow(nextWorkflow);
    await load();
    return nextWorkflow;
  }

  async function refreshTaskAction(action: () => Promise<GenerationTask>) {
    await action();
    await load();
  }

  function clearAuthState(preserveToken = false) {
    if (!preserveToken) clearAuthToken();
    clearWizardDraft();
    sessionStorage.removeItem(AUTH_RESUME_PAGE_KEY);
    sessionStorage.removeItem(AUTH_RESUME_PROJECT_KEY);
    sessionStorage.removeItem(AUTH_RESUME_USER_KEY);
    setUser(null);
    setSummary(undefined);
    setProjects([]);
    setContentProjects([]);
    setContentFocusId("");
    setTasks([]);
    setAccount(undefined);
    setTransactions([]);
    setOrders([]);
    setPlans([]);
    setAdminPlans([]);
    setMembershipPlans([]);
    setRedeemCodes([]);
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
    setActivePage("workbench");
  }

  function logout() {
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

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void api.tasks().then((nextTasks) => {
        setTasks(nextTasks);
        const stillActive = nextTasks.some((task) => task.status === "running" || task.status === "pending");
        if (hasActiveTask && !stillActive) void load().catch(() => undefined);
      }).catch(() => undefined);
      if (activePage === "project" && workflow?.project.id) {
        void api.workflow(workflow.project.id).then(setWorkflow).catch(() => undefined);
      }
    }, 8000);

    return () => window.clearInterval(timer);
  }, [activePage, load, tasks, workflow?.project.id]);

  const page = useMemo(() => {
    const openFreshWizard = () => {
      clearWizardDraft();
      setActivePage("wizard");
    };
    const openFreshContent = () => {
      setContentFocusId("__new__");
      setActivePage("content");
    };
    switch (activePage) {
      case "workbench":
        return <WorkbenchPage summary={summary} onStart={openFreshWizard} onOpen={(projectId) => void openProject(projectId)} onOpenTasks={() => setActivePage("tasks")} onRecharge={() => setActivePage("recharge")} />;
      case "content":
        return <ContentCreatorPage providers={providers} initialSelectedId={contentFocusId} onBack={() => setActivePage("scripts")} onEnterProduction={async (projectId) => {
          setContentFocusId("");
          await load();
          await openProject(projectId);
        }} />;
      case "wizard":
        return (
          <WizardPage
            providers={providers}
            onCreateContent={openFreshContent}
            onCreated={(projectId) => {
              void load().then(() => openProject(projectId)).catch(() => undefined);
            }}
          />
        );
      case "scripts":
        return <ScriptsPage projects={projects} contentProjects={contentProjects} openingId={openingProjectId} onOpen={(projectId) => void openProject(projectId)} onOpenContent={(contentProjectId) => { setContentFocusId(contentProjectId); setActivePage("content"); }} onNew={openFreshWizard} onNewContent={openFreshContent} onDelete={(projectId) => void api.deleteProject(projectId).then(() => load()) .catch((reason) => setError(reason instanceof Error ? reason.message : "删除作品失败"))} />;
      case "project":
        return (
          <ProjectWorkbenchPage
            workflow={workflow}
            providers={providers}
            modelPrices={modelPrices}
            theme={theme}
            onThemeChange={handleThemeChange}
            onBack={() => setActivePage("scripts")}
            onRefresh={(projectId) => refreshCurrentProject(projectId)}
          />
        );
      case "studio":
        return <StudioPage projects={projects} tasks={tasks} onOpenProject={(projectId) => void openProject(projectId)} onRefresh={() => void load()} />;
      case "tasks":
        return (
          <TaskCenterPage
            tasks={tasks}
            onRetry={(taskId) => refreshTaskAction(() => api.retryTask(taskId))}
            onCancel={(taskId) => refreshTaskAction(() => api.cancelTask(taskId))}
            onRefresh={() => load()}
          />
        );
      case "profile":
        return user ? <ProfilePage user={user} account={account} summary={summary} transactions={transactions} orders={orders} onNavigate={setActivePage} onLogout={logout} onUserUpdate={setUser} /> : null;
      case "recharge":
        return <RechargePage plans={plans} membershipPlans={membershipPlans} modelPrices={modelPrices} onRefresh={() => void load()} />;
      case "ledger":
        return <LedgerPage account={account} transactions={transactions} />;
      case "settings":
        return <SettingsPage />;
      case "help":
        return <HelpPage articles={helpArticles} />;
      case "admin":
        return (
          <AdminPage
            summary={adminSummary}
            providers={providers}
            modelPrices={modelPrices}
            templates={templates}
            plans={adminPlans}
            membershipPlans={membershipPlans}
            redeemCodes={redeemCodes}
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
  }, [account, activePage, adminPlans, adminSummary, adminUsers, announcements, contentFocusId, contentProjects, handleThemeChange, helpArticles, membershipPlans, modelPrices, openingProjectId, orders, plans, projects, providers, redeemCodes, summary, tasks, templates, theme, transactions, workflow, load, user]);

  if (!authReady) {
    return <div className="app-loading">正在连接 AI 漫剧工作台...</div>;
  }

  if (!user) {
    return <LoginPage
      variant={isAdminRoute ? "admin" : "creator"}
      initialAuthOpen={sessionExpired || Boolean(error)}
      sessionMessage={sessionExpired ? "登录已过期，请重新登录。未保存的修改可能需要重新填写；新建项目输入会在当前标签页临时保留。" : error}
      onAuthed={(_token, nextUser) => {
        const resumePage = sessionStorage.getItem(AUTH_RESUME_PAGE_KEY) as PageKey | null;
        const resumeProjectId = sessionStorage.getItem(AUTH_RESUME_PROJECT_KEY);
        const resumeUserId = sessionStorage.getItem(AUTH_RESUME_USER_KEY);
        const canResume = resumeUserId === nextUser.id;
        if (resumeUserId && !canResume) clearAuthState(true);
        setUser(nextUser);
        setSessionExpired(false);
        sessionStorage.removeItem(AUTH_RESUME_PAGE_KEY);
        sessionStorage.removeItem(AUTH_RESUME_PROJECT_KEY);
        sessionStorage.removeItem(AUTH_RESUME_USER_KEY);
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
        description="创作、质量、模型与商业化统一运营"
        items={adminNavGroups.flatMap((group) => group.items.map(({ name, icon: Icon }) => ({ id: name, label: name, icon: <Icon size={17} /> })))}
        activeId={adminHash}
        onNavigate={(id) => { window.location.hash = encodeURIComponent(id); }}
        onThemeToggle={handleToggleTheme}
        mobileOpen={adminMobileOpen}
        onMobileOpenChange={setAdminMobileOpen}
        actions={<><button className="adm-primary-btn" type="button" onClick={() => { window.location.href = "/"; }}>返回前台</button><button className="adm-icon-btn" type="button" onClick={logout} aria-label="退出登录">退</button></>}
      >
        {error ? <div className="error-banner">API 连接异常：{error}</div> : null}
        <AdminPage
          summary={adminSummary}
          providers={providers}
          modelPrices={modelPrices}
          templates={templates}
          plans={adminPlans}
          membershipPlans={membershipPlans}
          redeemCodes={redeemCodes}
          announcements={announcements}
          helpArticles={helpArticles}
          users={adminUsers}
          evaluation={evaluationOverview}
          qualityProjects={qualityProjects}
          onRefresh={() => loadAdmin()}
        />
      </AdminShell>
    );
  }

  if (activePage === "project") {
    return (
      <>
        {error ? <div className="error-banner">API 连接异常：{error}</div> : null}
        {page}
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
      credits={account?.balance ?? summary?.credits ?? 0}
      theme={theme}
      onToggleTheme={handleToggleTheme}
      userName={user.name}
      onLogout={logout}
    >
      {error ? <div className="error-banner">API 连接异常：{error}</div> : null}
      {page}
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
  {
    id: "workspace",
    page: "workbench",
    targetId: "nav-workbench",
    title: "先看一遍 9 宫格制作流程",
    body: "这个教程会带你看完整创作路径：导入故事、选择风格、生成剧本、角色定稿、分镜图、视频和导出。",
    placement: "right"
  },
  {
    id: "create",
    page: "workbench",
    targetId: "create-project",
    title: "从新建漫剧开始",
    body: "点击这里进入创作向导。创作者只需要按步骤确认内容，复杂模型参数会默认隐藏。",
    placement: "right"
  },
  {
    id: "story",
    page: "wizard",
    targetId: "story-input",
    title: "第一步：导入小说",
    body: "把小说正文、故事大纲或已有剧本粘贴到这里。系统会按内容长度估算集数，并生成后续生产资产。",
    placement: "right"
  },
  {
    id: "mode",
    page: "wizard",
    targetId: "generation-mode",
    title: "第二步：选择生成模式",
    body: "9 宫格适合快速成片，25 宫格适合更细镜头。推荐先用 9 宫格跑通闭环。",
    placement: "right"
  },
  {
    id: "style",
    page: "wizard",
    targetId: "style-picker",
    title: "第三步：选择画面风格",
    body: "风格会贯穿角色、场景、分镜图和视频首帧，后续尽量保持同一画风。",
    placement: "bottom"
  },
  {
    id: "scripts",
    page: "scripts",
    targetId: "project-list",
    title: "作品会自动保存",
    body: "提交后，生成中和已完成的作品都会在这里显示。点击作品卡片可继续进入项目生产台。",
    placement: "bottom"
  },
  {
    id: "tasks",
    page: "tasks",
    targetId: "task-center",
    title: "生成任务统一排队",
    body: "剧本、角色、分镜图、视频和导出都会进入任务中心，失败后可以重试或切换模型继续。",
    placement: "left"
  },
  {
    id: "recharge",
    page: "recharge",
    targetId: "recharge-plans",
    title: "充值和订阅走店铺链接",
    body: "这里会展示后台配置的商品链接。购买卡密后回到本页兑换，方便商业化前期跑通。",
    placement: "bottom"
  },
  {
    id: "project",
    page: "project",
    targetId: "project-flow-tabs",
    title: "项目内只保留 5 步主流程",
    body: "剧本确认、角色定稿、分镜图、视频合成、导出。FOV、模型和提示词细节会放进高级区。",
    placement: "bottom"
  }
];
