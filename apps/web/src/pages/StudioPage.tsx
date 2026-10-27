import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Download, FileAudio, Film, FolderOpen, Loader2, RefreshCw, Scissors, Subtitles } from "lucide-react";
import type { AssetItem, ExportJob, GenerationTask, Project, ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import { isPersistedPlayableVideoReference } from "@aifilm/shared";
import { api } from "../lib/api";
import { DeliveryExportQuoteDialog } from "../workbench/stages/DeliveryExportQuoteDialog";
import { confirmedDeliveryCredits, deliveryQuoteScopeKey, type DeliveryExportQuote, type DeliveryExportType } from "../workbench/stages/deliveryQuoteModel";
import { getDeliveryExportState, partitionDeliveryExportJobs } from "../workbench/stages/deliveryModel";
import { buildStudioExportIntent, createScopedRequestGate, submitStudioExport, type StudioExportIntent } from "./studioExportModel";
import { DeliveryOutputLibrary } from "../workbench/stages/DeliveryOutputLibrary";
import "../workbench/stages/delivery-editor.css";
import { workbenchPageSession } from "./workbenchPageModel";

interface StudioPageProps {
  projects: Project[];
  tasks: GenerationTask[];
  onOpenProject: (projectId: string) => void;
  onRefresh: () => void | Promise<void>;
}

type StudioAction = "tts" | "subtitle" | "video_export" | "refresh";

interface StudioClip {
  url: string;
  label: string;
  duration: number;
}

export function StudioPage({ projects, tasks, onOpenProject, onRefresh }: StudioPageProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");
  const [workflow, setWorkflow] = useState<ProjectWorkflow>();
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<StudioAction | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [clipIndex, setClipIndex] = useState(0);
  const [previewMode, setPreviewMode] = useState<"final" | "clips">("final");
  const [viewedOutputId, setViewedOutputId] = useState("");
  const [playbackError, setPlaybackError] = useState("");
  const [autoPlayNext, setAutoPlayNext] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const projectRef = useRef(selectedProjectId);
  projectRef.current = selectedProjectId;
  const dataRequests = useRef(createScopedRequestGate()).current;
  const quoteRequests = useRef(createScopedRequestGate()).current;
  const quoteBusyRef = useRef(false);
  const submittingRef = useRef(false);
  const [quoteIntent, setQuoteIntent] = useState<StudioExportIntent | null>(null);
  const [quote, setQuote] = useState<DeliveryExportQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);

  useEffect(() => {
    if (!projects.length) {
      setSelectedProjectId("");
      return;
    }
    if (!selectedProjectId || !projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const loadStudioData = useCallback(async (projectId: string) => {
    if (!projectId) return;
    const ticket = dataRequests.begin(projectId);
    setLoading(true);
    try {
      const [nextWorkflow, nextExportJobs] = await Promise.all([
        api.workflow(projectId),
        api.exportJobs(projectId)
      ]);
      if (!dataRequests.isCurrent(ticket, projectRef.current)) return;
      if (nextWorkflow.project.id !== projectId) throw new Error("作品数据不匹配，请刷新后重试。");
      setWorkflow(nextWorkflow);
      setExportJobs(nextExportJobs);
      setError("");
    } catch (err) {
      if (!dataRequests.isCurrent(ticket, projectRef.current)) return;
      setError(err instanceof Error ? err.message : "剪辑中心数据加载失败");
      throw err;
    } finally {
      if (dataRequests.isCurrent(ticket, projectRef.current)) setLoading(false);
    }
  }, [dataRequests]);

  useEffect(() => {
    setClipIndex(0);
    setPreviewMode("final"); setViewedOutputId(""); setPlaybackError("");
    setAutoPlayNext(false);
    setMessage("");
    setError("");
    setWorkflow(undefined);
    setExportJobs([]);
    setRefreshRequired(false);
    dataRequests.invalidate();
    quoteRequests.invalidate();
    quoteBusyRef.current = false;
    setQuoteLoading(false);
    setQuoteIntent(null);
    setQuote(null);
    setQuoteError("");
    if (!selectedProjectId) {
      setLoading(false);
      return;
    }
    void loadStudioData(selectedProjectId).catch(() => undefined);
    return () => { dataRequests.invalidate(); quoteRequests.invalidate(); };
  }, [dataRequests, loadStudioData, quoteRequests, selectedProjectId]);

  const currentWorkflow = workflow?.project.id === selectedProjectId ? workflow : undefined;
  const project = currentWorkflow?.project ?? projects.find((item) => item.id === selectedProjectId);
  const storyboards = currentWorkflow?.storyboards ?? [];
  const assets = currentWorkflow?.assets ?? [];
  const currentExportJobs = currentWorkflow ? exportJobs : [];
  const scopeKey = currentWorkflow ? deliveryQuoteScopeKey(selectedProjectId, "all", storyboards) : "";
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const confirmedCredits = quoteIntent ? confirmedDeliveryCredits(quote, quoteIntent.type, quoteIntent.scopeKey, scopeKey) : null;
  const exportState = getDeliveryExportState(storyboards, assets);
  const scopedJobs = partitionDeliveryExportJobs(currentExportJobs, storyboards.map(shot => shot.id)).current;
  const projectTasks = useMemo(() => tasks.filter((task) => task.projectId === selectedProjectId), [selectedProjectId, tasks]);
  const hasActiveProcess = projectTasks.some((task) => task.status === "pending" || task.status === "running") || currentExportJobs.some((job) => job.status === "pending" || job.status === "running");

  useEffect(() => {
    if (!selectedProjectId || !hasActiveProcess) return;
    const timer = window.setInterval(() => {
      if (document.hidden || submittingRef.current) return;
      void loadStudioData(selectedProjectId).catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [hasActiveProcess, loadStudioData, selectedProjectId]);

  const imageAssetByShotId = useMemo(() => buildShotAssetMap(assets, "image"), [assets]);
  const videoAssetByShotId = useMemo(() => buildShotAssetMap(assets, "video"), [assets]);
  const latestFinalExport = scopedJobs.find((job) => isMp4Export(job));
  const viewedOutput = currentExportJobs.find(job => job.id === viewedOutputId && isMp4Export(job)) ?? latestFinalExport;
  const finalUrl = previewMode === "final" ? viewedOutput?.previewUrl || viewedOutput?.outputUrl : undefined;

  const shotClips = useMemo<StudioClip[]>(() => {
    const clips: StudioClip[] = [];
    storyboards.forEach((shot) => {
      const asset = videoAssetByShotId.get(shot.id);
      if (isPersistedPlayableVideoReference(asset?.referenceUrl) && asset?.referenceUrl) {
        clips.push({
          url: asset.referenceUrl,
          label: `${formatShotNo(shot)} · ${Math.max(1, shot.duration || 1)}s`,
          duration: Math.max(1, shot.duration || 1)
        });
      }
    });
    return clips;
  }, [storyboards, videoAssetByShotId]);

  const playlist = useMemo<StudioClip[]>(() => {
    if (finalUrl) {
      return [{ url: finalUrl, label: "最终成片 MP4", duration: 0 }];
    }
    return shotClips;
  }, [finalUrl, shotClips]);

  useEffect(() => {
    if (clipIndex >= playlist.length) {
      setClipIndex(0);
      setAutoPlayNext(false);
    }
  }, [clipIndex, playlist.length]);

  const currentClip = playlist[clipIndex] ?? playlist[0];
  const coverImage = storyboards.map((shot) => imageAssetByShotId.get(shot.id)?.referenceUrl).find(Boolean);
  const ttsJob = scopedJobs.find((job) => job.type === "tts");
  const subtitleJob = scopedJobs.find((job) => job.type === "subtitle");
  const outputReady = Boolean(latestFinalExport);
  const totalDuration = storyboards.reduce((sum, shot) => sum + Math.max(0, shot.duration || 0), 0);

  function handleClipEnded() {
    if (finalUrl) return;
    if (clipIndex < playlist.length - 1) {
      setAutoPlayNext(true);
      setClipIndex(clipIndex + 1);
    }
  }

  function selectClip(index: number) {
    setPlaybackError("");
    setAutoPlayNext(true);
    setClipIndex(index);
  }

  async function refreshStudio() {
    if (!selectedProjectId || busyAction || submittingRef.current) return;
    const projectId = selectedProjectId;
    setBusyAction("refresh");
    try {
      await loadStudioData(projectId);
      await onRefresh();
      if (projectRef.current === projectId) { setRefreshRequired(false); setMessage("剪辑数据已刷新。"); }
    } catch (reason) {
      if (projectRef.current === projectId) setError(reason instanceof Error ? reason.message : "数据刷新失败，请稍后重试。");
    } finally { setBusyAction(null); }
  }

  function openDeliveryEditor() {
    if (!project) return;
    if (currentWorkflow) {
      const state = workbenchPageSession.load(currentWorkflow);
      workbenchPageSession.save(project.id, { ...state, activeStage: "delivery" });
    }
    onOpenProject(project.id);
  }

  async function openExportQuote(type: DeliveryExportType) {
    if (!currentWorkflow || loading || refreshRequired || quoteBusyRef.current || submittingRef.current) return;
    let intent: StudioExportIntent;
    try {
      intent = buildStudioExportIntent(currentWorkflow, type);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "当前作品不可导出。"); return; }
    const ticket = quoteRequests.begin(intent.scopeKey);
    quoteBusyRef.current = true;
    setQuoteIntent(intent); setQuote(null); setQuoteError(""); setQuoteLoading(true);
    try {
      const result = await api.quoteExport(intent.projectId, { type, storyboardIds: intent.storyboardIds });
      if (!quoteRequests.isCurrent(ticket, scopeRef.current)) return;
      if (result.type !== type || result.unit !== "tts_character") throw new Error("导出报价格式不正确，请刷新报价后重试。");
      const nextQuote: DeliveryExportQuote = { ...result, type, unit: "tts_character" };
      if (confirmedDeliveryCredits(nextQuote, type, intent.scopeKey, scopeRef.current) === null) throw new Error("导出费用不可用，请刷新报价后重试。");
      setQuote(nextQuote);
    } catch (reason) {
      if (quoteRequests.isCurrent(ticket, scopeRef.current)) setQuoteError(reason instanceof Error ? reason.message : "无法获取报价，请重试。");
    } finally {
      if (quoteRequests.isCurrent(ticket, intent.scopeKey)) { quoteBusyRef.current = false; setQuoteLoading(false); }
    }
  }

  function closeExportQuote() {
    if (submittingRef.current) return;
    quoteRequests.invalidate(); quoteBusyRef.current = false;
    setQuoteIntent(null); setQuote(null); setQuoteError(""); setQuoteLoading(false);
  }

  async function confirmExport() {
    if (!quoteIntent || confirmedCredits === null || submittingRef.current || quoteIntent.projectId !== projectRef.current) return;
    const intent = quoteIntent;
    submittingRef.current = true; setSubmitting(true); setBusyAction(intent.type); setQuoteError("");
    setMessage(""); setError("");
    try {
      const result = await submitStudioExport(intent, quote, scopeRef.current, {
        submit: api.createExportJob,
        sync: async (projectId) => { await loadStudioData(projectId); await onRefresh(); }
      });
      if (projectRef.current !== intent.projectId) return;
      setExportJobs((current) => current.some(item => item.id === result.job.id) ? current : [result.job, ...current]);
      setQuoteIntent(null); setQuote(null);
      if (result.status === "failed") setError(result.job.errorReason || "导出未完成，请核对记录中的原因后重新获取报价。");
      else if (result.status === "sync-required") {
        setRefreshRequired(true);
        setMessage(`${exportJobMessage(result.job)} 数据刷新失败，请先刷新记录；无需重新提交导出。`);
      } else setMessage(exportJobMessage(result.job));
    } catch (reason) {
      if (projectRef.current === intent.projectId) setQuoteError(reason instanceof Error ? reason.message : "未确认导出结果，请先刷新导出记录后再决定是否重试。");
    } finally { submittingRef.current = false; setSubmitting(false); setBusyAction(null); }
  }

  async function downloadExport(job: ExportJob) {
    if (!currentWorkflow || !selectedProjectId) return;
    try {
      const blob = await api.downloadExportJob(selectedProjectId, job.id);
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = exportDownloadName(job);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件下载失败");
    }
  }

  if (!projects.length) {
    return (
      <div className="page-stack studio-page">
        <section className="studio-empty-state">
          <Film size={34} />
          <div>
            <h1>剪辑中心</h1>
            <p>这里是跨作品的合成与导出中心。先在「内容创作」完成一部漫剧的剧本与分镜，生成镜头视频后，回到这里连播预览、合成 MP4、生成配音和字幕。</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack studio-page">
      <section className="studio-hero">
        <div>
          <span className="section-kicker">COMPOSE & EXPORT</span>
          <h1>剪辑中心</h1>
          <p>选择作品后预览视频片段，查看费用并导出全部剧集。按集导出或调整镜头顺序，请进入生产台的成片阶段。</p>
        </div>
        <div className="studio-hero-stats">
          <StudioStat label="可连播片段" value={`${shotClips.length}/${storyboards.length || 0}`} ready={shotClips.length > 0} />
          <StudioStat label="全项目配音 / 字幕" value={exportStatusText(scopedJobs)} ready={scopedJobs.some(job => job.status === "succeeded" && (job.type === "tts" || job.type === "subtitle"))} />
          <StudioStat label="成片" value={outputReady ? "可预览" : "未合成"} ready={outputReady} />
        </div>
      </section>

      <div className="studio-layout studio-export-layout">
        <section className="studio-panel studio-project-rail">
          <div className="studio-panel-head">
            <div>
              <h2>作品队列</h2>
              <small>选择要合成与导出的作品</small>
            </div>
            <button className="studio-icon-button" onClick={() => void refreshStudio()} disabled={Boolean(busyAction)} aria-label="刷新剪辑中心">
              {busyAction === "refresh" ? <Loader2 size={16} className="spin-icon" /> : <RefreshCw size={16} />}
            </button>
          </div>
          <div className="studio-project-list">
            {projects.map((item) => (
              <button className={item.id === selectedProjectId ? "active" : ""} key={item.id} onClick={() => setSelectedProjectId(item.id)} disabled={submitting} type="button">
                <strong>{item.name}</strong>
                <span>{item.videoRatio} · {item.storyboards} 分镜 · {item.videoClips} 视频</span>
              </button>
            ))}
          </div>
        </section>

        <section className="studio-panel studio-preview-panel">
          <div className="studio-panel-head">
            <div>
              <h2>{finalUrl ? "最终成片预览" : shotClips.length ? "视频片段连播" : "成片预览"}</h2>
              <small>{project ? `${project.name} · ${project.videoRatio} · 共 ${storyboards.length} 镜头 / 约 ${totalDuration}s` : "选择作品后加载预览"}</small>
            </div>
            <div className="studio-actions-inline">
              <button className="ghost-button" onClick={() => project && onOpenProject(project.id)} disabled={!project}>
                <Clapperboard size={17} />去生产台编辑
              </button>
            </div>
          </div>

          <div className="studio-preview-switch" aria-label="视频预览模式">
            <button type="button" className="ghost-button" aria-pressed={previewMode === "final"} disabled={!currentExportJobs.some(isMp4Export)} onClick={() => { setPreviewMode("final"); setAutoPlayNext(false); setPlaybackError(""); }}><Film size={15} />成片版本</button>
            <button type="button" className="ghost-button" aria-pressed={previewMode === "clips"} disabled={!shotClips.length} onClick={() => { setPreviewMode("clips"); setClipIndex(0); setAutoPlayNext(false); setPlaybackError(""); }}><Scissors size={15} />生成片段 · {shotClips.length}</button>
          </div>
          <div className={`studio-player ${project ? ratioClass(project.videoRatio) : ""}`}>
            {currentClip ? (
              <video
                key={currentClip.url}
                ref={videoRef}
                src={currentClip.url}
                controls
                playsInline
                poster={coverImage}
                autoPlay={autoPlayNext}
                preload="metadata"
                onEnded={handleClipEnded}
                onError={() => { setPlaybackError("视频暂时无法播放，请刷新核对或下载文件后查看。"); setAutoPlayNext(false); }}
              />
            ) : coverImage ? (
              <img src={coverImage} alt="镜头首帧" />
            ) : (
              <div className="studio-player-empty">
                <Scissors size={30} />
                <strong>还没有可播放的视频片段</strong>
                <span>先到生产台完成分镜生图与图生视频，片段会自动出现在这里。</span>
                <button className="ghost-button" type="button" onClick={() => project && onOpenProject(project.id)} disabled={!project}>
                  <FolderOpen size={16} />去生产台生成片段
                </button>
              </div>
            )}
          </div>
          {playbackError ? <p role="alert" className="danger-text">{playbackError}</p> : null}

          {!finalUrl && shotClips.length ? (
            <div className="studio-playlist-strip" role="tablist" aria-label="片段连播列表">
              {shotClips.map((clip, index) => (
                <button
                  key={`${clip.url}-${index}`}
                  type="button"
                  className={index === clipIndex ? "active" : ""}
                  title={clip.label}
                  onClick={() => selectClip(index)}
                >
                  {String(index + 1).padStart(2, "0")}
                </button>
              ))}
              <span className="studio-playlist-meta">第 {Math.min(clipIndex + 1, shotClips.length)} / {shotClips.length} 段 · 播完自动接下一段</span>
            </div>
          ) : null}

          <p className="studio-preview-note">
            {finalUrl
              ? "当前播放的是合成后的最终 MP4。要调整镜头顺序、时长或替换片段，请进入生产台的成片时间线。"
              : "连播使用各镜头的图生视频结果，仅用于快速检查；镜头级剪辑、配音对轨请到生产台成片阶段完成。"}
          </p>
          <DeliveryOutputLibrary jobs={currentExportJobs} onPreview={job => { setViewedOutputId(job.id); setPreviewMode("final"); setAutoPlayNext(false); setPlaybackError(""); }} onDownload={job => void downloadExport(job)} />
        </section>

        <section className="studio-panel studio-inspector">
          <div className="studio-panel-head">
            <div>
              <h2>合成与导出</h2>
              <small>{project ? `当前作品：${project.name}` : "请选择作品"}</small>
            </div>
          </div>

          {loading ? <div className="studio-loading"><Loader2 size={18} className="spin-icon" />正在加载作品数据...</div> : null}
          {message ? <p className="success-text" role="status">{message}</p> : null}
          {error ? <p className="danger-text" role="alert">{error}</p> : null}
          <p className="studio-preview-note">导出范围：本项目全部剧集，共 {storyboards.length} 个镜头，按项目镜头顺序。单集或自定义顺序请到生产台导出。</p>
          {refreshRequired ? <button className="ghost-button" onClick={() => void refreshStudio()} disabled={Boolean(busyAction)}><RefreshCw size={16} />仅刷新导出记录</button> : null}
          {quoteIntent && quoteIntent.scopeKey !== scopeKey ? <p className="danger-text" role="alert">作品内容已变化，请刷新报价。</p> : null}

          <div className="studio-action-stack">
            <button className="primary-button" onClick={() => void openExportQuote("video_export")} disabled={!exportState.canExportVideo || loading || refreshRequired || quoteLoading || Boolean(busyAction)} title={exportState.missingVideoCount ? `还有 ${exportState.missingVideoCount} 个镜头视频未完成` : "先查看费用，再确认合成"}>
              {busyAction === "video_export" ? <Loader2 size={17} className="spin-icon" /> : <Film size={17} />}
              合成 MP4 成片
            </button>
            <button className="ghost-button" onClick={() => void openExportQuote("tts")} disabled={!storyboards.length || loading || refreshRequired || quoteLoading || Boolean(busyAction)}>
              {busyAction === "tts" ? <Loader2 size={17} className="spin-icon" /> : <FileAudio size={17} />}
              生成配音轨{ttsJob ? `（${exportJobStatusText(ttsJob.status)}）` : ""}
            </button>
            <button className="ghost-button" onClick={() => void openExportQuote("subtitle")} disabled={!storyboards.length || loading || refreshRequired || quoteLoading || Boolean(busyAction)}>
              {busyAction === "subtitle" ? <Loader2 size={17} className="spin-icon" /> : <Subtitles size={17} />}
              生成字幕轨{subtitleJob ? `（${exportJobStatusText(subtitleJob.status)}）` : ""}
            </button>
            <button className="ghost-button" onClick={openDeliveryEditor} disabled={!currentWorkflow}>
              <Scissors size={17} />继续剪辑
            </button>
          </div>

          <div className="studio-task-list">
            <strong>任务进度</strong>
            {projectTasks.slice(0, 4).map((task) => (
              <article key={task.id}>
                <div><span>{task.title}</span><em>{taskStatusText(task.status)}</em></div>
                <div className="studio-progress-line"><span style={{ width: `${Math.max(4, Math.min(100, task.progress || 0))}%` }} /></div>
              </article>
            ))}
            {!projectTasks.length ? <small>当前作品暂无排队任务。</small> : null}
          </div>

          <div className="studio-export-list">
            <strong>导出记录</strong>
            {currentExportJobs.slice(0, 5).map((job) => (
              <article key={job.id}>
                <div>
                  <span>{exportJobTitle(job)}</span>
                  <small>{exportJobStatusText(job.status)} · {new Date(job.updatedAt).toLocaleString()}</small>
                  <small>{job.status === "succeeded" && job.sourceStatus !== "current" ? (job.sourceStatus === "stale" ? "历史版本 · 内容已更新" : "历史版本 · 输入未核验") : scopedJobs.some(item => item.id === job.id) ? "本项目全部镜头" : job.storyboardIds?.length ? `其他导出范围 · ${job.storyboardIds.length} 镜头` : "历史记录 · 范围未记录"}</small>
                  {job.errorReason ? <small className="danger-text">{job.errorReason}</small> : null}
                </div>
                {job.status === "succeeded" && (job.downloadUrl || job.outputUrl) ? (
                  <button className="studio-icon-button" onClick={() => void downloadExport(job)} type="button" aria-label="下载导出文件"><Download size={15} /></button>
                ) : null}
              </article>
            ))}
            {!currentExportJobs.length ? <small>合成、配音和字幕记录会显示在这里，完成后可直接下载。</small> : null}
          </div>
        </section>
      </div>
      {quoteIntent ? <DeliveryExportQuoteDialog type={quoteIntent.type} episode="all" shotCount={quoteIntent.storyboardIds.length} quote={quote} loading={quoteLoading} submitting={submitting} error={quoteIntent.scopeKey !== scopeKey ? "作品内容已变化，请刷新报价后重新确认。" : quoteError} maxCredits={confirmedCredits} onRetry={() => void openExportQuote(quoteIntent.type)} onSubmit={() => void confirmExport()} onClose={closeExportQuote} /> : null}
    </div>
  );
}

function StudioStat({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <article className={ready ? "ready" : ""}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function buildShotAssetMap(assets: AssetItem[], type: AssetItem["type"]) {
  return new Map(
    assets
      .filter((asset) => asset.type === type)
      .map((asset) => [asset.id.replace(new RegExp(`^${type}_`), ""), asset])
  );
}

function isMp4Export(job: ExportJob) {
  return job.status === "succeeded" && (job.outputKind === "mp4" || Boolean(job.outputUrl?.split(/[?#]/)[0]?.endsWith(".mp4"))) && Boolean(job.previewUrl || job.outputUrl);
}

function exportStatusText(jobs: ExportJob[]) {
  const tts = jobs.find((job) => job.type === "tts" && job.status === "succeeded");
  const subtitle = jobs.find((job) => job.type === "subtitle" && job.status === "succeeded");
  if (tts && subtitle) return "已生成";
  if (tts) return "已有配音";
  if (subtitle) return "已有字幕";
  return "待生成";
}

function exportJobTitle(job: ExportJob) {
  if (job.type === "tts") return "配音音轨";
  if (job.type === "subtitle") return "字幕文件";
  if (isMp4Export(job)) return "MP4 成片";
  if (job.outputKind === "diagnostic_bundle") return "合成诊断包";
  return "导出任务";
}

function exportJobMessage(job: ExportJob) {
  if (job.status === "running" || job.status === "pending") return `${exportJobTitle(job)}已创建，完成后会回写到预览和导出记录。`;
  if (isMp4Export(job)) return "MP4 成片已生成，可以直接在中间预览。";
  return `${exportJobTitle(job)}状态：${exportJobStatusText(job.status)}`;
}

function exportJobStatusText(status: ExportJob["status"]) {
  const labels: Record<string, string> = {
    pending: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败"
  };
  return labels[status] ?? status;
}

function taskStatusText(status: GenerationTask["status"]) {
  const labels: Record<string, string> = {
    pending: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    canceled: "已取消",
    refunded: "已解冻"
  };
  return labels[status] ?? status;
}

function exportDownloadName(job: ExportJob) {
  const ext = job.outputUrl?.split(/[?#]/)[0]?.match(/\.([a-z0-9]+)$/i)?.[1];
  const prefix = job.type === "video_export" ? "video-export" : job.type;
  return `${prefix}-${job.id}.${ext || "bin"}`;
}

function formatShotNo(shot: StoryboardShot) {
  const shotNo = String(shot.shotNo || 1).padStart(2, "0");
  return `第${shot.sceneNo || 1}场 · 镜头${shotNo}`;
}

function ratioClass(ratio: Project["videoRatio"]) {
  return `ratio-${ratio.replace(":", "-")}`;
}
