import "../config/env.js";
import { Queue, QueueEvents, Worker } from "bullmq";
import { processQueuedCreationJob, type CreationJobData, type CreationJobResult, type CreationJobName } from "./creationProcessor.js";
export type { CreationJobData } from "./creationProcessor.js";

export const queueConnection = buildRedisConnectionOptions();

export const generationQueue = new Queue<CreationJobData, CreationJobResult, CreationJobName>("generation", {
  connection: { ...queueConnection, maxRetriesPerRequest: 1, enableOfflineQueue: false }
});

export const generationQueueEvents = new QueueEvents("generation", {
  connection: queueConnection
});

generationQueue.on("error", () => console.error("[generation queue] Redis connection unavailable."));
generationQueueEvents.on("error", () => console.error("[generation events] Redis connection unavailable."));
let worker: Worker<CreationJobData, CreationJobResult, CreationJobName> | undefined;
let workerReady = false;
let workerClient: { status: string } | undefined;
let starting: Promise<void> | undefined;

export function getGenerationWorkerReady() {
  return Boolean(workerReady && workerClient?.status === "ready" && worker?.isRunning() && !worker.isPaused() && !worker.closing);
}

export async function startGenerationWorker(): Promise<void> {
  if (getGenerationWorkerReady()) return;
  if (starting) return starting;
  starting = (async () => {
    if (worker) await worker.close(true).catch(() => undefined);
    workerReady = false;
    workerClient = undefined;
    const nextWorker = new Worker<CreationJobData, CreationJobResult, CreationJobName>(
      "generation", (job, token) => processQueuedCreationJob(job, token),
      { connection: queueConnection, concurrency: Number(process.env.GENERATION_CONCURRENCY ?? 1) }
    );
    worker = nextWorker;
    nextWorker.on("ready", () => { if (worker === nextWorker) workerReady = true; });
    nextWorker.on("error", () => {
      if (worker === nextWorker) workerReady = false;
      console.error("[generation worker] Redis connection unavailable or worker error.");
    });
    nextWorker.on("closed", () => { if (worker === nextWorker) workerReady = false; });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const clients = await Promise.race([
        Promise.all([nextWorker.waitUntilReady(), generationQueueEvents.waitUntilReady()]),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Generation worker startup timed out")), 10_000);
        })
      ]);
      workerClient = clients[0];
      workerReady = true;
    } catch (error) {
      workerReady = false;
      workerClient = undefined;
      await nextWorker.close(true).catch(() => undefined);
      if (worker === nextWorker) worker = undefined;
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  })();
  try { await starting; } finally { starting = undefined; }
}

export async function closeGenerationWorker() {
  if (starting) await starting.catch(() => undefined);
  workerReady = false;
  workerClient = undefined;
  if (worker) await worker.close();
  worker = undefined;
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

