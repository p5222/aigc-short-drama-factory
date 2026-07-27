import type { CreateProjectInput } from "@aifilm/shared";

export type EpisodeAnalysisBasis = "chapter" | "episode" | "scene" | "length";

export interface SourceEpisodeAnalysis {
  maxEpisodes: number;
  unitCount: number;
  basis: EpisodeAnalysisBasis;
  summary: string;
}

const numberedHeading = /^\s*第\s*([0-9一二三四五六七八九十百零〇两]+)\s*([章集回])(?:\s|[：:、.．]|$)/gm;
const sceneHeading = /^\s*(?:场景\s*)?(?:\d+[-.、]|第\s*[0-9一二三四五六七八九十百零〇两]+\s*场)(?:\s|[：:、.．]|$)/gm;

function headingCount(content: string, kind: "章" | "集"): number {
  const values = new Set<string>();
  for (const match of content.matchAll(numberedHeading)) {
    if (match[2] === kind || (kind === "集" && match[2] === "回")) values.add(match[1]);
  }
  return values.size;
}

export function analyzeSourceEpisodes(content: string, sourceType: CreateProjectInput["sourceType"]): SourceEpisodeAnalysis {
  const normalized = content.trim();
  const episodes = headingCount(normalized, "集");
  if (sourceType === "script" && episodes > 0) {
    return { maxEpisodes: Math.min(20, episodes), unitCount: episodes, basis: "episode", summary: `识别 ${episodes} 集剧本` };
  }

  const chapters = headingCount(normalized, "章");
  if (chapters > 0) {
    return { maxEpisodes: Math.min(20, chapters), unitCount: chapters, basis: "chapter", summary: `识别 ${chapters} 章，按一章一集` };
  }

  if (sourceType === "script") {
    const scenes = new Set(Array.from(normalized.matchAll(sceneHeading), (match) => match[0].trim())).size;
    if (scenes > 0) {
      const maxEpisodes = Math.max(1, Math.min(20, Math.ceil(scenes / 4)));
      return { maxEpisodes, unitCount: scenes, basis: "scene", summary: `识别 ${scenes} 个场次，建议 ${maxEpisodes} 集` };
    }
  }

  const characters = normalized.replace(/\s/g, "").length;
  const maxEpisodes = Math.max(1, Math.min(20, Math.ceil(Math.max(characters, 1) / 2000)));
  return { maxEpisodes, unitCount: characters, basis: "length", summary: `未识别明确结构，按约 2000 字/集估算` };
}

export function episodeScopeOptions(analysis: Pick<SourceEpisodeAnalysis, "maxEpisodes">) {
  const maximum = Math.max(1, analysis.maxEpisodes);
  if (maximum === 1) return [{ value: 1, label: "生成全部 1 集" }];
  const options = [{ value: 1, label: "先生成 1 集" }];
  if (maximum > 2) options.push({ value: 2, label: "先生成前 2 集" });
  options.push({ value: maximum, label: `生成全部 ${maximum} 集` });
  return options;
}

interface SampleEpisode { episodeNo: number; title: string; content: string }
interface SampleManifest {
  title: string;
  sourceType: "script";
  episodes: SampleEpisode[];
  assets?: { characters?: number; scenes?: number; props?: number };
}

export function parseSampleManifest(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("示例清单格式无效");
  const record = value as Partial<SampleManifest>;
  if (!record.title?.trim() || record.sourceType !== "script" || !Array.isArray(record.episodes) || !record.episodes.length) throw new Error("示例清单缺少剧集");
  record.episodes.forEach((episode, index) => {
    if (episode.episodeNo !== index + 1) throw new Error("示例剧集编号必须连续");
    if (!episode.title?.trim() || !episode.content?.trim()) throw new Error(`示例第 ${index + 1} 集内容不完整`);
  });
  return {
    title: record.title.trim(),
    sourceType: "script" as const,
    content: record.episodes.map((episode) => `第${episode.episodeNo}集 ${episode.title}\n${episode.content.trim()}`).join("\n\n"),
    targetEpisodes: record.episodes.length,
    assets: record.assets ?? {}
  };
}
