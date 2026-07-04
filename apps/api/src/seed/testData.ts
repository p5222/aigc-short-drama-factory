import type {
  AdminSummary,
  AssetItem,
  CharacterProfile,
  CreditAccount,
  CreditTransaction,
  GenerationTask,
  Project,
  ScriptDraft,
  StoryboardShot,
  WorkbenchSummary
} from "@aifilm/shared";

const now = new Date();
const iso = (offsetMinutes = 0) => new Date(now.getTime() - offsetMinutes * 60_000).toISOString();
export const projects: Project[] = [
  {
    id: "proj_demo_001",
    name: "雨夜重逢",
    type: "甜虐短剧",
    intro: "重生女主在雨夜重新遇见旧爱，第一集完成剧情、角色和分镜演示。",
    sourceType: "短篇故事",
    artStyle: "国漫写实",
    videoRatio: "9:16",
    status: "storyboarding",
    episodes: 1,
    storyboards: 1,
    characters: 2,
    imageAssets: 3,
    videoClips: 0,
    creditsSpent: 180,
    updatedAt: iso(22)
  }
];

export const tasks: GenerationTask[] = [
  {
    id: "task_001",
    projectId: "proj_demo_001",
    projectName: "雨夜重逢",
    type: "storyboard",
    title: "9 宫格分镜生成",
    provider: "DeepSeek",
    model: "deepseek-v4-pro",
    status: "succeeded",
    progress: 100,
    estimatedCredits: 50,
    finalCredits: 50,
    createdAt: iso(130),
    updatedAt: iso(124)
  },
  {
    id: "task_002",
    projectId: "proj_demo_001",
    projectName: "雨夜重逢",
    type: "image",
    title: "角色参考图生成",
    provider: "Mock Image",
    model: "mock-image-v1",
    status: "running",
    progress: 48,
    estimatedCredits: 100,
    createdAt: iso(18),
    updatedAt: iso(3)
  },
  {
    id: "task_003",
    projectId: "proj_demo_001",
    projectName: "雨夜重逢",
    type: "video",
    title: "图生视频任务占位",
    provider: "Mock Video",
    model: "mock-video-v1",
    status: "pending",
    progress: 0,
    estimatedCredits: 0,
    createdAt: iso(8),
    updatedAt: iso(8)
  }
];

export const scripts: ScriptDraft[] = [
  {
    id: "script_proj_demo_001",
    projectId: "proj_demo_001",
    name: "雨夜重逢 第一集剧本",
    synopsis: "重生女主在雨夜重新遇见旧爱，第一集围绕误会、试探和危机逼近展开。",
    content: [
      "第1场 雨夜街口 夜",
      "林晚站在雨中抬头，看见顾沉撑伞走近。",
      "林晚：你终于来了。",
      "顾沉停在她面前，握伞的手指微微收紧。",
      "顾沉：跟我回去。",
      "林晚：这一次，我不会再退。",
      "远处响起急促脚步声，两人同时看向雨幕深处。"
    ].join("\n"),
    version: 1,
    createdAt: iso(135)
  }
];

export const characters: CharacterProfile[] = [
  {
    id: "role_001",
    projectId: "proj_demo_001",
    name: "林晚",
    identity: "重生女主",
    appearance: "清冷五官，眼神坚定，轮廓柔和",
    costume: "浅绿色风衣，白色内搭，细链条耳饰",
    personality: "外柔内韧，克制敏感",
    prompt: "林晚, 重生女主, 清冷五官, 浅绿色风衣, 白色内搭, 国漫写实, consistent face, stable hairstyle",
    negativePrompt: "换脸, 同款分身, 五官漂移, 多余手指, 畸形手, 低清晰度",
    seed: 12345,
    consistencyLevel: "high"
  },
  {
    id: "role_002",
    projectId: "proj_demo_001",
    name: "顾沉",
    identity: "男主",
    appearance: "冷系五官，眼神深邃，气质沉稳",
    costume: "深灰长外套，黑色雨伞，银色腕表",
    personality: "沉稳克制，保护欲强",
    prompt: "顾沉, 男主, 冷系五官, 深灰长外套, 黑色雨伞, 国漫写实, consistent face, stable outfit",
    negativePrompt: "换脸, 同款分身, 五官漂移, 多余手指, 畸形手, 低清晰度",
    seed: 12346,
    consistencyLevel: "high"
  }
];

export const assets: AssetItem[] = [
  {
    id: "asset_role_001",
    projectId: "proj_demo_001",
    type: "role",
    name: "林晚 角色参考图",
    description: "清冷五官，浅绿色风衣，白色内搭",
    prompt: "林晚, 清冷五官, 浅绿色风衣, 白色内搭, 国漫写实, 角色参考图",
    status: "pending",
    relatedCharacterId: "role_001"
  },
  {
    id: "asset_role_002",
    projectId: "proj_demo_001",
    type: "role",
    name: "顾沉 角色参考图",
    description: "冷系五官，深灰长外套，黑色雨伞",
    prompt: "顾沉, 冷系五官, 深灰长外套, 黑色雨伞, 国漫写实, 角色参考图",
    status: "pending",
    relatedCharacterId: "role_002"
  },
  {
    id: "scene_001",
    projectId: "proj_demo_001",
    type: "scene",
    name: "雨夜街口",
    description: "夜晚、雨水、路灯、空街，作为第一集主场景",
    prompt: "雨夜街口, cinematic scene reference, wet ground, 国漫写实, 9:16",
    status: "pending"
  }
];

export const creditAccount: CreditAccount = {
  userId: "user_demo",
  balance: 9820,
  frozenBalance: 100,
  totalRecharge: 10000,
  totalConsume: 180
};

export const creditTransactions: CreditTransaction[] = [
  {
    id: "tx_001",
    type: "recharge",
    amount: 10000,
    balanceAfter: 10000,
    description: "管理员手动充值演示积分",
    createdAt: iso(280)
  },
  {
    id: "tx_002",
    type: "consume",
    amount: -50,
    balanceAfter: 9950,
    description: "9 宫格分镜生成",
    taskId: "task_001",
    projectId: "proj_demo_001",
    createdAt: iso(124)
  },
  {
    id: "tx_003",
    type: "freeze",
    amount: -100,
    balanceAfter: 9820,
    description: "角色参考图生成冻结积分",
    taskId: "task_002",
    projectId: "proj_demo_001",
    createdAt: iso(18)
  }
];

export const storyboards: StoryboardShot[] = [
  {
    id: "shot_001",
    projectId: "proj_demo_001",
    episodeNo: 1,
    sceneNo: 1,
    shotNo: 1,
    duration: 5,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "缓慢推进",
    characters: ["林晚", "顾沉"],
    scene: "雨夜街口",
    pictureDesc: "林晚站在雨中抬头，看见顾沉撑伞走近。",
    dialogue: "林晚：你终于来了。",
    voiceOver: "",
    environmentSound: "雨声 + 远处车流声",
    soundEffect: "脚步声",
    imagePrompt: "雨夜街口，两人对峙，国漫写实，中景，9:16，无字幕",
    videoPrompt: "缓慢推进，雨水落下，人物轻微呼吸，保持角色面部稳定，无字幕无水印",
    referenceAssetIds: ["asset_role_001", "asset_role_002", "scene_001"],
    status: "pending",
    action: "(开篇)林晚抬头，顾沉撑伞靠近",
    orientation: "林晚-3/4正面朝右；顾沉-3/4正面朝左",
    spatialRelation: "林晚(左前)、顾沉(右后)",
    emotion: "重逢压抑"
  }
];

export function getWorkbenchSummary(): WorkbenchSummary {
  return {
    userName: "用户1829",
    projects: projects.length,
    storyboards: projects.reduce((sum, project) => sum + project.storyboards, 0),
    runningTasks: tasks.filter((task) => task.status === "running" || task.status === "pending").length,
    credits: creditAccount.balance,
    recentProjects: projects,
    recentTasks: tasks,
    announcements: [
      {
        id: "ann_001",
        title: "创作工作台已开启",
        body: "支持故事输入、策划、剧本、角色资产、镜头级分镜和任务中心演示。",
        type: "info"
      },
      {
        id: "ann_002",
        title: "角色一致性能力预置",
        body: "角色卡、参考资产、Seed、负面提示词和 image2 字段已进入数据结构。",
        type: "update"
      },
      {
        id: "ann_003",
        title: "视频生成采用可插拔接口",
        body: "第一版先演示任务流和积分流，后续接入真实图生视频模型。",
        type: "guide"
      }
    ]
  };
}

export function getAdminSummary(): AdminSummary {
  const done = tasks.filter((task) => task.status === "succeeded").length;
  return {
    users: 1,
    projects: projects.length,
    tasksToday: tasks.length,
    successRate: Math.round((done / tasks.length) * 100),
    creditsConsumed: creditAccount.totalConsume,
    providerCost: 0
  };
}
