import type { ContentProjectMode, ContentProjectSummary, ContentStep, ContentStepStatus, CreateProjectInput } from "@aifilm/shared";

export const creationModes: Array<{ id: ContentProjectMode; label: string; description: string }> = [
  { id: "same_genre", label: "同类创作", description: "先提炼同类爆款结构，再生成全新故事" },
  { id: "original", label: "原创创作", description: "以编导视角，从主题、人物和冲突搭建故事" },
  { id: "adaptation", label: "导入小说", description: "导入已有小说，自动拆章并改编为可生产剧本" }
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

export function buildProductionDraft(project: ContentProjectSummary, content: string): CreateProjectInput & { contentProjectId: string } {
  return {
    title: project.title,
    sourceType: "script",
    content: content.trim(),
    mode: "director",
    genre: "",
    videoRatio: "9:16",
    artStyle: project.styleProfile?.name || "",
    targetEpisodes: Math.max(1, project.chapterCount || 1),
    textProvider: "dashscope-text",
    textModel: "qwen3.7-plus",
    imageProvider: "dashscope-image",
    imageModel: "wan2.6-t2i",
    imageSize: "2048x1152",
    imageQuality: "medium",
    videoProvider: "dashscope-video",
    videoModel: "wan2.7-i2v-2026-04-25",
    contentProjectId: project.id
  };
}

export interface RequestToken { projectId: string; sequence: number }
export function isCurrentRequest(current: RequestToken | null, completed: RequestToken): boolean {
  return current?.projectId === completed.projectId && current.sequence === completed.sequence;
}
