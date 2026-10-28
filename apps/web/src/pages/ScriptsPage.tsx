import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentProjectSummary, Project } from "@aifilm/shared";
import { contentMatchesFilter, contentNextAction, contentWorkState, createWorkDeletionRunner, productionMatchesFilter, productionWorkState, sortWorks, worksFilterTabs, type WorksFilter, type WorksSort } from "./scriptsPageModel";
import { ListPagination } from "../components/ListPagination";
import { projectNextAction } from "./workbenchPresentation";
import "./scripts-page.css";
import { ConfirmDialog, InlineNotice, PageHeader, StatePanel } from "../design-system/ui";
import { StudioIcon } from "../design-system/StudioIcon";
import "./creator-pages.css";

export function ScriptsPage({
  projects,
  contentProjects,
  openingId,
  onOpen,
  onOpenContent,
  onNew,
  onNewContent,
  onDelete,
  onDeleteContent
}: {
  projects: Project[];
  contentProjects: ContentProjectSummary[];
  openingId?: string;
  onOpen: (projectId: string) => void;
  onOpenContent: (contentProjectId: string) => void;
  onNew: () => void;
  onNewContent: () => void;
  onDelete: (projectId: string) => Promise<void>;
  onDeleteContent: (projectId: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<WorksFilter>("all");
  const [deletingIds, setDeletingIds] = useState(new Set<string>());
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [deleteNotice, setDeleteNotice] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; kind: "production" | "content" } | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WorksSort>("updated");
  const [contentPage, setContentPage] = useState(1);
  const [productionPage, setProductionPage] = useState(1);
  const pageSize = 12;
  useEffect(() => { setContentPage(1); setProductionPage(1); }, [query, filter, sort]);
  const deletionRunner = useRef(createWorkDeletionRunner((state) => {
    setDeletingIds((current) => {
      const next = new Set(current);
      if (state.pending) next.add(state.projectId); else next.delete(state.projectId);
      return next;
    });
    setDeleteErrors((current) => ({ ...current, [state.projectId]: state.error }));
  }));
  const visibleContent = useMemo(() => sortWorks(contentProjects.filter((item) => contentMatchesFilter(item, filter) && item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), sort), [contentProjects, filter, query, sort]);
  const visibleProjects = useMemo(() => sortWorks(projects.filter((item) => productionMatchesFilter(item, filter) && `${item.name} ${item.intro ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), sort), [projects, filter, query, sort]);
  const currentContentPage = Math.min(contentPage, Math.max(1, Math.ceil(visibleContent.length / pageSize)));
  const currentProductionPage = Math.min(productionPage, Math.max(1, Math.ceil(visibleProjects.length / pageSize)));
  useEffect(() => { setContentPage(currentContentPage); setProductionPage(currentProductionPage); }, [currentContentPage, currentProductionPage]);
  const totalCount = contentProjects.length + projects.length;
  const sectionOrder = !visibleContent.length && visibleProjects.length ? ["production", "content"] : ["content", "production"];

  async function deleteWork(project: NonNullable<typeof deleteTarget>) {
    const key = `${project.kind}:${project.id}`;
    if (deletionRunner.current.isPending(key) || openingId === project.id) return;
    setDeleteNotice("");
    if (await deletionRunner.current.run(key, () => project.kind === "content" ? onDeleteContent(project.id) : onDelete(project.id))) {
      setDeleteNotice(`已删除作品“${project.name}”。`);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="page-stack scripts-page creator-page">
      <PageHeader title="我的作品" description={`共 ${totalCount} 部作品 · 从故事到成片，继续上次创作。`} actions={<>
          <button className="ghost-button" type="button" onClick={onNewContent}>
            <StudioIcon stage="content" size={18} /> 写新故事
          </button>
          <button className="primary-button" type="button" onClick={onNew}>
            <Plus size={16} /> 新建漫剧
          </button>
        </>} />
      <div className="creator-list-toolbar">
      <label className="creator-search-field"><span className="creator-sr-only">搜索我的作品</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索作品名称或简介" /></label>
      <label className="creator-filter-select"><span>作品排序</span><select value={sort} onChange={event => setSort(event.target.value as WorksSort)}><option value="updated">最近更新优先</option><option value="title">按名称排序</option></select></label>
      </div>
      <div className="works-filter-bar">
      <div className="tabs" role="group" aria-label="按作品状态筛选">
        {worksFilterTabs.map((tab) => (
          <button key={tab.id} type="button" className={tab.id === filter ? "active" : ""} aria-pressed={tab.id === filter} onClick={() => setFilter(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      <span className="works-result-count" role="status">找到 {visibleContent.length + visibleProjects.length} 部作品</span>
      </div>
      {deleteNotice ? <InlineNotice tone="success" onDismiss={() => setDeleteNotice("")}>{deleteNotice}</InlineNotice> : null}

      {sectionOrder.map(kind => kind === "content" ? (
      <section key="content" className={`panel works-section${!visibleContent.length && visibleProjects.length ? " is-compact-empty" : ""}`} aria-labelledby="works-content-heading">
        <header className="works-section-head">
          <StudioIcon stage="content" size={20} />
          <div>
            <h2 id="works-content-heading">内容创作</h2>
            <small>小说 / 大纲 / 章节，从这里开始，可交接进入漫剧制作</small>
          </div>
          <span className="works-count">{visibleContent.length}</span>
          {!visibleContent.length && visibleProjects.length ? <button type="button" className="ghost-button" onClick={query || filter !== "all" ? () => { setQuery(""); setFilter("all"); } : onNewContent}>{query || filter !== "all" ? "清空筛选" : "写新故事"}</button> : null}
        </header>
        {visibleContent.length ? (
          <div className="project-grid">
            {visibleContent.slice((currentContentPage - 1) * pageSize, currentContentPage * pageSize).map((item) => {
              const status = contentWorkState(item);
              const key = `content:${item.id}`;
              const deleting = deletingIds.has(key);
              return (
                <article className="project-card content-work-card" key={item.id} aria-labelledby={`content-work-${item.id}`}>
                  <div className="studio-work-kind"><StudioIcon stage="content" size={18} /><span>故事手稿</span><small>{item.chapterCount} 章</small></div>
                  <div className="works-card-heading">
                    <h3 id={`content-work-${item.id}`}><button className="works-card-open" type="button" disabled={deleting} aria-label={`打开内容创作 ${item.title}`} onClick={() => onOpenContent(item.id)}>{item.title}</button></h3>
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
                  <div className="works-card-footer"><span>{deleting ? "正在删除，请稍候…" : contentNextAction(item)}</span><button className="works-card-delete" type="button" disabled={deleting} aria-label={`删除故事 ${item.title}`} onClick={() => setDeleteTarget({ id: item.id, name: item.title, kind: "content" })}>{deleting ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}<span>{deleting ? "删除中" : "删除"}</span></button></div>
                  {deleteErrors[key] ? <p className="works-delete-error" role="alert">删除失败：{deleteErrors[key]} 当前故事仍保留在列表中。</p> : null}
                </article>
              );
            })}
          </div>
        ) : !visibleProjects.length ? (
          <StatePanel compact title={query || filter !== "all" ? "没有匹配的故事" : "从一个故事开始"} description={query || filter !== "all" ? "试试其他关键词或查看全部状态。" : "写下灵感，逐步形成大纲、章节与可制作的剧本。"} action={query || filter !== "all" ? <button type="button" className="ghost-button" onClick={() => { setQuery(""); setFilter("all"); }}>清空筛选</button> : <button type="button" className="ghost-button" onClick={onNewContent}>写新故事</button>} />
        ) : null}
        <ListPagination label="故事" total={visibleContent.length} page={currentContentPage} pageSize={pageSize} onChange={setContentPage} />
      </section>
      ) : (
      <section key="production" className={`panel works-section${!visibleProjects.length && visibleContent.length ? " is-compact-empty" : ""}`} data-tour-id="project-list" aria-labelledby="works-production-heading">
        <header className="works-section-head">
          <StudioIcon stage="shots" size={20} />
          <div>
            <h2 id="works-production-heading">漫剧作品</h2>
            <small>分镜、图片、视频与成片都在作品生产台里</small>
          </div>
          <span className="works-count">{visibleProjects.length}</span>
          {!visibleProjects.length && visibleContent.length ? <button type="button" className="ghost-button" onClick={query || filter !== "all" ? () => { setQuery(""); setFilter("all"); } : onNew}>{query || filter !== "all" ? "清空筛选" : "新建漫剧"}</button> : null}
        </header>
        {visibleProjects.length ? (
          <div className="project-grid">
            {visibleProjects.slice((currentProductionPage - 1) * pageSize, currentProductionPage * pageSize).map((project) => {
              const status = productionWorkState(project);
              const opening = openingId === project.id;
              const key = `production:${project.id}`;
              const deleting = deletingIds.has(key);
              return <article className={`project-card ${opening ? "is-opening" : ""}`} key={project.id} aria-labelledby={`production-work-${project.id}`} aria-busy={opening || deleting}>
                <div className="studio-work-kind"><StudioIcon stage="shots" size={18} /><span>漫剧项目</span><small>{project.videoRatio}</small></div>
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
                  <span>{deleting ? "正在删除，请稍候…" : projectNextAction(project)}</span>
                  <button className="works-card-delete" type="button" disabled={opening || deleting} aria-label={`删除作品 ${project.name}`} onClick={() => setDeleteTarget({ id: project.id, name: project.name, kind: "production" })}>{deleting ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}<span>{deleting ? "删除中" : "删除"}</span></button>
                </div>
                {deleteErrors[key] ? <p className="works-delete-error" role="alert">删除失败：{deleteErrors[key]} 当前作品仍保留在列表中。</p> : null}
                {opening ? (
                  <div className="card-opening-mask" role="status">
                    <LoaderCircle size={18} className="spin" /> 正在打开…
                  </div>
                ) : null}
              </article>;
            })}
          </div>
        ) : !visibleContent.length ? (
          <StatePanel compact title={query || filter !== "all" ? "没有匹配的漫剧" : "准备制作第一部漫剧"} description={query || filter !== "all" ? "试试其他关键词或查看全部状态。" : "导入小说或剧本，确认设置后开始制作。"} action={query || filter !== "all" ? <button type="button" className="ghost-button" onClick={() => { setQuery(""); setFilter("all"); }}>清空筛选</button> : <button type="button" className="primary-button" onClick={onNew}>新建漫剧</button>} />
        ) : null}
        <ListPagination label="漫剧" total={visibleProjects.length} page={currentProductionPage} pageSize={pageSize} onChange={setProductionPage} />
      </section>
      ))}
      <ConfirmDialog open={Boolean(deleteTarget)} title="删除这部作品？" description={<>{deleteTarget?.name}<br />{deleteTarget?.kind === "content" ? "分析、大纲、章节及内容版本都会删除；已交接的漫剧项目保留。" : "剧本、分镜和资产都会删除；任务与积分历史保留。"}此操作不可恢复。{deleteTarget && deleteErrors[`${deleteTarget.kind}:${deleteTarget.id}`] ? <span className="creator-confirm-error" role="alert">{deleteErrors[`${deleteTarget.kind}:${deleteTarget.id}`]} 作品仍保留，可以重试。</span> : null}</>} confirmLabel="删除作品" danger pending={deleteTarget ? deletingIds.has(`${deleteTarget.kind}:${deleteTarget.id}`) : false} onConfirm={() => { if (deleteTarget) void deleteWork(deleteTarget); }} onCancel={() => setDeleteTarget(null)} />
    </div>
  );
}
