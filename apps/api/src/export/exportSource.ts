import crypto from "node:crypto";
import type { ExportJob, ProjectWorkflow } from "@aifilm/shared";
import { applyDeliveryEdit, type DeliveryEditReference } from "@aifilm/shared";
import { buildExportSrt, buildVoiceCues } from "./videoComposer.js";

export interface ExportSourceSnapshot {
  version: 1;
  type: ExportJob["type"];
  projectId: string;
  scope: "project" | "selection";
  storyboardIds: string[];
  inputFingerprint: string;
  deliveryEdit?: DeliveryEditReference;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

/** Store only identity/order/hash; source text, URLs and credentials never enter the snapshot. */
export function captureExportSource(workflow: ProjectWorkflow, type: ExportJob["type"], scope: ExportSourceSnapshot["scope"] = "selection"): ExportSourceSnapshot {
  return captureWithAssets(workflow, type, scope, new Map(workflow.assets.map(asset => [asset.id, asset])));
}

function captureWithAssets(workflow: ProjectWorkflow, type: ExportJob["type"], scope: ExportSourceSnapshot["scope"], assets: Map<string, ProjectWorkflow["assets"][number]>): ExportSourceSnapshot {
  const cues = type === "subtitle" ? undefined : buildVoiceCues(workflow).map(cue => ({ ...cue, voice: cue.text ? cue.voice || "Cherry" : undefined }));
  const subtitles = type === "tts" ? undefined : buildExportSrt(workflow);
  const assetInput = (id: string) => {
    const asset = assets.get(id);
    return asset ? { id, status: asset.status, referenceUrl: asset.referenceUrl } : { id, missing: true };
  };
  const input = type === "video_export" ? {
    videoRatio: workflow.project.videoRatio, cues, subtitles,
    shots: workflow.storyboards.map(({ status: _status, ...shot }) => ({ shot, video: assetInput(`video_${shot.id}`), image: assetInput(`image_${shot.id}`) }))
  } : type === "tts" ? { cues } : { subtitles };
  return { version: 1, type, projectId: workflow.project.id, scope, storyboardIds: workflow.storyboards.map(shot => shot.id),
    inputFingerprint: crypto.createHash("sha256").update(JSON.stringify(stable(input))).digest("hex"),
    ...(workflow.exportEdit ? { deliveryEdit: workflow.exportEdit } : {}) };
}

export function readExportSource(value: unknown): ExportSourceSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Partial<ExportSourceSnapshot>;
  if (source.version !== 1 || !["tts", "subtitle", "video_export"].includes(source.type ?? "") || !["project", "selection"].includes(source.scope ?? "")
    || typeof source.projectId !== "string" || !source.projectId || typeof source.inputFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(source.inputFingerprint)
    || !Array.isArray(source.storyboardIds) || source.storyboardIds.some(id => typeof id !== "string" || !id) || new Set(source.storyboardIds).size !== source.storyboardIds.length) return null;
  if (source.deliveryEdit && (!Number.isSafeInteger(source.deliveryEdit.episodeNo) || source.deliveryEdit.episodeNo < 1
    || !Number.isSafeInteger(source.deliveryEdit.revision) || source.deliveryEdit.revision < 1)) return null;
  return source as ExportSourceSnapshot;
}

export function exportSourceFromDiagnostics(value: string | null | undefined): ExportSourceSnapshot | null {
  try { return readExportSource(JSON.parse(value || "{}").sourceSnapshot); } catch { return null; }
}

/** Assess the saved export scope, not whether the project has ever had any MP4 asset. */
export function exportSourceStatus(snapshot: ExportSourceSnapshot | null, current: ProjectWorkflow | null, type: ExportJob["type"]): NonNullable<ExportJob["sourceStatus"]> {
  return createExportSourceContext(current)(snapshot, type);
}

/** Reuse project indexes and fingerprints while mapping a list from one consistent database snapshot. */
export function createExportSourceContext(current: ProjectWorkflow | null) {
  const byId = new Map(current?.storyboards.map(shot => [shot.id, shot]) ?? []);
  const assets = new Map(current?.assets.map(asset => [asset.id, asset]) ?? []);
  const fingerprints = new Map<string, string>();
  return (snapshot: ExportSourceSnapshot | null, type: ExportJob["type"]): NonNullable<ExportJob["sourceStatus"]> => {
    if (!snapshot || snapshot.type !== type) return "unknown";
    if (!current || snapshot.projectId !== current.project.id) return "stale";
    if (byId.size !== current.storyboards.length || snapshot.storyboardIds.some(id => !byId.has(id))) return "stale";
    if (snapshot.scope === "project" && current.storyboards.length !== snapshot.storyboardIds.length) return "stale";
    const key = JSON.stringify([type, snapshot.scope, snapshot.storyboardIds, snapshot.deliveryEdit]);
    let fingerprint = fingerprints.get(key);
    if (!fingerprint) {
      let selected = { ...current, storyboards: snapshot.storyboardIds.map(id => byId.get(id)!) };
      if (snapshot.deliveryEdit) {
        try { selected = applyDeliveryEdit(current, snapshot.deliveryEdit); }
        catch { return "stale"; }
        if (JSON.stringify(selected.storyboards.map(shot => shot.id)) !== JSON.stringify(snapshot.storyboardIds)) return "stale";
      }
      fingerprint = captureWithAssets(selected, type, snapshot.scope, snapshot.deliveryEdit ? new Map(selected.assets.map(asset => [asset.id, asset])) : assets).inputFingerprint;
      fingerprints.set(key, fingerprint);
    }
    return fingerprint === snapshot.inputFingerprint ? "current" : "stale";
  };
}
