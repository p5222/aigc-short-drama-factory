import { Trash2 } from "lucide-react";
import type { Project } from "@aifilm/shared";

export function ScriptsPage({
  projects,
  onOpen,
  onNew,
  onDelete
}: {
  projects: Project[];
  onOpen: (projectId: string) => void;
  onNew: () => void;
  onDelete: (projectId: string) => void;
}) {
  return (
    <div className="page-stack">
      <div className="page-title row-title">
        <div>
          <h1>我的作品</h1>
          <p>共 {projects.length} 部作品，支持继续创作、生成分镜图、视频草稿和导出。</p>
        </div>
        <div className="inline-actions">
          <button className="ghost-button">筛选</button>
          <button className="ghost-button">排序</button>
          <button className="primary-button" onClick={onNew}>
            新建作品
          </button>
        </div>
      </div>
      <div className="tabs">
        {["全部", "进行中", "已完成", "草稿"].map((tab, index) => (
          <button key={tab} className={index === 0 ? "active" : ""}>
            {tab}
          </button>
        ))}
      </div>
      <section className="panel" data-tour-id="project-list">
        {projects.length ? (
          <div className="project-grid">
            {projects.map((project) => (
              <article className="project-card clickable" key={project.id} onClick={() => onOpen(project.id)}>
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
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">暂无作品</div>
        )}
      </section>
    </div>
  );
}
