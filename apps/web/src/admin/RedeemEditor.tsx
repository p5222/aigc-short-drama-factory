import { useId, useRef, useState } from "react";
import { Gift, Ticket, UsersRound } from "lucide-react";
import type { RedeemBatchInput, RedeemCode } from "@aifilm/shared";
import { api } from "../lib/api";
import { HttpError } from "../lib/httpClient";
import { InlineNotice } from "../design-system/ui";
import { AdminDialog, AdminDialogActions } from "./AdminDialog";
import { confirmAdminAction } from "./AdminConfirm";
import { redeemDateInput, redeemDateIso, redeemError, redeemNumber, redeemTime } from "./redeemModel";

type CreateDraft = { name: string; prefix: string; credits: string; count: string; maxRedemptions: string; startsAt: string; endsAt: string; enabled: boolean; permanent: boolean };
type Attempt = { fingerprint: string; requestId: string; draft: CreateDraft };
function initialDraft(): CreateDraft {
  return { name: "新用户体验", prefix: "TRIAL", credits: "300", count: "20", maxRedemptions: "1", startsAt: "", endsAt: redeemDateInput(new Date(Date.now() + 30 * 86400000).toISOString()), enabled: true, permanent: false };
}
function savedAttempt(key: string): Attempt | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (value && typeof value.requestId === "string" && typeof value.fingerprint === "string" && value.draft && typeof value.draft.name === "string" && typeof value.draft.endsAt === "string") return value;
  } catch { /* Session storage is optional; the in-memory attempt still protects retries. */ }
}

export function RedeemCreator({ userId, onClose, onCreated }: { userId: string; onClose: () => void; onCreated: (codes: RedeemCode[]) => void }) {
  const storageKey = `manjiao-redeem-attempt:${userId}`;
  const [previous] = useState(() => savedAttempt(storageKey)), [initial] = useState(initialDraft);
  const [draft, setDraft] = useState<CreateDraft>(() => previous?.draft ?? initial);
  const attempt = useRef<Attempt | undefined>(previous), gate = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const formId = useId();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const datesValid = (!draft.startsAt || Number.isFinite(Date.parse(draft.startsAt))) && (draft.permanent || (Number.isFinite(Date.parse(draft.endsAt)) && Date.parse(draft.endsAt) > Math.max(Date.now(), draft.startsAt ? Date.parse(draft.startsAt) : 0)));
  const numbersValid = [[draft.credits, 1000000], [draft.count, 1000], [draft.maxRedemptions, 10000]].every(([value, max]) => Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= Number(max));
  const valid = numbersValid && datesValid && !!draft.name.trim() && /^[A-Z0-9]{1,16}$/.test(draft.prefix.trim());
  async function submit() {
    if (gate.current || !valid) return;
    gate.current = true; setBusy(true); setError("");
    try {
      const input: Omit<RedeemBatchInput, "requestId"> = { name: draft.name.trim(), prefix: draft.prefix.trim(), credits: Number(draft.credits), count: Number(draft.count), maxRedemptions: Number(draft.maxRedemptions), enabled: draft.enabled, startsAt: redeemDateIso(draft.startsAt), endsAt: draft.permanent ? null : redeemDateIso(draft.endsAt) };
      const fingerprint = JSON.stringify(input);
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID(), draft };
      try { sessionStorage.setItem(storageKey, JSON.stringify(attempt.current)); } catch { /* Optional persistence. */ }
      const codes = await api.createRedeemCodeBatch({ ...input, requestId: attempt.current.requestId });
      if (!Array.isArray(codes) || !codes.length || !codes[0].batchId) throw new Error("生成结果暂时无法确认，请保持原表单重试核对。");
      attempt.current = undefined;
      try { sessionStorage.removeItem(storageKey); } catch { /* Optional persistence. */ }
      onCreated(codes);
    } catch (reason) { setError(redeemError(reason)); }
    finally { gate.current = false; setBusy(false); }
  }
  return <AdminDialog open title="生成兑换码" description="先确定发放方式与额度，再设置有效期。每个账号对同一码只能兑换一次。" onClose={onClose} busy={busy} wide>
    <form id={formId} className="redeem-editor" data-admin-dirty={dirty || undefined} onSubmit={event => { event.preventDefault(); void submit(); }}>
      {error ? <InlineNotice tone="error">{error}<br />保持原表单重试将核对同一批生成请求，不会重复创建。</InlineNotice> : null}
      {previous && !error ? <p className="redeem-note">已恢复本账号在此标签页尚未确认的生成表单，可按原内容重试核对。</p> : null}
      <fieldset className="redeem-fieldset" disabled={busy}>
        <div className="redeem-presets" role="group" aria-label="发放方式">
          <button type="button" aria-pressed={draft.maxRedemptions === "1"} onClick={() => setDraft(value => ({ ...value, count: "20", maxRedemptions: "1" }))}><Ticket size={20} /><span><strong>一人一码</strong><small>独立发放，每码使用一次</small></span></button>
          <button type="button" aria-pressed={Number(draft.maxRedemptions) > 1} onClick={() => setDraft(value => ({ ...value, count: "1", maxRedemptions: "100" }))}><UsersRound size={20} /><span><strong>多人共享</strong><small>同一码供多个不同账号使用</small></span></button>
        </div>
        <div className="redeem-form-grid">
          <label className="redeem-full"><span>活动名</span><input required maxLength={100} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：11 月创作体验" /></label>
          <label><span>每次到账积分</span><input type="number" required min={1} max={1000000} step={1} value={draft.credits} onChange={event => setDraft({ ...draft, credits: event.target.value })} /></label>
          <label><span>生成份数</span><input type="number" required min={1} max={1000} step={1} value={draft.count} onChange={event => setDraft({ ...draft, count: event.target.value })} /></label>
          <label><span>每码总次数</span><input aria-label="每码总次数" aria-describedby={`${formId}-limit`} type="number" required min={1} max={10000} step={1} value={draft.maxRedemptions} onChange={event => setDraft({ ...draft, maxRedemptions: event.target.value })} /><small id={`${formId}-limit`}>同一账号限兑一次，已兑换后不能重复领取。</small></label>
          <label><span>结束时间</span><input aria-label="结束时间" aria-describedby={`${formId}-end`} type="datetime-local" required={!draft.permanent} disabled={draft.permanent} value={draft.endsAt} onChange={event => setDraft({ ...draft, endsAt: event.target.value })} /><small id={`${formId}-end`}>默认 30 天，使用本地时间。</small></label>
          <label className="redeem-check redeem-full"><input type="checkbox" checked={draft.permanent} onChange={event => setDraft({ ...draft, permanent: event.target.checked })} /><span>长期有效，不设置到期时间</span></label>
        </div>
        <details className="redeem-advanced"><summary>更多设置 · 前缀、开始时间与初始状态</summary><div className="redeem-form-grid">
          <label><span>前缀</span><input aria-label="前缀" required pattern="[A-Z0-9]{1,16}" maxLength={16} value={draft.prefix} onChange={event => setDraft({ ...draft, prefix: event.target.value.toUpperCase() })} /><small>1–16 位大写字母或数字</small></label>
          <label><span>生成后单码状态</span><select aria-label="生成后单码状态" value={draft.enabled ? "enabled" : "disabled"} onChange={event => setDraft({ ...draft, enabled: event.target.value === "enabled" })}><option value="enabled">启用 · 按有效期开放</option><option value="disabled">停用 · 后续选择需要的码启用</option></select></label>
          <label className="redeem-full"><span>开始时间</span><input aria-label="开始时间" type="datetime-local" value={draft.startsAt} onChange={event => setDraft({ ...draft, startsAt: event.target.value })} /><small>留空立即开始。到达结束时间后停止兑换。</small></label>
        </div></details>
        <div className="redeem-create-preview"><div><span>本批次最大可兑积分</span><strong>{redeemNumber(Number(draft.credits) * Number(draft.count) * Number(draft.maxRedemptions) || 0)}</strong></div><p>{draft.count || 0} 份 × 每码 {draft.maxRedemptions || 0} 次 × 每次 {draft.credits || 0} 积分<br />{draft.permanent ? "长期有效" : draft.endsAt ? `${redeemTime(draft.endsAt)} 截止` : "请设置有效期"} · {draft.enabled ? "生成后按有效期开兑" : "生成后单码停用，需手动启用"}</p></div>
        {!datesValid ? <InlineNotice tone="error">结束时间须晚于当前时间及开始时间，或明确选择长期有效。</InlineNotice> : null}
      </fieldset>
      <AdminDialogActions><button className="admin-primary-btn" type="submit" form={formId} disabled={busy || !valid}><Gift size={17} />{busy ? "正在生成…" : "生成"}</button></AdminDialogActions>
    </form>
  </AdminDialog>;
}

const editDraft = (code: RedeemCode) => ({ code: code.code, name: code.name, credits: String(code.credits), maxRedemptions: String(code.maxRedemptions), enabled: code.enabled, startsAt: redeemDateInput(code.startsAt), endsAt: redeemDateInput(code.endsAt) });
export function RedeemEditor({ code, onClose, onSaved }: { code: RedeemCode; onClose: () => void; onSaved: () => void }) {
  const [snapshot, setSnapshot] = useState(code), [draft, setDraft] = useState(() => editDraft(code));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [latest, setLatest] = useState<RedeemCode>();
  const gate = useRef(false), formId = useId();
  const initial = editDraft(snapshot), dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const valid = !!draft.name.trim() && !!draft.code.trim() && Number.isSafeInteger(Number(draft.credits)) && Number(draft.credits) >= 1 && Number(draft.credits) <= 1000000 && Number.isSafeInteger(Number(draft.maxRedemptions)) && Number(draft.maxRedemptions) >= Math.max(1, snapshot.usedCount) && Number(draft.maxRedemptions) <= 10000 && (!draft.startsAt || !draft.endsAt || Date.parse(draft.endsAt) > Date.parse(draft.startsAt));
  async function loadLatest() {
    if (gate.current) return;
    gate.current = true; setBusy(true);
    try {
      const result = await api.adminRedeemCodePage({ codeId: snapshot.id });
      const saved = result.items.find(item => item.id === snapshot.id);
      if (!saved) throw new Error("未找到最新记录，请关闭后刷新列表核对；当前草稿仍保留。");
      setLatest(saved);
    } catch (reason) { setError(redeemError(reason)); }
    finally { gate.current = false; setBusy(false); }
  }
  async function save(disableOnly = false) {
    if (gate.current || conflict || !snapshot.updatedAt || (!disableOnly && !valid)) return;
    gate.current = true;
    try {
      if (disableOnly && !await confirmAdminAction(`停用「${snapshot.name}」兑换码？已到账积分与记录保留。${dirty ? "本表单其他修改将放弃。" : ""}`, { title: "停用兑换码", confirmLabel: "停用兑换码" })) return;
      setBusy(true); setError("");
      await api.updateRedeemCode(snapshot.id, disableOnly ? { enabled: false, expectedUpdatedAt: snapshot.updatedAt } : {
        code: draft.code, name: draft.name.trim(), credits: Number(draft.credits), maxRedemptions: Number(draft.maxRedemptions), enabled: draft.enabled,
        startsAt: draft.startsAt === initial.startsAt ? snapshot.startsAt ?? null : redeemDateIso(draft.startsAt),
        endsAt: draft.endsAt === initial.endsAt ? snapshot.endsAt ?? null : redeemDateIso(draft.endsAt), expectedUpdatedAt: snapshot.updatedAt
      });
      onSaved();
    } catch (reason) { setError(redeemError(reason)); if (reason instanceof HttpError && reason.status === 409) setConflict(true); }
    finally { gate.current = false; setBusy(false); }
  }
  return <AdminDialog open title="编辑兑换码" description="保存后更新配置。已产生兑换的码值和积分锁定，历史到账记录保留。" onClose={onClose} busy={busy} wide>
    <form id={formId} className="redeem-editor" data-admin-dirty={dirty || undefined} onSubmit={event => { event.preventDefault(); void save(); }}>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {!snapshot.updatedAt ? <InlineNotice tone="error">此记录缺少版本信息，请刷新列表后再编辑。</InlineNotice> : null}
      {conflict ? <div className="redeem-conflict" role="status"><strong>记录已变化，当前草稿已保留。</strong><p>先核对最新配置，避免覆盖其他管理员的修改或刚发生的兑换。</p>
        <button type="button" className="admin-secondary-btn" disabled={busy} onClick={() => void loadLatest()}>读取最新配置</button>
        {latest ? <><p>最新保存于 {redeemTime(latest.updatedAt!)}<br />{latest.name} · 每次 {redeemNumber(latest.credits)} 积分 · 已用 {latest.usedCount} / {latest.maxRedemptions} 次 · {latest.enabled ? "单码启用" : "单码停用"}</p>
          <button type="button" className="admin-text-btn primary" disabled={busy} onClick={async () => { if (await confirmAdminAction("载入最新配置会替换当前草稿。请先记下需要保留的修改。", { title: "替换当前草稿？", confirmLabel: "载入最新配置", danger: false })) { setSnapshot(latest); setDraft(editDraft(latest)); setLatest(undefined); setConflict(false); setError(""); } }}>载入最新并重填</button></> : null}
      </div> : null}
      <fieldset className="redeem-fieldset" disabled={busy}>
        <div className="redeem-form-grid">
          <label className="redeem-full"><span>兑换码</span><input required maxLength={64} disabled={snapshot.usedCount > 0} value={draft.code} onChange={event => setDraft({ ...draft, code: event.target.value.toUpperCase() })} /></label>
          <label className="redeem-full"><span>活动名称</span><input required maxLength={100} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
          <label><span>每次到账积分</span><input aria-label="每次到账积分" type="number" required min={1} max={1000000} step={1} disabled={snapshot.usedCount > 0} value={draft.credits} onChange={event => setDraft({ ...draft, credits: event.target.value })} />{snapshot.usedCount > 0 ? <small>已产生兑换记录，码值与积分额度锁定。</small> : null}</label>
          <label><span>可兑换总次数（已用 {snapshot.usedCount} 次）</span><input type="number" required min={Math.max(1, snapshot.usedCount)} max={10000} step={1} value={draft.maxRedemptions} onChange={event => setDraft({ ...draft, maxRedemptions: event.target.value })} /></label>
          <label><span>开始时间</span><input aria-label="开始时间" type="datetime-local" value={draft.startsAt} onChange={event => setDraft({ ...draft, startsAt: event.target.value })} /><small>留空立即开始。</small></label>
          <label><span>结束时间</span><input aria-label="结束时间" type="datetime-local" value={draft.endsAt} onChange={event => setDraft({ ...draft, endsAt: event.target.value })} /><small>留空长期有效，过期记录可保留原时间。</small></label>
          <label className="redeem-full"><span>保存后单码状态</span><select aria-label="保存后单码状态" value={draft.enabled ? "enabled" : "disabled"} onChange={event => setDraft({ ...draft, enabled: event.target.value === "enabled" })}><option value="enabled">启用</option><option value="disabled">停用</option></select>{snapshot.batchEnabled === false ? <small>所在批次已暂停；启用单码后仍需恢复批次才能兑换。</small> : null}</label>
        </div>
      </fieldset>
      <AdminDialogActions><button type="button" className="admin-text-btn danger" disabled={busy || conflict || !snapshot.enabled || !snapshot.updatedAt} onClick={() => void save(true)}>停用并保留记录</button><button className="admin-primary-btn" type="submit" form={formId} disabled={busy || conflict || !dirty || !valid || !snapshot.updatedAt}>保存兑换码</button></AdminDialogActions>
    </form>
  </AdminDialog>;
}
