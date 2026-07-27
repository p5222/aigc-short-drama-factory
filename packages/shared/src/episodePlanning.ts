export const DEFAULT_SOURCE_CHARACTERS_PER_EPISODE = 20_000;
export const MAX_PRODUCTION_EPISODES = 100;

export type EpisodeSourceType = "novel" | "script";
export type EpisodeAnalysisBasis = "chapter" | "episode" | "scene" | "length";

export interface SourceEpisodeAnalysis {
  maxEpisodes: number;
  unitCount: number;
  basis: EpisodeAnalysisBasis;
  effectiveCharacters: number;
  summary: string;
}

export interface EpisodeGenerationOption {
  value: number | "all";
  label: string;
}

const numberedHeading = /^\s*第\s*([0-9一二三四五六七八九十百零〇两]+)\s*([章集回])(?:\s|[：:、.．]|$)/gm;
const sceneHeading = /^\s*(?:场景\s*)?(?:\d+[-.、]|第\s*[0-9一二三四五六七八九十百零〇两]+\s*场)(?:\s|[：:、.．]|$)/gm;

function headingCount(content: string, kind: "章" | "集") {
  const values = new Set<string>();
  for (const match of content.matchAll(numberedHeading)) {
    if (match[2] === kind || (kind === "集" && match[2] === "回")) values.add(match[1]);
  }
  return values.size;
}

export function countEffectiveCharacters(content: string) {
  return content.replace(/\s|[#*_>`~\-]/g, "").length;
}

export function analyzeProductionEpisodes(content: string, sourceType: EpisodeSourceType): SourceEpisodeAnalysis {
  const normalized = content.trim();
  const effectiveCharacters = countEffectiveCharacters(normalized);
  const explicitEpisodes = headingCount(normalized, "集");
  if (sourceType === "script" && explicitEpisodes > 0) {
    const maxEpisodes = Math.min(MAX_PRODUCTION_EPISODES, explicitEpisodes);
    return { maxEpisodes, unitCount: explicitEpisodes, basis: "episode", effectiveCharacters, summary: `识别 ${explicitEpisodes} 集剧本` };
  }

  const chapters = headingCount(normalized, "章");
  const budget = Math.max(1, Math.min(MAX_PRODUCTION_EPISODES, Math.ceil(Math.max(effectiveCharacters, 1) / DEFAULT_SOURCE_CHARACTERS_PER_EPISODE)));
  if (sourceType === "novel" && chapters > 0) {
    return { maxEpisodes: budget, unitCount: chapters, basis: "chapter", effectiveCharacters, summary: `识别 ${chapters} 章，按约 2 万字素材/集建议 ${budget} 集` };
  }

  if (sourceType === "script") {
    const scenes = new Set(Array.from(normalized.matchAll(sceneHeading), (match) => match[0].trim())).size;
    if (scenes > 0) {
      const maxEpisodes = Math.max(1, Math.min(MAX_PRODUCTION_EPISODES, Math.ceil(scenes / 4)));
      return { maxEpisodes, unitCount: scenes, basis: "scene", effectiveCharacters, summary: `识别 ${scenes} 个场次，建议 ${maxEpisodes} 集` };
    }
  }

  return { maxEpisodes: budget, unitCount: effectiveCharacters, basis: "length", effectiveCharacters, summary: `按约 2 万字小说素材/集建议 ${budget} 集` };
}

export function episodeGenerationOptions(maxEpisodes: number, completedEpisodeNos: number[] = []): EpisodeGenerationOption[] {
  const completed = new Set(completedEpisodeNos.filter((episodeNo) => episodeNo >= 1 && episodeNo <= maxEpisodes));
  const remaining = Math.max(0, maxEpisodes - completed.size);
  if (!remaining) return [];
  const options: EpisodeGenerationOption[] = Array.from({ length: remaining }, (_, index) => ({
    value: index + 1,
    label: `生成接下来 ${index + 1} 集`
  }));
  options.push({ value: "all", label: `生成全部剩余 ${remaining} 集` });
  return options;
}

export function resolveNextEpisodeNumbers(maxEpisodes: number, completedEpisodeNos: number[], scope: number | "all") {
  const completed = new Set(completedEpisodeNos);
  const remaining = Array.from({ length: maxEpisodes }, (_, index) => index + 1).filter((episodeNo) => !completed.has(episodeNo));
  const count = scope === "all" ? remaining.length : scope;
  if (!Number.isInteger(count) || count < 1) throw new Error("生成集数必须大于 0");
  if (count > remaining.length) throw new Error(`仅剩余 ${remaining.length} 集可生成`);
  return remaining.slice(0, count);
}
