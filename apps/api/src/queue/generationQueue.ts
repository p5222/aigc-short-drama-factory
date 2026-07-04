import "../config/env.js";
import { Job, Queue, QueueEvents, Worker } from "bullmq";
import type { CreateProjectInput } from "@aifilm/shared";
import { generateProjectScriptContent, hasTextModelConfig, textModelName, textProviderName } from "../agents/generator.js";
import { prisma } from "../db/client.js";
import { readProviderRoutingState } from "../db/mappers.js";

export interface CreationJobData {
  projectId: string;
  taskId: string;
  userId: string;
  input: CreateProjectInput;
  estimatedCredits: number;
}

type CreationJobResult = { mode: "real" | "local" };
type CreationJobName = "create-project";

export const queueConnection = buildRedisConnectionOptions();

export const generationQueue = new Queue<CreationJobData, CreationJobResult, CreationJobName>("generation", {
  connection: queueConnection
});

export const generationQueueEvents = new QueueEvents("generation", {
  connection: queueConnection
});

let workerStarted = false;

export function startGenerationWorker() {
  if (workerStarted) return;
  workerStarted = true;

  new Worker<CreationJobData, CreationJobResult, CreationJobName>(
    "generation",
    async (job) => processCreationJob(job),
    {
      connection: queueConnection,
      concurrency: Number(process.env.GENERATION_CONCURRENCY ?? 1)
    }
  );
}

async function processCreationJob(job: Job<CreationJobData, CreationJobResult, CreationJobName>) {
  const { projectId, taskId, userId, input, estimatedCredits } = job.data;
  const currentTask = await prisma.generationTask.findUnique({ where: { id: taskId }, select: { status: true } });
  if (currentTask?.status === "canceled" || currentTask?.status === "refunded") {
    return { mode: "local" as const };
  }

  const configuredProvider = input.textProvider
    ? await prisma.modelProvider.findUnique({ where: { id: input.textProvider } })
    : null;
  const routing = readProviderRoutingState(
    configuredProvider?.capability,
    configuredProvider?.models ?? (input.textModel ? [input.textModel] : [])
  );
  const selectedTextModel = input.textModel || routing.preferredModel;
  const runtimeInput = {
    ...input,
    textProvider: configuredProvider?.id ?? input.textProvider,
    textModel: selectedTextModel,
    textModelPool: routing.mode === "manual"
      ? [selectedTextModel].filter(Boolean)
      : uniqueStrings([selectedTextModel, ...routing.modelPool, ...(configuredProvider?.models ?? [])]),
    baseUrl: configuredProvider?.baseUrl ?? undefined,
    apiKey: configuredProvider?.apiKey ?? undefined
  };
  const hasRealTextModelConfig = hasTextModelConfig(runtimeInput);

  await prisma.generationTask.update({
    where: { id: taskId },
    data: {
      status: "running",
      progress: 20,
      provider: hasRealTextModelConfig ? textProviderName(runtimeInput) : "Local Generator",
      model: hasRealTextModelConfig ? textModelName(runtimeInput) : "generation-pipeline"
    }
  });

  try {
    const generated = await generateProjectScriptContent(projectId, runtimeInput);
    const latestTask = await prisma.generationTask.findUnique({ where: { id: taskId }, select: { status: true } });
    if (latestTask?.status === "canceled" || latestTask?.status === "refunded") {
      return { mode: generated.mode as CreationJobResult["mode"] };
    }

    await prisma.$transaction(async (tx) => {
      await tx.scriptDraft.create({
        data: {
          id: generated.script.id,
          projectId,
          name: generated.script.name,
          content: generated.script.content,
          synopsis: generated.script.synopsis,
          version: generated.script.version
        }
      });

      await tx.character.createMany({
        data: generated.characters.map((character) => ({
          id: character.id,
          projectId,
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
        }))
      });

      await tx.asset.createMany({
        data: generated.assets.map((asset) => ({
          id: asset.id,
          projectId,
          type: asset.type,
          name: asset.name,
          description: asset.description,
          prompt: asset.prompt,
          referenceUrl: asset.referenceUrl,
          status: asset.status,
          relatedCharacterId: asset.relatedCharacterId
        }))
      });
      await tx.project.update({
        where: { id: projectId },
        data: {
          status: "scripting",
          intro: generated.script.synopsis,
          storyboards: 0,
          characters: generated.characters.length,
          imageAssets: generated.assets.length,
          creditsSpent: { increment: estimatedCredits }
        }
      });

      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId } });
      await tx.creditAccount.update({
        where: { userId },
        data: {
          frozenBalance: { decrement: estimatedCredits },
          balance: { decrement: estimatedCredits },
          totalConsume: { increment: estimatedCredits }
        }
      });

      await tx.generationTask.update({
        where: { id: taskId },
        data: {
          status: "succeeded",
          progress: 100,
          finalCredits: estimatedCredits,
          provider: generated.mode === "real" ? textProviderName(runtimeInput) : "Local Generator",
          model: generated.mode === "real" ? textModelName(runtimeInput) : "local-script-v1"
        }
      });

      await tx.creditTransaction.create({
        data: {
          id: `tx_${Date.now()}_consume`,
          userId,
          projectId,
          taskId,
          type: "consume",
          amount: -estimatedCredits,
          balanceAfter: account.balance - estimatedCredits,
          description: "生成任务正式扣费"
        }
      });
    });

    return { mode: generated.mode };
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      const task = await tx.generationTask.findUnique({ where: { id: taskId }, select: { status: true } });
      if (task?.status === "canceled" || task?.status === "refunded") return;
      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId } });
      await tx.creditAccount.update({
        where: { userId },
        data: {
          frozenBalance: { decrement: estimatedCredits }
        }
      });
      await tx.generationTask.update({
        where: { id: taskId },
        data: {
          status: "failed",
          progress: 0,
          errorReason: error instanceof Error ? error.message : "生成失败"
        }
      });
      await tx.creditTransaction.create({
        data: {
          id: `tx_${Date.now()}_refund`,
          userId,
          projectId,
          taskId,
          type: "refund",
          amount: estimatedCredits,
          balanceAfter: account.balance,
          description: "生成失败，退回冻结积分"
        }
      });
    });
    throw error;
  }
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function buildRedisConnectionOptions() {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const url = new URL(redisUrl);
  return {
    host: url.hostname || "localhost",
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null
  };
}

