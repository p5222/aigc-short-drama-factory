import {
  ArrowRight,
  Check,
  ChevronDown,
  Eye,
  Globe2,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserPlus,
  UserRound,
  X
} from "lucide-react";
import gsap from "gsap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, type AuthUser } from "../lib/api";
import "./CineHome.css";

interface LoginPageProps {
  onAuthed: (token: string, user: AuthUser) => void;
  variant?: "creator" | "admin";
}

type AuthMode = "login" | "register";
type Locale = "cn" | "en";

interface HomeScene {
  id: string;
  videoUrl: string;
  posterUrl: string;
  eyebrow: string;
  meta: string;
  title: {
    cn: string;
    en: string;
  };
  scanLabel: {
    cn: string;
    en: string;
  };
  activeLabel?: string;
}

const phonePattern = /^1[3-9]\d{9}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const scenes: HomeScene[] = [
  {
    id: "01",
    videoUrl: "/media/cineart-home/desert_fast.mp4",
    posterUrl: "/media/cineart-home/desert_poster.jpg",
    eyebrow: "CINE·CAM 01",
    meta: "SHOT-LEVEL PRECISION",
    title: { cn: "分镜级精准控制", en: "Shot-level precision" },
    scanLabel: { cn: "[ 分镜级精准控制 ]", en: "[ SHOT LOCKED ]" },
    activeLabel: "REC"
  },
  {
    id: "02",
    videoUrl: "/media/cineart-home/photo-w_fast.mp4",
    posterUrl: "/media/cineart-home/photo-w_poster.jpg",
    eyebrow: "CINE·CAM 02",
    meta: "CHARACTER CONSISTENCY",
    title: { cn: "角色跨镜头一致", en: "Character consistency" },
    scanLabel: { cn: "[ 角色一致设定 ]", en: "[ CHARACTER LOCK ]" }
  },
  {
    id: "03",
    videoUrl: "/media/cineart-home/punk-future_fast.mp4",
    posterUrl: "/media/cineart-home/punk-future_poster.jpg",
    eyebrow: "CINE·CAM 03",
    meta: "STYLE, LOCKED",
    title: { cn: "风格一键锁定", en: "Style, locked" },
    scanLabel: { cn: "[ 风格一致设定 ]", en: "[ STYLE LOCKED ]" }
  },
  {
    id: "04",
    videoUrl: "/media/cineart-home/girl-booth_fast.mp4",
    posterUrl: "/media/cineart-home/girl-booth_poster.jpg",
    eyebrow: "CINE·CAM 04",
    meta: "ASSETS THAT COMPOUND",
    title: { cn: "资产沉淀复用", en: "Reusable assets" },
    scanLabel: { cn: "[ 资产沉淀复用 ]", en: "[ ASSET MEMORY ]" }
  },
  {
    id: "05",
    videoUrl: "/media/cineart-home/bicycle-smile_fast.mp4",
    posterUrl: "/media/cineart-home/bicycle-smile_poster.jpg",
    eyebrow: "CINE·CAM 05",
    meta: "QUEUE IT, SHIP IT",
    title: { cn: "极速出片", en: "Queue it, ship it" },
    scanLabel: { cn: "[ 极速生产闭环 ]", en: "[ FAST PIPELINE ]" }
  }
];

const copy = {
  cn: {
    navHome: "首页",
    navProduct: "产品",
    navStudio: "创作现场",
    navEvents: "活动",
    login: "登录",
    register: "注册",
    heroKicker: "BRAND MANIFESTO",
    heroTitle: "灵感即视界",
    heroSubtitle: "让每一次灵感都即时进入镜头",
    start: "开始创作",
    welcome: "欢迎回来",
    createAccount: "创建账号",
    loginIntro: "登录后继续进入 AI 漫剧创作工作台。",
    registerIntro: "注册后即可开始管理作品、积分和生成记录。",
    accountLabel: "手机 / 邮箱 / 用户名",
    accountPlaceholder: "请输入手机号、邮箱或用户名",
    adminAccountPlaceholder: "请输入管理员邮箱",
    password: "密码",
    passwordPlaceholder: "请输入密码",
    captcha: "图形验证码",
    captchaPlaceholder: "请输入图中字符",
    remember: "记住我",
    forgot: "忘记密码?",
    phone: "手机号",
    phonePlaceholder: "请输入手机号",
    email: "邮箱",
    emailPlaceholder: "请输入邮箱地址",
    setPassword: "设置密码",
    setPasswordPlaceholder: "至少 6 位",
    confirmPassword: "再次输入密码",
    confirmPasswordPlaceholder: "请再次输入密码",
    agreement: "我已阅读并同意《用户协议》《隐私政策》《内容合规协议》",
    submitLogin: "登录",
    submitRegister: "立即注册",
    submitAdmin: "登录后台",
    loading: "连接中...",
    noAccount: "还没有账户?",
    hasAccount: "已有账户?",
    registerNow: "立即注册",
    backLogin: "返回登录",
    authNote: "授权视频素材已本地化加载，进入项目后继续使用原有业务逻辑。",
    closeAuth: "关闭登录弹窗",
    adminTitle: "后台管理系统",
    adminIntro: "登录后管理用户、积分、兑换码、模型渠道和计费策略。",
    refreshCaptcha: "点击刷新验证码",
    nextScene: "切换下一个镜头"
  },
  en: {
    navHome: "Home",
    navProduct: "Product",
    navStudio: "Live Studio",
    navEvents: "Events",
    login: "Log in",
    register: "Sign up",
    heroKicker: "BRAND MANIFESTO",
    heroTitle: "Inspiration In Sight",
    heroSubtitle: "Turn every spark into a cinematic frame",
    start: "Start creating",
    welcome: "Welcome back",
    createAccount: "Create account",
    loginIntro: "Log in to continue your AI comic-drama workspace.",
    registerIntro: "Create an account to manage projects, credits and generation history.",
    accountLabel: "Phone / Email / Username",
    accountPlaceholder: "Enter phone, email or username",
    adminAccountPlaceholder: "Enter admin email",
    password: "Password",
    passwordPlaceholder: "Enter password",
    captcha: "Captcha",
    captchaPlaceholder: "Enter the characters",
    remember: "Remember me",
    forgot: "Forgot password?",
    phone: "Phone",
    phonePlaceholder: "Enter phone number",
    email: "Email",
    emailPlaceholder: "Enter email address",
    setPassword: "Set password",
    setPasswordPlaceholder: "At least 6 characters",
    confirmPassword: "Confirm password",
    confirmPasswordPlaceholder: "Enter password again",
    agreement: "I agree to the User Agreement, Privacy Policy and Content Compliance Terms",
    submitLogin: "Log in",
    submitRegister: "Create account",
    submitAdmin: "Admin login",
    loading: "Connecting...",
    noAccount: "No account?",
    hasAccount: "Already have an account?",
    registerNow: "Sign up",
    backLogin: "Back to login",
    authNote: "Authorized video assets load locally. Project logic stays unchanged after sign-in.",
    closeAuth: "Close auth modal",
    adminTitle: "Admin Console",
    adminIntro: "Manage users, credits, redeem codes, model channels and pricing.",
    refreshCaptcha: "Refresh captcha",
    nextScene: "Next scene"
  }
} satisfies Record<Locale, Record<string, string>>;

function createCaptcha() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function stopAndReleaseVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function waitForDrawableFrame(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", finish);
      video.removeEventListener("canplay", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, 360);
    video.addEventListener("loadeddata", finish, { once: true });
    video.addEventListener("canplay", finish, { once: true });
  });
}

function ManagedSceneVideo({ posterUrl, videoUrl }: { posterUrl: string; videoUrl: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;
    video.src = videoUrl;
    video.load();
    void video.play().catch(() => undefined);
    return () => stopAndReleaseVideo(video);
  }, [videoUrl]);

  return (
    <video
      ref={ref}
      className="cine-card-media"
      muted
      loop
      playsInline
      preload="auto"
      poster={posterUrl}
      autoPlay
    />
  );
}

export function LoginPage({ onAuthed, variant = "creator" }: LoginPageProps) {
  const [authOpen, setAuthOpen] = useState(variant === "admin");
  const [mode, setMode] = useState<AuthMode>("login");
  const [locale, setLocale] = useState<Locale>("cn");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [activeScene, setActiveScene] = useState(0);
  const [account, setAccount] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState(() => createCaptcha());
  const [captchaInput, setCaptchaInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const bgRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const warmupVideoRef = useRef<HTMLVideoElement | null>(null);
  const visibleBgSlot = useRef(0);
  const lastBgScene = useRef(0);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeSceneRef = useRef(activeScene);

  const isAdmin = variant === "admin";
  const activeMode = isAdmin ? "login" : mode;
  const t = copy[locale];

  useEffect(() => {
    activeSceneRef.current = activeScene;
  }, [activeScene]);

  useEffect(() => {
    document.body.classList.add("auth-surface");
    return () => document.body.classList.remove("auth-surface");
  }, []);

  useEffect(() => {
    const primary = bgRefs.current[0];
    const secondary = bgRefs.current[1];
    if (!primary) return undefined;

    primary.src = scenes[0].videoUrl;
    primary.load();
    void primary.play().catch(() => undefined);
    gsap.set(primary, { autoAlpha: 1, scale: 1 });
    if (secondary) {
      gsap.set(secondary, { autoAlpha: 0, scale: 1.01 });
      stopAndReleaseVideo(secondary);
    }

    return () => {
      bgRefs.current.forEach((video) => stopAndReleaseVideo(video));
      stopAndReleaseVideo(warmupVideoRef.current);
      warmupVideoRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (lastBgScene.current === activeScene) return;

    const nextScene = scenes[activeScene];
    const fromSlot = visibleBgSlot.current;
    const toSlot = 1 - fromSlot;
    const fromVideo = bgRefs.current[fromSlot];
    const toVideo = bgRefs.current[toSlot];
    if (!toVideo) return;

    let canceled = false;
    gsap.killTweensOf([fromVideo, toVideo].filter(Boolean));
    toVideo.poster = nextScene.posterUrl;
    toVideo.preload = "auto";
    toVideo.src = nextScene.videoUrl;
    toVideo.load();
    void toVideo.play().catch(() => undefined);
    gsap.set(toVideo, { autoAlpha: 0, scale: 1.012 });
    visibleBgSlot.current = toSlot;
    lastBgScene.current = activeScene;

    void waitForDrawableFrame(toVideo).then(() => {
      if (canceled) return;
      gsap.to(toVideo, {
        autoAlpha: 1,
        scale: 1,
        duration: 0.72,
        ease: "power2.out"
      });
      if (fromVideo) {
        gsap.to(fromVideo, {
          autoAlpha: 0,
          duration: 0.72,
          ease: "power2.out",
          onComplete: () => stopAndReleaseVideo(fromVideo)
        });
      }
    });

    return () => {
      canceled = true;
    };
  }, [activeScene]);

  useEffect(() => {
    const warmupIndex = (activeScene + 1) % scenes.length;
    const nextScene = scenes[warmupIndex];
    let video = warmupVideoRef.current;
    if (!video) {
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      warmupVideoRef.current = video;
    }
    video.preload = "metadata";
    video.poster = nextScene.posterUrl;
    video.src = nextScene.videoUrl;
    video.load();

    return () => {
      stopAndReleaseVideo(video);
    };
  }, [activeScene]);

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return undefined;
    const stackElement = stack;

    let targetX = 0;
    let smoothX = 0;
    let frame = 0;
    const cards = cardRefs.current.slice(0, scenes.length).filter(Boolean) as HTMLButtonElement[];
    const setters = cards.map((card) => ({
      x: gsap.quickSetter(card, "x", "px"),
      y: gsap.quickSetter(card, "y", "px"),
      z: gsap.quickSetter(card, "z", "px"),
      rotateY: gsap.quickSetter(card, "rotateY", "deg"),
      rotateZ: gsap.quickSetter(card, "rotateZ", "deg"),
      scale: gsap.quickSetter(card, "scale"),
      opacity: gsap.quickSetter(card, "opacity")
    }));

    gsap.set(cards, {
      force3D: true,
      transformPerspective: 950,
      transformStyle: "preserve-3d"
    });

    function render() {
      smoothX += (targetX - smoothX) * 0.11;
      const active = activeSceneRef.current;
      const center = (scenes.length - 1) / 2;
      setters.forEach((setter, index) => {
        const distance = index - active;
        const depth = Math.abs(distance);
        const fanWeight = index - center;
        const isActive = index === active;
        const x = distance * 42 + smoothX * fanWeight * 34;
        const y = depth * 13 + (isActive ? -18 - Math.abs(smoothX) * 10 : depth * 3);
        const z = isActive ? 98 : -depth * 48;
        const rotateY = smoothX * fanWeight * -7 + distance * -4;
        const rotateZ = distance * 5.8 + smoothX * fanWeight * 4.4;
        const scale = isActive ? 1.06 : Math.max(0.74, 0.96 - depth * 0.07 + Math.max(0, 0.03 - depth * 0.01));
        const opacity = isActive ? 1 : Math.max(0.46, 0.86 - depth * 0.12);
        setter.x(x);
        setter.y(y);
        setter.z(z);
        setter.rotateY(rotateY);
        setter.rotateZ(rotateZ);
        setter.scale(scale);
        setter.opacity(opacity);
        cards[index].style.zIndex = String(isActive ? 40 : 30 - depth);
      });
      frame = window.requestAnimationFrame(render);
    }

    function onPointerMove(event: PointerEvent) {
      const rect = stackElement.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
    }

    function onPointerLeave() {
      targetX = 0;
    }

    stackElement.addEventListener("pointermove", onPointerMove);
    stackElement.addEventListener("pointerleave", onPointerLeave);
    render();

    return () => {
      stackElement.removeEventListener("pointermove", onPointerMove);
      stackElement.removeEventListener("pointerleave", onPointerLeave);
      window.cancelAnimationFrame(frame);
      gsap.killTweensOf(cards);
    };
  }, []);

  const switchMode = useCallback((nextMode: AuthMode) => {
    setMode(nextMode);
    setMessage("");
    setCaptcha(createCaptcha());
    setCaptchaInput("");
  }, []);

  function openAuth(nextMode: AuthMode) {
    switchMode(nextMode);
    setAuthOpen(true);
  }

  function clearMessage() {
    if (message) setMessage("");
  }

  function nextScene() {
    setActiveScene((value) => (value + 1) % scenes.length);
  }

  async function submit() {
    const cleanAccount = account.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanCaptcha = captchaInput.trim().toUpperCase();

    if (activeMode === "login" && !cleanAccount) {
      setMessage(locale === "cn" ? "请输入手机号、邮箱或用户名。" : "Please enter phone, email or username.");
      return;
    }
    if (activeMode === "register" && !phonePattern.test(cleanPhone)) {
      setMessage(locale === "cn" ? "请输入有效的 11 位手机号。" : "Please enter a valid 11-digit phone number.");
      return;
    }
    if (activeMode === "register" && !emailPattern.test(cleanEmail)) {
      setMessage(locale === "cn" ? "请输入有效邮箱，后续可用于账号绑定。" : "Please enter a valid email address.");
      return;
    }
    if (cleanCaptcha !== captcha) {
      setMessage(locale === "cn" ? "图形验证码不正确，请重新输入。" : "Captcha is incorrect. Please try again.");
      return;
    }
    if (password.length < 6) {
      setMessage(locale === "cn" ? "密码至少需要 6 位。" : "Password must be at least 6 characters.");
      return;
    }
    if (activeMode === "register" && password !== confirmPassword) {
      setMessage(locale === "cn" ? "两次输入的密码不一致。" : "Passwords do not match.");
      return;
    }
    if (activeMode === "register" && !agree) {
      setMessage(locale === "cn" ? "请先同意用户协议、隐私政策和内容合规协议。" : "Please agree to the terms first.");
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
        throw new Error(locale === "cn" ? "当前账号没有后台管理权限，请使用管理员账号登录。" : "This account has no admin access.");
      }

      if (remember) localStorage.setItem("aifilm_auth_remember", "1");
      localStorage.setItem("aifilm_auth_token", result.token);
      onAuthed(result.token, result.user);
    } catch (error) {
      setCaptcha(createCaptcha());
      setCaptchaInput("");
      setMessage(error instanceof Error ? error.message : locale === "cn" ? "登录失败，请稍后重试。" : "Login failed. Please try again.");
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
      <label className="cine-auth-field">
        <span>{t.captcha}</span>
        <div className="cine-captcha-row">
          <div className="cine-auth-input">
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
              placeholder={t.captchaPlaceholder}
            />
          </div>
          <button
            className="cine-captcha-image"
            onClick={() => {
              setCaptcha(createCaptcha());
              setCaptchaInput("");
              clearMessage();
            }}
            title={t.refreshCaptcha}
            type="button"
          >
            <span>{captcha}</span>
            <RefreshCw size={14} />
          </button>
        </div>
      </label>
    );
  }

  const authForm = (
    <form className="cine-auth-form" autoComplete="off" onSubmit={handleSubmit}>
      {activeMode === "login" ? (
        <>
          <label className="cine-auth-field">
            <span>{t.accountLabel}</span>
            <div className="cine-auth-input">
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
                placeholder={isAdmin ? t.adminAccountPlaceholder : t.accountPlaceholder}
              />
            </div>
          </label>
          <label className="cine-auth-field">
            <span>{t.password}</span>
            <div className="cine-auth-input">
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
                placeholder={t.passwordPlaceholder}
              />
              <Eye size={16} />
            </div>
          </label>
          {captchaField(isAdmin ? "admin_captcha" : "creator_captcha")}
          <div className="cine-form-options">
            <label>
              <input checked={remember} onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
              <span>{t.remember}</span>
            </label>
            <button
              type="button"
              onClick={() =>
                setMessage(locale === "cn" ? "请联系管理员重置密码，或在个人页绑定邮箱后自助修改。" : "Please contact an administrator or bind email in Profile to reset it.")
              }
            >
              {t.forgot}
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="cine-auth-field">
            <span>{t.phone}</span>
            <div className="cine-auth-input">
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
                placeholder={t.phonePlaceholder}
              />
            </div>
          </label>
          <label className="cine-auth-field">
            <span>{t.email}</span>
            <div className="cine-auth-input">
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
                placeholder={t.emailPlaceholder}
              />
            </div>
          </label>
          {captchaField("register_captcha")}
          <label className="cine-auth-field">
            <span>{t.setPassword}</span>
            <div className="cine-auth-input">
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
                placeholder={t.setPasswordPlaceholder}
              />
            </div>
          </label>
          <label className="cine-auth-field">
            <span>{t.confirmPassword}</span>
            <div className="cine-auth-input">
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
                placeholder={t.confirmPasswordPlaceholder}
              />
            </div>
          </label>
          <label className="cine-agree-row">
            <input checked={agree} onChange={(event) => setAgree(event.target.checked)} type="checkbox" />
            <span>{t.agreement}</span>
          </label>
        </>
      )}

      <button className="cine-submit-button" disabled={loading} type="submit">
        {loading ? t.loading : isAdmin ? t.submitAdmin : activeMode === "login" ? t.submitLogin : t.submitRegister}
        <ArrowRight size={17} />
      </button>
      {message ? <p className="cine-auth-message">{message}</p> : null}
    </form>
  );

  if (isAdmin) {
    return (
      <main className="cine-admin-login-page">
        <section className="cine-admin-login-card">
          <div className="cine-logo-text">
            <span>漫角</span>
            <small>MANJIAO.CLOUD</small>
          </div>
          <h1>{t.adminTitle}</h1>
          <p>{t.adminIntro}</p>
          {authForm}
        </section>
      </main>
    );
  }

  return (
    <main className="cine-home-page relative w-screen h-screen overflow-hidden bg-black text-white">
      <section className="cine-hero relative h-screen w-screen overflow-hidden" aria-label="漫角电影感首页">
        <div className="cine-video-layer absolute inset-0" aria-hidden="true">
          {[0, 1].map((slot) => (
            <video
              className="cine-bg-buffer absolute inset-0 h-full w-full object-cover"
              key={slot}
              muted
              loop
              playsInline
              preload={slot === 0 ? "auto" : "none"}
              ref={(node) => {
                bgRefs.current[slot] = node;
              }}
            />
          ))}
          <div className="cine-radial-glow" />
          <div className="cine-bottom-gradient" />
          <div className="cine-left-gradient" />
        </div>

        <nav className="cine-top-nav" aria-label="首页导航">
          <button className="cine-logo-text nav-logo" type="button" onClick={() => setActiveScene(0)}>
            <span>漫角</span>
            <small>MANJIAO.CLOUD</small>
          </button>
          <div className="cine-nav-links">
            <button className="active" type="button" onClick={() => setActiveScene(0)}>{t.navHome}</button>
            <button type="button" onClick={() => openAuth("login")}>{t.navProduct}</button>
            <button type="button" onClick={() => openAuth("login")}>{t.navStudio}</button>
            <button type="button" onClick={() => openAuth("login")}>{t.navEvents}</button>
          </div>
          <div className="cine-nav-actions">
            <div className="cine-language">
              <button
                className={languageOpen ? "open" : undefined}
                type="button"
                onClick={() => setLanguageOpen((value) => !value)}
              >
                <Globe2 size={15} />
                {locale === "cn" ? "CN" : "EN"}
                <ChevronDown size={14} />
              </button>
              {languageOpen ? (
                <div className="cine-language-menu">
                  <button className={locale === "cn" ? "active" : undefined} type="button" onClick={() => { setLocale("cn"); setLanguageOpen(false); }}>
                    <span />
                    中文
                  </button>
                  <button className={locale === "en" ? "active" : undefined} type="button" onClick={() => { setLocale("en"); setLanguageOpen(false); }}>
                    <span />
                    English
                  </button>
                </div>
              ) : null}
            </div>
            <button className="cine-login-pill" type="button" onClick={() => openAuth("login")}>
              {t.login}
            </button>
          </div>
        </nav>

        <div className="cine-center-copy">
          <p>{t.heroKicker}</p>
          <h1>{t.heroTitle}</h1>
          <span>{t.heroSubtitle}</span>
        </div>

        <div className="cine-card-stack transform-gpu" ref={stackRef} aria-label="CINE CAM 3D 视频卡片堆叠">
          {scenes.map((scene, index) => {
            const isActive = index === activeScene;
            return (
              <button
                className={isActive ? "cine-film-card active will-change-transform transform-gpu" : "cine-film-card will-change-transform transform-gpu"}
                key={scene.id}
                onClick={() => setActiveScene(index)}
                ref={(node) => {
                  cardRefs.current[index] = node;
                }}
                type="button"
              >
                {isActive ? (
                  <ManagedSceneVideo posterUrl={scene.posterUrl} videoUrl={scene.videoUrl} />
                ) : (
                  <img className="cine-card-media" src={scene.posterUrl} alt={scene.title[locale]} draggable={false} />
                )}
                <div className="cine-card-overlay" />
                <div className="cine-card-sheen" />
                <div className="cine-card-corners" />
                <div className="cine-card-head">
                  <span>{scene.eyebrow}</span>
                  {isActive ? <b>{scene.activeLabel ?? "REC"}</b> : null}
                </div>
                <div className="cine-card-body">
                  <p>{scene.meta}</p>
                  <strong>{scene.title[locale]}</strong>
                  {isActive ? <small>00:00:00:00</small> : null}
                </div>
                {isActive ? (
                  <div className="cine-active-scan-ui" aria-hidden="true">
                    <i />
                    <span>{scene.scanLabel[locale]}</span>
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="cine-side-control">
          <span>manjiao</span>
          <button type="button" aria-label={t.nextScene} onClick={nextScene}>
            <ArrowRight size={22} />
          </button>
        </div>

        <button className="cine-mobile-start" type="button" onClick={() => openAuth("login")}>
          <Sparkles size={16} />
          {t.start}
        </button>
      </section>

      {authOpen ? (
        <div className="cine-auth-modal" role="dialog" aria-modal="true" aria-label={activeMode === "login" ? t.login : t.register}>
          <button className="cine-auth-backdrop" type="button" aria-label={t.closeAuth} onClick={() => setAuthOpen(false)} />
          <section className={`cine-auth-card ${activeMode === "register" ? "register-mode" : "login-mode"}`}>
            <button className="cine-auth-close" type="button" aria-label="关闭" onClick={() => setAuthOpen(false)}>
              <X size={18} />
            </button>
            <div className="cine-auth-brand">
              <div className="cine-logo-text">
                <span>漫角</span>
                <small>MANJIAO.CLOUD</small>
              </div>
              <h2>{activeMode === "login" ? t.welcome : t.createAccount}</h2>
              <p>{activeMode === "login" ? t.loginIntro : t.registerIntro}</p>
            </div>
            <div className="cine-auth-tabs">
              <button className={activeMode === "login" ? "active" : undefined} type="button" onClick={() => switchMode("login")}>
                {t.login}
              </button>
              <button className={activeMode === "register" ? "active" : undefined} type="button" onClick={() => switchMode("register")}>
                <UserPlus size={15} />
                {t.register}
              </button>
            </div>
            {authForm}
            <div className="cine-auth-bottom">
              {activeMode === "login" ? (
                <span>
                  {t.noAccount}
                  <button type="button" onClick={() => switchMode("register")}>{t.registerNow}</button>
                </span>
              ) : (
                <span>
                  {t.hasAccount}
                  <button type="button" onClick={() => switchMode("login")}>{t.backLogin}</button>
                </span>
              )}
              <small>
                <Check size={13} />
                {t.authNote}
              </small>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
