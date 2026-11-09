import { CheckCircle2, ClipboardCheck, MessageSquareText, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import type { QualityReport, UserFeedback } from "@aifilm/shared";
import { Dialog, InlineNotice, StatePanel } from "../../design-system/ui";
import "./quality-feedback.css";

const stages: Record<string, string> = { script: "剧本", character: "角色", storyboard: "分镜", image: "图片", video: "视频" };
const statuses: Record<string, string> = { open: "待处理", triaged: "已分析", processing: "处理中", converted: "处理中", resolved: "已解决", ignored: "已关闭" };
const usabilityLabels = { usable: "可直接使用", barely_usable: "需要调整", unusable: "暂不可用" };
const dateLabel = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export interface EvaluationDrawerProps { open: boolean; reports: QualityReport[]; feedbacks: UserFeedback[]; onClose: () => void; onRefresh?: () => Promise<unknown>; }
export function EvaluationDrawer({ open, reports, feedbacks, onClose, onRefresh }: EvaluationDrawerProps) {
  const pending = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"reports" | "feedback">("reports");
  const [stage, setStage] = useState("all");
  const [limit, setLimit] = useState(8);
  const activeReports = reports.filter(item => stage === "all" || item.stage === stage).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeFeedback = feedbacks.filter(item => stage === "all" || item.stage === stage).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingCount = feedbacks.filter(item => !["resolved", "ignored"].includes(item.status)).length;
  const count = view === "reports" ? activeReports.length : activeFeedback.length;
  async function refresh() {
    if (pending.current || !onRefresh) return;
    pending.current = true; setRefreshing(true); setError(""); setMessage("");
    try { await onRefresh(); setMessage("评测与反馈记录已刷新。"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "评测数据暂时无法刷新，请重试。"); }
    finally { pending.current = false; setRefreshing(false); }
  }
  return <Dialog open={open} title="评测与反馈" description="找到需要调整的地方，跟进每一条反馈。" onClose={onClose} busy={refreshing} className="wb-operation-dialog qf-drawer" footer={<><span className="qf-footer-note">记录按提交时间倒序排列</span>{onRefresh ? <button className="wb-secondary-button" type="button" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={16} />{refreshing ? "刷新中…" : "刷新评测数据"}</button> : null}</>}>
    {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
    <div className="qf-overview"><ClipboardCheck size={22} aria-hidden="true" /><div><strong>{reports.length ? `${reports.length} 份质量建议` : "为下一次调整留下依据"}</strong><p>{feedbacks.length ? `${pendingCount} 条反馈待处理 · ${feedbacks.filter(item => item.status === "resolved").length} 条已解决` : "查看生成结果后，可在资产面板提交效果反馈。"}</p></div></div>
    <div className="qf-view-switch" role="group" aria-label="记录类型">
      <button type="button" aria-pressed={view === "reports"} onClick={() => { setView("reports"); setLimit(8); }}><ClipboardCheck size={16} />质量建议 <span>{reports.length}</span></button>
      <button type="button" aria-pressed={view === "feedback"} onClick={() => { setView("feedback"); setLimit(8); }}><MessageSquareText size={16} />我的反馈 <span>{feedbacks.length}</span></button>
    </div>
    <div className="qf-list-toolbar"><label>阶段<select aria-label="筛选记录阶段" value={stage} onChange={event => { setStage(event.target.value); setLimit(8); }}><option value="all">全部阶段</option>{Object.entries(stages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><span role="status">{count} 条记录</span></div>
    {view === "reports" ? <>
      <p className="qf-scope-note">分数只适用于标注的检查范围；画面与播放效果请结合成品判断。</p>
      {activeReports.slice(0, limit).map(report => <article className="qf-record" key={report.id}>
        <header><div><span className="qf-record-kind">{report.evidenceScope === "structure" ? "结构检查" : report.evidenceScope === "text" ? "文本评审" : "历史记录 · 范围待确认"}</span><h3>{stages[report.stage] ?? report.stage}质量建议</h3></div><div className="qf-score"><strong>{report.totalScore}</strong><span>/ 100</span></div></header>
        <div className="qf-record-meta"><span className="qf-status" data-tone={report.evidenceScope ? (report.pass ? "success" : "warning") : "neutral"}>{report.evidenceScope ? (report.pass ? "本范围通过" : "建议调整") : "结论待确认"}</span><time dateTime={report.createdAt}>{dateLabel(report.createdAt)}</time></div>
        <p className="qf-record-lead">{report.suggestions[0] || report.problems[0] || "本次未记录文字建议。"}</p>
        <details><summary>查看完整建议{report.problems.length + report.suggestions.length ? `（${report.problems.length + report.suggestions.length}）` : ""}</summary><div className="qf-report-details"><strong>发现的问题</strong>{report.problems.length ? <ul>{report.problems.map((text, i) => <li key={i}>{text}</li>)}</ul> : <p>未记录本范围内的问题。</p>}<strong>调整建议</strong>{report.suggestions.length ? <ul>{report.suggestions.map((text, i) => <li key={i}>{text}</li>)}</ul> : <p>未记录调整建议。</p>}</div></details>
      </article>)}
    </> : activeFeedback.slice(0, limit).map(feedback => <article className="qf-record" key={feedback.id}>
      <header><div><span className="qf-record-kind">效果反馈</span><h3>{stages[feedback.stage] ?? feedback.stage} · {usabilityLabels[feedback.usability]}</h3></div><span className="qf-status" data-tone={feedback.status === "resolved" ? "success" : "neutral"}>{statuses[feedback.status] ?? "待处理"}</span></header>
      <div className="qf-record-meta"><span>我的评分 {feedback.rating} / 5</span><time dateTime={feedback.createdAt}>{dateLabel(feedback.createdAt)}</time></div>
      <p className="qf-record-lead">{feedback.content || "已提交评分和可用性反馈，未填写补充说明。"}</p>
      {feedback.tags.length ? <div className="qf-tags">{feedback.tags.map(tag => <span key={tag}>{tag}</span>)}</div> : null}
      <div className="qf-handling"><CheckCircle2 size={16} aria-hidden="true" /><div><strong>{feedback.resolution ? "处理记录" : "反馈已保存"}</strong><p>{feedback.resolution || (feedback.status === "ignored" ? "本条反馈已关闭，未记录处理说明。" : feedback.status === "resolved" ? "已标记解决，未记录处理说明。" : "可在这里查看后续处理状态和结论。")}</p>{feedback.processedAt ? <time dateTime={feedback.processedAt}>{dateLabel(feedback.processedAt)}</time> : null}</div></div>
    </article>)}
    {!count ? <StatePanel title={stage !== "all" ? "该阶段暂无记录" : view === "reports" ? "还没有质量建议" : "还没有效果反馈"} description={stage !== "all" ? "切换到全部阶段，查看其他已保存记录。" : view === "reports" ? "完成质量检查后，建议会保存在这里。" : "在资产面板评价生成结果，帮助定位具体问题。"} compact /> : null}
    {count > limit ? <button type="button" className="wb-secondary-button qf-load-more" onClick={() => setLimit(value => value + 8)}>加载更多（剩余 {count - limit} 条）</button> : null}
  </Dialog>;
}
