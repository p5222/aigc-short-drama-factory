import type { AssetItem, ExportJob, GenerationTask, ModelPrice, StoryboardShot } from "@aifilm/shared";
import { isPersistedPlayableVideoReference, isPublishableVideoUrl } from "@aifilm/shared";

export function normalizeShotDuration(duration: number | undefined): number {
  return Number.isFinite(duration) && (duration ?? 0) > 0 ? duration! : 1;
}

export function normalizePersistedMediaUrl(url: string, base = "https://studio.test"): string {
  try {
    const parsed = new URL(url, base);
    const origin = new URL(base).origin;
    return parsed.origin === origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
  } catch { return url; }
}

export interface DeliveryClip { id: string; index: number; start: number; duration: number; width: number; }

export function buildDeliveryClipLayout(shots: StoryboardShot[], pixelsPerSecond = 52, minimumWidth = 96, durationOverrides = new Map<string, number>()): DeliveryClip[] {
  let start = 0;
  return shots.map((shot, index) => {
    const override = durationOverrides.get(shot.id);
    const duration = Number.isFinite(override) && (override ?? 0) > 0 ? override! : normalizeShotDuration(shot.duration);
    const clip = { id: shot.id, index, start, duration, width: Math.max(minimumWidth, Math.round(duration * pixelsPerSecond)) };
    start += duration;
    return clip;
  });
}

export interface DeliveryCandidate { id: string; label: string; videoUrl: string; coverUrl: string; sourceAssetId?: string; durationLabel: string; }

export function partitionDeliveryExportJobs(jobs: ExportJob[], storyboardIds: string[]) {
  const current: ExportJob[] = [];
  const history: ExportJob[] = [];
  const other: ExportJob[] = [];
  for (const job of [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))) {
    if (!job.storyboardIds?.length || (job.status === "succeeded" && job.sourceStatus !== "current")) history.push(job);
    else if (storyboardIds.length === job.storyboardIds.length && storyboardIds.every((id, index) => id === job.storyboardIds![index])) current.push(job);
    else other.push(job);
  }
  return { current, history, other };
}

export function getDeliveryCandidates(shots: StoryboardShot[], assets: AssetItem[], jobs: ExportJob[]): DeliveryCandidate[] {
  const cover = assets.find((asset) => asset.type === "image" && asset.referenceUrl)?.referenceUrl ?? "";
  const total = shots.reduce((sum, shot) => sum + normalizeShotDuration(shot.duration), 0);
  const exports = jobs
    .filter((job) => job.status === "succeeded" && job.sourceStatus === "current" && (job.type === "video_export" || job.outputKind === "mp4") && isPublishableVideoUrl(job.outputUrl))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
  const exportCandidates = exports.slice(0, 1).map((job) => ({ id: `export:${job.id}`, label: "最新合成 MP4", videoUrl: job.outputUrl!, coverUrl: cover, durationLabel: formatClock(total) }));
  const clipCandidates = shots.flatMap((shot, index) => {
    const asset = assets.find((item) => item.type === "video" && item.id === `video_${shot.id}`);
    if (!asset || !isPublishableVideoUrl(asset.referenceUrl)) return [];
    const image = assets.find((item) => item.type === "image" && item.id.replace(/^image_/, "") === shot.id);
    return [{ id: `asset:${asset.id}`, label: `镜头 ${String(index + 1).padStart(2, "0")}`, videoUrl: asset.referenceUrl!, coverUrl: image?.referenceUrl ?? cover, sourceAssetId: asset.id, durationLabel: formatClock(normalizeShotDuration(shot.duration)) }];
  });
  return [...exportCandidates, ...clipCandidates];
}

export function resolveSingleDeliveryCandidate(shots: StoryboardShot[], assets: AssetItem[], jobs: ExportJob[]): DeliveryCandidate | undefined {
  return getDeliveryCandidates(shots, assets, jobs)[0];
}

export function getNextPlayableShotId(shots: StoryboardShot[], assets: AssetItem[], activeId: string): string | null {
  const start = shots.findIndex((shot) => shot.id === activeId);
  for (const shot of shots.slice(start + 1)) {
    const asset = assets.find((item) => item.type === "video" && item.id === `video_${shot.id}`);
    if (isPersistedPlayableVideoReference(asset?.referenceUrl)) return shot.id;
  }
  return null;
}

export interface DeliveryAutoPlayTarget { shotId: string; url: string; }
export type DeliveryAutoPlayAction = { type: "manual" } | { type: "ended"; shotId?: string; url?: string } | { type: "consumed"; shotId: string; url: string };

export function reduceDeliveryAutoPlay(current: DeliveryAutoPlayTarget | null, action: DeliveryAutoPlayAction): DeliveryAutoPlayTarget | null {
  if (action.type === "manual") return null;
  if (action.type === "ended") return action.shotId && action.url ? { shotId: action.shotId, url: action.url } : null;
  return current?.shotId === action.shotId && current.url === action.url ? null : current;
}

export function getExportSummary(jobs: ExportJob[]): { status: ExportJob["status"] | "idle"; messages: string[] } {
  const latest = [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return { status: latest?.status ?? "idle" as const, messages: jobs.flatMap((job) => [...(job.warnings ?? []), job.errorReason].filter((message): message is string => Boolean(message))) };
}

/** Snapshot the exact visible episode/order and require a finished video for every clip. */
export function getDeliveryExportState(shots: StoryboardShot[], assets: AssetItem[]) {
  const videos = buildShotMediaIndex(shots, assets, "video");
  const missingVideoCount = shots.filter((shot) => resolveShotVideoStatus(videos.get(shot.id)) !== "succeeded").length;
  return { storyboardIds: shots.map((shot) => shot.id), missingVideoCount, canExportVideo: shots.length > 0 && missingVideoCount === 0 };
}

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------------------
 * Delivery V2 (剪映式多轨成片) pure helpers
 * ------------------------------------------------------------------------- */

export const DELIVERY_MIN_PX_PER_SECOND = 8;
export const DELIVERY_MAX_PX_PER_SECOND = 40;
export const DELIVERY_DEFAULT_PX_PER_SECOND = 16;
export const DELIVERY_MIN_CLIP_WIDTH = 16;

export type DeliveryShotVideoStatus = "succeeded" | "running" | "failed" | "missing";

/** 与 model.resolveVideoAssetStatus 语义一致；在此复刻以避免引入 ../model 的依赖链。 */
export function resolveShotVideoStatus(asset?: AssetItem): DeliveryShotVideoStatus {
  if (!asset) return "missing";
  if (asset.status === "succeeded" && isPersistedPlayableVideoReference(asset.referenceUrl)) return "succeeded";
  if (asset.status === "failed") return "failed";
  return "running";
}

/** 通用镜头资产索引：约定资产 id 为 `${type}_${shotId}`（video/image/audio/subtitle 均适用）。 */
export function buildShotMediaIndex(
  shots: Pick<StoryboardShot, "id">[],
  assets: AssetItem[],
  type: AssetItem["type"]
): Map<string, AssetItem> {
  const byId = new Map(assets.filter((asset) => asset.type === type).map((asset) => [asset.id, asset]));
  return new Map(shots.flatMap((shot) => {
    const matched = byId.get(`${type}_${shot.id}`);
    return matched ? [[shot.id, matched] as const] : [];
  }));
}

/** 时间线 clip 布局：宽度 = duration * pxPerSecond（保底可点击宽度）。 */
export function clipLayout(
  shots: StoryboardShot[],
  pxPerSecond: number,
  durationOverrides = new Map<string, number>()
): DeliveryClip[] {
  return buildDeliveryClipLayout(shots, pxPerSecond, DELIVERY_MIN_CLIP_WIDTH, durationOverrides);
}

/** 纯前端重排：把 from 移到 to（to 越界时收敛到边界；from 越界返回原顺序副本）。 */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** 应用会话内镜头顺序：未知 id 忽略，遗漏的镜头按原顺序补在末尾。 */
export function applyShotOrder(shots: StoryboardShot[], order: string[]): StoryboardShot[] {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  const ordered = order.map((id) => byId.get(id)).filter((shot): shot is StoryboardShot => Boolean(shot));
  const seen = new Set(order);
  return [...ordered, ...shots.filter((shot) => !seen.has(shot.id))];
}

/** 缩放适配：让总时长撑满容器宽度，收敛到 [8, 40]。无有效时长时返回默认值。 */
export function fitPxPerSecond(
  containerWidth: number,
  totalSeconds: number,
  minimum = DELIVERY_MIN_PX_PER_SECOND,
  maximum = DELIVERY_MAX_PX_PER_SECOND
): number {
  if (!(totalSeconds > 0) || !(containerWidth > 0)) return DELIVERY_DEFAULT_PX_PER_SECOND;
  return Math.max(minimum, Math.min(maximum, Math.floor(containerWidth / totalSeconds)));
}

/** 播放头横向偏移：选中 clip 之前的实际渲染宽度 + 播放进度（进度收敛到 clip 时长）。 */
export function playheadOffset(
  layout: DeliveryClip[],
  activeId: string,
  progressSeconds: number,
  pxPerSecond: number
): number {
  let offset = 0;
  for (const clip of layout) {
    if (clip.id === activeId) {
      const clamped = Math.min(Math.max(0, progressSeconds), clip.duration);
      return offset + Math.min(clip.width, clamped * pxPerSecond);
    }
    offset += clip.width;
  }
  return 0;
}

/** 时间刻度：从 0 到覆盖总时长的整格（默认每 4 秒一格，含末端刻度）。 */
export function rulerTicks(totalSeconds: number, step = 4): number[] {
  const safeStep = Math.max(1, Math.floor(step));
  const end = Math.max(safeStep, Math.ceil(Math.max(0, totalSeconds) / safeStep) * safeStep);
  const ticks: number[] = [];
  for (let second = 0; second <= end; second += safeStep) ticks.push(second);
  return ticks;
}

/** m:ss 时间码；withTenths 时附带十分位（播放头读数用）。 */
export function formatTimecode(seconds: number, withTenths = false): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = Math.floor(safe);
  const base = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  return withTenths ? `${base}.${Math.floor((safe - whole) * 10)}` : base;
}

export interface DeliveryStats {
  total: number;
  videoReady: number;
  /** 覆盖配音的镜头数：优先按镜头级音频资产统计；无镜头级音频但有整轨 TTS 时视为全部覆盖。 */
  audioCovered: number;
  hasTrackAudio: boolean;
  hasSubtitle: boolean;
}

export function getDeliveryStats(shots: StoryboardShot[], assets: AssetItem[], jobs: ExportJob[]): DeliveryStats {
  const videos = buildShotMediaIndex(shots, assets, "video");
  const audios = buildShotMediaIndex(shots, assets, "audio");
  const subtitles = buildShotMediaIndex(shots, assets, "subtitle");
  const scopedJobs = partitionDeliveryExportJobs(jobs, shots.map((shot) => shot.id)).current;
  const videoReady = shots.filter((shot) => resolveShotVideoStatus(videos.get(shot.id)) === "succeeded").length;
  const perShotAudio = shots.filter((shot) => {
    const audio = audios.get(shot.id);
    return audio?.status === "succeeded" && Boolean(audio.referenceUrl);
  }).length;
  const hasTrackAudio = scopedJobs.some((job) => job.status === "succeeded" && Boolean(job.audioUrl || (job.type === "tts" && job.outputUrl)));
  const hasSubtitle = scopedJobs.some((job) => job.status === "succeeded" && Boolean(job.subtitleUrl || (job.type === "subtitle" && job.outputUrl)))
    || (shots.length > 0 && shots.every((shot) => { const subtitle = subtitles.get(shot.id); return subtitle?.status === "succeeded" && Boolean(subtitle.referenceUrl); }));
  return {
    total: shots.length,
    videoReady,
    audioCovered: hasTrackAudio ? shots.length : perShotAudio,
    hasTrackAudio,
    hasSubtitle
  };
}

/** 与服务端 /videos/generate 的筛选一致：没有可播放视频、且已有分镜图资产的镜头。 */
export function getRemainingVideoShots(shots: StoryboardShot[], assets: AssetItem[]): StoryboardShot[] {
  const videos = buildShotMediaIndex(shots, assets, "video");
  const images = buildShotMediaIndex(shots, assets, "image");
  return shots.filter((shot) => !isPersistedPlayableVideoReference(videos.get(shot.id)?.referenceUrl) && images.has(shot.id));
}

const DEFAULT_VIDEO_DESCRIPTION_PREFIX = "基于分镜图生成视频";

/** 失败原因：优先失败视频资产上的 description（服务端把 provider 报错写在这里），其次视频任务 errorReason。 */
export function getShotFailureMessage(videoAsset?: AssetItem, tasks: GenerationTask[] = []): string {
  if (videoAsset?.status === "failed") {
    const description = videoAsset.description?.trim();
    if (description && !description.startsWith(DEFAULT_VIDEO_DESCRIPTION_PREFIX)) return description;
  }
  const latestVideoTaskError = [...tasks]
    .filter((task) => task.type === "video" && Boolean(task.errorReason))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
  return latestVideoTaskError?.errorReason || "生成失败，可重试";
}

/** 视频单价（积分/秒）：先精确匹配渠道+模型，再退化为仅模型匹配；查不到返回 undefined（界面隐藏预估）。 */
export function videoUnitCredits(prices: ModelPrice[], providerId: string, model: string): number | undefined {
  const candidates = prices.filter((price) => price.enabled && price.modality === "video" && price.unit === "video_second");
  const exact = candidates.find((price) => price.providerId === providerId && price.model === model);
  return (exact ?? candidates.find((price) => price.model === model))?.unitCredits;
}

export function collectDeliveryEpisodes(shots: StoryboardShot[], fallbackCount = 1): number[] {
  const values = [...new Set(shots.map((shot) => Math.max(1, shot.episodeNo || 1)))].sort((a, b) => a - b);
  if (values.length) return values;
  return Array.from({ length: Math.max(1, fallbackCount) }, (_, index) => index + 1);
}

/** 确定性伪波形（配音轨占位）：同一 seed 恒定输出，points 可直接用于 SVG polyline。 */
export function waveformPoints(seed: string, width: number, height: number, segments = 24): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const count = Math.max(2, Math.floor(segments));
  const middle = height / 2;
  const points: string[] = [];
  for (let index = 0; index <= count; index += 1) {
    hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5; hash |= 0;
    const amplitude = 0.15 + (Math.abs(hash) % 1000) / 1400;
    const x = (width * index) / count;
    const y = middle + (index % 2 === 0 ? -1 : 1) * middle * Math.min(0.92, amplitude);
    points.push(`${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`);
  }
  return points.join(" ");
}
