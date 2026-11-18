import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserPlus,
  UserRound
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, type AuthUser, type RegistrationPolicy } from "../lib/api";
import { clearAuthToken, storeAuthToken } from "../lib/authStorage";
import { HttpError } from "../lib/httpClient";
import "./CineHome.css";
import type { PublicLocale } from "./PublicShowcase";
import { PublicHome } from "./PublicHome";
import { Dialog, InlineNotice } from "../design-system/ui";
import { StudioWordmark } from "../design-system/StudioIcon";
import { PasswordRecovery } from "./PasswordRecovery";

interface LoginPageProps {
  onAuthed: (token: string, user: AuthUser) => void;
  variant?: "creator" | "admin";
  initialAuthOpen?: boolean;
  sessionMessage?: string;
}

type AuthMode = "login" | "register";
type Locale = PublicLocale;

const phonePattern = /^1[3-9]\d{9}$/;
const emailPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?@qq\.com$/i;

const copy = {
  cn: {
    login: "登录",
    register: "注册",
    createAccount: "创建账号",
    accountLabel: "手机号 / 邮箱",
    accountPlaceholder: "请输入手机号或邮箱",
    adminAccountPlaceholder: "请输入管理员邮箱",
    password: "密码",
    passwordPlaceholder: "请输入密码",
    captcha: "图形验证码",
    captchaPlaceholder: "请输入图中字符",
    remember: "记住我",
    forgot: "忘记密码?",
    phone: "手机号",
    phonePlaceholder: "11位手机号",
    email: "QQ 邮箱",
    emailPlaceholder: "请输入你的 qq.com 邮箱",
    emailCode: "邮箱验证码",
    emailCodePlaceholder: "输入邮件中的 6 位验证码",
    sendCode: "发送验证码",
    sendingCode: "发送中…",
    verifyEmail: "验证邮箱",
    verifyingEmail: "验证中…",
    verifiedEmail: "QQ 邮箱已验证",
    mailUnavailable: "邮箱验证服务暂未开通，请稍后再试或联系平台管理员。已有账号可继续登录。",
    checkingMail: "正在检查邮箱验证服务…",
    retryMail: "重新检查",
    sentCode: "验证码已发送至 QQ 邮箱，10 分钟内有效，请检查收件箱和垃圾邮件。",
    needVerification: "请先完成 QQ 邮箱验证。",
    verificationExpired: "邮箱验证已过期，请重新发送验证码。",
    setPassword: "设置密码",
    setPasswordPlaceholder: "至少 8 位",
    confirmPassword: "再次输入密码",
    confirmPasswordPlaceholder: "请再次输入密码",
    agreement: "我已阅读并同意《用户协议》《隐私政策》《内容合规协议》",
    submitLogin: "登录",
    submitRegister: "立即注册",
    submitAdmin: "登录后台",
    loading: "连接中...",
    adminTitle: "后台管理系统",
    refreshCaptcha: "点击刷新验证码"
  },
  en: {
    login: "Log in",
    register: "Sign up",
    createAccount: "Create account",
    accountLabel: "Phone / Email",
    accountPlaceholder: "Enter phone or email",
    adminAccountPlaceholder: "Enter admin email",
    password: "Password",
    passwordPlaceholder: "Enter password",
    captcha: "Captcha",
    captchaPlaceholder: "Enter the characters",
    remember: "Remember me",
    forgot: "Forgot password?",
    phone: "Phone number",
    phonePlaceholder: "11-digit phone number",
    email: "QQ email",
    emailPlaceholder: "Enter your qq.com email",
    emailCode: "Email verification code",
    emailCodePlaceholder: "6-digit code from your email",
    sendCode: "Send code",
    sendingCode: "Sending…",
    verifyEmail: "Verify email",
    verifyingEmail: "Verifying…",
    verifiedEmail: "QQ email verified",
    mailUnavailable: "Email verification is not available yet. Try later or contact the administrator. Existing accounts can still log in.",
    checkingMail: "Checking email verification…",
    retryMail: "Check again",
    sentCode: "Code sent to your QQ email. Valid for 10 minutes. Check your inbox and spam folder.",
    needVerification: "Please verify your QQ email first.",
    verificationExpired: "Email verification expired. Please send a new code.",
    setPassword: "Set password",
    setPasswordPlaceholder: "At least 8 characters",
    confirmPassword: "Confirm password",
    confirmPasswordPlaceholder: "Enter password again",
    agreement: "I agree to the User Agreement, Privacy Policy and Content Compliance Terms",
    submitLogin: "Log in",
    submitRegister: "Create account",
    submitAdmin: "Admin login",
    loading: "Connecting...",
    adminTitle: "Admin Console",
    refreshCaptcha: "Refresh captcha"
  }
} satisfies Record<Locale, Record<string, string>>;

function createCaptcha() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function LoginPage({ onAuthed, variant = "creator", initialAuthOpen = false, sessionMessage = "" }: LoginPageProps) {
  const [authOpen, setAuthOpen] = useState(variant === "admin" || initialAuthOpen);
  const [mode, setMode] = useState<AuthMode>("login");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [locale, setLocale] = useState<Locale>("cn");
  const [account, setAccount] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [registrationPolicy, setRegistrationPolicy] = useState<RegistrationPolicy | null>(null);
  const [policyFailed, setPolicyFailed] = useState(false);
  const [emailAction, setEmailAction] = useState<"send" | "verify" | null>(null);
  const emailPending = useRef(false);
  const [emailGrant, setEmailGrant] = useState<{ email: string; token: string; expiresAt: number } | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [captcha, setCaptcha] = useState(() => createCaptcha());
  const [captchaInput, setCaptchaInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(sessionMessage);
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");
  const submitPending = useRef(false);

  const isAdmin = variant === "admin";
  const activeMode = isAdmin ? "login" : mode;
  const t = copy[locale];
  const authBusy = loading || emailAction !== null || recoveryBusy;
  const emailVerified = Boolean(emailGrant && emailGrant.email === email.trim().toLowerCase() && emailGrant.expiresAt > now);
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (mode !== "register") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [mode]);
  useEffect(() => {
    if (mode !== "register") return;
    let active = true;
    setPolicyFailed(false);
    void api.registrationPolicy().then(policy => { if (active) setRegistrationPolicy(policy); })
      .catch(() => { if (active) setPolicyFailed(true); });
    return () => { active = false; };
  }, [mode]);
  useEffect(() => {
    document.body.classList.add("auth-surface");
    return () => { document.body.classList.remove("auth-surface"); };
  }, []);

  const switchMode = useCallback((nextMode: AuthMode) => {
    setRecoveryOpen(false);
    setMode(nextMode);
    setMessage("");
    setCaptcha(createCaptcha());
    setCaptchaInput("");
    setEmailGrant(null);
    setEmailCode("");
  }, []);

  function openAuth(nextMode: AuthMode) {
    switchMode(nextMode);
    setAuthOpen(true);
  }

  function clearMessage() {
    if (message) setMessage("");
  }

  async function submit() {
    if (submitPending.current || emailPending.current) return;
    setMessageKind("error");
    const cleanAccount = account.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanCaptcha = captchaInput.trim().toUpperCase();

    if (activeMode === "login" && !cleanAccount) {
      setMessage(locale === "cn" ? "请输入手机号或邮箱。" : "Please enter phone or email.");
      return;
    }
    if (activeMode === "register" && !phonePattern.test(cleanPhone)) {
      setMessage(locale === "cn" ? "请输入11位手机号。" : "Enter an 11-digit phone number.");
      return;
    }
    if (activeMode === "register" && !emailPattern.test(cleanEmail)) {
      setMessage(locale === "cn" ? "请使用 qq.com 邮箱注册。" : "Please use a qq.com email.");
      return;
    }
    if (activeMode === "register" && (!emailGrant || emailGrant.email !== cleanEmail || emailGrant.expiresAt <= Date.now())) {
      setMessage(t.needVerification);
      return;
    }
    if (activeMode === "login" && cleanCaptcha !== captcha) {
      setMessage(locale === "cn" ? "图形验证码不正确，请重新输入。" : "Captcha is incorrect. Please try again.");
      return;
    }
    const minimumPasswordLength = activeMode === "register" ? 8 : 6;
    if (password.length < minimumPasswordLength) {
      setMessage(locale === "cn" ? `密码至少需要 ${minimumPasswordLength} 位。` : `Password must be at least ${minimumPasswordLength} characters.`);
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

    submitPending.current = true;
    setLoading(true);
    setMessage("");
    try {
      const result =
        activeMode === "login"
          ? await api.login({ account: cleanAccount, password })
          : await api.register({ phone: cleanPhone, email: cleanEmail, password, verificationToken: emailGrant!.token });

      if (isAdmin && !["admin", "operator", "finance", "support"].includes(result.user.role)) {
        clearAuthToken();
        throw new Error(locale === "cn" ? "当前账号没有后台管理权限，请使用管理员账号登录。" : "This account has no admin access.");
      }

      storeAuthToken(result.token, remember);
      onAuthed(result.token, result.user);
    } catch (error) {
      setCaptcha(createCaptcha());
      setCaptchaInput("");
      if (activeMode === "register" && error instanceof HttpError && error.status === 400) setEmailGrant(null);
      setMessage(error instanceof Error ? error.message : locale === "cn" ? "登录失败，请稍后重试。" : "Login failed. Please try again.");
    } finally {
      submitPending.current = false;
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  async function emailOperation(action: "send" | "verify") {
    if (emailPending.current || submitPending.current) return;
    const cleanEmail = email.trim().toLowerCase();
    setMessageKind("error");
    if (!emailPattern.test(cleanEmail)) { setMessage(locale === "cn" ? "请使用 qq.com 邮箱注册。" : "Please use a qq.com email."); return; }
    if (action === "verify" && !/^\d{6}$/.test(emailCode.trim())) {
      setMessage(locale === "cn" ? "请输入邮件中的 6 位验证码。" : "Enter the 6-digit code from your email."); return;
    }
    emailPending.current = true;
    setEmailAction(action);
    setMessage("");
    try {
      if (action === "send") {
        const result = await api.sendRegistrationCode(cleanEmail);
        setEmailGrant(null);
        setEmailCode("");
        setNow(Date.now());
        setResendAt(Date.now() + result.resendAfterSeconds * 1000);
        setMessageKind("info");
        setMessage(t.sentCode);
      } else {
        const result = await api.verifyRegistrationCode(cleanEmail, emailCode.trim());
        setNow(Date.now());
        setEmailGrant({ email: cleanEmail, token: result.verificationToken, expiresAt: Date.now() + result.expiresInSeconds * 1000 });
        setMessageKind("info");
        setMessage("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : locale === "cn" ? "邮箱验证失败，请稍后重试。" : "Email verification failed. Please retry.");
    } finally { emailPending.current = false; setEmailAction(null); }
  }

  async function retryMailPolicy() {
    setPolicyFailed(false);
    setRegistrationPolicy(null);
    try { setRegistrationPolicy(await api.registrationPolicy()); }
    catch { setPolicyFailed(true); }
  }

  function captchaField(name: string) {
    return (
      <div className="cine-auth-field">
        <span>{t.captcha}</span>
        <div className="cine-captcha-row">
          <div className="cine-auth-input">
            <ShieldCheck size={18} />
            <input
              autoComplete="off"
              aria-label={t.captcha}
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
            aria-label={t.refreshCaptcha}
            type="button"
          >
            <span>{captcha}</span>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
    );
  }

  const authForm = (
    <form className="cine-auth-form" onSubmit={handleSubmit} aria-busy={authBusy}><fieldset className="creator-auth-fields" disabled={authBusy}>
      {activeMode === "login" ? (
        <>
          <label className="cine-auth-field">
            <span>{t.accountLabel}</span>
            <div className="cine-auth-input">
              <UserRound size={18} />
              <input
                data-autofocus
                autoComplete="username"
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
                autoComplete="current-password"
                data-lpignore="true"
                name={isAdmin ? "admin_password" : "creator_password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearMessage();
                }}
                type={showPassword ? "text" : "password"}
                placeholder={t.passwordPlaceholder}
              />
              <button
                className="cine-password-toggle"
                type="button"
                aria-label={showPassword ? (locale === "cn" ? "隐藏密码" : "Hide password") : (locale === "cn" ? "显示密码" : "Show password")}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
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
              onClick={() => {
                if (!isAdmin) { setRecoveryOpen(true); setMessage(""); return; }
                setMessageKind("info"); setMessage(locale === "cn" ? "管理员账号请由其他有权限的管理员通过后台重置密码。" : "Ask another authorized administrator to reset your administrator password.");
              }}
            >
              {t.forgot}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="cine-register-grid">
          <label className="cine-auth-field">
            <span>{t.phone}</span>
            <div className="cine-auth-input">
              <Smartphone size={18} />
              <input
                autoComplete="off"
                data-lpignore="true"
                inputMode="tel"
                maxLength={11}
                required
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
                type="email"
                inputMode="email"
                maxLength={71}
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailGrant(null);
                  setEmailCode("");
                  clearMessage();
                }}
                placeholder={t.emailPlaceholder}
              />
            </div>
          </label>
          </div>
          <div className="cine-email-verification">
            {registrationPolicy?.mailAvailable ? (
              <>
                <div className="cine-email-heading">
                  <span><ShieldCheck size={16} />{emailVerified ? t.verifiedEmail : t.emailCode}</span>
                  {!emailVerified ? <button type="button" className="cine-email-action" disabled={authBusy || resendSeconds > 0} onClick={() => void emailOperation("send")}>
                    {emailAction === "send" ? t.sendingCode : resendSeconds > 0 ? `${resendSeconds}s` : t.sendCode}
                  </button> : null}
                </div>
                {emailVerified ? <p className="cine-email-success" role="status"><Check size={16} />{locale === "cn" ? "验证完成，请设置密码并注册。" : "Verified. Set your password to create your account."}</p> : (
                  <label className="cine-auth-field">
                    <span className="sr-only">{t.emailCode}</span>
                    <div className="cine-auth-input">
                      <Mail size={18} />
                      <input name="register_email_code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={emailCode}
                        onChange={event => { setEmailCode(event.target.value.replace(/\D/g, "")); clearMessage(); }}
                        placeholder={t.emailCodePlaceholder} />
                      <button type="button" className="cine-email-action" disabled={authBusy || emailCode.length !== 6} onClick={() => void emailOperation("verify")}>
                        {emailAction === "verify" ? t.verifyingEmail : t.verifyEmail}
                      </button>
                    </div>
                    {emailGrant && !emailVerified ? <small>{t.verificationExpired}</small> : null}
                  </label>
                )}
              </>
            ) : (
              <div className="cine-email-policy" role="status">
                <p>{registrationPolicy || policyFailed ? t.mailUnavailable : t.checkingMail}</p>
                {registrationPolicy || policyFailed ? <button className="cine-email-action" type="button" onClick={() => void retryMailPolicy()}>{t.retryMail}</button> : null}
              </div>
            )}
          </div>
          <div className="cine-register-grid">
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
                type={showPassword ? "text" : "password"}
                placeholder={t.setPasswordPlaceholder}
              />
              <button
                className="cine-password-toggle"
                type="button"
                aria-label={showPassword ? (locale === "cn" ? "隐藏密码" : "Hide password") : (locale === "cn" ? "显示密码" : "Show password")}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
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
                type={showConfirmPassword ? "text" : "password"}
                placeholder={t.confirmPasswordPlaceholder}
              />
              <button
                className="cine-password-toggle"
                type="button"
                aria-label={showConfirmPassword ? (locale === "cn" ? "隐藏确认密码" : "Hide confirmation password") : (locale === "cn" ? "显示确认密码" : "Show confirmation password")}
                aria-pressed={showConfirmPassword}
                onClick={() => setShowConfirmPassword((visible) => !visible)}
              >
                {showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          </div>
          <label className="cine-agree-row">
            <input checked={agree} onChange={(event) => setAgree(event.target.checked)} type="checkbox" />
            <span>{t.agreement}</span>
          </label>
        </>
      )}

      <button className="cine-submit-button" disabled={authBusy || (activeMode === "register" && !emailVerified)} type="submit">
        {loading ? t.loading : isAdmin ? t.submitAdmin : activeMode === "login" ? t.submitLogin : t.submitRegister}
        <ArrowRight size={17} />
      </button>
      </fieldset>
      {message ? <InlineNotice tone={messageKind}>{message}</InlineNotice> : null}
    </form>
  );

  if (isAdmin) {
    return (
      <main className="cine-admin-login-page">
        <section className="cine-admin-login-card">
          <div className="cine-logo-text">
            <StudioWordmark height={38} />
          </div>
          <h1>{t.adminTitle}</h1>
          {authForm}
          <a className="cine-admin-back" href="/"><ArrowRight size={14} />返回漫角创作平台</a>
        </section>
      </main>
    );
  }

  return (
    <>
      <PublicHome locale={locale} onLocaleChange={setLocale} onLogin={() => openAuth("login")} authOpen={authOpen} />
      <Dialog open={authOpen} title={recoveryOpen ? locale === "cn" ? "找回密码" : "Recover your account" : activeMode === "login" ? t.login : t.createAccount} busy={authBusy} onClose={() => setAuthOpen(false)} className={`creator-auth-dialog ${activeMode === "register" ? "register-mode" : "login-mode"}`}>
            {!recoveryOpen ? <div className="cine-auth-tabs" role="group" aria-label={locale === "cn" ? "登录或注册" : "Authentication mode"}>
              <button className={activeMode === "login" ? "active" : undefined} aria-pressed={activeMode === "login"} disabled={authBusy} type="button" onClick={() => switchMode("login")}>
                {t.login}
              </button>
              <button className={activeMode === "register" ? "active" : undefined} aria-pressed={activeMode === "register"} disabled={authBusy} type="button" onClick={() => switchMode("register")}>
                <UserPlus size={15} />
                {t.register}
              </button>
            </div> : null}
            {recoveryOpen ? <PasswordRecovery locale={locale} onBusy={setRecoveryBusy} onBack={notice => {
              setRecoveryOpen(false); setRecoveryBusy(false); setPassword(""); setCaptchaInput(""); setCaptcha(createCaptcha());
              setMessageKind("info"); setMessage(notice || "");
            }} /> : authForm}
      </Dialog>
    </>
  );
}
