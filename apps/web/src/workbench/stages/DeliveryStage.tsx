import { Download, Film, Pause, Play, RefreshCw, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import type { AssetItem, ExportJob, ProjectWorkflow } from "@aifilm/shared";
import { isPersistedPlayableVideoReference } from "@aifilm/shared";
import { useWorkbench } from "../WorkbenchContext";
import { MediaFrame } from "../components/MediaCanvas";
import { EntityRail } from "../components/EntityRail";
import { Inspector } from "../components/Inspector";
import { buildShotAssetMap } from "../model";
import { buildDeliveryClipLayout, getDeliveryCandidates, getExportSummary, getNextPlayableShotId, normalizePersistedMediaUrl, normalizeShotDuration } from "./deliveryModel";

interface DeliveryStageProps { railOpen: boolean; inspectorOpen: boolean; onCloseRail: () => void; onCloseInspector: () => void; onRefresh: (projectId: string) => Promise<ProjectWorkflow>; onPublish: () => void; exportJobs: ExportJob[]; onExport: (type: "tts" | "subtitle" | "video_export") => void; isBusy: boolean; }

export function DeliveryStage({ railOpen, inspectorOpen, onCloseRail, onCloseInspector, onRefresh, onPublish, exportJobs, onExport, isBusy }: DeliveryStageProps) {
  const { workflow } = useWorkbench();
  if (!workflow) return null;
  return <LoadedDeliveryStage workflow={workflow} railOpen={railOpen} inspectorOpen={inspectorOpen} onCloseRail={onCloseRail} onCloseInspector={onCloseInspector} onRefresh={onRefresh} onPublish={onPublish} exportJobs={exportJobs} onExport={onExport} isBusy={isBusy} />;
}

function LoadedDeliveryStage({ workflow, railOpen, inspectorOpen, onCloseRail, onCloseInspector, onRefresh, onPublish, exportJobs, onExport, isBusy }: DeliveryStageProps & { workflow: ProjectWorkflow }) {
  const { state, dispatch } = useWorkbench();
  const [playing, setPlaying] = useState(false);
  const pendingAutoPlay = useRef<{ shotId: string; url: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const [durationByShotId, setDurationByShotId] = useState<Map<string, number>>(() => new Map());
  const videoRef = useRef<HTMLVideoElement>(null);
  const { project, storyboards, assets } = workflow;
  const videoByShot = useMemo(() => buildShotAssetMap(storyboards, assets, "video"), [assets, storyboards]);
  const imageByShot = useMemo(() => buildShotAssetMap(storyboards, assets, "image"), [assets, storyboards]);
  const activeShot = storyboards.find((shot) => shot.id === state.activeShotId) ?? storyboards[0];
  const activeUrl = activeShot && isPersistedPlayableVideoReference(videoByShot.get(activeShot.id)?.referenceUrl) ? videoByShot.get(activeShot.id)!.referenceUrl! : "";
  const layout = buildDeliveryClipLayout(storyboards, 52, 96, durationByShotId);
  const totalDuration = layout.reduce((sum, clip) => sum + clip.duration, 0);
  const summary = getExportSummary(exportJobs);

  useEffect(() => { setProgress(0); setPlaying(false); videoRef.current?.pause(); }, [activeShot?.id, activeUrl]);
  function selectShot(id: string) { pendingAutoPlay.current = null; dispatch({ type: "set-shot", shotId: id }); }
  function togglePlayback() { const video = videoRef.current; if (!video || !activeUrl) return; if (video.paused) void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); else { video.pause(); setPlaying(false); } }
  function onEnded() { const next = getNextPlayableShotId(storyboards, assets, activeShot?.id ?? ""); const nextUrl = next ? videoByShot.get(next)?.referenceUrl : undefined; if (next && isPersistedPlayableVideoReference(nextUrl)) { pendingAutoPlay.current = { shotId: next, url: nextUrl }; dispatch({ type: "set-shot", shotId: next }); } else { pendingAutoPlay.current = null; setPlaying(false); } }
  function onCanPlay(event: SyntheticEvent<HTMLVideoElement>) { const target = pendingAutoPlay.current; if (!target || target.shotId !== activeShot?.id || normalizePersistedMediaUrl(target.url) !== normalizePersistedMediaUrl(event.currentTarget.currentSrc)) return; pendingAutoPlay.current = null; void event.currentTarget.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }

  const exportStatus = summary.status === "idle" ? "暂无" : summary.status;
  return <main className="wb-workspace delivery-stage" data-rail-open={railOpen} data-inspector-open={inspectorOpen}>
    <EntityRail open={railOpen} onClose={onCloseRail} title="成片片段"><div className="delivery-rail"><div className="wb-rail-summary"><h2 className="wb-region-heading">成片</h2><p className="wb-region-copy">片段、导出与创作现场发布</p></div><div className="delivery-clip-list" role="list">{storyboards.map((shot, index) => { const video = videoByShot.get(shot.id); const image = imageByShot.get(shot.id); const ready = isPersistedPlayableVideoReference(video?.referenceUrl); return <button key={shot.id} type="button" className={`delivery-clip-row${activeShot?.id === shot.id ? " is-active" : ""}`} onClick={() => selectShot(shot.id)}><span className="delivery-poster">{image?.referenceUrl ? <img src={image.referenceUrl} alt="" loading="lazy" /> : <Film size={16} />}</span><span><strong>镜头 {String(index + 1).padStart(2, "0")}</strong><small>{normalizeShotDuration(shot.duration)}s · {ready ? "可播放" : video?.status ?? "待生成"}</small></span></button>; })}</div></div></EntityRail>
    <section className="wb-canvas delivery-canvas"><div className="delivery-canvas-head"><div><h2 className="wb-region-heading">连续预览</h2><p className="wb-region-copy">{activeShot?.scene || "暂无可预览片段"}</p></div><button className="wb-secondary-button" type="button" onClick={() => void onRefresh(project.id)}><RefreshCw size={16} />刷新</button></div><div className="delivery-player"><MediaFrame>{activeUrl ? <video ref={videoRef} src={activeUrl} poster={imageByShot.get(activeShot?.id ?? "")?.referenceUrl} preload="metadata" playsInline onCanPlay={onCanPlay} onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0 && activeShot) setDurationByShotId((current) => new Map(current).set(activeShot.id, duration)); }} onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={onEnded} /> : <div className="delivery-empty"><Film size={28} /><strong>暂无可播放片段</strong><span>请先在分镜阶段生成视频。</span></div>}</MediaFrame></div><div className="delivery-transport"><button className="wb-icon-button" type="button" aria-label={playing ? "暂停" : "播放"} disabled={!activeUrl} onClick={togglePlayback}>{playing ? <Pause size={17} /> : <Play size={17} />}</button><input type="range" min="0" max={Math.max(1, videoRef.current?.duration || durationByShotId.get(activeShot?.id ?? "") || normalizeShotDuration(activeShot?.duration))} step="0.1" value={progress} onChange={(event) => { const value = Number(event.target.value); setProgress(value); if (videoRef.current) videoRef.current.currentTime = value; }} disabled={!activeUrl} aria-label="播放进度" /><span>{Math.round(progress)}s / {Math.round(videoRef.current?.duration || durationByShotId.get(activeShot?.id ?? "") || normalizeShotDuration(activeShot?.duration))}s</span></div><div className="delivery-timeline" aria-label="只读时间线"><div className="delivery-ruler"><span>0:00</span><span>{Math.round(totalDuration / 2)}s</span><span>{Math.round(totalDuration)}s</span></div><div className="delivery-track">{layout.map((clip) => <button key={clip.id} type="button" className={`delivery-timeline-clip${clip.id === activeShot?.id ? " is-active" : ""}`} style={{ width: `${clip.width}px` }} onClick={() => selectShot(clip.id)}><strong>{clip.index + 1}</strong><small>{clip.duration}s{videoByShot.has(clip.id) && !durationByShotId.has(clip.id) ? " · 源时长待确认" : ""}</small></button>)}</div></div></section>
    <Inspector open={inspectorOpen} onClose={onCloseInspector} title="导出与发布"><div className="delivery-inspector"><h2 className="wb-region-heading">导出与发布</h2><p className="wb-region-copy">任务状态独立于发布评测。</p><button className="wb-primary-button" type="button" disabled={isBusy || !storyboards.length} onClick={() => onExport("video_export")}><Download size={16} />导出 MP4</button><button className="wb-secondary-button" type="button" disabled={isBusy} onClick={() => onExport("tts")}><Download size={16} />生成配音</button><button className="wb-secondary-button" type="button" disabled={isBusy} onClick={() => onExport("subtitle")}><Download size={16} />生成字幕</button><button className="wb-primary-button" type="button" disabled={!getDeliveryCandidates(storyboards, assets, exportJobs).length} onClick={onPublish}><Upload size={16} />发布到创作现场</button><section className="delivery-status"><strong>最近任务：{exportStatus}</strong>{summary.messages.map((message) => <p key={message}>{message}</p>)}</section>{exportJobs.filter((job) => job.status === "succeeded" && job.outputUrl).slice(0, 3).map((job) => <a className="delivery-download" key={job.id} href={job.downloadUrl || job.outputUrl} download><Download size={14} />下载 {job.type === "video_export" ? "MP4" : job.type}</a>)}</div></Inspector>
  </main>;
}
