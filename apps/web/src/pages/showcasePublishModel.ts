import { isPublishableVideoUrl } from "@aifilm/shared";
import type { AssetItem, ExportJob, StoryboardShot } from "@aifilm/shared";
import type { DeliveryCandidate } from "../workbench/stages/deliveryModel";

export function buildShowcaseCandidates(projectId: string, shots: StoryboardShot[], assets: AssetItem[], jobs: ExportJob[], initial?: DeliveryCandidate): DeliveryCandidate[] {
  const projectShots = shots.filter((shot) => shot.projectId === projectId);
  const coverFor = (id: string) => assets.find((asset) => asset.projectId === projectId && asset.type === "image" && asset.id === `image_${id}` && asset.status === "succeeded")?.referenceUrl ?? "";
  const durationLabel = (rows: StoryboardShot[]) => {
    const seconds = Math.round(rows.reduce((total, shot) => total + (Number.isFinite(shot.duration) && shot.duration > 0 ? shot.duration : 1), 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const exports = [...jobs].filter((job) => job.projectId === projectId && job.type === "video_export" && job.status === "succeeded" && job.outputKind !== "diagnostic_bundle" && isPublishableVideoUrl(job.outputUrl))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))
    .map((job): DeliveryCandidate => {
      const rows = (job.storyboardIds ?? []).map((id) => projectShots.find((shot) => shot.id === id)).filter((shot): shot is StoryboardShot => Boolean(shot));
      const knownScope = rows.length > 0 && rows.length === job.storyboardIds?.length;
      const episodes = [...new Set(rows.map((shot) => shot.episodeNo || 1))];
      return {
        id: `export:${job.id}`,
        label: knownScope ? `第 ${episodes.join(" / ")} 集 MP4 · ${rows.length} 镜` : "项目历史 MP4（范围未记录或镜头已移除）",
        videoUrl: job.outputUrl!,
        coverUrl: knownScope ? rows.map((shot) => coverFor(shot.id)).find(Boolean) ?? "" : "",
        durationLabel: knownScope ? durationLabel(rows) : "时长待核对"
      };
    });
  const clips = projectShots.flatMap((shot): DeliveryCandidate[] => {
    const video = assets.find((asset) => asset.projectId === projectId && asset.type === "video" && asset.id === `video_${shot.id}` && asset.status === "succeeded");
    if (!isPublishableVideoUrl(video?.referenceUrl)) return [];
    return [{ id: `asset:${video!.id}`, label: `第 ${shot.episodeNo || 1} 集 · 镜头 ${shot.shotNo}`, videoUrl: video!.referenceUrl!, coverUrl: coverFor(shot.id), sourceAssetId: video!.id, durationLabel: durationLabel([shot]) }];
  });
  const all = [...exports, ...clips];
  const preferred = initial ? all.find((candidate) => candidate.id === initial.id && candidate.videoUrl === initial.videoUrl) : undefined;
  return preferred ? [preferred, ...all.filter((candidate) => candidate.id !== preferred.id)] : all;
}

export function showcaseCandidateKey(candidate: Pick<DeliveryCandidate, "id" | "videoUrl">) { return JSON.stringify([candidate.id, candidate.videoUrl]); }

export function resolveShowcaseSelection(candidates: DeliveryCandidate[], key: string) {
  return candidates.find((candidate) => showcaseCandidateKey(candidate) === key);
}

export function createShowcaseSubmitGuard() {
  let pending = false;
  const submitted = new Set<string>();
  return async <T>(key: string, submit: () => Promise<T>): Promise<T | undefined> => {
    if (pending || submitted.has(key)) return undefined;
    pending = true;
    try { const result = await submit(); submitted.add(key); return result; }
    finally { pending = false; }
  };
}
