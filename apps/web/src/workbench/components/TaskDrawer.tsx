import { RotateCcw, Ban, AlertTriangle } from "lucide-react";
import type { GenerationTask, TaskStatus, TaskType } from "@aifilm/shared";
import { Dialog, StatePanel } from "../../design-system/ui";

const statusLabel: Record<TaskStatus, string> = { pending: "待处理", running: "进行中", succeeded: "已完成", failed: "失败", canceled: "已取消", refunded: "已退款" };
const typeLabel: Record<TaskType, string> = { text: "文本", storyboard: "分镜拆解", character: "角色", image: "镜头图片", video: "视频", tts: "配音", export: "成片导出" };

export interface TaskDrawerProps { open: boolean; tasks: GenerationTask[]; onClose: () => void; onRetry?: (task: GenerationTask) => void; onCancel?: (task: GenerationTask) => void; }

export function TaskDrawer({ open, tasks, onClose, onRetry, onCancel }: TaskDrawerProps) {
  if (!open) return null;
  const groups = (Object.keys(statusLabel) as TaskStatus[]).map((status) => ({ status, items: tasks.filter((task) => task.status === status) })).filter((group) => group.items.length);
  return <Dialog open={open} title="生成任务" description="本项目的生成记录、进度与结算。" onClose={onClose} className="wb-operation-dialog">
    {groups.length ? groups.map(({ status, items }) => <section className="wb-drawer__section" key={status}><h3>{statusLabel[status]} <span>{items.length}</span></h3>{items.map((task) => <article className="wb-task-row" data-status={task.status} key={task.id}><div className="wb-task-row__main"><strong>{task.title || typeLabel[task.type] || task.type}</strong><small>{task.provider} / {task.model}</small><small>{statusLabel[task.status]}{task.finalCredits != null ? ` · ${task.finalCredits} 积分` : task.estimatedCredits ? ` · 预计 ${task.estimatedCredits} 积分` : ""}</small>{task.errorReason ? <p className="wb-inline-error"><AlertTriangle size={14} />{task.errorReason}</p> : null}{task.fallbackHint ? <p className="wb-task-hint">备用模型：{task.fallbackHint}</p> : null}</div><div className="wb-task-row__actions">{task.retryable && onRetry ? <button type="button" className="wb-text-button" onClick={() => onRetry(task)}><RotateCcw size={14} />重试</button> : null}{task.cancelable && onCancel ? <button type="button" className="wb-text-button" onClick={() => onCancel(task)}><Ban size={14} />取消</button> : null}</div></article>)}</section>) : <StatePanel title="暂无生成任务" description="完成内容准备后，可在资产或分镜阶段发起生成。" compact />}
  </Dialog>;
}
