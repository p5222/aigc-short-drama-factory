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
    title: "我刚注册账号，第一次怎么做出一集漫剧？",
    summary: "从创作意图到成片导出的完整路径：内容创作五步 + 生产台四阶段。",
    content: "漫角的完整路径分两段：先在「内容创作」把故事写成可生产的剧本，再进「漫剧生产台」把剧本变成视频。\n第一段是内容创作的五步：1. 创作意图——选择同类创作、原创创作或导入小说，写下题材方向和想要的风格；2. 结构拆解——AI 提炼剧情结构、人物和冲突；3. 大纲确认——检查并修改分集大纲；4. 正文创作——逐章生成和润色正文；5. 制作交接——确认后转入生产项目。\n第二段在「我的作品」里打开该作品，进入生产台的四个阶段：内容（剧本与章节定稿）→ 资产（角色三视图与场景图）→ 分镜（镜头表、分镜首帧图与图生视频）→ 成片（剪映式多轨时间线，排列视频片段、配音和字幕）。\n最后到「剪辑中心」或成片阶段发起合成，生成 MP4、配音轨和字幕文件并下载。",
    category: "getting_started",
    tags: ["新手必读", "创作流程", "五步创作"],
    pinned: true,
    sortOrder: 10
  },
  {
    id: "help_start_002",
    title: "没有完整剧本，只有一句话脑洞可以开始吗？",
    summary: "三种创作模式都支持粗糙输入，AI 会先整理结构再进入生产。",
    content: "可以。创作意图步骤提供三种模式：同类创作（给出题材方向或参考作品，先提炼同类爆款结构再生成全新故事）、原创创作（从主题、人物和冲突出发搭建故事）、导入小说（粘贴已有小说，自动拆章并改编为可生产剧本）。\n输入越清楚效果越好：建议写明主角、目标、冲突、结尾钩子和期望画风。AI 会先产出结构拆解和分集大纲，你在每一步都可以人工修改后再继续，不会一步生成到底。",
    category: "getting_started",
    tags: ["新手必读", "创作模式"],
    pinned: false,
    sortOrder: 20
  },
  {
    id: "help_workflow_001",
    title: "角色长相不稳定，镜头之间脸不一致怎么办？",
    summary: "先在资产阶段固定角色三视图，再让分镜引用参考图；个别镜头可单独重生成。",
    content: "在生产台「资产」阶段先生成并确认每个角色的三视图参考图和身份卡，固定五官、发型、服装主色和关键配饰。\n进入「分镜」阶段后，镜头出图会引用已确认的角色参考图，不要在单个镜头的画面描述里重新发明一套外貌。\n如果只有个别镜头跑偏，不需要整批重来：在分镜阶段选中该镜头单独重新生成图片或视频，只按该镜头计费。需要换装或换造型时，建议创建衍生角色资产而不是直接改原角色。",
    category: "workflow",
    tags: ["角色一致性", "资产", "单镜头重生成"],
    pinned: true,
    sortOrder: 30
  },
  {
    id: "help_workflow_002",
    title: "生产台的内容、资产、分镜、成片四个阶段分别做什么？",
    summary: "四阶段各管一段：剧本定稿、视觉资产、镜头生成、时间线合成。",
    content: "内容阶段：查看和修改这一集的剧本、章节与角色卡，是后续所有生成的依据。\n资产阶段：生成角色三视图、场景与道具参考图，保证全片视觉统一；资产确认后才建议批量出分镜。\n分镜阶段：AI 按剧本拆出镜头表（景别、运镜、台词、画面描述），逐镜生成分镜首帧图，再用图生视频把首帧变成镜头视频；支持按镜头或选中批量重新生成。\n成片阶段：剪映式多轨时间线，把视频片段按顺序排轨，叠加配音轨和字幕轨，调整时长后合成最终 MP4。跨作品的合成与导出也可以在「剪辑中心」统一操作。",
    category: "workflow",
    tags: ["生产台", "四阶段", "时间线"],
    pinned: false,
    sortOrder: 34
  },
  {
    id: "help_workflow_003",
    title: "平台都有哪些模型渠道？该怎么选？",
    summary: "文本、生图、视频、配音各有多条渠道，失败或效果不满意可以切换。",
    content: "文本（剧情、剧本、分镜拆解）：Manjiao / GPT-5.5 走高质量档，阿里云百炼的 qwen 系列均衡耐用，Pipp / DeepSeek 性价比高。\n生图（角色三视图、分镜首帧）：通义万相 wan2.6-t2i 与 Qwen Image 系列是主力，豆包 Seedream 成本更低，GPT Image 2 适合高质量单张。\n视频（图生视频镜头）：通义万相 wan2.7-i2v 与豆包 Seedance 系列按秒计费，时长和画质决定成本。\n配音：阿里云百炼 Qwen TTS，按字符计费。\n渠道由后台价格策略统一管理，生成前会显示预估积分；某条渠道限流或失败时，换一条同类渠道重试通常就能解决。",
    category: "workflow",
    tags: ["模型渠道", "选型"],
    pinned: false,
    sortOrder: 38
  },
  {
    id: "help_billing_001",
    title: "积分的冻结、扣费和退还是怎么运作的？",
    summary: "提交任务先冻结预估积分，成功按实际消耗扣费，失败或取消自动退回。",
    content: "积分是平台的统一计费单位，1 积分约等于 1 元人民币的消费参考；充值和兑换码入账的积分永久有效。\n每次提交生成任务时，会先按预估用量冻结对应积分（流水里显示为「冻结」）；任务成功后按实际消耗正式扣费，多冻结的部分退回；任务失败或被取消时，未消耗的冻结积分会自动退还（流水里显示为「退款」）。\n所以看到「冻结」不等于已经花掉。每一笔冻结、扣费、退还都能在「积分明细」里按类型筛选核对，并能看到关联的项目和任务 ID。",
    category: "billing",
    tags: ["积分", "冻结", "退款"],
    pinned: true,
    sortOrder: 40
  },
  {
    id: "help_billing_002",
    title: "各类生成大概消耗多少积分？",
    summary: "文本每次约 4-30 积分，生图每张约 8-28，视频每秒约 12-24，配音每字符 1。",
    content: "以下为当前价格策略的大致区间，实际以「积分充值」页底部的消费参考表为准：\n文本类（剧情分析、剧本、分镜拆解）：每次约 4-30 积分。qwen 系列约 4-8，DeepSeek 系列约 4-20，GPT-5.5 约 30。\n生图类（角色三视图、分镜首帧）：每张约 8-28 积分。qwen-image 约 8，wan2.6-t2i 约 10，豆包 Seedream 约 8-10，GPT Image 2 约 28。\n视频类（图生视频）：每秒约 12-24 积分。wan2.7-i2v 约 12/秒，豆包 Seedance 系列约 12-18/秒，一个 5 秒镜头约 60-90 积分。\n配音（Qwen TTS）：每字符 1 积分。\n价格策略由后台维护，调整后前台预估和扣费会同步变化。",
    category: "billing",
    tags: ["积分", "价格参考"],
    pinned: false,
    sortOrder: 45
  },
  {
    id: "help_trouble_001",
    title: "生成失败了怎么办？会白扣积分吗？",
    summary: "到生成队列看失败原因，可直接重试或换渠道；失败任务的冻结积分自动退回。",
    content: "打开「生成队列」，失败任务会显示具体失败原因（例如内容审核未通过、图片地址失效、渠道超时、余额不足）。\n处理顺序建议：1. 先看失败原因，能定位就按提示修正；2. 点「重试」原渠道再跑一次；3. 同一渠道反复失败时，回到生产台切换同类模型渠道后重新生成；4. 只有个别镜头失败时，在分镜阶段对该镜头单独重生成即可，不必整批重来。\n费用方面不用担心：失败或取消的任务会自动退回冻结积分，只有成功的生成才正式扣费，具体以积分明细为准。",
    category: "troubleshooting",
    tags: ["失败", "重试", "换渠道"],
    pinned: true,
    sortOrder: 50
  },
  {
    id: "help_trouble_002",
    title: "提示「请求过于频繁」或「服务器繁忙」是怎么回事？",
    summary: "触发了限流保护，等几十秒再试即可；任务排队不会丢。",
    content: "平台对生成请求做了并发和频率限制，短时间内提交过多任务或上游模型渠道繁忙时，会返回「请求过于频繁，请稍后重试」。\n遇到这种情况：稍等 30-60 秒再提交即可；已经进入队列的任务不受影响，会按顺序继续执行，不需要重复提交同一个任务（重复提交只会加长排队）。\n如果某条渠道长时间繁忙，可以在生成时切换到同类的其他模型渠道。页面切换或关闭浏览器不会中断后端队列里的任务。",
    category: "troubleshooting",
    tags: ["限流", "稍后重试", "队列"],
    pinned: false,
    sortOrder: 55
  },
  {
    id: "help_account_001",
    title: "注册需要手机号吗？怎么修改邮箱和密码？",
    summary: "邮箱即可注册，手机号选填；账号安全操作都在「我的」页面。",
    content: "注册只需要邮箱和密码，手机号是选填项，之后可以在个人资料里补充。\n修改邮箱：进入「我的」→ 账号安全 → 修改邮箱账号，输入新邮箱并验证当前密码。\n修改密码：同样在「我的」→ 账号安全，新密码至少 8 个字符；修改成功后其他设备的登录会话会失效，需要重新登录。\n头像和昵称在「我的」→ 账号信息 → 编辑资料中修改，头像图片会自动压缩到 20KB 以内。",
    category: "account",
    tags: ["注册", "邮箱", "密码"],
    pinned: false,
    sortOrder: 60
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
