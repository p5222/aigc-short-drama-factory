import crypto from "node:crypto";
import type { Asset, Prisma } from "@prisma/client";
import type { ProjectWorkflow } from "@aifilm/shared";
import { resolveStoryboardReferenceAssets } from "../agents/storyboardProduction.js";
import { mapAsset, mapCharacter, mapProject, mapStoryboard } from "./mappers.js";
import { isHistoricalAssetId } from "./mediaAssetIdentity.js";
export { isHistoricalAssetId } from "./mediaAssetIdentity.js";

const referenceTypes = new Set(["role", "role_derivative", "role_reference", "scene", "prop"]);

async function archiveAssetRecord(tx: Prisma.TransactionClient, asset: Asset, reason: string) {
  const historyId = `${asset.id}_history_${crypto.randomUUID()}`;
  await tx.asset.update({ where: { id: asset.id }, data: {
    id: historyId, name: `${asset.name}（历史版本）`,
    description: [asset.description, `历史版本：${reason}`].filter(Boolean).join("\n")
  } });
  await tx.showcaseWork.updateMany({ where: { projectId: asset.projectId, sourceAssetId: asset.id }, data: { sourceAssetId: historyId } });
}

export async function countCurrentImageAssets(tx: Prisma.TransactionClient, projectId: string): Promise<number> {
  const [shots, assets] = await Promise.all([
    tx.storyboard.findMany({ where: { projectId }, select: { id: true } }),
    tx.asset.findMany({ where: { projectId, type: { in: ["role", "role_derivative", "scene", "prop", "cover", "image"] } }, select: { id: true, type: true } })
  ]);
  const currentImages = new Set(shots.map(shot => `image_${shot.id}`));
  return assets.filter(asset => !isHistoricalAssetId(asset.id) && (asset.type !== "image" || currentImages.has(asset.id))).length;
}

/** Caller must hold the lifecycle/project lock and invalidate dependencies before replacing this source. */
export async function archiveReferenceAsset(tx: Prisma.TransactionClient, projectId: string, assetId: string, reason: string): Promise<void> {
  if (isHistoricalAssetId(assetId)) return;
  const asset = await tx.asset.findFirst({ where: { id: assetId, projectId } });
  if (!asset || !referenceTypes.has(asset.type)) return;
  await archiveAssetRecord(tx, asset, reason);
}

/** Caller must hold the project lifecycle advisory lock and Project FOR UPDATE. */
export async function archiveCurrentAsset(tx: Prisma.TransactionClient, projectId: string, assetId: string, reason: string): Promise<void> {
  const shotId = assetId.replace(/^(?:image_|video_|tailframe_)/, "");
  if (shotId === assetId || !await tx.storyboard.findFirst({ where: { id: shotId, projectId }, select: { id: true } })) return;
  const asset = await tx.asset.findFirst({ where: { id: assetId, projectId } });
  if (!asset) return;
  // Rename in place so QualityReport/UserFeedback foreign keys follow ON UPDATE CASCADE.
  // The file URL stays untouched; exports and published media can still play their historical version.
  await archiveAssetRecord(tx, asset, reason);
}

/** Invalidate only actual inheritance descendants, using the pre-edit relationship graph. */
export async function invalidateShotMedia(tx: Prisma.TransactionClient, projectId: string, shotIds: string[], options: { includeImages?: boolean; reason: string }): Promise<{ shotIds: string[] }> {
  const shots = await tx.storyboard.findMany({
    where: { projectId },
    select: { id: true, firstFrameAssetId: true, lastFrameAssetId: true, continuitySourceShotId: true },
    orderBy: [{ episodeNo: "asc" }, { sceneNo: "asc" }, { shotNo: "asc" }, { id: "asc" }]
  });
  const byId = new Map(shots.map(shot => [shot.id, shot]));
  const roots = new Set(shotIds.filter(id => byId.has(id)));
  if (!roots.size) return { shotIds: [] };
  const pending = [...roots];
  const visited = new Set<string>();
  const invalidateImages = new Set(options.includeImages ? roots : []);
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index]!;
    if (visited.has(id)) continue;
    visited.add(id);
    const shot = byId.get(id)!;
    const tailIds = new Set([`tailframe_${id}`, ...(shot.lastFrameAssetId ? [shot.lastFrameAssetId] : [])]);
    for (const child of shots) {
      if (child.id === id || !(child.continuitySourceShotId === id || (child.firstFrameAssetId && tailIds.has(child.firstFrameAssetId)))) continue;
      invalidateImages.add(child.id);
      if (!visited.has(child.id)) pending.push(child.id);
    }
  }
  for (const id of visited) {
    await archiveCurrentAsset(tx, projectId, `video_${id}`, options.reason);
    await archiveCurrentAsset(tx, projectId, `tailframe_${id}`, options.reason);
    const clearImage = invalidateImages.has(id);
    if (clearImage) await archiveCurrentAsset(tx, projectId, `image_${id}`, options.reason);
    await tx.storyboard.update({ where: { id }, data: {
      lastFrameAssetId: null,
      ...(clearImage ? { firstFrameAssetId: null, continuitySourceShotId: null, status: "pending" } : {})
    } });
  }
  const videoClips = await tx.asset.count({ where: { projectId, id: { in: shots.map(shot => `video_${shot.id}`) }, status: "succeeded" } });
  const imageAssets = await countCurrentImageAssets(tx, projectId);
  await tx.project.update({ where: { id: projectId }, data: { videoClips, imageAssets, status: options.includeImages ? "storyboarding" : "asseting" } });
  return { shotIds: [...visited] };
}

/** Resolve against the current source graph before archiving/replacing reference assets. */
export async function invalidateReferenceMedia(tx: Prisma.TransactionClient, projectId: string, userId: string, input: { assetIds?: string[]; characterIds?: string[] }, reason: string): Promise<{ shotIds: string[] }> {
  const project = await tx.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new Error("项目不存在或无权操作");
  const [shots, assetRows, characters] = await Promise.all([
    tx.storyboard.findMany({ where: { projectId }, orderBy: [{ episodeNo: "asc" }, { sceneNo: "asc" }, { shotNo: "asc" }] }),
    tx.asset.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    tx.character.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } })
  ]);
  const assets = assetRows.filter(asset => !isHistoricalAssetId(asset.id));
  const requestedAssets = new Set(input.assetIds ?? []);
  const affectedAssets = new Set(assets.filter(asset => requestedAssets.has(asset.id)).map(asset => asset.id));
  const requestedCharacters = new Set(input.characterIds ?? []);
  for (const asset of assets) if (affectedAssets.has(asset.id) && asset.relatedCharacterId) requestedCharacters.add(asset.relatedCharacterId);
  const affectedCharacters = characters.filter(character => requestedCharacters.has(character.id));
  const characterNames = new Set(affectedCharacters.flatMap(character => [character.id, character.name]));
  for (const asset of assets) if (asset.relatedCharacterId && affectedCharacters.some(character => character.id === asset.relatedCharacterId)) affectedAssets.add(asset.id);
  if (!affectedAssets.size && !characterNames.size) return { shotIds: [] };
  const workflow = { project: mapProject(project), assets: assets.map(mapAsset), characters: characters.map(mapCharacter), storyboards: shots.map(mapStoryboard) } as ProjectWorkflow;
  const byAsset = new Map(workflow.assets.map(asset => [asset.id, asset]));
  const affected = workflow.storyboards.filter(shot =>
    shot.referenceAssetIds.some(id => affectedAssets.has(id)) || shot.characters.some(name => characterNames.has(name))
    || resolveStoryboardReferenceAssets(workflow, shot, byAsset).some(asset => affectedAssets.has(asset.id))
  ).map(shot => shot.id);
  return invalidateShotMedia(tx, projectId, affected, { includeImages: true, reason });
}
