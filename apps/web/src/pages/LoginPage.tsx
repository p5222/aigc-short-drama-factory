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
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { api, type AuthUser } from "../lib/api";
import "./CineHome.css";

interface LoginPageProps {
  onAuthed: (token: string, user: AuthUser) => void;
  variant?: "creator" | "admin";
}

type AuthMode = "login" | "register";

interface HomeScene {
  id: string;
  video: string;
  eyebrow: string;
  meta: string;
  title: string;
  activeLabel?: string;
}

const phonePattern = /^1[3-9]\d{9}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const scenes: HomeScene[] = [
  {
    id: "01",
    video: "/media/cineart-home/desert_fast.mp4",
    eyebrow: "CINE·CAM 01",
    meta: "SHOT-LEVEL PRECISION",
    title: "分镜级精准控制",
    activeLabel: "REC"
  },
  {
    id: "02",
    video: "/media/cineart-home/photo-w_fast.mp4",
    eyebrow: "CINE·CAM 02",
    meta: "CHARACTER CONSISTENCY",
    title: "角色跨镜头一致"
  },
  {
    id: "03",
    video: "/media/cineart-home/aquarium-boy_fast.mp4",
    eyebrow: "CINE·CAM 03",
    meta: "STYLE, LOCKED",
    title: "风格一键锁定"
  },
  {
    id: "04",
    video: "/media/cineart-home/punk-future_fast.mp4",
    eyebrow: "CINE·CAM 04",
    meta: "ASSETS THAT COMPOUND",
    title: "资产沉淀复用"
  },
  {
    id: "05",
    video: "/media/cineart-home/girl-booth_fast.mp4",
    eyebrow: "CINE·CAM 05",
    meta: "COLLABORATE WITHOUT DRIFT",
    title: "团队高效协作"
  },
  {
    id: "06",
    video: "/media/cineart-home/bicycle-smile_fast.mp4",
    eyebrow: "CINE·CAM 06",
    meta: "QUEUE IT, SHIP IT",
    title: "极速出片"
  },
  {
    id: "07",
    video: "/media/cineart-home/snow-train_fast.mp4",
    eyebrow: "CINE·CAM 07",
    meta: "SEAMLESS TO POST",
    title: "无缝衔接后期"
  }
];

const cardTransforms = [
  { x: 28, y: -8, r: -5, s: 1, z: 8, o: 1 },
  { x: -44, y: 12, r: -13, s: 0.92, z: 6, o: 0.78 },
  { x: -12, y: 24, r: -7, s: 0.9, z: 5, o: 0.74 },
  { x: 18, y: 28, r: -1, s: 0.88, z: 4, o: 0.7 },
  { x: 42, y: 34, r: 6, s: 0.84, z: 3, o: 0.66 },
  { x: 64, y: 40, r: 12, s: 0.8, z: 2, o: 0.62 },
  { x: 86, y: 46, r: 18, s: 0.76, z: 1, o: 0.56 }
];

function createCaptcha() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function LoginPage({ onAuthed, variant = "creator" }: LoginPageProps) {
  const [authOpen, setAuthOpen] = useState(variant === "admin");
  const [mode, setMode] = useState<AuthMode>("login");
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
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const cardVideoRefs = useRef<Array<HTMLVideoElement | null>>([]);

  const isAdmin = variant === "admin";
  const activeMode = isAdmin ? "login" : mode;
  const currentScene = scenes[activeScene];

  useEffect(() => {
    document.body.classList.add("auth-surface");
    return () => document.body.classList.remove("auth-surface");
  }, []);

  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index === activeScene) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    });
    cardVideoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index === activeScene) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    });
  }, [activeScene]);

  const copyright = useMemo(
    () => "CINEART 开启影视创作新纪元 ©2026 北京初合科技有限公司 & Atom Galaxie Limited. 保留所有权利。",
    []
  );

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage("");
    setCaptcha(createCaptcha());
    setCaptchaInput("");
  }

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
      setMessage("请输入手机号、邮箱或用户名。");
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

      if (remember) localStorage.setItem("aifilm_auth_remember", "1");
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
      <label className="cine-auth-field">
        <span>图形验证码</span>
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
              placeholder="请输入图中字符"
            />
          </div>
          <button
            className="cine-captcha-image"
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
      </label>
    );
  }

  const authForm = (
    <form className="cine-auth-form" autoComplete="off" onSubmit={handleSubmit}>
      {activeMode === "login" ? (
        <>
          <label className="cine-auth-field">
            <span>手机 / 邮箱 / 用户名</span>
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
                placeholder={isAdmin ? "请输入管理员邮箱" : "请输入手机号、邮箱或用户名"}
              />
            </div>
          </label>
          <label className="cine-auth-field">
            <span>密码</span>
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
                placeholder="请输入密码"
              />
              <Eye size={16} />
            </div>
          </label>
          {captchaField(isAdmin ? "admin_captcha" : "creator_captcha")}
          <div className="cine-form-options">
            <label>
              <input checked={remember} onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
              <span>记住我</span>
            </label>
            <button type="button" onClick={() => setMessage("请联系管理员重置密码，或在个人页绑定邮箱后自助修改。")}>
              忘记密码?
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="cine-auth-field">
            <span>手机号</span>
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
                placeholder="请输入手机号"
              />
            </div>
          </label>
          <label className="cine-auth-field">
            <span>邮箱</span>
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
                placeholder="请输入邮箱地址"
              />
            </div>
          </label>
          {captchaField("register_captcha")}
          <label className="cine-auth-field">
            <span>设置密码</span>
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
                placeholder="至少 6 位"
              />
            </div>
          </label>
          <label className="cine-auth-field">
            <span>再次输入密码</span>
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
                placeholder="请再次输入密码"
              />
            </div>
          </label>
          <label className="cine-agree-row">
            <input checked={agree} onChange={(event) => setAgree(event.target.checked)} type="checkbox" />
            <span>我已阅读并同意《用户协议》《隐私政策》《内容合规协议》</span>
          </label>
        </>
      )}

      <button className="cine-submit-button" disabled={loading} type="submit">
        {loading ? "连接中..." : isAdmin ? "登录后台" : activeMode === "login" ? "登录" : "立即注册"}
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
          <h1>后台管理系统</h1>
          <p>登录后管理用户、积分、兑换码、模型渠道和计费策略。</p>
          {authForm}
        </section>
      </main>
    );
  }

  return (
    <main className="cine-home-page">
      <section className="cine-hero" aria-label="漫角电影感首页">
        <div className="cine-video-layer" aria-hidden="true">
          {scenes.map((scene, index) => (
            <video
              className={index === activeScene ? "active" : undefined}
              key={scene.id}
              loop
              muted
              playsInline
              preload={index === activeScene ? "auto" : "metadata"}
              ref={(node) => {
                videoRefs.current[index] = node;
              }}
              src={scene.video}
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
            <button className="active" type="button" onClick={() => setActiveScene(0)}>首页</button>
            <button type="button" onClick={() => openAuth("login")}>产品</button>
            <button type="button" onClick={() => openAuth("login")}>创作现场</button>
            <button type="button" onClick={() => openAuth("login")}>活动</button>
          </div>
          <div className="cine-nav-actions">
            <div className="cine-language">
              <button
                className={languageOpen ? "open" : undefined}
                type="button"
                onClick={() => setLanguageOpen((value) => !value)}
              >
                <Globe2 size={15} />
                CN
                <ChevronDown size={14} />
              </button>
              {languageOpen ? (
                <div className="cine-language-menu">
                  <button className="active" type="button" onClick={() => setLanguageOpen(false)}>
                    <span />
                    中文
                  </button>
                  <button type="button" onClick={() => setLanguageOpen(false)}>English</button>
                </div>
              ) : null}
            </div>
            <button className="cine-login-pill" type="button" onClick={() => openAuth("login")}>
              登录
            </button>
          </div>
        </nav>

        <div className="cine-center-copy">
          <p>BRAND MANIFESTO</p>
          <h1>想象即影像</h1>
          <span>让每一帧都值得被看见</span>
        </div>

        <div className="cine-card-stack" aria-label="CINE CAM 胶片能力">
          {scenes.map((scene, index) => {
            const transform = cardTransforms[index];
            const isActive = index === activeScene;
            return (
              <button
                className={isActive ? "cine-film-card active" : "cine-film-card"}
                key={scene.id}
                onClick={() => setActiveScene(index)}
                onFocus={() => setActiveScene(index)}
                onMouseEnter={() => setActiveScene(index)}
                style={{
                  "--card-x": `${transform.x}px`,
                  "--card-y": `${transform.y}px`,
                  "--card-r": `${transform.r}deg`,
                  "--card-s": transform.s,
                  "--card-z": transform.z,
                  "--card-o": transform.o
                } as CSSProperties}
                type="button"
              >
                <video
                  loop
                  muted
                  playsInline
                  preload="metadata"
                  ref={(node) => {
                    cardVideoRefs.current[index] = node;
                  }}
                  src={scene.video}
                />
                <div className="cine-card-overlay" />
                <div className="cine-card-sheen" />
                <div className="cine-card-corners" />
                <div className="cine-card-head">
                  <span>{scene.eyebrow}</span>
                  {isActive ? <b>{scene.activeLabel ?? "REC"}</b> : null}
                </div>
                <div className="cine-card-body">
                  <p>{scene.meta}</p>
                  <strong>{scene.title}</strong>
                  {isActive ? <small>00:00:00:00</small> : null}
                </div>
              </button>
            );
          })}
        </div>

        <div className="cine-side-control">
          <span>{currentScene.eyebrow}</span>
          <button type="button" aria-label="切换下一个镜头" onClick={nextScene}>
            <ArrowRight size={22} />
          </button>
        </div>

        <footer className="cine-footer">
          <p>{copyright}</p>
          <div>
            <span>联系方式：contact@geetvip.com</span>
            <span>备案号：京ICP备2026004507号-4</span>
            <span>京公网安备11010502060856号</span>
          </div>
        </footer>

        <button className="cine-mobile-start" type="button" onClick={() => openAuth("login")}>
          <Sparkles size={16} />
          开始创作
        </button>
      </section>

      {authOpen ? (
        <div className="cine-auth-modal" role="dialog" aria-modal="true" aria-label={activeMode === "login" ? "登录" : "注册"}>
          <button className="cine-auth-backdrop" type="button" aria-label="关闭登录弹窗" onClick={() => setAuthOpen(false)} />
          <section className={`cine-auth-card ${activeMode === "register" ? "register-mode" : "login-mode"}`}>
            <button className="cine-auth-close" type="button" aria-label="关闭" onClick={() => setAuthOpen(false)}>
              <X size={18} />
            </button>
            <div className="cine-auth-brand">
              <div className="cine-logo-text">
                <span>漫角</span>
                <small>MANJIAO.CLOUD</small>
              </div>
              <h2>{activeMode === "login" ? "欢迎回来" : "创建账号"}</h2>
              <p>{activeMode === "login" ? "登录后继续进入 AI 漫剧创作工作台。" : "注册后即可开始管理作品、积分和生成记录。"}</p>
            </div>
            <div className="cine-auth-tabs">
              <button className={activeMode === "login" ? "active" : undefined} type="button" onClick={() => switchMode("login")}>
                登录
              </button>
              <button className={activeMode === "register" ? "active" : undefined} type="button" onClick={() => switchMode("register")}>
                <UserPlus size={15} />
                注册
              </button>
            </div>
            {authForm}
            <div className="cine-auth-bottom">
              {activeMode === "login" ? (
                <span>
                  还没有账户?
                  <button type="button" onClick={() => switchMode("register")}>立即注册</button>
                </span>
              ) : (
                <span>
                  已有账户?
                  <button type="button" onClick={() => switchMode("login")}>返回登录</button>
                </span>
              )}
              <small>
                <Check size={13} />
                授权视频素材已本地化加载，进入项目后继续使用原有业务逻辑。
              </small>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
