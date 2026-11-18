export type CineMediaTier = "4k" | "2k" | "fast";

const fallbackOrder: Record<CineMediaTier, CineMediaTier[]> = {
  "4k": ["4k", "2k", "fast"],
  "2k": ["2k", "fast"],
  fast: ["fast"]
};

export function normalizeMediaTier(value: string | undefined): CineMediaTier {
  return value === "2k" || value === "fast" || value === "4k" ? value : "fast";
}

export function resolveMediaTier(preferredTier: CineMediaTier, saveData: boolean, effectiveType?: string): CineMediaTier {
  if (preferredTier === "fast") return "fast";
  if (saveData || effectiveType === "slow-2g" || effectiveType === "2g") return "fast";
  if (preferredTier === "4k" && effectiveType === "3g") return "2k";
  return preferredTier;
}

export function buildMediaCandidates(name: string, preferredTier: CineMediaTier, baseUrl: string): string[] {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  return fallbackOrder[preferredTier].map((tier) => `${cleanBaseUrl}/media/cineart-home/${name}_${tier}.mp4`);
}
