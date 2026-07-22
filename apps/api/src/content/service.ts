import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { ContentProjectMode, ContentProjectSummary, StyleProfile } from "@aifilm/shared";
import { prisma } from "../db/client.js";

function mapProject(row: any): ContentProjectSummary {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode as ContentProjectMode,
    status: row.status,
    activeStep: row.activeStep,
    styleProfile: row.styleProfile as StyleProfile,
    updatedAt: row.updatedAt.toISOString(),
    sourceCount: row._count.sources,
    chapterCount: row._count.chapters,
    scriptCount: row._count.scripts,
    hasEntities: Boolean(row.entities)
  };
}

export async function listContentProjects(userId: string) {
  const rows = await prisma.contentProject.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { sources: true, chapters: true, scripts: true } },
      entities: { select: { id: true } }
    }
  });
  return rows.map(mapProject);
}

export async function createContentProject(
  userId: string,
  input: { title: string; mode: ContentProjectMode; styleProfile?: StyleProfile }
) {
  const row = await prisma.contentProject.create({
    data: {
      id: `content_${crypto.randomUUID()}`,
      userId,
      title: input.title.trim() || "未命名内容项目",
      mode: input.mode,
      styleProfile: (input.styleProfile ?? {}) as Prisma.InputJsonValue
    },
    include: {
      _count: { select: { sources: true, chapters: true, scripts: true } },
      entities: { select: { id: true } }
    }
  });
  return mapProject(row);
}

export async function addSourceDocument(
  userId: string,
  contentProjectId: string,
  input: { kind: string; title: string; content: string }
) {
  const project = await prisma.contentProject.findFirst({
    where: { id: contentProjectId, userId },
    select: { id: true }
  });
  if (!project) throw new Error("内容项目不存在");

  return prisma.sourceDocument.create({
    data: {
      id: `source_${crypto.randomUUID()}`,
      contentProjectId,
      kind: input.kind,
      title: input.title.trim() || "未命名素材",
      content: input.content
    }
  });
}
