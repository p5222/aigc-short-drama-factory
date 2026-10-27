import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, MessageSquareText, Plus, RefreshCw, Send } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SupportTicketCategory, SupportTicketDetail, SupportTicketMutationResult, SupportTicketStatus, SupportTicketSummary } from "@aifilm/shared";
import { api } from "../lib/api";
import { HttpError } from "../lib/httpClient";
import { attachSupportContext, captureSupportAttempt, claimSupportDraft, completeSupportAttempt, createSupportReadGate, emptySupportDraft, mergeSupportSummary, readSupportDraft, supportCategories, supportRequestId, supportStatuses, supportStorageKey, validateSupportCreate, validateSupportMessage, writeSupportDraft, type SupportCreateDraft } from "./supportTicketModel";
import "./supportTickets.css";
import { InlineNotice } from "../design-system/ui";

export interface SupportTicketIntent { view: "list" | "new"; key: number; prefill?: SupportCreateDraft }
interface SupportTicketPanelProps { userId: string; intent?: SupportTicketIntent }

export function SupportTicketPanel(props: SupportTicketPanelProps) {
  return <TicketPanel key={`user:${props.userId}`} {...props} mode="user" />;
}

export function SupportAdminPanel({ userId }: { userId: string }) {
  return <TicketPanel key={`staff:${userId}`} userId={userId} mode="staff" />;
}

function sessionStore() { try { return window.sessionStorage; } catch { return undefined; } }
function displayTime(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : "时间待确认"; }

function TicketPanel({ userId, intent, mode }: SupportTicketPanelProps & { mode: "user" | "staff" }) {
  const staff = mode === "staff";
  const store = useMemo(sessionStore, []);
  const createKey = supportStorageKey(userId, mode, "create");
  const [draft, setDraft] = useState(() => readSupportDraft(store, createKey));
  const [taskContext, setTaskContext] = useState<SupportCreateDraft>();
  const appliedIntent = useRef<number | undefined>(undefined);
  const [items, setItems] = useState<SupportTicketSummary[]>([]);
  const [status, setStatus] = useState<SupportTicketStatus | "all">(staff ? "open" : "all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [listReload, setListReload] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [view, setView] = useState<"list" | "new" | "detail">("list");
  const [activeId, setActiveId] = useState("");
  const [detail, setDetail] = useState<SupportTicketDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState<"" | "create" | "reply" | "close">("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const pendingRef = useRef(false);
  const alive = useRef(true);
  const listGate = useRef(createSupportReadGate());
  const detailGate = useRef(createSupportReadGate());
  const heading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const subjectInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const titleId = useId(), formHintId = useId(), replyHintId = useId();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; listGate.current.cancel(); detailGate.current.cancel(); };
  }, []);

  useEffect(() => { writeSupportDraft(store, createKey, draft); }, [store, createKey, draft]);

  useEffect(() => {
    const token = listGate.current.begin();
    setListLoading(true); setListError("");
    void (staff ? api.adminSupportTickets(page, status) : api.supportTickets(page, status)).then(result => {
      if (!alive.current || !listGate.current.current(token)) return;
      setItems(result.items); setTotal(result.total); setPageSize(result.pageSize);
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (page > lastPage) setPage(lastPage);
    }).catch(reason => {
      if (alive.current && listGate.current.current(token)) setListError(reason instanceof Error ? reason.message : "工单列表读取失败，请重试。");
    }).finally(() => { if (alive.current && listGate.current.current(token)) setListLoading(false); });
    return () => listGate.current.cancel();
  }, [staff, page, status, listReload]);

  useEffect(() => {
    if (!intent || pendingRef.current) return;
    changeView(intent.view);
    if (intent.prefill && intent.key !== appliedIntent.current) {
      appliedIntent.current = intent.key;
      if (!draft.subject.trim() && !draft.body.trim()) {
        setDraft(intent.prefill);
        setNotice("已带入任务诊断信息，请补充问题说明并检查后提交。");
      } else if (!draft.body.includes(intent.prefill.body)) {
        setTaskContext(intent.prefill);
      }
    }
  }, [intent?.key, intent?.view]);

  useEffect(() => {
    const target = view === "new" ? subjectInput.current : view === "detail" ? detailHeading.current : heading.current;
    if (view === "list" && !intent) return;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, [view, activeId, intent?.key]);

  function changeView(next: "list" | "new") {
    if (pendingRef.current || (staff && next === "new")) return;
    detailGate.current.cancel(); setDetailLoading(false);
    setView(next); setActiveId(""); setDetail(undefined); setActionError(""); setDetailError(""); setNotice(""); setNeedsReview(false);
  }

  async function readTicket(id: string, preserveDraft = false) {
    if (pendingRef.current) return;
    const token = detailGate.current.begin();
    setView("detail"); setActiveId(id); setDetailLoading(true); setDetailError("");
    if (!preserveDraft) {
      setDetail(undefined); setActionError(""); setNotice(""); setNeedsReview(false);
      setReply(claimSupportDraft(store, supportStorageKey(userId, mode, `reply:${id}`)).body);
    }
    try {
      const result = await (staff ? api.adminSupportTicket(id) : api.supportTicket(id));
      if (!alive.current || !detailGate.current.current(token)) return;
      setDetail(result); setNeedsReview(false); setActionError("");
      if (preserveDraft) setNotice("已读取最新工单记录，请查看对话后继续；未发送内容已保留。");
    } catch (reason) {
      if (alive.current && detailGate.current.current(token)) setDetailError(reason instanceof Error ? reason.message : "工单详情读取失败，请重试。");
    } finally { if (alive.current && detailGate.current.current(token)) setDetailLoading(false); }
  }

  function updateReply(value: string) {
    setReply(value);
    writeSupportDraft(store, supportStorageKey(userId, mode, `reply:${activeId}`), { ...emptySupportDraft(), body: value });
  }

  function applySaved(result: SupportTicketMutationResult, message: string) {
    if (!alive.current) return;
    detailGate.current.cancel(); setDetailLoading(false); setDetailError("");
    setDetail(result); setActiveId(result.ticket.id); setView("detail"); setNeedsReview(false);
    setItems(current => mergeSupportSummary(current, result.ticket, status));
    setNotice(message); setActionError(""); setListReload(value => value + 1);
  }

  async function createTicket() {
    if (pendingRef.current || staff) return;
    const validation = validateSupportCreate(draft);
    if (validation) { setActionError(validation); (!draft.subject.trim() ? subjectInput.current : bodyInput.current)?.focus(); return; }
    pendingRef.current = true; setPending("create"); setActionError(""); setNotice("");
    try {
      const input = { subject: draft.subject.trim(), category: draft.category, body: draft.body.trim() };
      const requestId = supportRequestId(store, createKey, input);
      const attempt = captureSupportAttempt(store, createKey);
      const result = await api.createSupportTicket({ ...input, requestId });
      completeSupportAttempt(store, createKey, attempt);
      if (!alive.current) return;
      setDraft(emptySupportDraft()); setReply(""); setTaskContext(undefined);
      applySaved(result, result.replayed ? "已找到此前成功提交的工单，没有重复创建。" : "工单已提交，编号和对话记录见下方。可在“我的工单”查看回复。");
    } catch (reason) {
      if (alive.current) setActionError(reason instanceof Error ? reason.message : "未能确认提交结果，请保留当前内容重试。");
    } finally { pendingRef.current = false; if (alive.current) setPending(""); }
  }

  async function sendReply() {
    if (pendingRef.current || !detail || detailLoading || detailError || needsReview || detail.ticket.status === "closed") return;
    const validation = validateSupportMessage(reply);
    if (validation) { setActionError(validation); replyInput.current?.focus(); return; }
    const ticket = detail.ticket, key = supportStorageKey(userId, mode, `reply:${ticket.id}`);
    pendingRef.current = true; setPending("reply"); setActionError(""); setNotice("");
    try {
      const body = reply.trim(), requestId = supportRequestId(store, key, { body });
      const input = { body, requestId, expectedVersion: ticket.version };
      const attempt = captureSupportAttempt(store, key);
      const result = await (staff ? api.replyAdminSupportTicket(ticket.id, input) : api.replySupportTicket(ticket.id, input));
      completeSupportAttempt(store, key, attempt);
      if (!alive.current) return;
      setReply(""); applySaved(result, result.replayed ? "这条消息此前已保存，没有重复发送。" : staff ? "回复已保存，用户可在工单中查看。" : "补充内容已提交，可在此查看后续回复。");
    } catch (reason) {
      if (!alive.current) return;
      if (reason instanceof HttpError && reason.status === 409) setNeedsReview(true);
      setActionError(reason instanceof Error ? reason.message : "未能确认消息结果，输入已保留，请重试。");
    } finally { pendingRef.current = false; if (alive.current) setPending(""); }
  }

  async function closeTicket() {
    if (pendingRef.current || !detail || detailLoading || detailError || needsReview || detail.ticket.status === "closed") return;
    if (reply.trim() && !window.confirm("还有未发送的内容。关闭后不能继续补充，确定关闭此工单？")) return;
    const ticket = detail.ticket, key = supportStorageKey(userId, mode, `reply:${ticket.id}`);
    const attempt = captureSupportAttempt(store, key);
    pendingRef.current = true; setPending("close"); setActionError(""); setNotice("");
    try {
      const result = await (staff ? api.closeAdminSupportTicket(ticket.id, { expectedVersion: ticket.version }) : api.closeSupportTicket(ticket.id, { expectedVersion: ticket.version }));
      completeSupportAttempt(store, key, attempt);
      if (!alive.current) return;
      setReply(""); applySaved(result, "工单已关闭，对话记录仍可查看。如有新的问题，可另开工单。");
    } catch (reason) {
      if (!alive.current) return;
      if (reason instanceof HttpError && reason.status === 409) setNeedsReview(true);
      setActionError(reason instanceof Error ? reason.message : "未能确认关闭结果，请刷新查看当前状态。");
    } finally { pendingRef.current = false; if (alive.current) setPending(""); }
  }

  const disabled = Boolean(pending);
  return <section className="support-panel" data-view={view} id={staff ? "support-admin-tickets" : "support-tickets"} aria-labelledby={titleId}>
    <header className="support-heading"><div><h2 ref={heading} id={titleId} tabIndex={-1}>{staff ? "支持工单" : "工单记录"}</h2><p>{staff ? "查看用户问题并留下可追溯的站内回复。" : "选择工单查看对话，未解决的问题可以继续补充。"}</p></div><div className="support-actions">{!staff ? <button className="support-primary" type="button" disabled={disabled} onClick={() => changeView("new")}><Plus size={16} />新建工单</button> : null}<button type="button" disabled={disabled || listLoading} onClick={() => setListReload(value => value + 1)}><RefreshCw size={16} />刷新列表</button></div></header>
    {notice ? <InlineNotice tone="success" onDismiss={() => setNotice("")}>{notice}</InlineNotice> : null}
    {view === "new" && taskContext ? <div className="support-context-review" role="region" aria-label="待补充的任务信息">
      <div><strong>已有未提交的草稿</strong><p>原有内容已保留，可将本次任务信息补充到说明末尾。</p></div>
      <div className="support-actions"><button type="button" disabled={disabled} onClick={() => {
        try { setDraft(attachSupportContext(draft, taskContext)); setTaskContext(undefined); setActionError(""); setNotice("任务信息已补充，请检查说明后提交。"); }
        catch (reason) { setActionError(reason instanceof Error ? reason.message : "任务信息未能补充，原草稿已保留。"); }
      }}>补充任务信息</button><button type="button" disabled={disabled} onClick={() => setTaskContext(undefined)}>保留原草稿</button></div>
    </div> : null}
    <div className="support-layout">
      <aside className="support-list" aria-label="工单列表"><div className="support-list-filter"><label>状态<select value={status} disabled={disabled} onChange={event => { setStatus(event.target.value as SupportTicketStatus | "all"); setPage(1); }}><option value="all">全部工单</option>{Object.entries(supportStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><span>{listError ? "统计待刷新" : listLoading ? "同步中" : `共 ${total} 条`}</span></div>
        {listError ? <p className="support-error" role="alert">列表未能刷新：{listError}<button type="button" disabled={disabled || listLoading} onClick={() => setListReload(value => value + 1)}>重试读取列表</button></p> : null}
        {listLoading ? <p className="support-loading" role="status"><Loader2 size={16} className="spin-icon" />正在读取工单…</p> : null}
        <div className="support-list-items">{items.map(item => <button className="support-list-item" type="button" key={item.id} disabled={disabled} aria-pressed={view === "detail" && activeId === item.id} onClick={() => void readTicket(item.id)}><span className="support-list-item-head"><strong>{item.subject}</strong><span className="support-status" data-status={item.status}>{supportStatuses[item.status]}</span></span><span>{supportCategories[item.category]}{staff ? ` · ${item.userName}` : ""}</span><small>更新于 {displayTime(item.updatedAt)}</small><small className="support-ticket-id">编号 {item.id}</small></button>)}</div>
        {!listLoading && !listError && !items.length ? <div className="support-empty"><MessageSquareText size={24} /><p>{staff ? "当前筛选下没有工单。" : "当前筛选下暂无工单。需要帮助时可提交问题。"}</p></div> : null}
        {totalPages > 1 ? <nav className="support-pagination" aria-label="工单分页"><button type="button" aria-label="上一页工单" disabled={disabled || listLoading || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} /></button><span>{page} / {totalPages}</span><button type="button" aria-label="下一页工单" disabled={disabled || listLoading || page >= totalPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={16} /></button></nav> : null}
      </aside>
      <div className="support-workspace">
        {view === "list" ? <div className="support-empty support-selection-empty"><MessageSquareText size={32} /><h3>选择一条工单查看对话</h3><p>{staff ? "回复会保存到工单，并对提交问题的用户可见。" : "已有问题可继续补充，新的问题请另开工单。"}</p></div> : null}
        {view === "new" && !staff ? <form className="support-form" onSubmit={event => { event.preventDefault(); void createTicket(); }}><div className="support-detail-heading"><h3>提交问题</h3><button type="button" disabled={disabled} onClick={() => changeView("list")}>返回工单列表</button></div><label>问题标题<input ref={subjectInput} value={draft.subject} maxLength={120} disabled={disabled} onChange={event => setDraft({ ...draft, subject: event.target.value })} placeholder="简要说明你遇到的问题" /></label><label>问题分类<select value={draft.category} disabled={disabled} onChange={event => setDraft({ ...draft, category: event.target.value as SupportTicketCategory })}>{Object.entries(supportCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>问题说明<textarea ref={bodyInput} rows={7} value={draft.body} maxLength={5000} disabled={disabled} aria-describedby={formHintId} onChange={event => setDraft({ ...draft, body: event.target.value })} placeholder="描述操作步骤、发生的问题及期望结果；可写入相关项目、任务或订单编号。" /></label><p className="support-hint" id={formHintId}>请勿填写密码、验证码或 API 密钥。输入尚未提交，提交成功后才会发送给支持人员。{draft.body.length}/5000</p>{actionError ? <p className="support-error" role="alert">{actionError}</p> : null}<button className="support-primary" type="submit" disabled={disabled}>{pending === "create" ? <Loader2 size={16} className="spin-icon" /> : <Send size={16} />}{pending === "create" ? "正在提交…" : "提交工单"}</button></form> : null}
        {view === "detail" ? <div className="support-detail"><div className="support-detail-heading"><h3 ref={detailHeading} tabIndex={-1}>{detail?.ticket.subject ?? "工单详情"}</h3><button type="button" disabled={disabled || detailLoading} onClick={() => void readTicket(activeId, true)}><RefreshCw size={16} />刷新详情</button></div>{detailLoading ? <p className="support-loading" role="status"><Loader2 size={16} className="spin-icon" />正在读取对话…</p> : null}{detailError ? <p className="support-error" role="alert">{detailError} 输入仍保留，请重试读取详情。</p> : null}{detail ? <><div className="support-detail-meta"><span className="support-status" data-status={detail.ticket.status}>{supportStatuses[detail.ticket.status]}</span><span>{supportCategories[detail.ticket.category]}</span>{staff ? <span>提交人：{detail.ticket.userName}</span> : null}<small className="support-ticket-id">编号 {detail.ticket.id}</small></div><div className="support-messages" tabIndex={0} role="region" aria-label="工单对话记录">{detail.messages.map(message => <article className="support-message" key={message.id} data-author={message.authorRole}><header><strong>{message.authorRole === "staff" ? "支持人员" : "用户"} · {message.authorName}</strong><time dateTime={message.createdAt}>{displayTime(message.createdAt)}</time></header><p>{message.body}</p></article>)}</div>{detail.ticket.status === "closed" && reply.trim() ? <label className="support-unsent">未发送的内容（已保留，可复制后另开工单）<textarea rows={4} value={reply} readOnly /></label> : null}{detail.ticket.status === "closed" ? <p className="support-closed"><CheckCircle2 size={18} />工单已关闭，对话记录保留。{!staff ? <button type="button" disabled={disabled} onClick={() => changeView("new")}>另提一个问题</button> : null}</p> : <form className="support-form support-reply" onSubmit={event => { event.preventDefault(); void sendReply(); }}><label>{staff ? "回复用户" : "补充问题"}<textarea ref={replyInput} rows={4} value={reply} maxLength={5000} disabled={disabled} aria-describedby={replyHintId} onChange={event => updateReply(event.target.value)} placeholder={staff ? "写下处理结果或需要用户补充的信息。" : "补充复现步骤、编号或新的情况。"} /></label><p className="support-hint" id={replyHintId}>消息会保存在这条工单中。{reply.length}/5000</p>{needsReview ? <p className="support-error" role="alert">工单已有新内容，未发送文字已保留。请点击“刷新详情”重新查看，再决定是否发送。</p> : null}<div className="support-actions"><button className="support-primary" type="submit" disabled={disabled || detailLoading || Boolean(detailError) || needsReview}>{pending === "reply" ? <Loader2 size={16} className="spin-icon" /> : <Send size={16} />}{pending === "reply" ? "正在发送…" : staff ? "发送回复" : "提交补充"}</button>{!staff ? <button type="button" disabled={disabled || detailLoading || Boolean(detailError) || needsReview} onClick={() => void closeTicket()}>{pending === "close" ? "正在关闭…" : "问题已解决，关闭工单"}</button> : null}</div></form>}</> : null}{actionError ? <p className="support-error" role="alert">{actionError}</p> : null}</div> : null}
      </div>
    </div>
  </section>;
}
