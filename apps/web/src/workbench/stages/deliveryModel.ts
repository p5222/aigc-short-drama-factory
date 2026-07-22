import type { AssetItem, ExportJob, StoryboardShot } from "@aifilm/shared";
import { isPersistedPlayableVideoReference } from "@aifilm/shared";

export function normalizeShotDuration(duration: number | undefined): number {
  return Number.isFinite(duration) && (duration ?? 0) > 0 ? duration! : 1;
}

export interface DeliveryClip { id: string; index: number; start: number; duration: number; width: number; }

export function buildDeliveryClipLayout(shots: StoryboardShot[], pixelsPerSecond = 52, minimumWidth = 96): DeliveryClip[] {
  let start = 0;
  return shots.map((shot, index) => {
    const duration = normalizeShotDuration(shot.duration);
    const clip = { id: shot.id, index, start, duration, width: Math.max(minimumWidth, Math.round(duration * pixelsPerSecond)) };
    start += duration;
    return clip;
  });
}

export interface DeliveryCandidate { id: string; label: string; videoUrl: string; coverUrl: string; sourceAssetId?: string; durationLabel: string; }

export function getDeliveryCandidates(shots: StoryboardShot[], assets: AssetItem[], jobs: ExportJob[]): DeliveryCandidate[] {
  const cover = assets.find((asset) => asset.type === "image" && asset.referenceUrl)?.referenceUrl ?? "";
  const total = shots.reduce((sum, shot) => sum + normalizeShotDuration(shot.duration), 0);
  const exports = jobs
    .filter((job) => job.status === "succeeded" && (job.type === "video_export" || job.outputKind === "mp4") && isPersistedPlayableVideoReference(job.outputUrl))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const exportCandidates = exports.slice(0, 1).map((job) => ({ id: `export:${job.id}`, label: "最新合成 MP4", videoUrl: job.outputUrl!, coverUrl: cover, durationLabel: formatClock(total) }));
  const clipCandidates = shots.flatMap((shot, index) => {
    const asset = assets.find((item) => item.type === "video" && item.id === `video_${shot.id}`);
    if (!asset || !isPersistedPlayableVideoReference(asset.referenceUrl)) return [];
    const image = assets.find((item) => item.type === "image" && item.id.replace(/^image_/, "") === shot.id);
    return [{ id: `asset:${asset.id}`, label: `镜头 ${String(index + 1).padStart(2, "0")}`, videoUrl: asset.referenceUrl!, coverUrl: image?.referenceUrl ?? cover, sourceAssetId: asset.id, durationLabel: formatClock(normalizeShotDuration(shot.duration)) }];
  });
  return [...exportCandidates, ...clipCandidates];
}

export function getNextPlayableShotId(shots: StoryboardShot[], assets: AssetItem[], activeId: string): string | null {
  const start = shots.findIndex((shot) => shot.id === activeId);
  for (const shot of shots.slice(start + 1)) {
    const asset = assets.find((item) => item.type === "video" && item.id === `video_${shot.id}`);
    if (isPersistedPlayableVideoReference(asset?.referenceUrl)) return shot.id;
  }
  return null;
}

export function getExportSummary(jobs: ExportJob[]): { status: ExportJob["status"] | "idle"; messages: string[] } {
  const latest = [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return { status: latest?.status ?? "idle" as const, messages: jobs.flatMap((job) => [...(job.warnings ?? []), job.errorReason].filter((message): message is string => Boolean(message))) };
}

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
