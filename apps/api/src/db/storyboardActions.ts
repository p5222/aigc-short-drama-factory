import type { BatchGenerationResult, CreateProjectInput, StoryboardShot } from "@aifilm/shared";
import { estimateImageCredits, normalizeImageOutputQuality, normalizeImageOutputSize } from "@aifilm/shared";
import { generateProjectStoryboards, textModelName, textProviderName } from "../agents/generator.js";
import { buildCharacterIdentityBoardPrompt, buildStoryboardFirstFramePrompt } from "../agents/storyboardProduction.js";
import { generateImage } from "../providers/dashscopeImage.js";
import type { ImageGenerationResult } from "../providers/types.js";
import { persistImageReference } from "../storage/objectStorage.js";
import { prisma } from "./client.js";
import { mapProject, mapStoryboard, mapTask } from "./mappers.js";
import { DEMO_USER_ID } from "./seed.js";
import { getProjectWorkflow } from "./repository.js";

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
    baseUrl: textProviderConfig?.baseUrl ?? undefined,
    apiKey: textProviderConfig?.apiKey ?? undefined
  };

  const credits = await resolveTextRunCredits(input);
  const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
  if (account.balance - account.frozenBalance < credits) throw new Error("Insufficient credits");

  const generated = await generateProjectStoryboards(projectId, runtimeInput, workflow.script, workflow.characters);
  const taskId = "task_storyboard_" + Date.now();

  const result = await prisma.$transaction(async (tx) => {
    await tx.storyboard.deleteMany({ where: { projectId } });
    await tx.asset.deleteMany({
      where: {
        projectId,
        OR: [{ type: { in: ["image", "video"] } }, { id: { startsWith: "scene_" + projectId + "_" } }]
      }
    });

    const sceneAssets = generated.assets.filter((asset) => asset.type !== "role");
    if (sceneAssets.length) {
      await tx.asset.createMany({
        data: sceneAssets.map((asset) => ({
          id: asset.id,
          projectId,
          type: asset.type,
          name: asset.name,
          description: asset.description,
          prompt: asset.prompt,
          referenceUrl: asset.referenceUrl,
          status: asset.status,
          relatedCharacterId: asset.relatedCharacterId
        })),
        skipDuplicates: true
      });
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

    const task = await tx.generationTask.create({
      data: {
        id: taskId,
        userId,
        projectId,
        projectName: workflow.project.name,
        type: "storyboard",
        title: "Storyboard generation",
        provider: generated.mode === "real" ? textProviderName(input) : "Local Generator",
        model: generated.mode === "real" ? textModelName(input) : "local-storyboard-v1",
        status: "succeeded",
        progress: 100,
        estimatedCredits: credits,
        finalCredits: credits
      }
    });

    const totalAssets = await tx.asset.count({ where: { projectId } });
    await tx.project.update({
      where: { id: projectId },
      data: {
        artStyle: input.artStyle,
        videoRatio: input.videoRatio,
        status: "storyboarding",
        storyboards: generated.storyboards.length,
        imageAssets: totalAssets,
        creditsSpent: { increment: credits }
      }
    });

    await tx.creditAccount.update({
      where: { userId },
      data: { balance: { decrement: credits }, totalConsume: { increment: credits } }
    });

    await tx.creditTransaction.create({
      data: {
        id: "tx_" + Date.now() + "_storyboard",
        userId,
        projectId,
        taskId,
        type: "consume",
        amount: -credits,
        balanceAfter: account.balance - credits,
        description: "Storyboard generation credits"
      }
    });

    return { task, created: generated.storyboards.length };
  });

  const project = await prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });
  return { project: mapProject(project), task: mapTask(result.task), assetsCreated: result.created };
}

export async function updateStoryboardShot(
  projectId: string,
  shotId: string,
  userId = DEMO_USER_ID,
  data: Partial<Pick<StoryboardShot, "duration" | "shotSize" | "cameraAngle" | "cameraMovement" | "characters" | "scene" | "pictureDesc" | "action" | "orientation" | "spatialRelation" | "emotion" | "dialogue" | "voiceOver" | "environmentSound" | "soundEffect" | "imagePrompt" | "videoPrompt">>
) {
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new Error("Project not found");
  const shot = await prisma.storyboard.findFirst({ where: { id: shotId, projectId } });
  if (!shot) throw new Error("Storyboard shot not found");

  const updated = await prisma.storyboard.update({
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

  await prisma.asset.deleteMany({ where: { projectId, id: { in: ["image_" + shotId, "video_" + shotId] } } });
  return mapStoryboard(updated);
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
  const assetById = new Map(workflow.assets.map((asset) => [asset.id, asset]));
  const credits = await resolveImageCredits(imageProvider, imageModel, imageSize, imageQuality);
  const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
  if (account.balance - account.frozenBalance < credits) throw new Error("Insufficient credits");

  const imageResult = await generateImage({
    prompt: buildStoryboardFirstFramePrompt({ workflow, shot, assetById }),
    negativePrompt: "subtitle, watermark, logo, low quality, deformed hands, extra fingers, face drift, duplicate person",
    referenceImageUrls: shot.referenceAssetIds.map((assetId) => assetById.get(assetId)?.referenceUrl).filter(Boolean) as string[],
    ratio: workflow.project.videoRatio,
    seed: 41000 + shot.shotNo,
    provider: workflow.project.imageProvider,
    model: imageModel,
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

  const taskId = "task_image_one_" + Date.now();
  const result = await prisma.$transaction(async (tx) => {
    const task = await tx.generationTask.create({
      data: {
        id: taskId,
        userId,
        projectId,
        projectName: workflow.project.name,
        type: "image",
        title: "Single shot image regeneration",
        provider: imageResult.provider || currentImageProviderName(imageProvider),
        model: imageResult.model || currentImageModelName(imageProvider, imageModel),
        status: "succeeded",
        progress: 100,
        estimatedCredits: credits,
        finalCredits: credits
      }
    });

    const fallback = createSvgDataUrl("Shot " + shot.shotNo, shot.pictureDesc, workflow.project.artStyle);
    const referenceUrl = storedImageUrl || imageResult.imageUrl || fallback;
    await tx.asset.upsert({
      where: { id: "image_" + shot.id },
      update: { description: shot.pictureDesc, prompt: shot.imagePrompt, referenceUrl, status: "succeeded" },
      create: {
        id: "image_" + shot.id,
        projectId,
        type: "image",
        name: "Shot " + shot.episodeNo + "-" + shot.sceneNo + "-" + shot.shotNo + " image",
        description: shot.pictureDesc,
        prompt: shot.imagePrompt,
        referenceUrl,
        status: "succeeded",
        relatedCharacterId: null
      }
    });

    await tx.storyboard.update({ where: { id: shot.id }, data: { status: "succeeded" } });
    const totalImageAssets = await tx.asset.count({ where: { projectId, type: { in: ["role", "role_derivative", "scene", "prop", "image", "cover"] } } });
    await tx.project.update({ where: { id: projectId }, data: { status: "asseting", imageAssets: totalImageAssets, creditsSpent: { increment: credits } } });
    await tx.creditAccount.update({ where: { userId }, data: { balance: { decrement: credits }, totalConsume: { increment: credits } } });
    await tx.creditTransaction.create({ data: { id: "tx_" + Date.now() + "_image_one", userId, projectId, taskId, type: "consume", amount: -credits, balanceAfter: account.balance - credits, description: "Single shot image regeneration credits" } });
    return { task };
  });

  const project = await prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });
  return { project: mapProject(project), task: mapTask(result.task), assetsCreated: 1 };
}

export async function generateCharacterReferenceImages(projectId: string, userId = DEMO_USER_ID, input: CharacterReferenceGenerateInput = {}): Promise<BatchGenerationResult> {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("Project not found");
  const roleAssets = workflow.assets.filter((asset) => asset.type === "role");
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
  const selectedJobs = roleJobs.slice(0, characterImageBatchLimit(roleJobs.length, imageProvider));
  const creditsPerAsset = await resolveImageCredits(imageProvider, imageModel, imageSize, imageQuality);
  const credits = selectedJobs.length * creditsPerAsset;
  const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
  if (account.balance - account.frozenBalance < credits) throw new Error("Insufficient credits");
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

  const imageResults: ImageGenerationResult[] = [];
  for (const [index, { asset, mode }] of selectedJobs.entries()) {
    const identityReferenceUrl = asset.referenceUrl;
    const result = await generateImage({
      prompt: buildCharacterReferencePrompt(asset.prompt, mode, identityReferenceUrl, asset.name),
      negativePrompt: "text, labels, watermark, logo, three different people, face drift, different identity, different outfit, duplicate character, deformed hands, extra fingers, low quality, dark lighting, blurry, cropped body",
      referenceImageUrls: identityReferenceUrl ? [identityReferenceUrl] : undefined,
      ratio: "16:9",
      seed: 52000 + index,
      provider: workflow.project.imageProvider,
      model: imageModel,
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
    imageResults.push(result);
  }
  const missingImageResult = imageResults.find((result) => !result.imageUrl);
  if (missingImageResult && !isMockImageProvider(imageProvider)) {
    throw new Error(
      `真实角色参考图渠道未返回图片 URL：${missingImageResult.provider || imageProvider} / ${missingImageResult.model || imageModel}。请在后台“测试生图模型”查看上游任务状态。`
    );
  }
  const storedImageUrls = await Promise.all(
    imageResults.map((result, index) => persistImageReference(result.imageUrl, `character-${projectId}-${selectedJobs[index]?.asset.name ?? index + 1}`))
  );

  const taskId = "task_character_ref_" + Date.now();
  const result = await prisma.$transaction(async (tx) => {
    const task = await tx.generationTask.create({
      data: { id: taskId, userId, projectId, projectName: workflow.project.name, type: "character", title: "Character reference image generation", provider: imageResults[0]?.provider || currentImageProviderName(imageProvider), model: imageResults[0]?.model || currentImageModelName(imageProvider, imageModel), status: "succeeded", progress: 100, estimatedCredits: credits, finalCredits: credits }
    });

    await Promise.all(selectedJobs.map(({ asset, mode }, index) => {
      const referenceUrl = storedImageUrls[index] || imageResults[index]?.imageUrl || createSvgDataUrl(asset.name, `${asset.description} 多视图角色设定表`, workflow.project.artStyle);
      const viewLabel = characterViewLabel(mode);
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
      await tx.asset.deleteMany({
        where: {
          projectId,
          type: "role_derivative",
          relatedCharacterId: asset.relatedCharacterId!,
          id: { in: [`${asset.id}_front`, `${asset.id}_side`, `${asset.id}_back`] }
        }
      });
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

    const totalImageAssets = await tx.asset.count({ where: { projectId, type: { in: ["role", "role_derivative", "scene", "prop", "image", "cover"] } } });
    await tx.project.update({ where: { id: projectId }, data: { status: "asseting", imageAssets: totalImageAssets, creditsSpent: { increment: credits } } });
    await tx.creditAccount.update({ where: { userId }, data: { balance: { decrement: credits }, totalConsume: { increment: credits } } });
    await tx.creditTransaction.create({ data: { id: "tx_" + Date.now() + "_role_ref", userId, projectId, taskId, type: "consume", amount: -credits, balanceAfter: account.balance - credits, description: "Character reference image credits" } });
    return { task, created: selectedJobs.length };
  });

  const project = await prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });
  return { project: mapProject(project), task: mapTask(result.task), assetsCreated: result.created };
}

export async function setCharacterReferenceImage(
  projectId: string,
  characterId: string,
  userId = DEMO_USER_ID,
  input: { referenceUrl: string; description?: string }
) {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("Project not found");
  const character = workflow.characters.find((item) => item.id === characterId);
  if (!character) throw new Error("Character not found");

  const primaryRoleAsset = workflow.assets.find((item) => item.type === "role" && item.relatedCharacterId === character.id);
  const assetId = primaryRoleAsset?.id || `asset_${character.id}`;
  const referenceUrl = input.referenceUrl.trim();
  const description = input.description?.trim() || `${character.name} 用户上传/登记的正面参考图，用作角色身份锚点。`;
  const storedReferenceUrl = await persistImageReference(referenceUrl, `character-reference-${projectId}-${character.name}`);

  const asset = await prisma.asset.upsert({
    where: { id: assetId },
    update: {
      type: "role",
      name: `${character.name} 角色主参考图`,
      description,
      prompt: [
        character.prompt,
        "用户提供的正面参考图已作为身份锚点；后续生成多视图和分镜时保持同一脸型、发型、服装主色。"
      ].join("\n"),
      referenceUrl: storedReferenceUrl || referenceUrl,
      status: "succeeded",
      relatedCharacterId: character.id
    },
    create: {
      id: assetId,
      projectId,
      type: "role",
      name: `${character.name} 角色主参考图`,
      description,
      prompt: [
        character.prompt,
        "用户提供的正面参考图已作为身份锚点；后续生成多视图和分镜时保持同一脸型、发型、服装主色。"
      ].join("\n"),
      referenceUrl: storedReferenceUrl || referenceUrl,
      status: "succeeded",
      relatedCharacterId: character.id
    }
  });

  await prisma.character.update({ where: { id: character.id }, data: { referenceAssetId: asset.id } });
  const derivativeIds = workflow.assets
    .filter((item) => item.type === "role_derivative" && item.relatedCharacterId === character.id)
    .map((item) => item.id);
  if (derivativeIds.length) {
    await removeAssetReferencesFromStoryboards(projectId, derivativeIds);
  }
  await prisma.asset.deleteMany({
    where: {
      projectId,
      type: "role_derivative",
      relatedCharacterId: character.id
    }
  });
  return asset;
}

export async function deleteCharacterReferenceImage(
  projectId: string,
  characterId: string,
  userId = DEMO_USER_ID
) {
  const workflow = await getProjectWorkflow(projectId, userId);
  if (!workflow) throw new Error("Project not found");
  const character = workflow.characters.find((item) => item.id === characterId);
  if (!character) throw new Error("Character not found");

  const roleAsset = workflow.assets.find((item) => item.type === "role" && item.relatedCharacterId === character.id);
  const derivativeIds = workflow.assets
    .filter((item) => item.relatedCharacterId === character.id && (item.type === "role_derivative" || item.id === roleAsset?.id))
    .map((item) => item.id);

  if (derivativeIds.length) await removeAssetReferencesFromStoryboards(projectId, derivativeIds.filter((id) => id !== roleAsset?.id));

  await prisma.$transaction(async (tx) => {
    await tx.asset.deleteMany({
      where: {
        projectId,
        type: "role_derivative",
        relatedCharacterId: character.id
      }
    });
    if (roleAsset) {
      await tx.asset.update({
        where: { id: roleAsset.id },
        data: {
          referenceUrl: null,
          status: "pending",
          prompt: character.prompt
        }
      });
    }
    await tx.character.update({ where: { id: character.id }, data: { referenceAssetId: roleAsset?.id ?? null } });
  });

  return { ok: true, characterId, deletedAssets: derivativeIds.length };
}

async function removeAssetReferencesFromStoryboards(projectId: string, assetIds: string[]) {
  if (!assetIds.length) return;
  const shots = await prisma.storyboard.findMany({
    where: { projectId },
    select: { id: true, referenceAssetIds: true }
  });
  await Promise.all(shots.map((shot) => {
    const next = shot.referenceAssetIds.filter((id) => !assetIds.includes(id));
    if (next.length === shot.referenceAssetIds.length) return Promise.resolve();
    return prisma.storyboard.update({ where: { id: shot.id }, data: { referenceAssetIds: next } });
  }));
}

async function resolveTextRunCredits(input: CreateProjectInput) {
  const price = await prisma.modelPrice.findFirst({ where: { modality: "text", model: textModelName(input), enabled: true } });
  return price?.unitCredits ?? 50;
}

async function resolveImageCredits(provider: string, model: string, size?: string, quality?: string) {
  const price = await prisma.modelPrice.findFirst({ where: { providerId: imageProviderId(provider), model, enabled: true } });
  return estimateImageCredits(price?.unitCredits ?? imageCreditPerShot(provider), size, quality);
}

function imageProviderId(provider: string) {
  if (provider === "dashscope" || provider === "dashscope-image") return "dashscope-image";
  if (provider === "zml" || provider === "zml-image" || provider === "zml-relay") return "zml-image";
  if (provider === "doubao" || provider === "doubao-seedream") return "doubao-seedream";
  if (provider === "relay" || provider === "relay-image" || provider === "openai-compatible") return "openai-compatible-image";
  return "mock-image";
}

function currentImageProviderName(provider: string) {
  if (provider === "dashscope" || provider === "dashscope-image") return "DashScope / Qwen Image";
  if (provider === "zml" || provider === "zml-image" || provider === "zml-relay") return "ZML Image Relay";
  if (provider === "doubao" || provider === "doubao-seedream") return "Doubao Seedream Image";
  if (provider === "openai-compatible" || provider === "relay" || provider === "relay-image") return "OpenAI-compatible Image Relay";
  return "Mock Image Adapter";
}

function currentImageModelName(provider: string, selectedModel?: string) {
  if (provider === "dashscope" || provider === "dashscope-image") return selectedModel || process.env.DASHSCOPE_IMAGE_MODEL || "qwen-image";
  if (provider === "zml" || provider === "zml-image" || provider === "zml-relay") return selectedModel || process.env.ZML_IMAGE_MODEL || "gpt-image-2";
  if (provider === "doubao" || provider === "doubao-seedream") return selectedModel || process.env.DOUBAO_SEEDREAM_MODEL || "doubao-seedream-5-0-lite-260128";
  if (provider === "openai-compatible" || provider === "relay" || provider === "relay-image") return selectedModel || process.env.OPENAI_IMAGE_MODEL || "openai-compatible-image";
  return "mock-image-v1";
}

function imageBatchLimit(total: number, provider: string) {
  if (["dashscope", "dashscope-image", "zml", "zml-image", "zml-relay", "doubao", "doubao-seedream", "openai-compatible", "relay", "relay-image"].includes(provider)) {
    return Math.max(1, Math.min(total, Number(process.env.IMAGE_BATCH_LIMIT ?? 1)));
  }
  return total;
}

function characterImageBatchLimit(total: number, provider: string) {
  if (["dashscope", "dashscope-image", "zml", "zml-image", "zml-relay", "doubao", "doubao-seedream", "openai-compatible", "relay", "relay-image"].includes(provider)) {
    return Math.max(1, Math.min(total, Number(process.env.CHARACTER_IMAGE_BATCH_LIMIT ?? 3)));
  }
  return total;
}

function imageCreditPerShot(provider: string) {
  if (provider === "dashscope" || provider === "dashscope-image") return 8;
  if (provider === "zml" || provider === "zml-image" || provider === "zml-relay") return 28;
  if (provider === "doubao" || provider === "doubao-seedream") return 8;
  if (provider === "openai-compatible" || provider === "relay" || provider === "relay-image") return 30;
  return 5;
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
    item.type === "role_derivative" &&
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
