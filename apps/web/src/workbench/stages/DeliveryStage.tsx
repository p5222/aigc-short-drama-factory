import {
  AlertTriangle,
  Check,
  Download,
  FileAudio,
  Film,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Subtitles,
  Upload,
  WandSparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactElement, type SyntheticEvent } from "react";
import type { ExportJob, ModelPrice, ModelProvider, ProjectWorkflow } from "@aifilm/shared";
import { isPersistedPlayableVideoReference } from "@aifilm/shared";
import { api } from "../../lib/api";
import { ModelRoutePicker } from "../../components/ModelRoutePicker";
import { useResponsiveDrawer } from "../components/useResponsiveDrawer";
import { generateVideos } from "../workbenchActions";
import { DeliveryExportQuoteDialog } from "./DeliveryExportQuoteDialog";
import { confirmedDeliveryCredits, deliveryQuoteScopeKey, type DeliveryExportQuote, type DeliveryExportType } from "./deliveryQuoteModel";
import {
  DELIVERY_MAX_PX_PER_SECOND,
  DELIVERY_MIN_PX_PER_SECOND,
  DELIVERY_DEFAULT_PX_PER_SECOND,
  applyShotOrder,
  buildShotMediaIndex,
  clipLayout,
  collectDeliveryEpisodes,
  deliveryTimelineCanvas,
  fitPxPerSecond,
  formatTimecode,
  getDeliveryCandidates,
  getDeliveryExportState,
  getDeliveryStats,
  getExportSummary,
  getNextPlayableShotId,
  getRemainingVideoShots,
  getShotFailureMessage,
  normalizePersistedMediaUrl,
  normalizeShotDuration,
  playheadOffset,
  partitionDeliveryExportJobs,
  reorder,
  resolveShotVideoStatus,
  rulerTicks,
  videoUnitCredits,
  type DeliveryCandidate,
  type DeliveryShotVideoStatus
} from "./deliveryModel";

const SHOT_STATUS_LABEL: Record<DeliveryShotVideoStatus, string> = {
  succeeded: "已生成",
  running: "生成中",
  failed: "失败",
  missing: "待生成"
};

const JOB_STATUS_LABEL: Record<ExportJob["status"], string> = {
  pending: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败"
};

const JOB_TYPE_LABEL: Record<ExportJob["type"], string> = {
  video_export: "MP4",
  tts: "配音",
  subtitle: "字幕"
};

/** 与服务端 videoGenerateSchema 的 storyboardIds max(20) 对齐。 */
const VIDEO_SELECTED_MAX = 20;

type DeliveryPendingAction = "" | "batch" | "retry" | "selected" | "regenerate";

export interface DeliveryStageProps {
  workflow: ProjectWorkflow;
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  railOpen: boolean;
  inspectorOpen: boolean;
  onCloseRail: () => void;
  onCloseInspector: () => void;
  onRefresh: (projectId: string) => Promise<ProjectWorkflow>;
  onPublish: (candidate: DeliveryCandidate) => void;
  exportJobs: ExportJob[];
  onExport: (type: "tts" | "subtitle" | "video_export", storyboardIds?: string[], maxCredits?: number) => void | Promise<void>;
  isBusy: boolean;
  activeShotId: string | null;
  activeEpisodeNo?: number | null;
  onEpisodeChange?: (episodeNo: number) => void;
  onSelectShot: (shotId: string) => void;
  onOpenStoryboards?: () => void;
  selectedShotIds: string[];
  onSelectShots: (shotIds: string[]) => void;
  onSaveModelRoutes: (routes: { videoProvider?: string; videoModel?: string }) => void | Promise<void>;
}

export function DeliveryStage({
  workflow,
  providers,
  modelPrices,
  railOpen,
  inspectorOpen,
  onCloseRail,
  onCloseInspector,
  onRefresh,
  onPublish,
  exportJobs,
  onExport,
  isBusy,
  activeShotId,
  activeEpisodeNo,
  onEpisodeChange,
  onSelectShot,
  onOpenStoryboards,
  selectedShotIds,
  onSelectShots,
  onSaveModelRoutes
}: DeliveryStageProps): ReactElement {
  const { project, storyboards, assets, tasks } = workflow;
  const videoProviders = useMemo(() => providers.filter((provider) => provider.modality === "video" && provider.enabled), [providers]);

  const [episodeNo, setEpisodeNo] = useState<number | null>(null);
  const [localShotId, setLocalShotId] = useState<string | null>(activeShotId);
  /** 每次导出提交当前集的有序镜头；刷新后仍回到服务端顺序。 */
  const [orderByEpisode, setOrderByEpisode] = useState<Record<number, string[]>>({});
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [pxPerSecond, setPxPerSecond] = useState(DELIVERY_DEFAULT_PX_PER_SECOND);
  const [compactTimeline, setCompactTimeline] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [durationByShotId, setDurationByShotId] = useState<Map<string, number>>(() => new Map());
  const [expandedFailureId, setExpandedFailureId] = useState<string | null>(null);
  const [usableShotIds, setUsableShotIds] = useState<string[]>([]);
  const [providerId, setProviderId] = useState(() => project.videoProvider ?? videoProviders[0]?.id ?? "");
  const [routeModel, setRouteModel] = useState(() => project.videoModel ?? videoProviders[0]?.models[0] ?? "");
  const [routeSaving, setRouteSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<DeliveryPendingAction>("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [downloadingJobId, setDownloadingJobId] = useState("");
  const downloadingRef = useRef(false);
  const [quoteIntent, setQuoteIntent] = useState<{ type: DeliveryExportType; episode: number; storyboardIds: string[]; scopeKey: string } | null>(null);
  const [exportQuote, setExportQuote] = useState<DeliveryExportQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [exportSubmitting, setExportSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const quoteRequest = useRef(0);
  const quoteLoadingRef = useRef(false);
  const exportSubmittingRef = useRef(false);
  const localBusy = pendingAction !== "";

  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingAutoPlay = useRef<{ shotId: string; url: string } | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const dragFromIndex = useRef<number | null>(null);
  useEffect(() => {
    const viewport = timelineScrollRef.current;
    if (!viewport) return;
    const measure = () => setTimelineViewportWidth(Math.floor(viewport.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const queuePanelRef = useRef<HTMLElement>(null), queueCloseRef = useRef<HTMLButtonElement>(null);
  const inspectorPanelRef = useRef<HTMLElement>(null), inspectorCloseRef = useRef<HTMLButtonElement>(null);
  const queueDrawerActive = useResponsiveDrawer({ open: railOpen, maxWidth: 979, onClose: onCloseRail, panelRef: queuePanelRef, initialFocusRef: queueCloseRef });
  const inspectorDrawerActive = useResponsiveDrawer({ open: inspectorOpen, maxWidth: 1399, onClose: onCloseInspector, panelRef: inspectorPanelRef, initialFocusRef: inspectorCloseRef });
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setCompactTimeline(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const episodes = useMemo(() => collectDeliveryEpisodes(storyboards, project.episodes), [storyboards, project.episodes]);
  const requestedEpisode = activeEpisodeNo !== undefined ? activeEpisodeNo : episodeNo;
  const activeEpisode = requestedEpisode !== null && episodes.includes(requestedEpisode) ? requestedEpisode : episodes[0] ?? 1;
  const episodeShots = useMemo(
    () => storyboards.filter((shot) => Math.max(1, shot.episodeNo || 1) === activeEpisode),
    [storyboards, activeEpisode]
  );
  const shots = useMemo(
    () => applyShotOrder(episodeShots, orderByEpisode[activeEpisode] ?? []),
    [episodeShots, orderByEpisode, activeEpisode]
  );

  const videoByShot = useMemo(() => buildShotMediaIndex(shots, assets, "video"), [shots, assets]);
  const imageByShot = useMemo(() => buildShotMediaIndex(shots, assets, "image"), [shots, assets]);
  const audioByShot = useMemo(() => buildShotMediaIndex(shots, assets, "audio"), [shots, assets]);

  const activeShot = shots.find((shot) => shot.id === localShotId) ?? shots[0];
  const activeVideo = activeShot ? videoByShot.get(activeShot.id) : undefined;
  const activeUrl = activeShot && isPersistedPlayableVideoReference(activeVideo?.referenceUrl) ? activeVideo!.referenceUrl! : "";
  const activeStatus = resolveShotVideoStatus(activeVideo);

  // Mobile uses a larger visual time scale; clips, ruler and playhead share it.
  const timelinePixelsPerSecond = compactTimeline ? Math.max(DELIVERY_DEFAULT_PX_PER_SECOND, pxPerSecond) * 4 : pxPerSecond;
  const layout = useMemo(() => clipLayout(shots, timelinePixelsPerSecond, durationByShotId), [shots, timelinePixelsPerSecond, durationByShotId]);
  const totalDuration = layout.reduce((sum, clip) => sum + clip.duration, 0);
  const totalWidth = layout.reduce((sum, clip) => sum + clip.width, 0);
  const timelineCanvas = deliveryTimelineCanvas(timelineViewportWidth, totalWidth);
  const ticks = rulerTicks(Math.max(totalDuration, timelineCanvas.laneWidth / timelinePixelsPerSecond));
  const playheadLeft = playheadOffset(layout, activeShot?.id ?? "", progress, timelinePixelsPerSecond);
  const absoluteSeconds = (layout.find((clip) => clip.id === activeShot?.id)?.start ?? 0) + progress;

  const exportsByScope = partitionDeliveryExportJobs(exportJobs, shots.map((shot) => shot.id));
  const episodeExportJobs = exportsByScope.current;
  const stats = getDeliveryStats(shots, assets, episodeExportJobs);
  const exportState = getDeliveryExportState(shots, assets);
  const quoteScopeKey = deliveryQuoteScopeKey(project.id, activeEpisode, shots);
  const confirmedCredits = quoteIntent ? confirmedDeliveryCredits(exportQuote, quoteIntent.type, quoteIntent.scopeKey, quoteScopeKey) : null;
  const remaining = useMemo(() => getRemainingVideoShots(shots, assets), [shots, assets]);
  const remainingSeconds = remaining.reduce((sum, shot) => sum + normalizeShotDuration(shot.duration), 0);
  const failedShots = shots.filter((shot) => resolveShotVideoStatus(videoByShot.get(shot.id)) === "failed");
  const exportSummary = getExportSummary(episodeExportJobs);
  const publishableCandidate = getDeliveryCandidates(shots, assets, episodeExportJobs)[0];

  const unitCredits = videoUnitCredits(modelPrices, providerId, routeModel);
  const routeUnchanged = providerId === (project.videoProvider ?? "") && routeModel === (project.videoModel ?? "");
  const latestTts = latestJobOfType(episodeExportJobs, "tts");
  const latestSubtitle = latestJobOfType(episodeExportJobs, "subtitle");
  const perShotAudioCount = shots.filter((shot) => {
    const audio = audioByShot.get(shot.id);
    return audio?.status === "succeeded" && Boolean(audio.referenceUrl);
  }).length;
  const trackAudioUrl = latestTts?.status === "succeeded" ? latestTts.audioUrl || latestTts.outputUrl : undefined;

  const busyAll = isBusy || localBusy || routeSaving || quoteLoading || exportSubmitting;
  const allIds = shots.map((shot) => shot.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedShotIds.includes(id));
  const selectedCount = allIds.filter((id) => selectedShotIds.includes(id)).length;

  useEffect(() => { setProgress(0); setPlaying(false); videoRef.current?.pause(); }, [activeShot?.id, activeUrl]);

  useEffect(() => {
    const fallbackProvider = videoProviders[0]?.id ?? "";
    const nextProvider = project.videoProvider ?? fallbackProvider;
    setProviderId(nextProvider);
    setRouteModel(project.videoModel ?? videoProviders.find((provider) => provider.id === nextProvider)?.models[0] ?? "");
  }, [project.id, project.videoProvider, project.videoModel, videoProviders]);

  // 生成中的镜头靠外部 workflow 数据驱动：仅在有 running 任务时低频轮询（8s，页面隐藏时跳过）。
  const hasRunningWork = shots.some((shot) => resolveShotVideoStatus(videoByShot.get(shot.id)) === "running")
    || tasks.some((task) => task.type === "video" && (task.status === "running" || task.status === "pending"))
    || exportJobs.some((job) => job.status === "running" || job.status === "pending");
  useEffect(() => {
    if (!hasRunningWork) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void onRefreshRef.current(project.id).catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [hasRunningWork, project.id]);

  function selectShot(shotId: string) {
    pendingAutoPlay.current = null;
    setLocalShotId(shotId);
    onSelectShot(shotId);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video || !activeUrl) return;
    if (video.paused) void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else { video.pause(); setPlaying(false); }
  }

  function seek(value: number) {
    setProgress(value);
    if (videoRef.current) videoRef.current.currentTime = value;
  }

  function onEnded() {
    const next = getNextPlayableShotId(shots, assets, activeShot?.id ?? "");
    const nextUrl = next ? videoByShot.get(next)?.referenceUrl : undefined;
    if (next && isPersistedPlayableVideoReference(nextUrl)) {
      pendingAutoPlay.current = { shotId: next, url: nextUrl };
      setLocalShotId(next);
      onSelectShot(next);
    } else {
      pendingAutoPlay.current = null;
      setPlaying(false);
    }
  }

  function onCanPlay(event: SyntheticEvent<HTMLVideoElement>) {
    const target = pendingAutoPlay.current;
    if (!target || target.shotId !== activeShot?.id
      || normalizePersistedMediaUrl(target.url, event.currentTarget.currentSrc) !== normalizePersistedMediaUrl(event.currentTarget.currentSrc, event.currentTarget.currentSrc)) return;
    pendingAutoPlay.current = null;
    void event.currentTarget.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  function toggleShotSelection(shotId: string, checked: boolean) {
    onSelectShots(checked ? [...new Set([...selectedShotIds, shotId])] : selectedShotIds.filter((id) => id !== shotId));
  }

  function toggleAllSelection() {
    onSelectShots(allSelected ? [] : allIds);
  }

  function toggleUsable(shotId: string) {
    setUsableShotIds((current) => current.includes(shotId) ? current.filter((id) => id !== shotId) : [...current, shotId]);
  }

  async function runBatchVideos() {
    if (busyAll) return;
    setPendingAction("batch");
    setActionMessage("");
    setActionError("");
    try {
      const result = await generateVideos(project.id);
      setActionMessage(`视频任务已提交：本批次接收 ${result.assetsCreated ?? 0} 个镜头，实际扣费以任务结算为准。`);
      await onRefresh(project.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "视频生成任务提交失败");
    } finally {
      setPendingAction("");
    }
  }

  async function runSelectedVideos() {
    if (busyAll) return;
    const ids = allIds.filter((id) => selectedShotIds.includes(id));
    if (!ids.length) return;
    if (ids.length > VIDEO_SELECTED_MAX) {
      setActionError(`一次最多提交 ${VIDEO_SELECTED_MAX} 个镜头（当前选中 ${ids.length} 个），请减少选择后重试。`);
      return;
    }
    const generatedCount = ids.filter((id) => resolveShotVideoStatus(videoByShot.get(id)) === "succeeded").length;
    const regenerate = generatedCount > 0;
    if (regenerate && !window.confirm(`选中包含 ${generatedCount} 个已生成镜头，将重新生成并产生新版本（旧视频保留为历史资产）。是否继续？`)) return;
    setPendingAction("selected");
    setActionMessage("");
    setActionError("");
    try {
      const result = await generateVideos(project.id, { storyboardIds: ids, ...(regenerate ? { regenerate: true } : {}) });
      const base = `已提交 ${result.assetsCreated ?? 0} 个选中镜头的视频生成，实际扣费以任务结算为准。`;
      setActionMessage(result.message ? `${base}${result.message}。` : base);
      await onRefresh(project.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "视频生成任务提交失败");
    } finally {
      setPendingAction("");
    }
  }

  async function regenerateActiveShot() {
    if (busyAll || !activeShot) return;
    if (!window.confirm(`将重新生成本镜头视频并产生新版本${activeStatus === "succeeded" ? "（旧视频保留为历史资产）" : ""}。是否继续？`)) return;
    setPendingAction("regenerate");
    setActionMessage("");
    setActionError("");
    try {
      const result = await generateVideos(project.id, { storyboardIds: [activeShot.id], regenerate: true });
      setActionMessage(result.message ? `本镜头视频生成任务已提交。${result.message}。` : "本镜头视频生成任务已提交，实际扣费以任务结算为准。");
      await onRefresh(project.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "视频生成任务提交失败");
    } finally {
      setPendingAction("");
    }
  }

  async function retryFailedVideos() {
    if (busyAll) return;
    setPendingAction("retry");
    setActionMessage("");
    setActionError("");
    try {
      const retryable = [...tasks]
        .filter((task) => task.type === "video" && task.status === "failed" && task.retryable)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (retryable) {
        await api.retryTask(retryable.id);
        setActionMessage("已重试最近失败的视频任务。");
      } else {
        const result = await generateVideos(project.id);
        setActionMessage(`已重新提交批量生成（本批次接收 ${result.assetsCreated ?? 0} 个镜头）。`);
      }
      await onRefresh(project.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "重试失败");
    } finally {
      setPendingAction("");
    }
  }

  async function saveVideoRoute() {
    if (routeSaving) return;
    setRouteSaving(true);
    setActionError("");
    try {
      await onSaveModelRoutes({ videoProvider: providerId, videoModel: routeModel });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "模型路由保存失败");
    } finally {
      setRouteSaving(false);
    }
  }

  function handleClipDragStart(event: DragEvent<HTMLDivElement>, index: number) {
    dragFromIndex.current = index;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }

  function handleClipDrop(event: DragEvent<HTMLDivElement>, targetIndex: number) {
    event.preventDefault();
    const from = dragFromIndex.current;
    dragFromIndex.current = null;
    if (from === null || from === targetIndex) return;
    const currentIds = shots.map((shot) => shot.id);
    setOrderByEpisode((current) => ({ ...current, [activeEpisode]: reorder(currentIds, from, targetIndex) }));
  }

  function fitZoom() {
    const width = timelineScrollRef.current?.clientWidth ?? 0;
    const scale = compactTimeline ? 4 : 1;
    setPxPerSecond(fitPxPerSecond(Math.max(0, width - 88) / scale, totalDuration, compactTimeline ? DELIVERY_DEFAULT_PX_PER_SECOND : DELIVERY_MIN_PX_PER_SECOND));
  }

  async function downloadJob(job: ExportJob) {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    setDownloadingJobId(job.id);
    setActionError("");
    try {
      const blob = await api.downloadExportJob(project.id, job.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const extension = job.type === "subtitle" ? "srt" : job.type === "tts" ? (blob.type.includes("mpeg") ? "mp3" : "wav") : "mp4";
      link.download = `${project.name}-${job.id}.${extension}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "下载失败，请重试。");
    } finally {
      downloadingRef.current = false;
      setDownloadingJobId("");
    }
  }

  async function openExportQuote(type: DeliveryExportType) {
    if (quoteLoadingRef.current || exportSubmittingRef.current || !shots.length) return;
    if (type === "video_export" && !exportState.canExportVideo) return;
    const intent = { type, episode: activeEpisode, storyboardIds: [...exportState.storyboardIds], scopeKey: quoteScopeKey };
    const requestId = ++quoteRequest.current;
    quoteLoadingRef.current = true;
    setQuoteIntent(intent);
    setExportQuote(null);
    setQuoteError("");
    setQuoteLoading(true);
    try {
      const result = await api.quoteExport(project.id, { type, storyboardIds: intent.storyboardIds });
      if (requestId !== quoteRequest.current) return;
      if (result.type !== type || result.unit !== "tts_character") throw new Error("导出报价格式不正确，请刷新报价后重试。");
      const quote: DeliveryExportQuote = { ...result, type, unit: "tts_character" };
      if (confirmedDeliveryCredits(quote, type, intent.scopeKey, intent.scopeKey) === null) throw new Error("导出费用不可用，请刷新报价后重试。");
      setExportQuote(quote);
    } catch (reason) {
      if (requestId === quoteRequest.current) setQuoteError(reason instanceof Error ? reason.message : "无法获取导出报价，请重试。");
    } finally {
      if (requestId === quoteRequest.current) { quoteLoadingRef.current = false; setQuoteLoading(false); }
    }
  }

  function closeExportQuote() {
    if (exportSubmittingRef.current) return;
    quoteRequest.current += 1;
    quoteLoadingRef.current = false;
    setQuoteLoading(false);
    setQuoteIntent(null);
    setExportQuote(null);
    setQuoteError("");
  }

  async function submitQuotedExport() {
    if (!quoteIntent || confirmedCredits === null || exportSubmittingRef.current) return;
    exportSubmittingRef.current = true;
    setExportSubmitting(true);
    setQuoteError("");
    try {
      await onExport(quoteIntent.type, quoteIntent.storyboardIds, confirmedCredits);
      setQuoteIntent(null);
      setExportQuote(null);
    } catch (reason) {
      setQuoteError(reason instanceof Error ? reason.message : "导出提交失败，请核对费用后重试。");
    } finally {
      exportSubmittingRef.current = false;
      setExportSubmitting(false);
    }
  }

  async function refreshDelivery() {
    try { await onRefresh(project.id); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "成片数据刷新失败，请重试。"); }
  }

  const activeMax = Math.max(1, videoRef.current?.duration || durationByShotId.get(activeShot?.id ?? "") || normalizeShotDuration(activeShot?.duration));
  const downloads = episodeExportJobs.filter((job) => job.status === "succeeded" && job.outputUrl).slice(0, 3);
  const historicalDownloads = exportsByScope.history.filter((job) => job.status === "succeeded" && job.outputUrl).slice(0, 3);
  const otherDownloads = exportsByScope.other.filter((job) => job.status === "succeeded" && job.outputUrl).slice(0, 3);

  return (
    <main className="dlv2-frame" data-rail-open={queueDrawerActive} data-inspector-open={inspectorDrawerActive}>
      {queueDrawerActive || inspectorDrawerActive ? <button type="button" className="dlv2-panel-scrim" aria-label="关闭成片侧栏" tabIndex={-1} onClick={queueDrawerActive ? onCloseRail : onCloseInspector} /> : null}
      <header className="dlv2-topbar">
        <div className="dlv2-topbar-left">
          <span className="dlv2-title"><Film size={15} />成片</span>
          <label className="dlv2-episode">
            <span>剧集</span>
            <select value={activeEpisode} onChange={(event) => { const next = Number(event.target.value); setEpisodeNo(next); onEpisodeChange?.(next); }} aria-label="选择剧集">
              {episodes.map((episode) => <option key={episode} value={episode}>第 {episode} 集</option>)}
            </select>
          </label>
          <span className="dlv2-stats" aria-live="polite">
            视频 {stats.videoReady}/{stats.total} · 配音 {stats.audioCovered}/{stats.total} · 字幕 {stats.hasSubtitle ? "已生成" : "未生成"}
          </span>
        </div>
        <div className="dlv2-topbar-right">
          {actionMessage ? <span className="dlv2-flash" data-tone="ok">{actionMessage}</span> : null}
          {actionError ? <span className="dlv2-flash" data-tone="danger" role="alert">{actionError}</span> : null}
          <button
            className="dlv2-btn"
            type="button"
            onClick={() => void runBatchVideos()}
            disabled={busyAll || !remaining.length}
            title={remaining.length ? `按服务端筛选补齐 ${remaining.length} 个待生成镜头` : "没有待生成的镜头视频"}
          >
            {pendingAction === "batch" ? <Loader2 size={15} className="dlv2-spin" /> : <WandSparkles size={15} />}批量生成剩余视频{remaining.length ? `（${remaining.length}）` : ""}
          </button>
          <button className="dlv2-btn dlv2-btn-primary" type="button" onClick={() => void openExportQuote("video_export")} disabled={busyAll || !exportState.canExportVideo} title={exportState.missingVideoCount ? `本集还有 ${exportState.missingVideoCount} 个镜头视频未完成，请先补齐` : "先查看配音费用，再按当前集、当前时间线顺序合成"}>
            <Download size={15} />导出第 {activeEpisode} 集 MP4
          </button>
          <button className="dlv2-icon-btn" type="button" aria-label="刷新成片数据" disabled={busyAll} onClick={() => void refreshDelivery()}>
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      <section className="dlv2-delivery-checks" aria-label={`第 ${activeEpisode} 集交付检查`}>
        <span><strong>视频</strong>{stats.videoReady}/{stats.total}{exportState.missingVideoCount ? ` · 需补齐 ${exportState.missingVideoCount} 镜` : stats.total ? " · 已齐全" : " · 暂无镜头"}</span>
        <span><strong>配音</strong>{stats.audioCovered}/{stats.total}{stats.hasTrackAudio ? " · 已生成音轨" : " · 导出时按对白报价"}</span>
        <span><strong>字幕</strong>{stats.hasSubtitle ? "已生成" : "未生成，可按需导出"}</span>
        <span><strong>当前成片</strong>{publishableCandidate?.id.startsWith("export:") ? "MP4 已完成，可预览交付" : "尚未合成当前范围 MP4"}</span>
      </section>
      <div className="dlv2-main">
        <aside ref={queuePanelRef} className="dlv2-queue" aria-label="镜头队列" role={queueDrawerActive ? "dialog" : undefined} aria-modal={queueDrawerActive || undefined}>
          <header className="dlv2-panel-head">
            <strong>镜头队列</strong>
            <span>{shots.length} 镜</span>
            <button ref={queueCloseRef} className="dlv2-drawer-close" type="button" aria-label="收起镜头队列" onClick={onCloseRail}><X size={14} /></button>
          </header>
          <div className="dlv2-queue-list" role="list">
            {shots.map((shot, index) => {
              const status = resolveShotVideoStatus(videoByShot.get(shot.id));
              const image = imageByShot.get(shot.id);
              const label = String(index + 1).padStart(2, "0");
              const expanded = expandedFailureId === shot.id;
              return (
                <div key={shot.id} role="listitem" className="dlv2-shot-item">
                  <div className={`dlv2-shot-row${activeShot?.id === shot.id ? " is-active" : ""}`} data-status={status}>
                    <label className="dlv2-shot-check">
                      <input type="checkbox" checked={selectedShotIds.includes(shot.id)} onChange={event => toggleShotSelection(shot.id, event.target.checked)} aria-label={`选择镜头 ${label}`} />
                    </label>
                    <button type="button" className="dlv2-shot-preview" aria-pressed={activeShot?.id === shot.id} aria-label={`预览镜头 ${label} · ${SHOT_STATUS_LABEL[status]}`} onClick={() => selectShot(shot.id)}>
                      <span className="dlv2-shot-thumb">{image?.referenceUrl ? <img src={image.referenceUrl} alt="" loading="lazy" /> : <Film size={14} />}</span>
                      <span className="dlv2-shot-info"><strong>镜头 {label}</strong><small>{shot.scene || shot.pictureDesc || "未命名镜头"} · {normalizeShotDuration(shot.duration)}s</small></span>
                      <span className="dlv2-shot-flags">
                        {usableShotIds.includes(shot.id) ? <span className="dlv2-badge" data-tone="usable">可用</span> : null}
                        <span className="dlv2-badge" data-tone={status}>{status === "running" ? <Loader2 size={11} className="dlv2-spin" /> : null}{SHOT_STATUS_LABEL[status]}</span>
                      </span>
                    </button>
                    {status === "failed" ? <button className="dlv2-expand-error" type="button" aria-expanded={expanded} aria-label={`查看镜头 ${label} 失败原因`} onClick={() => setExpandedFailureId(expanded ? null : shot.id)}><AlertTriangle size={13} /></button> : null}
                  </div>
                  {expanded ? <p className="dlv2-shot-error">{getShotFailureMessage(videoByShot.get(shot.id), tasks)}</p> : null}
                </div>
              );
            })}
            {!shots.length ? <div className="dlv2-empty-hint">本集暂无镜头。请先在分镜阶段拆解镜头。</div> : null}
          </div>
          <footer className="dlv2-queue-foot">
            <label className="dlv2-check-all">
              <input type="checkbox" checked={allSelected} onChange={toggleAllSelection} disabled={!shots.length} />
              全选{selectedCount ? ` · 已选 ${selectedCount}` : ""}
            </label>
            <button
              className="dlv2-btn"
              type="button"
              disabled={busyAll || !selectedCount}
              title={selectedCount ? `为选中的 ${selectedCount} 个镜头生成视频；包含已生成镜头时会提示重新生成并产生新版本` : "先在列表勾选镜头"}
              onClick={() => void runSelectedVideos()}
            >
              {pendingAction === "selected" ? <Loader2 size={14} className="dlv2-spin" /> : null}生成选中{selectedCount ? `（${selectedCount}）` : ""}
            </button>
          </footer>
        </aside>

        <section className="dlv2-stage" aria-label="镜头预览">
          <div className="dlv2-player">
            {activeUrl ? (
              <video
                ref={videoRef}
                src={activeUrl}
                poster={imageByShot.get(activeShot?.id ?? "")?.referenceUrl}
                preload="metadata"
                playsInline
                controls
                onCanPlay={onCanPlay}
                onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration;
                  if (Number.isFinite(duration) && duration > 0 && activeShot) {
                    setDurationByShotId((current) => new Map(current).set(activeShot.id, duration));
                  }
                }}
                onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={onEnded}
              />
            ) : (
              <div className="dlv2-player-empty">
                <Film size={26} />
                <strong>{activeShot ? SHOT_STATUS_LABEL[activeStatus] : "暂无镜头"}</strong>
                <span>
                  {!activeShot ? "本集还没有分镜。请先拆解镜头、准备首帧，再生成视频。" : activeStatus === "running"
                    ? "视频生成中，完成后自动出现在这里。"
                    : activeStatus === "failed"
                      ? getShotFailureMessage(activeVideo, tasks)
                      : "该镜头还没有视频，可在顶部批量生成。"}
                </span>
                {!activeShot && onOpenStoryboards ? <button type="button" className="dlv2-btn" onClick={onOpenStoryboards}>前往分镜制作</button> : null}
              </div>
            )}
          </div>
          <div className="dlv2-transport">
            <button className="dlv2-icon-btn" type="button" aria-label={playing ? "暂停" : "播放"} disabled={!activeUrl} onClick={togglePlayback}>
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <input
              className="dlv2-seek"
              type="range"
              min={0}
              max={activeMax}
              step={0.1}
              value={Math.min(progress, activeMax)}
              disabled={!activeUrl}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label="播放进度"
            />
            <span className="dlv2-timecode">{formatTimecode(progress, true)} / {formatTimecode(activeMax)}</span>
          </div>
          <div className="dlv2-shot-actions">
            <button
              className="dlv2-btn"
              type="button"
              disabled={busyAll || !activeShot}
              title={activeShot ? "重新生成本镜头视频并产生新版本（旧的可播放视频保留为历史资产）" : "先选择一个镜头"}
              onClick={() => void regenerateActiveShot()}
            >
              {pendingAction === "regenerate" ? <Loader2 size={14} className="dlv2-spin" /> : <RotateCcw size={14} />}重新生成本镜头
            </button>
            <button
              className="dlv2-btn"
              type="button"
              aria-pressed={activeShot ? usableShotIds.includes(activeShot.id) : false}
              disabled={!activeShot}
              onClick={() => activeShot && toggleUsable(activeShot.id)}
              title="仅前端标记，不写入服务端"
            >
              <Check size={14} />{activeShot && usableShotIds.includes(activeShot.id) ? "已标记可用" : "标记可用"}
            </button>
          </div>
        </section>

        <aside ref={inspectorPanelRef} className="dlv2-side" aria-label="成片参数" role={inspectorDrawerActive ? "dialog" : undefined} aria-modal={inspectorDrawerActive || undefined}>
          <header className="dlv2-panel-head">
            <strong>参数与轨道</strong>
            <button ref={inspectorCloseRef} className="dlv2-drawer-close" type="button" aria-label="收起参数面板" onClick={onCloseInspector}><X size={14} /></button>
          </header>

          <section className="dlv2-card">
            <header className="dlv2-card-head"><SlidersHorizontal size={14} /><strong>视频生成参数</strong></header>
            <div className="dlv2-field">
              <span>模型</span>
              <ModelRoutePicker modality="video" providers={providers} modelPrices={modelPrices} value={{ providerId, model: routeModel }} onChange={(nextProvider, nextModel) => { setProviderId(nextProvider); setRouteModel(nextModel); }} disabled={!videoProviders.length} />
            </div>
            {unitCredits !== undefined && remaining.length ? (
              <p className="dlv2-estimate">预计 {Math.ceil(remainingSeconds * unitCredits)} 积分（剩余 {remaining.length} 镜 · {remainingSeconds}s × {unitCredits} 积分/秒）</p>
            ) : null}
            <button
              className="dlv2-btn"
              type="button"
              onClick={() => void saveVideoRoute()}
              disabled={routeSaving || busyAll || routeUnchanged || !providerId || !routeModel}
            >
              {routeSaving ? <Loader2 size={14} className="dlv2-spin" /> : <Save size={14} />}保存为项目默认
            </button>
          </section>

          {failedShots.length ? (
            <section className="dlv2-card dlv2-card-danger">
              <header className="dlv2-card-head"><AlertTriangle size={14} /><strong>失败原因（{failedShots.length}）</strong></header>
              <ul className="dlv2-failure-list">
                {failedShots.slice(0, 4).map((shot) => (
                  <li key={shot.id}>
                    <strong>镜头 {String(shots.findIndex((item) => item.id === shot.id) + 1).padStart(2, "0")}</strong>
                    <span>{getShotFailureMessage(videoByShot.get(shot.id), tasks)}</span>
                  </li>
                ))}
              </ul>
              <button className="dlv2-btn" type="button" onClick={() => void retryFailedVideos()} disabled={busyAll}>
                <RotateCcw size={14} />重试失败镜头
              </button>
            </section>
          ) : null}

          <section className="dlv2-card">
            <header className="dlv2-card-head"><FileAudio size={14} /><strong>配音与字幕</strong></header>
            <div className="dlv2-card-actions">
              <button className="dlv2-btn" type="button" onClick={() => void openExportQuote("tts")} disabled={busyAll || !shots.length}>
                <FileAudio size={14} />生成本集配音
              </button>
              <button className="dlv2-btn" type="button" onClick={() => void openExportQuote("subtitle")} disabled={busyAll || !shots.length}>
                <Subtitles size={14} />生成本集字幕
              </button>
            </div>
            <p className="dlv2-job-line">
              本集配音：{latestTts ? JOB_STATUS_LABEL[latestTts.status] : "未生成"} · 字幕：{latestSubtitle ? JOB_STATUS_LABEL[latestSubtitle.status] : "未生成"} · 本集最近任务：{exportSummary.status === "idle" ? "暂无" : JOB_STATUS_LABEL[exportSummary.status as ExportJob["status"]] ?? exportSummary.status}
            </p>
            {exportSummary.messages.slice(0, 3).map((message) => <p className="dlv2-warn" key={message}>{message}</p>)}
            {downloads.map((job) => (
              <button className="dlv2-btn dlv2-download" type="button" key={job.id} disabled={Boolean(downloadingJobId)} onClick={() => void downloadJob(job)}>
                <Download size={13} />{downloadingJobId === job.id ? "下载中…" : `下载本集${JOB_TYPE_LABEL[job.type]}`}
              </button>
            ))}
            {otherDownloads.length ? <details className="dlv2-job-line"><summary>其他集或其他镜头顺序的导出</summary>{otherDownloads.map((job) => <button className="dlv2-btn dlv2-download" type="button" key={job.id} disabled={Boolean(downloadingJobId)} onClick={() => void downloadJob(job)}><Download size={13} />{downloadingJobId === job.id ? "下载中…" : `${JOB_TYPE_LABEL[job.type]} · ${job.storyboardIds?.length} 镜 · ${new Date(job.createdAt).toLocaleString()}`}</button>)}</details> : null}
            {historicalDownloads.length ? <details className="dlv2-job-line"><summary>历史导出与旧版本</summary><p>这些文件的内容已更新或原始输入未核验，保留下载，不计入当前配音、字幕或成片完成状态。</p>{historicalDownloads.map((job) => <button className="dlv2-btn dlv2-download" type="button" key={job.id} disabled={Boolean(downloadingJobId)} onClick={() => void downloadJob(job)}><Download size={13} />{downloadingJobId === job.id ? "下载中…" : `${job.sourceStatus === "stale" ? "内容已更新" : "输入未核验"} · ${JOB_TYPE_LABEL[job.type]} · ${new Date(job.createdAt).toLocaleString()}`}</button>)}</details> : null}
            <button className="dlv2-btn dlv2-btn-primary" type="button" onClick={() => { if (publishableCandidate) onPublish(publishableCandidate); }} disabled={!publishableCandidate}>
              <Upload size={14} />发布到创作现场
            </button>
          </section>
        </aside>
      </div>

      <footer className="dlv2-timeline" aria-label="多轨时间线">
        <div className="dlv2-tl-toolbar">
          <div className="dlv2-tl-tools">
            <strong>镜头顺序</strong>
            <span className="dlv2-tl-hint" title="导出使用当前集的全部镜头及当前顺序；刷新页面恢复原始顺序。选中镜头仅用于生成。">拖拽排序 · 按此顺序导出本集 · 刷新恢复</span>
          </div>
          <div className="dlv2-tl-clock">{formatTimecode(absoluteSeconds, true)} / {formatTimecode(totalDuration)}</div>
          <div className="dlv2-tl-zoom">
            <input
              type="range"
              min={compactTimeline ? DELIVERY_DEFAULT_PX_PER_SECOND : DELIVERY_MIN_PX_PER_SECOND}
              max={DELIVERY_MAX_PX_PER_SECOND}
              step={1}
              value={compactTimeline ? Math.max(DELIVERY_DEFAULT_PX_PER_SECOND, pxPerSecond) : pxPerSecond}
              onChange={(event) => setPxPerSecond(Number(event.target.value))}
              aria-label="时间线缩放"
            />
            <button className="dlv2-btn" type="button" onClick={fitZoom} disabled={!totalDuration}>适配</button>
          </div>
        </div>
        <div className="dlv2-tl-scroll" ref={timelineScrollRef} tabIndex={0} role="region" aria-label="横向滚动查看视频、配音和字幕轨道">
          <div className="dlv2-tl-content" style={{ width: `${timelineCanvas.contentWidth}px`, minWidth: `${timelineCanvas.contentWidth}px` }}>
            <div className="dlv2-track-labels" aria-hidden="true"><span /><strong>视频</strong><strong>配音</strong><strong>字幕</strong></div>
            <div className="dlv2-track-lanes" style={{ width: `${timelineCanvas.laneWidth}px` }}>
            <div className="dlv2-tl-ruler">
              {ticks.map((second) => (
                <span key={second} className="dlv2-tick" style={{ left: `${second * timelinePixelsPerSecond}px` }}>{formatTimecode(second)}</span>
              ))}
            </div>
            <div className="dlv2-track dlv2-track-video" aria-label="视频轨道">
              {layout.map((clip, index) => {
                const status = resolveShotVideoStatus(videoByShot.get(clip.id));
                const thumb = imageByShot.get(clip.id)?.referenceUrl;
                const isActiveClip = activeShot?.id === clip.id;
                return (
                  <div
                    key={clip.id}
                    className={`dlv2-clip${isActiveClip ? " is-active" : ""}`}
                    data-status={status}
                    style={{ width: `${clip.width}px`, backgroundImage: status === "succeeded" && thumb ? `url("${thumb}")` : undefined }}
                    draggable
                    role="button"
                    tabIndex={0}
                    title={`镜头 ${clip.index + 1} · ${clip.duration}s · ${SHOT_STATUS_LABEL[status]}（可拖拽排序）`}
                    onDragStart={(event) => handleClipDragStart(event, index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleClipDrop(event, index)}
                    onDragEnd={() => { dragFromIndex.current = null; }}
                    onClick={() => selectShot(clip.id)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectShot(clip.id); } }}
                  >
                    <span className="dlv2-clip-label">{clip.index + 1}</span>
                    <span className="dlv2-clip-duration">{clip.duration}s</span>
                  </div>
                );
              })}
            </div>
            <div className="dlv2-track dlv2-track-audio" aria-label="配音轨道">
              {perShotAudioCount > 0 ? (
                layout.map((clip) => {
                  const audio = audioByShot.get(clip.id);
                  const hasAudio = audio?.status === "succeeded" && Boolean(audio.referenceUrl);
                  return (
                    <div key={clip.id} className={hasAudio ? "dlv2-wave" : "dlv2-wave dlv2-wave-empty"} style={{ width: `${clip.width}px` }}>
                      {hasAudio ? <span className="dlv2-audio-label"><FileAudio size={13} />镜头 {clip.index + 1} 配音</span> : null}
                    </div>
                  );
                })
              ) : trackAudioUrl ? (
                <div className="dlv2-wave dlv2-wave-track" style={{ width: `${Math.max(totalWidth, 120)}px` }} title="整轨配音（TTS 导出）">
                  <span className="dlv2-audio-label"><FileAudio size={13} />整轨配音已生成</span>
                </div>
              ) : (
                <div className="dlv2-track-empty">暂无配音，可在检查器中生成</div>
              )}
            </div>
            <div className="dlv2-track dlv2-track-subtitle" aria-label="字幕轨道">
              {stats.hasSubtitle ? (
                layout.map((clip) => {
                  const shot = shots.find((item) => item.id === clip.id);
                  const text = shot?.dialogue || shot?.voiceOver || `镜头 ${clip.index + 1}`;
                  return (
                    <div key={clip.id} className="dlv2-subtitle-block" style={{ width: `${clip.width}px` }} title={text}>
                      <span>{text}</span>
                    </div>
                  );
                })
              ) : (
                <div className="dlv2-track-empty">暂无字幕，可在检查器中生成</div>
              )}
            </div>
            <div className="dlv2-playhead" style={{ left: `${playheadLeft}px` }} aria-hidden="true" />
            </div>
          </div>
        </div>
      </footer>
      {quoteIntent ? <DeliveryExportQuoteDialog
        type={quoteIntent.type}
        episode={quoteIntent.episode}
        shotCount={quoteIntent.storyboardIds.length}
        quote={exportQuote}
        loading={quoteLoading}
        submitting={exportSubmitting}
        error={quoteError || (exportQuote && confirmedCredits === null ? "台词或镜头顺序已变化，请刷新报价再提交。" : "")}
        maxCredits={confirmedCredits}
        onRetry={() => void openExportQuote(quoteIntent.type)}
        onSubmit={() => void submitQuotedExport()}
        onClose={closeExportQuote}
      /> : null}
    </main>
  );
}

function latestJobOfType(jobs: ExportJob[], type: ExportJob["type"]): ExportJob | undefined {
  return [...jobs]
    .filter((job) => job.type === type || (type === "tts" && Boolean(job.audioUrl)) || (type === "subtitle" && Boolean(job.subtitleUrl)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))[0];
}
