import type {
  CharacterConsistencyInput,
  CharacterConsistencyOutput,
  ModelProvider,
  RelayGatewayPolicy,
  RelayRoutePreview,
  WritingAgentInput,
  WritingAgentOutput
} from "@aifilm/shared";

const defaultReviewChecklist = [
  "主线目标是否在每章推进，避免只堆设定。",
  "角色动机、能力边界和关系变化是否被记入记忆卡。",
  "每章结尾是否保留可视化钩子，方便后续拆分分镜。",
  "关键道具、地点和称呼是否保持一致。",
  "对白是否服务冲突，避免同一信息重复解释。"
];

export function createWebNovelWritingPlan(input: WritingAgentInput): WritingAgentOutput {
  const title = input.title.trim() || "未命名漫剧";
  const premise = input.premise.trim() || "主角在命运转折中重新掌控人生。";
  const genre = input.genre?.trim() || inferGenre(premise);
  const targetChapters = clampNumber(input.targetChapters ?? 12, 3, 60);
  const chapterWords = clampNumber(input.chapterWords ?? 2200, 800, 6000);
  const hero = inferHeroName(premise);
  const rival = inferRivalName(premise, hero);

  const chapters = Array.from({ length: targetChapters }, (_, index) => {
    const chapterNo = index + 1;
    const phase = resolveNarrativePhase(index, targetChapters);
    return {
      chapterNo,
      title: `第${chapterNo}章 ${phase.title}`,
      goal: `${hero}${phase.goal}`,
      conflict: `${rival}${phase.conflict}`,
      hook: phase.hook,
      continuityNotes: [
        `${hero}的核心动机：${phase.heroMemory}`,
        `${rival}的压迫方式：${phase.rivalMemory}`,
        `预计字数 ${chapterWords}，章末必须留下可分镜的强画面。`
      ]
    };
  });

  return {
    title,
    logline: `${genre}故事《${title}》：${premise.slice(0, 110)}${premise.length > 110 ? "..." : ""}`,
    worldRules: [
      "所有设定先进入世界规则，再进入章节正文，避免后续反复改口。",
      "重要道具、地点、组织和能力消耗必须被写入记忆卡。",
      "章节推进采用“目标-阻碍-反转-钩子”结构，方便后续转短剧分镜。"
    ],
    characterArcs: [
      {
        name: hero,
        role: "主角",
        desire: "夺回选择权并完成第一阶段目标",
        wound: "曾因信任或信息差失去关键关系",
        change: "从被动承受转向主动布局"
      },
      {
        name: rival,
        role: "关键对手/关系角色",
        desire: "控制局势或守住隐藏真相",
        wound: "对主角存在未说出口的旧账",
        change: "从压迫者逐步暴露真实立场"
      }
    ],
    volumeOutline: [
      {
        volumeNo: 1,
        title: "引爆旧伤",
        promise: "用强冲突开场，把主角目标和关系矛盾一次性抛出。",
        turningPoint: "主角发现对手并非唯一敌人。"
      },
      {
        volumeNo: 2,
        title: "反向布局",
        promise: "主角主动设局，逐章扩大信息差和情绪筹码。",
        turningPoint: "关键盟友或道具被夺走。"
      },
      {
        volumeNo: 3,
        title: "真相逼近",
        promise: "多线收束到一次公开对峙，形成适合短剧季终的高燃节点。",
        turningPoint: "主角以代价换来阶段性胜利。"
      }
    ],
    chapters,
    memoryCards: [
      { key: "主角稳定动机", value: `${hero}要证明自己并夺回选择权。`, updateRule: "每 3 章检查一次是否偏离主线。" },
      { key: "对手隐藏目标", value: `${rival}掌握旧事真相，但不愿直接说破。`, updateRule: "只在反转章释放新信息。" },
      { key: "视觉资产提示", value: `${hero}、${rival}、核心场景需先生成角色/场景资产。`, updateRule: "生成分镜前锁定，不在镜头中临时改外观。" }
    ],
    reviewChecklist: defaultReviewChecklist
  };
}

export function createCharacterConsistencyPlan(input: CharacterConsistencyInput): CharacterConsistencyOutput {
  const referencePlan = input.characters.map((character, index) => {
    const seed = character.seed ?? stableSeed(`${input.projectId ?? input.storyTitle}:${character.name}:${index}`);
    const lockedTraits = [
      character.identity,
      character.appearance,
      character.costume,
      character.personality
    ].filter(Boolean);

    return {
      characterName: character.name,
      anchorPrompt: [
        character.name,
        character.identity,
        character.appearance,
        character.costume,
        character.personality,
        input.artStyle,
        "consistent face, stable hairstyle, stable outfit color, clean reference sheet"
      ].join(", "),
      negativePrompt: "换脸, 五官漂移, 发型改变, 服装主色改变, 多余肢体, 畸形手, 水印, 字幕, logo",
      seed,
      requiredViews: ["正面半身", "三分之四侧身", "表情三视图", "常用动作姿态"],
      lockedTraits,
      driftRisks: [
        "长篇分镜中服装颜色被模型自动改写",
        "多人同框时同款脸或发型互相污染",
        "情绪强烈镜头导致五官比例漂移"
      ]
    };
  });

  return {
    projectId: input.projectId,
    referencePlan,
    shotUsageRules: [
      "分镜图提示词只引用角色名和资产 ID，不重复发明五官与服装。",
      "多人同框必须写清左右站位、朝向和遮挡关系。",
      "跨章节换装必须建立衍生角色资产，不覆盖主角色资产。",
      "角色参考图、场景参考图、分镜图按顺序生成，不能跳过参考图直接批量生分镜。"
    ],
    derivativeRules: [
      "换装、受伤、变身、年龄变化都作为 role_derivative 资产管理。",
      "衍生资产继承原 seed 和脸部锚点，只允许改变剧情明确要求的外观部分。",
      "每个衍生资产都需要记录适用章节/场景范围。"
    ]
  };
}

export function createRelayGatewayPolicy(providers: ModelProvider[], baseUrl = "/v1"): RelayGatewayPolicy {
  const routes = providers.map((provider, index) => {
    const hasModels = provider.models.length > 0;
    const health: RelayRoutePreview["health"] = !provider.enabled ? "disabled" : hasModels ? "ready" : "unknown";
    return {
      id: provider.id,
      name: provider.name,
      modality: provider.modality,
      enabled: provider.enabled,
      models: provider.models,
      health,
      pricingHint: provider.costHint,
      routingWeight: provider.enabled ? Math.max(5, 100 - index * 8) : 0
    };
  });

  return {
    compatibleEndpoint: baseUrl,
    routingMode: "cost_first",
    accountSharing: "internal_pool",
    billingUnit: "credits",
    routes,
    notes: [
      "参考 sub2api 的统一入口思想，但本项目使用自有积分账本和后台供应商表实现。",
      "订阅账号池后续只保存在服务端环境和密钥表，前端永不暴露真实 Key。",
      "路由策略先按 modality、启用状态、模型单价和健康状态排序，再进入真实模型调用。",
      "当前接口输出为网关策略预览，后续可扩展为 /v1/chat/completions、/v1/images、/v1/videos 兼容入口。"
    ]
  };
}

function inferGenre(text: string) {
  if (text.includes("修仙") || text.includes("仙")) return "东方玄幻";
  if (text.includes("重生") || text.includes("复仇")) return "重生复仇";
  if (text.includes("校园")) return "青春校园";
  if (text.includes("赛博") || text.includes("AI")) return "科幻悬疑";
  return "都市情感";
}

function inferHeroName(text: string) {
  const match = text.match(/([\u4e00-\u9fa5]{2,3})(?:重生|穿越|站在|回到|发现|决定|被)/);
  return match?.[1] ?? "林晚";
}

function inferRivalName(text: string, hero: string) {
  const names = text.match(/[\u4e00-\u9fa5]{2,3}/g)?.filter((name) => name !== hero) ?? [];
  return names.find((name) => !["第一", "一个", "故事", "命运", "真相", "这次"].includes(name)) ?? "顾沉";
}

function resolveNarrativePhase(index: number, total: number) {
  const ratio = index / Math.max(1, total - 1);
  if (ratio < 0.25) {
    return {
      title: "旧伤重现",
      goal: "确认当前处境并找到第一条线索",
      conflict: "以沉默和压迫制造信息差",
      hook: "主角看见一件不该出现的旧物。",
      heroMemory: "不再相信表面善意",
      rivalMemory: "掌控现场节奏"
    };
  }
  if (ratio < 0.55) {
    return {
      title: "主动试探",
      goal: "用反常举动逼出隐藏关系",
      conflict: "设置误导，让主角误判真正危险",
      hook: "一次试探意外牵出更高层敌人。",
      heroMemory: "开始主动布局",
      rivalMemory: "既阻拦又保护"
    };
  }
  if (ratio < 0.82) {
    return {
      title: "代价交换",
      goal: "拿到关键证据并保护重要关系",
      conflict: "用情感弱点逼主角交出筹码",
      hook: "证据到手，但最信任的人消失。",
      heroMemory: "愿意承担代价",
      rivalMemory: "隐藏目标出现裂缝"
    };
  }
  return {
    title: "真相逼近",
    goal: "公开反击并改写阶段结局",
    conflict: "最后一次封锁真相",
    hook: "真正幕后者在结尾露出身份线索。",
    heroMemory: "完成从被动到主动的转变",
    rivalMemory: "被迫站队"
  };
}

function stableSeed(source: string) {
  return source.split("").reduce((sum, char) => sum * 31 + char.charCodeAt(0), 17001) % 900000;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max);
}
