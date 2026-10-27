import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ContentProductionPackage, ContentProjectMode, ContentProjectSummary, ContentStepStatus, StyleProfile } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { assertUsableScriptOutput, callTextModelJson, extractSceneNames } from "../agents/generator.js";
import { createToonflowScriptPlan, type ToonflowCharacterCard } from "../agents/toonflowAdapter.js";
import { materializePrompt } from "../prompts/runtime.js";
import { normalizeDevelopmentAnalysis, normalizeDevelopmentOutline } from "./normalization.js";
import { generateEpisodes } from "../production/episodeService.js";
import { markContentOperationFailed, runBilledContentGeneration, saveContentOperationOutput, withContentGenerationOperation } from "./generationBilling.js";
import { collectHandoffEntities, handoffEntityId } from "./productionHandoff.js";
import { ContentMutationError, withIdleContentProject } from "./contentMutation.js";

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
  return withIdleContentProject(userId, contentProjectId, async tx => {
    await tx.contentProject.delete({ where: { id: contentProjectId } });
  });
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
  return withContentGenerationOperation(userId, contentProjectId, "内容结构拆解", () => analyzeContentProjectUnlocked(userId, contentProjectId, input));
}

async function analyzeContentProjectUnlocked(userId: string, contentProjectId: string, input: { intentType: "title" | "genre" | "references"; intent: string; targetWords: number; chapterCount: number; batchSize: number }) {
  const project = await prisma.contentProject.findFirst({ where: { id: contentProjectId, userId } });
  if (!project) throw new Error("内容项目不存在");
  await prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "analysis", status: "running" } });
  try {
    const analysisKey = input.intentType === "title" ? "title_story_planning" : input.intentType === "genre" ? "genre_story_research" : "reference_story_research";
    const analysisPrompt = materializePrompt(analysisKey, { intent: input.intent, targetWords: input.targetWords, chapterCount: input.chapterCount, styleProfile: project.styleProfile });
    await runBilledContentGeneration(project, "内容结构拆解", async () => {
      const analysisRaw = await callTextModelJson<unknown>({ ...(await contentTextRuntime(project)), system: analysisPrompt.systemPrompt, prompt: analysisPrompt.userPrompt, maxTokens: 5000, label: "爆款结构分析" });
      const analysis = normalizeDevelopmentAnalysis(analysisRaw);
      analysis.evidence.sources = await verifyEvidenceSources(analysis.evidence.sources);
      if (analysis.evidence.mode === "model_search" && !analysis.evidence.sources.some((source) => source.verified)) {
        analysis.evidence.mode = "model_prior";
        analysis.evidence.limitations.push("模型未返回可核验来源，已降级为模型知识参考");
      }
      return analysis;
    }, async (tx, analysis) => {
      const version = (await tx.storyAnalysis.aggregate({ where: { contentProjectId }, _max: { version: true } }))._max.version ?? 0;
      await tx.storyAnalysis.create({ data: { id: `analysis_${crypto.randomUUID()}`, contentProjectId, version: version + 1, status: "confirmed", result: JSON.parse(JSON.stringify({ ...analysis, intentType: input.intentType, intent: input.intent, targetWords: input.targetWords, chapterCount: input.chapterCount, batchSize: input.batchSize })) as Prisma.InputJsonValue, promptSnapshot: analysisPrompt.snapshot as unknown as Prisma.InputJsonValue } });
      await tx.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "analysis", status: "confirmed" } });
    });
    return getContentProductionPackage(userId, contentProjectId);
  } catch (error) {
    logContentStageFailure("analysis", contentProjectId, project, error);
    await markContentOperationFailed("analysis");
    throw error;
  }
}

export async function generateContentOutline(userId: string, contentProjectId: string) {
  return withContentGenerationOperation(userId, contentProjectId, "内容章节大纲", () => generateContentOutlineUnlocked(userId, contentProjectId));
}

async function generateContentOutlineUnlocked(userId: string, contentProjectId: string) {
  const project = await prisma.contentProject.findFirst({ where: { id: contentProjectId, userId }, include: { analyses: { orderBy: { version: "desc" }, take: 1 } } });
  if (!project || !project.analyses[0]) throw new Error("请先完成结构拆解");
  const analysisResult = project.analyses[0].result as Record<string, unknown>;
  const targetWords = Number(analysisResult.targetWords ?? 20000);
  const chapterCount = Number(analysisResult.chapterCount ?? 10);
  await prisma.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "outline", status: "running" } });
  try {
    const prompt = materializePrompt("same_genre_story_strategy", { analysis: analysisResult, targetWords, chapterCount, styleProfile: project.styleProfile });
    await runBilledContentGeneration(project, "内容章节大纲", async () => {
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
    return outline;
    }, async (tx, outline) => {
      const version = (await tx.storyOutline.aggregate({ where: { contentProjectId }, _max: { version: true } }))._max.version ?? 0;
      await tx.storyOutline.create({ data: { id: `outline_${crypto.randomUUID()}`, contentProjectId, version: version + 1, status: "draft", result: JSON.parse(JSON.stringify({ ...outline, targetWords, chapterCount, batchSize: Number(analysisResult.batchSize ?? 2) })) as Prisma.InputJsonValue, promptSnapshot: prompt.snapshot as unknown as Prisma.InputJsonValue } });
      await tx.contentProject.update({ where: { id: contentProjectId }, data: { title: outline.title, activeStep: "outline", status: "draft" } });
    });
    return getContentProductionPackage(userId, contentProjectId);
  } catch (error) {
    logContentStageFailure("outline", contentProjectId, project, error);
    await markContentOperationFailed("outline");
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
  return withContentGenerationOperation(userId, contentProjectId, "内容拆解与大纲", async () => {
    await analyzeContentProject(userId, contentProjectId, input);
    return generateContentOutline(userId, contentProjectId);
  });
}

async function verifyEvidenceSources(sources: Array<{ title: string; url?: string | null; platform?: string | null; verified: boolean }>) {
  // Model-suggested URLs are references to review, not evidence of a verified
  // claim. A successful HEAD request cannot establish factual support.
  return sources.map(source => {
    try {
      const url = new URL(source.url || "");
      return { ...source, url: /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.toString() : null, verified: false };
    } catch { return { ...source, url: null, verified: false }; }
  });
}

export async function generateContentChapterBatch(userId: string, contentProjectId: string, input: { startChapter: number; batchSize: number; regenerate?: boolean }) {
  return withContentGenerationOperation(userId, contentProjectId, "内容章节正文", () => generateContentChapterBatchUnlocked(userId, contentProjectId, input));
}

async function generateContentChapterBatchUnlocked(userId: string, contentProjectId: string, input: { startChapter: number; batchSize: number; regenerate?: boolean }) {
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
      const generated = await runBilledContentGeneration(project, `内容第${goal.chapterNo}章正文`, async () => generatedChapterSchema.parse(await callTextModelJson<unknown>({ ...(await contentTextRuntime(project)), system: prompt.systemPrompt, prompt: prompt.userPrompt, maxTokens: 7000, label: `第${goal.chapterNo}章正文` })), async (tx, generated) => {
        const currentVersion = (await tx.storyChapter.aggregate({ where: { contentProjectId, chapterNo: goal.chapterNo }, _max: { version: true } }))._max.version ?? 0;
        await tx.storyChapter.create({ data: { id: `chapter_${crypto.randomUUID()}`, contentProjectId, chapterNo: goal.chapterNo, title: generated.title, status: "confirmed", content: generated.content, result: JSON.parse(JSON.stringify({ factUpdates: generated.factUpdates, handoff: generated.handoff })) as Prisma.InputJsonValue, promptSnapshot: prompt.snapshot as unknown as Prisma.InputJsonValue, version: currentVersion + 1 } });
        return generated;
      });
      previousHandoff = generated.handoff;
    }
    await saveContentOperationOutput((tx) => tx.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "chapter", status: "confirmed" } }));
    return getContentProductionPackage(userId, contentProjectId);
  } catch (error) {
    logContentStageFailure("chapter", contentProjectId, project, error);
    await markContentOperationFailed("chapter");
    throw error;
  }
}

// Manual edits create a new version and preserve the original generated text.
export async function updateContentChapter(userId: string, contentProjectId: string, chapterNo: number, input: { title?: string; content: string; expectedChapterId?: string }) {
  await withIdleContentProject(userId, contentProjectId, async tx => {
    const latest = await tx.storyChapter.findFirst({ where: { contentProjectId, chapterNo }, orderBy: { version: "desc" } });
    if (!latest) throw new ContentMutationError(404, "章节不存在或尚未生成。");
    const title = input.title?.trim() || latest.title;
    // The response may have been lost after commit. An exact retry is safe even
    // though the caller's base ID now refers to the preceding version.
    if (latest.content === input.content && latest.title === title) return;
    if (input.expectedChapterId && input.expectedChapterId !== latest.id) {
      throw new ContentMutationError(409, "本章已有更新版本。你的修改已保留，请先复制草稿并刷新核对后再编辑。");
    }
    await tx.storyChapter.create({ data: {
      id: `chapter_${crypto.randomUUID()}`, contentProjectId, chapterNo, title, content: input.content,
      status: "confirmed", version: latest.version + 1, promptSnapshot: latest.promptSnapshot as Prisma.InputJsonValue,
      result: { manualEdit: { baseChapterId: latest.id }, handoff: { source: "manual_edit", note: "前章已由作者修改，以以下正文为连续性依据。", content: input.content } }
    } });
    await tx.productionEpisode.updateMany({ where: { contentProjectId }, data: { status: "stale" } });
    await tx.contentProject.update({ where: { id: contentProjectId }, data: { updatedAt: new Date() } });
  });
  return getContentProductionPackage(userId, contentProjectId);
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
      episodes: { orderBy: { episodeNo: "asc" }, include: { scripts: { orderBy: { version: "desc" } } } },
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
    productionProjectId: project.productionProjectId ?? undefined,
    episodes: project.episodes.map((episode) => ({ ...episode, productionProjectId: episode.productionProjectId ?? undefined, status: episode.status as ContentStepStatus, scripts: episode.scripts.map((item) => ({ ...item, status: item.status as ContentStepStatus, structuredResult: item.structuredResult as Record<string, unknown>, promptSnapshot: item.promptSnapshot as Record<string, unknown>, createdAt: item.createdAt.toISOString() })), createdAt: episode.createdAt.toISOString(), updatedAt: episode.updatedAt.toISOString() })),
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

export async function generateContentProductionPackage(userId: string, contentProjectId: string, scope: number | "all" = "all") {
  return withContentGenerationOperation(userId, contentProjectId, "内容分集剧本", () => generateContentProductionPackageUnlocked(userId, contentProjectId, scope));
}

async function generateContentProductionPackageUnlocked(userId: string, contentProjectId: string, scope: number | "all" = "all") {
  if (process.env.CONTENT_EPISODE_PIPELINE !== "legacy") {
    try {
      const project = await prisma.contentProject.findFirst({ where: { id: contentProjectId, userId }, include: { scripts: { orderBy: { version: "desc" }, take: 1 } } });
      if (!project) throw new Error("内容项目不存在");
      await prisma.contentProject.update({ where: { id: project.id }, data: { activeStep: "script", status: "running" } });
      const generated = await generateEpisodes(userId, contentProjectId, scope);
      const scriptContent = generated.episodes.map((episode) => {
        const active = episode.scripts?.find((script: { version: number }) => script.version === episode.activeScriptVersion);
        return active ? `第${episode.episodeNo}集 ${episode.title}\n${active.content}` : "";
      }).filter(Boolean).join("\n\n");
      await saveContentOperationOutput(async (tx) => {
        const latest = await tx.scriptVersion.findFirst({ where: { contentProjectId }, orderBy: { version: "desc" } });
        if (latest?.content === scriptContent) return;
        await tx.scriptVersion.create({ data: { id: `content_script_${crypto.randomUUID()}`, contentProjectId, version: (latest?.version ?? 0) + 1, status: "confirmed", content: scriptContent, result: { episodeCount: generated.episodes.length }, promptSnapshot: { key: "episode_adaptation", allowExpansion: false } } });
      });
      await syncContentToProduction(userId, contentProjectId);
      return getContentProductionPackage(userId, contentProjectId);
    } catch (error) {
      await markContentOperationFailed("script");
      throw error;
    }
  }
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
    await runBilledContentGeneration(project, "内容剧本结构化", async () => {
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
    return { generated, scriptContent, characters, scenes };
    }, async (tx, { generated, scriptContent, characters, scenes }) => {
    const nextVersion = (await tx.scriptVersion.aggregate({ where: { contentProjectId }, _max: { version: true } }))._max.version ?? 0;
    const snapshot = JSON.parse(JSON.stringify({ key: source.kind === "script" ? "script_structure" : "novel_to_script", plan, sourceId: source.id })) as Prisma.InputJsonValue;
      await tx.scriptVersion.create({ data: { id: `content_script_${crypto.randomUUID()}`, contentProjectId, version: nextVersion + 1, status: "confirmed", content: scriptContent, result: { synopsis: generated.synopsis ?? "" }, promptSnapshot: snapshot } });
      await tx.entityCatalog.upsert({
        where: { contentProjectId },
        create: { id: `entity_${crypto.randomUUID()}`, contentProjectId, version: 1, characters, scenes, props: [], promptSnapshot: snapshot },
        update: { version: { increment: 1 }, characters, scenes, props: [], promptSnapshot: snapshot }
      });
      await tx.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "entity", status: "confirmed" } });
    });
    return getContentProductionPackage(userId, contentProjectId);
  } catch (error) {
    await markContentOperationFailed("script");
    throw error;
  }
}

export async function syncContentToProduction(userId: string, contentProjectId: string) {
  return withContentGenerationOperation(userId, contentProjectId, "同步制作项目", () => syncContentToProductionUnlocked(userId, contentProjectId));
}

async function syncContentToProductionUnlocked(userId: string, contentProjectId: string) {
  const content = await prisma.contentProject.findFirst({
    where: { id: contentProjectId, userId },
    include: { scripts: { orderBy: { version: "desc" }, take: 1 }, episodes: { orderBy: { episodeNo: "asc" }, include: { scripts: true } }, outlines: { orderBy: { version: "desc" }, take: 1 }, entities: true }
  });
  if (!content) throw new Error("内容项目不存在");
  const activeScript = content.scripts[0];
  if (!activeScript?.content.trim()) throw new Error("请先生成分集剧本");
  const productionProjectId = content.productionProjectId ?? `proj_${crypto.randomUUID()}`;
  const artStyle = (content.styleProfile as { name?: string } | null)?.name || "AI 自动匹配画风";
  const entities = collectHandoffEntities({ script: activeScript.content, catalog: content.entities, outline: content.outlines[0]?.result, episodes: content.episodes.map((episode) => episode.scripts.find((script) => script.version === episode.activeScriptVersion)?.structuredResult) });
  await saveContentOperationOutput(async (tx) => {
    const existingProject = await tx.project.findUnique({ where: { id: productionProjectId }, include: { scripts: { orderBy: { createdAt: "desc" }, take: 1 } } });
    if (existingProject && existingProject.userId !== userId) throw new Error("关联制作项目不可访问");
    if (existingProject && existingProject.scripts[0]?.content !== activeScript.content && await tx.storyboard.count({ where: { projectId: productionProjectId } }) > 0) {
      throw new Error("关联项目已进入分镜制作，当前剧本与制作版本不同。请先保留现有制作版本，再建立新的内容项目进行改版。");
    }
    await tx.project.upsert({
      where: { id: productionProjectId },
      create: { id: productionProjectId, userId, name: content.title, type: "漫剧改编", intro: "由内容创作同步", sourceType: "script", artStyle, videoRatio: "9:16", status: "scripting", episodes: Math.max(1, content.episodes.length), segmentProfile: "jimeng_15s", episodeDurationSeconds: 180, sourceCharactersPerEpisode: 20000, allowExpansion: false, textProvider: content.textProvider, textModel: content.textModel },
      update: { name: content.title, episodes: Math.max(1, content.episodes.length), allowExpansion: false }
    });
    const existingCharacters = await tx.character.findMany({ where: { projectId: productionProjectId } });
    for (const character of entities.characters) {
      const existing = existingCharacters.find((item) => item.name === character.name);
      const id = existing?.id ?? handoffEntityId("role", productionProjectId, character.name);
      const prompt = [character.name, character.description, artStyle, "角色三视图，正面、侧面、背面，保持人物外观一致，无水印"].join("，");
      await tx.character.upsert({ where: { id }, create: { id, projectId: productionProjectId, name: character.name, identity: character.identity || "剧本角色", appearance: character.appearance || "", costume: character.costume || "", personality: character.personality || "", prompt, negativePrompt: "换脸，多余肢体，文字，水印", consistencyLevel: "high" }, update: {} });
      const roleAsset = await tx.asset.findFirst({ where: { projectId: productionProjectId, relatedCharacterId: id, type: "role" } });
      if (!roleAsset) await tx.asset.create({ data: { id: `asset_${id}`, projectId: productionProjectId, type: "role", name: `${character.name} 角色参考图`, description: character.description, prompt: existing?.prompt || prompt, status: "pending", relatedCharacterId: id } });
    }
    for (const kind of ["scenes", "props"] as const) {
      for (const item of entities[kind]) {
        const type = kind === "scenes" ? "scene" : "prop";
        const existing = await tx.asset.findFirst({ where: { projectId: productionProjectId, type, name: item.name } });
        if (!existing) await tx.asset.create({ data: { id: handoffEntityId(type, productionProjectId, item.name), projectId: productionProjectId, type, name: item.name, description: item.description, prompt: `${item.name}，${item.description}，${artStyle}，${type === "scene" ? "空镜场景参考图" : "道具参考图"}，无文字，无水印`, status: "pending" } });
      }
    }
    const catalog = Object.fromEntries((["characters", "scenes", "props"] as const).map((kind) => [kind, entities[kind].map((item) => ({ id: handoffEntityId(kind, productionProjectId, item.name), name: item.name, description: item.description }))]));
    await tx.entityCatalog.upsert({ where: { contentProjectId }, create: { id: `entity_${crypto.randomUUID()}`, contentProjectId, characters: catalog.characters, scenes: catalog.scenes, props: catalog.props, promptSnapshot: { source: "saved_content_handoff", scriptVersion: activeScript.version } }, update: { characters: catalog.characters, scenes: catalog.scenes, props: catalog.props } });
    await tx.project.update({ where: { id: productionProjectId }, data: { characters: await tx.character.count({ where: { projectId: productionProjectId } }) } });
    await tx.scriptDraft.upsert({
      where: { id: `script_${contentProjectId}_active` },
      create: { id: `script_${contentProjectId}_active`, projectId: productionProjectId, name: `${content.title} 分集剧本`, content: activeScript.content, synopsis: "由内容创作逐集同步", version: activeScript.version },
      update: { projectId: productionProjectId, name: `${content.title} 分集剧本`, content: activeScript.content, version: activeScript.version }
    });
    await tx.productionEpisode.updateMany({ where: { contentProjectId }, data: { productionProjectId } });
    await tx.contentProject.update({ where: { id: contentProjectId }, data: { productionProjectId, activeStep: "entity", status: "confirmed" } });
  });
  return productionProjectId;
}

function asEntityItems(value: Prisma.JsonValue): Array<{ id: string; name: string; description: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { id: string; name: string; description: string } => Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof item.id === "string" && typeof item.name === "string" && typeof item.description === "string"));
}
