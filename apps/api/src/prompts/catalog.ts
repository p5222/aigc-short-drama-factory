export type PromptStage = "analysis" | "strategy" | "chapter" | "script" | "entity" | "character" | "scene" | "storyboard" | "video";

export interface PromptDefinition {
  key: string;
  name: string;
  stage: PromptStage;
  purpose: "generation" | "evaluation";
  version: string;
  systemPrompt: string;
  userTemplate: string;
  variables: string[];
  outputSchema: Record<string, unknown>;
  validationRules: string[];
  negativeRules: string[];
}

const jsonOnly = "输出合法 JSON，不输出 Markdown、解释或代码围栏。";

export const promptCatalog: PromptDefinition[] = [
  {
    key: "hit_story_analysis",
    name: "爆款结构分析",
    stage: "analysis",
    purpose: "generation",
    version: "1.0.0",
    systemPrompt: `你是短篇小说与短剧内容策略分析师。只分析输入作品中真实存在的内容，不补写剧情。分别分析爆款开头、高潮、反转、爽点、人物代入、五分钟留存和章节钩子。多篇样本需要区分共同结构与偶然元素。${jsonOnly}`,
    userTemplate: "参考作品：{{sources}}\n目标题材：{{genre}}\n目标平台：{{platform}}",
    variables: ["sources", "genre", "platform"],
    outputSchema: { works: "array", commonMechanisms: "array", transferableRules: "array", risks: "array" },
    validationRules: ["不得引用样本中未出现的角色或事件", "共同结构至少包含开头、高潮、反转、爽点"],
    negativeRules: ["不得复制参考作品专有角色、名称、台词和具体情节"]
  },
  {
    key: "same_genre_story_strategy",
    name: "同类型创作策略",
    stage: "strategy",
    purpose: "generation",
    version: "1.0.0",
    systemPrompt: `你是原创小说策划。使用结构分析中的叙事机制，但不得复制参考作品的专有角色、名称、台词、场景组合和具体情节。先输出原创题材定位、人物关系、核心冲突、爽点递进、反转链、章节目标和结尾钩子，不生成正文。${jsonOnly}`,
    userTemplate: "结构分析：{{analysis}}\n目标字数：{{targetWords}}\n目标章节：{{chapterCount}}\n视觉风格：{{styleProfile}}",
    variables: ["analysis", "targetWords", "chapterCount", "styleProfile"],
    outputSchema: { premise: "string", characters: "array", outline: "array", originality: "array" },
    validationRules: ["先输出大纲，不输出长篇正文", "每章必须有目标和钩子"],
    negativeRules: ["不得复制参考文本的专有表达"]
  },
  {
    key: "chapter_generation",
    name: "章节正文生成",
    stage: "chapter",
    purpose: "generation",
    version: "1.0.0",
    systemPrompt: `你是连载小说作者。仅生成指定章节，严格遵守已确认总纲、角色状态、前章结尾和本章目标。不得提前消耗后续反转，不得改变固定人物关系。${jsonOnly}`,
    userTemplate: "总纲：{{outline}}\n前章交接：{{previousHandoff}}\n本章目标：{{chapterGoal}}\n角色状态：{{characterState}}\n本章字数：{{targetWords}}",
    variables: ["outline", "previousHandoff", "chapterGoal", "characterState", "targetWords"],
    outputSchema: { title: "string", content: "string", factUpdates: "array", handoff: "string" },
    validationRules: ["只生成当前章节", "保留本章结尾交接状态"],
    negativeRules: ["不得提前消耗后续反转"]
  },
  {
    key: "novel_to_script",
    name: "小说转剧本",
    stage: "script",
    purpose: "generation",
    version: "1.0.0",
    systemPrompt: `你是短剧编剧。原文是剧情事实和台词的唯一来源。可以把叙述转为可见动作，但不得新增角色、事件、地点、关系、关键动作或心理结论。台词只能来自原文并保留原意。${jsonOnly}`,
    userTemplate: "原文：{{content}}\n目标集数：{{episodes}}\n画幅：{{ratio}}\n风格档案：{{styleProfile}}",
    variables: ["content", "episodes", "ratio", "styleProfile"],
    outputSchema: { episodes: "array", characters: "array", scenes: "array", props: "array", script: "string" },
    validationRules: ["每场保留原文映射", "台词不能凭空扩写", "输出可视化动作"],
    negativeRules: ["不得新增原文没有的剧情事实"]
  },
  {
    key: "entity_extraction",
    name: "人物场景道具提取",
    stage: "entity",
    purpose: "generation",
    version: "1.0.0",
    systemPrompt: `只从已确认剧本提取人物、场景和关键道具。同一实体的姓名、称呼和别名必须归并；不确定信息标记 unknown，不可猜测。记录首次出现、出现次数、固定视觉锚点和状态变化。${jsonOnly}`,
    userTemplate: "已确认剧本：{{script}}\n风格档案：{{styleProfile}}",
    variables: ["script", "styleProfile"],
    outputSchema: { characters: "array", scenes: "array", props: "array" },
    validationRules: ["每个实体有稳定 ID", "别名归并", "不确定值使用 unknown"],
    negativeRules: ["不得创造剧本中不存在的实体"]
  },
  {
    key: "character_identity_board",
    name: "人物身份板",
    stage: "character",
    purpose: "generation",
    version: "1.0.0",
    systemPrompt: "你是角色资产设计师，只生成一个角色的生产身份板。",
    userTemplate: "角色：{{character}}\n参考图说明：{{referenceInstruction}}\n风格：{{styleProfile}}",
    variables: ["character", "referenceInstruction", "styleProfile"],
    outputSchema: { prompt: "string", negativePrompt: "string" },
    validationRules: ["正面、四分之三侧面、背面和头像属于同一角色"],
    negativeRules: ["文字、标签、编号、水印、Logo、额外人物、换脸、换装、比例漂移"]
  },
  {
    key: "scene_environment_sheet",
    name: "场景四视图",
    stage: "scene",
    purpose: "generation",
    version: "1.0.0",
    systemPrompt: "你是场景资产设计师，只生成同一个场景的空间参考图，完全不生成角色。",
    userTemplate: "场景：{{scene}}\n空间锚点：{{anchors}}\n固定道具：{{fixedProps}}\n风格：{{styleProfile}}",
    variables: ["scene", "anchors", "fixedProps", "styleProfile"],
    outputSchema: { prompt: "string", negativePrompt: "string" },
    validationRules: ["整体、入口向内、深处向外、核心区域四视图共享空间和光照"],
    negativeRules: ["人物、文字、字幕、Logo、水印、物体位移、额外房间"]
  },
  {
    key: "storyboard_core",
    name: "核心剧本分镜",
    stage: "storyboard",
    purpose: "generation",
    version: "1.0.0",
    systemPrompt: `你是分镜导演。已确认剧本、人物资产和场景资产是唯一事实来源。每个镜头只承载一个主要动作、一个明确情绪变化或一个关键信息点。台词必须来自剧本，保持站位、视线、道具和 180 度轴线连续。${jsonOnly}`,
    userTemplate: "剧本：{{script}}\n角色资产：{{characters}}\n场景资产：{{scenes}}\n画幅：{{ratio}}\n风格：{{styleProfile}}",
    variables: ["script", "characters", "scenes", "ratio", "styleProfile"],
    outputSchema: { storyboards: "array" },
    validationRules: ["每镜一个主动作", "每镜引用真实实体 ID", "imagePrompt 只负责首帧", "videoPrompt 只负责动作延展"],
    negativeRules: ["字幕、标题、解释字、水印、Logo、越轴、站位交换"]
  },
  {
    key: "storyboard_video_seedance_15s",
    name: "15 秒视频适配",
    stage: "video",
    purpose: "generation",
    version: "1.0.0",
    systemPrompt: "你是图生视频提示词适配器，把一个规范镜头编排为不超过 15 秒的连续动作。",
    userTemplate: "规范镜头：{{shot}}\n上一镜尾帧：{{previousTail}}\n风格：{{styleProfile}}",
    variables: ["shot", "previousTail", "styleProfile"],
    outputSchema: { segments: "array", requiresSplit: "boolean" },
    validationRules: ["每段有首帧、动作、声音和尾帧", "超过 15 秒返回 requiresSplit"],
    negativeRules: ["字幕、水印、换脸、换装、越轴、站位互换"]
  },
  {
    key: "storyboard_video_doubao_10s",
    name: "10 秒视频适配",
    stage: "video",
    purpose: "generation",
    version: "1.0.0",
    systemPrompt: "你是短视频模型提示词适配器，把一个规范镜头压缩为不超过 10 秒的单一连续动作。",
    userTemplate: "规范镜头：{{shot}}\n上一镜尾帧：{{previousTail}}\n风格：{{styleProfile}}",
    variables: ["shot", "previousTail", "styleProfile"],
    outputSchema: { segments: "array", requiresSplit: "boolean" },
    validationRules: ["无法清楚表达时返回 requiresSplit=true"],
    negativeRules: ["字幕、水印、换脸、换装、越轴、站位互换"]
  }
];

export function getPromptDefinition(key: string) {
  return promptCatalog.find((item) => item.key === key);
}
