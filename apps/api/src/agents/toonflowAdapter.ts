import type { CharacterProfile, CreateProjectInput, ScriptDraft } from "@aifilm/shared";

export interface ToonflowCharacterCard {
  name: string;
  identity: string;
  appearance: string;
  costume: string;
  personality: string;
  voice?: string;
}

export interface ToonflowStoryboardShot {
  episodeNo?: number;
  sceneNo: number;
  shotNo: number;
  duration: number;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  characters: string[];
  scene: string;
  pictureDesc: string;
  action: string;
  orientation: string;
  spatialRelation: string;
  dialogue: string;
  voiceOver: string;
  environmentSound: string;
  soundEffect: string;
  emotion: string;
  imagePrompt: string;
  videoPrompt: string;
}

export interface ToonflowScriptPlan {
  source: "Toonflow-app inspired adapter";
  workflow: string[];
  prompt: string;
  requiredJsonShape: Record<string, unknown>;
}

export interface ToonflowStoryboardPlan {
  source: "Toonflow-app inspired adapter";
  workflow: string[];
  prompt: string;
  requiredJsonShape: Record<string, unknown>;
}

export interface ScriptShotPlan {
  episodeNo: number;
  sceneCount: number;
  dialogueUnits: number;
  actionUnits: number;
  suggestedShots: number;
  estimatedSeconds: number;
}

const toonflowWorkflow = [
  "策划 Agent：先确定题材、看点、分集目标、角色弧光和结尾钩子",
  "编剧 Agent：把用户输入扩展为可拍摄的分集剧本，保留动作、台词、旁白和情绪节奏",
  "分镜 Agent：按独立动作单元拆镜，绑定角色、场景、道具和视听提示词",
  "资产 Agent：先锁角色多视图与场景参考，再生成分镜图和图生视频"
];

const shotBreakdownRules = [
  "一个镜头只承载一个独立动作、一个情绪变化或一个可见信息点",
  "禁止把站起、走近、说话、反应合并到同一镜头",
  "台词进入分镜后不能改写顺序；长台词拆到相邻镜头",
  "角色只能来自已锁定角色卡；外貌、服装、配饰不能在分镜里重新发明",
  "每个镜头必须写清景别、机位、运镜、动作结果、左右站位和画面目的",
  "图片提示词聚焦首帧静态画面，视频提示词聚焦从首帧延展出的动作和结束姿态"
];

export function createToonflowScriptPlan(input: CreateProjectInput): ToonflowScriptPlan {
  const targetEpisodes = input.targetEpisodes ?? 1;
  const isScriptSource = input.sourceType === "script";
  const sourceInstruction = isScriptSource
    ? [
        "用户输入是已经完成的剧本。禁止改编、续写或重新创作；script 必须完整保留原剧本正文。",
        "你的任务只是结构化拆解：识别分集、场次、角色及其可见特征，为后续资产和分镜生产提供依据。",
        "若原稿缺少显式场次标题，应根据地点/时间变化划分场次，但不得补造剧情。"
      ]
    : [
        "用户输入是小说、短篇故事或创意素材，必须先转换成可拍摄的分集剧本，再提取角色卡。",
        "小说转剧本必须遵循内置 novel_to_script 规则：原文是事实唯一来源，叙述可转成可见动作，但不得新增人物、事件、地点或关系。",
        "script 必须是转换后的完整剧本，不能直接复制小说叙述，也不能只返回摘要。"
      ];
  const prompt = [
    "你是 AI 漫剧平台“漫角”的编剧 Agent，参考 Toonflow-app 的“策划-编剧-分镜-资产”流水线工作。",
    "当前只做策划、分集剧本和角色卡，不生成分镜。",
    ...sourceInstruction,
    "",
    "输出必须是合法 JSON 对象，顶层字段只能包含 synopsis, script, characters。",
    "synopsis：100-220 字，说明主线冲突、人物关系、视觉风格和每集推进目标。",
    `script：生成 ${targetEpisodes} 集，使用“第1集/第2集”标题。每集包含：开场画面、剧情节拍、动作、台词、旁白、情绪节奏、结尾钩子。`,
    "characters：2-6 个角色，每个角色包含 name, identity, appearance, costume, personality, voice。",
    "",
    "编剧约束：",
    "1. 每集必须有明确冲突和结尾钩子，适合后续拆成 9-25 个镜头。",
    "2. 角色卡必须稳定到可生图：脸型/发型/服装主色/配饰/气质都要具体。",
    "3. 不要在剧本里塞太多抽象设定，尽量转换为可见动作、道具和场景。",
    "4. 台词要短、带冲突，不要写长篇解释。",
    "",
    `作品名称：${input.title}`,
    `输入类型：${input.sourceType}`,
    `题材：${input.genre || "自动判断"}`,
    `目标集数：${targetEpisodes}`,
    `画幅：${input.videoRatio}`,
    `画风：${input.artStyle || "自动匹配"}`,
    `用户原文：${input.content || "用户只给了空白脑洞，请生成适合短剧第一集的故事。"}`,
    "",
    "JSON 示例结构：",
    JSON.stringify(
      {
        synopsis: "故事梗概...",
        script: "第1集 ...",
        characters: [
          {
            name: "角色名",
            identity: "主角/对手/关系角色",
            appearance: "稳定五官、发型、年龄感",
            costume: "服装主色、材质、配饰",
            personality: "动机、性格、表达方式",
            voice: "建议音色"
          }
        ]
      },
      null,
      2
    )
  ].join("\n");

  return {
    source: "Toonflow-app inspired adapter",
    workflow: toonflowWorkflow,
    prompt,
    requiredJsonShape: {
      synopsis: "string",
      script: "string",
      characters: ["name", "identity", "appearance", "costume", "personality", "voice"]
    }
  };
}

export function createToonflowStoryboardPlan(
  input: CreateProjectInput,
  script: Pick<ScriptDraft, "synopsis" | "content">,
  characters: ToonflowCharacterCard[] | CharacterProfile[]
): ToonflowStoryboardPlan {
  const shotPlan = analyzeScriptShotPlan(script.content, input.targetEpisodes);
  const totalShots = shotPlan.reduce((sum, episode) => sum + episode.suggestedShots, 0);
  const characterCards = characters.map(formatCharacterCard).join("\n");
  const shotPlanText = shotPlan.map((episode) =>
    `第${episode.episodeNo}集：${episode.sceneCount} 场，${episode.dialogueUnits} 个对白单元，${episode.actionUnits} 个动作单元，建议 ${episode.suggestedShots} 镜，约 ${episode.estimatedSeconds} 秒。`
  ).join("\n");
  const prompt = [
    "你是 AI 漫剧平台“漫角”的分镜 Agent，参考 Toonflow-app 的智能分镜思想和 LingGuo-Drama 的动作单元拆镜标准。",
    "你要把已确认剧本拆成镜头级生产数据。剧本已经确认，角色卡已经锁定，不能重新改写故事。",
    "",
    "输出必须是合法 JSON 对象，顶层字段只能包含 storyboards。",
    `剧本分析后的镜头计划合计约 ${totalShots} 镜。镜头数不是预设密度，必须服从真实场次、对白、动作和节奏。`,
    "允许每集相对建议值上下浮动 2 镜；不得为了凑数拆出无叙事作用的空镜，也不得把多个独立动作硬塞进同一镜头。",
    `逐集镜头计划：\n${shotPlanText}`,
    "每条必须包含：episodeNo, sceneNo, shotNo, duration, shotSize, cameraAngle, cameraMovement, characters, scene, pictureDesc, action, orientation, spatialRelation, dialogue, voiceOver, environmentSound, soundEffect, emotion, imagePrompt, videoPrompt。",
    "五维度分镜检查：1)叙事功能与本镜目的；2)角色表演与情绪变化；3)空间站位、视线和动作路径；4)摄影构图、光线、声音与节奏；5)连续性、首帧锚点、尾帧状态和可生产性。五项都要落到可见或可听字段，不得只写抽象形容词。",
    "每镜只承载一个主动作；重要动作独立成镜；对白原文保留；同一角色/场景/道具使用稳定名称和引用，禁止为了画面好看擅自换脸、换装、换环境或新增人物。",
    "导演增强：每条镜头必须能推导焦距和 FOV。默认焦距：建立/空间重置 24mm；行走/双人移动 35mm；对白中近景 50mm；情绪近景 85mm；道具/手部/机关 100mm。",
    "spatialRelation 必须写 screen-left/center/screen-right + foreground/midground/background；orientation 必须写视线方向、身体朝向、180度轴线、首帧锚点和尾帧锚点。",
    "videoPrompt 使用 Seedance 2.0 生产结构：首帧锚点、镜头焦距/FOV、人物站位、主动作、声音、尾帧锚点、避免项。避免项固定包含不要生成对白字幕、标题字、解释字、水印；对白只作为角色语音出现；不要站位互换；不要越轴。",
    "",
    "分镜拆解规则：",
    ...shotBreakdownRules.map((rule, index) => `${index + 1}. ${rule}`),
    "",
    "字段写法：",
    "scene：地点+时间+光线，例如“雨夜街口，霓虹反光”。",
    "pictureDesc：给创作者看的中文画面描述，必须说明主体、动作、情绪、空间和剧情作用。",
    "action：谁做了什么，动作前后要能承接。",
    "orientation/spatialRelation：多人同框必须写清左/右、前/后、朝向、远近。",
    "orientation/spatialRelation 进阶：使用 screen-left/center/screen-right、foreground/midground/background、视线方向、身体朝向、首尾帧锚点，方便生成 SVG 人物站位 + CAM + FOV。",
    "dialogue/voiceOver：从剧本提取，尽量保留原句；无则空字符串。",
    "imagePrompt：首帧静态图提示词，聚焦角色名、场景、动作初态、构图、光线、画风；禁止字幕、水印、对话框。",
    "videoPrompt：视频延展提示词，写主体运动、运镜、情绪变化和结束姿态；必须包含焦距/FOV、首帧锚点、尾帧锚点、避免项；不要堆无用参数。",
    "",
    `画幅：${input.videoRatio}`,
    `画风：${input.artStyle || "自动匹配"}`,
    `分镜模式：${input.mode}`,
    `剧情梗概：${script.synopsis}`,
    `已确认剧本：${script.content}`,
    `已锁定角色卡：\n${characterCards}`,
    "",
    "JSON 示例结构：",
    JSON.stringify(
      {
        storyboards: [
          {
            episodeNo: 1,
            sceneNo: 1,
            shotNo: 1,
            duration: 5,
            shotSize: "中景",
            cameraAngle: "平视",
            cameraMovement: "缓慢推进",
            characters: ["角色名"],
            scene: "地点与时间",
            pictureDesc: "中文画面描述",
            action: "角色完成一个独立动作",
            orientation: "角色朝向",
            spatialRelation: "空间关系",
            dialogue: "",
            voiceOver: "",
            environmentSound: "环境声",
            soundEffect: "",
            emotion: "情绪",
            imagePrompt: "首帧图片提示词",
            videoPrompt: "图生视频提示词"
          }
        ]
      },
      null,
      2
    )
  ].join("\n");

  return {
    source: "Toonflow-app inspired adapter",
    workflow: toonflowWorkflow,
    prompt,
    requiredJsonShape: {
      storyboards: [
        "episodeNo",
        "sceneNo",
        "shotNo",
        "duration",
        "shotSize",
        "cameraAngle",
        "cameraMovement",
        "characters",
        "scene",
        "pictureDesc",
        "action",
        "orientation",
        "spatialRelation",
        "dialogue",
        "voiceOver",
        "environmentSound",
        "soundEffect",
        "emotion",
        "imagePrompt",
        "videoPrompt"
      ]
    }
  };
}

export function createToonflowShotEnhancementPrompt(shot: ToonflowStoryboardShot, artStyle: string, videoRatio: string) {
  return [
    "根据镜头信息生成生产级首帧图片提示词和图生视频提示词。",
    "图片提示词只描述可见画面初始状态；视频提示词描述从首帧延展出的动作。",
    `画风：${artStyle}`,
    `画幅：${videoRatio}`,
    `镜头：${shot.sceneNo}-${shot.shotNo}`,
    `画面：${shot.pictureDesc}`,
    `动作：${shot.action}`,
    `角色：${shot.characters.join("、") || "空镜"}`,
    `空间关系：${shot.orientation || ""} ${shot.spatialRelation || ""}`,
    `情绪：${shot.emotion}`,
    "禁止字幕、水印、Logo、对话框。"
  ].join("\n");
}

export function getToonflowAdapterMetadata() {
  return {
    id: "toonflow-script-storyboard",
    name: "Toonflow 编剧/智能分镜适配层",
    sourceRepo: "HBAI-Ltd/Toonflow-app",
    licenseNote: "按开源项目公开工作流与提示词思想做 TypeScript 适配；未整仓复制。",
    capabilities: ["分集编剧", "剧本后镜头规划", "动作单元拆镜", "角色卡约束", "图片/视频提示词拆分"],
    workflow: toonflowWorkflow,
    rules: shotBreakdownRules
  };
}

export function analyzeScriptShotPlan(content: string, requestedEpisodes?: number): ScriptShotPlan[] {
  const sections = splitEpisodeScripts(content);
  const episodeCount = Math.max(1, requestedEpisodes ?? sections.length);
  return Array.from({ length: episodeCount }, (_, index) => {
    const episode = sections[index] ?? "";
    const lines = episode.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const sceneCount = Math.max(1, lines.filter((line) => /^(?:第[一二三四五六七八九十百\d]+[场幕]|场景\s*[一二三四五六七八九十百\d]*|SCENE\s*\d*)/i.test(line)).length);
    const dialogueLines = lines.filter((line) => /^(?:[^：:\n]{1,16})[：:](?!\/\/)/.test(line));
    const dialogueCharacters = dialogueLines.reduce((sum, line) => sum + (line.split(/[：:]/).slice(1).join(":").length || 0), 0);
    const dialogueUnits = Math.max(dialogueLines.length, Math.ceil(dialogueCharacters / 32));
    const actionLines = lines.filter((line) => !dialogueLines.includes(line) && !/^(?:第\s*\d+\s*集|第[一二三四五六七八九十百\d]+[场幕]|场景|SCENE)/i.test(line));
    const actionUnits = Math.max(1, actionLines.reduce((sum, line) => sum + Math.max(1, line.split(/[，。；;！？!?]/).filter(Boolean).length), 0));
    const suggestedShots = Math.max(6, Math.min(30, sceneCount * 2 + dialogueUnits + Math.ceil(actionUnits * 0.75)));
    return { episodeNo: index + 1, sceneCount, dialogueUnits, actionUnits, suggestedShots, estimatedSeconds: suggestedShots * 4 };
  });
}

function formatCharacterCard(character: ToonflowCharacterCard | CharacterProfile) {
  const voice = "voice" in character ? character.voice : "voiceId" in character ? character.voiceId : undefined;
  return [
    `- name: ${character.name}`,
    `  identity: ${character.identity}`,
    `  appearance: ${character.appearance}`,
    `  costume: ${character.costume}`,
    `  personality: ${character.personality}`,
    voice ? `  voice: ${voice}` : ""
  ].filter(Boolean).join("\n");
}

function inferEpisodeCount(content: string) {
  const matches = content.match(/第\s*\d+\s*集/g);
  return Math.max(1, matches?.length ?? 1);
}

function splitEpisodeScripts(content: string) {
  const sections = content.split(/(?=第\s*\d+\s*集)/).map((section) => section.trim()).filter(Boolean);
  return sections.length ? sections : [content.trim()];
}
