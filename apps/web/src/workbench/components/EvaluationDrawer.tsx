import { RefreshCw } from "lucide-react";
import type { QualityReport, UserFeedback } from "@aifilm/shared";
import { Dialog, StatePanel } from "../../design-system/ui";

export interface EvaluationDrawerProps { open: boolean; reports: QualityReport[]; feedbacks: UserFeedback[]; onClose: () => void; onRefresh?: () => void; }
export function EvaluationDrawer({ open, reports, feedbacks, onClose, onRefresh }: EvaluationDrawerProps) {
  const stages: Record<string, string> = { script: "剧本", character: "角色", storyboard: "分镜", image: "图片", video: "视频" };
  return <Dialog open={open} title="评测与反馈" description="查看已保存的质量建议，定位下一步需要调整的内容。" onClose={onClose} className="wb-operation-dialog" footer={onRefresh ? <button className="wb-secondary-button" type="button" onClick={onRefresh}><RefreshCw size={16} />刷新评测数据</button> : undefined}>
    {reports.map(report => <article className="wb-evaluation-row" key={report.id}><div><strong>{stages[report.stage] ?? report.stage} · {report.totalScore} 分</strong><small>{new Date(report.createdAt).toLocaleString()}</small></div><p>{report.suggestions[0] || report.problems[0] || "暂无文字建议"}</p></article>)}
    {feedbacks.map(feedback => <article className="wb-evaluation-row" key={feedback.id}><div><strong>{stages[feedback.stage] ?? feedback.stage} · {feedback.rating} 分</strong><small>{feedback.usability === "usable" ? "可用" : feedback.usability === "barely_usable" ? "需要调整" : "不可用"}</small></div><p>{feedback.content || feedback.rootCause || "暂无文字反馈"}</p></article>)}
    {!reports.length && !feedbacks.length ? <StatePanel title="暂无评测记录" description="为生成结果提交反馈后，可在这里查看已保存的记录。" compact /> : null}
  </Dialog>;
}
