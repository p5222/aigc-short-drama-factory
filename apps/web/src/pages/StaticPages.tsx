import {
  BadgeCheck,
  BookOpen,
  Camera,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Coins,
  CreditCard,
  FileText,
  Film,
  Headphones,
  KeyRound,
  LifeBuoy,
  ListChecks,
  LogOut,
  Mail,
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
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { CreditAccount, CreditTransaction, HelpArticle, RechargeOrder, WorkbenchSummary } from "@aifilm/shared";
import { api, type AuthUser } from "../lib/api";
import type { PageKey } from "../components/Shell";
import { SupportTicketPanel, type SupportTicketIntent } from "../support/SupportTicketPanel";
import { InlineNotice, PageHeader, StatePanel } from "../design-system/ui";
import { BEFORE_CREATOR_NAVIGATION, createRequestEpoch } from "../lib/creatorNavigation";
import "./creator-pages.css";

const maxAvatarBytes = 20 * 1024;

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
  const [editOpen, setEditOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState<"email" | "password" | "">("");
  const [profileName, setProfileName] = useState(user.name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [avatarReading, setAvatarReading] = useState(false);
  const avatarReadEpoch = useRef(createRequestEpoch()).current;
  const [emailForm, setEmailForm] = useState({ email: user.email ?? "", currentPassword: "" });
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const profileDirty = profileName !== user.name || avatarUrl !== (user.avatarUrl ?? "");
  const emailDirty = emailForm.email !== (user.email ?? "") || Boolean(emailForm.currentPassword);
  const passwordDirty = Boolean(passwordForm.currentPassword || passwordForm.newPassword || passwordForm.confirmPassword);
  const pending = profileBusy || emailBusy || passwordBusy;
  const dirty = profileDirty || emailDirty || passwordDirty || avatarReading;

  useEffect(() => {
    const guard = (event: Event) => {
      if (!pending && !dirty) return;
      if (event.type === "beforeunload") { event.preventDefault(); (event as BeforeUnloadEvent).returnValue = ""; }
      else if (pending || !window.confirm("账户设置有未保存的修改。确认放弃并离开？")) event.preventDefault();
    };
    window.addEventListener(BEFORE_CREATOR_NAVIGATION, guard);
    window.addEventListener("beforeunload", guard);
    return () => { window.removeEventListener(BEFORE_CREATOR_NAVIGATION, guard); window.removeEventListener("beforeunload", guard); };
  }, [pending, dirty]);

  useEffect(() => {
    avatarReadEpoch.invalidate();
    setAvatarReading(false);
    setProfileName(user.name);
    setAvatarUrl(user.avatarUrl ?? "");
    setEmailForm({ email: user.email ?? "", currentPassword: "" });
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    return () => avatarReadEpoch.invalidate();
  }, [user.id]);

  async function handleAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || pending) return;

    const token = avatarReadEpoch.begin();
    setAvatarReading(true);
    setProfileError("");
    setProfileMessage("");
    try {
      const nextAvatarUrl = await compressAvatarFile(file);
      if (!avatarReadEpoch.current(token)) return;
      setAvatarUrl(nextAvatarUrl);
      setProfileMessage("头像已处理，点击保存后生效。");
    } catch (err) {
      if (!avatarReadEpoch.current(token)) return;
      setProfileError(err instanceof Error ? err.message : "头像处理失败");
    } finally {
      if (avatarReadEpoch.current(token)) setAvatarReading(false);
    }
  }

  function cancelProfileEdit() {
    avatarReadEpoch.invalidate();
    setAvatarReading(false);
    setProfileName(user.name); setAvatarUrl(user.avatarUrl ?? "");
    setProfileMessage(""); setProfileError(""); setEditOpen(false);
  }

  async function saveProfile() {
    if (pending || avatarReading) return;
    const name = profileName.trim();
    if (!name) {
      setProfileError("昵称不能为空。");
      return;
    }

    setProfileBusy(true);
    setProfileError("");
    setProfileMessage("");
    try {
      const result = await api.updateProfile({ name, avatarUrl: avatarUrl || null });
      onUserUpdate(result.user);
      setProfileName(result.user.name); setAvatarUrl(result.user.avatarUrl ?? "");
      setProfileMessage("资料已更新。");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "资料更新失败");
    } finally {
      setProfileBusy(false);
    }
  }

  async function removeAvatar() {
    if (pending) return;
    avatarReadEpoch.invalidate();
    setAvatarReading(false);
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
    if (pending) return;
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
    if (pending) return;
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

  const creditBalance = account ? account.balance - account.frozenBalance : summary?.credits ?? 0;
  const recentTransactions = transactions.slice(0, 4);
  const recentOrders = orders.slice(0, 3);

  return (
    <div className="page-stack profile-page profile-v2-page creator-page">
      <PageHeader title="我的账户" description="管理资料、安全设置和积分。" actions={
          <button className="ghost-button" type="button" onClick={onLogout}><LogOut size={17} />退出登录</button>
        } />
      {pending || dirty ? <InlineNotice tone="info">{pending ? "正在保存，请等待操作完成。" : avatarReading ? "正在处理头像。处理完成后可以保存，也可以取消本次修改。" : "有未保存的修改。请在对应分组保存，或取消修改。"}</InlineNotice> : null}

      <div className="profile-v2-grid">
        <div className="profile-v2-column">
          <section className="panel profile-v2-card profile-v2-account">
            <div className="panel-head">
              <div>
                <h2>账号信息</h2>
                <small>头像、昵称与绑定的登录方式。</small>
              </div>
              <button className="ghost-button" type="button" aria-expanded={editOpen} disabled={pending} onClick={() => setEditOpen((value) => !value)}>
                <Camera size={16} />{editOpen ? "收起编辑" : "编辑资料"}
              </button>
            </div>
            <div className="profile-v2-identity">
              <ProfileAvatar name={user.name} avatarUrl={user.avatarUrl} size="large" />
              <div>
                <strong>{user.name}</strong>
                <span>{maskContact(contact)}</span>
                <div className="profile-badges">
                  <span><BadgeCheck size={15} />{roleLabel(user.role)}</span>
                  <span><ShieldCheck size={15} />{user.status === "active" ? "账号正常" : "账号停用"}</span>
                </div>
              </div>
            </div>
            {editOpen ? (
              <form className="profile-inline-editor" onSubmit={event => { event.preventDefault(); void saveProfile(); }}><fieldset className="creator-form-fieldset" disabled={pending}>
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
                    <button className="primary-button" type="submit" disabled={pending || avatarReading || !profileDirty}>{profileBusy ? "保存中…" : avatarReading ? "头像处理中…" : "保存资料"}</button>
                    <button className="ghost-button" type="button" disabled={pending} onClick={cancelProfileEdit}>取消修改</button>
                    <button className="ghost-button danger-ghost" type="button" onClick={removeAvatar} disabled={profileBusy || !avatarUrl}><Trash2 size={16} />删除头像</button>
                  </div>
                </div>
                <label className="field">
                  <span>昵称</span>
                  <input value={profileName} maxLength={40} onChange={(event) => setProfileName(event.target.value)} placeholder="输入你的创作者昵称" />
                </label>
                </fieldset>{profileMessage ? <InlineNotice tone={profileDirty ? "info" : "success"}>{profileMessage}</InlineNotice> : null}
                {profileError ? <InlineNotice tone="error">{profileError}</InlineNotice> : null}
              </form>
            ) : null}
            <div className="profile-v2-bindings">
              <div className="profile-v2-binding-row">
                <span className="profile-v2-binding-icon"><UserRound size={17} /></span>
                <div>
                  <strong>手机号</strong>
                  <small>{user.phone ? maskContact(user.phone) : "未绑定手机号"}</small>
                </div>
                <em className={user.phone ? "bound" : ""}>{user.phone ? "已绑定" : "未绑定"}</em>
              </div>
              <div className="profile-v2-binding-row">
                <span className="profile-v2-binding-icon"><Mail size={17} /></span>
                <div>
                  <strong>邮箱</strong>
                  <small>{user.email ? maskContact(user.email) : "未绑定，绑定后可使用邮箱登录"}</small>
                </div>
                <button className="ghost-button" type="button" onClick={() => setSecurityOpen("email")}>{user.email ? "换绑" : "绑定"}</button>
              </div>
              <div className="profile-v2-binding-row">
                <span className="profile-v2-binding-icon"><KeyRound size={17} /></span>
                <div>
                  <strong>登录密码</strong>
                  <small>用于账号登录与敏感操作验证。</small>
                </div>
                <button className="ghost-button" type="button" onClick={() => setSecurityOpen("password")}>修改</button>
              </div>
            </div>
          </section>

          <section className="panel profile-v2-card profile-v2-security">
            <div className="panel-head">
              <div>
                <h2>账号安全</h2>
                <small>修改邮箱或密码都需要校验当前密码；改密码后其他会话会失效。</small>
              </div>
            </div>

            <div className={securityOpen === "email" ? "profile-v2-collapse open" : "profile-v2-collapse"}>
              <button type="button" disabled={pending} aria-expanded={securityOpen === "email"} onClick={() => setSecurityOpen((value) => (value === "email" ? "" : "email"))}>
                <Mail size={17} />
                <span>
                  <strong>修改邮箱账号</strong>
                  <small>当前邮箱：{user.email || "未绑定"}</small>
                </span>
                <ChevronDown size={16} />
              </button>
              {securityOpen === "email" ? (
                <form className="profile-v2-collapse-body" onSubmit={event => { event.preventDefault(); void changeEmail(); }}><fieldset className="creator-form-fieldset" disabled={pending}>
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
                  <div className="inline-actions"><button className="primary-button profile-security-submit" disabled={pending || !emailDirty} type="submit">
                    <Mail size={17} />{emailBusy ? "保存中" : "保存邮箱"}
                  </button>
                  <button type="button" className="ghost-button" onClick={() => { setEmailForm({ email: user.email ?? "", currentPassword: "" }); setEmailError(""); setEmailMessage(""); setSecurityOpen(""); }}>取消修改</button></div></fieldset>
                  {emailMessage ? <InlineNotice tone="success">{emailMessage}</InlineNotice> : null}
                  {emailError ? <InlineNotice tone="error">{emailError}</InlineNotice> : null}
                </form>
              ) : null}
            </div>

            <div className={securityOpen === "password" ? "profile-v2-collapse open" : "profile-v2-collapse"}>
              <button type="button" disabled={pending} aria-expanded={securityOpen === "password"} onClick={() => setSecurityOpen((value) => (value === "password" ? "" : "password"))}>
                <KeyRound size={17} />
                <span>
                  <strong>修改登录密码</strong>
                  <small>新密码至少 8 个字符。</small>
                </span>
                <ChevronDown size={16} />
              </button>
              {securityOpen === "password" ? (
                <form className="profile-v2-collapse-body" onSubmit={event => { event.preventDefault(); void changePassword(); }}><fieldset className="creator-form-fieldset" disabled={pending}>
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
                  <div className="inline-actions"><button className="primary-button profile-security-submit" disabled={pending || !passwordDirty} type="submit">
                    <KeyRound size={17} />{passwordBusy ? "修改中" : "修改密码"}
                  </button>
                  <button type="button" className="ghost-button" onClick={() => { setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" }); setPasswordError(""); setPasswordMessage(""); setSecurityOpen(""); }}>取消修改</button></div></fieldset>
                  {passwordMessage ? <InlineNotice tone="success">{passwordMessage}</InlineNotice> : null}
                  {passwordError ? <InlineNotice tone="error">{passwordError}</InlineNotice> : null}
                </form>
              ) : null}
            </div>
          </section>
        </div>

        <div className="profile-v2-column profile-v2-side">
          <section className="panel profile-v2-card profile-v2-credit">
            <div className="panel-head">
              <div>
                <h2>积分概览</h2>
                <small>积分用于生成与导出；购买价格以充值套餐为准，生成前会显示本次预估消耗。</small>
              </div>
            </div>
            <div className="profile-v2-balance">
              <strong>{creditBalance.toLocaleString()}</strong>
              <span>可用积分</span>
            </div>
            <div className="profile-v2-credit-metrics">
              <div><b>{(account?.totalRecharge ?? 0).toLocaleString()}</b><span>累计充值</span></div>
              <div><b>{(account?.totalConsume ?? 0).toLocaleString()}</b><span>累计消耗</span></div>
              <div><b>{(account?.frozenBalance ?? 0).toLocaleString()}</b><span>冻结中</span></div>
            </div>
            <div className="profile-v2-credit-actions">
              <button className="primary-button" type="button" onClick={() => onNavigate("recharge")}><CreditCard size={17} />立即充值</button>
              <button className="ghost-button" type="button" onClick={() => onNavigate("ledger")}><ClipboardList size={17} />积分明细</button>
            </div>
            <div className="profile-v2-recent">
              <strong>最近动态</strong>
              {recentTransactions.map((item) => (
                <div className="profile-v2-recent-row" key={item.id}>
                  <div>
                    <span>{transactionDescriptionText(item.description)}</span>
                    <small>{transactionTypeLabel(item.type)} · {formatDate(item.createdAt)}</small>
                  </div>
                  <b className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : ""}{item.amount}</b>
                </div>
              ))}
              {recentOrders.map((order) => (
                <div className="profile-v2-recent-row" key={order.id}>
                  <div>
                    <span><ReceiptText size={13} /> {order.planName}</span>
                    <small>{formatCny(order.amountCny)} · {(order.credits + order.bonusCredits).toLocaleString()} 积分 · {formatDate(order.createdAt)}</small>
                  </div>
                  <b className={`order-state order-${order.status}`}>{orderStatusLabel(order.status)}</b>
                </div>
              ))}
              {!recentTransactions.length && !recentOrders.length ? <small className="profile-v2-recent-empty">暂无积分流水与订单记录。</small> : null}
            </div>
          </section>

          <section className="panel profile-v2-card profile-v2-shortcuts">
            <div className="panel-head">
              <div>
                <h2>快捷入口</h2>
                <small>常用功能直达。</small>
              </div>
            </div>
            <div className="profile-v2-shortcut-list">
              <ProfileShortcut icon={<BookOpen size={19} />} title="我的作品" desc={`${summary?.projects ?? 0} 部漫剧 · 继续创作`} onClick={() => onNavigate("scripts")} />
              <ProfileShortcut icon={<Film size={19} />} title="剪辑中心" desc="选择作品，预览并导出成片" onClick={() => onNavigate("studio")} />
              <ProfileShortcut icon={<ClipboardList size={19} />} title="生成队列" desc="查看任务进度与失败原因" onClick={() => onNavigate("tasks")} />
              <ProfileShortcut icon={<CircleHelp size={19} />} title="帮助中心" desc="新手教程 · 积分规则 · 故障排查" onClick={() => onNavigate("help")} />
              <ProfileShortcut icon={<Settings size={19} />} title="设置" desc="显示主题 · 账号安全" onClick={() => onNavigate("settings")} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage({ theme, onThemeChange, onNavigate }: {
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  onNavigate: (page: PageKey) => void;
}) {
  return (
    <div className="page-stack creator-page creator-settings-page">
      <PageHeader title="设置" description="调整显示偏好，管理账号和使用记录。" />
      <section className="panel creator-settings-panel">
        <div className="panel-head"><div><h2>显示主题</h2><small>切换后立即应用；浏览器允许保存时，下次访问会沿用当前选择。</small></div></div>
        <div className="creator-theme-options" role="group" aria-label="显示主题">
          <button type="button" className={theme === "light" ? "primary-button" : "ghost-button"} aria-pressed={theme === "light"} onClick={() => onThemeChange("light")}>浅色模式</button>
          <button type="button" className={theme === "dark" ? "primary-button" : "ghost-button"} aria-pressed={theme === "dark"} onClick={() => onThemeChange("dark")}>深色模式</button>
        </div>
      </section>
      <section className="panel creator-settings-panel">
        <div className="panel-head"><div><h2>账号与使用记录</h2><small>修改资料、处理生成任务或核对积分。</small></div></div>
        <div className="profile-v2-shortcut-list">
          <ProfileShortcut icon={<ShieldCheck size={19} />} title="账号安全" desc="修改资料、邮箱与登录密码" onClick={() => onNavigate("profile")} />
          <ProfileShortcut icon={<ClipboardList size={19} />} title="生成队列" desc="查看当前任务与失败原因" onClick={() => onNavigate("tasks")} />
          <ProfileShortcut icon={<Coins size={19} />} title="积分明细" desc="核对冻结、消耗与退还记录" onClick={() => onNavigate("ledger")} />
          <ProfileShortcut icon={<CircleHelp size={19} />} title="帮助中心" desc="查看制作流程和常见问题" onClick={() => onNavigate("help")} />
        </div>
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
    title: "我刚注册账号，第一次怎么做出一集漫剧？",
    summary: "内容创作五步 + 生产台四阶段的完整路径。",
    content: "先在「内容创作」完成五步：创作意图 → 结构拆解 → 大纲确认 → 正文创作 → 制作交接。\n然后在「我的作品」打开该作品，进入漫剧生产台的四个阶段：内容（剧本定稿）→ 资产（角色三视图与场景）→ 分镜（首帧图与图生视频）→ 成片（剪映式时间线排片段、配音、字幕）。\n最后在成片阶段或「剪辑中心」合成 MP4、生成配音和字幕并下载。",
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
    title: "积分如何冻结、扣费和释放？",
    summary: "先冻结预估额度，再按已交付结果结算；解冻不代表现金退款。",
    content: "积分用于生成与导出，购买价格以充值页面的具体套餐为准。生成前请核对所选模型、范围和预估积分。\n提交任务时先冻结预估积分；结束后按已交付结果结算，释放多余冻结额度。冻结不计入消费，释放不计入充值，也不代表现金退款。已提交供应商但结果尚未确认的任务，需要先核对远端状态，不能把取消当作立即解冻。每一笔都可以在「积分明细」按类型筛选核对。",
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
    title: "角色长相不稳定，镜头之间脸不一致怎么办？",
    summary: "先在资产阶段固定角色三视图，个别镜头可单独重生成。",
    content: "先在生产台「资产」阶段确认角色三视图和身份卡，固定五官、发型、服装主色与配饰；分镜出图会引用已确认的参考图。\n如果只有个别镜头跑偏，在分镜阶段对该镜头单独重新生成即可，只按该镜头计费。",
    category: "workflow",
    tags: ["角色一致性", "出图"],
    enabled: true,
    pinned: false,
    sortOrder: 30,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export function HelpPage({ articles = [], userId }: { articles?: HelpArticle[]; userId: string }) {
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<HelpArticle["category"] | "all">("all");
  const sourceArticles = articles.length ? articles : fallbackHelpArticles;
  const [openArticleId, setOpenArticleId] = useState(sourceArticles[0]?.id ?? "");
  const [supportIntent, setSupportIntent] = useState<SupportTicketIntent>();
  const [helpView, setHelpView] = useState<"articles" | "tickets">("articles");
  useEffect(() => {
    if (openArticleId && !sourceArticles.some((article) => article.id === openArticleId)) {
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
    <div className="page-stack help-center-page creator-page">
      <PageHeader title="帮助中心" description="查操作文档，或把问题提交给支持人员。" actions={<button className="primary-button" type="button" onClick={() => { setHelpView("tickets"); setSupportIntent(current => ({ view: "new", key: (current?.key ?? 0) + 1 })); }}><Send size={18} />提交问题</button>} />
      <nav className="tabs creator-help-tabs" aria-label="帮助中心视图"><button type="button" aria-pressed={helpView === "articles"} className={helpView === "articles" ? "active" : ""} onClick={() => setHelpView("articles")}><FileText size={16} />操作文档</button><button type="button" aria-pressed={helpView === "tickets"} className={helpView === "tickets" ? "active" : ""} onClick={() => { setHelpView("tickets"); setSupportIntent(current => ({ view: "list", key: (current?.key ?? 0) + 1 })); }}><Headphones size={16} />我的工单</button></nav>
      <div className="creator-help-docs" hidden={helpView !== "articles"}>
      <div className="help-grid help-action-grid">
        <HelpCard title="新手入门" desc="了解第一集的制作流程" icon={<MonitorPlay size={30} />} onClick={() => focusCategory("getting_started")} />
        <HelpCard title="详细文档" desc="每个功能讲解" icon={<FileText size={30} />} onClick={() => focusCategory("workflow")} />
        <HelpCard title="积分与工单" desc="账单、积分解冻、失败处理" icon={<LifeBuoy size={30} />} onClick={() => focusCategory("billing")} />
      </div>
      <section className="panel help-browser-panel">
        <div className="help-toolbar">
          <label className="help-search">
            <Search size={18} />
            <input type="search" aria-label="搜索帮助文档" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索积分、角色、导出、失败…" />
          </label>
          <div className="help-category-tabs">
            {helpCategoryOptions.map((item) => (
              <button className={category === item ? "active" : undefined} aria-pressed={category === item} key={item} type="button" onClick={() => setCategory(item)}>
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
                  <button type="button" aria-expanded={open} onClick={() => openArticle(article)}>
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
            {!filteredArticles.length ? <StatePanel compact title="没有找到相关文档" description="可以换个关键词，或向支持人员提交问题。" action={<button type="button" className="ghost-button" onClick={() => { setKeyword(""); setCategory("all"); }}>清空筛选</button>} /> : null}
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
      <div hidden={helpView !== "tickets"}><SupportTicketPanel userId={userId} intent={supportIntent} /></div>
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
    expired: "已过期",
    refunded: "已退款"
  };
  return labels[value] ?? value;
}

function transactionTypeLabel(value: CreditTransaction["type"]) {
  const labels: Record<CreditTransaction["type"], string> = {
    recharge: "充值入账",
    freeze: "冻结积分",
    consume: "消费扣费",
    refund: "释放冻结",
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
