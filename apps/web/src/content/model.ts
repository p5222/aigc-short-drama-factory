import type { ContentProjectMode, ContentProjectSummary, ContentStep, ContentStepStatus } from "@aifilm/shared";

export const creationModes: Array<{ id: ContentProjectMode; label: string; description: string }> = [
  { id: "same_genre", label: "同类爆款", description: "以参考作品为素材，提炼结构后创作新故事" },
  { id: "original", label: "原创故事", description: "从灵感、设定或主题开始搭建完整内容" },
  { id: "adaptation", label: "小说改编", description: "导入已有小说，整理章节并改编为可生产剧本" }
];

export const contentSteps: Array<{ id: ContentStep; label: string }> = [
  { id: "source", label: "素材" }, { id: "analysis", label: "分析" }, { id: "strategy", label: "策略" },
  { id: "outline", label: "大纲" }, { id: "chapter", label: "正文" }, { id: "script", label: "剧本" }, { id: "entity", label: "实体" }
];

export function reconcileProjectId(projects: ContentProjectSummary[], selectedId?: string): string {
  return projects.some((project) => project.id === selectedId) ? selectedId! : projects[0]?.id ?? "";
}

export function statusLabel(status: ContentStepStatus): string {
  return ({ draft: "草稿", running: "处理中", succeeded: "已完成", failed: "失败", confirmed: "已确认" })[status];
}

export function modeLabel(mode: ContentProjectMode): string {
  return creationModes.find((item) => item.id === mode)?.label ?? mode;
}

export function sourceKindForMode(mode: ContentProjectMode): "novel" | "short_story" | "idea" {
  return mode === "adaptation" ? "novel" : mode === "same_genre" ? "short_story" : "idea";
}

export interface RequestToken { projectId: string; sequence: number }
export function isCurrentRequest(current: RequestToken | null, completed: RequestToken): boolean {
  return current?.projectId === completed.projectId && current.sequence === completed.sequence;
}
