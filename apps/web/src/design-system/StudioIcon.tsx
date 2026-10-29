import { BookOpenText, Clapperboard, Film, ScanFace, type LucideProps } from "lucide-react";
import wordmark from "./manjiao-wordmark.json";

export type StudioStage = "content" | "assets" | "shots" | "delivery";

export const studioStages = [
  { id: "content", label: "故事与剧本", detail: "输入灵感，确认剧本与分镜" },
  { id: "assets", label: "角色与场景", detail: "建立资产，保持视觉一致" },
  { id: "shots", label: "镜头制作", detail: "生成画面、视频与配音" },
  { id: "delivery", label: "成片交付", detail: "检查时间线，导出并审核发布" }
] as const;

const stageIcons = { content: BookOpenText, assets: ScanFace, shots: Clapperboard, delivery: Film };

/** Decorative by default: the adjacent label names the action or stage. */
export function StudioIcon({ stage, size = 20, ...props }: LucideProps & { stage: StudioStage }) {
  const Icon = stageIcons[stage];
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" {...props} />;
}

/** The selected Chinese wordmark. Compact navigation uses its existing 角 glyph. */
export function StudioWordmark({ height = 32, compact = false }: { height?: number; compact?: boolean }) {
  const geometry = compact ? wordmark.compact : wordmark.full;
  return <svg className="studio-wordmark" width={height * geometry.width / geometry.height} height={height} viewBox={`0 0 ${geometry.width} ${geometry.height}`} fill="currentColor" role="img" aria-label="漫角" focusable="false">
    <path d={geometry.path} fillRule="evenodd" />
  </svg>;
}
