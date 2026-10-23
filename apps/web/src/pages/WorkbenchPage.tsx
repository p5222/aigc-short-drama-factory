import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Clock3, Coins, Film, Plus, Sparkles } from "lucide-react";
import type { WorkbenchSummary } from "@aifilm/shared";
import { collectWorkbenchActions, formatRelativeUpdate, projectNextAction, projectStatusLabel, projectTone, taskStatusLabel } from "./workbenchPresentation";
import { ChevronDown, Megaphone, Pin } from "lucide-react";
import "./workbench-announcements.css";
import "./workbench-workflow.css";

interface WorkbenchPageProps {
  summary?: WorkbenchSummary;
  onStart: () => void;
  onOpen: (projectId: string) => void;
  onOpenTasks: () => void;
  onRecharge: () => void;
  onOpenWorks: () => void;
  onStartContent: () => void;
}

export function WorkbenchPage({ summary, onStart, onOpen, onOpenTasks, onRecharge, onOpenWorks, onStartContent }: WorkbenchPageProps) {
  const projects = summary?.recentProjects ?? [];
  const tasks = summary?.recentTasks ?? [];
  const actions = collectWorkbenchActions(projects, tasks);
  const latestProject = projects[0];
  const announcements: Array<WorkbenchSummary["announcements"][number] & { pinned?: boolean }> = summary?.announcements ?? [];

  return (
    <div className="page-stack dashboard-page dashboard-action-page">
      <header className="dashboard-action-header">
        <div>
          <span className="section-kicker">创作工作台</span>
          <h1>{summary?.userName ?? "创作者"}，今天继续哪里？</h1>
          <p>从故事到成片，让每一步创作都有清晰的下一步。</p>
        </div>
        <div className="workbench-header-actions"><button className="ghost-button" onClick={onStartContent}><BookOpen size={17} />内容创作</button><button className="primary-button large" onClick={onStart}><Plus size={18} />新建漫剧</button></div>
      </header>

      {!latestProject ? <section className="workbench-journey" aria-labelledby="workbench-journey-title">
        <div className="workbench-journey-heading"><span className="section-kicker">创作流程</span><h2 id="workbench-journey-title">把第一个故事变成作品</h2><p>逐步确认内容，再进入生成。每次生成前核对模型与积分报价。</p></div>
        <ol>
          <li><span>01</span><div><strong>故事与剧本</strong><small>输入灵感，确认剧本与分镜</small></div></li>
          <li><span>02</span><div><strong>角色与场景</strong><small>建立资产，保持视觉一致</small></div></li>
          <li><span>03</span><div><strong>镜头制作</strong><small>生成画面、视频与配音</small></div></li>
          <li><span>04</span><div><strong>成片交付</strong><small>检查时间线，导出并审核发布</small></div></li>
        </ol>
        <button type="button" className="ghost-button" onClick={onStart}>开始第一部漫剧<ArrowRight size={16} /></button>
      </section> : null}
      {projects.length || tasks.length ? <section className="dashboard-focus-grid" aria-label="待处理工作">
        <article className="dashboard-focus-card warning">
          <span><Clock3 size={18} />等待你确认</span>
          <strong>{actions.waiting.length}</strong>
          <p>{actions.waiting[0] ? `${actions.waiting[0].name} · ${projectNextAction(actions.waiting[0])}` : "当前没有待确认的剧本或分镜"}</p>
          {actions.waiting[0] ? <button type="button" onClick={() => onOpen(actions.waiting[0].id)}>去处理<ArrowRight size={15} /></button> : null}
        </article>
        <article className="dashboard-focus-card active">
          <span><Sparkles size={18} />正在生成</span>
          <strong>{actions.active.length}</strong>
          <p>{actions.active[0] ? `${actions.active[0].title} · ${actions.active[0].progress}%` : "当前没有排队或运行中的任务"}</p>
          {actions.active.length ? <button type="button" onClick={onOpenTasks}>查看队列<ArrowRight size={15} /></button> : null}
        </article>
        <article className="dashboard-focus-card danger">
          <span><AlertTriangle size={18} />失败待处理</span>
          <strong>{actions.failed.length}</strong>
          <p>{actions.failed[0]?.errorReason || (actions.failed.length ? actions.failed[0].title : "当前没有失败任务")}</p>
          {actions.failed.length ? <button type="button" onClick={onOpenTasks}>查看原因<ArrowRight size={15} /></button> : null}
        </article>
      </section> : null}
      <div className="dashboard-work-grid">
        <section className="panel dashboard-project-panel">
          <div className="panel-head">
            <div><h2>最近项目</h2><small>待处理摘要基于最近项目与任务</small></div>
            <button className="ghost-button" type="button" onClick={onOpenWorks}>全部作品<ArrowRight size={15} /></button>
          </div>
          <div className="dashboard-project-list">
            {projects.map((project) => (
              <button key={project.id} type="button" onClick={() => onOpen(project.id)}>
                <span className={`dashboard-project-state ${projectTone(project.status)}`}>{projectStatusLabel(project.status)}</span>
                <span className="dashboard-project-main">
                  <strong>{project.name}</strong>
                  <small>{project.type} · {project.videoRatio} · {project.storyboards} 个镜头</small>
                </span>
                <span className="dashboard-project-next"><small>{formatRelativeUpdate(project.updatedAt)}</small><strong>{projectNextAction(project)}<ArrowRight size={14} /></strong></span>
              </button>
            ))}
            {!projects.length ? <div className="empty-state"><BookOpen size={24} /><strong>还没有项目</strong><span>从小说、剧本或灵感开始创建第一部漫剧。</span><button className="primary-button" onClick={onStart}>新建漫剧</button></div> : null}
          </div>
        </section>

        <aside className="dashboard-side-stack">
          <section className="panel dashboard-account-panel">
            <div className="panel-head"><div><h2>账户</h2><small>生成余额与生产概况</small></div></div>
            <div className="dashboard-credit-balance"><Coins size={20} /><span>可用积分</span><strong>{(summary?.credits ?? 0).toLocaleString()}</strong></div>
            <div className="dashboard-account-stats"><span><b>{summary?.projects ?? 0}</b>项目</span><span><b>{summary?.storyboards ?? 0}</b>镜头</span><span><b>{summary?.runningTasks ?? 0}</b>运行中</span></div>
            <button className="ghost-button" type="button" onClick={onRecharge}>充值与消费说明</button>
          </section>
          <section className="panel dashboard-task-panel">
            <div className="panel-head"><div><h2>最近任务</h2><small>只显示最新生产状态</small></div><button type="button" className="ghost-button" onClick={onOpenTasks}>全部任务</button></div>
            <div className="dashboard-mini-tasks">
              {tasks.slice(0, 3).map((task) => <button type="button" key={task.id} onClick={onOpenTasks}><Film size={16} /><span><strong>{task.title}</strong><small>{task.projectName ?? "未绑定项目"}</small></span><em className={task.status}>{taskStatusLabel(task.status)}</em></button>)}
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
