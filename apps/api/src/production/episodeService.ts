import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { analyzeProductionEpisodes, countEffectiveCharacters, resolveNextEpisodeNumbers, type EpisodeSourceType } from "@aifilm/shared";
import { z } from "zod";
import { callTextModelJson } from "../agents/generator.js";
import { prisma } from "../db/client.js";
import { runBilledContentGeneration, withContentGenerationOperation } from "../content/generationBilling.js";
import { materializeProductionPrompt } from "../prompts/production.js";
import { assembleContext } from "../content/contextBudget.js";
import { briefSchema } from "../content/creatorContracts.js";
import { relevantFacts } from "../content/storyMemory.js";
import type { StoryFact } from "@aifilm/shared";

const episodeResultSchema = z.object({
  title: z.string().min(1),
  characters: z.array(z.unknown()).default([]),
  props: z.array(z.unknown()).default([]),
  scenes: z.array(z.unknown()).default([]),
  dialogue: z.array(z.unknown()).default([]),
  voiceOver: z.array(z.unknown()).default([]),
  sounds: z.array(z.unknown()).default([]),
  estimatedSeconds: z.number().positive().default(180),
  preservedFacts: z.array(z.string()).default([]),
  endingHook: z.string().default(""),
  script: z.string().min(100)
});

export interface SourceSlice {
  episodeNo: number;
  start: number;
  end: number;
  content: string;
}

export function planSourceSlices(content: string, sourceType: EpisodeSourceType): SourceSlice[] {
  const maxEpisodes = analyzeProductionEpisodes(content, sourceType).maxEpisodes;
  if (sourceType === "script") {
    const headings = [...content.matchAll(/^\s*第\s*([0-9一二三四五六七八九十百零〇两]+)\s*[集回](?:\s|[：:、.-]|$)/gm)];
    if (headings.length === maxEpisodes) {
      return headings.map((heading, index) => {
        const start = index === 0 ? 0 : heading.index ?? 0;
        const end = headings[index + 1]?.index ?? content.length;
        return { episodeNo: index + 1, start, end, content: content.slice(start, end) };
      });
    }
  }

  // Sentence/paragraph boundaries are preferred to arbitrary character offsets.
  // Unpunctuated material remains whole: inventing a sentence boundary is unsafe.
  const boundaries = [...content.matchAll(/(?:[。！？.!?]+[”’」』"']*\s*|\n[ \t]*\n)/gu)]
    .map(match => match.index! + match[0].length).filter(end => end > 0 && end < content.length);
  const count = Math.min(maxEpisodes, boundaries.length + 1);
  const cuts = [0];
  for (let index = 1; index < count; index += 1) {
    const remaining = count - index - 1;
    const available = boundaries.filter(end => end > cuts.at(-1)!);
    const eligible = available.slice(0, available.length - remaining);
    const target = content.length * index / count;
    const end = eligible.reduce((best, current) => Math.abs(current - target) < Math.abs(best - target) ? current : best, eligible[0]!);
    cuts.push(end);
  }
  cuts.push(content.length);
  return cuts.slice(0, -1).map((start, index) => ({ episodeNo: index + 1, start, end: cuts[index + 1]!, content: content.slice(start, cuts[index + 1]) }));
}

function mapEpisode(row: any) {
  return {
    id: row.id,
    contentProjectId: row.contentProjectId,
    productionProjectId: row.productionProjectId ?? undefined,
    episodeNo: row.episodeNo,
    title: row.title,
    sourceStart: row.sourceStart,
    sourceEnd: row.sourceEnd,
    sourceCharacterCount: row.sourceCharacterCount,
    targetDurationSeconds: row.targetDurationSeconds,
    status: row.status,
    activeScriptVersion: row.activeScriptVersion,
    scripts: row.scripts?.map((script: any) => ({ ...script, structuredResult: script.structuredResult, promptSnapshot: script.promptSnapshot, createdAt: script.createdAt.toISOString() })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

async function ownedProject(userId: string, contentProjectId: string) {
  const project = await prisma.contentProject.findFirst({
    where: { id: contentProjectId, userId },
    include: { sources: { orderBy: { updatedAt: "desc" }, take: 1 }, chapters: { orderBy: [{ chapterNo: "asc" }, { version: "desc" }] } }
  });
  if (!project) throw new Error("内容项目不存在");
  const latestChapters = project.chapters.filter((chapter, index, all) => all.findIndex((candidate) => candidate.chapterNo === chapter.chapterNo) === index);
  const chapterContent = latestChapters.map((chapter) => `第${chapter.chapterNo}章 ${chapter.title}\n${chapter.content}`).join("\n\n");
  const source = project.sources[0];
  const content = chapterContent || source?.content || "";
  if (!content.trim()) throw new Error("请先保存或生成小说内容，再生成分集剧本");
  const sourceType: EpisodeSourceType = source?.kind === "script" ? "script" : "novel";
  return { project, content, sourceType, sourceId: source?.id };
}

async function runtime(project: { textProvider: string; textModel: string }) {
  const provider = await prisma.modelProvider.findUnique({ where: { id: project.textProvider } });
  return {
    textProvider: project.textProvider,
    textModel: project.textModel,
    apiKey: ["manjiao", "pipp"].includes(project.textProvider) ? undefined : provider?.apiKey ?? undefined,
    baseUrl: provider?.baseUrl ?? undefined
  };
}

export async function listEpisodes(userId: string, contentProjectId: string) {
  await ownedProject(userId, contentProjectId);
  const rows = await prisma.productionEpisode.findMany({ where: { contentProjectId }, orderBy: { episodeNo: "asc" }, include: { scripts: { orderBy: { version: "desc" } } } });
  return rows.map(mapEpisode);
}

async function generateOne(userId: string, contentProjectId: string, episodeNo: number, force: boolean) {
  const { project, content, sourceType, sourceId } = await ownedProject(userId, contentProjectId);
  if (briefSchema.safeParse(project.brief).success) throw new Error("短片请在首作工作室生成并确认剧本。");
  const slice = planSourceSlices(content, sourceType).find((item) => item.episodeNo === episodeNo);
  if (!slice) throw new Error(`第 ${episodeNo} 集超出素材可改编上限`);
  const existing = await prisma.productionEpisode.findUnique({ where: { contentProjectId_episodeNo: { contentProjectId, episodeNo } }, include: { scripts: true } });
  if (existing?.activeScriptVersion && existing.status !== "stale" && !force) return mapEpisode(existing);

  const facts = await prisma.storyFact.findMany({ where: { contentProjectId, status: { in: ["confirmed", "locked"] } } });
  const context = assembleContext([
    { id: "allowedSource", label: "本集允许改编范围", content: slice.content, required: true },
    { id: "facts", label: "适用设定与知情范围", content: relevantFacts(facts as StoryFact[], episodeNo), required: true },
    { id: "before", label: "前集衔接背景（禁止改编）", content: content.slice(Math.max(0, slice.start - 800), slice.start), required: false },
    { id: "after", label: "后集背景（禁止提前叙述）", content: content.slice(slice.end, Math.min(content.length, slice.end + 800)), required: false }
  ], { budgetTokens: 96000, reservedOutputTokens: 8000, safetyTokens: 2500 });
  const prompt = await materializeProductionPrompt("episode_adaptation", { episodeNo, duration: 180,
    content: JSON.stringify({ ...context.selected, instruction: "仅改编allowedSource；before/after只是背景，不能挪用或提前揭示；facts须按故事时间与知情范围使用。" }), styleProfile: project.styleProfile });
  return runBilledContentGeneration(project, `内容第${episodeNo}集剧本`, async () => {
    const raw = await callTextModelJson<unknown>({ ...(await runtime(project)), system: prompt.systemPrompt, prompt: prompt.userPrompt, maxTokens: 8000, label: `第 ${episodeNo} 集剧本` });
    return episodeResultSchema.parse(raw);
  }, async (tx, generated) => {
  const previous = await tx.episodeScriptVersion.aggregate({ where: { episode: { contentProjectId, episodeNo } }, _max: { version: true } });
  const nextVersion = (previous._max.version ?? 0) + 1;
  const episodeId = existing?.id ?? `episode_${crypto.randomUUID()}`;
  const snapshot = { ...prompt.snapshot, sourceId, sourceStart: slice.start, sourceEnd: slice.end, sourceType, allowExpansion: false, episodeNo, contextManifest: context.manifest } as unknown as Prisma.InputJsonValue;

    const episode = await tx.productionEpisode.upsert({
      where: { contentProjectId_episodeNo: { contentProjectId, episodeNo } },
      create: { id: episodeId, contentProjectId, productionProjectId: project.productionProjectId, episodeNo, title: generated.title, sourceStart: slice.start, sourceEnd: slice.end, sourceCharacterCount: countEffectiveCharacters(slice.content), targetDurationSeconds: 180, status: "confirmed", activeScriptVersion: nextVersion },
      update: { title: generated.title, sourceStart: slice.start, sourceEnd: slice.end, sourceCharacterCount: countEffectiveCharacters(slice.content), status: "confirmed", activeScriptVersion: nextVersion }
    });
    await tx.episodeScriptVersion.create({ data: { id: `episode_script_${crypto.randomUUID()}`, episodeId: episode.id, version: nextVersion, status: "confirmed", content: generated.script, structuredResult: generated as unknown as Prisma.InputJsonValue, promptSnapshot: snapshot } });
    await tx.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "script", status: "confirmed" } });
    const saved = await tx.productionEpisode.findUniqueOrThrow({ where: { id: episode.id }, include: { scripts: { orderBy: { version: "desc" } } } });
    return mapEpisode(saved);
  });
}

export async function generateEpisodes(userId: string, contentProjectId: string, scope: number | "all") {
  return withContentGenerationOperation(userId, contentProjectId, "内容分集剧本", () => generateEpisodesUnlocked(userId, contentProjectId, scope));
}

async function generateEpisodesUnlocked(userId: string, contentProjectId: string, scope: number | "all") {
  const { content, sourceType } = await ownedProject(userId, contentProjectId);
  const maxEpisodes = planSourceSlices(content, sourceType).length;
  const completed = await prisma.productionEpisode.findMany({ where: { contentProjectId, activeScriptVersion: { gt: 0 }, status: { not: "stale" } }, select: { episodeNo: true } });
  if (completed.length >= maxEpisodes) return { maxEpisodes, generatedEpisodeNos: [], episodes: await listEpisodes(userId, contentProjectId) };
  const episodeNos = resolveNextEpisodeNumbers(maxEpisodes, completed.map((item) => item.episodeNo), scope);
  const results = [];
  for (const episodeNo of episodeNos) results.push(await generateOne(userId, contentProjectId, episodeNo, false));
  return { maxEpisodes, generatedEpisodeNos: episodeNos, episodes: await listEpisodes(userId, contentProjectId) };
}

export async function regenerateEpisode(userId: string, contentProjectId: string, episodeNo: number) {
  return withContentGenerationOperation(userId, contentProjectId, `重生成第${episodeNo}集剧本`, () => generateOne(userId, contentProjectId, episodeNo, true));
}

export async function listEpisodeVersions(userId: string, contentProjectId: string, episodeNo: number) {
  await ownedProject(userId, contentProjectId);
  const episode = await prisma.productionEpisode.findUnique({ where: { contentProjectId_episodeNo: { contentProjectId, episodeNo } }, include: { scripts: { orderBy: { version: "desc" } } } });
  if (!episode) throw new Error("分集不存在");
  return mapEpisode(episode).scripts ?? [];
}

export async function activateEpisodeVersion(userId: string, contentProjectId: string, episodeNo: number, version: number) {
  await ownedProject(userId, contentProjectId);
  const episode = await prisma.productionEpisode.findUnique({ where: { contentProjectId_episodeNo: { contentProjectId, episodeNo } }, include: { scripts: true } });
  if (!episode || !episode.scripts.some((item) => item.version === version)) throw new Error("分集版本不存在");
  const updated = await prisma.productionEpisode.update({ where: { id: episode.id }, data: { activeScriptVersion: version, status: "confirmed" }, include: { scripts: { orderBy: { version: "desc" } } } });
  return mapEpisode(updated);
}
