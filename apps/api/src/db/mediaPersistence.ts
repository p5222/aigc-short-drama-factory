import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { StoryboardShot } from "@aifilm/shared";
import { prisma } from "./client.js";
import { archiveCurrentAsset, archiveReferenceAsset, countCurrentImageAssets, invalidateReferenceMedia, invalidateShotMedia } from "./mediaInvalidation.js";
import { isHistoricalAssetId } from "./mediaAssetIdentity.js";
import { assertNoActiveMedia, lockMediaProject, mediaSourceIsCurrent, MediaSourceConflict, type MediaSourceSnapshot } from "./mediaSource.js";

export type GeneratedShotImage = { shot: StoryboardShot; url: string };

/** Caller holds the lifecycle/project lock and has verified the durable source snapshot. */
export async function persistCurrentShotImages(tx: Prisma.TransactionClient, projectId: string, images: GeneratedShotImage[], credits: number) {
  const invalidated = new Set((await invalidateShotMedia(tx, projectId, images.map(({ shot }) => shot.id), { includeImages: true, reason: "首帧已重新生成" })).shotIds);
  for (const { shot, url } of images) await tx.asset.create({ data: {
    id: `image_${shot.id}`, projectId, type: "image", name: `镜头 ${shot.episodeNo}-${shot.shotNo} 分镜图`,
    description: shot.pictureDesc, prompt: shot.imagePrompt, referenceUrl: url, status: "succeeded"
  } });
  await tx.storyboard.updateMany({ where: { projectId, id: { in: images.map(({ shot }) => shot.id) } }, data: { status: "succeeded" } });
  // The new image still depends on the tail frame that was sent to its provider.
  // Preserve that incoming edge only if this batch did not invalidate its source.
  for (const { shot } of images) {
    const frameId = shot.firstFrameAssetId;
    if (!frameId || isHistoricalAssetId(frameId)) continue;
    const canonicalSourceId = frameId.startsWith("tailframe_") ? frameId.slice("tailframe_".length) : undefined;
    const source = await tx.storyboard.findFirst({ where: { projectId,
      ...(shot.continuitySourceShotId ? { id: shot.continuitySourceShotId } : { OR: [{ lastFrameAssetId: frameId }, ...(canonicalSourceId ? [{ id: canonicalSourceId }] : [])] })
    }, select: { id: true, lastFrameAssetId: true } });
    if (!source || invalidated.has(source.id) || (source.lastFrameAssetId !== frameId && (source.lastFrameAssetId || frameId !== `tailframe_${source.id}`))) continue;
    const frame = await tx.asset.findFirst({ where: { id: frameId, projectId, status: "succeeded" }, select: { referenceUrl: true } });
    if (!frame?.referenceUrl) continue;
    await tx.storyboard.update({ where: { id: shot.id }, data: { firstFrameAssetId: frameId, continuitySourceShotId: source.id } });
  }
  const imageAssets = await countCurrentImageAssets(tx, projectId);
  await tx.project.update({ where: { id: projectId }, data: { status: "asseting", imageAssets, creditsSpent: { increment: credits } } });
  return { created: images.length };
}

export async function persistStaleReferenceOutputs(tx: Prisma.TransactionClient, projectId: string, taskId: string, outputs: Array<{ name: string; type: string; prompt: string; url: string }>) {
  for (const output of outputs) await tx.asset.create({ data: {
    id: `asset_history_${taskId}_${crypto.randomUUID()}`, projectId, name: `${output.name}（原输入历史结果）`, type: output.type,
    prompt: output.prompt, referenceUrl: output.url, status: "succeeded", description: `任务 ${taskId} 的输入已更新，本结果未替换当前参考素材，未扣费。`
  } });
  return { created: 0 };
}

export async function persistCurrentReferenceImage(tx: Prisma.TransactionClient, input: { projectId: string; userId: string; assetId: string; prompt: string; url: string; credits: number }) {
  const { projectId, userId, assetId } = input;
  await invalidateReferenceMedia(tx, projectId, userId, { assetIds: [assetId] }, "场景参考图已重新生成");
  const previous = await tx.asset.findFirstOrThrow({ where: { id: assetId, projectId } });
  await archiveReferenceAsset(tx, projectId, assetId, "场景参考图已重新生成");
  await tx.asset.create({ data: { ...previous, prompt: input.prompt, referenceUrl: input.url, status: "succeeded", createdAt: new Date(), updatedAt: new Date() } });
  await tx.project.update({ where: { id: projectId }, data: { status: "asseting", imageAssets: await countCurrentImageAssets(tx, projectId), creditsSpent: { increment: input.credits } } });
  return { created: 1 };
}

export async function persistCharacterReferenceInput(projectId: string, characterId: string, userId: string, input: { referenceUrl: string; description?: string }, db: PrismaClient = prisma) {
  return db.$transaction(async tx => {
    await lockMediaProject(tx, projectId, userId);
    await assertNoActiveMedia(tx, projectId);
    const character = await tx.character.findFirstOrThrow({ where: { id: characterId, projectId } });
    const existing = (await tx.asset.findMany({ where: { projectId, relatedCharacterId: characterId } })).filter(asset => !isHistoricalAssetId(asset.id));
    const related = await tx.storyboard.findMany({ where: { projectId, OR: [{ characters: { hasSome: [character.name, character.id] } }, { referenceAssetIds: { hasSome: existing.map(asset => asset.id) } }] } });
    await invalidateReferenceMedia(tx, projectId, userId, { characterIds: [characterId] }, "角色参考设定已添加");
    const asset = await tx.asset.create({ data: {
      id: `asset_${characterId}_user_ref_${crypto.randomUUID()}`, projectId, type: "role_reference", name: `${character.name} 用户参考设定`,
      description: input.description?.trim() || `${character.name} 用户上传的角色参考设定图，不覆盖 AI 三视图身份板。`,
      prompt: [character.prompt, "用户上传参考图作为后续角色和分镜生产参考。"].join("\n"), referenceUrl: input.referenceUrl, status: "succeeded", relatedCharacterId: characterId
    } });
    for (const shot of related) await tx.storyboard.update({ where: { id: shot.id }, data: { referenceAssetIds: [...new Set([...shot.referenceAssetIds, asset.id])] } });
    return asset;
  });
}

export async function removeCharacterReferenceInputs(projectId: string, characterId: string, userId: string, db: PrismaClient = prisma) {
  return db.$transaction(async tx => {
    await lockMediaProject(tx, projectId, userId);
    await assertNoActiveMedia(tx, projectId);
    await tx.character.findFirstOrThrow({ where: { id: characterId, projectId } });
    const references = (await tx.asset.findMany({ where: { projectId, relatedCharacterId: characterId, type: "role_reference" } })).filter(asset => !isHistoricalAssetId(asset.id));
    const ids = references.map(asset => asset.id);
    if (!ids.length) return { ok: true, characterId, deletedAssets: 0 };
    await invalidateReferenceMedia(tx, projectId, userId, { assetIds: ids, characterIds: [characterId] }, "角色参考设定已移除");
    const shots = await tx.storyboard.findMany({ where: { projectId, referenceAssetIds: { hasSome: ids } } });
    for (const shot of shots) await tx.storyboard.update({ where: { id: shot.id }, data: { referenceAssetIds: shot.referenceAssetIds.filter(id => !ids.includes(id)) } });
    for (const id of ids) await archiveReferenceAsset(tx, projectId, id, "用户移除角色参考设定");
    await tx.character.updateMany({ where: { id: characterId, projectId, referenceAssetId: { in: ids } }, data: { referenceAssetId: null } });
    return { ok: true, characterId, deletedAssets: ids.length };
  });
}

export async function persistCurrentShotVideo(tx: Prisma.TransactionClient, input: { projectId: string; shot: StoryboardShot; url: string; credits: number; description?: string }) {
  const { projectId, shot } = input;
  await invalidateShotMedia(tx, projectId, [shot.id], { reason: "镜头视频已重新生成，原尾帧续接失效" });
  await tx.asset.create({ data: {
    id: `video_${shot.id}`, projectId, type: "video", name: `镜头 ${shot.episodeNo}-${shot.shotNo} 视频`,
    description: input.description || shot.pictureDesc, prompt: shot.videoPrompt, referenceUrl: input.url, status: "succeeded"
  } });
  const shots = await tx.storyboard.findMany({ where: { projectId }, select: { id: true } });
  const videoClips = await tx.asset.count({ where: { projectId, id: { in: shots.map(row => `video_${row.id}`) }, status: "succeeded" } });
  await tx.project.update({ where: { id: projectId }, data: { status: "rendering", videoClips, creditsSpent: { increment: input.credits } } });
  return { created: 1 };
}

/** A late paid-provider result is retained for audit/download, never made canonical or charged again. */
export async function persistStaleShotOutputs(tx: Prisma.TransactionClient, input: { projectId: string; taskId: string; type: "image" | "video"; outputs: Array<{ shot: StoryboardShot; url: string }> }) {
  for (const { shot, url } of input.outputs) await tx.asset.create({ data: {
    id: `asset_history_${input.taskId}_${crypto.randomUUID()}`, projectId: input.projectId, type: input.type,
    name: `镜头 ${shot.episodeNo}-${shot.shotNo}（输入已更新的历史结果）`,
    description: `任务 ${input.taskId} 的原输入已变化；结果仅保留历史，未替换当前素材。`,
    prompt: input.type === "image" ? shot.imagePrompt : shot.videoPrompt, referenceUrl: url, status: "succeeded"
  } });
  return { created: 0 };
}

export async function persistStoryboardTailFrame(input: {
  projectId: string; shotId: string; userId: string; storedUrl: string; sourceVideoUrl: string;
  source: MediaSourceSnapshot; nextShotId: string | null;
}, db: PrismaClient = prisma) {
  const { projectId, shotId, userId, storedUrl, sourceVideoUrl } = input;
  return db.$transaction(async tx => {
    await lockMediaProject(tx, projectId, userId);
    await assertNoActiveMedia(tx, projectId);
    if (input.source.projectId !== projectId || !await mediaSourceIsCurrent(tx, userId, input.source)) throw new MediaSourceConflict("截取尾帧期间镜头或素材已变化，请刷新后重新截取。");
    const video = await tx.asset.findFirst({ where: { id: `video_${shotId}`, projectId, status: "succeeded" } });
    if (!video || video.referenceUrl !== sourceVideoUrl) throw new MediaSourceConflict("当前镜头视频已更新，请刷新播放器后重新截取尾帧。");
    const shot = await tx.storyboard.findFirstOrThrow({ where: { id: shotId, projectId } });
    const episode = await tx.storyboard.findMany({ where: { projectId, episodeNo: shot.episodeNo }, orderBy: [{ shotNo: "asc" }, { sceneNo: "asc" }] });
    const nextShot = episode[episode.findIndex(row => row.id === shotId) + 1];
    if ((nextShot?.id ?? null) !== input.nextShotId) throw new MediaSourceConflict("镜头顺序已变化，请刷新后重新截取尾帧。");
    const tailId = `tailframe_${shotId}`;
    const dependent = await tx.storyboard.findMany({ where: { projectId, OR: [{ continuitySourceShotId: shotId }, { firstFrameAssetId: tailId }] }, select: { id: true } });
    const affected = [...new Set([...dependent.map(row => row.id), ...(nextShot ? [nextShot.id] : [])])].filter(id => id !== shotId);
    if (affected.length) await invalidateShotMedia(tx, projectId, affected, { includeImages: true, reason: "上游尾帧已更换" });
    await archiveCurrentAsset(tx, projectId, tailId, "尾帧已重新截取");
    const asset = await tx.asset.create({ data: {
      id: tailId, projectId, type: "image", name: `第${shot.episodeNo}集镜头${shot.shotNo}尾帧`,
      description: "从当前镜头视频截取，用于下一镜头首帧承接。", prompt: shot.lastFramePrompt || shot.videoPrompt, referenceUrl: storedUrl, status: "succeeded"
    } });
    const updatedShot = await tx.storyboard.update({ where: { id: shotId }, data: { lastFrameAssetId: tailId } });
    let updatedNextShot;
    if (nextShot) {
      await tx.asset.create({ data: {
        id: `image_${nextShot.id}`, projectId, type: "image", name: `第${nextShot.episodeNo}集镜头${nextShot.shotNo}首帧（承接尾帧）`,
        description: "上一镜头尾帧截图，作为本镜头首帧参考。", prompt: nextShot.firstFramePrompt || nextShot.imagePrompt, referenceUrl: storedUrl, status: "succeeded"
      } });
      updatedNextShot = await tx.storyboard.update({ where: { id: nextShot.id }, data: { firstFrameAssetId: tailId, continuitySourceShotId: shotId, status: "succeeded" } });
    }
    await tx.project.update({ where: { id: projectId }, data: { ...(nextShot ? { status: "asseting" } : {}), imageAssets: await countCurrentImageAssets(tx, projectId) } });
    return { asset, updatedShot, updatedNextShot };
  });
}
