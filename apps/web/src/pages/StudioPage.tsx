import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileAudio, Film, FolderOpen, Loader2, RefreshCw, Scissors, Subtitles, WandSparkles } from "lucide-react";
import type { AssetItem, ExportJob, GenerationTask, Project, ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import { api } from "../lib/api";

interface StudioPageProps {
  projects: Project[];
  tasks: GenerationTask[];
  onOpenProject: (projectId: string) => void;
  onRefresh: () => void;
}

type StudioAction = "video" | "tts" | "subtitle" | "video_export" | "refresh";

export function StudioPage({ projects, tasks, onOpenProject, onRefresh }: StudioPageProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");
  const [workflow, setWorkflow] = useState<ProjectWorkflow>();
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [selectedShotId, setSelectedShotId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<StudioAction | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
    setLoading(true);
    setError("");
    try {
      const [nextWorkflow, nextExportJobs] = await Promise.all([
        api.workflow(projectId),
        api.exportJobs(projectId)
      ]);
      setWorkflow(nextWorkflow);
      setExportJobs(nextExportJobs);
    } catch (err) {
      setWorkflow(undefined);
      setExportJobs([]);
      setError(err instanceof Error ? err.message : "剪辑中心数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setWorkflow(undefined);
      setExportJobs([]);
      return;
    }
    void loadStudioData(selectedProjectId);
  }, [loadStudioData, selectedProjectId]);

  const project = workflow?.project ?? projects.find((item) => item.id === selectedProjectId);
  const storyboards = workflow?.storyboards ?? [];
  const assets = workflow?.assets ?? [];
  const projectTasks = useMemo(() => tasks.filter((task) => task.projectId === selectedProjectId), [selectedProjectId, tasks]);
  const hasActiveProcess = projectTasks.some((task) => task.status === "pending" || task.status === "running") || exportJobs.some((job) => job.status === "pending" || job.status === "running");

  useEffect(() => {
    if (!selectedProjectId || !hasActiveProcess) return;
    const timer = window.setInterval(() => {
      void loadStudioData(selectedProjectId);
      onRefresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [hasActiveProcess, loadStudioData, onRefresh, selectedProjectId]);

  const imageAssetByShotId = useMemo(() => buildShotAssetMap(assets, "image"), [assets]);
  const videoAssetByShotId = useMemo(() => buildShotAssetMap(assets, "video"), [assets]);
  const selectedShot = useMemo(() => storyboards.find((shot) => shot.id === selectedShotId) ?? storyboards[0], [selectedShotId, storyboards]);

  useEffect(() => {
    if (!storyboards.length) {
      setSelectedShotId(undefined);
      return;
    }
    if (!selectedShotId || !storyboards.some((shot) => shot.id === selectedShotId)) {
      setSelectedShotId(storyboards[0].id);
    }
  }, [selectedShotId, storyboards]);

  const latestFinalExport = useMemo(() => exportJobs.find((job) => isMp4Export(job)), [exportJobs]);
  const selectedVideoAsset = selectedShot ? videoAssetByShotId.get(selectedShot.id) : undefined;
  const firstPlayableVideoAsset = useMemo(() => {
    for (const shot of storyboards) {
      const asset = videoAssetByShotId.get(shot.id);
      if (isPlayableVideoUrl(asset?.referenceUrl)) return asset;
    }
    return undefined;
  }, [storyboards, videoAssetByShotId]);
  const previewUrl = latestFinalExport?.previewUrl || latestFinalExport?.outputUrl || (isPlayableVideoUrl(selectedVideoAsset?.referenceUrl) ? selectedVideoAsset?.referenceUrl : firstPlayableVideoAsset?.referenceUrl);
  const previewLabel = latestFinalExport ? "最终成片预览" : selectedVideoAsset?.referenceUrl ? "当前镜头预览" : firstPlayableVideoAsset ? "已有镜头预览" : "等待视频素材";
  const totalDuration = storyboards.reduce((sum, shot) => sum + Math.max(0, shot.duration || 0), 0);
  const timelineDuration = duration || totalDuration || 1;
  const timelineSegments = useMemo(() => buildTimelineSegments(storyboards), [storyboards]);
  const readyImages = storyboards.filter((shot) => imageAssetByShotId.has(shot.id)).length;
  const playableVideos = storyboards.filter((shot) => isPlayableVideoUrl(videoAssetByShotId.get(shot.id)?.referenceUrl)).length;
  const outputReady = Boolean(latestFinalExport);
  const selectedSegment = selectedShot ? timelineSegments.find((segment) => segment.shot.id === selectedShot.id) : undefined;
  const displayTime = Math.min(currentTime, timelineDuration);
  const progressPercent = Math.max(0, Math.min(100, (displayTime / timelineDuration) * 100));

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
  }, [previewUrl]);

  async function refreshStudio() {
    if (!selectedProjectId) return;
    setBusyAction("refresh");
    await loadStudioData(selectedProjectId);
    onRefresh();
    setBusyAction(null);
  }

  async function runVideoGeneration() {
    if (!selectedProjectId) return;
    setBusyAction("video");
    setMessage("");
    setError("");
    try {
      const result = await api.generateVideos(selectedProjectId);
      setMessage(result.task.status === "running"
        ? `已提交 ${result.assetsCreated} 个视频镜头任务，生成完成后会自动回写到时间线。`
        : result.assetsCreated
          ? `已生成 ${result.assetsCreated} 个可预览视频片段。`
          : "已有视频片段不会重复生成，可以继续合成成片。"
      );
      await loadStudioData(selectedProjectId);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "视频片段生成失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function runExport(type: "tts" | "subtitle" | "video_export") {
    if (!selectedProjectId) return;
    setBusyAction(type);
    setMessage("");
    setError("");
    try {
      const job = await api.createExportJob(selectedProjectId, { type });
      setExportJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setMessage(exportJobMessage(job));
      await loadStudioData(selectedProjectId);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出任务失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function downloadExport(job: ExportJob) {
    if (!selectedProjectId) return;
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

  function seekTo(value: number) {
    const next = Math.max(0, Math.min(timelineDuration, value));
    setCurrentTime(next);
    if (videoRef.current && previewUrl) {
      videoRef.current.currentTime = Math.min(next, videoRef.current.duration || next);
    }
    const segment = timelineSegments.find((item) => next >= item.start && next < item.end) ?? timelineSegments[timelineSegments.length - 1];
    if (segment) setSelectedShotId(segment.shot.id);
  }

  function selectShot(segment: TimelineSegment) {
    setSelectedShotId(segment.shot.id);
    const target = latestFinalExport ? segment.start : 0;
    seekTo(target);
  }

  if (!projects.length) {
    return (
      <div className="page-stack studio-page">
        <section className="studio-empty-state">
          <Film size={34} />
          <div>
            <h1>剪辑中心</h1>
            <p>还没有可剪辑的作品。先创建一个漫剧项目，生成分镜和视频片段后，这里会自动出现实时预览、时间线和合成入口。</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack studio-page">
      <section className="studio-hero">
        <div>
          <span className="section-kicker">EDITING CENTER</span>
          <h1>剪辑中心</h1>
          <p>按项目整理镜头片段、首帧、配音、字幕和 MP4 合成。主流程先在页面内预览视频和拖动进度，下载只作为最终交付动作。</p>
        </div>
        <div className="studio-hero-stats">
          <StudioStat label="首帧" value={`${readyImages}/${storyboards.length || 0}`} ready={storyboards.length > 0 && readyImages >= storyboards.length} />
          <StudioStat label="视频片段" value={`${playableVideos}/${storyboards.length || 0}`} ready={playableVideos > 0} />
          <StudioStat label="成片" value={outputReady ? "可预览" : "未合成"} ready={outputReady} />
        </div>
      </section>

      <div className="studio-flow-strip">
        <StudioStep index={1} title="选择作品" detail={project?.name ?? "未选择"} ready={Boolean(project)} />
        <StudioStep index={2} title="片段生成" detail={`${readyImages} 张首帧 / ${playableVideos} 段视频`} ready={playableVideos > 0} />
        <StudioStep index={3} title="配音字幕" detail={exportStatusText(exportJobs)} ready={exportJobs.some((job) => job.type === "tts" || job.type === "subtitle")} />
        <StudioStep index={4} title="成片预览" detail={latestFinalExport ? "已生成 MP4" : "等待合成"} ready={Boolean(latestFinalExport)} />
      </div>

      <div className="studio-layout">
        <section className="studio-panel studio-project-rail">
          <div className="studio-panel-head">
            <div>
              <h2>作品队列</h2>
              <small>选择要剪辑和合成的项目</small>
            </div>
            <button className="studio-icon-button" onClick={() => void refreshStudio()} disabled={busyAction === "refresh"} aria-label="刷新剪辑中心">
              {busyAction === "refresh" ? <Loader2 size={16} className="spin-icon" /> : <RefreshCw size={16} />}
            </button>
          </div>
          <div className="studio-project-list">
            {projects.map((item) => (
              <button className={item.id === selectedProjectId ? "active" : ""} key={item.id} onClick={() => setSelectedProjectId(item.id)} type="button">
                <strong>{item.name}</strong>
                <span>{item.videoRatio} · {item.storyboards} 分镜 · {item.videoClips} 视频</span>
              </button>
            ))}
          </div>
        </section>

        <section className="studio-panel studio-preview-panel">
          <div className="studio-panel-head">
            <div>
              <h2>{previewLabel}</h2>
              <small>{project ? `${project.name} · ${project.videoRatio} · ${project.status}` : "选择作品后加载视频预览"}</small>
            </div>
            <div className="studio-actions-inline">
              <button className="ghost-button" onClick={() => project && onOpenProject(project.id)} disabled={!project}><FolderOpen size={17} />生产台</button>
              <button className="primary-button" onClick={() => void runExport("video_export")} disabled={!storyboards.length || Boolean(busyAction)}>
                {busyAction === "video_export" ? <Loader2 size={17} className="spin-icon" /> : <Film size={17} />}
                合成 MP4
              </button>
            </div>
          </div>

          <div className={`studio-player ${project ? ratioClass(project.videoRatio) : ""}`}>
            {previewUrl ? (
              <video
                ref={videoRef}
                src={previewUrl}
                controls
                preload="metadata"
                onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              />
            ) : selectedShot && imageAssetByShotId.get(selectedShot.id)?.referenceUrl ? (
              <img src={imageAssetByShotId.get(selectedShot.id)?.referenceUrl} alt={selectedShot.pictureDesc || "镜头首帧"} />
            ) : (
              <div className="studio-player-empty">
                <Scissors size={30} />
                <strong>还没有可播放视频</strong>
                <span>先生成首帧和镜头视频，或在右侧直接创建合成任务。</span>
              </div>
            )}
          </div>

          <div className="studio-scrubber">
            <div className="studio-scrubber-meta">
              <span>{formatTime(displayTime)}</span>
              <strong>{selectedShot ? formatShotNo(selectedShot) : "未选择镜头"}</strong>
              <span>{formatTime(timelineDuration)}</span>
            </div>
            <input aria-label="视频进度" type="range" min={0} max={timelineDuration} step={0.1} value={displayTime} onChange={(event) => seekTo(Number(event.currentTarget.value))} />
          </div>

          <div className="studio-timeline-board">
            <div className="studio-timeline-ruler">
              <span>00:00</span>
              <span>{formatTime(timelineDuration / 2)}</span>
              <span>{formatTime(timelineDuration)}</span>
            </div>
            <div className="studio-track">
              <div className="studio-playhead" style={{ left: `${progressPercent}%` }} />
              {timelineSegments.map((segment, index) => {
                const imageReady = imageAssetByShotId.has(segment.shot.id);
                const videoReady = isPlayableVideoUrl(videoAssetByShotId.get(segment.shot.id)?.referenceUrl);
                return (
                  <button
                    className={`${selectedShot?.id === segment.shot.id ? "active" : ""} ${videoReady ? "ready" : imageReady ? "image-ready" : ""}`}
                    key={segment.shot.id}
                    onClick={() => selectShot(segment)}
                    style={{ flexBasis: `${segment.width}%` }}
                    title={`${formatShotNo(segment.shot)} · ${segment.shot.duration}s`}
                    type="button"
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </button>
                );
              })}
            </div>
            <div className="studio-track-labels">
              <span>视频轨</span>
              <span>配音轨</span>
              <span>字幕轨</span>
            </div>
          </div>
        </section>

        <section className="studio-panel studio-inspector">
          <div className="studio-panel-head">
            <div>
              <h2>镜头检查器</h2>
              <small>{selectedShot ? `${formatShotNo(selectedShot)} · ${selectedShot.duration}s` : "选择时间线镜头查看详情"}</small>
            </div>
          </div>

          {loading ? <div className="studio-loading"><Loader2 size={18} className="spin-icon" />正在加载工作流...</div> : null}
          {message ? <p className="success-text">{message}</p> : null}
          {error ? <p className="danger-text">{error}</p> : null}

          {selectedShot ? (
            <div className="studio-shot-card">
              <div className="studio-shot-thumb">
                {isPlayableVideoUrl(videoAssetByShotId.get(selectedShot.id)?.referenceUrl) ? (
                  <video src={videoAssetByShotId.get(selectedShot.id)?.referenceUrl} preload="metadata" />
                ) : imageAssetByShotId.get(selectedShot.id)?.referenceUrl ? (
                  <img src={imageAssetByShotId.get(selectedShot.id)?.referenceUrl} alt={selectedShot.pictureDesc || "镜头首帧"} />
                ) : (
                  <span>缺首帧</span>
                )}
              </div>
              <dl>
                <div><dt>景别/运镜</dt><dd>{selectedShot.shotSize} / {selectedShot.cameraMovement}</dd></div>
                <div><dt>角色</dt><dd>{selectedShot.characters.join("、") || "空镜"}</dd></div>
                <div><dt>画面</dt><dd>{selectedShot.pictureDesc}</dd></div>
                <div><dt>台词/旁白</dt><dd>{selectedShot.dialogue || selectedShot.voiceOver || "无"}</dd></div>
              </dl>
            </div>
          ) : null}

          <div className="studio-action-stack">
            <button className="primary-button" onClick={() => void runVideoGeneration()} disabled={!readyImages || Boolean(busyAction)}>
              {busyAction === "video" ? <Loader2 size={17} className="spin-icon" /> : <WandSparkles size={17} />}
              生成/回写视频片段
            </button>
            <button className="ghost-button" onClick={() => void runExport("tts")} disabled={!storyboards.length || Boolean(busyAction)}>
              {busyAction === "tts" ? <Loader2 size={17} className="spin-icon" /> : <FileAudio size={17} />}
              生成配音轨
            </button>
            <button className="ghost-button" onClick={() => void runExport("subtitle")} disabled={!storyboards.length || Boolean(busyAction)}>
              {busyAction === "subtitle" ? <Loader2 size={17} className="spin-icon" /> : <Subtitles size={17} />}
              生成字幕轨
            </button>
          </div>

          <div className="studio-task-list">
            <strong>任务进度</strong>
            {projectTasks.slice(0, 4).map((task) => (
              <article key={task.id}>
                <div><span>{task.title}</span><em>{task.status}</em></div>
                <div className="studio-progress-line"><span style={{ width: `${Math.max(4, Math.min(100, task.progress || 0))}%` }} /></div>
              </article>
            ))}
            {!projectTasks.length ? <small>当前项目暂无排队任务。</small> : null}
          </div>

          <div className="studio-export-list">
            <strong>导出记录</strong>
            {exportJobs.slice(0, 5).map((job) => (
              <article key={job.id}>
                <div>
                  <span>{exportJobTitle(job)}</span>
                  <small>{job.status} · {new Date(job.updatedAt).toLocaleString()}</small>
                </div>
                {job.downloadUrl || job.outputUrl ? (
                  <button className="studio-icon-button" onClick={() => void downloadExport(job)} type="button" aria-label="下载导出文件"><Download size={15} /></button>
                ) : null}
              </article>
            ))}
            {!exportJobs.length ? <small>合成、配音和字幕记录会显示在这里。</small> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

interface TimelineSegment {
  shot: StoryboardShot;
  start: number;
  end: number;
  width: number;
}

function StudioStat({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <article className={ready ? "ready" : ""}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function StudioStep({ index, title, detail, ready }: { index: number; title: string; detail: string; ready: boolean }) {
  return (
    <article className={ready ? "ready" : ""}>
      <b>{index}</b>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
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

function buildTimelineSegments(storyboards: StoryboardShot[]): TimelineSegment[] {
  const total = storyboards.reduce((sum, shot) => sum + Math.max(1, shot.duration || 1), 0) || 1;
  let cursor = 0;
  return storyboards.map((shot) => {
    const duration = Math.max(1, shot.duration || 1);
    const segment = {
      shot,
      start: cursor,
      end: cursor + duration,
      width: Math.max(4, (duration / total) * 100)
    };
    cursor += duration;
    return segment;
  });
}

function isPlayableVideoUrl(url?: string) {
  if (!url) return false;
  return url.startsWith("/storage/") || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:video");
}

function isMp4Export(job: ExportJob) {
  return job.status === "succeeded" && (job.outputKind === "mp4" || Boolean(job.outputUrl?.split(/[?#]/)[0]?.endsWith(".mp4"))) && Boolean(job.previewUrl || job.outputUrl);
}

function exportStatusText(jobs: ExportJob[]) {
  const tts = jobs.find((job) => job.type === "tts");
  const subtitle = jobs.find((job) => job.type === "subtitle");
  if (tts && subtitle) return "配音和字幕已生成";
  if (tts) return "已有配音轨";
  if (subtitle) return "已有字幕轨";
  return "等待生成";
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
  if (isMp4Export(job)) return "MP4 成片已生成，可以直接在剪辑中心预览进度。";
  return `${exportJobTitle(job)}状态：${job.status}`;
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

function formatTime(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
