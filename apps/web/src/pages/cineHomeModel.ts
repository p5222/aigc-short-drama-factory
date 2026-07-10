export type CineMediaTier = "4k" | "2k" | "fast";

export interface CineCardPose {
  x: number;
  y: number;
  z: number;
  rotateY: number;
  rotateZ: number;
  scale: number;
  opacity: number;
  zIndex: number;
}

const fallbackOrder: Record<CineMediaTier, CineMediaTier[]> = {
  "4k": ["4k", "2k", "fast"],
  "2k": ["2k", "fast"],
  fast: ["fast"]
};

export function normalizeMediaTier(value: string | undefined): CineMediaTier {
  return value === "2k" || value === "fast" || value === "4k" ? value : "4k";
}

export function buildMediaCandidates(name: string, preferredTier: CineMediaTier, baseUrl: string): string[] {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  return fallbackOrder[preferredTier].map((tier) => `${cleanBaseUrl}/media/cineart-home/${name}_${tier}.mp4`);
}

export function relativeCardOffset(index: number, activeIndex: number, total: number): number {
  let offset = index - activeIndex;
  if (offset > total / 2) offset -= total;
  if (offset < -total / 2) offset += total;
  return offset;
}

export function getCardPose(index: number, activeIndex: number, expanded: boolean, total: number): CineCardPose {
  const offset = relativeCardOffset(index, activeIndex, total);
  const depth = Math.abs(offset);
  const isActive = depth === 0;

  if (expanded) {
    const x = offset === 0 ? 0 : Math.sign(offset) * (depth === 1 ? 124 : 220);
    return {
      x,
      y: isActive ? -20 : depth === 1 ? 14 : 34,
      z: isActive ? 120 : -depth * 18,
      rotateY: offset * -5,
      rotateZ: offset * 7,
      scale: isActive ? 1.04 : depth === 1 ? 0.94 : 0.88,
      opacity: isActive ? 1 : depth === 1 ? 0.9 : 0.78,
      zIndex: isActive ? 90 : 70 - depth * 10
    };
  }

  return {
    x: offset * 20,
    y: isActive ? -6 : depth === 1 ? 4 : 10,
    z: isActive ? 120 : -depth * 24,
    rotateY: isActive ? 0 : offset * -2,
    rotateZ: offset * 3,
    scale: isActive ? 1 : depth === 1 ? 0.94 : 0.88,
    opacity: isActive ? 1 : depth === 1 ? 0.88 : 0.72,
    zIndex: isActive ? 90 : 70 - depth * 10
  };
}

export function shouldCorrectDrift(backgroundTime: number, cardTime: number, toleranceSeconds = 0.12): boolean {
  return Math.abs(backgroundTime - cardTime) > toleranceSeconds;
}
