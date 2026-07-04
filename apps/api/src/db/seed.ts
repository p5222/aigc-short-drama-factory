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

export async function ensureSeedData() {
  const syncEditableCatalog = process.env.SEED_SYNC_EDITABLE_CONFIG === "true";
  const syncBillingPreset = process.env.SEED_SYNC_BILLING_PRESET !== "false";
  const seedDefaultUsers = process.env.SEED_DEFAULT_USERS !== "false";
  const seedDemoData = process.env.SEED_DEMO_DATA !== "false";
  const demoPasswordHash = await hashPassword("demo123456");
  const adminPasswordHash = await hashPassword(process.env.ADMIN_SEED_PASSWORD ?? "admin123456");

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
    where: { id: "doubao-seedream" },
    data: {
      models: ["doubao-seedream-5-0-lite-260128", "Doubao-Seedream-5.0-lite", "Doubao-Seedream-4.5", "Doubao-Seedream-4.0"],
      costHint: "低成本主推生图通道，通过火山方舟 Ark 接入；协作奖励计划模型请在后台填授权后的模型/接入点 ID，额度耗尽后可切换同类 Seedream 模型继续。"
    }
  });
  await prisma.modelProvider.updateMany({
    where: { id: "doubao-seedance" },
    data: {
      models: ["ep-20260703111128-95wms", "doubao-seedance-1-5-pro-251215", "Doubao-Seedance-1.5-pro", "Doubao-Seedance-1.0-pro", "Doubao-Seedance-1.0-lite-i2v", "Doubao-Seedance-1.0-lite-t2v"],
      costHint: "豆包 Seedance 图生视频模型，走火山方舟 contents/generations/tasks；优先填授权后的 ep- 接入点 ID。模型池会在免费额度耗尽、限流或未授权时自动切换下一个候选。"
    }
  });

  await prisma.modelPrice.deleteMany({
    where: {
      OR: [
        { id: { in: deprecatedPriceIds } },
        { providerId: { in: deprecatedProviderIds } }
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

  if (!seedDemoData) return;

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
