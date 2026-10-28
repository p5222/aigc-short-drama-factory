import { BookOpenText, Clapperboard, Film, ScanFace, type LucideProps } from "lucide-react";

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

/** Original Manjiao M: two story frames meet at a corner. Keep export geometry in sync. */
export function StudioMark({ size = 24 }: { size?: number }) {
  return <svg className="studio-mark" width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M3 26V9a6 6 0 0 1 6-6h3l4 9 4-9h3a6 6 0 0 1 6 6v10l-7 7V12l-6 13-6-13v14H3Z" />
    <path d="M25 27h4v-4l-4 4Z" opacity=".55" />
  </svg>;
}
