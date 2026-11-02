import { useEffect, useRef, useState } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { api } from "../lib/api";
import { InlineNotice } from "../design-system/ui";

export function PasswordRecovery({ locale, onBusy, onBack }: { locale: "cn" | "en"; onBusy: (busy: boolean) => void; onBack: (message?: string) => void }) {
  const cn = locale === "cn";
  const [email, setEmail] = useState(""), [code, setCode] = useState("");
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), pending = useRef(false);
  const grant = useRef<{ token: string; expiresAt: number } | null>(null);
  const [resendAt, setResendAt] = useState(0), [now, setNow] = useState(Date.now());
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (password || code || pending.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [password, code]);
  async function operate(action: "send" | "reset") {
    if (pending.current || (action === "send" && remaining > 0)) return;
    setMessage(""); setError("");
    const mail = email.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?@qq\.com$/i.test(mail)) {
      setError(cn ? "请输入已验证的 QQ 邮箱。" : "Enter your verified QQ email."); return;
    }
    if (action === "reset" && (!/^\d{6}$/.test(code) || password.length < 8 || password.length > 72 || password !== confirmation)) {
      setError(cn ? "请输入 6 位验证码及 8–72 位新密码，并确保两次密码一致。" : "Enter the 6-digit code and matching passwords of 8–72 characters."); return;
    }
    pending.current = true; setBusy(true); onBusy(true);
    try {
      if (action === "send") {
        const sent = await api.sendRecoveryCode(mail);
        grant.current = null; setCode(""); setNow(Date.now()); setResendAt(Date.now() + sent.resendAfterSeconds * 1000);
        setMessage(cn ? "验证邮件已发送。仅已验证邮箱的普通账号可完成找回，请查看邮件中的 6 位验证码。" : "Verification email sent. Only eligible accounts with a verified email can recover access.");
      } else {
        if (!grant.current || grant.current.expiresAt <= Date.now()) {
          const verified = await api.verifyRecoveryCode(mail, code);
          grant.current = { token: verified.verificationToken, expiresAt: Date.now() + verified.expiresInSeconds * 1000 };
        }
        await api.resetPassword({ email: mail, verificationToken: grant.current.token, newPassword: password });
        onBack(cn ? "密码已重置，全部会话已退出。请使用新密码登录。" : "Password reset. All sessions signed out. Sign in with your new password.");
      }
    } catch (err) { setError(err instanceof Error ? err.message : cn ? "暂时无法完成，请重试。" : "Unable to complete. Please retry."); }
    finally { pending.current = false; setBusy(false); onBusy(false); }
  }
  return <form className="cine-auth-form" onSubmit={event => { event.preventDefault(); void operate("reset"); }} aria-busy={busy}>
    <fieldset className="creator-auth-fields" disabled={busy}>
      <label className="cine-auth-field"><span>{cn ? "已验证的 QQ 邮箱" : "Verified QQ email"}</span>
        <div className="cine-auth-input"><Mail size={18} /><input name="recovery_email" type="email" autoComplete="email" value={email} maxLength={71}
          onChange={event => { setEmail(event.target.value); setCode(""); grant.current = null; }} placeholder="name@qq.com" /></div>
      </label>
      <div className="cine-email-verification">
        <div className="cine-email-heading"><span>{cn ? "邮箱验证 · 10 分钟有效" : "Email code · valid for 10 min"}</span>
          <button type="button" className="cine-email-action" disabled={busy || remaining > 0} onClick={() => void operate("send")}>{remaining > 0 ? `${remaining}s` : cn ? "发送验证码" : "Send code"}</button>
        </div>
        <label className="cine-auth-field"><span className="sr-only">{cn ? "邮箱验证码" : "Email code"}</span>
          <div className="cine-auth-input"><Mail size={18} /><input name="recovery_code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={event => { grant.current = null; setCode(event.target.value.replace(/\D/g, "")); }} placeholder={cn ? "6 位验证码" : "6-digit code"} /></div>
        </label>
      </div>
      <label className="cine-auth-field"><span>{cn ? "新密码" : "New password"}</span><div className="cine-auth-input"><LockKeyhole size={18} />
        <input name="recovery_password" type="password" autoComplete="new-password" minLength={8} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} placeholder={cn ? "8–72 位密码" : "8–72 characters"} /></div></label>
      <label className="cine-auth-field"><span>{cn ? "确认新密码" : "Confirm password"}</span><div className="cine-auth-input"><LockKeyhole size={18} />
        <input name="recovery_confirm" type="password" autoComplete="new-password" maxLength={72} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></div></label>
      <button type="submit" className="cine-submit-button" disabled={busy}>{busy ? cn ? "处理中…" : "Working…" : cn ? "重置密码" : "Reset password"}<ArrowRight size={17} /></button>
      <button type="button" className="cine-email-action" onClick={() => onBack()}>{cn ? "返回登录" : "Back to sign in"}</button>
    </fieldset>
    {message ? <InlineNotice tone="info">{message}</InlineNotice> : null}
    {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    <p className="creator-auth-note">{cn ? "旧账号需先在账户设置验证邮箱；未验证邮箱或管理员账号，请联系平台管理员处理。" : "Legacy accounts must verify email in Profile first. Contact your administrator for unverified or privileged accounts."}</p>
  </form>;
}
