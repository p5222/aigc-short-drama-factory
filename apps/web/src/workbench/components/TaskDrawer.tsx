import { RotateCcw, Ban, AlertTriangle, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import type { GenerationTask, TaskStatus, TaskType } from "@aifilm/shared";
import { Dialog, InlineNotice, StatePanel } from "../../design-system/ui";
import { canCancelTask, canRetryTask, createTaskActionRunner, taskRecoveryHint, type PendingTaskActions, type TaskAction } from "../../pages/taskActionModel";

const statusLabel: Record<TaskStatus, string> = { pending: "待处理", running: "进行中", succeeded: "已完成", failed: "失败", canceled: "已取消", refunded: "已解冻" };
const typeLabel: Record<TaskType, string> = { text: "文本", storyboard: "分镜拆解", character: "角色", image: "镜头图片", video: "视频", tts: "配音", export: "成片导出" };

export interface TaskDrawerProps {
  open: boolean;
  tasks: GenerationTask[];
  onClose: () => void;
  onRetry?: (task: GenerationTask) => Promise<void>;
  onCancel?: (task: GenerationTask) => Promise<void>;
  onRefresh?: () => Promise<unknown>;
}

export function TaskDrawer({ open, tasks, onClose, onRetry, onCancel, onRefresh }: TaskDrawerProps) {
  const runner = useRef(createTaskActionRunner()).current;
  const [pending, setPending] = useState<PendingTaskActions>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function run(action: TaskAction, task?: GenerationTask) {
    setError(""); setMessage("");
    const refresh = async () => { await onRefresh?.(); };
    const result = action === "refresh"
      ? await runner.run("__refresh__", action, refresh, setPending)
      : task ? await runner.mutate(task.id, action, () => action === "retry" ? onRetry!(task) : onCancel!(task), refresh, setPending) : { status: "ignored" as const };
    if (result.status === "failed" || result.status === "sync-required") setError(result.message);
    if (result.status === "succeeded") setMessage(action === "refresh" ? "任务记录已刷新。" : action === "retry" ? "重试请求已受理，任务记录已刷新。" : "取消请求已处理，任务记录已刷新。");
  }
  if (!open) return null;
  const groups = (Object.keys(statusLabel) as TaskStatus[]).map((status) => ({ status, items: tasks.filter((task) => task.status === status) })).filter((group) => group.items.length);
  return <Dialog open={open} title="生成任务" description="本项目的生成记录、进度与结算。" onClose={onClose} busy={Object.keys(pending).length > 0} className="wb-operation-dialog" footer={onRefresh ? <button type="button" className="wb-secondary-button" disabled={Object.keys(pending).length > 0} onClick={() => void run("refresh")}><RefreshCw size={16} />{pending.__refresh__ ? "刷新中…" : "刷新任务记录"}</button> : undefined}>
    {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
    <p className="wb-drawer__note">重试前请核对失败原因与积分。取消已提交供应商的任务后，仍需核对远端结果及结算。</p>
    {groups.length ? groups.map(({ status, items }) => <section className="wb-drawer__section" key={status}><h3>{statusLabel[status]} <span>{items.length}</span></h3>{items.map((task) => {
      const disabled = Boolean(pending[task.id] || pending.__refresh__) || runner.isAwaitingSync(task.id);
      return <article className="wb-task-row" data-status={task.status} key={task.id}><div className="wb-task-row__main"><strong>{task.title || typeLabel[task.type] || task.type}</strong><small>{task.provider} / {task.model}</small><small>{statusLabel[task.status]}{task.finalCredits != null ? ` · ${task.finalCredits} 积分` : ` · 预计 ${task.estimatedCredits} 积分`}</small>{task.errorReason ? <p className="wb-inline-error"><AlertTriangle size={14} />{task.errorReason}</p> : null}{task.fallbackHint ? <p className="wb-task-hint">备用模型：{task.fallbackHint}</p> : null}{runner.isAwaitingSync(task.id) ? <p className="wb-task-hint">操作已受理，请刷新任务记录后继续。</p> : !canRetryTask(task) && ["failed", "canceled", "refunded"].includes(task.status) ? <p className="wb-task-hint">{taskRecoveryHint(task)}</p> : null}</div><div className="wb-task-row__actions">{canRetryTask(task) && onRetry ? <button type="button" className="wb-text-button" disabled={disabled} onClick={() => void run("retry", task)}><RotateCcw size={14} />{pending[task.id] === "retry" ? "提交中…" : "重试"}</button> : null}{canCancelTask(task) && onCancel ? <button type="button" className="wb-text-button" disabled={disabled} onClick={() => void run("cancel", task)}><Ban size={14} />{pending[task.id] === "cancel" ? "取消中…" : "取消"}</button> : null}</div></article>;
    })}</section>) : <StatePanel title="暂无生成任务" description="完成内容准备后，可在资产或分镜阶段发起生成。" compact />}
  </Dialog>;
}
