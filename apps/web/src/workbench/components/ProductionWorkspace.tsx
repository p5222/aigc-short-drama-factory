import type { ReactNode } from "react";
import { EntityRail } from "./EntityRail";
import { Inspector } from "./Inspector";
import { MediaCanvas } from "./MediaCanvas";

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
  return (
    <main className="wb-workspace">
      <EntityRail open={railOpen} onClose={onCloseRail}>{rail}</EntityRail>
      <MediaCanvas>{canvas}</MediaCanvas>
      <Inspector open={inspectorOpen} onClose={onCloseInspector}>{inspector}</Inspector>
    </main>
  );
}
