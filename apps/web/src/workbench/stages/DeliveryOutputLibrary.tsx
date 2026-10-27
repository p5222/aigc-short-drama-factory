import { Download, Film, Play } from "lucide-react";
import type { ExportJob } from "@aifilm/shared";
import { isPersistedPlayableVideoReference } from "@aifilm/shared";

export function DeliveryOutputLibrary({ jobs, onPreview, onDownload, downloading = false }: {
  jobs: ExportJob[]; onPreview: (job: ExportJob) => void; onDownload: (job: ExportJob) => void; downloading?: boolean;
}) {
  const videos = jobs.filter(job => job.status === "succeeded" && (job.type === "video_export" || job.outputKind === "mp4")
    && isPersistedPlayableVideoReference(job.previewUrl || job.outputUrl)).slice(0, 12);
  return <section className="dlv3-output-library" aria-label="成片版本库">
    <header><Film size={16} /><strong>成片版本</strong><span>{videos.length} 个</span></header>
    {videos.length ? videos.map(job => <article key={job.id}>
      <div><strong>{job.deliveryEdit ? `第 ${job.deliveryEdit.episodeNo} 集 · 剪辑 v${job.deliveryEdit.revision}` : job.storyboardIds?.length ? `${job.storyboardIds.length} 镜成片` : "历史成片"}</strong><small>{job.sourceStatus === "current" ? "输入已核验" : job.sourceStatus === "stale" ? "内容已更新" : "输入未核验"} · {new Date(job.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>
      <div><button type="button" className="dlv2-btn" aria-label={`预览成片 ${job.id}`} onClick={() => onPreview(job)}><Play size={13} />预览</button><button type="button" className="dlv2-btn" aria-label={`下载成片 ${job.id}`} disabled={downloading} onClick={() => onDownload(job)}><Download size={13} /></button></div>
    </article>) : <p>合成完成后，成片会出现在这里。可预览、核对版本并下载交付。</p>}
    {jobs.some(job => job.status === "running" || job.status === "pending") ? <p role="status">导出正在处理中，完成后自动更新。</p> : null}
    {jobs.filter(job => job.type === "video_export" && job.status === "failed").slice(0, 2).map(job => <p className="dlv3-output-error" role="alert" key={job.id}>合成未完成：{job.errorReason || "请刷新核对导出记录"}</p>)}
  </section>;
}
