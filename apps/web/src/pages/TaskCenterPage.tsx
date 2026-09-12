import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  Film,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Megaphone,
  RefreshCw,
  RotateCcw,
  Scissors,
  Sparkles,
  Square,
  UserRound,
  Volume2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { InlineNotice, PageHeader, StatePanel } from "../design-system/ui";
import "./creator-pages.css";
import type { ReactNode } from "react";
import type { GenerationTask, TaskStatus, TaskType } from "@aifilm/shared";
import { canCancelTask, canRetryTask, createTaskActionRunner, type PendingTaskActions, type TaskAction } from "./taskActionModel";

type QueueFilter = "all" | "active" | "failed" | "succeeded" | "pending" | "canceled";

const stageOrder: TaskType[] = ["text", "storyboard", "character", "image", "video", "tts", "export"];
const statusPriority: Record<TaskStatus, number> = {
  running: 0,
  failed: 1,
  pending: 2,
  succeeded: 3,
  canceled: 4,
  refunded: 5
};

export function TaskCenterPage({
  tasks,
  onRetry,
  onCancel,
  onRefresh,
  onOpenProject
}: {
  tasks: GenerationTask[];
  onRetry: (taskId: string) => void | Promise<void>;
  onCancel: (taskId: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onOpenProject: (projectId: string) => void;
}) {
  const [activeFilter, setActiveFilter] = useState<QueueFilter>("all");
  const [activeStage, setActiveStage] = useState<TaskType | "all">("all");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [pendingActions, setPendingActions] = useState<PendingTaskActions>({});
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [query, setQuery] = useState("");
  const actionRunner = useRef(createTaskActionRunner()).current;

  async function runAction(taskId: string, action: TaskAction) {
    setActionError("");
    setActionMessage("");
    const result = await actionRunner.run(taskId, action, () => action === "retry" ? onRetry(taskId) : action === "cancel" ? onCancel(taskId) : onRefresh(), setPendingActions);
    if (result.status === "failed") setActionError(result.message);
    if (result.status === "succeeded") setActionMessage(action === "retry" ? "重试请求已提交，任务状态已刷新。" : action === "cancel" ? "取消请求已处理，任务状态已刷新。" : "队列已刷新。");
  }

  const queueStats = useMemo(() => getQueueStats(tasks), [tasks]);
  const queuePolicy = useMemo(() => buildQueuePolicy(tasks), [tasks]);
  const stageGroups = useMemo(() => stageOrder.map((type) => ({
    type,
    tasks: tasks.filter((task) => task.type === type),
    running: tasks.filter((task) => task.type === type && isActiveStatus(task.status)).length,
    failed: tasks.filter((task) => task.type === type && task.status === "failed").length
  })), [tasks]);

  const filteredTasks = useMemo(() => {
    return [...tasks]
      .filter(task => `${task.title} ${task.projectName ?? ""} ${task.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      .filter((task) => activeStage === "all" || task.type === activeStage)
      .filter((task) => {
        if (activeFilter === "all") return true;
        if (activeFilter === "active") return isActiveStatus(task.status);
        return task.status === activeFilter;
      })
      .sort((a, b) => statusPriority[a.status] - statusPriority[b.status] || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [activeFilter, activeStage, tasks, query]);

  const selectedTask = filteredTasks.find((task) => task.id === selectedTaskId) ?? filteredTasks[0];

  useEffect(() => {
    if (!selectedTask) {
      setSelectedTaskId("");
      return;
    }
    if (!filteredTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(selectedTask.id);
    }
  }, [filteredTasks, selectedTask, selectedTaskId]);

  return (
    <div className="page-stack generation-queue-page creator-page" data-tour-id="task-center">
      <PageHeader title="生成队列" description="查看创作进度，处理失败任务。已提交的任务会在后台继续运行。" actions={
          <button className="ghost-button" onClick={() => void runAction("__refresh__", "refresh")} disabled={Boolean(pendingActions.__refresh__)}>
            <RefreshCw size={18} />
            {pendingActions.__refresh__ ? "刷新中…" : "刷新队列"}
          </button>
        } />
      {tasks.length ? <dl className="creator-metrics" aria-label="任务概况"><div><dt>全部任务</dt><dd>{tasks.length}</dd></div><div><dt>生成中</dt><dd>{queueStats.active}</dd></div><div><dt>失败待处理</dt><dd>{queueStats.failed}</dd></div><div><dt>已完成</dt><dd>{queueStats.succeeded}</dd></div></dl> : null}
      {actionError ? <InlineNotice tone="error" onDismiss={() => setActionError("")}>{actionError}</InlineNotice> : null}
      {actionMessage ? <InlineNotice tone="success" onDismiss={() => setActionMessage("")}>{actionMessage}</InlineNotice> : null}
      {tasks.length ? <><div className="creator-list-toolbar queue-search-toolbar">
        <label className="creator-search-field"><span className="creator-sr-only">搜索任务</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索任务、作品或编号" /></label>
        <label className="creator-filter-select"><span>生成类型</span><select value={activeStage} onChange={event => setActiveStage(event.target.value as TaskType | "all")}><option value="all">全部类型</option>{stageGroups.map(stage => <option key={stage.type} value={stage.type}>{taskTypeText(stage.type)} · {stage.tasks.length}</option>)}</select></label>
      </div>
      <div className="queue-filter-row" role="group" aria-label="按任务状态筛选">
        {[
          ["all", "全部"],
          ["active", "生成中"],
          ["pending", "排队中"],
          ["failed", "失败"],
          ["succeeded", "已完成"],
          ["canceled", "已取消"]
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={activeFilter === value ? "active" : ""}
            aria-pressed={activeFilter === value}
            onClick={() => setActiveFilter(value as QueueFilter)}
          >
            {label}
          </button>
        ))}
      </div>
      </> : null}
      <section className={`queue-workspace${filteredTasks.length ? "" : " is-empty"}`}>
        <div className="queue-list-card">
          {tasks.length ? <div className="queue-card-head">
            <div>
              <h2>生成任务</h2>
              <p>按状态优先展示：生成中、失败、排队中、已完成。</p>
            </div>
            <span>{filteredTasks.length} 条</span>
          </div> : null}
          <div className="queue-task-list">
            {filteredTasks.map((task) => {
              const failedLike = canRetryTask(task);
              const cancelableRow = canCancelTask(task);
              return (
                <div
                  key={task.id}
                  className={selectedTask?.id === task.id ? "queue-task-row active" : "queue-task-row"}
                >
                  <button type="button" className="queue-task-select" aria-pressed={selectedTask?.id === task.id} onClick={() => setSelectedTaskId(task.id)}>
                  <span className="queue-task-type">{taskTypeIcon(task.type)}</span>
                  <span className="queue-task-main">
                    <strong>{taskTitleText(task.title)}</strong>
                    <small>{task.projectName ?? "未绑定作品"} · {task.provider || "未记录渠道"} / {task.model || "未记录模型"}</small>
                    <span className="queue-progress-line"><i className={task.status === "running" ? "running" : undefined} style={{ width: `${Math.max(task.status === "running" ? 4 : 0, normalizeProgress(task.progress))}%` }} /></span>
                    {task.status === "failed" && task.errorReason ? (
                      <small className="queue-task-error"><AlertTriangle size={13} />{task.errorReason}</small>
                    ) : null}
                  </span>
                  <span className="queue-task-side">
                    <em className={`queue-status ${task.status}`}>{taskStatusText(task.status)}</em>
                    <small>{normalizeProgress(task.progress)}%</small>
                  </span>
                  </button>
                    {failedLike || cancelableRow ? (
                      <span className="queue-task-actions">
                        {failedLike ? (
                          <button type="button" disabled={Boolean(pendingActions[task.id])} onClick={(event) => { event.stopPropagation(); void runAction(task.id, "retry"); }}>
                            <RotateCcw size={13} />{pendingActions[task.id] === "retry" ? "提交中…" : "重试"}
                          </button>
                        ) : null}
                        {cancelableRow ? (
                          <button type="button" className="danger" disabled={Boolean(pendingActions[task.id])} onClick={(event) => { event.stopPropagation(); void runAction(task.id, "cancel"); }}>
                            <Square size={12} />{pendingActions[task.id] === "cancel" ? "取消中…" : "取消"}
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                </div>
              );
            })}
            {!filteredTasks.length ? <StatePanel compact={Boolean(tasks.length)} title={tasks.length ? "没有匹配的任务" : "暂无生成任务"} description={emptyListText(activeFilter, activeStage, tasks.length)} action={tasks.length ? <button type="button" className="ghost-button" onClick={() => { setQuery(""); setActiveFilter("all"); setActiveStage("all"); }}>清空筛选</button> : <a className="ghost-button" href="#/scripts">查看我的作品</a>} /> : null}
          </div>
        </div>

        {selectedTask ? <TaskDetailPanel task={selectedTask} onOpenProject={onOpenProject} queuePolicy={queuePolicy} pendingAction={pendingActions[selectedTask.id]} onRetry={(id) => void runAction(id, "retry")} onCancel={(id) => void runAction(id, "cancel")} /> : null}
      </section>
      <p className="creator-page-footnote">当前显示你的任务。成功后正式扣费，失败或取消会退回未消耗的冻结积分。</p>
    </div>
  );
}

function TaskDetailPanel({
  task,
  onOpenProject,
  queuePolicy,
  pendingAction,
  onRetry,
  onCancel
}: {
  task?: GenerationTask;
  onOpenProject: (projectId: string) => void;
  queuePolicy: ReturnType<typeof buildQueuePolicy>;
  pendingAction?: TaskAction;
  onRetry: (taskId: string) => void;
  onCancel: (taskId: string) => void;
}) {
  if (!task) {
    return (
      <aside className="queue-detail-card empty"><StatePanel compact title="选择任务查看详情" description="任务结果、积分和失败原因会显示在这里。" /></aside>
    );
  }

  const canRetry = canRetryTask(task);
  const canCancel = canCancelTask(task);
  const progress = normalizeProgress(task.progress);
  const queuePosition = task.status === "pending" ? pendingPosition(task, queuePolicy.pendingTasks) : 0;

  return (
    <aside className="queue-detail-card">
      <div className="queue-detail-head">
        <span className="queue-detail-icon">{taskTypeIcon(task.type)}</span>
        <div>
          <h2>{taskTitleText(task.title)}</h2>
          <p>{task.projectName ?? "未绑定作品"} · {taskTypeText(task.type)}</p>
        </div>
        <em className={`queue-status ${task.status}`}>{taskStatusText(task.status)}</em>
      </div>

      <div className="queue-progress-card">
        <div>
          <strong>{progress}%</strong>
          <span>{task.status === "running" ? "正在生成，请不要重复提交同一任务" : progressHint(task.status)}</span>
        </div>
        <div className="queue-progress-bar"><i className={task.status === "running" ? "running" : undefined} style={{ width: `${Math.max(task.status === "running" ? 4 : 0, progress)}%` }} /></div>
      </div>

      <div className="queue-detail-group">
        <h3>作品与渠道</h3>
        <div className="queue-detail-grid">
          <QueueDetail label="所属作品" value={task.projectName ?? "未记录"} />
          <QueueDetail label="任务类型" value={taskTypeText(task.type)} />
          <QueueDetail label="生成渠道" value={task.provider || "未记录"} />
          <QueueDetail label="使用模型" value={task.model || "未记录"} />
        </div>
      </div>

      <div className="queue-detail-group">
        <h3>积分</h3>
        <div className="queue-detail-grid">
          <QueueDetail label="预估冻结" value={`${task.estimatedCredits} 积分`} />
          <QueueDetail label="实际扣费" value={task.finalCredits != null ? `${task.finalCredits} 积分` : "未结算"} />
        </div>
      </div>

      <div className="queue-detail-group">
        <h3>执行信息</h3>
        <div className="queue-detail-grid">
          <QueueDetail label="参考耗时" value={task.estimatedSeconds ? formatDuration(task.estimatedSeconds) : "等待渠道返回"} />
          <QueueDetail label="我的待处理序号" value={queuePosition ? `第 ${queuePosition} 条` : task.status === "running" ? "执行中" : "-"} />
          <QueueDetail label="创建时间" value={formatTaskTime(task.createdAt)} />
          <QueueDetail label="更新时间" value={formatTaskTime(task.updatedAt)} />
        </div>
        <div className="queue-task-id" title={task.jobId ?? task.id}><span>任务 ID</span><code>{task.jobId ?? task.id}</code></div>
      </div>

      {task.errorReason ? (
        <div className="queue-error-box">
          <strong><AlertTriangle size={14} />失败原因</strong>
          <p>{task.errorReason}</p>
          <p className="queue-error-hint">可直接重试；若同一渠道反复失败，建议在生产台切换模型渠道后再生成。</p>
        </div>
      ) : (
        <div className="queue-next-box">
          <strong>下一步</strong>
          <p>{nextStepText(task)}</p>
        </div>
      )}

      <div className="queue-fallback-box">
        <strong>成本与兜底</strong>
        <p>{task.refundPolicy ?? "失败或取消会退回未消耗积分；成功后正式扣费。"}</p>
        <p>{task.fallbackHint ?? "如同一模型反复失败，可以到生产台切换模型，或向支持人员提交工单。"}</p>
      </div>

      {task.projectId ? <button type="button" className="primary-button" onClick={() => onOpenProject(task.projectId!)}><Film size={16} /> 打开所属作品</button> : <p className="muted">对应作品已不可用，任务记录仍保留。</p>}
      <div className="queue-detail-actions">
        {canRetry ? <button type="button" onClick={() => onRetry(task.id)} disabled={Boolean(pendingAction)}>
          <RotateCcw size={16} />
          {pendingAction === "retry" ? "提交重试中…" : "重试任务"}
        </button> : null}
        {canCancel ? <button type="button" className="danger" onClick={() => onCancel(task.id)} disabled={Boolean(pendingAction)}>
          <Square size={15} />
          {pendingAction === "cancel" ? "取消中…" : "取消任务"}
        </button> : null}
      </div>
    </aside>
  );
}

function QueueStat({
  icon,
  label,
  value,
  hint,
  tone = "default"
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint: string;
  tone?: "default" | "blue" | "green" | "red";
}) {
  return (
    <article className={`queue-stat-card ${tone}`}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{hint}</em>
      </div>
    </article>
  );
}

function PolicyPill({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function QueueDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getQueueStats(tasks: GenerationTask[]) {
  const active = tasks.filter((task) => isActiveStatus(task.status)).length;
  const succeeded = tasks.filter((task) => task.status === "succeeded").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const totalCredits = tasks.reduce((sum, task) => sum + (task.finalCredits ?? 0), 0);
  const activeTasks = tasks.filter((task) => isActiveStatus(task.status));
  const avgProgress = activeTasks.length ? Math.round(activeTasks.reduce((sum, task) => sum + normalizeProgress(task.progress), 0) / activeTasks.length) : 0;
  return { active, succeeded, failed, totalCredits, avgProgress };
}

function buildQueuePolicy(tasks: GenerationTask[]) {
  const pendingTasks = tasks
    .filter((task) => task.status === "pending")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const running = tasks.filter((task) => task.status === "running").length;
  return {
    running,
    pending: pendingTasks.length,
    pendingTasks
  };
}

function pendingPosition(task: GenerationTask, pendingTasks: GenerationTask[]) {
  const index = pendingTasks.findIndex((item) => item.id === task.id);
  return index >= 0 ? index + 1 : 0;
}

function isActiveStatus(status: TaskStatus) {
  return status === "running" || status === "pending";
}

function normalizeProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function taskTypeIcon(type: TaskType) {
  const icons: Record<TaskType, ReactNode> = {
    text: <FileText size={18} />,
    storyboard: <Scissors size={18} />,
    character: <UserRound size={18} />,
    image: <ImageIcon size={18} />,
    video: <Film size={18} />,
    tts: <Volume2 size={18} />,
    export: <Layers3 size={18} />
  };
  return icons[type] ?? <Clock3 size={18} />;
}

function taskTypeText(type: TaskType) {
  const labels: Record<TaskType, string> = {
    text: "剧本生成",
    storyboard: "分镜拆解",
    character: "角色定稿",
    image: "分镜生图",
    video: "视频片段",
    tts: "配音字幕",
    export: "合成导出"
  };
  return labels[type] ?? type;
}

function taskStatusText(status: TaskStatus) {
  const labels: Record<TaskStatus, string> = {
    pending: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    canceled: "已取消",
    refunded: "已退款"
  };
  return labels[status] ?? status;
}

function emptyListText(filter: QueueFilter, stage: TaskType | "all", totalTasks: number) {
  if (!totalTasks) return "还没有生成任务。到「漫剧生产台」生成剧本、分镜或视频后，任务会实时出现在这里。";
  const stagePrefix = stage === "all" ? "" : `「${taskTypeText(stage)}」阶段`;
  const filterTexts: Record<QueueFilter, string> = {
    all: `${stagePrefix}暂无任务记录。`,
    active: `${stagePrefix}当前没有生成中的任务。`,
    pending: `${stagePrefix}当前没有排队中的任务。`,
    failed: `${stagePrefix}没有失败任务，一切正常。`,
    succeeded: `${stagePrefix}还没有已完成的任务。`,
    canceled: `${stagePrefix}没有已取消的任务。`
  };
  return `${filterTexts[filter]} 切回「全部」可查看完整历史。`;
}

function progressHint(status: TaskStatus) {
  const hints: Record<TaskStatus, string> = {
    pending: "等待队列调度",
    running: "正在生成",
    succeeded: "任务已完成",
    failed: "请查看失败原因后重试",
    canceled: "任务已取消",
    refunded: "积分已退款"
  };
  return hints[status] ?? "状态已更新";
}

function nextStepText(task: GenerationTask) {
  if (task.status === "pending") return "任务已进入队列，实际开始时间取决于模型和阶段的可用额度。";
  if (task.status === "running") return "任务生成中，切换页面后仍会继续执行。";
  if (task.status === "succeeded") return "可以回到项目生产台查看生成结果，继续下一阶段。";
  if (task.status === "failed") return "建议先检查模型渠道、图片 URL、内容审核或余额后再重试。";
  return "如需重新生成，可在失败或取消后使用重试。";
}

function formatDuration(seconds: number) {
  if (!seconds) return "0 秒";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
}

function formatTaskTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function taskTitleText(title: string) {
  const labels: Record<string, string> = {
    "Storyboard generation": "分镜拆解生成",
    "Single shot image regeneration": "单镜头分镜图生成",
    "Character reference image generation": "角色多视图参考图生成",
    "核心剧情、剧本与角色卡生成": "核心剧情、剧本与角色卡生成",
    "分镜图批量生成": "分镜图批量生成",
    "9宫格总图裁切生成": "9 宫格总图裁切生成",
    "图生视频生成": "图生视频生成",
    "图生视频任务占位": "图生视频任务",
    "角色参考图生成": "角色参考图生成",
    "9 宫格分镜生成": "9 宫格分镜生成"
  };
  return labels[title] ?? title;
}
