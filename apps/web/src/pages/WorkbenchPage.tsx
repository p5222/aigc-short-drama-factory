import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Clock3, Coins, Film, Plus, Sparkles } from "lucide-react";
import type { ContentProjectSummary, WorkbenchSummary } from "@aifilm/shared";
import { contentNextAction, contentWorkState, sortWorks } from "./scriptsPageModel";
import { StatePanel } from "../design-system/ui";
import { collectWorkbenchActions, formatRelativeUpdate, projectNextAction, projectStatusLabel, projectTone, taskStatusLabel } from "./workbenchPresentation";
import { ChevronDown, Megaphone, Pin } from "lucide-react";
import { StudioIcon, studioStages, type StudioStage } from "../design-system/StudioIcon";
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
  onStart: () => void;
  onOpen: (projectId: string) => void;
  onOpenTasks: (filter?: "active" | "failed", taskId?: string) => void;
  onRecharge: () => void;
  onOpenWorks: () => void;
  onStartContent: () => void;
}

export function WorkbenchPage({ userId, onStartShort, summary, contentProjects, onOpenContent, onRefresh, onStart, onOpen, onOpenTasks, onRecharge, onOpenWorks, onStartContent }: WorkbenchPageProps) {
  const projects = summary?.recentProjects ?? [];
  const tasks = summary?.recentTasks ?? [];
  const actions = collectWorkbenchActions(summary?.actionProjects ?? projects, tasks);
  const counts = summary?.actionCounts;
  const latestProject = projects[0];
  const stories = sortWorks(contentProjects ?? []).slice(0, 3);
  const latestStory = stories[0];
  const resumeStory = latestStory && (!latestProject || (Date.parse(latestStory.updatedAt) || 0) > (Date.parse(latestProject.updatedAt) || 0));
  const currentStage: StudioStage = latestProject?.status === "completed" ? "delivery" : latestProject?.status === "asseting" ? "assets" : ["storyboarding", "rendering"].includes(latestProject?.status ?? "") ? "shots" : "content";
  const announcements: Array<WorkbenchSummary["announcements"][number] & { pinned?: boolean }> = summary?.announcements ?? [];

  return (
    <div className="page-stack dashboard-page dashboard-action-page">
      <header className="dashboard-action-header">
        <div>
          <span className="section-kicker">MANJIAO STUDIO / 创作工作台</span>
          <h1>{summary?.userName ?? "创作者"}，让故事继续。</h1>
          <p>把灵感写成故事，把故事带上银幕。</p>
        </div>
        <div className="workbench-header-actions"><button className="ghost-button" onClick={onStartContent}><BookOpen size={17} />内容创作</button><button className="primary-button large" onClick={onStart}><Plus size={18} />新建漫剧</button></div>
      </header>
      <CreatorWelcome key={userId} onStart={onStartShort} />

      {resumeStory ? <section className="workbench-resume studio-resume story-resume" aria-labelledby="workbench-story-resume-title">
        <div className="studio-resume-monogram" aria-hidden="true"><StudioIcon stage="content" size={32} /><span>故事手稿</span></div>
        <div className="workbench-resume-copy">
          <span className="workbench-resume-label"><span />继续上次创作</span>
          <h2 id="workbench-story-resume-title">{latestStory.title}</h2>
          <p>{latestStory.chapterCount} 章正文 · {latestStory.scriptCount} 份剧本<span>{formatRelativeUpdate(latestStory.updatedAt)}</span></p>
        </div>
        <div className="workbench-resume-action"><span>下一步 · {contentNextAction(latestStory)}</span><button type="button" onClick={() => onOpenContent(latestStory.id)}>继续写作<ArrowRight size={17} /></button></div>
        <div className="story-resume-footer"><span>{contentWorkState(latestStory).label}</span><p>先完成故事与剧本，再交接角色、分镜和成片制作。</p></div>
      </section> : latestProject ? <section className="workbench-resume studio-resume" aria-labelledby="workbench-resume-title">
        <div className="studio-resume-monogram" aria-hidden="true"><StudioIcon stage={currentStage} size={32} /><span>创作手帐</span></div>
        <div className="workbench-resume-copy">
          <span className="workbench-resume-label"><span />继续上次创作</span>
          <h2 id="workbench-resume-title">{latestProject.name}</h2>
          <p>{latestProject.type} · {latestProject.videoRatio} · {latestProject.storyboards} 个镜头<span>{formatRelativeUpdate(latestProject.updatedAt)}</span></p>
        </div>
        <div className="workbench-resume-action"><span>下一步 · {projectNextAction(latestProject)}</span><button type="button" onClick={() => onOpen(latestProject.id)}>进入创作<ArrowRight size={17} /></button></div>
        <ol className="studio-stage-ribbon" aria-label="当前创作阶段">
          {studioStages.map((stage, index) => <li key={stage.id} aria-current={stage.id === currentStage ? "step" : undefined}>
            <StudioIcon stage={stage.id} size={18} /><span><small>{String(index + 1).padStart(2, "0")}</small>{stage.label}</span>
          </li>)}
        </ol>
      </section> : null}
      {!latestProject && contentProjects && !latestStory ? <section className="workbench-journey" aria-labelledby="workbench-journey-title">
        <div className="workbench-journey-heading"><span className="section-kicker">创作流程</span><h2 id="workbench-journey-title">把第一个故事变成作品</h2><p>逐步确认内容，再进入生成。每次生成前核对模型与积分报价。</p></div>
        <ol>
          {studioStages.map((stage, index) => <li key={stage.id}><span><StudioIcon stage={stage.id} size={24} /><b>{String(index + 1).padStart(2, "0")}</b></span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></li>)}
        </ol>
        <button type="button" className="ghost-button" onClick={onStart}>开始第一部漫剧<ArrowRight size={16} /></button>
      </section> : null}
      {projects.length || tasks.length ? <section className="dashboard-focus-grid" aria-label="待处理工作">
        <article className="dashboard-focus-card warning">
          <span><Clock3 size={18} />等待你确认</span>
          <strong>{counts?.waiting ?? "未确认"}</strong>
          <p>{counts?.waiting === 0 ? "当前没有待确认的剧本或分镜" : actions.waiting[0] ? `${actions.waiting[0].name} · ${projectNextAction(actions.waiting[0])}` : "查看全部作品，处理待确认的剧本与分镜"}</p>
          {actions.waiting[0] ? <button type="button" onClick={() => onOpen(actions.waiting[0].id)}>去处理<ArrowRight size={15} /></button> : counts?.waiting ? <button type="button" onClick={onOpenWorks}>查看全部作品<ArrowRight size={15} /></button> : null}
        </article>
        <article className="dashboard-focus-card active">
          <span><Sparkles size={18} />正在生成</span>
          <strong>{counts?.active ?? "未确认"}</strong>
          <p>{counts?.active === 0 ? "当前没有排队或运行中的任务" : actions.active[0] ? `${actions.active[0].title} · ${actions.active[0].progress}%` : "查看队列，了解所有排队或运行任务"}</p>
          {counts?.active || actions.active.length ? <button type="button" onClick={() => onOpenTasks("active")}>查看队列<ArrowRight size={15} /></button> : null}
        </article>
        <article className="dashboard-focus-card danger">
          <span><AlertTriangle size={18} />失败待处理</span>
          <strong>{counts?.failed ?? "未确认"}</strong>
          <p>{counts?.failed === 0 ? "当前没有失败任务" : actions.failed[0]?.errorReason || actions.failed[0]?.title || "查看队列，核对失败原因和恢复方式"}</p>
          {counts?.failed || actions.failed.length ? <button type="button" onClick={() => onOpenTasks("failed")}>查看原因<ArrowRight size={15} /></button> : null}
        </article>
      </section> : null}
      {summary?.updatedAt ? <p className="creator-page-footnote">待办数量统计全部作品与任务 · 更新于 {new Date(summary.updatedAt).toLocaleString("zh-CN")}</p> : null}
      <div className="dashboard-work-grid">
        <div className="dashboard-main-stack">
        <section className="panel dashboard-story-panel" aria-labelledby="recent-stories-title">
          <div className="panel-head"><div><span className="studio-section-number">灵感与手稿 / 01</span><h2 id="recent-stories-title">最近故事</h2><small>续写正文，或将就绪剧本交接制作</small></div><button type="button" className="ghost-button" onClick={onStartContent}>写新故事<Plus size={15} /></button></div>
          {contentProjects ? stories.length ? <div className="dashboard-story-list">{stories.map(story => <button type="button" key={story.id} onClick={() => onOpenContent(story.id)} aria-label={`继续故事 ${story.title}`}>
            <span className="dashboard-story-icon"><BookOpen size={20} /></span>
            <span className="dashboard-story-copy"><strong>{story.title}</strong><small>{story.chapterCount} 章 · {contentWorkState(story).label} · {formatRelativeUpdate(story.updatedAt)}</small></span>
            <span className="dashboard-story-next">{contentNextAction(story)}<ArrowRight size={15} /></span>
          </button>)}</div> : <StatePanel compact title="为下一部作品写下灵感" description="故事手稿会保存在这里，随时回来继续。" action={<button type="button" className="ghost-button" onClick={onStartContent}>写新故事</button>} /> : <StatePanel compact kind="error" title="故事列表暂未读取成功" description="已有手稿不受影响，请刷新后继续。" action={<button type="button" className="ghost-button" onClick={onRefresh}>重新读取故事</button>} />}
        </section>
        <section className="panel dashboard-project-panel">
          <div className="panel-head">
            <div><span className="studio-section-number">漫剧制作 / 02</span><h2>最近项目</h2><small>最近作品便于续创，待办数量覆盖全部记录</small></div>
            <button className="ghost-button" type="button" onClick={onOpenWorks}>全部作品<ArrowRight size={15} /></button>
          </div>
          <div className="dashboard-project-list">
            {projects.map((project, index) => (
              <button key={project.id} type="button" onClick={() => onOpen(project.id)}>
                <span className="dashboard-project-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <span className="dashboard-project-main">
                  <strong><StudioIcon stage="content" size={17} />{project.name}</strong>
                  <small>{project.type} · {project.videoRatio} · {project.storyboards} 个镜头 <span className={`dashboard-project-state ${projectTone(project.status)}`}>{projectStatusLabel(project.status)}</span></small>
                </span>
                <span className="dashboard-project-next"><small>{formatRelativeUpdate(project.updatedAt)}</small><strong>{projectNextAction(project)}<ArrowRight size={14} /></strong></span>
              </button>
            ))}
            {!projects.length ? <div className="empty-state"><BookOpen size={24} /><strong>还没有项目</strong><span>从小说、剧本或灵感开始创建第一部漫剧。</span><button className="primary-button" onClick={onStart}>新建漫剧</button></div> : null}
          </div>
        </section>
        </div>

        <aside className="dashboard-side-stack">
          <section className="panel dashboard-account-panel">
            <div className="panel-head"><div><h2>账户</h2><small>生成余额与生产概况</small></div></div>
            <div className="dashboard-credit-balance"><Coins size={20} /><span>可用积分</span><strong>{(summary?.credits ?? 0).toLocaleString()}</strong></div>
            <div className="dashboard-account-stats"><span><b>{summary?.projects ?? 0}</b>项目</span><span><b>{summary?.storyboards ?? 0}</b>镜头</span><span><b>{summary?.runningTasks ?? 0}</b>运行中</span></div>
            <button className="ghost-button" type="button" onClick={onRecharge}>充值与消费说明</button>
          </section>
          <section className="panel dashboard-task-panel">
            <div className="panel-head"><div><h2>最近任务</h2><small>只显示最新生产状态</small></div><button type="button" className="ghost-button" onClick={() => onOpenTasks()}>全部任务</button></div>
            <div className="dashboard-mini-tasks">
              {tasks.slice(0, 3).map((task) => <button type="button" key={task.id} onClick={() => onOpenTasks(undefined, task.id)}><Film size={16} /><span><strong>{task.title}</strong><small>{task.projectName ?? "未绑定项目"}</small></span><em className={task.status}>{taskStatusLabel(task.status)}</em></button>)}
              {!tasks.length ? <p className="empty-state compact"><CheckCircle2 size={20} />暂无生成任务</p> : null}
            </div>
          </section>
      <section className="panel workbench-notices" aria-labelledby="workbench-notices-heading">
        <div className="panel-head">
          <div><h2 id="workbench-notices-heading"><Megaphone size={18} aria-hidden="true" />平台公告</h2><small>平台更新与使用提醒</small></div>
          <span className="workbench-notices-count">{announcements.length} 条</span>
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
      </section>
        </aside>
      </div>
    </div>
  );
}
