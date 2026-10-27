import { createHash } from "node:crypto";
import type { ExportJob, ProjectWorkflow } from "@aifilm/shared";
import { applyDeliveryEdit, type DeliveryEditReference } from "@aifilm/shared";
import { assertVideoExportReady } from "./exportRequirements.js";

export interface VideoExportSnapshot {
  projectId: string;
  storyboardIds: string[];
  inputFingerprint: string;
  deliveryEdit?: DeliveryEditReference;
}

export function readVideoExportSnapshot(value: unknown): VideoExportSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<VideoExportSnapshot>;
  if (typeof candidate.projectId !== "string" || !candidate.projectId
    || typeof candidate.inputFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(candidate.inputFingerprint)
    || !Array.isArray(candidate.storyboardIds) || !candidate.storyboardIds.length
    || candidate.storyboardIds.some(id => typeof id !== "string" || !id)
    || new Set(candidate.storyboardIds).size !== candidate.storyboardIds.length) return null;
  if (candidate.deliveryEdit && (!Number.isSafeInteger(candidate.deliveryEdit.episodeNo) || candidate.deliveryEdit.episodeNo < 1
    || !Number.isSafeInteger(candidate.deliveryEdit.revision) || candidate.deliveryEdit.revision < 1)) return null;
  return { projectId: candidate.projectId, storyboardIds: candidate.storyboardIds, inputFingerprint: candidate.inputFingerprint,
    ...(candidate.deliveryEdit ? { deliveryEdit: candidate.deliveryEdit } : {}) };
}

type CompletionResult = Pick<ExportJob, "status" | "outputKind" | "outputUrl" | "ffmpegReady" | "clipCount">;
type CompletionReason = "complete" | "not_successful_mp4" | "clip_count_mismatch" | "partial_scope" | "planned_episodes_incomplete" | "source_changed";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
  return value;
}

/** Only source inputs participate; adding the exported MP4, subtitle or narration must not invalidate it. */
export function captureVideoExportSnapshot(workflow: ProjectWorkflow): VideoExportSnapshot {
  const assets = new Map(workflow.assets.map((asset) => [asset.id, asset]));
  const input = {
    version: 1,
    projectId: workflow.project.id,
    episodes: workflow.project.episodes,
    videoRatio: workflow.project.videoRatio,
    shots: workflow.storyboards.map((shot) => ({
      shot,
      video: (() => { const asset = assets.get(`video_${shot.id}`); return asset ? { id: asset.id, status: asset.status, referenceUrl: asset.referenceUrl } : null; })()
    })),
    voices: workflow.characters.map((character) => ({ id: character.id, name: character.name, voiceId: character.voiceId }))
  };
  return {
    projectId: workflow.project.id,
    storyboardIds: workflow.storyboards.map((shot) => shot.id),
    inputFingerprint: createHash("sha256").update(JSON.stringify(stableValue(input))).digest("hex"),
    ...(workflow.exportEdit ? { deliveryEdit: workflow.exportEdit } : {})
  };
}

/** Call with a fresh workflow under the same project mutation lock as the completion write. */
export function assessVideoExportCompletion(snapshot: VideoExportSnapshot, current: ProjectWorkflow, result: CompletionResult): { complete: boolean; reason: CompletionReason } {
  const incomplete = (reason: Exclude<CompletionReason, "complete">) => ({ complete: false, reason });
  if (result.status !== "succeeded" || result.outputKind !== "mp4" || result.ffmpegReady !== true || !result.outputUrl || !/^(https?:\/\/|\/storage\/).+\.mp4(?:[?#]|$)/i.test(result.outputUrl)) return incomplete("not_successful_mp4");
  if (!snapshot.storyboardIds.length || !Number.isSafeInteger(result.clipCount) || result.clipCount !== snapshot.storyboardIds.length) return incomplete("clip_count_mismatch");
  const byId = new Map(current.storyboards.map((shot) => [shot.id, shot]));
  if (snapshot.projectId !== current.project.id || new Set(snapshot.storyboardIds).size !== snapshot.storyboardIds.length || byId.size !== current.storyboards.length || snapshot.storyboardIds.length !== current.storyboards.length || snapshot.storyboardIds.some((id) => !byId.has(id))) return incomplete("partial_scope");
  const episodes = current.project.episodes;
  const actualEpisodes = new Set(current.storyboards.map((shot) => shot.episodeNo));
  if (!Number.isSafeInteger(episodes) || episodes <= 0 || actualEpisodes.size !== episodes || [...actualEpisodes].some((episode) => !Number.isSafeInteger(episode) || episode < 1 || episode > episodes)) return incomplete("planned_episodes_incomplete");
  // Explicit creator ordering is valid, but every current shot must be included exactly once.
  let selectedCurrent = { ...current, storyboards: snapshot.storyboardIds.map((id) => byId.get(id)!) };
  if (snapshot.deliveryEdit) {
    try { selectedCurrent = applyDeliveryEdit(current, snapshot.deliveryEdit); }
    catch { return incomplete("source_changed"); }
  }
  try { assertVideoExportReady(selectedCurrent); } catch { return incomplete("source_changed"); }
  if (captureVideoExportSnapshot(selectedCurrent).inputFingerprint !== snapshot.inputFingerprint) return incomplete("source_changed");
  return { complete: true, reason: "complete" };
}
