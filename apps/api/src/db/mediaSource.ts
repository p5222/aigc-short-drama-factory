import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { ProjectWorkflow } from "@aifilm/shared";
import { resolveStoryboardReferenceAssets } from "../agents/storyboardProduction.js";
import { mapAsset, mapCharacter, mapProject, mapStoryboard } from "./mappers.js";
import { isHistoricalAssetId } from "./mediaAssetIdentity.js";

export interface MediaSourceSnapshot {
  version: 1;
  kind: "image" | "video" | "reference";
  projectId: string;
  shotIds: string[];
  assetIds?: string[];
  inputFingerprint: string;
}

export class MediaSourceConflict extends Error {
  readonly status = 409;
  constructor(message: string) { super(message); this.name = "MediaSourceConflict"; }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

export function captureMediaSource(workflow: ProjectWorkflow, kind: "image" | "video", shotIds: string[]): MediaSourceSnapshot {
  if (!shotIds.length || new Set(shotIds).size !== shotIds.length) throw new MediaSourceConflict("生成范围无效，请刷新镜头后重试。");
  const byId = new Map(workflow.storyboards.map(shot => [shot.id, shot]));
  const assets = new Map(workflow.assets.map(asset => [asset.id, asset]));
  const assetInput = (id: string) => {
    const asset = assets.get(id);
    return asset ? { id, name: asset.name, description: asset.description, prompt: asset.prompt, status: asset.status, referenceUrl: asset.referenceUrl } : { id, missing: true };
  };
  const shots = [...shotIds].sort().map(id => {
    const shot = byId.get(id);
    if (!shot) throw new MediaSourceConflict("生成镜头已变化，请刷新后重试。");
    // Output status is bookkeeping; prompts, timing, continuity and reference inputs are source data.
    const { status: _status, ...source } = shot;
    const references = resolveStoryboardReferenceAssets(workflow, shot, assets).map(asset => asset.id);
    if (shot.firstFrameAssetId) references.push(shot.firstFrameAssetId);
    if (kind === "video") references.push(`image_${id}`);
    return { shot: source, assets: [...new Set(references)].sort().map(assetInput) };
  });
  const project = workflow.project;
  const input = {
    version: 1, kind, projectId: project.id, shots,
    project: { name: project.name, artStyle: project.artStyle, videoRatio: project.videoRatio, segmentProfile: project.segmentProfile,
      ...(kind === "image" ? { provider: project.imageProvider, model: project.imageModel, size: project.imageSize, quality: project.imageQuality }
        : { provider: project.videoProvider, model: project.videoModel }) },
    characters: workflow.characters.map(({ voiceId: _voiceId, ...character }) => character).sort((a, b) => a.id.localeCompare(b.id))
  };
  return { version: 1, kind, projectId: project.id, shotIds: [...shotIds], inputFingerprint: crypto.createHash("sha256").update(JSON.stringify(stable(input))).digest("hex") };
}

export function captureReferenceSource(workflow: ProjectWorkflow, assetIds: string[]): MediaSourceSnapshot {
  if (!assetIds.length || assetIds.some(id => isHistoricalAssetId(id))) throw new MediaSourceConflict("请选择当前角色或场景素材。");
  const byId = new Map(workflow.assets.filter(asset => !isHistoricalAssetId(asset.id)).map(asset => [asset.id, asset]));
  const selected = [...new Set(assetIds)].sort().map(id => {
    const asset = byId.get(id);
    if (!asset) throw new MediaSourceConflict("参考素材已变化，请刷新后重试。");
    return asset;
  });
  const characterIds = new Set(selected.map(asset => asset.relatedCharacterId).filter(Boolean));
  const references = [...byId.values()].filter(asset => asset.relatedCharacterId && characterIds.has(asset.relatedCharacterId)).sort((a, b) => a.id.localeCompare(b.id));
  const input = { version: 1, projectId: workflow.project.id, assets: selected, references,
    characters: workflow.characters.filter(character => characterIds.has(character.id)).sort((a, b) => a.id.localeCompare(b.id)),
    project: { artStyle: workflow.project.artStyle, provider: workflow.project.imageProvider, model: workflow.project.imageModel, size: workflow.project.imageSize, quality: workflow.project.imageQuality } };
  return { version: 1, kind: "reference", projectId: workflow.project.id, shotIds: [], assetIds: [...assetIds], inputFingerprint: crypto.createHash("sha256").update(JSON.stringify(stable(input))).digest("hex") };
}

export function readMediaSource(value: unknown): MediaSourceSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Partial<MediaSourceSnapshot>;
  if (source.version !== 1 || !["image", "video", "reference"].includes(source.kind ?? "") || typeof source.projectId !== "string" || !Array.isArray(source.shotIds) || !source.shotIds.every(id => typeof id === "string") || typeof source.inputFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(source.inputFingerprint)) return undefined;
  if (source.kind === "reference" ? !Array.isArray(source.assetIds) || !source.assetIds.length || !source.assetIds.every(id => typeof id === "string") : !source.shotIds.length) return undefined;
  return source as MediaSourceSnapshot;
}

export async function mediaSourceIsCurrent(tx: Prisma.TransactionClient, userId: string, source: MediaSourceSnapshot): Promise<boolean> {
  const [project, shots, assets, characters] = await Promise.all([
    tx.project.findFirst({ where: { id: source.projectId, userId } }),
    tx.storyboard.findMany({ where: { projectId: source.projectId }, orderBy: [{ episodeNo: "asc" }, { sceneNo: "asc" }, { shotNo: "asc" }] }),
    tx.asset.findMany({ where: { projectId: source.projectId }, orderBy: { createdAt: "asc" } }),
    tx.character.findMany({ where: { projectId: source.projectId }, orderBy: { createdAt: "asc" } })
  ]);
  if (!project) return false;
  const workflow = { project: mapProject(project), storyboards: shots.map(mapStoryboard), assets: assets.map(mapAsset), characters: characters.map(mapCharacter) } as ProjectWorkflow;
  try { return (source.kind === "reference" ? captureReferenceSource(workflow, source.assetIds!) : captureMediaSource(workflow, source.kind, source.shotIds)).inputFingerprint === source.inputFingerprint; }
  catch (error) { if (error instanceof MediaSourceConflict) return false; throw error; }
}

/** Only effective image targets enter this check; already-complete unselected parents remain usable. */
export async function assertIndependentImageBatch(tx: Prisma.TransactionClient, source: MediaSourceSnapshot) {
  if (source.kind !== "image" || source.shotIds.length < 2) return;
  const shots = await tx.storyboard.findMany({ where: { projectId: source.projectId }, select: { id: true, firstFrameAssetId: true, lastFrameAssetId: true, continuitySourceShotId: true } });
  const frames = new Set((await tx.asset.findMany({ where: { projectId: source.projectId, id: { in: shots.flatMap(shot => shot.firstFrameAssetId ? [shot.firstFrameAssetId] : []) }, status: "succeeded", referenceUrl: { not: null } }, select: { id: true, referenceUrl: true } }))
    .filter(asset => asset.referenceUrl && !isHistoricalAssetId(asset.id)).map(asset => asset.id));
  const incoming = new Map<string, string>();
  for (const shot of shots) {
    const frameId = shot.firstFrameAssetId;
    if (!frameId || !frames.has(frameId)) continue;
    const parent = shots.find(candidate => candidate.id !== shot.id
      && (!shot.continuitySourceShotId || candidate.id === shot.continuitySourceShotId)
      && (candidate.lastFrameAssetId === frameId || (!candidate.lastFrameAssetId && frameId === `tailframe_${candidate.id}`)));
    if (parent) incoming.set(shot.id, parent.id);
  }
  for (const root of source.shotIds) {
    const invalidated = new Set([root]);
    const pending = [root];
    for (let index = 0; index < pending.length; index++) {
      const parent = shots.find(shot => shot.id === pending[index]);
      if (!parent) continue;
      for (const child of shots) {
        if (invalidated.has(child.id) || !(child.continuitySourceShotId === parent.id || (child.firstFrameAssetId && [parent.lastFrameAssetId, `tailframe_${parent.id}`].includes(child.firstFrameAssetId)))) continue;
        invalidated.add(child.id); pending.push(child.id);
      }
    }
    if (source.shotIds.some(id => id !== root && incoming.has(id) && invalidated.has(incoming.get(id)!))) {
      throw new MediaSourceConflict("本批镜头包含仍在使用前序尾帧的后继镜头，请先生成前序镜头并确认新尾帧，再生成后继首帧；本次未冻结积分或提交生成。");
    }
  }
}

export async function lockMediaProject(tx: Prisma.TransactionClient, projectId: string, userId: string) {
  await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`project-lifecycle:${projectId}`}))`;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Project" WHERE "id" = ${projectId} AND "userId" = ${userId} FOR UPDATE`;
  if (!rows.length) throw new MediaSourceConflict("项目不存在或无权操作，请刷新后重试。");
}

export const TERMINAL_MEDIA_STATUSES = ["succeeded", "completed", "failed", "canceled", "cancelled", "refunded"];

export async function assertNoActiveMedia(tx: Prisma.TransactionClient, projectId: string) {
  if (await tx.generationTask.findFirst({ where: { projectId, status: { notIn: TERMINAL_MEDIA_STATUSES } }, select: { id: true } })) {
    throw new MediaSourceConflict("项目仍有生成任务，请等待结束后再更换素材。");
  }
}
