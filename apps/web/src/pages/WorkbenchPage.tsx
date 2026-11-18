import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Clock3, Film, Plus, Sparkles } from "lucide-react";
import type { ContentProjectSummary, WorkbenchSummary } from "@aifilm/shared";
import { contentNextAction, contentWorkState, sortWorks } from "./scriptsPageModel";
import { StatePanel } from "../design-system/ui";
import { collectWorkbenchActions, formatRelativeUpdate, projectNextAction, projectStatusLabel, projectTone, taskStatusLabel } from "./workbenchPresentation";
import { ChevronDown, Megaphone, Pin } from "lucide-react";
import { StudioIcon } from "../design-system/StudioIcon";
import "./workbench-announcements.css";
import "./workbench-workflow.css";
import { CreatorWelcome, type ShortEntry } from "../content/CreatorWelcome";

interface WorkbenchPageProps {
  userId: string;
  onStartShort: (entry: ShortEntry) => void;
  summary?: WorkbenchSummary;
  contentProjects?: ContentProjectSummary[];
  onOpenContent: (id: string) => void;
  onRefresh: () => void;
  onOpen: (projectId: string) => void;
  onOpenTasks: (filter?: "active" | "failed" | "review", taskId?: string) => void;
  onOpenWorks: () => void;
  onStartContent: () => void;
}

export function WorkbenchPage({ userId, onStartShort, summary, contentProjects, onOpenContent, onRefresh, onOpen, onOpenTasks, onOpenWorks, onStartContent }: WorkbenchPageProps) {
  const projects = summary?.recentProjects ?? [];
  const tasks = summary?.recentTasks ?? [];
  const actions = collectWorkbenchActions(summary?.actionProjects ?? projects, tasks);
  const counts = summary?.actionCounts;
  const latestProject = projects[0];
  const stories = sortWorks(contentProjects ?? []).slice(0, 3);
  const latestStory = stories[0];
  const resumeStory = latestStory && (!latestProject || (Date.parse(latestStory.updatedAt) || 0) > (Date.parse(latestProject.updatedAt) || 0));
  const announcements: Array<WorkbenchSummary["announcements"][number] & { pinned?: boolean }> = summary?.announcements ?? [];

  return (
    <div className="page-stack dashboard-page dashboard-action-page">
      <header className="dashboard-action-header">
        <div>
          <h1>工作台</h1>
        </div>
      </header>
      {(counts?.review ?? actions.review.length) > 0 ? <section className="workbench-review-notice" aria-label="任务结果待核对">
        <AlertTriangle size={20} /><div><strong>{counts?.review ?? actions.review.length} 个任务结果待核对</strong><p>已暂停重复调用，未结算积分仍冻结。查看任务并提交工单，核对供应商结果。</p></div>
        <button type="button" className="ghost-button" onClick={() => onOpenTasks("review")}>查看待核对任务<ArrowRight size={16} /></button>
      </section> : null}

      {resumeStory ? <section className="workbench-resume studio-resume story-resume" aria-labelledby="workbench-story-resume-title">
        <div className="workbench-resume-copy">
          <span className="workbench-resume-label"><span />继续上次创作</span>
          <h2 id="workbench-story-resume-title">{latestStory.title}</h2>
          <p>{latestStory.chapterCount} 章正文 · {latestStory.scriptCount} 份剧本<span>{formatRelativeUpdate(latestStory.updatedAt)}</span></p>
        </div>
        <div className="workbench-resume-action"><button type="button" onClick={() => onOpenContent(latestStory.id)}>{contentNextAction(latestStory)}<ArrowRight size={17} /></button></div>
      </section> : latestProject ? <section className="workbench-resume studio-resume" aria-labelledby="workbench-resume-title">
        <div className="workbench-resume-copy">
          <span className="workbench-resume-label"><span />继续上次创作</span>
          <h2 id="workbench-resume-title">{latestProject.name}</h2>
          <p>{latestProject.type} · {latestProject.videoRatio} · {latestProject.storyboards} 个镜头<span>{formatRelativeUpdate(latestProject.updatedAt)}</span></p>
        </div>
        <div className="workbench-resume-action"><button type="button" onClick={() => onOpen(latestProject.id)}>{projectNextAction(latestProject)}<ArrowRight size={17} /></button></div>
      </section> : null}
      <CreatorWelcome key={userId} onStart={onStartShort} />
      {(counts?.waiting ?? actions.waiting.length) > 0 || (counts?.active ?? actions.active.length) > 0 || (counts?.failed ?? actions.failed.length) > 0 ? <section className="dashboard-focus-grid" aria-label="待处理工作">
        {(counts?.waiting ?? actions.waiting.length) > 0 ? <article className="dashboard-focus-card warning">
          <span><Clock3 size={18} />等待你确认</span>
          <strong>{counts?.waiting ?? "未确认"}</strong>
          <p>{counts?.waiting === 0 ? "当前没有待确认的剧本或分镜" : actions.waiting[0] ? `${actions.waiting[0].name} · ${projectNextAction(actions.waiting[0])}` : "查看全部作品，处理待确认的剧本与分镜"}</p>
          {actions.waiting[0] ? <button type="button" onClick={() => onOpen(actions.waiting[0].id)}>去处理<ArrowRight size={15} /></button> : counts?.waiting ? <button type="button" onClick={onOpenWorks}>查看全部作品<ArrowRight size={15} /></button> : null}
        </article> : null}
        {(counts?.active ?? actions.active.length) > 0 ? <article className="dashboard-focus-card active">
          <span><Sparkles size={18} />正在生成</span>
          <strong>{counts?.active ?? "未确认"}</strong>
          <p>{counts?.active === 0 ? "当前没有排队或运行中的任务" : actions.active[0] ? `${actions.active[0].title} · ${actions.active[0].progress}%` : "查看队列，了解所有排队或运行任务"}</p>
          {counts?.active || actions.active.length ? <button type="button" onClick={() => onOpenTasks("active")}>查看队列<ArrowRight size={15} /></button> : null}
        </article> : null}
        {(counts?.failed ?? actions.failed.length) > 0 ? <article className="dashboard-focus-card danger">
          <span><AlertTriangle size={18} />失败待处理</span>
          <strong>{counts?.failed ?? "未确认"}</strong>
          <p>{counts?.failed === 0 ? "当前没有失败任务" : actions.failed[0]?.errorReason || actions.failed[0]?.title || "查看队列，核对失败原因和恢复方式"}</p>
          {counts?.failed || actions.failed.length ? <button type="button" onClick={() => onOpenTasks("failed")}>查看原因<ArrowRight size={15} /></button> : null}
        </article> : null}
      </section> : null}
      <div className={tasks.length || announcements.length ? "dashboard-work-grid" : "dashboard-main-stack"}>
        <div className="dashboard-main-stack">
        <section className="panel dashboard-story-panel" aria-labelledby="recent-stories-title">
          <div className="panel-head"><h2 id="recent-stories-title">最近故事</h2><button type="button" className="ghost-button" onClick={onStartContent}>写新故事<Plus size={15} /></button></div>
          {contentProjects ? stories.length ? <div className="dashboard-story-list">{stories.map(story => <button type="button" key={story.id} onClick={() => onOpenContent(story.id)} aria-label={`继续故事 ${story.title}`}>
            <span className="dashboard-story-icon"><BookOpen size={20} /></span>
            <span className="dashboard-story-copy"><strong>{story.title}</strong><small>{story.chapterCount} 章 · {contentWorkState(story).label} · {formatRelativeUpdate(story.updatedAt)}</small></span>
            <span className="dashboard-story-next">{contentNextAction(story)}<ArrowRight size={15} /></span>
          </button>)}</div> : <StatePanel compact title="还没有故事" /> : <StatePanel compact kind="error" title="故事列表暂未读取成功" description="已有手稿不受影响，请刷新后继续。" action={<button type="button" className="ghost-button" onClick={onRefresh}>重新读取故事</button>} />}
        </section>
        <section className="panel dashboard-project-panel">
          <div className="panel-head">
            <h2>最近项目</h2>
            <button className="ghost-button" type="button" onClick={onOpenWorks}>全部作品<ArrowRight size={15} /></button>
          </div>
          <div className="dashboard-project-list">
            {projects.map((project) => (
              <button key={project.id} type="button" onClick={() => onOpen(project.id)}>
                <span className="dashboard-project-main">
                  <strong><StudioIcon stage="content" size={17} />{project.name}</strong>
                  <small>{project.type} · {project.videoRatio} · {project.storyboards} 个镜头 <span className={`dashboard-project-state ${projectTone(project.status)}`}>{projectStatusLabel(project.status)}</span></small>
                </span>
                <span className="dashboard-project-next"><small>{formatRelativeUpdate(project.updatedAt)}</small><strong>{projectNextAction(project)}<ArrowRight size={14} /></strong></span>
              </button>
            ))}
            {!projects.length ? <StatePanel compact title="还没有项目" /> : null}
          </div>
        </section>
        </div>

        {tasks.length || announcements.length ? <aside className="dashboard-side-stack">
          {tasks.length ? <section className="panel dashboard-task-panel">
            <div className="panel-head"><h2>最近任务</h2><button type="button" className="ghost-button" onClick={() => onOpenTasks()}>全部任务</button></div>
            <div className="dashboard-mini-tasks">
              {tasks.slice(0, 3).map((task) => <button type="button" key={task.id} onClick={() => onOpenTasks(undefined, task.id)}><Film size={16} /><span><strong>{task.title}</strong><small>{task.projectName ?? "未绑定项目"}</small></span><em className={task.reviewRequired ? "review" : task.status}>{task.reviewRequired ? "待核对" : taskStatusLabel(task.status)}</em></button>)}
              {!tasks.length ? <p className="empty-state compact"><CheckCircle2 size={20} />暂无生成任务</p> : null}
            </div>
          </section> : null}
      {announcements.length ? <section className="panel workbench-notices" aria-labelledby="workbench-notices-heading">
        <div className="panel-head">
          <h2 id="workbench-notices-heading"><Megaphone size={18} aria-hidden="true" />平台公告</h2>
        </div>
        <div className="workbench-notices-list">
          {announcements.map((announcement) => (
            <details className="workbench-notice" key={announcement.id}>
              <summary>
                <span className="workbench-notice-copy">
                  <span className="workbench-notice-meta">
                    {announcement.pinned === true ? <span className="workbench-notice-pin"><Pin size={12} aria-hidden="true" />置顶</span> : null}
                    <span className="workbench-notice-type" data-type={announcement.type}>{({ info: "通知", guide: "使用指南", update: "功能更新", warning: "重要提醒" })[announcement.type] ?? "公告"}</span>
                  </span>
                  <strong>{announcement.title}</strong>
                  <span className="workbench-notice-preview" aria-hidden="true">{announcement.body}</span>
                </span>
                <span className="workbench-notice-toggle" aria-hidden="true"><span className="workbench-notice-expand">展开全文</span><span className="workbench-notice-collapse">收起全文</span><ChevronDown size={16} /></span>
              </summary>
              <div className="workbench-notice-body">{announcement.body}</div>
            </details>
          ))}
          {!announcements.length ? <p className="workbench-notices-empty">暂无公告</p> : null}
        </div>
      </section> : null}
        </aside> : null}
      </div>
    </div>
  );
}
