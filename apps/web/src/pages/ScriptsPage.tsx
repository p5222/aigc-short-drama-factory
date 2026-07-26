import { BookOpen, Clapperboard, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { ContentProjectSummary, Project } from "@aifilm/shared";

type WorksFilter = "all" | "running" | "done" | "draft";

const filterTabs: Array<{ id: WorksFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "running", label: "进行中" },
  { id: "done", label: "已完成" },
  { id: "draft", label: "草稿" }
];

const contentStepLabels: Record<string, string> = {
  source: "创作意图",
  analysis: "结构拆解",
  outline: "大纲确认",
  chapter: "正文创作",
  script: "剧本生成",
  entity: "实体提取"
};

function contentStatusMeta(project: ContentProjectSummary): { label: string; tone: "ok" | "busy" | "bad" | "muted" } {
  if (project.status === "failed") return { label: "生成失败", tone: "bad" };
  if (project.status === "running") return { label: "生成中", tone: "busy" };
  if (project.scriptCount > 0) return { label: "已完成", tone: "ok" };
  return { label: `进行到 · ${contentStepLabels[project.activeStep] ?? project.activeStep}`, tone: "muted" };
}

function contentMatchesFilter(project: ContentProjectSummary, filter: WorksFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running") return project.status === "running" || (project.status !== "failed" && project.scriptCount === 0 && project.chapterCount > 0);
  if (filter === "done") return project.scriptCount > 0;
  return project.status === "draft" || (project.chapterCount === 0 && project.scriptCount === 0);
}

function productionMatchesFilter(project: Project, filter: WorksFilter): boolean {
  if (filter === "all") return true;
  const status = String(project.status);
  if (filter === "running") return ["generating", "running", "in_progress", "processing"].includes(status);
  if (filter === "done") return ["completed", "succeeded", "done", "exported"].includes(status);
  return ["draft", "created", "pending"].includes(status);
}

export function ScriptsPage({
  projects,
  contentProjects,
  openingId,
  onOpen,
  onOpenContent,
  onNew,
  onNewContent,
  onDelete
}: {
  projects: Project[];
  contentProjects: ContentProjectSummary[];
  openingId?: string;
  onOpen: (projectId: string) => void;
  onOpenContent: (contentProjectId: string) => void;
  onNew: () => void;
  onNewContent: () => void;
  onDelete: (projectId: string) => void;
}) {
  const [filter, setFilter] = useState<WorksFilter>("all");
  const visibleContent = useMemo(() => contentProjects.filter((item) => contentMatchesFilter(item, filter)), [contentProjects, filter]);
  const visibleProjects = useMemo(() => projects.filter((item) => productionMatchesFilter(item, filter)), [projects, filter]);
  const totalCount = contentProjects.length + projects.length;

  return (
    <div className="page-stack">
      <div className="page-title row-title">
        <div>
          <h1>我的作品</h1>
          <p>共 {totalCount} 部作品：{contentProjects.length} 部内容创作、{projects.length} 部漫剧作品。点击卡片继续创作。</p>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={onNewContent}>
            <BookOpen size={16} /> 新建内容创作
          </button>
          <button className="primary-button" onClick={onNew}>
            <Plus size={16} /> 新建漫剧作品
          </button>
        </div>
      </div>
      <div className="tabs">
        {filterTabs.map((tab) => (
          <button key={tab.id} className={tab.id === filter ? "active" : ""} onClick={() => setFilter(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      <section className="panel works-section">
        <header className="works-section-head">
          <BookOpen size={17} />
          <div>
            <strong>内容创作</strong>
            <small>小说 / 大纲 / 章节，从这里开始，可交接进入漫剧制作</small>
          </div>
          <span className="works-count">{visibleContent.length}</span>
        </header>
        {visibleContent.length ? (
          <div className="project-grid">
            {visibleContent.map((item) => {
              const status = contentStatusMeta(item);
              return (
                <article className="project-card clickable content-work-card" key={item.id} onClick={() => onOpenContent(item.id)}>
                  <div>
                    <strong>{item.title}</strong>
                    <span className={`work-status is-${status.tone}`}>{status.label}</span>
                  </div>
                  <p>
                    {item.chapterCount > 0 ? `已生成 ${item.chapterCount} 章正文` : "尚未生成正文"}
                    {item.scriptCount > 0 ? " · 剧本已就绪，可进入漫剧制作" : ""}
                  </p>
                  <div className="project-stats">
                    <span>{item.chapterCount} 章</span>
                    <span>{item.scriptCount} 剧本</span>
                    <span>{item.styleProfile?.name || "风格自动"}</span>
                    <span>{new Date(item.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 更新</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            {filter === "all" ? "还没有内容创作项目，点右上角「新建内容创作」开始。" : "该状态下暂无内容创作项目。"}
          </div>
        )}
      </section>

      <section className="panel works-section" data-tour-id="project-list">
        <header className="works-section-head">
          <Clapperboard size={17} />
          <div>
            <strong>漫剧作品</strong>
            <small>分镜、图片、视频与成片都在作品生产台里</small>
          </div>
          <span className="works-count">{visibleProjects.length}</span>
        </header>
        {visibleProjects.length ? (
          <div className="project-grid">
            {visibleProjects.map((project) => (
              <article className={`project-card clickable ${openingId === project.id ? "is-opening" : ""}`} key={project.id} onClick={() => onOpen(project.id)}>
                <div>
                  <strong>{project.name}</strong>
                  <button className="icon-button danger" title="删除作品" aria-label={`删除作品 ${project.name}`} onClick={(event) => { event.stopPropagation(); if (window.confirm(`确认删除“${project.name}”？作品下的脚本、分镜、资产和生成任务都会删除。`)) onDelete(project.id); }}><Trash2 size={15} /></button>
                  <span>
                    {project.type} · {project.videoRatio}
                  </span>
                </div>
                <p>{project.intro}</p>
                <div className="project-stats">
                  <span>{project.episodes} 集</span>
                  <span>{project.storyboards} 分镜</span>
                  <span>{project.characters} 角色</span>
                  <span>{project.creditsSpent} 积分</span>
                </div>
                {openingId === project.id ? (
                  <div className="card-opening-mask">
                    <LoaderCircle size={18} className="spin" /> 正在打开…
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            {filter === "all" ? "还没有漫剧作品。可以在内容创作完成剧本后交接进入，或直接「新建漫剧作品」。" : "该状态下暂无漫剧作品。"}
          </div>
        )}
      </section>
    </div>
  );
}
