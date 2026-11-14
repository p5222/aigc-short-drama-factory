import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, CircleDashed, Loader2, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { platformSettingGroups, type ModelProvider, type PlatformSettingView, type SettingGroup, type SettingValue } from "@aifilm/shared";
import { api, type ConfigurationReadiness } from "../lib/api";
import { InlineNotice } from "../design-system/ui";
import { confirmAdminAction } from "./AdminConfirm";
import { navigateAdminHash } from "./adminNavigation";
import "./configuration.css";

const sourceLabels = { database: "后台配置", environment: "服务器配置", default: "系统默认", empty: "尚未配置" };

export function AdminConfiguration({ providers, onRefresh }: { providers: ModelProvider[]; onRefresh: () => void | Promise<void> }) {
  const [readiness, setReadiness] = useState<ConfigurationReadiness>();
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [group, setGroup] = useState<SettingGroup>("routing");
  const [formBusy, setFormBusy] = useState(false);
  async function check() {
    setChecking(true); setError("");
    try { setReadiness(await api.configurationReadiness()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "配置状态读取失败"); }
    finally { setChecking(false); }
  }
  useEffect(() => { void check(); }, []);
  return <div className="configuration-center">
    <section className="configuration-overview">
      <div className="configuration-heading"><div><span className="configuration-eyebrow">PLATFORM SETUP</span><h2>从接入到创作，一处配置</h2><p>补齐渠道和价格，选择创作默认项，再验证实际生成。</p></div>
        <button className="admin-secondary-btn" disabled={checking} onClick={() => void check()}>{checking ? <Loader2 className="spin-icon" size={16} /> : <RefreshCw size={16} />}检查配置</button></div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {readiness ? <><div className="configuration-readiness">{readiness.items.map(item => <article key={item.id} className={`configuration-check is-${item.state}`}>
        {item.state === "ready" ? <CheckCircle2 size={19} /> : <CircleDashed size={19} />}
        <div><strong>{item.title}<small>{item.state === "ready" ? "配置齐全" : item.state === "paused" ? "已暂停" : "待配置"}</small></strong><p>{item.detail}</p></div>
      </article>)}</div><p className="configuration-footnote">检查于 {new Date(readiness.checkedAt).toLocaleString()} · 以上为配置检查，模型输出、邮件收件和支付到账以实际测试为准。</p></>
        : !error ? <p role="status">正在读取配置状态…</p> : null}
      <div className="configuration-shortcuts"><button onClick={() => navigateAdminHash("模型路由")}>配置模型渠道<ArrowUpRight size={15} /></button><button onClick={() => navigateAdminHash("价格策略")}>核对模型价格<ArrowUpRight size={15} /></button></div>
    </section>
    <section className="admin-shop-handoff" aria-label="小店支付设置"><CircleDashed size={18} /><div><strong>小店购买 · 兑换码入账</strong><span>在充值套餐设置购买链接，在兑换码管理准备发货。微信接口保留，后续可单独开放。</span></div><button type="button" className="admin-secondary-btn compact" onClick={() => navigateAdminHash("套餐会员")}>设置小店套餐<ArrowUpRight size={14} /></button></section>
    <div className="configuration-workspace">
      <nav aria-label="配置分组">{platformSettingGroups.map(spec => <button key={spec.id} disabled={formBusy} aria-current={group === spec.id ? "page" : undefined} className={group === spec.id ? "active" : ""} onClick={async () => {
        if (group === spec.id) return;
        if (document.querySelector('.configuration-form[data-admin-dirty="true"]') && !await confirmAdminAction("当前配置有未保存修改，切换将放弃这些修改。", { title: "切换配置分组", confirmLabel: "放弃并切换" })) return;
        setGroup(spec.id);
      }}><strong>{spec.title}</strong><span>{spec.id === "routing" ? "新作品的初始模型" : spec.id === "email" ? "QQ 邮箱注册与验证码" : "预留接口 · 可后续配置"}</span></button>)}</nav>
      <ConfigurationForm key={group} group={group} providers={providers} onBusy={setFormBusy} onSaved={async () => { await check(); await onRefresh(); }} />
    </div>
  </div>;
}

function ConfigurationForm({ group, providers, onSaved, onBusy }: { group: SettingGroup; providers: ModelProvider[]; onSaved: () => Promise<void>; onBusy: (busy: boolean) => void }) {
  const spec = platformSettingGroups.find(item => item.id === group)!;
  const [view, setView] = useState<PlatformSettingView>();
  const [patch, setPatch] = useState<Record<string, SettingValue | null>>({});
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const dirty = Object.keys(patch).length > 0;
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  async function load() {
    setError(""); setBusy(true);
    try { const data = await api.platformSettings(group); if (mounted.current) { setView(data); setPatch({}); setMessage(""); } }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "读取配置失败"); }
    finally { if (mounted.current) setBusy(false); }
  }
  function edit(key: string, value: SettingValue, secret = false) {
    setMessage("");
    setPatch(current => {
      const next = { ...current };
      if ((secret && value === "") || (!secret && value === view?.values[key])) delete next[key];
      else next[key] = value;
      return next;
    });
  }
  async function save() {
    if (!view || busyRef.current || !dirty) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const data = await api.savePlatformSettings(group, { expectedVersion: view.version, values: patch });
      setView(data); setPatch({}); setMessage("配置已保存，新请求开始使用。");
      try { await onSaved(); } catch { setError("配置已保存，但页面数据刷新失败。请刷新查看，勿重复提交。"); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，草稿已保留"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function testSaved() {
    if (group === "routing" || dirty || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try { const result = await api.testPlatformSettings(group); setMessage(result.message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "测试未通过"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <form className="configuration-form" data-admin-dirty={dirty ? "true" : undefined} onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="configuration-form-head"><div><h3>{spec.title}</h3><p>{spec.description}</p></div>{view ? <small>v{view.version}</small> : null}</div>
    {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
    {!view ? <button type="button" className="admin-secondary-btn" disabled={busy} onClick={() => void load()}>{busy ? "正在读取…" : "重新读取配置"}</button> : <>
      {!view.encryptionReady ? <InlineNotice tone="warning">服务器尚未初始化加密密钥，请先按部署指南配置 PLATFORM_SETTINGS_KEY。启用后即可保存授权码与商户私钥。</InlineNotice> : null}
      <fieldset disabled={busy} className="configuration-fields">
        {spec.fields.map(field => {
          const restoring = patch[field.key] === null;
          const value = patch[field.key] ?? view.values[field.key] ?? "";
          const source = view.sources[field.key];
          const candidates = field.type === "provider" ? providers.filter(item => item.modality === field.modality) : [];
          return <div key={field.key} className={`configuration-field${field.type === "multiline" || field.type === "secret" ? " wide" : ""}`}>
            <label htmlFor={`setting-${field.key}`}><span>{field.label}</span><small>{restoring ? "保存后恢复" : sourceLabels[source]}</small></label>
            {field.type === "boolean" ? <select id={`setting-${field.key}`} value={String(value)} disabled={restoring} onChange={e => edit(field.key, e.target.value === "true")}><option value="true">开启</option><option value="false">关闭</option></select>
              : field.type === "provider" ? <select id={`setting-${field.key}`} value={String(value)} disabled={restoring} onChange={e => edit(field.key, e.target.value)}>
                <option value="">未指定 · 创作者自行选择</option>
                {value && !candidates.some(item => item.id === value) ? <option value={String(value)}>原渠道不可用（{value}）</option> : null}
                {candidates.map(item => <option key={item.id} value={item.id} disabled={!item.enabled || item.connectionSupported === false}>{item.name} · {item.routing?.preferredModel || item.models[0] || "未添加模型"}{!item.enabled ? "（停用）" : item.connectionSupported === false ? "（协议未配置）" : ""}</option>)}
              </select>
              : field.type === "secret" ? <textarea id={`setting-${field.key}`} className="configuration-secret" rows={field.key === "privateKey" ? 4 : 2} autoComplete="off" spellCheck={false} disabled={restoring || !view.encryptionReady} value={String(patch[field.key] ?? "")} placeholder={view.secrets[field.key] ? "已配置；留空保留，输入新值替换" : "尚未配置，请填写"} onChange={e => edit(field.key, e.target.value, true)} />
              : field.type === "multiline" ? <textarea id={`setting-${field.key}`} rows={5} value={String(value)} disabled={restoring} spellCheck={false} onChange={e => edit(field.key, e.target.value)} />
              : <input id={`setting-${field.key}`} type={field.type === "number" ? "number" : "text"} min={field.type === "number" ? 1 : undefined} max={field.type === "number" ? 65535 : undefined} value={String(value)} disabled={restoring} onChange={e => edit(field.key, field.type === "number" && e.target.value ? Number(e.target.value) : e.target.value)} />}
            {field.hint ? <p>{field.hint}</p> : null}
            {field.type === "secret" ? <p><ShieldCheck size={13} />{view.secrets[field.key] ? "服务端已有密钥，不返回原文。" : "保存后加密存储。"}</p> : null}
            {restoring ? <div className="configuration-reset"><span>保存时移除后台覆盖，重新读取服务器配置或系统默认值。</span><button type="button" onClick={() => setPatch(current => { const next = { ...current }; delete next[field.key]; return next; })}>撤销恢复</button></div>
              : source === "database" ? <button type="button" className="configuration-reset-btn" onClick={() => { setMessage(""); setPatch(current => ({ ...current, [field.key]: null })); }}>恢复服务器配置 / 默认值</button> : null}
          </div>;
        })}
      </fieldset>
      <div className="configuration-actions">
        <button className="admin-primary-btn" type="submit" disabled={busy || !dirty}>{busy ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}保存配置</button>
        {group !== "routing" ? <button className="admin-secondary-btn" type="button" disabled={busy || dirty} title={dirty ? "请先保存修改" : "使用服务端已保存的配置"} onClick={() => void testSaved()}>{group === "email" ? "测试 SMTP 认证" : "校验支付配置"}</button> : null}
        <button className="admin-text-btn" type="button" disabled={busy} onClick={async () => {
          if (dirty && !await confirmAdminAction("重新读取会放弃本页未保存修改。", { title: "重新读取配置", confirmLabel: "放弃并读取" })) return;
          void load();
        }}>重新读取{dirty ? "（放弃修改）" : ""}</button>
        {dirty ? <small role="status">有未保存修改</small> : null}
      </div>
    </>}
  </form>;
}
