import type { ContentProjectSummary, Project } from "@aifilm/shared";

export type WorksFilter = "all" | "running" | "done" | "draft" | "attention";
type WorkState = { filter: Exclude<WorksFilter, "all">; label: string; tone: "ok" | "busy" | "bad" | "muted" };

export const worksFilterTabs: Array<{ id: WorksFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "running", label: "进行中" },
  { id: "done", label: "已就绪 / 完成" },
  { id: "draft", label: "草稿" },
  { id: "attention", label: "待处理" }
];

const productionStates: Record<Project["status"], WorkState> = {
  draft: { filter: "draft", label: "草稿", tone: "muted" },
  planning: { filter: "running", label: "策划阶段", tone: "busy" },
  scripting: { filter: "running", label: "剧本制作", tone: "busy" },
  storyboarding: { filter: "running", label: "分镜制作", tone: "busy" },
  asseting: { filter: "running", label: "素材制作", tone: "busy" },
  rendering: { filter: "running", label: "视频制作", tone: "busy" },
  completed: { filter: "done", label: "已完成", tone: "ok" }
};

const contentStepLabels: Record<ContentProjectSummary["activeStep"], string> = {
  source: "创作意图", analysis: "结构拆解", strategy: "创作策略", outline: "大纲确认", chapter: "正文创作", script: "剧本生成", entity: "实体提取"
};

export function productionWorkState(project: Pick<Project, "status">): WorkState {
  return productionStates[project.status] ?? { filter: "attention", label: "状态待确认", tone: "muted" };
}

export function contentWorkState(project: Pick<ContentProjectSummary, "status" | "scriptCount" | "activeStep">): WorkState {
  const step = contentStepLabels[project.activeStep] || "创作流程";
  if (project.status === "failed") return { filter: "attention", label: "生成失败", tone: "bad" };
  if (project.status === "stale") return { filter: "attention", label: "内容待更新", tone: "bad" };
  if (project.status === "running") return { filter: "running", label: `生成中 · ${step}`, tone: "busy" };
  if (project.status === "draft") return { filter: "draft", label: `草稿 · ${step}`, tone: "muted" };
  if (!["succeeded", "confirmed"].includes(project.status)) return { filter: "attention", label: "状态待确认", tone: "muted" };
  if (project.scriptCount > 0) return { filter: "done", label: "剧本已就绪", tone: "ok" };
  return { filter: "running", label: `进行到 · ${step}`, tone: "muted" };
}

export function contentMatchesFilter(project: ContentProjectSummary, filter: WorksFilter) {
  return filter === "all" || contentWorkState(project).filter === filter;
}

export function productionMatchesFilter(project: Project, filter: WorksFilter) {
  return filter === "all" || productionWorkState(project).filter === filter;
}

export type WorksSort = "updated" | "title";
export function sortWorks<T extends { id: string; updatedAt: string; title?: string; name?: string }>(items: T[], order: WorksSort = "updated"): T[] {
  const time = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  return [...items].sort((a, b) => {
    const result = order === "title"
      ? (a.title ?? a.name ?? "").localeCompare(b.title ?? b.name ?? "", "zh-CN", { numeric: true })
      : time(b.updatedAt) - time(a.updatedAt);
    return result || a.id.localeCompare(b.id, "en", { numeric: true });
  });
}

export function contentNextAction(project: Pick<ContentProjectSummary, "status" | "scriptCount" | "activeStep">): string {
  const state = contentWorkState(project);
  if (state.filter === "attention") return "检查内容与生成结果";
  if (project.status === "running") return "查看生成进度";
  if (state.filter === "done") return "检查剧本并交接制作";
  return `继续${contentStepLabels[project.activeStep] || "内容创作"}`;
}

export function createWorkDeletionRunner(notify: (state: { projectId: string; pending: boolean; error: string; deleted: boolean }) => void) {
  const pending = new Set<string>();
  return {
    isPending: (projectId: string) => pending.has(projectId),
    async run(projectId: string, remove: () => Promise<void>) {
      if (pending.has(projectId)) return false;
      pending.add(projectId);
      notify({ projectId, pending: true, error: "", deleted: false });
      try {
        await remove();
        notify({ projectId, pending: false, error: "", deleted: true });
        return true;
      } catch (reason) {
        notify({ projectId, pending: false, error: reason instanceof Error ? reason.message : "暂时无法删除，请重试。", deleted: false });
        return false;
      } finally { pending.delete(projectId); }
    }
  };
}
