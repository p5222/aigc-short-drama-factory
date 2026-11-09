import { useEffect, useRef, useState } from "react";
import type { EvaluationAttempt, EvaluationReview, EvaluationRun, EvaluationRunDetail, UserFeedback } from "@aifilm/shared";
import { api } from "../lib/api";
import { AdminDialog } from "./AdminDialog";
import { canLeaveAdminEditor } from "./adminDirtyState";
import "./evaluation-evidence.css";

const stages: Record<string, string> = { script: "剧本", character: "角色", storyboard: "分镜", image: "图片", video: "视频" };
const scopes: Record<string, string> = { structure: "结构检查", text: "文本评审", media: "媒体复核" };
const states: Record<string, string> = { prepared: "待执行", submitted: "已提交", succeeded: "已完成", failed: "失败", unknown: "待核对", skipped: "未执行" };
const verdicts = { usable: "可用", unusable: "不可用", insufficient: "证据不足" };
const money = (micros: number) => `¥${(micros / 1_000_000).toFixed(4)}`;
export function EvaluationChannelSummary({ run }: { run: EvaluationRun }) {
  if ((run.protocolVersion ?? 1) < 2) return <span>旧版记录 · 证据不足</span>;
  const channels = run.summary.channels ?? [];
  return <div className="eval-channel-summary">{channels.map(c => <span key={c.channel}>{c.channel === "structure-v2" ? "结构检查" : c.channel}：{c.reports ? `${c.averageScore} 分 · ${c.reports} 份` : "无报告"}</span>)}</div>;
}

export function EvaluationEvidenceDialog({ runId, onClose, onUse, feedback }: {
  runId: string; onClose: () => void; onUse?: (attempt: EvaluationAttempt, review: EvaluationReview) => void; feedback?: UserFeedback;
}) {
  const [detail, setDetail] = useState<EvaluationRunDetail>();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const serial = useRef(0);
  const evidenceRef = useRef<HTMLDivElement>(null);
  async function load() {
    const seq = ++serial.current;
    setLoading(true); setError("");
    try { const data = await api.adminEvaluationRunDetail(runId); if (seq === serial.current) { setDetail(data); setRevision(current => current + 1); } }
    catch (cause) { if (seq === serial.current) setError(cause instanceof Error ? cause.message : "证据读取失败"); }
    finally { if (seq === serial.current) setLoading(false); }
  }
  useEffect(() => { setDetail(undefined); setSelected(""); void load(); return () => { serial.current++; }; }, [runId]);
  const attempts = (detail?.attempts ?? []).filter(a => !feedback || (a.sample.projectId === feedback.projectId && a.sample.stage === feedback.stage));
  const active = attempts.find(a => a.id === selected) ?? attempts[0];
  const legacy = detail && (detail.run.protocolVersion ?? 1) < 2;
  return <AdminDialog open title="评测证据与复核" description={detail?.run.name ?? "读取本次运行的固定样本"} wide busy={saving} onClose={onClose} cancelLabel="返回">
    <div className="eval-evidence" ref={evidenceRef}>
      <div className="eval-evidence-toolbar"><p>先看原始样本，再记录独立判断。自动评分可在下方展开查看。</p><button type="button" className="admin-secondary-btn" disabled={loading || saving} onClick={() => { if (canLeaveAdminEditor(evidenceRef.current ?? document)) void load(); }}>刷新证据</button></div>
      {error ? <p className="admin-toast danger" role="alert">{error}</p> : null}
      {loading ? <p role="status">正在读取证据…</p> : null}
      {legacy ? <p className="eval-evidence-note">旧版记录没有固定样本与评测契约，不能补签人工复核或作为可信对比证据。请在运行评测中保存新样本。</p> : null}
      {detail && !legacy ? <>
        <div className="eval-evidence-metrics">
          <div><span>固定样本</span><strong>{new Set(attempts.map(a => a.sample.id)).size}</strong></div>
          <div><span>已提交调用</span><strong>{detail.run.usage.llmCalls}</strong></div>
          <div><span>已知用量成本</span><strong>{detail.run.usage.llmCalls > 0 && (detail.run.usage.unknownCostCalls ?? 0) >= detail.run.usage.llmCalls ? "待核对" : money(detail.run.usage.knownCostMicros ?? 0)}</strong><small>{detail.run.usage.unknownCostCalls ?? 0} 次成本未知 · 待账单核对</small></div>
          <div><span>同范围人工校准</span><strong>{detail.calibration?.reviewed ?? 0} 份</strong><small>一致 {detail.calibration?.agreed ?? 0} / 分歧 {detail.calibration?.disagreed ?? 0}</small></div>
        </div>
        <div className="eval-evidence-layout">
          <nav className="eval-attempt-list" aria-label="评测样本"><strong className="eval-list-label">本次样本 · {attempts.length}</strong>{attempts.map(a => <button type="button" key={a.id} aria-pressed={a.id === active?.id} disabled={saving || loading} onClick={() => { if (a.id === active?.id || canLeaveAdminEditor(evidenceRef.current ?? document)) setSelected(a.id); }}><strong>{String((a.sample.snapshot.project as { name?: string })?.name ?? a.sample.projectId)}</strong><span>{stages[a.sample.stage]} · {scopes[a.channel] ?? a.channel}</span><small>{states[a.status]} · {a.reviews.length ? "已有复核" : "待复核"}</small></button>)}</nav>
          {active ? <AttemptEvidence key={`${active.id}:${active.reviewVersion}:${revision}`} attempt={active} refreshing={loading} onSaved={load} setSaving={setSaving} onUse={onUse} feedback={feedback} /> : <p>本次运行没有可展示的样本证据。</p>}
        </div>
      </> : null}
      {legacy ? detail.reports.map(r => <p key={r.id}>{stages[r.stage]} · 历史分数 {r.totalScore} · {r.problems.join("；") || "未记录问题"}</p>) : null}
    </div>
  </AdminDialog>;
}

function AttemptEvidence({ attempt: a, refreshing, onSaved, setSaving, onUse, feedback }: {
  attempt: EvaluationAttempt; refreshing: boolean; onSaved: () => Promise<void>; setSaving: (busy: boolean) => void;
  onUse?: (attempt: EvaluationAttempt, review: EvaluationReview) => void; feedback?: UserFeedback;
}) {
  const mediaStage = ["image", "video", "character"].includes(a.sample.stage);
  const [scope, setScope] = useState<EvaluationReview["scope"]>(mediaStage ? "media" : "text");
  const [verdict, setVerdict] = useState<EvaluationReview["verdict"]>("insufficient");
  const [reason, setReason] = useState("");
  const [media, setMedia] = useState<Awaited<ReturnType<typeof api.adminEvaluationMedia>>>();
  const [viewed, setViewed] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reviewRef = useRef<HTMLElement>(null);
  const locked = busy || refreshing;
  const pending = useRef(false);
  const request = useRef<{ id: string; body: string } | undefined>(undefined);
  useEffect(() => {
    if (!mediaStage) return;
    let live = true;
    void api.adminEvaluationMedia(a.id).then(data => { if (live) setMedia(data); }).catch(cause => { if (live) { setMedia([]); setError(cause instanceof Error ? cause.message : "媒体读取失败"); } });
    return () => { live = false; };
  }, [a.id, mediaStage]);
  const coverage = a.contract.coverage as { items?: number; totalItems?: number } | undefined;
  const snapshot = a.sample.snapshot;
  const texts = (a.sample.stage === "script" ? snapshot.scripts : a.sample.stage === "character" ? snapshot.characters : snapshot.shots) as Array<Record<string, unknown>> | undefined;
  const latest = a.reviews[0];
  const appropriateScope = mediaStage ? "media" : "text";
  const usableForFeedback = latest?.verdict === "usable" && latest.scope === appropriateScope && a.status === "succeeded" &&
    (!feedback || (a.sample.projectId === feedback.projectId && a.sample.stage === feedback.stage && a.sample.createdAt >= feedback.createdAt)) &&
    (appropriateScope !== "text" || (!a.contract.includeFeedback && coverage?.items === coverage?.totalItems));
  const pendingResult = ["prepared", "submitted", "unknown"].includes(a.status);
  const missingMedia = scope === "media" && verdict !== "insufficient" && (!media?.length || media.some(m => !m.available || !viewed.includes(m.id)));
  const saveHint = pendingResult ? "先核对调用结果，再提交复核意见。" : missingMedia ? "请核验并查看全部固定媒体；无法核验时可选择「证据不足」。" : !reason.trim() ? "填写具体判断依据后即可保存。" : "复核意见将保留历史，与作者认可分别记录。";
  async function save() {
    if (pending.current || refreshing) return;
    const input = { expectedVersion: a.reviewVersion, fingerprint: a.sample.fingerprint, scope, verdict, reason, mediaIds: scope === "media" ? viewed : [] };
    const body = JSON.stringify(input);
    if (request.current && request.current.body !== body) { setError("上次提交结果尚未核实，请刷新证据后再修改意见。"); return; }
    request.current ??= { id: crypto.randomUUID(), body };
    pending.current = true; setBusy(true); setSaving(true); setError("");
    try {
      await api.reviewEvaluationAttempt(a.id, { ...input, requestId: request.current.id });
      request.current = undefined;
      setReason("");
      await onSaved();
    } catch (cause) { setError(`${cause instanceof Error ? cause.message : "复核提交失败"} 请刷新证据核对保存状态；重复提交相同意见不会新增记录。`); }
    finally { pending.current = false; setBusy(false); setSaving(false); }
  }
  return <section className="eval-attempt-detail" ref={reviewRef} data-admin-dirty={!!reason || verdict !== "insufficient" || viewed.length > 0 || scope !== appropriateScope || undefined}>
    <header><span>{stages[a.sample.stage]} · {scopes[a.channel]}</span><h3>核对本次固定样本</h3><small>捕获于 {new Date(a.sample.createdAt).toLocaleString()}</small></header>
    <div className="eval-review-workspace"><div className="eval-reading-pane" inert={locked}>
    <p className="eval-evidence-note">{a.channel === "text" ? `实际评审 ${coverage?.items ?? 0} / ${coverage?.totalItems ?? 0} 项文本。${a.contract.includeFeedback ? "已纳入用户反馈，不参与独立校准。" : "未纳入用户反馈。"}` : "结构检查只核对字段和资产状态，不判断叙事、画面或播放质量。"}</p>
    {a.errorReason ? <p role="status" className="eval-evidence-note">{a.errorReason}</p> : null}
    {a.status === "unknown" ? <ReconcileAttempt attempt={a} onSaved={onSaved} setSaving={setSaving} /> : null}
    {a.reconciliation ? <p className="eval-evidence-note">已人工核对：{a.reconciliation.outcome === "provider_completed" ? "供应商已完成" : "供应商已失败"}。{a.reconciliation.reason}<br />核对依据：{a.reconciliation.reference}。本次没有有效评测报告，未补造评分。</p> : null}
    {scope !== "media" ? <div className="eval-sample-text">{texts?.length ? texts.map((t, i) => <article key={String(t.id ?? i)}><h4>{String(t.name ?? `样本 ${i + 1}`)}</h4>{Object.entries(t).filter(([key, value]) => !["id", "generationEvidence"].includes(key) && typeof value === "string" && value).map(([key, value]) => <p key={key}><b>{({ content: "正文", synopsis: "梗概", identity: "身份", appearance: "外貌", costume: "服装", personality: "性格", scene: "场景", pictureDesc: "画面", dialogue: "对白", voiceOver: "旁白", action: "动作", imagePrompt: "图片提示词", videoPrompt: "视频提示词", prompt: "提示词", negativePrompt: "排除要求" } as Record<string, string>)[key] ?? key}</b>{String(value)}</p>)}</article>) : <p>此阶段没有已保存的文本。</p>}</div> : <div className="eval-media-grid">{media === undefined ? <p>正在核验媒体来源…</p> : !media.length ? <p>本阶段没有媒体文件，只能标记证据不足。</p> : media.map(m => <article key={m.id}><strong>{m.name}</strong>{m.available && m.url ? <>{m.type === "video" ? <video src={m.url} controls preload="metadata" /> : <img src={m.url} alt={m.name} loading="lazy" />}<label><input type="checkbox" checked={viewed.includes(m.id)} onChange={e => setViewed(current => e.target.checked ? [...current, m.id] : current.filter(id => id !== m.id))} />已查看此文件</label></> : <p>{m.reason}</p>}</article>)}</div>}
    </div><aside className="eval-review-pane"><div className="eval-review-form">
      <h3>记录独立复核意见</h3>
      <div><label>复核范围<select aria-label="复核范围" value={scope} onChange={e => setScope(e.target.value as typeof scope)} disabled={locked}><option value={a.channel}>{scopes[a.channel]}</option>{a.channel !== "text" && ["script", "character", "storyboard"].includes(a.sample.stage) ? <option value="text">完整文本复核</option> : null}{mediaStage ? <option value="media">媒体复核</option> : null}</select></label><label>结论<select aria-label="复核结论" value={verdict} onChange={e => setVerdict(e.target.value as typeof verdict)} disabled={locked}>{Object.entries(verdicts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <label>复核理由<textarea aria-label="复核理由" value={reason} maxLength={2000} disabled={locked} onChange={e => setReason(e.target.value)} placeholder="说明具体问题、已查看的范围和判断依据。" /></label>
      {error ? <p className="admin-toast danger" role="alert">{error}</p> : null}
      <p className="eval-review-hint">{saveHint}</p>
      <button className="admin-primary-btn" type="button" onClick={() => void save()} disabled={locked || !reason.trim() || pendingResult || !!missingMedia}>{busy ? "保存中…" : "保存复核意见"}</button>
    </div>
    {a.reviews.length ? <section className="eval-review-history"><h3>复核历史</h3>{a.reviews.map(r => <article key={r.id}><strong>第 {r.version} 版 · {scopes[r.scope]} · {verdicts[r.verdict]}</strong><p>{r.reason}</p><small>{new Date(r.createdAt).toLocaleString()}</small></article>)}{onUse ? <button className="admin-secondary-btn" type="button" disabled={locked || !usableForFeedback} onClick={() => { if (latest && canLeaveAdminEditor(reviewRef.current ?? document)) onUse(a, latest); }}>关联为本条反馈的修复证据</button> : null}</section> : null}
    </aside></div>
    <details className="eval-auto-report"><summary>展开自动评分与执行证据</summary>
      {a.report ? <><h4>{a.report.totalScore} 分 · {a.report.pass ? "本范围通过" : "本范围未通过"}</h4><p>{a.report.problems.join("；") || "未发现本规则覆盖的问题"}</p><p>{a.report.suggestions.join("；")}</p></> : <p>没有有效评分报告，不使用其他通道回填。</p>}
      <dl><dt>尝试标识</dt><dd>{a.id}</dd><dt>样本指纹</dt><dd>{a.sample.fingerprint}</dd><dt>提交状态</dt><dd>{states[a.status]} · {a.submittedAt ?? "未调用供应商"}</dd><dt>成本</dt><dd>{a.cost.status === "usage_derived" ? `${money(a.cost.actualMicros ?? 0)}（按用量推算）` : a.submittedAt ? "未知，待核对" : "未提交付费调用"}</dd></dl>
      <details><summary>实际评分契约与用量</summary><pre>{JSON.stringify({ contract: a.contract, usage: a.usage }, null, 2)}</pre></details>
    </details>
  </section>;
}

function ReconcileAttempt({ attempt, onSaved, setSaving }: { attempt: EvaluationAttempt; onSaved: () => Promise<void>; setSaving: (busy: boolean) => void }) {
  const [outcome, setOutcome] = useState<"provider_completed" | "provider_failed">("provider_failed");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const request = useRef<{ requestId: string; body: string } | undefined>(undefined);
  async function reconcile() {
    if (pending.current) return;
    const body = JSON.stringify({ outcome, reason, reference });
    if (request.current && request.current.body !== body) { setError("请先刷新并核对上次登记是否成功。"); return; }
    request.current ??= { requestId: crypto.randomUUID(), body };
    pending.current = true; setBusy(true); setSaving(true); setError("");
    try { await api.reconcileEvaluationAttempt(attempt.id, { requestId: request.current.requestId, outcome, reason, reference }); await onSaved(); }
    catch (cause) { setError(`${cause instanceof Error ? cause.message : "登记失败"} 请刷新核对，原调用不会重发。`); }
    finally { pending.current = false; setBusy(false); setSaving(false); }
  }
  return <div className="eval-review-form" data-admin-dirty={!!reason || !!reference || undefined}><h3>登记供应商核对结果</h3><p>确认原调用的终态后，结束待核对状态。评分报告保持缺失，费用仍需按用量与账单核实。</p>
    <label>供应商结果<select aria-label="供应商核对结果" value={outcome} disabled={busy} onChange={e => setOutcome(e.target.value as typeof outcome)}><option value="provider_failed">已确认失败</option><option value="provider_completed">已确认完成，但没有有效报告</option></select></label>
    <label>核对依据<input aria-label="核对依据" value={reference} maxLength={300} disabled={busy} onChange={e => setReference(e.target.value)} placeholder="供应商任务号、调用记录或账单凭据摘要" /></label>
    <label>处理说明<textarea aria-label="核对处理说明" value={reason} maxLength={2000} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
    {error ? <p role="alert">{error}</p> : null}<button className="admin-primary-btn" type="button" disabled={busy || reason.trim().length < 8 || !reference.trim()} onClick={() => void reconcile()}>保存核对结果</button></div>;
}

export function FeedbackEvidencePicker({ feedback, onSelect }: { feedback: UserFeedback; onSelect: (attemptId: string, reviewId: string) => void }) {
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [runId, setRunId] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setRunId(""); setError(""); setLoading(true); setRuns([]);
    void api.adminEvaluationRunsPage(1, 100).then(page => { if (live) setRuns(page.items.filter(r => r.projectIds.includes(feedback.projectId ?? "") && r.stages.includes(feedback.stage) && (r.protocolVersion ?? 1) >= 2)); }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "复测记录读取失败"); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [feedback.id, reload]);
  return <div className="eval-feedback-picker"><label>关联复测证据<select aria-label="关联复测证据" value={runId} disabled={loading || !!error} onChange={e => setRunId(e.target.value)}><option value="">{loading ? "正在读取复测记录…" : "选择近期同项目、同阶段运行"}</option>{runs.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><button type="button" className="admin-secondary-btn" disabled={!runId || loading || !!error} onClick={() => setOpen(true)}>查看并关联复核</button>{!loading && !error && !runs.length ? <p className="quality-closure-hint">暂无匹配复测。修订作品后，请在评测闭环中捕获新样本并运行。</p> : null}<small>匹配范围：最近 100 次运行中的同项目、同阶段记录。</small>{error ? <p role="alert">{error}</p> : null}<button type="button" className="admin-text-btn" disabled={loading} onClick={() => setReload(value => value + 1)}>{error ? "重试读取复测" : "刷新复测记录"}</button>{open ? <EvaluationEvidenceDialog runId={runId} feedback={feedback} onClose={() => setOpen(false)} onUse={(a, r) => { onSelect(a.id, r.id); setOpen(false); }} /> : null}</div>;
}
