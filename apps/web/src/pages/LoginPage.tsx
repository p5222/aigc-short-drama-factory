import {
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  UserRound,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { api, type AuthUser } from "../lib/api";

interface LoginPageProps {
  onAuthed: (token: string, user: AuthUser) => void;
  variant?: "creator" | "admin";
}

type AuthMode = "login" | "register";

interface LoginLayoutSettings {
  copyX: number;
  copyY: number;
  titleSize: number;
  copyScale: number;
  badgeGap: number;
  cardX: number;
  cardY: number;
  cardWidth: number;
}

const phonePattern = /^1[3-9]\d{9}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const layoutStorageKey = "aifilm_login_layout_v2";

const defaultLoginLayout: LoginLayoutSettings = {
  copyX: 0,
  copyY: 0,
  titleSize: 88,
  copyScale: 100,
  badgeGap: 34,
  cardX: 0,
  cardY: 0,
  cardWidth: 430
};

const modelBadges = [
  { name: "OpenAI", src: "/logo/openai.png" },
  { name: "Claude", src: "/logo/claude-color.png" },
  { name: "Gemini", src: "/logo/gemini-color.png" },
  { name: "通义千问", src: "/logo/qwen-color.png" },
  { name: "DeepSeek", src: "/logo/deepseek-color.png" }
];

function createCaptcha() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function loadLayoutSettings(): LoginLayoutSettings {
  try {
    const raw = localStorage.getItem(layoutStorageKey);
    return raw ? { ...defaultLoginLayout, ...JSON.parse(raw) } : defaultLoginLayout;
  } catch {
    return defaultLoginLayout;
  }
}

export function LoginPage({ onAuthed, variant = "creator" }: LoginPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [account, setAccount] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState(() => createCaptcha());
  const [captchaInput, setCaptchaInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [layoutSettings, setLayoutSettings] = useState<LoginLayoutSettings>(() => loadLayoutSettings());

  const isAdmin = variant === "admin";
  const activeMode = isAdmin ? "login" : mode;
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const showLayoutTuner = !isAdmin && searchParams.has("layout");

  const layoutStyle = {
    "--login-copy-x": `${layoutSettings.copyX}px`,
    "--login-copy-y": `${layoutSettings.copyY}px`,
    "--login-title-size": `${layoutSettings.titleSize}px`,
    "--login-copy-scale": `${layoutSettings.copyScale / 100}`,
    "--login-badge-gap": `${layoutSettings.badgeGap}px`,
    "--login-card-x": `${layoutSettings.cardX}px`,
    "--login-card-y": `${layoutSettings.cardY}px`,
    "--login-card-width": `${layoutSettings.cardWidth}px`
  } as CSSProperties;

  useEffect(() => {
    document.body.classList.add("auth-surface");
    return () => document.body.classList.remove("auth-surface");
  }, []);

  useEffect(() => {
    localStorage.setItem(layoutStorageKey, JSON.stringify(layoutSettings));
  }, [layoutSettings]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage("");
    setCaptcha(createCaptcha());
    setCaptchaInput("");
  }

  function clearMessage() {
    if (message) setMessage("");
  }

  async function submit() {
    const cleanAccount = account.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanCaptcha = captchaInput.trim().toUpperCase();

    if (activeMode === "login" && !cleanAccount) {
      setMessage("请输入手机号或邮箱。");
      return;
    }
    if (activeMode === "register" && !phonePattern.test(cleanPhone)) {
      setMessage("请输入有效的 11 位手机号。");
      return;
    }
    if (activeMode === "register" && !emailPattern.test(cleanEmail)) {
      setMessage("请输入有效邮箱，后续可用于账号绑定。");
      return;
    }
    if (cleanCaptcha !== captcha) {
      setMessage("图形验证码不正确，请重新输入。");
      return;
    }
    if (password.length < 6) {
      setMessage("密码至少需要 6 位。");
      return;
    }
    if (activeMode === "register" && password !== confirmPassword) {
      setMessage("两次输入的密码不一致。");
      return;
    }
    if (activeMode === "register" && !agree) {
      setMessage("请先同意用户协议、隐私政策和内容合规协议。");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const result =
        activeMode === "login"
          ? await api.login({ account: cleanAccount, password })
          : await api.register({ phone: cleanPhone, email: cleanEmail, password });
      if (isAdmin && !["admin", "operator", "finance", "support"].includes(result.user.role)) {
        localStorage.removeItem("aifilm_auth_token");
        throw new Error("当前账号没有后台管理权限，请使用管理员账号登录。");
      }
      localStorage.setItem("aifilm_auth_token", result.token);
      onAuthed(result.token, result.user);
    } catch (error) {
      setCaptcha(createCaptcha());
      setCaptchaInput("");
      setMessage(error instanceof Error ? error.message : "登录失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function captchaField(name: string) {
    return (
      <label>
        <span>图形验证码</span>
        <div className="captcha-row">
          <div className="auth-input">
            <ShieldCheck size={18} />
            <input
              autoComplete="off"
              data-lpignore="true"
              name={name}
              value={captchaInput}
              onChange={(event) => {
                setCaptchaInput(event.target.value);
                clearMessage();
              }}
              placeholder="请输入图中字母"
            />
          </div>
          <button
            className="captcha-image"
            onClick={() => {
              setCaptcha(createCaptcha());
              setCaptchaInput("");
              clearMessage();
            }}
            title="点击刷新验证码"
            type="button"
          >
            <span>{captcha}</span>
            <RefreshCw size={14} />
          </button>
        </div>
        <small className="auth-hint">点击验证码可刷新，不区分大小写。</small>
      </label>
    );
  }

  const authForm = (
    <form className={isAdmin ? "auth-form admin-auth-form" : "auth-form stream-auth-form"} autoComplete="off" onSubmit={handleSubmit}>
      {activeMode === "login" ? (
        <>
          <label>
            <span>手机号 / 邮箱</span>
            <div className="auth-input">
              <UserRound size={18} />
              <input
                autoComplete="off"
                data-lpignore="true"
                name={isAdmin ? "admin_account" : "creator_account"}
                value={account}
                onChange={(event) => {
                  setAccount(event.target.value);
                  clearMessage();
                }}
                placeholder={isAdmin ? "请输入管理员邮箱" : "请输入手机号或邮箱"}
              />
            </div>
          </label>
          <label>
            <span>密码</span>
            <div className="auth-input">
              <LockKeyhole size={18} />
              <input
                autoComplete="new-password"
                data-lpignore="true"
                name={isAdmin ? "admin_password" : "creator_password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearMessage();
                }}
                type="password"
                placeholder="请输入 6 位以上密码"
              />
            </div>
          </label>
          {captchaField(isAdmin ? "admin_captcha" : "creator_captcha")}
        </>
      ) : (
        <>
          <label>
            <span>手机号</span>
            <div className="auth-input">
              <Smartphone size={18} />
              <input
                autoComplete="off"
                data-lpignore="true"
                inputMode="tel"
                name="register_phone"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  clearMessage();
                }}
                placeholder="请输入手机号"
              />
            </div>
          </label>
          <label>
            <span>邮箱</span>
            <div className="auth-input">
              <Mail size={18} />
              <input
                autoComplete="off"
                data-lpignore="true"
                name="register_email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearMessage();
                }}
                placeholder="请输入邮箱地址"
              />
            </div>
          </label>
          {captchaField("register_captcha")}
          <label>
            <span>设置密码</span>
            <div className="auth-input">
              <LockKeyhole size={18} />
              <input
                autoComplete="new-password"
                data-lpignore="true"
                name="register_password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearMessage();
                }}
                type="password"
                placeholder="至少 6 位"
              />
            </div>
          </label>
          <label>
            <span>再次输入密码</span>
            <div className="auth-input">
              <LockKeyhole size={18} />
              <input
                autoComplete="new-password"
                data-lpignore="true"
                name="register_confirm_password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  clearMessage();
                }}
                type="password"
                placeholder="请再次输入密码"
              />
            </div>
          </label>
          <label className="agree-row">
            <input checked={agree} onChange={(event) => setAgree(event.target.checked)} type="checkbox" />
            <span>我已阅读并同意《用户协议》《隐私政策》《内容合规协议》</span>
          </label>
        </>
      )}

      <button className="submit-button" disabled={loading} type="submit">
        {loading ? "连接中..." : isAdmin ? "进入后台" : activeMode === "login" ? "立即登录" : "免费注册"}
      </button>
      {message ? <p className="auth-message">{message}</p> : null}
    </form>
  );

  if (isAdmin) {
    return (
      <main className="admin-login-simple-page">
        <section className="admin-login-simple-card">
          <div className="admin-login-header">
            <h1>后台管理系统</h1>
            <p>登录后管理用户、积分、兑换码、模型渠道和计费策略。</p>
          </div>
          {authForm}
          <small className="admin-login-demo">默认管理员：admin@aifilm.local / admin123456</small>
        </section>
      </main>
    );
  }

  return (
    <main className="pc-login-page">
      <section className="login-hero-stage" style={layoutStyle}>
        <div className="login-video-scene" aria-hidden="true">
          <video className="login-bg-video" src="/media/cinematic-login-bg.mp4" autoPlay muted loop playsInline />
        </div>

        <div className="login-shell">
          <header className="login-nav">
            <div className="login-brand">
              <div className="login-mark">AI</div>
              <div>
                <h1>漫角</h1>
                <p>AI 漫剧创作云</p>
              </div>
            </div>
          </header>

          <div className="login-main-grid">
            <div className="login-copy">
              <span className="new-pill">NEW</span>
              <h2>AI 漫角创作云</h2>
              <div className="meta-row">
                <span>小说改编</span>
                <span>分镜生成</span>
                <span>成片合成</span>
              </div>
              <p>从故事到漫画视频，一站完成创意落地。</p>
              <small>剧本、角色、镜头、配音字幕与成片统一完成，让作品更快进入发布状态。</small>
              <div className="powered-title">POWERED BY · 已接入主流 AI 大模型</div>
              <div className="model-logos" aria-label="模型能力">
                {modelBadges.map((item) => (
                  <span className="model-logo-chip" key={item.name}>
                    <span className="model-logo-disc">
                      <img src={item.src} alt={item.name} />
                    </span>
                    <b>{item.name}</b>
                  </span>
                ))}
              </div>
            </div>

            <aside className="login-card" aria-label="登录注册">
              <div className="login-card-head">
                <div>
                  <strong>{activeMode === "login" ? "登录创作平台" : "注册创作账号"}</strong>
                  <span>继续管理你的作品、积分与生成记录</span>
                </div>
                <WandSparkles size={24} />
              </div>

              <div className="auth-tabs">
                <button className={activeMode === "login" ? "active" : ""} onClick={() => switchMode("login")} type="button">
                  登录
                </button>
                <button className={activeMode === "register" ? "active" : ""} onClick={() => switchMode("register")} type="button">
                  免费注册
                </button>
              </div>
              {authForm}
            </aside>
          </div>
        </div>

        {showLayoutTuner ? (
          <LayoutTuner settings={layoutSettings} onChange={setLayoutSettings} />
        ) : null}
      </section>
    </main>
  );
}

function LayoutTuner({
  settings,
  onChange
}: {
  settings: LoginLayoutSettings;
  onChange: (settings: LoginLayoutSettings) => void;
}) {
  const fields: Array<{ key: keyof LoginLayoutSettings; label: string; min: number; max: number; step?: number }> = [
    { key: "copyX", label: "文案 X", min: -80, max: 420 },
    { key: "copyY", label: "文案 Y", min: -120, max: 160 },
    { key: "titleSize", label: "标题字号", min: 44, max: 110 },
    { key: "copyScale", label: "整体缩放", min: 80, max: 130 },
    { key: "badgeGap", label: "模型间距", min: 6, max: 48 },
    { key: "cardX", label: "登录框 X", min: -220, max: 180 },
    { key: "cardY", label: "登录框 Y", min: -140, max: 160 },
    { key: "cardWidth", label: "登录框宽", min: 360, max: 560, step: 5 }
  ];

  function update(key: keyof LoginLayoutSettings, value: number) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <aside className="login-layout-tuner">
      <div className="layout-tuner-head">
        <SlidersHorizontal size={17} />
        <strong>首页像素调节</strong>
      </div>
      {fields.map((field) => (
        <label key={field.key}>
          <span>{field.label}</span>
          <input
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            type="range"
            value={settings[field.key]}
            onChange={(event) => update(field.key, Number(event.target.value))}
          />
          <input
            type="number"
            value={settings[field.key]}
            onChange={(event) => update(field.key, Number(event.target.value))}
          />
        </label>
      ))}
      <div className="layout-tuner-actions">
        <button type="button" onClick={() => onChange(defaultLoginLayout)}>
          重置
        </button>
      </div>
      <small>打开 /?layout=1 可继续调整，数值会保存在当前浏览器。</small>
    </aside>
  );
}
