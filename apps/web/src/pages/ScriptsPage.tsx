import { BookOpen, Clapperboard, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ContentProjectSummary, Project } from "@aifilm/shared";
import { contentMatchesFilter, contentWorkState, createWorkDeletionRunner, productionMatchesFilter, productionWorkState, worksFilterTabs, type WorksFilter } from "./scriptsPageModel";
import "./scripts-page.css";

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
  onDelete: (projectId: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<WorksFilter>("all");
  const [deletingIds, setDeletingIds] = useState(new Set<string>());
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [deleteNotice, setDeleteNotice] = useState("");
  const deletionRunner = useRef(createWorkDeletionRunner((state) => {
    setDeletingIds((current) => {
      const next = new Set(current);
      if (state.pending) next.add(state.projectId); else next.delete(state.projectId);
      return next;
    });
    setDeleteErrors((current) => ({ ...current, [state.projectId]: state.error }));
  }));
  const visibleContent = useMemo(() => contentProjects.filter((item) => contentMatchesFilter(item, filter)), [contentProjects, filter]);
  const visibleProjects = useMemo(() => projects.filter((item) => productionMatchesFilter(item, filter)), [projects, filter]);
  const totalCount = contentProjects.length + projects.length;

  async function deleteWork(project: Project) {
    if (deletionRunner.current.isPending(project.id) || openingId === project.id) return;
    if (!window.confirm(`确认删除“${project.name}”？作品下的脚本、分镜、资产和生成任务都会删除，此操作不可恢复。`)) return;
    setDeleteNotice("");
    if (await deletionRunner.current.run(project.id, () => onDelete(project.id))) setDeleteNotice(`已删除作品“${project.name}”。`);
  }

  return (
    <div className="page-stack scripts-page">
      <div className="page-title row-title">
        <div>
          <h1>我的作品</h1>
          <p>共 {totalCount} 部作品：{contentProjects.length} 部内容创作、{projects.length} 部漫剧作品。选择作品继续创作。</p>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" type="button" onClick={onNewContent}>
            <BookOpen size={16} /> 新建内容创作
          </button>
          <button className="primary-button" type="button" onClick={onNew}>
            <Plus size={16} /> 新建漫剧作品
          </button>
        </div>
      </div>
      <div className="tabs" role="group" aria-label="按作品状态筛选">
        {worksFilterTabs.map((tab) => (
          <button key={tab.id} type="button" className={tab.id === filter ? "active" : ""} aria-pressed={tab.id === filter} onClick={() => setFilter(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      {deleteNotice ? <p className="works-feedback" role="status">{deleteNotice}</p> : null}

      <section className="panel works-section" aria-labelledby="works-content-heading">
        <header className="works-section-head">
          <BookOpen size={17} />
          <div>
            <h2 id="works-content-heading">内容创作</h2>
            <small>小说 / 大纲 / 章节，从这里开始，可交接进入漫剧制作</small>
          </div>
          <span className="works-count">{visibleContent.length}</span>
        </header>
        {visibleContent.length ? (
          <div className="project-grid">
            {visibleContent.map((item) => {
              const status = contentWorkState(item);
              return (
                <article className="project-card content-work-card" key={item.id} aria-labelledby={`content-work-${item.id}`}>
                  <div className="works-card-heading">
                    <h3 id={`content-work-${item.id}`}><button className="works-card-open" type="button" aria-label={`打开内容创作 ${item.title}`} onClick={() => onOpenContent(item.id)}>{item.title}</button></h3>
                    <span className={`work-status is-${status.tone}`}>{status.label}</span>
                  </div>
                  <p>
                    {item.chapterCount > 0 ? `已生成 ${item.chapterCount} 章正文` : "尚未生成正文"}
                    {status.filter === "done" ? " · 剧本已就绪，可进入漫剧制作" : item.scriptCount > 0 ? " · 保留已有剧本，请先处理当前阶段" : ""}
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

      <section className="panel works-section" data-tour-id="project-list" aria-labelledby="works-production-heading">
        <header className="works-section-head">
          <Clapperboard size={17} />
          <div>
            <h2 id="works-production-heading">漫剧作品</h2>
            <small>分镜、图片、视频与成片都在作品生产台里</small>
          </div>
          <span className="works-count">{visibleProjects.length}</span>
        </header>
        {visibleProjects.length ? (
          <div className="project-grid">
            {visibleProjects.map((project) => {
              const status = productionWorkState(project);
              const opening = openingId === project.id;
              const deleting = deletingIds.has(project.id);
              return <article className={`project-card ${opening ? "is-opening" : ""}`} key={project.id} aria-labelledby={`production-work-${project.id}`} aria-busy={opening || deleting}>
                <div className="works-card-heading">
                  <h3 id={`production-work-${project.id}`}><button className="works-card-open" type="button" disabled={opening || deleting} aria-label={`打开漫剧作品 ${project.name}`} onClick={() => onOpen(project.id)}>{project.name}</button></h3>
                  <span className={`work-status is-${status.tone}`}>{status.label}</span>
                  <small>
                    {project.type} · {project.videoRatio}
                  </small>
                </div>
                <p>{project.intro}</p>
                <div className="project-stats">
                  <span>{project.episodes} 集</span>
                  <span>{project.storyboards} 分镜</span>
                  <span>{project.characters} 角色</span>
                  <span>{project.creditsSpent} 积分</span>
                </div>
                <div className="works-card-footer">
                  <span>{deleting ? "正在删除，请稍候…" : "进入生产台继续制作"}</span>
                  <button className="works-card-delete" type="button" disabled={opening || deleting} aria-label={`删除作品 ${project.name}`} onClick={() => void deleteWork(project)}>{deleting ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}<span>{deleting ? "删除中" : "删除"}</span></button>
                </div>
                {deleteErrors[project.id] ? <p className="works-delete-error" role="alert">删除失败：{deleteErrors[project.id]} 当前作品仍保留在列表中。</p> : null}
                {opening ? (
                  <div className="card-opening-mask" role="status">
                    <LoaderCircle size={18} className="spin" /> 正在打开…
                  </div>
                ) : null}
              </article>;
            })}
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
