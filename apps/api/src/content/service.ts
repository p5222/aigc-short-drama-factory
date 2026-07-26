import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ContentProductionPackage, ContentProjectMode, ContentProjectSummary, ContentStepStatus, StyleProfile } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { assertUsableScriptOutput, callTextModelJson, extractSceneNames } from "../agents/generator.js";
import { createToonflowScriptPlan, type ToonflowCharacterCard } from "../agents/toonflowAdapter.js";
import { materializePrompt } from "../prompts/runtime.js";
import { normalizeDevelopmentAnalysis, normalizeDevelopmentOutline } from "./normalization.js";

const generatedChapterSchema = z.object({
  title: z.string().min(1), content: z.string().min(100), factUpdates: z.array(z.unknown()).default([]),
  handoff: z.union([z.string(), z.record(z.string(), z.unknown())]).default("")
});

function mapProject(row: any): ContentProjectSummary {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode as ContentProjectMode,
    status: row.status,
    activeStep: row.activeStep,
    styleProfile: row.styleProfile as StyleProfile,
    textProvider: row.textProvider || "manjiao",
    textModel: row.textModel || "gpt-5.5",
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

export async function deleteContentProject(userId: string, contentProjectId: string) {
  const result = await prisma.contentProject.deleteMany({ where: { id: contentProjectId, userId } });
  if (!result.count) throw new Error("内容项目不存在");
}

export interface ContentVersionHistory {
  projectId: string;
  analyses: Array<{ id: string; version: number; status: string; createdAt: string }>;
  outlines: Array<{ id: string; version: number; status: string; title: string; createdAt: string }>;
  chapters: Array<{ chapterNo: number; title: string; latestStatus: string; versions: Array<{ id: string; version: number; status: string; updatedAt: string }> }>;
  scripts: Array<{ id: string; version: number; status: string; createdAt: string }>;
}

// Codex-9：章节与历史版本详情。之前前端只有"当前 API 暂未提供…"占位。
export async function getContentProjectVersions(userId: string, contentProjectId: string): Promise<ContentVersionHistory> {
  const project = await prisma.contentProject.findFirst({
    where: { id: contentProjectId, userId },
    include: {
      analyses: { orderBy: { version: "desc" } },
      outlines: { orderBy: { version: "desc" } },
      chapters: { orderBy: [{ chapterNo: "asc" }, { version: "desc" }] },
      scripts: { orderBy: { version: "desc" } }
    }
  });
  if (!project) throw new Error("内容项目不存在");
  const chaptersByNo = new Map<number, ContentVersionHistory["chapters"][number]>();
  for (const chapter of project.chapters) {
    const entry = chaptersByNo.get(chapter.chapterNo) ?? { chapterNo: chapter.chapterNo, title: chapter.title, latestStatus: chapter.status, versions: [] };
    entry.versions.push({ id: chapter.id, version: chapter.version, status: chapter.status, updatedAt: chapter.updatedAt.toISOString() });
    chaptersByNo.set(chapter.chapterNo, entry);
  }
  return {
    projectId: project.id,
    analyses: project.analyses.map((row) => ({ id: row.id, version: row.version, status: row.status, createdAt: row.createdAt.toISOString() })),
    outlines: project.outlines.map((row) => ({ id: row.id, version: row.version, status: row.status, title: (row.result as unknown as { title?: string } | null)?.title ?? "", createdAt: row.createdAt.toISOString() })),
    chapters: [...chaptersByNo.values()].sort((left, right) => left.chapterNo - right.chapterNo),
    scripts: project.scripts.map((row) => ({ id: row.id, version: row.version, status: row.status, createdAt: row.createdAt.toISOString() }))
  };
}

async function contentTextRuntime(project: { textProvider: string; textModel: string }) {
  const provider = await prisma.modelProvider.findUnique({ where: { id: project.textProvider } });
  return {
    textProvider: project.textProvider || "manjiao",
    textModel: project.textModel || "gpt-5.5",
    apiKey: ["manjiao", "pipp"].includes(project.textProvider) ? undefined : provider?.apiKey ?? undefined,
    baseUrl: provider?.baseUrl ?? undefined
  };
}

export async function updateContentModelRoute(userId: string, contentProjectId: string, input: { textProvider: string; textModel: string }) {
  const provider = await prisma.modelProvider.findFirst({ where: { id: input.textProvider, modality: "text", enabled: true } });
  if (!provider || !provider.models.includes(input.textModel)) throw new Error("所选文本模型不可用");
  const result = await prisma.contentProject.updateMany({ where: { id: contentProjectId, userId }, data: input });
  if (!result.count) throw new Error("内容项目不存在");
  return { textProvider: input.textProvider, textModel: input.textModel };
}

export async function analyzeContentProject(userId: string, contentProjectId: string, input: { intentType: "title" | "genre" | "references"; intent: string; targetWords: number; chapterCount: number; batchSize: number }) {
  const project = await prisma.contentProject.findFirst({ where: { id: contentProjectId, userId } });
  if (!project) throw new Error("内容项目不存在");
  await prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "analysis", status: "running" } });
  try {
    const analysisKey = input.intentType === "title" ? "title_story_planning" : input.intentType === "genre" ? "genre_story_research" : "reference_story_research";
    const analysisPrompt = materializePrompt(analysisKey, { intent: input.intent, targetWords: input.targetWords, chapterCount: input.chapterCount, styleProfile: project.styleProfile });
    const analysisRaw = await callTextModelJson<unknown>({ ...(await contentTextRuntime(project)), system: analysisPrompt.systemPrompt, prompt: analysisPrompt.userPrompt, maxTokens: 5000, label: "爆款结构分析" });
    const analysis = normalizeDevelopmentAnalysis(analysisRaw);
    analysis.evidence.sources = await verifyEvidenceSources(analysis.evidence.sources);
    if (analysis.evidence.mode === "model_search" && !analysis.evidence.sources.some((source) => source.verified)) {
      analysis.evidence.mode = "model_prior";
      analysis.evidence.limitations.push("模型未返回可核验来源，已降级为模型知识参考");
    }
    const version = (await prisma.storyAnalysis.aggregate({ where: { contentProjectId }, _max: { version: true } }))._max.version ?? 0;
    await prisma.$transaction([
      prisma.storyAnalysis.create({ data: { id: `analysis_${crypto.randomUUID()}`, contentProjectId, version: version + 1, status: "confirmed", result: JSON.parse(JSON.stringify({ ...analysis, intentType: input.intentType, intent: input.intent, targetWords: input.targetWords, chapterCount: input.chapterCount, batchSize: input.batchSize })) as Prisma.InputJsonValue, promptSnapshot: analysisPrompt.snapshot as unknown as Prisma.InputJsonValue } }),
      prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "analysis", status: "confirmed" } })
    ]);
    return getContentProductionPackage(userId, contentProjectId);
  } catch (error) {
    logContentStageFailure("analysis", contentProjectId, project, error);
    await prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "analysis", status: "failed" } });
    throw error;
  }
}

export async function generateContentOutline(userId: string, contentProjectId: string) {
  const project = await prisma.contentProject.findFirst({ where: { id: contentProjectId, userId }, include: { analyses: { orderBy: { version: "desc" }, take: 1 } } });
  if (!project || !project.analyses[0]) throw new Error("请先完成结构拆解");
  const analysisResult = project.analyses[0].result as Record<string, unknown>;
  const targetWords = Number(analysisResult.targetWords ?? 20000);
  const chapterCount = Number(analysisResult.chapterCount ?? 10);
  await prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "outline", status: "running" } });
  try {
    const prompt = materializePrompt("same_genre_story_strategy", { analysis: analysisResult, targetWords, chapterCount, styleProfile: project.styleProfile });
    const raw = await callTextModelJson<unknown>({ ...(await contentTextRuntime(project)), system: prompt.systemPrompt, prompt: prompt.userPrompt, maxTokens: 7000, label: "章节大纲" });
    const outline = normalizeDevelopmentOutline(raw);
    // 软化处理：模型偶尔多给/少给一两章不再整单失败，只在偏差过大时才拒绝，
    // 其余情况接受模型实际返回的章节数（下游按 outline.chapters 实际数量生成）。
    if (!outline.chapters.length) throw new Error("模型未返回任何章节，请重试");
    if (Math.abs(outline.chapters.length - chapterCount) > Math.max(2, Math.ceil(chapterCount * 0.3))) {
      throw new Error(`章节大纲数量偏差过大：期望 ${chapterCount} 章，模型返回 ${outline.chapters.length} 章，请重试`);
    }
    if (outline.chapters.length !== chapterCount) {
      console.warn("[content-generation] outline chapter count adjusted", { contentProjectId, expected: chapterCount, actual: outline.chapters.length });
    }
    // 重新编号，保证章节号连续（模型偶尔跳号会导致后续"继续生成"定位错乱）。
    outline.chapters = outline.chapters
      .slice()
      .sort((a, b) => a.chapterNo - b.chapterNo)
      .map((chapter, index) => ({ ...chapter, chapterNo: index + 1 }));
    const version = (await prisma.storyOutline.aggregate({ where: { contentProjectId }, _max: { version: true } }))._max.version ?? 0;
    await prisma.$transaction([
      prisma.storyOutline.create({ data: { id: `outline_${crypto.randomUUID()}`, contentProjectId, version: version + 1, status: "draft", result: JSON.parse(JSON.stringify({ ...outline, targetWords, chapterCount, batchSize: Number(analysisResult.batchSize ?? 2) })) as Prisma.InputJsonValue, promptSnapshot: prompt.snapshot as unknown as Prisma.InputJsonValue } }),
      prisma.contentProject.update({ where: { id: contentProjectId }, data: { title: outline.title, activeStep: "outline", status: "draft" } })
    ]);
    return getContentProductionPackage(userId, contentProjectId);
  } catch (error) {
    logContentStageFailure("outline", contentProjectId, project, error);
    await prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "outline", status: "failed" } });
    throw error;
  }
}

export async function confirmContentOutline(userId: string, contentProjectId: string, input?: { result?: Record<string, unknown> }) {
  const project = await prisma.contentProject.findFirst({ where: { id: contentProjectId, userId }, include: { outlines: { orderBy: { version: "desc" }, take: 1 } } });
  const outline = project?.outlines[0];
  if (!project || !outline) throw new Error("章节大纲不存在");
  const result = input?.result ? normalizeDevelopmentOutline({ ...(outline.result as object), ...input.result }) : normalizeDevelopmentOutline(outline.result);
  await prisma.$transaction([
    prisma.storyOutline.update({ where: { id: outline.id }, data: { status: "confirmed", result: JSON.parse(JSON.stringify({ ...(outline.result as object), ...result })) as Prisma.InputJsonValue } }),
    prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "chapter", status: "confirmed" } })
  ]);
  return getContentProductionPackage(userId, contentProjectId);
}

export async function developContentProject(userId: string, contentProjectId: string, input: { intentType: "title" | "genre" | "references"; intent: string; targetWords: number; chapterCount: number; batchSize: number }) {
  await analyzeContentProject(userId, contentProjectId, input);
  return generateContentOutline(userId, contentProjectId);
}

async function verifyEvidenceSources(sources: Array<{ title: string; url?: string | null; platform?: string | null; verified: boolean }>) {
  return Promise.all(sources.map(async (source) => {
    if (!source.url) return { ...source, verified: false };
    try {
      const url = new URL(source.url);
      if (!/^https?:$/.test(url.protocol)) return { ...source, verified: false };
      const response = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "ManjiaoResearch/1.0" } });
      return { ...source, url: url.toString(), verified: response.ok };
    } catch {
      return { ...source, verified: false };
    }
  }));
}

export async function generateContentChapterBatch(userId: string, contentProjectId: string, input: { startChapter: number; batchSize: number; regenerate?: boolean }) {
  const project = await prisma.contentProject.findFirst({ where: { id: contentProjectId, userId }, include: { outlines: { orderBy: { version: "desc" }, take: 1 }, chapters: { orderBy: [{ chapterNo: "asc" }, { version: "desc" }] } } });
  if (!project) throw new Error("内容项目不存在");
  const outline = normalizeDevelopmentOutline(project.outlines[0]?.result);
  const batchSize = Math.max(2, Math.min(3, input.batchSize));
  const generatedChapterNumbers = new Set(project.chapters.map((chapter) => chapter.chapterNo));
  // regenerate=true：只针对 startChapter 这一章重新生成（写入新版本，不影响其他章）。
  const goals = input.regenerate
    ? outline.chapters.filter((chapter) => chapter.chapterNo === input.startChapter)
    : outline.chapters.filter((chapter) => chapter.chapterNo >= input.startChapter && !generatedChapterNumbers.has(chapter.chapterNo)).slice(0, batchSize);
  if (!goals.length) return getContentProductionPackage(userId, contentProjectId);
  await prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "chapter", status: "running" } });
  let previousHandoff: unknown = project.chapters.filter((chapter, index, all) => all.findIndex((candidate) => candidate.chapterNo === chapter.chapterNo) === index).filter((chapter) => chapter.chapterNo < input.startChapter).at(-1)?.result ?? "这是第一章，无前章交接";
  try {
    for (const goal of goals) {
      const prompt = materializePrompt("chapter_generation", { outline, previousHandoff, chapterGoal: goal, characterState: outline.characters, targetWords: goal.targetWords ?? Math.round(Number((project.outlines[0]?.result as any)?.targetWords ?? 20000) / outline.chapters.length) });
      const generated = generatedChapterSchema.parse(await callTextModelJson<unknown>({ ...(await contentTextRuntime(project)), system: prompt.systemPrompt, prompt: prompt.userPrompt, maxTokens: 7000, label: `第${goal.chapterNo}章正文` }));
      const currentVersion = (await prisma.storyChapter.aggregate({ where: { contentProjectId, chapterNo: goal.chapterNo }, _max: { version: true } }))._max.version ?? 0;
      await prisma.storyChapter.create({ data: { id: `chapter_${crypto.randomUUID()}`, contentProjectId, chapterNo: goal.chapterNo, title: generated.title, status: "confirmed", content: generated.content, result: JSON.parse(JSON.stringify({ factUpdates: generated.factUpdates, handoff: generated.handoff })) as Prisma.InputJsonValue, promptSnapshot: prompt.snapshot as unknown as Prisma.InputJsonValue, version: currentVersion + 1 } });
      previousHandoff = generated.handoff;
    }
    await prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "chapter", status: "confirmed" } });
    return getContentProductionPackage(userId, contentProjectId);
  } catch (error) {
    logContentStageFailure("chapter", contentProjectId, project, error);
    await prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "chapter", status: "failed" } });
    throw error;
  }
}

function logContentStageFailure(stage: "analysis" | "outline" | "chapter", contentProjectId: string, project: { textProvider: string; textModel: string }, error: unknown) {
  const detail = error instanceof z.ZodError
    ? error.issues.slice(0, 8).map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message }))
    : error instanceof Error ? error.message : String(error);
  console.error("[content-generation] stage failed", {
    stage,
    contentProjectId,
    provider: project.textProvider,
    model: project.textModel,
    detail
  });
}

export async function createContentProject(
  userId: string,
  input: { title: string; mode: ContentProjectMode; styleProfile?: StyleProfile; textProvider?: string; textModel?: string }
) {
  const row = await prisma.contentProject.create({
    data: {
      id: `content_${crypto.randomUUID()}`,
      userId,
      title: input.title.trim() || "未命名内容项目",
      mode: input.mode,
      styleProfile: (input.styleProfile ?? {}) as Prisma.InputJsonValue
      , textProvider: input.textProvider || "manjiao"
      , textModel: input.textModel || "gpt-5.5"
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
      analyses: { orderBy: { version: "desc" }, take: 1 },
      outlines: { orderBy: { version: "desc" }, take: 1 },
      chapters: { orderBy: [{ chapterNo: "asc" }, { version: "desc" }] },
      scripts: { orderBy: { version: "desc" }, take: 1 },
      entities: true
    }
  });
  if (!project) throw new Error("内容项目不存在");
  const source = project.sources[0];
  const script = project.scripts[0];
  const analysis = project.analyses[0];
  const outline = project.outlines[0];
  return {
    projectId: project.id,
    source: source ? { id: source.id, kind: source.kind as "novel" | "short_story" | "idea" | "script", title: source.title, content: source.content, updatedAt: source.updatedAt.toISOString() } : undefined,
    analysis: analysis ? { id: analysis.id, version: analysis.version, status: analysis.status as ContentStepStatus, result: analysis.result as Record<string, unknown>, createdAt: analysis.createdAt.toISOString() } : undefined,
    outline: outline ? { id: outline.id, version: outline.version, status: outline.status as ContentStepStatus, result: outline.result as Record<string, unknown>, createdAt: outline.createdAt.toISOString() } : undefined,
    chapters: project.chapters.filter((item, index, all) => all.findIndex((candidate) => candidate.chapterNo === item.chapterNo) === index).map((item) => ({ id: item.id, chapterNo: item.chapterNo, title: item.title, status: item.status as ContentStepStatus, content: item.content, updatedAt: item.updatedAt.toISOString() })),
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
      ...(await contentTextRuntime(project)),
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
