import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Download, FileAudio, Film, FolderOpen, Loader2, RefreshCw, Scissors, Subtitles } from "lucide-react";
import type { AssetItem, ExportJob, GenerationTask, Project, ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import { isPersistedPlayableVideoReference } from "@aifilm/shared";
import { api } from "../lib/api";

interface StudioPageProps {
  projects: Project[];
  tasks: GenerationTask[];
  onOpenProject: (projectId: string) => void;
  onRefresh: () => void;
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
  const [autoPlayNext, setAutoPlayNext] = useState(false);
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
    setClipIndex(0);
    setAutoPlayNext(false);
    setMessage("");
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
  const latestFinalExport = useMemo(() => exportJobs.find((job) => isMp4Export(job)), [exportJobs]);
  const finalUrl = latestFinalExport?.previewUrl || latestFinalExport?.outputUrl;

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
  const ttsJob = exportJobs.find((job) => job.type === "tts");
  const subtitleJob = exportJobs.find((job) => job.type === "subtitle");
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
    setAutoPlayNext(true);
    setClipIndex(index);
  }

  async function refreshStudio() {
    if (!selectedProjectId) return;
    setBusyAction("refresh");
    await loadStudioData(selectedProjectId);
    onRefresh();
    setBusyAction(null);
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
          <p>跨作品的合成与导出中心：左侧选择作品，中间连播预览已有视频片段或最终成片，右侧一键合成 MP4、生成配音与字幕。镜头级的精细编辑请进入生产台的成片时间线。</p>
        </div>
        <div className="studio-hero-stats">
          <StudioStat label="可连播片段" value={`${shotClips.length}/${storyboards.length || 0}`} ready={shotClips.length > 0} />
          <StudioStat label="配音 / 字幕" value={exportStatusText(exportJobs)} ready={Boolean(ttsJob || subtitleJob)} />
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
              <h2>{finalUrl ? "最终成片预览" : shotClips.length ? "视频片段连播" : "成片预览"}</h2>
              <small>{project ? `${project.name} · ${project.videoRatio} · 共 ${storyboards.length} 镜头 / 约 ${totalDuration}s` : "选择作品后加载预览"}</small>
            </div>
            <div className="studio-actions-inline">
              <button className="ghost-button" onClick={() => project && onOpenProject(project.id)} disabled={!project}>
                <Clapperboard size={17} />去成片时间线编辑
              </button>
            </div>
          </div>

          <div className={`studio-player ${project ? ratioClass(project.videoRatio) : ""}`}>
            {currentClip ? (
              <video
                key={currentClip.url}
                ref={videoRef}
                src={currentClip.url}
                controls
                autoPlay={autoPlayNext}
                preload="metadata"
                onEnded={handleClipEnded}
              />
            ) : coverImage ? (
              <img src={coverImage} alt="镜头首帧" />
            ) : (
              <div className="studio-player-empty">
                <Scissors size={30} />
                <strong>还没有可播放的视频片段</strong>
                <span>先到生产台完成分镜生图与图生视频，片段会自动出现在这里；也可以直接在右侧发起合成任务。</span>
                <button className="ghost-button" type="button" onClick={() => project && onOpenProject(project.id)} disabled={!project}>
                  <FolderOpen size={16} />去生产台生成片段
                </button>
              </div>
            )}
          </div>

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
        </section>

        <section className="studio-panel studio-inspector">
          <div className="studio-panel-head">
            <div>
              <h2>合成与导出</h2>
              <small>{project ? `当前作品：${project.name}` : "请选择作品"}</small>
            </div>
          </div>

          {loading ? <div className="studio-loading"><Loader2 size={18} className="spin-icon" />正在加载作品数据...</div> : null}
          {message ? <p className="success-text">{message}</p> : null}
          {error ? <p className="danger-text">{error}</p> : null}

          <div className="studio-action-stack">
            <button className="primary-button" onClick={() => void runExport("video_export")} disabled={!storyboards.length || Boolean(busyAction)}>
              {busyAction === "video_export" ? <Loader2 size={17} className="spin-icon" /> : <Film size={17} />}
              合成 MP4 成片
            </button>
            <button className="ghost-button" onClick={() => void runExport("tts")} disabled={!storyboards.length || Boolean(busyAction)}>
              {busyAction === "tts" ? <Loader2 size={17} className="spin-icon" /> : <FileAudio size={17} />}
              生成配音轨{ttsJob ? `（${exportJobStatusText(ttsJob.status)}）` : ""}
            </button>
            <button className="ghost-button" onClick={() => void runExport("subtitle")} disabled={!storyboards.length || Boolean(busyAction)}>
              {busyAction === "subtitle" ? <Loader2 size={17} className="spin-icon" /> : <Subtitles size={17} />}
              生成字幕轨{subtitleJob ? `（${exportJobStatusText(subtitleJob.status)}）` : ""}
            </button>
            <button className="ghost-button" onClick={() => project && onOpenProject(project.id)} disabled={!project}>
              <FolderOpen size={17} />打开漫剧生产台
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
            {exportJobs.slice(0, 5).map((job) => (
              <article key={job.id}>
                <div>
                  <span>{exportJobTitle(job)}</span>
                  <small>{exportJobStatusText(job.status)} · {new Date(job.updatedAt).toLocaleString()}</small>
                </div>
                {job.downloadUrl || job.outputUrl ? (
                  <button className="studio-icon-button" onClick={() => void downloadExport(job)} type="button" aria-label="下载导出文件"><Download size={15} /></button>
                ) : null}
              </article>
            ))}
            {!exportJobs.length ? <small>合成、配音和字幕记录会显示在这里，完成后可直接下载。</small> : null}
          </div>
        </section>
      </div>
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
  const tts = jobs.find((job) => job.type === "tts");
  const subtitle = jobs.find((job) => job.type === "subtitle");
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
    refunded: "已退款"
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
