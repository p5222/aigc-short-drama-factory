import { analyzeProductionEpisodes, episodeGenerationOptions, type CreateProjectInput, type SourceEpisodeAnalysis } from "@aifilm/shared";
export type { SourceEpisodeAnalysis } from "@aifilm/shared";

export function analyzeSourceEpisodes(content: string, sourceType: CreateProjectInput["sourceType"]): SourceEpisodeAnalysis {
  return analyzeProductionEpisodes(content, sourceType === "script" ? "script" : "novel");
}

export function episodeScopeOptions(analysis: Pick<SourceEpisodeAnalysis, "maxEpisodes">, completedEpisodeNos: number[] = []): Array<{ value: number; label: string }> {
  const options = episodeGenerationOptions(analysis.maxEpisodes, completedEpisodeNos);
  const all = options.find((option) => option.value === "all");
  if (!all) return [];
  const remaining = options.filter((option) => typeof option.value === "number").length;
  return [
    ...options.filter((option): option is { value: number; label: string } => typeof option.value === "number" && option.value < remaining),
    { value: remaining, label: all.label }
  ];
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
