import { BookOpen, Film, Images, Sparkles, WandSparkles } from "lucide-react";
import type { WorkbenchSummary } from "@aifilm/shared";
import { MetricCard } from "../components/MetricCard";

interface WorkbenchPageProps {
  summary?: WorkbenchSummary;
  onStart: () => void;
  onOpen: (projectId: string) => void;
}

const pipeline = ["内容输入", "AI 编剧", "角色一致性", "镜头分镜", "分镜图", "图生视频", "配音字幕", "合成导出"];

export function WorkbenchPage({ summary, onStart, onOpen }: WorkbenchPageProps) {
  const latestProject = summary?.recentProjects[0];

  return (
    <div className="page-stack dashboard-page">
      <section className="dashboard-hero">
        <div className="hero-copy-block">
          <span className="section-kicker">CREATION WORKSPACE</span>
          <h1>欢迎回来，{summary?.userName ?? "创作者"}</h1>
          <p>输入小说、脑洞、剧本或 Excel 分镜表，自动完成策划、编剧、角色一致性、分镜图、图生视频和导出任务。</p>
          <div className="hero-actions">
            <button className="primary-button large" onClick={onStart}>
              <WandSparkles size={19} />
              新建漫剧内容
            </button>
            {latestProject ? (
              <button className="ghost-button large" onClick={() => onOpen(latestProject.id)}>
                <BookOpen size={19} />
                继续上次创作
              </button>
            ) : null}
          </div>
        </div>
        <div className="hero-production-preview" aria-hidden="true">
          <div className="phone-preview">
            <div className="phone-scene" />
            <div className="phone-caption">Shot 01 · 9:16</div>
          </div>
          <div className="preview-lines">
            <span>剧本拆解完成</span>
            <span>角色卡已锁定 Seed</span>
            <span>分镜图等待生成</span>
          </div>
        </div>
      </section>

      <div className="workflow-rail">
        {pipeline.map((step, index) => (
          <div className="stage-pill done" key={step}>
            <span>{index + 1}</span>
            {step}
          </div>
        ))}
      </div>

      <div className="metric-grid">
        <MetricCard label="我的作品" value={summary?.projects ?? 0} hint="全部作品" icon={<BookOpen size={20} />} />
        <MetricCard label="累计分镜" value={summary?.storyboards ?? 0} hint="镜头级生产单元" icon={<Images size={20} />} tone="purple" />
        <MetricCard label="今日生产" value={summary?.runningTasks ?? 0} hint="排队与生成中的流程" icon={<Film size={20} />} />
        <MetricCard label="可用积分" value={summary?.credits ?? 0} hint="统一模型扣费余额" icon={<Sparkles size={20} />} tone="success" />
      </div>

      <div className="dashboard-main-grid">
        <section className="panel dashboard-recent-projects">
          <div className="panel-head">
            <div>
              <h2>最近作品</h2>
              <small>点击作品进入项目生产台</small>
            </div>
          </div>
          <div className="list project-list-compact">
            {summary?.recentProjects.map((project) => (
              <button key={project.id} className="list-row clickable-row" onClick={() => onOpen(project.id)}>
                <div>
                  <strong>{project.name}</strong>
                  <span>{project.type} · {project.videoRatio} · {project.status}</span>
                </div>
                <small>{project.storyboards} 分镜</small>
              </button>
            ))}
            {summary && !summary.recentProjects.length ? <div className="empty-state">还没有创作记录，先新建一个漫剧内容。</div> : null}
          </div>
        </section>

        <section className="panel dashboard-announcements-panel">
          <div className="panel-head">
            <div>
              <h2>平台公告</h2>
              <small>模型网关、计费和生成能力的当前状态</small>
            </div>
          </div>
          <div className="announcement-grid compact">
            {summary?.announcements.map((item) => (
              <article key={item.id} className="announcement">
                <Film size={22} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
