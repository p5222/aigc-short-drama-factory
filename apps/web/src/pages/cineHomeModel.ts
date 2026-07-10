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

export function relativeCardOffset(index: number, activeIndex: number, total: number): number {
  let offset = index - activeIndex;
  if (offset > total / 2) offset -= total;
  if (offset < -total / 2) offset += total;
  return offset;
}

export function nextCardIndex(index: number, direction: -1 | 1, total: number): number {
  return (index + direction + total) % total;
}

export function shouldReleasePreparedSlot(visibleSlot: number, preparedSlot: number): boolean {
  return visibleSlot !== preparedSlot;
}

export function getCardPose(index: number, activeIndex: number, expanded: boolean, total: number): CineCardPose {
  const offset = relativeCardOffset(index, activeIndex, total);
  const depth = Math.abs(offset);
  const isActive = depth === 0;

  if (expanded) {
    const x = offset === 0 ? 0 : Math.sign(offset) * (depth === 1 ? 110 : 180);
    return {
      x,
      y: isActive ? -20 : depth === 1 ? 14 : 34,
      z: isActive ? 0 : -depth * 18,
      rotateY: isActive ? 0 : offset * -5,
      rotateZ: offset * 7,
      scale: isActive ? 1.04 : depth === 1 ? 0.94 : 0.88,
      opacity: isActive ? 1 : depth === 1 ? 0.9 : 0.78,
      zIndex: isActive ? 90 : 70 - depth * 10
    };
  }

  return {
    x: offset * 22,
    y: isActive ? -6 : depth === 1 ? 4 : 10,
    z: isActive ? 0 : -depth * 24,
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
