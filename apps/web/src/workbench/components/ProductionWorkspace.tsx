import type { ReactNode } from "react";
import { EntityRail } from "./EntityRail";
import { Inspector } from "./Inspector";
import { MediaCanvas } from "./MediaCanvas";
import { useWorkbench } from "../WorkbenchContext";

interface ProductionWorkspaceProps {
  rail: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
  railOpen?: boolean;
  inspectorOpen?: boolean;
  onCloseRail?: () => void;
  onCloseInspector?: () => void;
}

export function ProductionWorkspace({
  rail,
  canvas,
  inspector,
  railOpen,
  inspectorOpen,
  onCloseRail,
  onCloseInspector
}: ProductionWorkspaceProps) {
  const { state, workflow } = useWorkbench();
  const stage = {
    content: { title: "打磨故事，让每一场戏成立", detail: "对照剧情与对白，确认内容后建立镜头结构。", stat: `${workflow?.project.episodes ?? 0} 集内容` },
    assets: { title: "建立属于这部作品的视觉档案", detail: "先确认角色和场景，再将统一设定用于分镜。", stat: `${workflow?.characters.length ?? 0} 个角色` },
    shots: { title: "把故事，变成连续的画面", detail: "逐镜核对脚本、首帧和视频，保留每次生成的版本。", stat: `${workflow?.storyboards.length ?? 0} 个镜头` },
    delivery: { title: "让画面与声音，汇成一部作品", detail: "检查可用片段，完成配音、字幕与最终导出。", stat: `${workflow?.project.videoRatio || "9:16"} 画幅` }
  }[state.activeStage];
  return (
    <main className="wb-workspace" data-stage={state.activeStage}>
      <EntityRail open={railOpen} onClose={onCloseRail}>{rail}</EntityRail>
      <MediaCanvas><div className="wb-stage-intro"><div><strong>{stage.title}</strong><p>{stage.detail}</p></div><span>{stage.stat}</span></div>{canvas}</MediaCanvas>
      <Inspector open={inspectorOpen} onClose={onCloseInspector}>{inspector}</Inspector>
    </main>
  );
}
