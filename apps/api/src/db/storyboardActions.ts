import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { assertProductionMediaProvider, runMediaTask } from "../billing/mediaTask.js";
import type { BatchGenerationResult, CreateProjectInput, StoryboardShot } from "@aifilm/shared";
import { estimateImageCredits, normalizeImageOutputQuality, normalizeImageOutputSize, normalizeImageProviderId, resolveImageUnitCredits } from "@aifilm/shared";
import { generateProjectStoryboards, textModelName, textProviderName } from "../agents/generator.js";
import { buildCharacterIdentityBoardPrompt, buildStoryboardFirstFramePrompt, resolveStoryboardReferenceAssets } from "../agents/storyboardProduction.js";
import { generateImage } from "../providers/dashscopeImage.js";
import type { ImageGenerationResult } from "../providers/types.js";
import { persistImageReference } from "../storage/objectStorage.js";
import { prisma } from "./client.js";
import { captureMediaSource, captureReferenceSource, MediaSourceConflict } from "./mediaSource.js";
import { persistCharacterReferenceInput, persistCurrentReferenceImage, persistCurrentShotImages, persistStaleReferenceOutputs, persistStaleShotOutputs, persistStoryboardTailFrame, removeCharacterReferenceInputs } from "./mediaPersistence.js";
import { mapAsset, mapProject, mapStoryboard, mapTask } from "./mappers.js";
import { DEMO_USER_ID } from "./seed.js";
import { getProjectWorkflow, ProjectRequestError } from "./repository.js";
import { archiveReferenceAsset, countCurrentImageAssets, invalidateReferenceMedia, invalidateShotMedia } from "./mediaInvalidation.js";
import { isHistoricalAssetId } from "./mediaAssetIdentity.js";

type CharacterReferenceJob = {
  asset: {
    id: string;
    projectId: string;
    type: string;
    name: string;
    description: string;
    prompt: string;
    referenceUrl?: string;
    status: string;
    relatedCharacterId?: string;
  };
  mode: "turnaround";
};

type CharacterReferenceGenerateInput = {
  characterIds?: string[];
  forceRegenerate?: boolean;
};

export function mergeGeneratedStoryboardScope<T extends { episodeNo: number }>(existing: T[], generated: T[]) {
  const generatedEpisodes = new Set(generated.map((shot) => shot.episodeNo));
  return [...existing.filter((shot) => !generatedEpisodes.has(shot.episodeNo)), ...generated]
    .sort((left, right) => left.episodeNo - right.episodeNo);
}

export async function runProjectStoryboardTasks(
  projectId: string,
  userId = DEMO_USER_ID,
  options: Partial<Pick<CreateProjectInput, "artStyle" | "mode" | "videoRatio">> = {}
): Promise<BatchGenerationResult> {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("Project not found");
  if (!workflow.script) throw new Error("Generate the script before storyboards");

  const input: CreateProjectInput = {
    title: workflow.project.name,
    sourceType: workflow.project.sourceType as CreateProjectInput["sourceType"],
    content: workflow.script.content,
    mode: options.mode || "nine_grid",
    genre: workflow.project.type,
    videoRatio: options.videoRatio || workflow.project.videoRatio,
    artStyle: options.artStyle || workflow.project.artStyle,
    targetEpisodes: Math.max(1, workflow.project.episodes),
    textProvider: workflow.project.textProvider,
    textModel: workflow.project.textModel,
    imageProvider: workflow.project.imageProvider,
    imageModel: workflow.project.imageModel,
    videoProvider: workflow.project.videoProvider,
    videoModel: workflow.project.videoModel
  };
  const textProviderConfig = input.textProvider
    ? await prisma.modelProvider.findUnique({ where: { id: input.textProvider } })
    : null;
  const runtimeInput = {
    ...input,
    textModelPool: [textModelName(input)],
    baseUrl: textProviderConfig?.baseUrl ?? undefined,
    apiKey: textProviderConfig?.apiKey ?? undefined
  };

  assertProductionMediaProvider(textProviderConfig, input.textProvider || "", textModelName(input), "text");
  const credits = await resolveTextRunCredits(input);

  return runMediaTask({ userId, projectId, projectName: workflow.project.name, estimatedCredits: credits, type: "storyboard", scope: "storyboard", provider: textProviderName(input), model: textModelName(input), title: "分镜生成" }, async (billing) => {
  const generated = await generateProjectStoryboards(projectId, runtimeInput, workflow.script!, workflow.characters);
  if (process.env.NODE_ENV === "production" && generated.mode !== "real") throw new Error("真实分镜生成未成功，未使用占位分镜交付。");

  const result = await billing.complete(credits, async (tx, credits) => {
    const generatedEpisodes = [...new Set(generated.storyboards.map((shot) => shot.episodeNo))];
    const replacedShots = await tx.storyboard.findMany({ where: { projectId, episodeNo: { in: generatedEpisodes } }, select: { id: true } });
    if (replacedShots.length) {
      await invalidateShotMedia(tx, projectId, replacedShots.map(shot => shot.id), { includeImages: true, reason: "分镜已重新生成" });
    }
    await tx.storyboard.deleteMany({ where: { projectId, episodeNo: { in: generatedEpisodes } } });

    const sceneAssets = generated.assets.filter((asset) => asset.type !== "role");
    for (const asset of sceneAssets) {
      await tx.asset.upsert({ where: { id: asset.id }, create: { id: asset.id, projectId, type: asset.type, name: asset.name, description: asset.description, prompt: asset.prompt, referenceUrl: asset.referenceUrl, status: asset.status, relatedCharacterId: asset.relatedCharacterId }, update: { name: asset.name, description: asset.description, prompt: asset.prompt, relatedCharacterId: asset.relatedCharacterId } });
    }

    if (generated.storyboards.length) {
      await tx.storyboard.createMany({
        data: generated.storyboards.map((shot) => ({
          id: shot.id,
          projectId,
          episodeNo: shot.episodeNo,
          sceneNo: shot.sceneNo,
          shotNo: shot.shotNo,
          duration: shot.duration,
          shotSize: shot.shotSize,
          cameraAngle: shot.cameraAngle,
          cameraMovement: shot.cameraMovement,
          characters: shot.characters,
          scene: shot.scene,
          pictureDesc: shot.pictureDesc,
          action: shot.action ?? "",
          orientation: shot.orientation ?? "",
          spatialRelation: shot.spatialRelation ?? "",
          emotion: shot.emotion ?? "",
          dialogue: shot.dialogue,
          voiceOver: shot.voiceOver,
          environmentSound: shot.environmentSound,
          soundEffect: shot.soundEffect,
          imagePrompt: shot.imagePrompt,
          videoPrompt: shot.videoPrompt,
          referenceAssetIds: shot.referenceAssetIds,
          status: shot.status
        }))
      });
    }


    const totalAssets = await countCurrentImageAssets(tx, projectId);
    await tx.project.update({
      where: { id: projectId },
      data: {
        artStyle: input.artStyle,
        videoRatio: input.videoRatio,
        status: "storyboarding",
        storyboards: await tx.storyboard.count({ where: { projectId } }),
        imageAssets: totalAssets,
        creditsSpent: { increment: credits }
      }
    });



    return { created: generated.storyboards.length };
  });

  const project = await prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });
  return { project: mapProject(project), task: mapTask(result.task), assetsCreated: result.created };
  });
}

export async function updateStoryboardShot(
  projectId: string,
  shotId: string,
  userId = DEMO_USER_ID,
  data: Partial<Pick<StoryboardShot, "duration" | "shotSize" | "cameraAngle" | "cameraMovement" | "characters" | "scene" | "pictureDesc" | "action" | "orientation" | "spatialRelation" | "emotion" | "dialogue" | "voiceOver" | "environmentSound" | "soundEffect" | "imagePrompt" | "videoPrompt">>,
  db: PrismaClient = prisma
) {
  return db.$transaction(async tx => {
  await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`project-lifecycle:${projectId}`}))`;
  await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} AND "userId" = ${userId} FOR UPDATE`;
  const project = await tx.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new Error("Project not found");
  // Media settlement writes shot/asset rows before the project. Reject edits while it is active
  // instead of introducing a project → media-row lock cycle with an already paid operation.
  const activeTask = await tx.generationTask.findFirst({
    where: { projectId, status: { notIn: ["succeeded", "completed", "failed", "canceled", "cancelled", "refunded"] } },
    select: { id: true }
  });
  if (activeTask) throw new ProjectRequestError(409, "项目仍有生成任务，请等待结束或取消后再编辑镜头。");
  const shot = await tx.storyboard.findFirst({ where: { id: shotId, projectId } });
  if (!shot) throw new Error("Storyboard shot not found");

  await tx.storyboard.update({
    where: { id: shotId },
    data: {
      ...(typeof data.duration === "number" ? { duration: data.duration } : {}),
      ...(typeof data.shotSize === "string" ? { shotSize: data.shotSize } : {}),
      ...(typeof data.cameraAngle === "string" ? { cameraAngle: data.cameraAngle } : {}),
      ...(typeof data.cameraMovement === "string" ? { cameraMovement: data.cameraMovement } : {}),
      ...(Array.isArray(data.characters) ? { characters: data.characters } : {}),
      ...(typeof data.scene === "string" ? { scene: data.scene } : {}),
      ...(typeof data.pictureDesc === "string" ? { pictureDesc: data.pictureDesc } : {}),
      ...(typeof data.action === "string" ? { action: data.action } : {}),
      ...(typeof data.orientation === "string" ? { orientation: data.orientation } : {}),
      ...(typeof data.spatialRelation === "string" ? { spatialRelation: data.spatialRelation } : {}),
      ...(typeof data.emotion === "string" ? { emotion: data.emotion } : {}),
      ...(typeof data.dialogue === "string" ? { dialogue: data.dialogue } : {}),
      ...(typeof data.voiceOver === "string" ? { voiceOver: data.voiceOver } : {}),
      ...(typeof data.environmentSound === "string" ? { environmentSound: data.environmentSound } : {}),
      ...(typeof data.soundEffect === "string" ? { soundEffect: data.soundEffect } : {}),
      ...(typeof data.imagePrompt === "string" ? { imagePrompt: data.imagePrompt } : {}),
      ...(typeof data.videoPrompt === "string" ? { videoPrompt: data.videoPrompt } : {}),
      status: "pending"
    }
  });

  await invalidateShotMedia(tx, projectId, [shotId], { includeImages: true, reason: "镜头内容已修改，需要重新生成镜头媒体。" });
  return mapStoryboard(await tx.storyboard.findUniqueOrThrow({ where: { id: shotId } }));
  });
}

export async function captureStoryboardTailFrame(projectId: string, shotId: string, userId = DEMO_USER_ID, frameUrl: string, sourceVideoUrl: string) {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("Project not found");
  const shot = workflow.storyboards.find((item) => item.id === shotId);
  if (!shot) throw new Error("Storyboard shot not found");
  const video = workflow.assets.find(asset => asset.id === `video_${shotId}` && asset.status === "succeeded");
  if (!sourceVideoUrl || video?.referenceUrl !== sourceVideoUrl) throw new MediaSourceConflict("当前镜头视频已更新，请刷新播放器后重新截取尾帧。");

  const episodeShots = workflow.storyboards
    .filter((item) => item.episodeNo === shot.episodeNo)
    .sort((left, right) => (left.shotNo - right.shotNo) || (left.sceneNo - right.sceneNo));
  const nextShot = episodeShots[episodeShots.findIndex((item) => item.id === shot.id) + 1];
  const source = captureMediaSource(workflow, "video", [shot.id, ...(nextShot ? [nextShot.id] : [])]);
  const storedUrl = await persistImageReference(frameUrl, `tail-frame-${projectId}-${shot.episodeNo}-${shot.shotNo}`);
  if (!storedUrl) throw new Error("尾帧截图保存失败");
  const result = await persistStoryboardTailFrame({ projectId, shotId, userId, storedUrl, sourceVideoUrl, source, nextShotId: nextShot?.id ?? null });
  return { asset: mapAsset(result.asset), shot: mapStoryboard(result.updatedShot), nextShot: result.updatedNextShot ? mapStoryboard(result.updatedNextShot) : undefined };
}

export async function regenerateStoryboardShotImage(projectId: string, shotId: string, userId = DEMO_USER_ID): Promise<BatchGenerationResult> {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("Project not found");
  const shot = workflow.storyboards.find((item) => item.id === shotId);
  if (!shot) throw new Error("Storyboard shot not found");

  const imageProvider = workflow.project.imageProvider || process.env.IMAGE_PROVIDER || "mock";
  const imageModel = workflow.project.imageModel || currentImageModelName(imageProvider);
  const imageSize = normalizeImageOutputSize(workflow.project.imageSize);
  const imageQuality = normalizeImageOutputQuality(workflow.project.imageQuality);
  const imageProviderConfig = await prisma.modelProvider.findUnique({ where: { id: imageProvider } });
  assertProductionMediaProvider(imageProviderConfig, imageProvider, imageModel, "image");
  const assetById = new Map(workflow.assets.map((asset) => [asset.id, asset]));
  const credits = await resolveImageCredits(imageProvider, imageModel, imageSize, imageQuality);

  const source = captureMediaSource(workflow, "image", [shot.id]);
  return runMediaTask({ userId, projectId, projectName: workflow.project.name, estimatedCredits: credits, type: "image", scope: "image", title: "分镜首帧重新生成", provider: imageProvider, model: imageModel, source }, async (billing) => {
  const resolvedReferences = resolveStoryboardReferenceAssets(workflow, shot, assetById);
  const imageResult = await generateImage({
    prompt: buildStoryboardFirstFramePrompt({ workflow, shot, assetById }),
    negativePrompt: "subtitle, watermark, logo, low quality, deformed hands, extra fingers, face drift, duplicate person",
    referenceImageUrls: resolvedReferences.map((asset) => asset.referenceUrl).filter(Boolean) as string[],
    ratio: workflow.project.videoRatio,
    seed: 41000 + shot.shotNo,
    provider: imageProvider,
    model: imageModel,
    modelPool: [imageModel],
    size: imageSize,
    quality: imageQuality,
    baseUrl: imageProviderConfig?.baseUrl ?? undefined,
    apiKey: imageProviderConfig?.apiKey ?? undefined
  }).catch((error) => {
    if (isMockImageProvider(imageProvider)) {
      console.warn("[image] single shot mock fallback:", error);
      return { taskId: "mock_image_" + Date.now(), status: "succeeded" as const, imageUrl: undefined, provider: "Mock Image Adapter", model: "mock-image-v1" };
    }
    throw error;
  });
  if (!imageResult.imageUrl && !isMockImageProvider(imageProvider)) {
    throw new Error(
      `真实生图渠道未返回图片 URL：${imageResult.provider || imageProvider} / ${imageResult.model || imageModel}。请在后台“测试生图模型”查看上游任务状态。`
    );
  }
  const storedImageUrl = await persistImageReference(imageResult.imageUrl, `shot-${projectId}-${shot.shotNo}`);

  const referenceUrl = storedImageUrl || imageResult.imageUrl || createSvgDataUrl("Shot " + shot.shotNo, shot.pictureDesc, workflow.project.artStyle);
  const outputs = [{ shot, url: referenceUrl }];
  const result = await billing.complete(credits, (tx, settledCredits) => persistCurrentShotImages(tx, projectId, outputs, settledCredits),
    { onStale: tx => persistStaleShotOutputs(tx, { projectId, taskId: billing.taskId, type: "image", outputs }) });

  const project = await prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });
  return { project: mapProject(project), task: mapTask(result.task), assetsCreated: result.created };
  });
}

export async function generateSceneEnvironmentImage(projectId: string, assetId: string, userId = DEMO_USER_ID): Promise<BatchGenerationResult> {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("Project not found");
  const asset = workflow.assets.find((item) => item.id === assetId && !isHistoricalAssetId(item.id) && (item.type === "scene" || item.type === "prop"));
  if (!asset) throw new Error("Scene asset not found");

  const imageProvider = workflow.project.imageProvider || process.env.IMAGE_PROVIDER || "mock";
  const imageModel = workflow.project.imageModel || currentImageModelName(imageProvider);
  const imageSize = normalizeImageOutputSize(workflow.project.imageSize);
  const imageQuality = normalizeImageOutputQuality(workflow.project.imageQuality);
  const imageProviderConfig = await prisma.modelProvider.findUnique({ where: { id: imageProvider } });
  assertProductionMediaProvider(imageProviderConfig, imageProvider, imageModel, "image");
  const credits = await resolveImageCredits(imageProvider, imageModel, imageSize, imageQuality);

  const source = captureReferenceSource(workflow, [asset.id]);
  return runMediaTask({ userId, projectId, projectName: workflow.project.name, estimatedCredits: credits, type: "image", scope: "image", title: "场景参考图生成", provider: imageProvider, model: imageModel, source }, async (billing) => {
  const prompt = [
    "为 AI 漫剧生产生成一张 16:9 场景环境概念图。",
    `场景：${asset.name}。`,
    asset.description || asset.prompt,
    `美术风格：${workflow.project.artStyle}。`,
    "只表现环境、空间层次、材质、光线、天气和可持续复用的机位方向；不要出现人物、字幕、Logo、水印或拼贴分格。"
  ].filter(Boolean).join("\n");
  const imageResult = await generateImage({
    prompt,
    negativePrompt: "people, person, character, portrait, subtitle, text, watermark, logo, collage, split screen, low quality, blurry",
    referenceImageUrls: asset.referenceUrl ? [asset.referenceUrl] : [],
    ratio: "16:9",
    seed: 63000 + Math.abs(asset.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 1000,
    provider: imageProvider,
    model: imageModel,
    modelPool: [imageModel],
    size: imageSize,
    quality: imageQuality,
    baseUrl: imageProviderConfig?.baseUrl ?? undefined,
    apiKey: imageProviderConfig?.apiKey ?? undefined
  }).catch((error) => {
    if (isMockImageProvider(imageProvider)) {
      console.warn("[image] scene environment mock fallback:", error);
      return { taskId: "mock_scene_" + Date.now(), status: "succeeded" as const, imageUrl: undefined, provider: "Mock Image Adapter", model: "mock-image-v1" };
    }
    throw error;
  });
  if (!imageResult.imageUrl && !isMockImageProvider(imageProvider)) {
    throw new Error(`真实场景生图渠道未返回图片 URL：${imageResult.provider || imageProvider} / ${imageResult.model || imageModel}。`);
  }
  const storedImageUrl = await persistImageReference(imageResult.imageUrl, `scene-${projectId}-${asset.id}`);
  const referenceUrl = storedImageUrl || imageResult.imageUrl || createSvgDataUrl(asset.name, asset.description || "场景环境资产", workflow.project.artStyle);

  const result = await billing.complete(credits, (tx, settledCredits) => persistCurrentReferenceImage(tx, { projectId, userId, assetId: asset.id, prompt, url: referenceUrl, credits: settledCredits }),
    { onStale: tx => persistStaleReferenceOutputs(tx, projectId, billing.taskId, [{ name: asset.name, type: asset.type, prompt, url: referenceUrl }]) });

  const project = await prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });
  return { project: mapProject(project), task: mapTask(result.task), assetsCreated: result.created };
  });
}

export async function generateCharacterReferenceImages(projectId: string, userId = DEMO_USER_ID, input: CharacterReferenceGenerateInput = {}): Promise<BatchGenerationResult> {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("Project not found");
  const roleAssets = workflow.assets.filter((asset) => asset.type === "role" && !isHistoricalAssetId(asset.id));
  const selectedCharacterIds = new Set((input.characterIds ?? []).filter(Boolean));
  const roleJobs: CharacterReferenceJob[] = roleAssets
    .filter((asset) => asset.relatedCharacterId)
    .filter((asset) => !selectedCharacterIds.size || selectedCharacterIds.has(asset.relatedCharacterId!))
    .filter((asset) => input.forceRegenerate || !hasExistingTurnaroundSheet(workflow.assets, asset.relatedCharacterId!))
    .map((asset) => ({ asset, mode: "turnaround" }));
  const imageProvider = workflow.project.imageProvider || process.env.IMAGE_PROVIDER || "mock";
  const imageModel = workflow.project.imageModel || currentImageModelName(imageProvider);
  const imageSize = normalizeImageOutputSize(workflow.project.imageSize);
  const imageQuality = normalizeImageOutputQuality(workflow.project.imageQuality);
  const imageProviderConfig = await prisma.modelProvider.findUnique({ where: { id: imageProvider } });
  assertProductionMediaProvider(imageProviderConfig, imageProvider, imageModel, "image");
  let selectedJobs = roleJobs.slice(0, characterImageBatchLimit(roleJobs.length, imageProvider));
  const creditsPerAsset = await resolveImageCredits(imageProvider, imageModel, imageSize, imageQuality);
  let credits = selectedJobs.length * creditsPerAsset;
  if (!selectedJobs.length) {
    const task = await prisma.generationTask.create({
      data: {
        id: "task_character_ref_" + Date.now(),
        userId,
        projectId,
        projectName: workflow.project.name,
        type: "character",
        title: selectedCharacterIds.size ? "Selected character turnaround sheet check" : "Character turnaround sheet check",
        provider: currentImageProviderName(imageProvider),
        model: currentImageModelName(imageProvider, imageModel),
        status: "succeeded",
        progress: 100,
        estimatedCredits: 0,
        finalCredits: 0
      }
    });
    const project = await prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });
    return { project: mapProject(project), task: mapTask(task), assetsCreated: 0 };
  }

  const source = captureReferenceSource(workflow, selectedJobs.map(job => job.asset.id));
  return runMediaTask({ userId, projectId, projectName: workflow.project.name, estimatedCredits: credits, type: "character", scope: "character", title: "角色参考图生成", provider: imageProvider, model: imageModel, source }, async (billing) => {
  const imageResults: ImageGenerationResult[] = [];
  const storedImageUrls: Array<string | undefined> = [];
  const successfulJobs: CharacterReferenceJob[] = [];
  const failures: string[] = [];
  for (const [index, { asset, mode }] of selectedJobs.entries()) {
    try {
    const identityReferenceUrl = asset.referenceUrl;
    const uploadedReferenceUrls = workflow.assets
      .filter((item) => !isHistoricalAssetId(item.id) && item.type === "role_reference" && item.relatedCharacterId === asset.relatedCharacterId && item.referenceUrl)
      .map((item) => item.referenceUrl!)
      .slice(0, 4);
    const result = await generateImage({
      prompt: buildCharacterReferencePrompt(asset.prompt, mode, identityReferenceUrl, asset.name),
      negativePrompt: "text, labels, watermark, logo, three different people, face drift, different identity, different outfit, duplicate character, deformed hands, extra fingers, low quality, dark lighting, blurry, cropped body",
      referenceImageUrls: [...(identityReferenceUrl ? [identityReferenceUrl] : []), ...uploadedReferenceUrls].slice(0, 5),
      ratio: "16:9",
      seed: 52000 + index,
      provider: imageProvider,
      model: imageModel,
      modelPool: [imageModel],
      size: imageSize,
      quality: imageQuality,
      baseUrl: imageProviderConfig?.baseUrl ?? undefined,
      apiKey: imageProviderConfig?.apiKey ?? undefined
    }).catch((error) => {
      if (isMockImageProvider(imageProvider)) {
        console.warn("[image] character reference mock fallback:", error);
        return { taskId: "mock_role_" + Date.now() + "_" + index, status: "succeeded" as const, imageUrl: undefined, provider: "Mock Image Adapter", model: "mock-image-v1" };
      }
      throw error;
    });
    if (!result.imageUrl && !isMockImageProvider(imageProvider)) throw new Error("真实角色模型未返回图片");
    const storedUrl = await persistImageReference(result.imageUrl, `character-${projectId}-${asset.name}`);
    storedImageUrls.push(storedUrl);
    imageResults.push(result);
    successfulJobs.push({ asset, mode });
    } catch (error) { failures.push(`${asset.name}：${error instanceof Error ? error.message : "生成失败"}`); }
  }
  if (!successfulJobs.length) throw new Error(failures.join("；") || "没有成功生成的角色参考图");
  selectedJobs = successfulJobs;
  credits = successfulJobs.length * creditsPerAsset;

  const result = await billing.complete(credits, async (tx, credits) => {
    await invalidateReferenceMedia(tx, projectId, userId, { assetIds: selectedJobs.map(job => job.asset.id), characterIds: selectedJobs.map(job => job.asset.relatedCharacterId!).filter(Boolean) }, "角色身份板已重新生成");
    await Promise.all(selectedJobs.map(async ({ asset, mode }, index) => {
      const referenceUrl = storedImageUrls[index] || imageResults[index]?.imageUrl || createSvgDataUrl(asset.name, `${asset.description} 多视图角色设定表`, workflow.project.artStyle);
      const viewLabel = characterViewLabel(mode);
      await archiveReferenceAsset(tx, projectId, `${asset.id}_turnaround`, "角色身份板已重新生成");
      return tx.asset.upsert({
        where: { id: `${asset.id}_turnaround` },
        update: {
          description: `${asset.description} 的${viewLabel}，一张图包含正面全身、3/4侧面、背面和大头照，后续分镜图会引用该身份板保持角色稳定。`,
          prompt: buildCharacterReferencePrompt(asset.prompt, mode, asset.referenceUrl, asset.name),
          referenceUrl,
          status: "succeeded"
        },
        create: {
          id: `${asset.id}_turnaround`,
          projectId,
          type: "role_derivative",
          name: `${asset.name} ${viewLabel}`,
          description: `${asset.description} 的${viewLabel}，一张图包含正面全身、3/4侧面、背面和大头照，后续分镜图会引用该身份板保持角色稳定。`,
          prompt: buildCharacterReferencePrompt(asset.prompt, mode, asset.referenceUrl, asset.name),
          referenceUrl,
          status: "succeeded",
          relatedCharacterId: asset.relatedCharacterId
        }
      });
    }));

    await Promise.all(selectedJobs.filter(({ asset }) => asset.relatedCharacterId).map(async ({ asset }) => {
      const turnaroundAssetId = `${asset.id}_turnaround`;
      for (const id of [`${asset.id}_front`, `${asset.id}_side`, `${asset.id}_back`]) await archiveReferenceAsset(tx, projectId, id, "已生成新的角色身份板");
      await tx.character.update({ where: { id: asset.relatedCharacterId! }, data: { referenceAssetId: turnaroundAssetId } });
      await tx.asset.update({
        where: { id: asset.id },
        data: {
          prompt: [stripGeneratedTurnaroundNote(asset.prompt), "角色身份板已生成；上传锚定图继续保留为身份源图，分镜图会同时引用锚定图与身份板。"].join("\n"),
          status: "succeeded"
        }
      });
      const shots = await tx.storyboard.findMany({
        where: { projectId, referenceAssetIds: { has: asset.id } },
        select: { id: true, referenceAssetIds: true }
      });
      await Promise.all(shots.map((shot) => tx.storyboard.update({
        where: { id: shot.id },
        data: { referenceAssetIds: [...new Set([...shot.referenceAssetIds, turnaroundAssetId])] }
      })));
    }));

    const totalImageAssets = await countCurrentImageAssets(tx, projectId);
    await tx.project.update({ where: { id: projectId }, data: { status: "asseting", imageAssets: totalImageAssets, creditsSpent: { increment: credits } } });
    return { created: selectedJobs.length };
  }, { status: failures.length ? "failed" : "succeeded", errorReason: failures.length ? `已保留成功的 ${successfulJobs.length} 张参考图，仅成功项扣费。${failures.join("；")}` : null,
    onStale: tx => persistStaleReferenceOutputs(tx, projectId, billing.taskId, selectedJobs.map(({ asset, mode }, index) => ({ name: asset.name, type: "role_derivative", prompt: buildCharacterReferencePrompt(asset.prompt, mode, asset.referenceUrl, asset.name), url: storedImageUrls[index] || imageResults[index]?.imageUrl || createSvgDataUrl(asset.name, asset.description, workflow.project.artStyle) }))) });

  const project = await prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });
  return { project: mapProject(project), task: mapTask(result.task), assetsCreated: result.created };
  });
}

// Legacy internal entry points share the same guarded source-mutation path.
export async function setCharacterReferenceImage(projectId: string, characterId: string, userId = DEMO_USER_ID, input: { referenceUrl: string; description?: string }) {
  return setCharacterReferenceImageV2(projectId, characterId, userId, input);
}

export async function deleteCharacterReferenceImage(projectId: string, characterId: string, userId = DEMO_USER_ID) {
  return deleteCharacterReferenceImageV2(projectId, characterId, userId);
}

export async function setCharacterReferenceImageV2(projectId: string, characterId: string, userId = DEMO_USER_ID, input: { referenceUrl: string; description?: string }) {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("Project not found");
  const character = workflow.characters.find(item => item.id === characterId);
  if (!character) throw new Error("Character not found");
  const referenceUrl = input.referenceUrl.trim();
  const stored = await persistImageReference(referenceUrl, `character-reference-${projectId}-${character.name}`);
  return persistCharacterReferenceInput(projectId, characterId, userId, { ...input, referenceUrl: stored || referenceUrl });
}

export async function deleteCharacterReferenceImageV2(projectId: string, characterId: string, userId = DEMO_USER_ID) {
  return removeCharacterReferenceInputs(projectId, characterId, userId);
}
async function resolveTextRunCredits(input: CreateProjectInput) {
  const price = await prisma.modelPrice.findFirst({ where: { providerId: input.textProvider, modality: "text", model: textModelName(input), enabled: true } });
  if (!price && process.env.NODE_ENV === "production") throw new Error("该文本模型尚未配置价格，请联系管理员。");
  return price?.unitCredits ?? 50;
}

async function resolveImageCredits(provider: string, model: string, size?: string, quality?: string) {
  const price = await prisma.modelPrice.findFirst({ where: { providerId: normalizeImageProviderId(provider), model, enabled: true } });
  if (!price && process.env.NODE_ENV === "production") throw new Error("该图片模型尚未配置价格，请联系管理员。");
  return estimateImageCredits(resolveImageUnitCredits(price ? [price] : [], provider, model), size, quality);
}

function currentImageProviderName(provider: string) {
  if (provider === "dashscope" || provider === "dashscope-image") return "DashScope / Qwen Image";
  if (provider === "google" || provider === "google-ai-studio" || provider === "google-gemini-image") return "Google AI Studio / Gemini Image";
  if (provider === "zml" || provider === "zml-image" || provider === "zml-relay") return "ZML Image Relay";
  if (provider === "doubao" || provider === "doubao-seedream") return "Doubao Seedream Image";
  if (provider === "openai-compatible" || provider === "relay" || provider === "relay-image") return "OpenAI-compatible Image Relay";
  return "Mock Image Adapter";
}

function currentImageModelName(provider: string, selectedModel?: string) {
  if (provider === "dashscope" || provider === "dashscope-image") return selectedModel || process.env.DASHSCOPE_IMAGE_MODEL || "qwen-image";
  if (provider === "google" || provider === "google-ai-studio" || provider === "google-gemini-image") return selectedModel || process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
  if (provider === "zml" || provider === "zml-image" || provider === "zml-relay") return selectedModel || process.env.ZML_IMAGE_MODEL || "gpt-image-2";
  if (provider === "doubao" || provider === "doubao-seedream") return selectedModel || process.env.DOUBAO_SEEDREAM_MODEL || "doubao-seedream-5-0-lite-260128";
  if (provider === "openai-compatible" || provider === "relay" || provider === "relay-image") return selectedModel || process.env.OPENAI_IMAGE_MODEL || "openai-compatible-image";
  return "mock-image-v1";
}

function imageBatchLimit(total: number, provider: string) {
  if (["dashscope", "dashscope-image", "google", "google-ai-studio", "google-gemini-image", "zml", "zml-image", "zml-relay", "doubao", "doubao-seedream", "openai-compatible", "relay", "relay-image"].includes(provider)) {
    return Math.max(1, Math.min(total, Number(process.env.IMAGE_BATCH_LIMIT ?? 1)));
  }
  return total;
}

function characterImageBatchLimit(total: number, provider: string) {
  if (["dashscope", "dashscope-image", "google", "google-ai-studio", "google-gemini-image", "zml", "zml-image", "zml-relay", "doubao", "doubao-seedream", "openai-compatible", "relay", "relay-image"].includes(provider)) {
    return Math.max(1, Math.min(total, Number(process.env.CHARACTER_IMAGE_BATCH_LIMIT ?? 3)));
  }
  return total;
}

function isMockImageProvider(provider: string) {
  return provider === "mock" || provider === "mock-image" || provider === "mock-image-v1";
}

function buildCharacterReferencePrompt(basePrompt: string, mode: CharacterReferenceJob["mode"], referenceUrl?: string, characterName?: string) {
  return buildCharacterIdentityBoardPrompt({
    character: {
      id: characterName || "character_identity",
      projectId: "",
      name: characterName || "角色",
      identity: "项目角色",
      appearance: basePrompt,
      costume: basePrompt,
      personality: "保持角色气质稳定",
      prompt: basePrompt,
      negativePrompt: "text, labels, watermark, logo, face drift, different identity, different outfit",
      consistencyLevel: "high"
    },
    projectArtStyle: "保持项目既定画风",
    basePrompt,
    referenceUrl,
    assetName: characterName
  });
}

function stripGeneratedTurnaroundNote(prompt: string) {
  return prompt
    .split("\n")
    .filter((line) => !line.includes("角色三视图总图已生成") && !line.includes("角色身份板已生成"))
    .join("\n")
    .trim();
}

function characterViewModeFromAsset(id: string, name: string): CharacterReferenceJob["mode"] | undefined {
  const text = `${id} ${name}`.toLowerCase();
  if (text.includes("turnaround") || text.includes("identity") || text.includes("多视图") || text.includes("三视图") || text.includes("身份板") || text.includes("总图")) return "turnaround";
  return undefined;
}

function characterViewLabel(mode: CharacterReferenceJob["mode"]) {
  return "角色身份板";
}

function hasExistingTurnaroundSheet(
  assets: Array<{ id: string; name: string; type: string; referenceUrl?: string; status: string; relatedCharacterId?: string }>,
  characterId: string
) {
  return assets.some((item) =>
    !isHistoricalAssetId(item.id) && item.type === "role_derivative" &&
    item.relatedCharacterId === characterId &&
    item.referenceUrl &&
    item.status === "succeeded" &&
    characterViewModeFromAsset(item.id, item.name) === "turnaround"
  );
}

function buildReferencedShotPrompt(prompt: string, referenceAssetIds: string[], assetById: Map<string, { name: string; type: string; referenceUrl?: string }>) {
  const references = referenceAssetIds
    .map((assetId) => assetById.get(assetId))
    .filter((asset): asset is { name: string; type: string; referenceUrl?: string } => Boolean(asset?.referenceUrl));
  if (!references.length) return prompt;
  const referenceText = references.map((asset) => `${asset.name}(${asset.type})`).join("、");
  return [
    `Use the reference images to preserve identity and scene consistency: ${referenceText}. Keep the same face shape, hairstyle and outfit colors; only change action, camera framing and lighting for this shot.`,
    prompt
  ].join("\n");
}

function createSvgDataUrl(title: string, desc: string, style: string) {
  const shortDesc = desc.length > 42 ? desc.slice(0, 42) + "..." : desc;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280"><rect width="720" height="1280" fill="#eaf6ff"/><rect x="76" y="110" width="568" height="880" rx="28" fill="#ffffff" opacity="0.78"/><circle cx="246" cy="414" r="92" fill="#7db7c7" opacity="0.88"/><circle cx="436" cy="430" r="104" fill="#7eab8d" opacity="0.82"/><text x="360" y="1055" text-anchor="middle" font-size="36" font-family="Microsoft YaHei, Arial" fill="#163b47">' + escapeSvg(title) + '</text><text x="360" y="1116" text-anchor="middle" font-size="24" font-family="Microsoft YaHei, Arial" fill="#45636b">' + escapeSvg(style) + '</text><text x="360" y="1172" text-anchor="middle" font-size="22" font-family="Microsoft YaHei, Arial" fill="#315f54">' + escapeSvg(shortDesc) + '</text></svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function escapeSvg(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
