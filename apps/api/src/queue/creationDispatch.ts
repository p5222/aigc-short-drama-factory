import type { CreateProjectInput } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { generationQueue } from "./generationQueue.js";

/** The DB transaction creates the reservation + input + deterministic job ID.
 * Redis delivery can then be retried without creating another billable task.
 */
export async function enqueueCreationTask(taskId: string) {
  const task = await prisma.generationTask.findUniqueOrThrow({ where: { id: taskId } });
  if (!task.projectId || !task.jobId || !task.requestPayload || task.type !== "text") {
    throw new Error("生成请求缺少持久化快照，请回到创作步骤重新提交");
  }
  if (!["pending", "running"].includes(task.status)) return generationQueue.getJob(task.jobId);
  return generationQueue.add("create-project", {
    taskId, projectId: task.projectId, userId: task.userId,
    input: task.requestPayload as unknown as CreateProjectInput, estimatedCredits: task.estimatedCredits
  }, {
    jobId: task.jobId,
    attempts: Number(process.env.GENERATION_JOB_ATTEMPTS ?? 3),
    backoff: { type: "exponential", delay: Number(process.env.GENERATION_JOB_BACKOFF_MS ?? 5000) },
    removeOnComplete: 100, removeOnFail: 100
  });
}

let dispatching = false;
let dispatchCursor: { createdAt: Date; id: string } | undefined;
export async function recoverCreationDispatches() {
  if (dispatching) return;
  dispatching = true;
  try {
    const tasks = await prisma.generationTask.findMany({
      where: { type: "text", status: { in: ["pending", "running"] }, jobId: { startsWith: "creation-" },
        ...(dispatchCursor ? { OR: [{ createdAt: { gt: dispatchCursor.createdAt } }, { createdAt: dispatchCursor.createdAt, id: { gt: dispatchCursor.id } }] } : {}) },
      select: { id: true, jobId: true, requestPayload: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100
    });
    for (const task of tasks) {
      if (task.requestPayload && !(await generationQueue.getJob(task.jobId!))) await enqueueCreationTask(task.id);
    }
    // Rotate through the pending backlog so the oldest queued page cannot
    // starve later tasks whose first Redis delivery failed.
    const last = tasks.at(-1);
    dispatchCursor = tasks.length === 100 && last ? { createdAt: last.createdAt, id: last.id } : undefined;
  } finally { dispatching = false; }
}
