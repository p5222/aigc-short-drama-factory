import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Clock3, Coins, Film, Plus, Sparkles } from "lucide-react";
import type { WorkbenchSummary } from "@aifilm/shared";
import { collectWorkbenchActions, formatRelativeUpdate, projectNextAction, projectStatusLabel, projectTone, taskStatusLabel } from "./workbenchPresentation";

interface WorkbenchPageProps {
  summary?: WorkbenchSummary;
  onStart: () => void;
  onOpen: (projectId: string) => void;
  onOpenTasks: () => void;
  onRecharge: () => void;
}

export function WorkbenchPage({ summary, onStart, onOpen, onOpenTasks, onRecharge }: WorkbenchPageProps) {
  const projects = summary?.recentProjects ?? [];
  const tasks = summary?.recentTasks ?? [];
  const actions = collectWorkbenchActions(projects, tasks);
  const latestProject = projects[0];

  return (
    <div className="page-stack dashboard-page dashboard-action-page">
      <header className="dashboard-action-header">
        <div>
          <span className="section-kicker">创作工作台</span>
          <h1>{summary?.userName ?? "创作者"}，今天继续哪里？</h1>
          <p>只展示需要关注的项目、生成任务和下一步操作。</p>
        </div>
        <button className="primary-button large" onClick={onStart}><Plus size={18} />新建漫剧</button>
      </header>

      <section className="dashboard-focus-grid" aria-label="待处理工作">
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
      </section>

      <div className="dashboard-work-grid">
        <section className="panel dashboard-project-panel">
          <div className="panel-head">
            <div><h2>最近项目</h2><small>按最近更新时间排列，直接继续下一步</small></div>
            {latestProject ? <button className="ghost-button" type="button" onClick={() => onOpen(latestProject.id)}>继续上次创作</button> : null}
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
        </aside>
      </div>
    </div>
  );
}
