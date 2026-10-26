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

/** A folded story page with a dialogue frame, drawn on the same 24-unit grid. */
export function StudioMark({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path d="M5 3h10l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    <path d="M15 3v5h5M7 12h9v4h-4l-3 2v-2H7v-4Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
  </svg>;
}
