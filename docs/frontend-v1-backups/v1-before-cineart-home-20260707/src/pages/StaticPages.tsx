import {
  BadgeCheck,
  Bell,
  BookOpen,
  Camera,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock,
  Coins,
  CreditCard,
  FileText,
  Film,
  Gauge,
  Headphones,
  KeyRound,
  LifeBuoy,
  ListChecks,
  LogOut,
  Mail,
  MessageSquare,
  MonitorPlay,
  ReceiptText,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Settings
} from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import type { CreditAccount, CreditTransaction, HelpArticle, ModelTestResult, RechargeOrder, WorkbenchSummary } from "@aifilm/shared";
import { api, type AuthUser } from "../lib/api";
import type { PageKey } from "../components/Shell";

const maxAvatarBytes = 20 * 1024;
type ProfileTab = "account" | "works" | "orders" | "ledger" | "security";
const profileTabs: Array<{
  id: ProfileTab;
  label: string;
  icon: typeof UserRound;
  count?: (input: { summary?: WorkbenchSummary; transactions: CreditTransaction[]; orders: RechargeOrder[] }) => number;
}> = [
  { id: "account", label: "账号", icon: UserRound },
  { id: "works", label: "作品", icon: BookOpen, count: ({ summary }) => summary?.projects ?? 0 },
  { id: "orders", label: "订单", icon: ReceiptText, count: ({ orders }) => orders.length },
  { id: "ledger", label: "积分流水", icon: ClipboardList, count: ({ transactions }) => transactions.length },
  { id: "security", label: "安全", icon: Clock }
];

export function StudioPage() {
  return (
    <SimplePage
      title="剪辑中心"
      desc="管理视频片段、配音、字幕、封面和合成导出。"
      items={["片段时间线", "配音字幕", "封面设置", "MP4 导出"]}
      icon={<Film size={28} />}
    />
  );
}

export function ProfilePage({
  user,
  account,
  summary,
  transactions,
  orders,
  onNavigate,
  onLogout,
  onUserUpdate
}: {
  user: AuthUser;
  account?: CreditAccount;
  summary?: WorkbenchSummary;
  transactions: CreditTransaction[];
  orders: RechargeOrder[];
  onNavigate: (page: PageKey) => void;
  onLogout: () => void;
  onUserUpdate: (user: AuthUser) => void;
}) {
  const contact = user.email || user.phone || "未绑定联系方式";
  const recentTransactions = transactions.slice(0, 5);
  const recentOrders = orders.slice(0, 6);
  const [activeTab, setActiveTab] = useState<ProfileTab>("account");
  const [editOpen, setEditOpen] = useState(false);
  const [profileName, setProfileName] = useState(user.name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [emailForm, setEmailForm] = useState({ email: user.email ?? "", currentPassword: "" });
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    setProfileName(user.name);
    setAvatarUrl(user.avatarUrl ?? "");
    setEmailForm({ email: user.email ?? "", currentPassword: "" });
  }, [user.id, user.name, user.avatarUrl, user.email]);

  async function handleAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setProfileError("");
    setProfileMessage("");
    try {
      const nextAvatarUrl = await compressAvatarFile(file);
      setAvatarUrl(nextAvatarUrl);
      setProfileMessage("头像已处理，点击保存后生效。");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "头像处理失败");
    }
  }

  async function saveProfile() {
    const name = profileName.trim();
    if (!name) {
      setProfileError("用户名不能为空。");
      return;
    }

    setProfileBusy(true);
    setProfileError("");
    setProfileMessage("");
    try {
      const result = await api.updateProfile({ name, avatarUrl: avatarUrl || null });
      onUserUpdate(result.user);
      setProfileMessage("资料已更新。");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "资料更新失败");
    } finally {
      setProfileBusy(false);
    }
  }

  async function removeAvatar() {
    setProfileBusy(true);
    setProfileError("");
    setProfileMessage("");
    try {
      const result = await api.updateProfile({ avatarUrl: null });
      onUserUpdate(result.user);
      setAvatarUrl("");
      setProfileMessage("头像已删除。");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "头像删除失败");
    } finally {
      setProfileBusy(false);
    }
  }

  async function changeEmail() {
    const email = emailForm.email.trim().toLowerCase();
    setEmailError("");
    setEmailMessage("");
    if (!email) {
      setEmailError("请输入邮箱地址。");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("请输入有效邮箱地址。");
      return;
    }
    if (email === (user.email ?? "").toLowerCase()) {
      setEmailMessage("邮箱账号没有变化。");
      return;
    }
    if (!emailForm.currentPassword) {
      setEmailError("修改邮箱需要输入当前密码。");
      return;
    }

    setEmailBusy(true);
    try {
      const result = await api.updateProfile({ email, currentPassword: emailForm.currentPassword });
      onUserUpdate(result.user);
      setEmailForm({ email: result.user.email ?? "", currentPassword: "" });
      setEmailMessage("邮箱账号已更新。");
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "邮箱修改失败");
    } finally {
      setEmailBusy(false);
    }
  }

  async function changePassword() {
    setPasswordError("");
    setPasswordMessage("");
    if (!passwordForm.currentPassword) {
      setPasswordError("请输入当前密码。");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      setPasswordError("新密码至少需要 8 个字符。");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("两次输入的新密码不一致。");
      return;
    }

    setPasswordBusy(true);
    try {
      await api.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordMessage("密码已更新。");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "密码修改失败");
    } finally {
      setPasswordBusy(false);
    }
  }

  const profileStats = [
    { label: "作品", value: summary?.projects ?? 0 },
    { label: "分镜", value: summary?.storyboards ?? 0 },
    { label: "积分", value: account?.balance ?? summary?.credits ?? 0 },
    { label: "累计充值", value: account?.totalRecharge ?? 0 }
  ];
  const creditBalance = account?.balance ?? summary?.credits ?? 0;
  const creditTotal = Math.max(account?.totalRecharge ?? 0, creditBalance + (account?.totalConsume ?? 0));
  const creditPercent = creditTotal ? Math.min(100, Math.round((creditBalance / creditTotal) * 100)) : 0;

  return (
    <div className="page-stack profile-page profile-console-page">
      <section className="profile-hero profile-account-cover">
        <div className="profile-identity">
          <ProfileAvatar name={user.name} avatarUrl={user.avatarUrl} size="large" />
          <div>
            <span className="section-kicker">AI 漫剧 / 我的</span>
            <h1>{user.name} {user.phone ? `@${user.phone}` : ""}</h1>
            <p>已登录 · {maskContact(contact)}</p>
            <div className="profile-badges">
              <span><BadgeCheck size={15} />{roleLabel(user.role)}</span>
              <span><ShieldCheck size={15} />{user.status === "active" ? "账号正常" : "账号停用"}</span>
            </div>
          </div>
        </div>
        <div className="profile-hero-stats">
          {profileStats.map((item) => (
            <div key={item.label}>
              <strong>{item.value.toLocaleString()}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        <div className="profile-hero-actions">
          <button className="ghost-button" onClick={() => { setActiveTab("account"); setEditOpen((value) => !value); }}><Camera size={18} />编辑资料</button>
          <button className="icon-button" onClick={onLogout} aria-label="退出登录"><LogOut size={18} /></button>
        </div>
      </section>

      <nav className="profile-tabs" aria-label="个人中心标签">
        {profileTabs.map((tab) => (
          <button className={activeTab === tab.id ? "active" : undefined} key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}>
            <tab.icon size={17} />
            {tab.label}
            {tab.count !== undefined ? <span>{tab.count({ summary, transactions, orders })}</span> : null}
          </button>
        ))}
      </nav>

      {activeTab === "account" ? (
        <div className="profile-account-grid">
          <section className="profile-section profile-account-info-card">
            <div className="panel-head">
              <div>
                <h2>账号信息</h2>
                <small>基础资料、联系方式和当前账号状态。</small>
              </div>
              <button className="ghost-button" type="button" onClick={() => setEditOpen((value) => !value)}>
                <Camera size={16} />编辑
              </button>
            </div>
            <div className="profile-info-list">
              <InfoRow label="昵称" value={user.name} />
              <InfoRow label="用户名" value={user.phone || user.email || user.id} />
              <InfoRow label="手机号" value={maskContact(user.phone || "未绑定")} />
              <InfoRow label="邮箱" value={user.email || "未绑定"} />
              <InfoRow label="账号状态" value={user.status === "active" ? "正常" : "停用"} />
            </div>
            {editOpen ? (
              <div className="profile-inline-editor">
                <div className="profile-avatar-editor">
                  <ProfileAvatar name={profileName || user.name} avatarUrl={avatarUrl} size="medium" />
                  <div>
                    <strong>资料头像</strong>
                    <span>静态图片会自动压缩到 20KB 以内。</span>
                  </div>
                  <div className="profile-editor-actions">
                    <label className="ghost-button avatar-upload-button">
                      <Upload size={16} />上传图片
                      <input type="file" accept="image/*" onChange={handleAvatarFile} disabled={profileBusy} />
                    </label>
                    <button className="ghost-button" type="button" onClick={saveProfile} disabled={profileBusy}>{profileBusy ? "保存中" : "保存资料"}</button>
                    <button className="ghost-button danger-ghost" type="button" onClick={removeAvatar} disabled={profileBusy || !avatarUrl}><Trash2 size={16} />删除头像</button>
                  </div>
                </div>
                <label className="field">
                  <span>昵称</span>
                  <input value={profileName} maxLength={40} onChange={(event) => setProfileName(event.target.value)} placeholder="输入你的创作者昵称" />
                </label>
                {profileMessage ? <p className="success-text">{profileMessage}</p> : null}
                {profileError ? <p className="danger-text">{profileError}</p> : null}
              </div>
            ) : null}
          </section>

          <section className="profile-section profile-credit-overview-card">
            <div className="panel-head">
              <div>
                <h2>积分概览</h2>
                <small>可用积分、累计充值和累计消耗。</small>
              </div>
              <button className="ghost-button" type="button" onClick={() => onNavigate("ledger")}>查看明细 →</button>
            </div>
            <div className="profile-credit-balance">
              <strong>{creditBalance.toLocaleString()}</strong>
              <span>积分</span>
            </div>
            <div className="profile-credit-progress" aria-label={`可用积分占比 ${creditPercent}%`}>
              <span style={{ width: `${creditPercent}%` }} />
            </div>
            <div className="profile-credit-metrics">
              <div><b>{(account?.totalRecharge ?? 0).toLocaleString()}</b><span>累计充值</span></div>
              <div><b>{(account?.totalConsume ?? 0).toLocaleString()}</b><span>累计消耗</span></div>
              <div><b>{creditBalance.toLocaleString()}</b><span>当前余额</span></div>
            </div>
            <div className="profile-credit-actions">
              <button className="primary-button" type="button" onClick={() => onNavigate("recharge")}><CreditCard size={18} />立即充值</button>
              <button className="ghost-button" type="button" onClick={() => setActiveTab("ledger")}><ClipboardList size={18} />查看流水</button>
            </div>
          </section>

          <section className="profile-section profile-account-security-card">
            <div className="panel-head">
              <div>
                <h2>账号安全</h2>
                <small>修改邮箱账号和登录密码，关键操作需要校验当前密码。</small>
              </div>
              <button className="ghost-button" type="button" onClick={() => setActiveTab("security")}>
                <ShieldCheck size={16} />查看登录状态
              </button>
            </div>
            <div className="profile-security-grid">
              <div className="profile-security-form">
                <div className="profile-security-form-head">
                  <Mail size={20} />
                  <div>
                    <strong>邮箱账号</strong>
                    <span>当前邮箱：{user.email || "未绑定"}</span>
                  </div>
                </div>
                <label className="field">
                  <span>新邮箱</span>
                  <input
                    type="email"
                    value={emailForm.email}
                    onChange={(event) => setEmailForm((value) => ({ ...value, email: event.target.value }))}
                    autoComplete="email"
                    placeholder="name@example.com"
                  />
                </label>
                <label className="field">
                  <span>当前密码</span>
                  <input
                    type="password"
                    value={emailForm.currentPassword}
                    onChange={(event) => setEmailForm((value) => ({ ...value, currentPassword: event.target.value }))}
                    autoComplete="current-password"
                    placeholder="确认本人操作"
                  />
                </label>
                <button className="primary-button profile-security-submit" onClick={changeEmail} disabled={emailBusy} type="button">
                  <Mail size={18} />{emailBusy ? "保存中" : "保存邮箱"}
                </button>
                {emailMessage ? <p className="success-text">{emailMessage}</p> : null}
                {emailError ? <p className="danger-text">{emailError}</p> : null}
              </div>

              <div className="profile-security-form">
                <div className="profile-security-form-head">
                  <KeyRound size={20} />
                  <div>
                    <strong>修改密码</strong>
                    <span>新密码至少 8 个字符，修改后其他会话会失效。</span>
                  </div>
                </div>
                <div className="profile-security-fields">
                  <label className="field">
                    <span>当前密码</span>
                    <input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, currentPassword: event.target.value }))} autoComplete="current-password" />
                  </label>
                  <label className="field">
                    <span>新密码</span>
                    <input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, newPassword: event.target.value }))} autoComplete="new-password" />
                  </label>
                  <label className="field">
                    <span>确认新密码</span>
                    <input type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, confirmPassword: event.target.value }))} autoComplete="new-password" />
                  </label>
                </div>
                <button className="primary-button profile-security-submit" onClick={changePassword} disabled={passwordBusy} type="button">
                  <KeyRound size={18} />{passwordBusy ? "修改中" : "修改密码"}
                </button>
                {passwordMessage ? <p className="success-text">{passwordMessage}</p> : null}
                {passwordError ? <p className="danger-text">{passwordError}</p> : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "works" ? (
        <section className="profile-section profile-list-panel">
          <div className="panel-head">
            <div>
              <h2>我的作品</h2>
              <small>最近更新的漫剧项目和分镜数量。</small>
            </div>
            <button className="ghost-button" onClick={() => onNavigate("scripts")}>进入作品库</button>
          </div>
          <div className="profile-ledger-list">
            {(summary?.recentProjects ?? []).map((project) => (
              <div className="profile-ledger-row profile-project-row" key={project.id}>
                <div>
                  <strong>{project.name}</strong>
                  <span>{project.artStyle} · {project.videoRatio} · {project.status}</span>
                </div>
                <b>{project.creditsSpent} 积分</b>
              </div>
            ))}
            {!summary?.recentProjects?.length ? <div className="empty-state">暂无作品，先去创建第一集吧。</div> : null}
          </div>
        </section>
      ) : null}

      {activeTab === "orders" ? (
        <section className="profile-section profile-list-panel">
          <div className="panel-head">
            <div>
              <h2>订单记录</h2>
              <small>充值订单、支付状态和发票入口。</small>
            </div>
            <button className="ghost-button" type="button" onClick={() => onNavigate("recharge")}>去充值</button>
          </div>
          <div className="profile-ledger-list">
            {recentOrders.map((order) => (
              <div className="profile-ledger-row profile-order-row" key={order.id}>
                <div>
                  <strong>{order.planName}</strong>
                  <span>{formatCny(order.amountCny)} · {order.credits + order.bonusCredits} 积分 · {formatDate(order.createdAt)}</span>
                </div>
                <b className={`order-${order.status}`}>{orderStatusLabel(order.status)}</b>
              </div>
            ))}
            {!recentOrders.length ? <div className="empty-state">暂无订单。选择一个积分包后会在这里显示。</div> : null}
          </div>
        </section>
      ) : null}

      {activeTab === "ledger" ? (
        <section className="profile-section profile-list-panel">
          <div className="panel-head">
            <div>
              <h2>积分流水</h2>
              <small>最近 5 条记录，完整记录在积分明细页。</small>
            </div>
            <button className="ghost-button" onClick={() => onNavigate("ledger")}>查看全部</button>
          </div>
          <div className="profile-ledger-list">
            {recentTransactions.map((item) => (
              <div className="profile-ledger-row" key={item.id}>
                <div>
                  <strong>{transactionDescriptionText(item.description)}</strong>
                  <span>{transactionTypeLabel(item.type)} · {formatDate(item.createdAt)}</span>
                </div>
                <b className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : ""}{item.amount}</b>
              </div>
            ))}
            {!recentTransactions.length ? <div className="empty-state">暂无积分流水。</div> : null}
          </div>
        </section>
      ) : null}

      {activeTab === "security" ? (
        <section className="profile-section profile-security-panel">
          <div className="panel-head">
            <div>
              <h2>登录日志与安全</h2>
              <small>当前会话、密码更新和基础安全信息。</small>
            </div>
          </div>
          <div className="profile-login-list">
            <div className="profile-ledger-row">
              <div>
                <strong>当前设备登录</strong>
                <span>{formatDate(new Date().toISOString())} · 浏览器会话</span>
              </div>
              <b className="positive">在线</b>
            </div>
          </div>
          <div className="profile-password-grid compact-password-grid">
            <label className="field">
              <span>当前密码</span>
              <input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, currentPassword: event.target.value }))} autoComplete="current-password" />
            </label>
            <label className="field">
              <span>新密码</span>
              <input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, newPassword: event.target.value }))} autoComplete="new-password" />
            </label>
            <label className="field">
              <span>确认新密码</span>
              <input type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, confirmPassword: event.target.value }))} autoComplete="new-password" />
            </label>
            <button className="primary-button profile-password-submit" onClick={changePassword} disabled={passwordBusy} type="button">
              <KeyRound size={18} />{passwordBusy ? "修改中" : "修改密码"}
            </button>
          </div>
          {passwordMessage ? <p className="success-text">{passwordMessage}</p> : null}
          {passwordError ? <p className="danger-text">{passwordError}</p> : null}
        </section>
      ) : null}

      <section className="profile-section profile-shortcut-strip">
        <ProfileShortcut icon={<BookOpen size={20} />} title="继续创作" desc="进入我的作品" onClick={() => onNavigate("scripts")} />
        <ProfileShortcut icon={<CreditCard size={20} />} title="积分充值" desc="查看套餐和消费参考" onClick={() => onNavigate("recharge")} />
        <ProfileShortcut icon={<CircleHelp size={20} />} title="帮助中心" desc="查看操作帮助和工单入口" onClick={() => onNavigate("help")} />
      </section>
    </div>
  );
}

export function SettingsPage() {
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function testModel() {
    setLoading(true);
    try {
      setResult(await api.modelTest());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-title">
        <h1>设置</h1>
        <p>平台配置、模型测试、本地 Docker 演示模式和 ComfyUI 高级模式。</p>
      </div>
      <section className="panel centered-panel">
        <Settings size={32} />
        <div className="admin-grid">
          {["DeepSeek V4 Pro", "通义万相适配器", "ComfyUI base_url", "任务并发"].map((item) => (
            <button key={item}>{item}</button>
          ))}
        </div>
        <button className="primary-button" onClick={testModel} disabled={loading}>
          {loading ? "检测中..." : "测试文本生成模型"}
        </button>
        {result ? (
          <div className="model-result">
            <strong>
              {result.provider} / {result.model}
            </strong>
            <span>{result.mode}</span>
            <p>{result.message}</p>
          </div>
        ) : null}
      </section>
    </div>
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

const helpCategoryOptions: Array<HelpArticle["category"] | "all"> = ["all", "getting_started", "workflow", "billing", "account", "troubleshooting", "community"];

const fallbackHelpArticles: HelpArticle[] = [
  {
    id: "fallback-start",
    title: "我刚注册账号，第一次怎么开始做一集漫剧？",
    summary: "从故事输入到导出成片的推荐路径。",
    content: "推荐流程：\n1. 在首页点击「开始创作」，把故事大纲或小说片段粘贴进去。\n2. 选择画风、画幅和目标集数。\n3. 点击下一步，让 AI 拆出核心剧情、章节、人物。\n4. 进入分镜页检查角色、场景和镜头。\n5. 生成分镜图后，再生成对应镜头视频。\n6. 在导出页补字幕、配音和 BGM，下载成片。",
    category: "getting_started",
    tags: ["新手必读", "创作流程"],
    enabled: true,
    pinned: true,
    sortOrder: 10,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "fallback-billing",
    title: "积分扣费、冻结和退款分别代表什么？",
    summary: "解释积分流水里的常见状态。",
    content: "充值或兑换会增加积分。开始生成任务时可能先冻结预估积分；任务成功后按实际消耗扣费；任务失败或取消时，未消耗的冻结积分会自动退回。你可以在「积分明细」查看每一笔记录。",
    category: "billing",
    tags: ["积分", "账单"],
    enabled: true,
    pinned: false,
    sortOrder: 20,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "fallback-role",
    title: "角色长相不稳定，能换吗？",
    summary: "优先固定角色身份卡和参考图。",
    content: "可以调整，但建议先固定角色身份卡、发型、服装主色和关键配饰。后续分镜尽量引用已确认的角色参考图，不要在单个镜头里重新发明外貌。",
    category: "workflow",
    tags: ["角色一致性", "出图"],
    enabled: true,
    pinned: false,
    sortOrder: 30,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export function HelpPage({ articles = [] }: { articles?: HelpArticle[] }) {
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<HelpArticle["category"] | "all">("all");
  const sourceArticles = articles.length ? articles : fallbackHelpArticles;
  const [openArticleId, setOpenArticleId] = useState(sourceArticles[0]?.id ?? "");
  const [supportMessage, setSupportMessage] = useState("");
  useEffect(() => {
    if (!sourceArticles.some((article) => article.id === openArticleId)) {
      setOpenArticleId(sourceArticles[0]?.id ?? "");
    }
  }, [openArticleId, sourceArticles]);
  const filteredArticles = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return sourceArticles.filter((article) => {
      const matchedCategory = category === "all" || article.category === category;
      const matchedKeyword = !normalizedKeyword || `${article.title} ${article.summary} ${article.content} ${article.tags.join(" ")}`.toLowerCase().includes(normalizedKeyword);
      return matchedCategory && matchedKeyword;
    });
  }, [category, keyword, sourceArticles]);

  function openArticle(article: HelpArticle) {
    setOpenArticleId((current) => (current === article.id ? "" : article.id));
    void api.trackEvent({ eventName: "help_article_open", entityType: "help_article", entityId: article.id, properties: { title: article.title, category: article.category } }).catch(() => undefined);
  }

  function focusCategory(nextCategory: HelpArticle["category"]) {
    setCategory(nextCategory);
    const first = sourceArticles.find((article) => article.category === nextCategory) ?? sourceArticles[0];
    setOpenArticleId(first?.id ?? "");
  }

  return (
    <div className="page-stack help-center-page">
      <div className="page-title row-title">
        <div>
          <h1>帮助中心</h1>
          <p>常见问题、操作教程、客服和工单。</p>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" type="button" onClick={() => setSupportMessage("在线客服已收到请求：请描述你遇到的问题，我们会优先看失败任务和积分流水。")}>
            <Headphones size={18} />
            在线客服
          </button>
          <button className="primary-button" type="button" onClick={() => setSupportMessage("工单草稿已创建：建议附上项目名称、失败任务 ID、截图和你希望达到的效果。")}><Send size={18} />提交工单</button>
        </div>
      </div>
      {supportMessage ? <p className="success-text help-support-message">{supportMessage}</p> : null}
      <div className="help-grid help-action-grid">
        <HelpCard title="10 分钟入门" desc="从零生成第一集" icon={<MonitorPlay size={30} />} onClick={() => focusCategory("getting_started")} />
        <HelpCard title="详细文档" desc="每个功能讲解" icon={<FileText size={30} />} onClick={() => focusCategory("workflow")} />
        <HelpCard title="积分与工单" desc="账单、退款、失败处理" icon={<LifeBuoy size={30} />} onClick={() => focusCategory("billing")} />
      </div>
      <section className="panel help-browser-panel">
        <div className="help-toolbar">
          <label className="help-search">
            <Search size={18} />
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索积分、角色、导出、失败..." />
          </label>
          <div className="help-category-tabs">
            {helpCategoryOptions.map((item) => (
              <button className={category === item ? "active" : undefined} key={item} type="button" onClick={() => setCategory(item)}>
                {item === "all" ? "全部" : helpCategoryLabels[item]}
              </button>
            ))}
          </div>
        </div>
        <div className="help-content-layout">
          <div className="help-article-list">
            {filteredArticles.map((article) => {
              const open = openArticleId === article.id;
              return (
                <article className={open ? "help-article-row open" : "help-article-row"} key={article.id}>
                  <button type="button" onClick={() => openArticle(article)}>
                    <span><ChevronDown size={18} /></span>
                    <div>
                      <strong>{article.title}</strong>
                      <small>{article.summary}</small>
                    </div>
                    <b>{helpCategoryLabels[article.category]}</b>
                  </button>
                  {open ? (
                    <div className="help-article-body">
                      {article.content.split(/\n+/).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                      <div className="help-tag-row">
                        {article.tags.map((tag) => <span key={tag}>{tag}</span>)}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!filteredArticles.length ? <div className="empty-state">没有匹配的帮助内容，换个关键词试试。</div> : null}
          </div>
          <aside className="help-side-panel">
            <strong><Sparkles size={18} />推荐排查顺序</strong>
            <p>先看当前项目任务状态，再核对积分流水；如果是出图或视频失败，带上项目名和失败任务一起提交工单。</p>
            <button className="ghost-button" type="button" onClick={() => setCategory("troubleshooting")}><ListChecks size={18} />查看故障处理</button>
            <button className="ghost-button" type="button" onClick={() => setCategory("billing")}><Coins size={18} />查看积分说明</button>
          </aside>
        </div>
      </section>
    </div>
  );
}

function SimplePage({ title, desc, items, icon }: { title: string; desc: string; items: string[]; icon: ReactNode }) {
  return (
    <div className="page-stack">
      <div className="page-title">
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      <section className="panel centered-panel">
        {icon}
        <div className="admin-grid">
          {items.map((item) => (
            <button key={item}>{item}</button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProfileAvatar({ name, avatarUrl, size }: { name: string; avatarUrl?: string; size: "large" | "medium" }) {
  return (
    <div className={`profile-avatar profile-avatar-${size}`}>
      {avatarUrl ? <img src={avatarUrl} alt={name} /> : <span>{avatarInitials(name)}</span>}
    </div>
  );
}

function ProfileStat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <article className="profile-stat-card">
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function ProfileShortcut({ icon, title, desc, onClick }: { icon: ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button className="profile-shortcut" type="button" onClick={onClick}>
      <div>{icon}</div>
      <span>
        <strong>{title}</strong>
        <small>{desc}</small>
      </span>
      <ChevronRight size={18} />
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function maskContact(value: string) {
  if (!value || value === "未绑定" || value === "未绑定联系方式") return value;
  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return value.replace(/^(\d{3})\d{4}(\d+)/, "$1****$2");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatCny(value: number) {
  return `¥${value.toFixed(2)}`;
}

function orderStatusLabel(value: RechargeOrder["status"]) {
  const labels: Record<RechargeOrder["status"], string> = {
    pending: "待支付",
    paid: "已支付",
    closed: "已关闭",
    refunded: "已退款"
  };
  return labels[value] ?? value;
}

function transactionTypeLabel(value: CreditTransaction["type"]) {
  const labels: Record<CreditTransaction["type"], string> = {
    recharge: "充值入账",
    freeze: "冻结积分",
    consume: "消费扣费",
    refund: "退款退回",
    adjust: "后台调整"
  };
  return labels[value] ?? value;
}

function transactionDescriptionText(value: string) {
  const dictionary: Record<string, string> = {
    "Storyboard generation credits": "分镜生成扣费",
    "Single shot image regeneration credits": "单镜头图片重生成扣费",
    "Character reference image credits": "角色参考图生成扣费",
    "Image generation credits": "图片生成扣费",
    "Video generation credits": "视频生成扣费",
    "Recharge order paid": "充值订单入账",
    "Redeem code": "兑换码入账"
  };
  return dictionary[value] ?? value;
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    admin: "后台管理员",
    creator: "创作者"
  };
  return labels[role] ?? role;
}

function HelpCard({ title, desc, icon, onClick }: { title: string; desc: string; icon: ReactNode; onClick?: () => void }) {
  return (
    <button className="help-card" type="button" onClick={onClick}>
      {icon}
      <strong>{title}</strong>
      <span>{desc}</span>
    </button>
  );
}

function avatarInitials(name: string) {
  const safeName = name.trim() || "用户";
  return safeName.slice(0, 2).toUpperCase();
}

async function compressAvatarFile(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("请上传图片文件。");
  if (file.type === "image/gif") {
    if (file.size > maxAvatarBytes) throw new Error("GIF 头像需要控制在 20KB 以内。");
    return fileToDataUrl(file);
  }

  const sourceUrl = await fileToDataUrl(file);
  const image = await loadImage(sourceUrl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持头像压缩。");

  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
  const outputSizes = [160, 128, 96, 72, 56, 48];

  for (const outputSize of outputSizes) {
    canvas.width = outputSize;
    canvas.height = outputSize;
    ctx.clearRect(0, 0, outputSize, outputSize);
    ctx.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize);

    for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42, 0.32]) {
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      if (blob.size <= maxAvatarBytes) return blobToDataUrl(blob);
    }
  }

  throw new Error("头像压缩后仍超过 20KB，请换一张更简单的图片。");
}

function fileToDataUrl(file: File) {
  return blobToDataUrl(file);
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败。"));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("头像压缩失败。"))), type, quality);
  });
}
