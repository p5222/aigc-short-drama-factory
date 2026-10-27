import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.js";

export class ContentMutationError extends Error {
  constructor(readonly status: 404 | 409, message: string) {
    super(message);
    this.name = "ContentMutationError";
  }
}

/** Use the same advisory lock as lease acquisition. A delete/edit must not race
 * between generation's ownership check and the persisted operation task. */
export async function withIdleContentProject<T>(
  userId: string,
  projectId: string,
  execute: (tx: Prisma.TransactionClient) => Promise<T>,
  db: PrismaClient = prisma
): Promise<T> {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`content-generation:${projectId}`}))`;
    const project = await tx.contentProject.findFirst({ where: { id: projectId, userId }, select: { id: true } });
    if (!project) throw new ContentMutationError(404, "内容项目不存在或无权操作。");
    const active = await tx.generationTask.findFirst({ where: {
      userId, status: { in: ["pending", "running"] },
      OR: [{ jobId: { startsWith: `content:${projectId}:operation:` } }, { jobId: { startsWith: `content:${projectId}:billing:` } }]
    }, select: { id: true } });
    if (active) throw new ContentMutationError(409, "该内容项目仍有生成任务，请等待结束或到生成队列核对后再修改或删除。");
    return execute(tx);
  });
}
