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
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { GenerationTask, TaskStatus, TaskType } from "@aifilm/shared";

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
  onRefresh
}: {
  tasks: GenerationTask[];
  onRetry: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onRefresh: () => void;
}) {
  const [activeFilter, setActiveFilter] = useState<QueueFilter>("all");
  const [activeStage, setActiveStage] = useState<TaskType | "all">("all");
  const [selectedTaskId, setSelectedTaskId] = useState("");

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
      .filter((task) => activeStage === "all" || task.type === activeStage)
      .filter((task) => {
        if (activeFilter === "all") return true;
        if (activeFilter === "active") return isActiveStatus(task.status);
        return task.status === activeFilter;
      })
      .sort((a, b) => statusPriority[a.status] - statusPriority[b.status] || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [activeFilter, activeStage, tasks]);

  const selectedTask = filteredTasks.find((task) => task.id === selectedTaskId) ?? filteredTasks[0] ?? tasks[0];

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
    <div className="page-stack generation-queue-page" data-tour-id="task-center">
      <div className="queue-hero">
        <div>
          <span className="queue-eyebrow"><Sparkles size={16} /> 漫角生产调度</span>
          <h1>生成队列</h1>
          <p>剧本、分镜、角色三视图、分镜生图、图生视频和导出任务统一在这里查看进度、定位失败原因，并选择重试或取消。</p>
        </div>
        <div className="queue-hero-actions">
          <button className="ghost-button" onClick={onRefresh}>
            <RefreshCw size={18} />
            刷新队列
          </button>
        </div>
      </div>

      <div className="queue-stat-grid">
        <QueueStat icon={<Layers3 size={21} />} label="总任务" value={tasks.length} hint={`${queueStats.totalCredits} 预计积分`} />
        <QueueStat icon={<Loader2 size={21} className={queueStats.active ? "spin-icon" : ""} />} label="生成中" value={queueStats.active} hint={`${queueStats.avgProgress}% 平均进度`} tone="blue" />
        <QueueStat icon={<CheckCircle2 size={21} />} label="已完成" value={queueStats.succeeded} hint={`${queueStats.successRate}% 成功率`} tone="green" />
        <QueueStat icon={<AlertTriangle size={21} />} label="失败待处理" value={queueStats.failed} hint="可在右侧查看原因" tone="red" />
      </div>

      <section className="queue-policy-strip">
        <PolicyPill label="并发限制" value={`同时 ${queuePolicy.concurrency} 个`} hint={queuePolicy.running >= queuePolicy.concurrency ? "已达上限，新任务会排队" : "仍可接收新任务"} />
        <PolicyPill label="等待任务" value={`${queuePolicy.pending} 个`} hint="文本任务由 BullMQ 调度；图片/视频按阶段限流" />
        <PolicyPill label="退费规则" value="失败/取消退冻结" hint="成功后正式扣费，失败任务可重试或切模型继续" />
      </section>

      <section className="queue-stage-board">
        {stageGroups.map((stage) => (
          <button
            type="button"
            key={stage.type}
            className={activeStage === stage.type ? "queue-stage-card active" : "queue-stage-card"}
            onClick={() => setActiveStage(activeStage === stage.type ? "all" : stage.type)}
          >
            <span className="queue-stage-icon">{taskTypeIcon(stage.type)}</span>
            <strong>{taskTypeText(stage.type)}</strong>
            <small>{stage.tasks.length} 个任务 · {stage.running} 生成中</small>
            <em>{stage.failed ? `${stage.failed} 个失败` : "状态正常"}</em>
          </button>
        ))}
      </section>

      <div className="queue-filter-row">
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
            onClick={() => setActiveFilter(value as QueueFilter)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="queue-workspace">
        <div className="queue-list-card">
          <div className="queue-card-head">
            <div>
              <h2>生成任务</h2>
              <p>按状态优先展示：生成中、失败、排队中、已完成。</p>
            </div>
            <span>{filteredTasks.length} 条</span>
          </div>
          <div className="queue-task-list">
            {filteredTasks.map((task) => (
              <button
                type="button"
                key={task.id}
                className={selectedTask?.id === task.id ? "queue-task-row active" : "queue-task-row"}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <span className="queue-task-type">{taskTypeIcon(task.type)}</span>
                <span className="queue-task-main">
                  <strong>{taskTitleText(task.title)}</strong>
                  <small>{task.projectName ?? "未绑定作品"} · {task.provider || "未记录渠道"} / {task.model || "未记录模型"}</small>
                  <span className="queue-progress-line"><i style={{ width: `${normalizeProgress(task.progress)}%` }} /></span>
                </span>
                <span className="queue-task-side">
                  <em className={`queue-status ${task.status}`}>{taskStatusText(task.status)}</em>
                  <small>{normalizeProgress(task.progress)}%</small>
                </span>
              </button>
            ))}
            {!filteredTasks.length ? <div className="queue-empty">当前筛选没有任务。切回“全部”可以查看历史记录。</div> : null}
          </div>
        </div>

        <TaskDetailPanel task={selectedTask} queuePolicy={queuePolicy} onRetry={onRetry} onCancel={onCancel} />
      </section>
    </div>
  );
}

function TaskDetailPanel({
  task,
  queuePolicy,
  onRetry,
  onCancel
}: {
  task?: GenerationTask;
  queuePolicy: ReturnType<typeof buildQueuePolicy>;
  onRetry: (taskId: string) => void;
  onCancel: (taskId: string) => void;
}) {
  if (!task) {
    return (
      <aside className="queue-detail-card empty">
        <Megaphone size={28} />
        <strong>暂无生成任务</strong>
        <p>新建漫剧、生成分镜图或视频后，这里会展示当前任务的进度、模型和失败原因。</p>
      </aside>
    );
  }

  const canRetry = task.status === "failed" || task.status === "canceled" || task.status === "refunded";
  const canCancel = Boolean(task.cancelable ?? (task.status === "pending" || task.status === "running"));
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
        <div className="queue-progress-bar"><i style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="queue-detail-grid">
        <QueueDetail label="作品" value={task.projectName ?? "未记录"} />
        <QueueDetail label="渠道" value={task.provider || "未记录"} />
        <QueueDetail label="模型" value={task.model || "未记录"} />
        <QueueDetail label="预计积分" value={`${task.estimatedCredits}`} />
        <QueueDetail label="实际积分" value={`${task.finalCredits ?? "-"}`} />
        <QueueDetail label="预计耗时" value={formatDuration(task.estimatedSeconds ?? estimateTaskSeconds(task))} />
        <QueueDetail label="队列位置" value={queuePosition ? `第 ${queuePosition} 位` : task.status === "running" ? "执行中" : "-"} />
        <QueueDetail label="任务 ID" value={task.jobId ?? task.id} />
        <QueueDetail label="更新时间" value={formatTaskTime(task.updatedAt)} />
      </div>

      {task.errorReason ? (
        <div className="queue-error-box">
          <strong>失败原因</strong>
          <p>{task.errorReason}</p>
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
        <p>{task.fallbackHint ?? "可切换模型或检查后台渠道配置后重试。"}</p>
      </div>

      <div className="queue-detail-actions">
        <button type="button" onClick={() => onRetry(task.id)} disabled={!canRetry}>
          <RotateCcw size={16} />
          切模型后重试
        </button>
        <button type="button" className="danger" onClick={() => onCancel(task.id)} disabled={!canCancel}>
          <Square size={15} />
          取消任务
        </button>
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
  const totalCredits = tasks.reduce((sum, task) => sum + (task.finalCredits ?? task.estimatedCredits ?? 0), 0);
  const avgProgress = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + normalizeProgress(task.progress), 0) / tasks.length) : 0;
  const successRate = tasks.length ? Math.round((succeeded / tasks.length) * 100) : 0;
  return { active, succeeded, failed, totalCredits, avgProgress, successRate };
}

function buildQueuePolicy(tasks: GenerationTask[]) {
  const pendingTasks = tasks
    .filter((task) => task.status === "pending")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const running = tasks.filter((task) => task.status === "running").length;
  return {
    concurrency: 1,
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
  if (task.status === "pending") return "任务已经进入队列，等待后端 worker 调度。";
  if (task.status === "running") return "任务生成中，页面切换不会影响后端队列继续执行。";
  if (task.status === "succeeded") return "可以回到项目生产台查看生成结果，继续下一阶段。";
  if (task.status === "failed") return "建议先检查模型渠道、图片 URL、内容审核或余额后再重试。";
  return "如需重新生成，可在失败或取消后使用重试。";
}

function estimateTaskSeconds(task: GenerationTask) {
  const base: Record<TaskType, number> = {
    text: 45,
    storyboard: 35,
    character: 90,
    image: 75,
    video: 180,
    tts: 30,
    export: 20
  };
  return Math.max(base[task.type] ?? 40, Math.round((task.estimatedCredits || 1) * (task.type === "video" ? 8 : 3)));
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
