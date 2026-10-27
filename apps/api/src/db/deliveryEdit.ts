import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { DeliveryEdit, DeliveryEditClip } from "@aifilm/shared";
import { validateDeliveryClips } from "@aifilm/shared";
import { prisma } from "./client.js";
import { getProjectWorkflow } from "./repository.js";

export class DeliveryEditError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}

export function mapDeliveryEdit(row: { projectId: string; episodeNo: number; revision: number; clips: unknown; updatedAt: Date }): DeliveryEdit {
  return { projectId: row.projectId, episodeNo: row.episodeNo, revision: row.revision,
    clips: row.clips as DeliveryEditClip[], updatedAt: row.updatedAt.toISOString() };
}

export async function saveDeliveryEdit(projectId: string, userId: string,
  input: { episodeNo: number; expectedRevision: number; clips: DeliveryEditClip[] }, db: PrismaClient = prisma): Promise<DeliveryEdit> {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`project-lifecycle:${projectId}`}))`;
    await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} AND "userId" = ${userId} FOR UPDATE`;
    const workflow = await getProjectWorkflow(projectId, userId, tx);
    if (!workflow) throw new DeliveryEditError("项目不存在", 404);
    const previous = await tx.deliveryEdit.findUnique({ where: { projectId_episodeNo: { projectId, episodeNo: input.episodeNo } } });
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (previous?.revision ?? 0)) {
      throw new DeliveryEditError("剪辑已有更新版本，你的修改仍保留。请复制剪辑草稿并刷新核对后再保存。", 409);
    }
    let clips: DeliveryEditClip[];
    try { clips = validateDeliveryClips(workflow, input.episodeNo, input.clips); }
    catch (reason) { throw new DeliveryEditError(reason instanceof Error ? reason.message : "剪辑内容无效"); }
    const row = await tx.deliveryEdit.upsert({ where: { projectId_episodeNo: { projectId, episodeNo: input.episodeNo } },
      create: { id: `edit_${crypto.randomUUID()}`, projectId, episodeNo: input.episodeNo, revision: 1, clips: JSON.parse(JSON.stringify(clips)) },
      update: { revision: { increment: 1 }, clips: JSON.parse(JSON.stringify(clips)) } });
    return mapDeliveryEdit(row);
  });
}
