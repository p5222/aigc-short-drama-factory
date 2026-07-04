import type { CreateProjectInput, CreationEstimate, Project, StoryboardShot } from "@aifilm/shared";
import { estimateImageCredits, imageParameterMultiplier, normalizeImageOutputQuality, normalizeImageOutputSize } from "@aifilm/shared";

export function estimateCreation(input: Pick<CreateProjectInput, "content" | "mode" | "targetEpisodes"> & Partial<Pick<CreateProjectInput, "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">> & { pricing?: Array<{ providerId?: string; model: string; modality: string; unitCredits: number; enabled?: boolean }> }): CreationEstimate {
  const words = input.content.trim().length;
  const maxEpisodes = Math.max(1, Math.min(20, Math.ceil(Math.max(words, 800) / 2000)));
  const suggestedEpisodes = Math.max(1, Math.min(maxEpisodes, input.targetEpisodes ?? maxEpisodes));
  const base = input.mode === "twenty_five_grid" ? 80 : input.mode === "director" ? 140 : 50;
  const shotsPerEpisode = input.mode === "twenty_five_grid" ? 25 : input.mode === "director" ? 16 : 9;
  const totalShots = suggestedEpisodes * shotsPerEpisode;
  const textUnitCredits = resolveUnitCredits(input.pricing, "text", input.textProvider, input.textModel, base);
  const imageSize = normalizeImageOutputSize(input.imageSize);
  const imageQuality = normalizeImageOutputQuality(input.imageQuality);
  const imageBaseUnitCredits = resolveUnitCredits(input.pricing, "image", input.imageProvider, input.imageModel, input.mode === "twenty_five_grid" ? 12 : 8);
  const imageUnitCredits = estimateImageCredits(imageBaseUnitCredits, imageSize, imageQuality);
  const videoUnitCredits = resolveUnitCredits(input.pricing, "video", input.videoProvider, input.videoModel, 0);
  const textTotal = suggestedEpisodes * textUnitCredits;
  const imageTotal = totalShots * imageUnitCredits;
  const includeVideo = videoUnitCredits > 0;
  const videoSecondsPerShot = 4;
  const videoTotal = includeVideo ? totalShots * videoSecondsPerShot * videoUnitCredits : 0;
  const estimatedCredits = textTotal + imageTotal + videoTotal;

  return {
    words,
    suggestedEpisodes,
    estimatedCredits,
    mode: input.mode,
    notes: [
      "每 2,000 字约估算为 1 集，短脑洞按 1 集计算。",
      `当前可生成上限为 ${maxEpisodes} 集，本次选择 ${suggestedEpisodes} 集。`,
      `预计拆为 ${totalShots} 个镜头。文本、分镜图和视频会按右侧当前选择的模型价格表估算。`,
      `生图参数按 ${imageSize} / ${imageQuality} 估算，参数倍率 ${imageParameterMultiplier(imageSize, imageQuality).toFixed(2)}，基准单价 ${imageBaseUnitCredits} 积分。`,
      includeVideo ? "视频按每镜头约 4 秒预估；真实扣费以任务完成后的供应商返回和后台价格策略为准。" : "当前视频模型未配置启用价格，暂不计入视频预估；后续生成视频时会按后台价格策略单独扣费。"
    ],
    breakdown: [
      {
        label: "剧本解析与分镜拆解",
        providerId: input.textProvider,
        model: input.textModel,
        quantity: suggestedEpisodes,
        unitCredits: textUnitCredits,
        totalCredits: textTotal,
        hint: "按选择集数计费，包含全局设定、剧本整理、角色卡与分镜拆解。"
      },
      {
        label: "分镜图首帧",
        providerId: input.imageProvider,
        model: input.imageModel,
        quantity: totalShots,
        unitCredits: imageUnitCredits,
        totalCredits: imageTotal,
        hint: `按镜头数预估。当前参数 ${imageSize} / ${imageQuality}，基准 ${imageBaseUnitCredits} 积分，最终单价按参数倍率取整。`
      },
      ...(includeVideo
        ? [{
            label: "图生视频片段",
            providerId: input.videoProvider,
            model: input.videoModel,
            quantity: totalShots * videoSecondsPerShot,
            unitCredits: videoUnitCredits,
            totalCredits: videoTotal,
            hint: "按秒预估。每个镜头以确认后的分镜图作为首帧生成短片段。"
          }]
        : [])
    ],
    assumptions: {
      shotsPerEpisode,
      totalShots,
      videoSecondsPerShot,
      includeVideo
    }
  };
}

function resolveUnitCredits(
  pricing: Array<{ providerId?: string; model: string; modality: string; unitCredits: number; enabled?: boolean }> | undefined,
  modality: string,
  providerId: string | undefined,
  model: string | undefined,
  fallback: number
) {
  const rows = (pricing ?? []).filter((item) => item.modality === modality && item.enabled !== false);
  const exact = rows.find((item) => item.providerId === providerId && item.model === model);
  const byModel = rows.find((item) => item.model === model);
  const byProvider = rows.find((item) => item.providerId === providerId);
  return Math.max(0, Math.floor(exact?.unitCredits ?? byModel?.unitCredits ?? byProvider?.unitCredits ?? fallback));
}

export function createProjectFromInput(input: CreateProjectInput): Project {
  const estimate = estimateCreation(input);
  return {
    id: `proj_${Date.now()}`,
    name: input.title || "未命名作品",
    type: input.genre,
    intro: input.content.slice(0, 80) || "由创作向导创建的 AIGC 短剧项目。",
    sourceType: input.sourceType,
    artStyle: input.artStyle,
    videoRatio: input.videoRatio,
    textProvider: input.textProvider,
    textModel: input.textModel,
    imageProvider: input.imageProvider,
    imageModel: input.imageModel,
    imageSize: normalizeImageOutputSize(input.imageSize),
    imageQuality: normalizeImageOutputQuality(input.imageQuality),
    videoProvider: input.videoProvider,
    videoModel: input.videoModel,
    status: "planning",
    episodes: estimate.suggestedEpisodes,
    storyboards: 0,
    characters: 0,
    imageAssets: 0,
    videoClips: 0,
    creditsSpent: 0,
    updatedAt: new Date().toISOString()
  };
}

export function buildDemoStoryboard(projectId: string): StoryboardShot[] {
  return [
    {
      id: `shot_${projectId}_001`,
      projectId,
      episodeNo: 1,
      sceneNo: 1,
      shotNo: 1,
      duration: 5,
      shotSize: "中景",
      cameraAngle: "平视",
      cameraMovement: "缓慢推进",
      characters: ["主角", "对手"],
      scene: "城市天台",
      pictureDesc: "主角站在风里回头，对手从阴影中走出。",
      dialogue: "这一次，我不会再退。",
      voiceOver: "",
      environmentSound: "风声",
      soundEffect: "衣角被风吹动",
      imagePrompt: "城市天台，夜色，主角回头，强情绪，国漫写实",
      videoPrompt: "首帧图生视频，镜头缓慢推进，风吹衣角，人物轻微呼吸",
      referenceAssetIds: ["role_main", "role_rival", "scene_rooftop"],
      status: "pending",
      action: "主角回头，对手向前一步",
      orientation: "主角-3/4正面朝右；对手-3/4正面朝左",
      spatialRelation: "主角(左前)、对手(右后)",
      emotion: "压抑对峙"
    }
  ];
}
