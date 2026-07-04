import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, ChartNoAxesCombined, ChevronDown, CircleDollarSign, FilePenLine, Gift, LayoutDashboard, Layers3, Moon, ReceiptText, SlidersHorizontal, UserRound } from "lucide-react";
import type {
  AdminUserRow,
  AdminSummary,
  CreditAccount,
  CreditTransaction,
  EvaluationOverview,
  GenerationTask,
  MembershipPlan,
  ModelPrice,
  ModelProvider,
  Plan,
  Project,
  PromptTemplate,
  ProjectWorkflow,
  QualityProjectRow,
  RedeemCode,
  WorkbenchSummary
} from "@aifilm/shared";
import { Shell, type PageKey } from "./components/Shell";
import { ProductTour, type ProductTourStep } from "./components/ProductTour";
import { api, type AuthUser } from "./lib/api";
import { AdminPage } from "./pages/AdminPage";
import { LedgerPage, RechargePage } from "./pages/CreditsPage";
import { LoginPage } from "./pages/LoginPage";
import { ScriptsPage } from "./pages/ScriptsPage";
import { ProjectWorkbenchPage } from "./pages/ProjectWorkbenchPage";
import { HelpPage, ProfilePage, SettingsPage, StudioPage } from "./pages/StaticPages";
import { TaskCenterPage } from "./pages/TaskCenterPage";
import { WizardPage } from "./pages/WizardPage";
import { WorkbenchPage } from "./pages/WorkbenchPage";

export function App() {
  const isAdminRoute = window.location.pathname.startsWith("/admin");
  const adminRoles = useMemo(() => new Set(["admin", "operator", "finance", "support"]), []);
  const [activePage, setActivePage] = useState<PageKey>("workbench");
  const [tourOpen, setTourOpen] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [summary, setSummary] = useState<WorkbenchSummary>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [account, setAccount] = useState<CreditAccount>();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [adminPlans, setAdminPlans] = useState<Plan[]>([]);
  const [membershipPlans, setMembershipPlans] = useState<MembershipPlan[]>([]);
  const [redeemCodes, setRedeemCodes] = useState<RedeemCode[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [modelPrices, setModelPrices] = useState<ModelPrice[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [adminSummary, setAdminSummary] = useState<AdminSummary>();
  const [evaluationOverview, setEvaluationOverview] = useState<EvaluationOverview>();
  const [qualityProjects, setQualityProjects] = useState<QualityProjectRow[]>([]);
  const [workflow, setWorkflow] = useState<ProjectWorkflow>();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const token = localStorage.getItem("aifilm_auth_token");
    if (!token) {
      setAuthReady(true);
      return;
    }
    void api
      .me()
      .then((result) => setUser(result.user))
      .catch(() => localStorage.removeItem("aifilm_auth_token"))
      .finally(() => setAuthReady(true));
  }, []);

  const loadAdmin = useCallback(async () => {
    if (!user || !adminRoles.has(user.role)) return;
    try {
      const [
        adminPlansRes,
        adminMembershipPlansRes,
        redeemCodesRes,
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
      if (adminUsersRes.status === "fulfilled") setAdminUsers(adminUsersRes.value);
      if (providersRes.status === "fulfilled") setProviders(providersRes.value);
      if (modelPricesRes.status === "fulfilled") setModelPrices(modelPricesRes.value);
      if (templatesRes.status === "fulfilled") setTemplates(templatesRes.value);
      if (adminRes.status === "fulfilled") setAdminSummary(adminRes.value);
      if (evaluationRes.status === "fulfilled") setEvaluationOverview(evaluationRes.value);
      if (qualityProjectsRes.status === "fulfilled") setQualityProjects(qualityProjectsRes.value);

      const failures = [adminPlansRes, adminMembershipPlansRes, redeemCodesRes, adminUsersRes, providersRes, modelPricesRes, templatesRes, adminRes, evaluationRes, qualityProjectsRes]
        .filter((result) => result.status === "rejected")
        .map((result) => (result as PromiseRejectedResult).reason)
        .filter((reason) => reason instanceof Error && !reason.message.includes("没有此模块权限"));
      setError(failures[0] instanceof Error ? failures[0].message : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "API 连接异常");
    }
  }, [adminRoles, user]);

  const load = useCallback(async () => {
    if (!user) return;
    if (isAdminRoute) {
      await loadAdmin();
      return;
    }

    try {
      const [summaryRes, projectsRes, tasksRes, accountRes, txRes, plansRes, membershipPlansRes, providersRes, modelPricesRes] =
        await Promise.all([
          api.workbench(),
          api.projects(),
          api.tasks(),
          api.creditAccount(),
          api.transactions(),
          api.plans(),
          api.membershipPlans(),
          api.providers(),
          api.modelPrices()
        ]);

      setSummary(summaryRes);
      setProjects(projectsRes);
      setTasks(tasksRes);
      setAccount(accountRes);
      setTransactions(txRes);
      setPlans(plansRes);
      setMembershipPlans(membershipPlansRes);
      setProviders(providersRes);
      setModelPrices(modelPricesRes);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "API 连接异常");
    }
  }, [isAdminRoute, loadAdmin, user]);

  async function openProject(projectId: string) {
    const nextWorkflow = await api.workflow(projectId);
    setWorkflow(nextWorkflow);
    setActivePage("project");
  }

  async function refreshCurrentProject(projectId: string) {
    await load();
    setWorkflow(await api.workflow(projectId));
  }

  async function refreshTaskAction(action: () => Promise<GenerationTask>) {
    await action();
    await load();
  }

  function clearAuthState() {
    localStorage.removeItem("aifilm_auth_token");
    setUser(null);
    setSummary(undefined);
    setProjects([]);
    setTasks([]);
    setAccount(undefined);
    setTransactions([]);
    setPlans([]);
    setAdminPlans([]);
    setMembershipPlans([]);
    setRedeemCodes([]);
    setAdminUsers([]);
    setProviders([]);
    setModelPrices([]);
    setTemplates([]);
    setAdminSummary(undefined);
    setWorkflow(undefined);
    setActivePage("workbench");
  }

  function logout() {
    void api.logout().catch(() => undefined).finally(clearAuthState);
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const hasActiveTask = tasks.some((task) => task.status === "running" || task.status === "pending");
    if (!hasActiveTask && activePage !== "project") return;

    const timer = window.setInterval(() => {
      void load().then(() => {
        if (workflow?.project.id) {
          void api.workflow(workflow.project.id).then(setWorkflow).catch(() => undefined);
        }
      });
    }, 4000);

    return () => window.clearInterval(timer);
  }, [activePage, load, tasks, workflow?.project.id]);

  const page = useMemo(() => {
    switch (activePage) {
      case "workbench":
        return <WorkbenchPage summary={summary} onStart={() => setActivePage("wizard")} onOpen={(projectId) => void openProject(projectId)} />;
      case "wizard":
        return (
          <WizardPage
            providers={providers}
            onCreated={(projectId) => {
              void load().then(() => openProject(projectId));
            }}
          />
        );
      case "scripts":
        return <ScriptsPage projects={projects} onOpen={(projectId) => void openProject(projectId)} onNew={() => setActivePage("wizard")} />;
      case "project":
        return (
          <ProjectWorkbenchPage
            workflow={workflow}
            providers={providers}
            modelPrices={modelPrices}
            onBack={() => setActivePage("scripts")}
            onRefresh={(projectId) => refreshCurrentProject(projectId)}
          />
        );
      case "studio":
        return <StudioPage />;
      case "tasks":
        return (
          <TaskCenterPage
            tasks={tasks}
            onRetry={(taskId) => void refreshTaskAction(() => api.retryTask(taskId))}
            onCancel={(taskId) => void refreshTaskAction(() => api.cancelTask(taskId))}
            onRefresh={() => void load()}
          />
        );
      case "profile":
        return <ProfilePage />;
      case "recharge":
        return <RechargePage plans={plans} membershipPlans={membershipPlans} modelPrices={modelPrices} onRefresh={() => void load()} />;
      case "ledger":
        return <LedgerPage account={account} transactions={transactions} />;
      case "settings":
        return <SettingsPage />;
      case "help":
        return <HelpPage />;
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
            users={adminUsers}
            evaluation={evaluationOverview}
            qualityProjects={qualityProjects}
            onRefresh={() => void load()}
          />
        );
      default:
        return null;
    }
  }, [account, activePage, adminPlans, adminSummary, adminUsers, membershipPlans, modelPrices, plans, projects, providers, redeemCodes, summary, tasks, templates, transactions, workflow, load]);

  if (!authReady) {
    return <div className="app-loading">正在连接 AI 漫剧工作台...</div>;
  }

  if (!user) {
    return <LoginPage variant={isAdminRoute ? "admin" : "creator"} onAuthed={(_token, nextUser) => setUser(nextUser)} />;
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
      <div className="admin-standalone-shell">
        <aside className="admin-standalone-sidebar">
          <div className="brand admin-v2-brand">
            <div className="brand-mark admin-v2-brand-mark">漫</div>
            <div>
              <strong>漫角</strong>
              <span>运营控制台</span>
            </div>
          </div>
          <nav className="admin-module-nav" aria-label="后台模块">
            {[
              ["运营总览", LayoutDashboard],
              ["用户管理", UserRound],
              ["评测闭环", ChartNoAxesCombined],
              ["兑换码", Gift],
              ["套餐会员", CircleDollarSign],
              ["订阅会员", ReceiptText],
              ["模型路由", SlidersHorizontal],
              ["提示词评分", FilePenLine],
              ["价格策略", Layers3]
            ].map(([item, Icon]) => (
              <a key={String(item)} href={`#${item}`}>
                <Icon size={20} />
                <span>{String(item)}</span>
              </a>
            ))}
          </nav>
          <div className="admin-sidebar-bottom">
            <button type="button"><Moon size={20} />浅色模式</button>
            <button type="button" onClick={() => { window.location.href = "/"; }}>返回前台</button>
          </div>
        </aside>
        <main className="admin-standalone-main">
          <header className="admin-standalone-topbar">
            <div>
              <strong>后台管理系统</strong>
              <small>用户、积分、计费与模型供应商统一管理</small>
            </div>
            <div className="top-actions">
              <button className="admin-top-icon" aria-label="通知"><Bell size={18} /></button>
              <span className="admin-top-lang">CN&nbsp;ZH</span>
              <span className="admin-top-balance"><CircleDollarSign size={18} />¥{(adminSummary?.providerCost ?? 0).toFixed(2)}</span>
              <div className="admin-top-user"><span>{user.name.slice(0, 2)}</span><div><strong>{user.name}</strong><small>{user.role}</small></div><ChevronDown size={16} /></div>
              <button className="admin-top-logout" onClick={logout} aria-label="退出登录">退出</button>
            </div>
          </header>
          {error ? <div className="error-banner">API 连接异常：{error}</div> : null}
          <AdminPage
            summary={adminSummary}
            providers={providers}
            modelPrices={modelPrices}
            templates={templates}
            plans={adminPlans}
            membershipPlans={membershipPlans}
            redeemCodes={redeemCodes}
            users={adminUsers}
            evaluation={evaluationOverview}
            qualityProjects={qualityProjects}
            onRefresh={() => void loadAdmin()}
          />
        </main>
      </div>
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
      onToggleTheme={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
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

