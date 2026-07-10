import { prisma } from "./client.js";
import { hashPassword } from "../auth/password.js";
import { membershipPlans, modelPrices, plans, providers, redeemCodes, templates } from "../seed/catalogData.js";
import {
  assets,
  characters,
  creditAccount,
  creditTransactions,
  projects,
  scripts,
  storyboards,
  tasks
} from "../seed/testData.js";

export const DEMO_USER_ID = "user_demo";
export const ADMIN_USER_ID = "user_admin";
const deprecatedProviderIds = [
  "relay-image",
  "openai-compatible",
  "openai-upstream",
  "jxb-text",
  "jxb-deepseek",
  "jxb-image",
  "domestic-image",
  "mock-image",
  "mock-video",
  "qwen",
  "doubao",
  "international-text"
];
const deprecatedPriceIds = [
  "price_relay_gpt_image_2",
  "price_relay_image2",
  "price_openai_compatible_text_run",
  "price_gpt55_text_run",
  "price_jxb_gpt55_text_run",
  "price_jxb_deepseek_v4pro_text_run",
  "price_jxb_gpt_image_2",
  "price_tts_placeholder",
  "price_mock_image",
  "price_video_mock"
];
const failedImageModels = ["wanx-v1", "wan2.5-t2i-preview"];
const defaultPlatformAnnouncements = [
  {
    id: "ann_db_001",
    title: "数据持久化已启用",
    body: "项目、任务、积分、剧本、角色和分镜都会写入 PostgreSQL。",
    type: "update",
    pinned: true
  },
  {
    id: "ann_queue_001",
    title: "生成队列已接入",
    body: "创作任务通过 Redis + BullMQ 调度，支持并发、重试和成本控制。",
    type: "guide",
    pinned: false
  },
  {
    id: "ann_price_001",
    title: "模型价格表可在后台维护",
    body: "价格策略会同步影响前台预估和扣费，请在上线前检查启用状态与供应商成本。",
    type: "info",
    pinned: false
  }
];
const defaultHelpArticles = [
  {
    id: "help_start_001",
    title: "我刚注册账号，第一次怎么开始做一集漫剧？",
    summary: "从故事输入到导出成片的推荐路径。",
    content: "推荐流程：1. 在首页点击「开始创作」，把故事大纲或小说片段粘贴进去；2. 选择集数、画风和画幅；3. 点击下一步，让 AI 拆出剧情、章节和人物；4. 进入分镜页检查角色、场景和镜头；5. 生成分镜图后，再生成对应镜头视频；6. 在导出页补字幕、配音和 BGM，下载成片。",
    category: "getting_started",
    tags: ["新手必读", "创作流程"],
    pinned: true,
    sortOrder: 10
  },
  {
    id: "help_start_002",
    title: "没有完整剧本，可以直接用看过的故事吗？",
    summary: "支持粗略素材，但要先整理成可改写的故事输入。",
    content: "可以。你可以输入故事梗概、章节片段或一句话脑洞。建议写清楚主角、目标、冲突、结尾钩子和想要的风格。平台会先帮你整理剧情结构和分集，再进入可编辑的分镜生产流程。",
    category: "getting_started",
    tags: ["新手必读", "剧本"],
    pinned: false,
    sortOrder: 20
  },
  {
    id: "help_workflow_001",
    title: "角色长相不稳定，怎么处理？",
    summary: "优先固定角色身份卡和参考图。",
    content: "先在角色页生成并确认角色身份卡，保留稳定五官、发型、服装主色和关键配饰。生成分镜图时尽量引用已确认的角色参考图，不要在单个镜头里重新描述一套完全不同的外貌。如果需要换装，建议创建衍生角色资产。",
    category: "workflow",
    tags: ["角色一致性", "出图"],
    pinned: true,
    sortOrder: 30
  },
  {
    id: "help_billing_001",
    title: "积分扣费、冻结和退款分别是什么意思？",
    summary: "解释积分流水里的常见状态。",
    content: "充值或兑换会增加积分；开始生成任务时可能先冻结预估积分；任务成功后会按实际消耗扣费；任务失败或取消时，未消耗的冻结积分会自动退回。你可以在「积分明细」查看每一笔记录。",
    category: "billing",
    tags: ["积分", "账单"],
    pinned: false,
    sortOrder: 40
  },
  {
    id: "help_trouble_001",
    title: "生成失败了怎么办？",
    summary: "检查余额、模型状态和重试入口。",
    content: "先检查积分是否足够，再到任务中心查看失败原因。如果提示模型限流或服务异常，可以稍后重试，或在项目里切换可用模型。失败任务通常不会正式扣费，具体以积分流水为准。",
    category: "troubleshooting",
    tags: ["失败", "重试"],
    pinned: false,
    sortOrder: 50
  }
];

const defaultShowcaseWorks = [
  { id: "showcase_seed_desert", title: "荒原信号", category: "电影感", cover: "desert_poster.jpg", video: "desert_fast.mp4", duration: "00:06" },
  { id: "showcase_seed_photo", title: "雨夜重逢", category: "AI短剧", cover: "photo-w_poster.jpg", video: "photo-w_fast.mp4", duration: "00:07" },
  { id: "showcase_seed_punk", title: "霓虹之后", category: "科幻风", cover: "punk-future_poster.jpg", video: "punk-future_fast.mp4", duration: "00:06" },
  { id: "showcase_seed_booth", title: "她在镜头里醒来", category: "概念片", cover: "girl-booth_poster.jpg", video: "girl-booth_fast.mp4", duration: "00:06" },
  { id: "showcase_seed_bicycle", title: "单车与夏日", category: "品牌广告", cover: "bicycle-smile_poster.jpg", video: "bicycle-smile_fast.mp4", duration: "00:07" }
];

export async function ensureSeedData() {
  const syncEditableCatalog = process.env.SEED_SYNC_EDITABLE_CONFIG === "true";
  const syncBillingPreset = process.env.SEED_SYNC_BILLING_PRESET !== "false";
  const isProduction = process.env.NODE_ENV === "production";
  const seedDefaultUsers = process.env.SEED_DEFAULT_USERS === "true" || (!isProduction && process.env.SEED_DEFAULT_USERS !== "false");
  const seedDemoUser = process.env.SEED_DEMO_USER === "true" || (!isProduction && process.env.SEED_DEMO_USER !== "false");
  const seedDemoData = process.env.SEED_DEMO_DATA === "true" || (!isProduction && process.env.SEED_DEMO_DATA !== "false");
  const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD ?? "admin123456";
  if (isProduction && seedDefaultUsers && (!process.env.ADMIN_SEED_PASSWORD || adminSeedPassword.length < 12 || adminSeedPassword === "admin123456")) {
    throw new Error("Production seed admin requires a strong ADMIN_SEED_PASSWORD with at least 12 characters.");
  }
  const adminPasswordHash = seedDefaultUsers ? await hashPassword(adminSeedPassword) : "";

  if (seedDefaultUsers) {
    await prisma.user.upsert({
      where: { id: ADMIN_USER_ID },
      update: {
        name: "运营管理员",
        email: "admin@aifilm.local",
        phone: "13900000001",
        passwordHash: adminPasswordHash,
        role: "admin",
        status: "active"
      },
      create: {
        id: ADMIN_USER_ID,
        name: "运营管理员",
        email: "admin@aifilm.local",
        phone: "13900000001",
        passwordHash: adminPasswordHash,
        role: "admin",
        status: "active"
      }
    });

    await prisma.creditAccount.upsert({
      where: { userId: ADMIN_USER_ID },
      update: {},
      create: {
        id: "credit_user_admin",
        userId: ADMIN_USER_ID,
        balance: 100000,
        frozenBalance: 0,
        totalRecharge: 100000,
        totalConsume: 0
      }
    });
  }

  if (seedDemoUser) {
    const demoPasswordHash = await hashPassword("demo123456");
    await prisma.user.upsert({
      where: { id: DEMO_USER_ID },
      update: {
        name: "用户1829",
        email: "demo@aifilm.local",
        phone: "13900000002",
        passwordHash: demoPasswordHash,
        role: "creator",
        status: "active"
      },
      create: {
        id: DEMO_USER_ID,
        name: "用户1829",
        email: "demo@aifilm.local",
        phone: "13900000002",
        passwordHash: demoPasswordHash,
        role: "creator",
        status: "active"
      }
    });

    await prisma.creditAccount.upsert({
      where: { userId: DEMO_USER_ID },
      update: {},
      create: {
        id: "credit_user_demo",
        userId: DEMO_USER_ID,
        balance: creditAccount.balance,
        frozenBalance: creditAccount.frozenBalance,
        totalRecharge: creditAccount.totalRecharge,
        totalConsume: creditAccount.totalConsume
      }
    });
  }

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {
        name: plan.name,
        price: plan.price,
        credits: plan.credits,
        bonusCredits: plan.bonusCredits,
        badge: plan.badge,
        features: plan.features,
        shopUrl: plan.shopUrl,
        enabled: true
      },
      create: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        credits: plan.credits,
        bonusCredits: plan.bonusCredits,
        badge: plan.badge,
        features: plan.features,
        shopUrl: plan.shopUrl,
        enabled: true
      }
    });
  }

  for (const membership of membershipPlans) {
    await prisma.membershipPlan.upsert({
      where: { id: membership.id },
      update: syncEditableCatalog
        ? {
            name: membership.name,
            monthlyPrice: membership.monthlyPrice,
            monthlyCredits: membership.monthlyCredits,
            discountPercent: membership.discountPercent,
            priorityLevel: membership.priorityLevel,
            badge: membership.badge,
            features: membership.features,
            shopUrl: membership.shopUrl,
            enabled: membership.enabled
          }
        : {
            name: membership.name,
            features: membership.features,
            shopUrl: membership.shopUrl
          },
      create: {
        id: membership.id,
        name: membership.name,
        monthlyPrice: membership.monthlyPrice,
        monthlyCredits: membership.monthlyCredits,
        discountPercent: membership.discountPercent,
        priorityLevel: membership.priorityLevel,
        badge: membership.badge,
        features: membership.features,
        shopUrl: membership.shopUrl,
        enabled: membership.enabled
      }
    });
  }

  for (const code of redeemCodes) {
    await prisma.redeemCode.upsert({
      where: { code: code.code },
      update: syncEditableCatalog
        ? {
            name: code.name,
            credits: code.credits,
            maxRedemptions: code.maxRedemptions,
            enabled: code.enabled
          }
        : {
            name: code.name
          },
      create: {
        id: code.id,
        code: code.code,
        name: code.name,
        credits: code.credits,
        maxRedemptions: code.maxRedemptions,
        enabled: code.enabled
      }
    });
  }

  for (const announcement of defaultPlatformAnnouncements) {
    await prisma.platformAnnouncement.upsert({
      where: { id: announcement.id },
      update: syncEditableCatalog
        ? {
            title: announcement.title,
            body: announcement.body,
            type: announcement.type,
            enabled: true,
            pinned: announcement.pinned
          }
        : {},
      create: {
        id: announcement.id,
        title: announcement.title,
        body: announcement.body,
        type: announcement.type,
        enabled: true,
        pinned: announcement.pinned
      }
    });
  }

  for (const article of defaultHelpArticles) {
    await prisma.helpArticle.upsert({
      where: { id: article.id },
      update: syncEditableCatalog
        ? {
            title: article.title,
            summary: article.summary,
            content: article.content,
            category: article.category,
            tags: article.tags,
            enabled: true,
            pinned: article.pinned,
            sortOrder: article.sortOrder
          }
        : {},
      create: {
        id: article.id,
        title: article.title,
        summary: article.summary,
        content: article.content,
        category: article.category,
        tags: article.tags,
        enabled: true,
        pinned: article.pinned,
        sortOrder: article.sortOrder
      }
    });
  }

  for (const provider of providers.filter((item) => !deprecatedProviderIds.includes(item.id))) {
    await prisma.modelProvider.upsert({
      where: { id: provider.id },
      update: syncEditableCatalog
        ? {
            name: provider.name,
            modality: provider.modality,
            enabled: provider.enabled,
            baseUrl: provider.baseUrl,
            models: provider.models,
            capability: provider.capability as any,
            costHint: provider.costHint
          }
        : {
            name: provider.name,
            modality: provider.modality,
            capability: provider.capability as any
          },
      create: {
        id: provider.id,
        name: provider.name,
        modality: provider.modality,
        enabled: provider.enabled,
        baseUrl: provider.baseUrl,
        models: provider.models,
        capability: provider.capability as any,
        costHint: provider.costHint
      }
    });
  }

  await prisma.modelProvider.updateMany({
    where: { id: "dashscope-text" },
    data: { costHint: "用于剧本解析、角色卡和分镜拆解的文本通道。" }
  });
  await prisma.modelProvider.updateMany({
    where: { id: "dashscope-image" },
    data: {
      name: "通义万相 / Wanx 生图",
      models: ["wan2.6-t2i", "qwen-image", "qwen-image-plus", "qwen-image-2.0-pro-2026-04-22", "qwen-image-2.0-pro-2026-06-22"],
      costHint: "用于角色三视图、分镜首帧和项目风格统一的生图通道。"
    }
  });
  await prisma.modelProvider.updateMany({
    where: { id: "doubao-seedream" },
    data: {
      models: ["doubao-seedream-5-0-lite-260128", "Doubao-Seedream-5.0-lite", "Doubao-Seedream-4.5", "Doubao-Seedream-4.0"],
      costHint: "低成本主推生图通道，通过火山方舟 Ark 接入；授权模型可在后台维护。"
    }
  });
  await prisma.modelProvider.updateMany({
    where: { id: "doubao-seedance" },
    data: {
      models: ["ep-20260703111128-95wms", "doubao-seedance-1-5-pro-251215", "Doubao-Seedance-1.5-pro", "Doubao-Seedance-1.0-pro", "Doubao-Seedance-1.0-lite-i2v", "Doubao-Seedance-1.0-lite-t2v"],
      costHint: "豆包 Seedance 图生视频模型，走火山方舟 contents/generations/tasks；优先使用后台配置的 ep- 接入点。"
    }
  });

  const imageProviders = await prisma.modelProvider.findMany({ where: { modality: "image" }, select: { id: true, models: true } });
  for (const provider of imageProviders) {
    const scrubbedModels = provider.models.filter((model) => !failedImageModels.includes(model));
    const shouldEnsureWan26 = provider.id === "dashscope-image";
    const nextModels = shouldEnsureWan26 ? Array.from(new Set(["wan2.6-t2i", ...scrubbedModels])) : scrubbedModels;
    if (nextModels.length !== provider.models.length || nextModels.some((model, index) => model !== provider.models[index])) {
      await prisma.modelProvider.update({ where: { id: provider.id }, data: { models: nextModels } });
    }
  }
  await prisma.modelPrice.deleteMany({
    where: {
      OR: [
        { id: { in: deprecatedPriceIds } },
        { providerId: { in: deprecatedProviderIds } },
        { modality: "image", model: { in: failedImageModels } }
      ]
    }
  });
  await prisma.modelProvider.deleteMany({ where: { id: { in: deprecatedProviderIds } } });

  for (const price of modelPrices.filter((item) => !deprecatedPriceIds.includes(item.id) && !deprecatedProviderIds.includes(item.providerId ?? ""))) {
    await prisma.modelPrice.upsert({
      where: { id: price.id },
      update: syncEditableCatalog || syncBillingPreset
        ? {
            providerId: price.providerId,
            providerName: price.providerName,
            modality: price.modality,
            model: price.model,
            unit: price.unit,
            unitCredits: price.unitCredits,
            vendorCostCny: price.vendorCostCny,
            enabled: price.enabled
          }
        : {
            providerId: price.providerId,
            providerName: price.providerName,
            modality: price.modality,
            model: price.model,
            unit: price.unit
          },
      create: {
        id: price.id,
        providerId: price.providerId,
        providerName: price.providerName,
        modality: price.modality,
        model: price.model,
        unit: price.unit,
        unitCredits: price.unitCredits,
        vendorCostCny: price.vendorCostCny,
        enabled: price.enabled
      }
    });
  }

  for (const template of templates) {
    await prisma.promptTemplate.upsert({
      where: { id: template.id },
      update: {
        name: template.name,
        type: template.type,
        version: template.version,
        enabled: template.enabled,
        summary: template.summary,
        content: template.content ?? template.summary
      },
      create: {
        id: template.id,
        name: template.name,
        type: template.type,
        version: template.version,
        enabled: template.enabled,
        summary: template.summary,
        content: template.content ?? template.summary
      }
    });
  }

  for (const [index, work] of defaultShowcaseWorks.entries()) {
    await prisma.showcaseWork.upsert({
      where: { id: work.id },
      update: syncEditableCatalog
        ? {
            title: work.title,
            category: work.category,
            coverUrl: `/media/cineart-home/${work.cover}`,
            videoUrl: `/media/cineart-home/${work.video}`,
            durationLabel: work.duration,
            status: "approved",
            featured: true,
            sortOrder: (index + 1) * 10
          }
        : {},
      create: {
        id: work.id,
        title: work.title,
        description: "漫角真实生产流程展示作品。",
        category: work.category,
        authorName: "漫角官方",
        coverUrl: `/media/cineart-home/${work.cover}`,
        videoUrl: `/media/cineart-home/${work.video}`,
        durationLabel: work.duration,
        status: "approved",
        featured: true,
        sortOrder: (index + 1) * 10,
        submittedAt: new Date(),
        publishedAt: new Date()
      }
    });
  }

  if (!seedDemoData || !seedDemoUser) return;

  for (const project of projects) {
    await prisma.project.upsert({
      where: { id: project.id },
      update: {
        name: project.name,
        type: project.type,
        intro: project.intro,
        sourceType: project.sourceType,
        artStyle: project.artStyle,
        videoRatio: project.videoRatio,
        status: project.status,
        episodes: project.episodes,
        storyboards: project.storyboards,
        characters: project.characters,
        imageAssets: project.imageAssets,
        videoClips: project.videoClips,
        creditsSpent: project.creditsSpent
      },
      create: {
        id: project.id,
        userId: DEMO_USER_ID,
        name: project.name,
        type: project.type,
        intro: project.intro,
        sourceType: project.sourceType,
        artStyle: project.artStyle,
        videoRatio: project.videoRatio,
        status: project.status,
        episodes: project.episodes,
        storyboards: project.storyboards,
        characters: project.characters,
        imageAssets: project.imageAssets,
        videoClips: project.videoClips,
        creditsSpent: project.creditsSpent,
        updatedAt: new Date(project.updatedAt)
      }
    });
  }

  for (const script of scripts) {
    await prisma.scriptDraft.upsert({
      where: { id: script.id },
      update: {
        name: script.name,
        content: script.content,
        synopsis: script.synopsis,
        version: script.version
      },
      create: {
        id: script.id,
        projectId: script.projectId,
        name: script.name,
        content: script.content,
        synopsis: script.synopsis,
        version: script.version,
        createdAt: new Date(script.createdAt)
      }
    });
  }

  for (const character of characters) {
    await prisma.character.upsert({
      where: { id: character.id },
      update: {
        name: character.name,
        identity: character.identity,
        appearance: character.appearance,
        costume: character.costume,
        personality: character.personality,
        prompt: character.prompt,
        negativePrompt: character.negativePrompt,
        referenceAssetId: character.referenceAssetId,
        voiceId: character.voiceId,
        seed: character.seed,
        consistencyLevel: character.consistencyLevel
      },
      create: {
        id: character.id,
        projectId: character.projectId,
        name: character.name,
        identity: character.identity,
        appearance: character.appearance,
        costume: character.costume,
        personality: character.personality,
        prompt: character.prompt,
        negativePrompt: character.negativePrompt,
        referenceAssetId: character.referenceAssetId,
        voiceId: character.voiceId,
        seed: character.seed,
        consistencyLevel: character.consistencyLevel
      }
    });
  }

  for (const asset of assets) {
    await prisma.asset.upsert({
      where: { id: asset.id },
      update: {
        type: asset.type,
        name: asset.name,
        description: asset.description,
        prompt: asset.prompt,
        referenceUrl: asset.referenceUrl,
        status: asset.status,
        relatedCharacterId: asset.relatedCharacterId
      },
      create: {
        id: asset.id,
        projectId: asset.projectId,
        type: asset.type,
        name: asset.name,
        description: asset.description,
        prompt: asset.prompt,
        referenceUrl: asset.referenceUrl,
        status: asset.status,
        relatedCharacterId: asset.relatedCharacterId
      }
    });
  }

  for (const shot of storyboards) {
    await prisma.storyboard.upsert({
      where: { id: shot.id },
      update: {
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
      },
      create: {
        id: shot.id,
        projectId: shot.projectId,
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
      }
    });
  }

  for (const task of tasks) {
    await prisma.generationTask.upsert({
      where: { id: task.id },
      update: {
        projectName: task.projectName,
        type: task.type,
        title: task.title,
        provider: task.provider,
        model: task.model,
        status: task.status,
        progress: task.progress,
        estimatedCredits: task.estimatedCredits,
        finalCredits: task.finalCredits,
        errorReason: task.errorReason
      },
      create: {
        id: task.id,
        userId: DEMO_USER_ID,
        projectId: task.projectId,
        projectName: task.projectName,
        type: task.type,
        title: task.title,
        provider: task.provider,
        model: task.model,
        status: task.status,
        progress: task.progress,
        estimatedCredits: task.estimatedCredits,
        finalCredits: task.finalCredits,
        errorReason: task.errorReason,
        createdAt: new Date(task.createdAt),
        updatedAt: new Date(task.updatedAt)
      }
    });
  }

  for (const transaction of creditTransactions) {
    await prisma.creditTransaction.upsert({
      where: { id: transaction.id },
      update: {
        type: transaction.type,
        amount: transaction.amount,
        balanceAfter: transaction.balanceAfter,
        description: transaction.description
      },
      create: {
        id: transaction.id,
        userId: DEMO_USER_ID,
        projectId: transaction.projectId,
        taskId: transaction.taskId,
        type: transaction.type,
        amount: transaction.amount,
        balanceAfter: transaction.balanceAfter,
        description: transaction.description,
        createdAt: new Date(transaction.createdAt)
      }
    });
  }
}
