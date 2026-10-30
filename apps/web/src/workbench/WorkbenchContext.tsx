import { createContext, useContext, useMemo, type Dispatch, type ReactNode } from "react";
import type { ProjectWorkflow } from "@aifilm/shared";
import type { StageGuidance } from "./readinessModel";
import type { WorkbenchStage } from "./model";
import {
  RELEASE_A_CAPABILITIES,
  type WorkbenchAction,
  type WorkbenchCapabilities,
  type WorkbenchState,
  type WorkbenchTheme
} from "./model";

export type WorkbenchSaveState = "unchanged" | "dirty" | "saving" | "error" | "saved" | "sync-required";

export interface WorkbenchContextValue {
  state: WorkbenchState;
  dispatch: Dispatch<WorkbenchAction>;
  capabilities: Readonly<WorkbenchCapabilities>;
  saveState: WorkbenchSaveState;
  workflow?: ProjectWorkflow;
  theme: WorkbenchTheme;
  onThemeChange: (theme: WorkbenchTheme) => void;
  stageGuidance?: StageGuidance;
  onStageChange?: (stage: WorkbenchStage) => void;
}

export interface WorkbenchProviderProps extends Omit<WorkbenchContextValue, "capabilities"> {
  children: ReactNode;
}

export const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);

export function WorkbenchProvider({
  children,
  state,
  dispatch,
  saveState,
  workflow,
  theme,
  onThemeChange,
  stageGuidance,
  onStageChange
}: WorkbenchProviderProps) {
  const value = useMemo<WorkbenchContextValue>(() => ({
    state,
    dispatch,
    capabilities: RELEASE_A_CAPABILITIES,
    saveState,
    workflow,
    theme,
    onThemeChange,
    stageGuidance,
    onStageChange
  }), [dispatch, onThemeChange, saveState, state, theme, workflow, stageGuidance, onStageChange]);

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) {
    throw new Error("useWorkbench must be used within a WorkbenchProvider");
  }
  return context;
}
