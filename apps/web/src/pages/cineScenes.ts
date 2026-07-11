import type { PublicScene } from "./PublicShowcase";
import { buildMediaCandidates, normalizeMediaTier, resolveMediaTier } from "./cineHomeModel";

export interface CineScene extends PublicScene {
  mediaName: string;
  videoCandidates: string[];
  cardVideoUrl: string;
}

const baseUrl = (import.meta.env.VITE_CINE_ASSET_BASE_URL ?? "").replace(/\/+$/, "");
const connection = typeof navigator === "undefined"
  ? undefined
  : (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
const preferredTier = resolveMediaTier(
  normalizeMediaTier(import.meta.env.VITE_CINE_MEDIA_TIER),
  connection?.saveData === true,
  connection?.effectiveType
);

function createScene(input: Omit<CineScene, "videoUrl" | "videoCandidates" | "cardVideoUrl">): CineScene {
  const videoCandidates = buildMediaCandidates(input.mediaName, preferredTier, baseUrl);
  const cardVideoUrl = buildMediaCandidates(input.mediaName, "fast", baseUrl)[0];
  return { ...input, videoUrl: videoCandidates[0], videoCandidates, cardVideoUrl };
}

export const cineScenes: CineScene[] = [
  createScene({
    id: "01",
    mediaName: "desert",
    posterUrl: `${baseUrl}/media/cineart-home/desert_poster.jpg`,
    eyebrow: "CINE·CAM 01",
    meta: "SHOT-LEVEL PRECISION",
    title: { cn: "分镜级精准控制", en: "Shot-level precision" },
    scanLabel: { cn: "[ 分镜级精准控制 ]", en: "[ SHOT LOCKED ]" },
    activeLabel: "REC"
  }),
  createScene({
    id: "02",
    mediaName: "photo-w",
    posterUrl: `${baseUrl}/media/cineart-home/photo-w_poster.jpg`,
    eyebrow: "CINE·CAM 02",
    meta: "CHARACTER CONSISTENCY",
    title: { cn: "角色跨镜头一致", en: "Character consistency" },
    scanLabel: { cn: "[ 角色一致设定 ]", en: "[ CHARACTER LOCK ]" }
  }),
  createScene({
    id: "03",
    mediaName: "punk-future",
    posterUrl: `${baseUrl}/media/cineart-home/punk-future_poster.jpg`,
    eyebrow: "CINE·CAM 03",
    meta: "STYLE, LOCKED",
    title: { cn: "风格一键锁定", en: "Style, locked" },
    scanLabel: { cn: "[ 风格一致设定 ]", en: "[ STYLE LOCKED ]" }
  }),
  createScene({
    id: "04",
    mediaName: "girl-booth",
    posterUrl: `${baseUrl}/media/cineart-home/girl-booth_poster.jpg`,
    eyebrow: "CINE·CAM 04",
    meta: "ASSETS THAT COMPOUND",
    title: { cn: "资产沉淀复用", en: "Reusable assets" },
    scanLabel: { cn: "[ 资产沉淀复用 ]", en: "[ ASSET MEMORY ]" }
  }),
  createScene({
    id: "05",
    mediaName: "bicycle-smile",
    posterUrl: `${baseUrl}/media/cineart-home/bicycle-smile_poster.jpg`,
    eyebrow: "CINE·CAM 05",
    meta: "QUEUE IT, SHIP IT",
    title: { cn: "极速出片", en: "Queue it, ship it" },
    scanLabel: { cn: "[ 极速生产闭环 ]", en: "[ FAST PIPELINE ]" }
  })
];
