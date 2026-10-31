import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { StoryFact } from "@aifilm/shared";
import { ContentMutationError, withIdleContentProject } from "./contentMutation.js";

export const factInput = z.object({
  subject: z.string().trim().min(1).max(120), predicate: z.string().trim().min(1).max(120), value: z.string().trim().min(1).max(1500),
  validFrom: z.number().int().min(1).max(100000).default(1),
  validTo: z.number().int().min(1).max(100000).nullable().default(null),
  knownBy: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  status: z.enum(["candidate", "confirmed", "locked", "rejected"]).default("candidate"),
  expectedRevision: z.number().int().positive().optional()
}).refine(x => x.validTo === null || x.validTo >= x.validFrom, "结束时间不能早于起始时间");

export function relevantFacts<T extends Pick<StoryFact, "status" | "validFrom" | "validTo" | "knownBy">>(facts: T[], storyTime: number, perspective?: string): T[] {
  return facts.filter(f => ["confirmed", "locked"].includes(f.status) && f.validFrom <= storyTime && (f.validTo === null || f.validTo >= storyTime)
    && (!perspective || f.knownBy.length === 0 || f.knownBy.includes(perspective)));
}
export function factConflict(a: Pick<StoryFact, "subject" | "predicate" | "value" | "validFrom" | "validTo">, b: typeof a) {
  return a.subject === b.subject && a.predicate === b.predicate && a.value !== b.value
    && a.validFrom <= (b.validTo ?? Infinity) && b.validFrom <= (a.validTo ?? Infinity);
}
export async function saveFact(userId: string, contentProjectId: string, raw: unknown, id?: string) {
  const input = factInput.parse(raw);
  return withIdleContentProject(userId, contentProjectId, async tx => {
    const existing = id ? await tx.storyFact.findFirst({ where: { id, contentProjectId } }) : null;
    if (id && !existing) throw new ContentMutationError(404, "设定不存在");
    if (existing && input.expectedRevision !== existing.revision) throw new ContentMutationError(409, "设定已有更新，请刷新后核对。");
    const project = await tx.contentProject.findUniqueOrThrow({ where: { id: contentProjectId } });
    const { expectedRevision: _expected, ...data } = input;
    if (["locked", "confirmed"].includes(data.status)) {
      const locked = await tx.storyFact.findMany({ where: { contentProjectId, status: "locked", ...(id ? { id: { not: id } } : {}) } });
      if (locked.some(f => factConflict(f, data))) throw new ContentMutationError(409, "与作者锁定设定冲突。请先修订原设定的有效范围，再确认新设定。");
    }
    if (existing) await tx.storyFact.update({ where: { id: existing.id }, data: { status: "superseded", revision: { increment: 1 } } });
    const row = await tx.storyFact.create({ data: {
      id: `fact_${crypto.randomUUID()}`, contentProjectId, ...data,
      sourceType: existing?.sourceType ?? "author", sourceId: existing?.sourceId ?? contentProjectId,
      sourceVersion: existing?.sourceVersion ?? project.revision, supersedesId: id,
      revision: 1
    } });
    await tx.contentProject.update({ where: { id: contentProjectId }, data: { revision: { increment: 1 } } });
    await tx.creatorRun.updateMany({ where: { contentProjectId, status: { in: ["pending", "needs_repair", "awaiting_review"] } }, data: { status: "failed", error: "作品设定已更新，请按新版本创建执行计划。" } });
    if (["confirmed", "locked"].includes(data.status) || (existing && ["confirmed", "locked"].includes(existing.status))) {
      await tx.scriptVersion.updateMany({ where: { contentProjectId, status: { in: ["draft", "confirmed"] } }, data: { status: "stale" } });
      await tx.productionEpisode.updateMany({ where: { contentProjectId }, data: { status: "stale" } });
    }
    return row;
  });
}

export async function collectFactCandidates(tx: Prisma.TransactionClient, contentProjectId: string, updates: unknown[], source: { id: string; version: number; type: string; storyTime: number }) {
  const locked = await tx.storyFact.findMany({ where: { contentProjectId, status: "locked" } });
  for (const update of updates.slice(0, 40)) {
    const parsed = factInput.safeParse(typeof update === "string"
      ? { subject: "故事", predicate: "事件", value: update, validFrom: source.storyTime }
      : { validFrom: source.storyTime, ...(update && typeof update === "object" ? update : {}), status: "candidate" });
    if (!parsed.success) continue;
    const { expectedRevision: _expected, ...fact } = parsed.data;
    await tx.storyFact.create({ data: {
      ...fact, status: "candidate", id: `fact_${crypto.randomUUID()}`, contentProjectId,
      sourceId: source.id, sourceVersion: source.version, sourceType: source.type,
      // Conflicts remain candidates; generated output never changes a locked row.
      predicate: fact.predicate, supersedesId: locked.find(row => factConflict(row, fact))?.id
    } });
  }
}
export async function invalidateSourceFacts(tx: Prisma.TransactionClient, contentProjectId: string, sourceId: string) {
  await tx.storyFact.updateMany({ where: { contentProjectId, sourceId, status: { in: ["candidate", "confirmed"] } }, data: { status: "stale", revision: { increment: 1 } } });
  // Locked facts remain author constraints even if the source is edited.
}
