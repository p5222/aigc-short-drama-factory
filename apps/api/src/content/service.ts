import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { ContentProductionPackage, ContentProjectMode, ContentProjectSummary, ContentStepStatus, StyleProfile } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { assertUsableScriptOutput, callTextModelJson, extractSceneNames } from "../agents/generator.js";
import { createToonflowScriptPlan, type ToonflowCharacterCard } from "../agents/toonflowAdapter.js";

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

  const source = await prisma.sourceDocument.create({
    data: {
      id: `source_${crypto.randomUUID()}`,
      contentProjectId,
      kind: input.kind,
      title: input.title.trim() || "未命名素材",
      content: input.content
    }
  });
  await prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "source", status: "draft" } });
  return source;
}

export async function getContentProductionPackage(userId: string, contentProjectId: string): Promise<ContentProductionPackage> {
  const project = await prisma.contentProject.findFirst({
    where: { id: contentProjectId, userId },
    include: {
      sources: { orderBy: { updatedAt: "desc" }, take: 1 },
      scripts: { orderBy: { version: "desc" }, take: 1 },
      entities: true
    }
  });
  if (!project) throw new Error("内容项目不存在");
  const source = project.sources[0];
  const script = project.scripts[0];
  return {
    projectId: project.id,
    source: source ? { id: source.id, kind: source.kind as "novel" | "short_story" | "idea" | "script", title: source.title, content: source.content, updatedAt: source.updatedAt.toISOString() } : undefined,
    script: script ? { id: script.id, version: script.version, status: script.status as ContentStepStatus, content: script.content, createdAt: script.createdAt.toISOString() } : undefined,
    entities: project.entities ? {
      characters: asEntityItems(project.entities.characters),
      scenes: asEntityItems(project.entities.scenes),
      props: asEntityItems(project.entities.props)
    } : undefined
  };
}

export async function generateContentProductionPackage(userId: string, contentProjectId: string) {
  const project = await prisma.contentProject.findFirst({
    where: { id: contentProjectId, userId },
    include: { sources: { orderBy: { updatedAt: "desc" }, take: 1 }, scripts: { orderBy: { version: "desc" }, take: 1 } }
  });
  if (!project) throw new Error("内容项目不存在");
  const source = project.sources[0];
  if (!source) throw new Error("请先保存素材，再生成剧本");

  await prisma.contentProject.update({ where: { id: project.id }, data: { activeStep: "script", status: "running" } });
  try {
    const input = {
      title: project.title,
      sourceType: source.kind === "script" ? "script" as const : "novel" as const,
      content: source.content,
      mode: "director" as const,
      genre: "AI 自动识别题材",
      videoRatio: "9:16" as const,
      artStyle: (project.styleProfile as { name?: string } | null)?.name || "AI 自动匹配画风",
      targetEpisodes: Math.max(1, Math.min(20, Math.ceil(Math.max(source.content.length, 800) / 2000)))
    };
    const plan = createToonflowScriptPlan(input);
    const generated = await callTextModelJson<{ synopsis?: string; script?: string; characters?: ToonflowCharacterCard[] }>({
      system: "你是漫角内容创作编剧。严格执行用户提示，只输出合法 JSON。",
      prompt: plan.prompt,
      maxTokens: 8000,
      label: source.kind === "script" ? "剧本结构化" : "小说转剧本"
    });
    assertUsableScriptOutput(generated, input.sourceType);
    const scriptContent = generated.script!.trim();
    const characters = (generated.characters ?? []).map((item, index) => ({
      id: `character_${index + 1}`,
      name: item.name.trim(),
      description: [item.identity, item.appearance, item.costume, item.personality].filter(Boolean).join("；")
    }));
    const scenes = extractSceneNames(scriptContent, input.genre).map((name, index) => ({ id: `scene_${index + 1}`, name, description: `${name}，从已确认剧本提取` }));
    const nextVersion = (project.scripts[0]?.version ?? 0) + 1;
    const snapshot = JSON.parse(JSON.stringify({ key: source.kind === "script" ? "script_structure" : "novel_to_script", plan, sourceId: source.id })) as Prisma.InputJsonValue;
    await prisma.$transaction(async (tx) => {
      await tx.scriptVersion.create({ data: { id: `content_script_${crypto.randomUUID()}`, contentProjectId, version: nextVersion, status: "confirmed", content: scriptContent, result: { synopsis: generated.synopsis ?? "" }, promptSnapshot: snapshot } });
      await tx.entityCatalog.upsert({
        where: { contentProjectId },
        create: { id: `entity_${crypto.randomUUID()}`, contentProjectId, version: 1, characters, scenes, props: [], promptSnapshot: snapshot },
        update: { version: { increment: 1 }, characters, scenes, props: [], promptSnapshot: snapshot }
      });
      await tx.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "entity", status: "confirmed" } });
    });
    return getContentProductionPackage(userId, contentProjectId);
  } catch (error) {
    await prisma.contentProject.update({ where: { id: contentProjectId }, data: { status: "failed" } });
    throw error;
  }
}

function asEntityItems(value: Prisma.JsonValue): Array<{ id: string; name: string; description: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { id: string; name: string; description: string } => Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof item.id === "string" && typeof item.name === "string" && typeof item.description === "string"));
}
