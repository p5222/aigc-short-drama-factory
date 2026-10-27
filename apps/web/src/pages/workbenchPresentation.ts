import type { GenerationTask, Project, ProjectStatus, TaskStatus } from "@aifilm/shared";

export type ActionTone = "neutral" | "active" | "warning" | "danger" | "success";

const projectStatusLabels: Record<ProjectStatus, string> = {
  draft: "待完善",
  planning: "策划中",
  scripting: "待确认剧本",
  storyboarding: "待确认分镜",
  asseting: "资产制作中",
  rendering: "视频生成中",
  completed: "已完成"
};

const taskStatusLabels: Record<TaskStatus, string> = {
  pending: "等待生成",
  running: "正在生成",
  succeeded: "已完成",
  failed: "失败待处理",
  canceled: "已取消",
  refunded: "已解冻"
};

export function projectStatusLabel(status: ProjectStatus) {
  return projectStatusLabels[status];
}

export function taskStatusLabel(status: TaskStatus) {
  return taskStatusLabels[status];
}

export function projectNextAction(project: Project) {
  const actions: Record<ProjectStatus, string> = {
    draft: "继续完善内容",
    planning: "查看策划结果",
    scripting: "确认剧本",
    storyboarding: "确认分镜",
    asseting: "检查角色与场景",
    rendering: "查看生成进度",
    completed: "查看成片"
  };
  return actions[project.status];
}

export function projectTone(status: ProjectStatus): ActionTone {
  if (status === "completed") return "success";
  if (status === "scripting" || status === "storyboarding") return "warning";
  if (status === "rendering" || status === "asseting") return "active";
  return "neutral";
}

export function collectWorkbenchActions(projects: Project[], tasks: GenerationTask[]) {
  const failed = tasks.filter((task) => task.status === "failed");
  const active = tasks.filter((task) => task.status === "running" || task.status === "pending");
  const waiting = projects.filter((project) => project.status === "scripting" || project.status === "storyboarding");
  return { failed, active, waiting };
}

export function formatRelativeUpdate(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "时间未知";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(value).toLocaleDateString("zh-CN");
}
