import { Download, Film, Loader2, Play } from "lucide-react";
import type { ExportJob } from "@aifilm/shared";
import { useState } from "react";
import { ExportOutcomeDialog } from "./ExportOutcomeDialog";
import { requestJson } from "../../lib/httpClient";
import { ListPagination } from "../../components/ListPagination";
import { isPlayableExport, outputScopeLabel, outputSourceLabel, outputTypeLabel } from "./deliveryOutputModel";

export function DeliveryOutputLibrary({ jobs, onPreview, onDownload, downloadingJobId = "", currentIds = [], selectedJobId }: {
  jobs: ExportJob[]; onPreview: (job: ExportJob) => void; onDownload: (job: ExportJob) => void;
  downloadingJobId?: string; currentIds?: readonly string[]; selectedJobId?: string;
}) {
  const [reviewJob, setReviewJob] = useState<ExportJob | null>(null);
  const [type, setType] = useState("video_export");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [requestedPage, setPage] = useState(1);
  const filtered = jobs.filter(job => (type === "all" || job.type === type)
    && (status === "all" || (status === "history" ? job.status === "succeeded" && job.sourceStatus !== "current" : job.status === status))
    && `${job.id} ${outputTypeLabel(job)} ${outputScopeLabel(job, currentIds)} ${outputSourceLabel(job)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
  const pageSize = 6;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const labels: Record<string, string> = { succeeded: "已完成", pending: "排队中", running: "生成中", failed: "失败" };
  return <section className="dlv3-output-library" aria-label="成片版本库">
    <header><Film size={16} /><strong>交付版本库</strong><span>共 {jobs.length} 条记录</span></header>
    <p>按文件类型查找版本。历史文件保留下载，不计入当前完成状态。</p>
    <div className="dlv3-library-filters">
      <label><span>文件类型</span><select aria-label="交付文件类型" value={type} onChange={event => { setType(event.target.value); setPage(1); }}>
        <option value="video_export">成片</option><option value="tts">配音</option><option value="subtitle">字幕</option><option value="all">全部类型</option>
      </select></label>
      <label><span>状态</span><select aria-label="交付文件状态" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
        <option value="all">全部状态</option><option value="succeeded">已完成</option><option value="history">历史版本</option><option value="running">生成中</option><option value="pending">排队中</option><option value="failed">失败</option>
      </select></label>
      <label className="dlv3-library-search"><span>搜索版本</span><input type="search" value={query} aria-label="搜索交付版本" placeholder="集数、版本或编号" onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
    </div>
    {filtered.length ? filtered.slice((page - 1) * pageSize, page * pageSize).map(job => <article key={job.id} data-selected={selectedJobId === job.id || undefined} aria-label={`${outputTypeLabel(job)} ${job.id}`}>
      <div className="dlv3-output-info">
        <strong>{outputTypeLabel(job)} · {outputScopeLabel(job, currentIds)}</strong>
        <small>{labels[job.status] ?? job.status}{job.status === "succeeded" ? ` · ${outputSourceLabel(job)}` : ""}{selectedJobId === job.id ? " · 正在预览" : ""}</small>
        <small><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString("zh-CN")}</time> · <span title={job.id}>{job.id}</span></small>
        {job.status === "failed" ? <p className="dlv3-output-error">导出未完成：{job.errorReason || "请刷新核对导出记录"}</p> : null}
      </div>
      <div className="dlv3-output-actions">
        {isPlayableExport(job) ? <><button type="button" className="dlv2-btn" aria-label={`预览成片 ${job.id}`} aria-pressed={selectedJobId === job.id} onClick={() => { onPreview(job); void requestJson(`/projects/${encodeURIComponent(job.projectId)}/creator-events`, { method: "POST", body: JSON.stringify({ event: "creator_export_viewed" }) }).catch(() => undefined); }}><Play size={13} />预览</button>
          <button type="button" className="dlv2-btn" aria-label={`评价成片 ${job.id}`} onClick={() => setReviewJob(job)}>评价与消耗</button></> : null}
        {job.status === "succeeded" && (job.downloadUrl || job.outputUrl) ? <button type="button" className="dlv2-btn" aria-label={`下载${outputTypeLabel(job)} ${job.id}`} disabled={Boolean(downloadingJobId)} onClick={() => onDownload(job)}>
          {downloadingJobId === job.id ? <Loader2 size={13} className="spin-icon" /> : <Download size={13} />}{downloadingJobId === job.id ? "下载中…" : "下载"}
        </button> : null}
      </div>
    </article>) : <p role="status">{jobs.length ? "没有符合筛选条件的交付记录。" : "导出后，成片、配音与字幕会保存在这里。"}</p>}
    <ListPagination total={filtered.length} page={page} pageSize={pageSize} onChange={setPage} label="交付版本" />
    {reviewJob ? <ExportOutcomeDialog key={reviewJob.id} job={reviewJob} onClose={() => setReviewJob(null)} /> : null}
  </section>;
}
