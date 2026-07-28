import type { AssetItem, CharacterProfile, ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import { renderProfiledVideoPrompt } from "../production/storyboardProfiles.js";

type AssetLookup = Map<string, Pick<AssetItem, "id" | "name" | "type" | "description" | "prompt" | "referenceUrl" | "relatedCharacterId">>;

const imageQualityGuard = [
  "4K ultra-high-definition",
  "clean and noise-free",
  "stable composition",
  "sharp and well-defined subject",
  "no blur or distortion",
  "no pixel corruption"
].join(", ");

const fixedVisualAvoid = [
  "不要生成字幕、对白气泡、标题字、解释字、UI 标签、水印或 Logo",
  "不要新增无关人物",
  "不要换脸、换发型、换服装主色",
  "不要出现畸形手、多余手指、肢体断裂、同款分身"
].join("；");

export interface StoryboardProductionPackage {
  version: "v1" | "v2" | "v3";
  meaning: string;
  goals: string[];
  workflow: string[];
  v1: {
    characterIdentity: string[];
    storyboardPromptRules: string[];
    seedancePromptRules: string[];
    selfCheck: string[];
  };
  v2: {
    sceneCards: SceneCard[];
    shotVersionPolicy: string[];
    qualityGates: QualityGate[];
    selfCheck: string[];
  };
  v3: {
    promptVersioning: string[];
    autoRepair: AutoRepairRule[];
    dataFlywheel: string[];
    selfCheck: string[];
  };
  projectSnapshot: {
    characters: number;
    roleIdentityBoards: number;
    sceneCards: number;
    shots: number;
    storyboardImages: number;
    videoClips: number;
  };
}

export interface SceneCard {
  id: string;
  name: string;
  description: string;
  prompt: string;
  referenceUrl?: string;
  shots: number;
  lockedAnchors: string[];
}

export interface QualityGate {
  stage: string;
  threshold: number;
  checks: string[];
  blockReason: string;
}

export interface AutoRepairRule {
  trigger: string;
  action: string;
  fallback: string;
}

export function buildCharacterIdentityBoardPrompt(input: {
  character: CharacterProfile;
  projectArtStyle: string;
  basePrompt: string;
  referenceUrl?: string;
  assetName?: string;
}) {
  const referenceInstruction = input.referenceUrl
    ? "Use the provided image as the identity source. First extract the visual signature: face shape, eye spacing, nose, mouth, hairstyle, hair color, outfit silhouette, outfit colors, posture language and age impression; then preserve that exact same identity across every panel."
    : "Create the identity from the character card only, then keep the same face, hairstyle, outfit colors, body proportions and posture language across every panel.";

  return [
    input.assetName ? `Only create the character identity board for "${input.assetName}".` : "",
    referenceInstruction,
    input.basePrompt,
    `Project art direction: ${input.projectArtStyle}.`,
    "One production character identity board in a single 16:9 image.",
    "Exactly four clean panels from left to right: front full-body view, 3/4 side full-body view, back full-body view, close-up headshot portrait.",
    "All four panels show the same character identity, same face, same hairstyle, same outfit palette, same age impression and same body proportions.",
    "Neutral pose, clean warm-white studio background, production-ready reference sheet for storyboard image generation and image-to-video.",
    "No text, no labels, no watermark, no extra people, no costume redesign, no face drift.",
    imageQualityGuard
  ].filter(Boolean).join(", ");
}

export function buildStoryboardFirstFramePrompt(input: {
  workflow: ProjectWorkflow;
  shot: StoryboardShot;
  assetById?: AssetLookup;
}) {
  const assetById = input.assetById ?? new Map(input.workflow.assets.map((asset) => [asset.id, asset]));
  const references = resolveStoryboardReferenceAssets(input.workflow, input.shot, assetById);
  const roleRefs = references.filter((asset) => asset.type === "role" || asset.type === "role_derivative");
  const sceneRefs = references.filter((asset) => asset.type === "scene" || asset.type === "prop");
  const blocking = describeShotBlocking(input.shot);
  return [
    "Generate a video-model-ready director storyboard first frame, not a finished comic panel.",
    roleRefs.length ? `Character identity references: ${roleRefs.map(referenceLabel).join("; ")}. Preserve the exact same face, hairstyle, outfit colors, body proportions and posture language.` : "Use the locked character card traits; do not invent new character appearance.",
    sceneRefs.length ? `Scene and prop references: ${sceneRefs.map(referenceLabel).join("; ")}. Preserve location, lighting direction, spatial anchors and key props.` : `Scene: ${input.shot.scene}.`,
    `Project style: ${input.workflow.project.artStyle}; target ratio: ${input.workflow.project.videoRatio}.`,
    `Camera: ${input.shot.shotSize}, ${input.shot.cameraAngle}, ${input.shot.cameraMovement || "stable camera"}.`,
    `Blocking: ${blocking}.`,
    `Original shot image prompt: ${input.shot.imagePrompt || input.shot.pictureDesc}.`,
    `Visible action: ${input.shot.action || input.shot.pictureDesc}.`,
    `Emotion: ${input.shot.emotion || "controlled dramatic expression"}.`,
    `First-frame requirement: clear composition, complete subject, readable action starting point, suitable as image-to-video first frame.`,
    `Avoid: ${fixedVisualAvoid}.`,
    imageQualityGuard
  ].join("\n");
}

export function buildSeedanceVideoPrompt(input: {
  workflow: ProjectWorkflow;
  shot: StoryboardShot;
  firstFrameAsset?: Pick<AssetItem, "name" | "referenceUrl" | "description">;
  assetById?: AssetLookup;
}) {
  const assetById = input.assetById ?? new Map(input.workflow.assets.map((asset) => [asset.id, asset]));
  const references = resolveStoryboardReferenceAssets(input.workflow, input.shot, assetById);
  const blocking = describeShotBlocking(input.shot);
  const firstAnchor = buildFirstFrameAnchor(input.shot, input.firstFrameAsset);
  const lastAnchor = buildLastFrameAnchor(input.shot);
  const handoff = buildContinuityHandoff(input.shot);
  return renderProfiledVideoPrompt({
    profile: input.workflow.project.segmentProfile ?? "jimeng_15s",
    shot: { ...input.shot, referenceAssetIds: references.map((asset) => asset.id) },
    previousEndState: handoff,
    firstFramePrompt: `${firstAnchor}；站位：${blocking}`,
    lastFramePrompt: lastAnchor
  });
}

export function createSceneCards(workflow: ProjectWorkflow): SceneCard[] {
  const sceneAssets = workflow.assets.filter((asset) => asset.type === "scene" || asset.type === "prop");
  const sceneGroups = new Map<string, StoryboardShot[]>();
  for (const shot of workflow.storyboards) {
    const key = normalizeSceneName(shot.scene);
    sceneGroups.set(key, [...(sceneGroups.get(key) ?? []), shot]);
  }
  return [...sceneGroups.entries()].map(([sceneName, shots], index) => {
    const relatedAsset = sceneAssets.find((asset) => sceneName.includes(normalizeSceneName(asset.name)) || normalizeSceneName(asset.name).includes(sceneName));
    const anchors = Array.from(new Set(shots.flatMap((shot) => [
      shot.spatialRelation,
      shot.orientation,
      shot.environmentSound,
      shot.soundEffect
    ].filter((item): item is string => Boolean(item))))).slice(0, 4);
    return {
      id: relatedAsset?.id ?? `scene_card_${index + 1}`,
      name: relatedAsset?.name ?? (sceneName || `场景 ${index + 1}`),
      description: relatedAsset?.description ?? shots[0]?.scene ?? "待锁定场景",
      prompt: relatedAsset?.prompt ?? buildSceneCardPrompt(sceneName, shots),
      referenceUrl: relatedAsset?.referenceUrl,
      shots: shots.length,
      lockedAnchors: anchors.length ? anchors : ["空间方向", "主光线", "关键道具", "声音环境"]
    };
  });
}

export function createStoryboardProductionPackage(workflow: ProjectWorkflow): StoryboardProductionPackage {
  const roleIdentityBoards = workflow.assets.filter((asset) =>
    asset.type === "role_derivative" &&
    Boolean(asset.referenceUrl) &&
    /identity|turnaround|三视图|身份板|多视图|大头照/i.test(`${asset.id} ${asset.name} ${asset.description}`)
  );
  const sceneCards = createSceneCards(workflow);
  const storyboardImages = workflow.assets.filter((asset) => asset.type === "image" && asset.referenceUrl);
  const videoClips = workflow.assets.filter((asset) => asset.type === "video" && asset.referenceUrl);
  return {
    version: "v3",
    meaning: "把角色一致性、故事板首帧和图生视频从一次性生成，升级为可检查、可重生、可评测、可沉淀数据的生产模块。",
    goals: [
      "先锁定角色身份，减少后续分镜图和视频的换脸、换装、五官漂移。",
      "让故事板只负责构图、站位和首帧锚定，避免密集噪点限制视频模型表现。",
      "让 Seedance 视频生成拿到首帧、主动作、尾帧和连续性交接，保证短片段可剪辑。",
      "把失败原因、用户选择和评测结果沉淀为下一轮提示词优化依据。"
    ],
    workflow: [
      "剧本/角色卡确认",
      "角色身份板：正面全身、3/4 侧面、背面、大头照",
      "场景卡：地点、光线、空间锚点、关键道具",
      "分镜拆解：镜头表、站位、首尾帧锚点",
      "Image2/生图模型生成故事板首帧",
      "Seedance/视频模型图生视频",
      "质量评测、重生、选定、配音字幕、合成导出"
    ],
    v1: {
      characterIdentity: [
        "AI 角色：根据角色卡生成四格身份板。",
        "上传角色：先把上传图当身份源图，提示词要求抽取视觉签名后生成身份板。",
        "分镜和视频阶段只引用角色资产，不重新描述外貌。"
      ],
      storyboardPromptRules: [
        "故事板图只生成视觉首帧，不让图片模型渲染长中文说明、表格、CAM 标签。",
        "提示词必须包含角色参考、场景参考、镜头语言、站位、主动作、避免项。",
        "首帧必须适合图生视频：主体完整、动作起点明确、构图清楚。"
      ],
      seedancePromptRules: [
        "每段优先一个微节拍，时长 6-12 秒，最多 15 秒。",
        "必须包含首帧锚点、尾帧锚点和连续性交接。",
        "统一禁止字幕、水印、标题字、解释字，防止视频污染。"
      ],
      selfCheck: [
        roleIdentityBoards.length >= Math.max(1, workflow.characters.length) ? "角色身份板数量满足当前角色数。" : "角色身份板不足，应先补齐角色定稿。",
        workflow.storyboards.every((shot) => shot.imagePrompt && shot.videoPrompt) ? "每个镜头都有图片和视频提示词。" : "存在缺少提示词的镜头。",
        storyboardImages.length ? "已有故事板/首帧资产，可进入视频生成。" : "尚未生成分镜图首帧。"
      ]
    },
    v2: {
      sceneCards,
      shotVersionPolicy: [
        "每个镜头允许保留多张候选图和多个视频草稿，当前版本用资产 ID 约定 image_<shotId> 与 video_<shotId> 选定最终版。",
        "后续正式多版本表应记录 prompt、referenceAssetIds、provider、model、qualityScore、selectedAt。",
        "中长剧按场景/视频段分批生成，避免一次性生成整集导致成本和一致性失控。"
      ],
      qualityGates: [
        {
          stage: "character",
          threshold: 80,
          checks: ["身份板是否存在", "脸/发型/服装主色是否稳定", "上传参考是否被遵循", "负面提示词是否完整"],
          blockReason: "角色未定稿会阻止批量分镜图，避免后续废图。"
        },
        {
          stage: "image",
          threshold: 80,
          checks: ["是否有真实图片 URL", "是否符合画幅", "角色是否一致", "是否可做视频首帧", "是否无字幕水印"],
          blockReason: "首帧不合格会增加视频漂移和不可剪辑风险。"
        },
        {
          stage: "video",
          threshold: 70,
          checks: ["首帧是否继承", "人物身份是否稳定", "动作是否符合提示词", "是否可剪辑", "是否无明显变形闪烁"],
          blockReason: "视频不可剪辑时应重生片段或回退首帧。"
        }
      ],
      selfCheck: [
        sceneCards.length ? `已识别 ${sceneCards.length} 张场景卡候选。` : "尚未形成场景卡，适合先由分镜场景自动生成。",
        workflow.qualityReports?.length ? "项目已有质量评测记录，可用于门槛判断。" : "尚未生成质量评测，建议跑一次评测。",
        "镜头级重生已接入现有 image_<shotId> / video_<shotId> 资产链路。"
      ]
    },
    v3: {
      promptVersioning: [
        "角色身份板、故事板首帧、Seedance 视频提示词应进入 PromptTemplate/PromptVersion 管理。",
        "每次提示词升级记录版本号、适用模型、成功率、典型失败和回滚方案。",
        "后台可做 A/B 灰度：低成本草稿模型先跑，选中镜头再高质量生成。"
      ],
      autoRepair: [
        {
          trigger: "角色评测低于 80 或反馈为脸部漂移",
          action: "重新生成角色身份板并更新该角色引用资产",
          fallback: "要求用户上传更清晰正面参考图"
        },
        {
          trigger: "分镜图有字幕/水印/构图不可用",
          action: "追加避免项并重生本镜头首帧",
          fallback: "切换生图模型或降低画面复杂度"
        },
        {
          trigger: "视频动作漂移、人物变形或不可剪辑",
          action: "缩短时长，强化首尾帧锚点后重生视频",
          fallback: "回退重生首帧或切换视频模型"
        }
      ],
      dataFlywheel: [
        "用户选中/废弃/重生原因写入反馈，转成评测数据集。",
        "模型、提示词、积分、失败原因进入后台质量看板，支持成本和质量共同优化。",
        "把高分镜头沉淀为样例，低分镜头沉淀为负例，持续优化系统提示词。"
      ],
      selfCheck: [
        "PromptTemplate 已支持后台模板，V3 可继续加版本/实验维度。",
        "Feedback 和 EvaluationDataset 已存在，可承接数据闭环。",
        "任务、资产、质量报告已有关联字段，可追踪模型质量和成本。"
      ]
    },
    projectSnapshot: {
      characters: workflow.characters.length,
      roleIdentityBoards: roleIdentityBoards.length,
      sceneCards: sceneCards.length,
      shots: workflow.storyboards.length,
      storyboardImages: storyboardImages.length,
      videoClips: videoClips.length
    }
  };
}

export function summarizeProductionSelfCheck(pkg: StoryboardProductionPackage) {
  return [
    ...pkg.v1.selfCheck.map((item) => `V1：${item}`),
    ...pkg.v2.selfCheck.map((item) => `V2：${item}`),
    ...pkg.v3.selfCheck.map((item) => `V3：${item}`)
  ];
}

function referencedAssets(shot: StoryboardShot, assetById: AssetLookup) {
  return shot.referenceAssetIds
    .map((assetId) => assetById.get(assetId))
    .filter((asset): asset is NonNullable<ReturnType<AssetLookup["get"]>> => Boolean(asset?.referenceUrl || asset?.prompt || asset?.description));
}

export function resolveStoryboardReferenceAssets(workflow: ProjectWorkflow, shot: StoryboardShot, assetById = new Map(workflow.assets.map((asset) => [asset.id, asset])) as AssetLookup) {
  const references = referencedAssets(shot, assetById);
  const normalized = (value: string) => value.replace(/身份板|角色|关键场景|主场景|场景[:：]?/g, "").replace(/\s+/g, "").toLowerCase();
  const add = (asset: AssetItem | undefined) => {
    if (asset && !references.some((item) => item.id === asset.id)) references.push(asset);
  };
  for (const name of shot.characters ?? []) {
    const character = workflow.characters.find((item) => normalized(name).includes(normalized(item.name)) || normalized(item.name).includes(normalized(name)));
    if (!character) continue;
    const candidates = workflow.assets.filter((asset) => asset.relatedCharacterId === character.id && (asset.type === "role" || asset.type === "role_derivative"));
    add(candidates.find((asset) => asset.id === character.referenceAssetId && asset.referenceUrl) ?? candidates.find((asset) => asset.referenceUrl));
  }
  const sceneName = normalized(shot.scene ?? "");
  const scene = workflow.assets
    .filter((asset) => asset.type === "scene" || asset.type === "prop")
    .find((asset) => sceneName.includes(normalized(asset.name)) || normalized(asset.name).includes(sceneName));
  add(scene);
  return references;
}

function referenceLabel(asset: Pick<AssetItem, "name" | "type" | "referenceUrl">) {
  return `${asset.name}(${asset.type}${asset.referenceUrl ? ", has reference image" : ""})`;
}

function describeShotBlocking(shot: StoryboardShot) {
  if (shot.orientation || shot.spatialRelation) {
    return [shot.orientation, shot.spatialRelation].filter(Boolean).join("；");
  }
  if (shot.characters.length > 1) {
    const [left, right, center] = shot.characters;
    return `${left} at screen-left foreground, ${right} at screen-right midground${center ? `, ${center} near center background` : ""}; maintain the 180-degree axis.`;
  }
  const subject = shot.characters[0] || "main subject";
  return `${subject} at center midground; important prop or scene anchor remains visible in background.`;
}

function buildFirstFrameAnchor(shot: StoryboardShot, firstFrameAsset?: Pick<AssetItem, "name" | "description">) {
  const subject = shot.characters[0] || "主体";
  return [
    firstFrameAsset ? `沿用首帧资产 ${firstFrameAsset.name}` : "",
    `${subject} 保持 ${shot.shotSize || "中景"} 构图`,
    `${shot.scene} 中的空间方向不改变`,
    shot.orientation || shot.spatialRelation || "人物位于画面稳定位置，身体朝向镜头轴线",
    shot.emotion ? `情绪为 ${shot.emotion}` : ""
  ].filter(Boolean).join("；");
}

function buildLastFrameAnchor(shot: StoryboardShot) {
  const subject = shot.characters[0] || "主体";
  return [
    `${subject} 保持同一服装、发型和身份`,
    `${shot.action || shot.pictureDesc} 的动作到达自然停点`,
    shot.cameraMovement ? `镜头运动停在 ${shot.cameraMovement} 的末端` : "镜头保持稳定构图",
    "道具归属和人物站位不互换"
  ].join("；");
}

function buildContinuityHandoff(shot: StoryboardShot) {
  return [
    `下一段继承场景 ${shot.scene}`,
    shot.characters.length ? `继承角色：${shot.characters.join("、")}` : "",
    shot.spatialRelation || shot.orientation || "继承当前画面方向和人物左右关系",
    shot.soundEffect || shot.environmentSound ? `声音延续：${[shot.environmentSound, shot.soundEffect].filter(Boolean).join("、")}` : ""
  ].filter(Boolean).join("；");
}

function normalizeSceneName(value: string) {
  return (value || "未命名场景")
    .replace(/\s+/g, "")
    .replace(/[，。；：:,.]/g, "")
    .slice(0, 24);
}

function buildSceneCardPrompt(sceneName: string, shots: StoryboardShot[]) {
  const props = Array.from(new Set(shots.flatMap((shot) => [shot.soundEffect, shot.spatialRelation, shot.pictureDesc].filter(Boolean)))).slice(0, 3);
  return [
    `场景卡：${sceneName}`,
    `锁定地点、时代、光线、空间方向和关键道具。`,
    props.length ? `关键锚点：${props.join("；")}` : "",
    "用于中长剧分镜图和图生视频保持环境一致。"
  ].filter(Boolean).join("\n");
}
