import type { ProjectWorkflow, StoryboardShot, TaskStatus, TaskType } from "@aifilm/shared";

export {
  buildTimelineClipLayout,
  collectEpisodeNumbers,
  filterSceneRows,
  resolveSceneSelection
} from "../pages/projectWorkbenchModel.ts";
export type {
  SceneListFilter,
  TimelineClipLayout,
  WorkbenchSceneRowLike
} from "../pages/projectWorkbenchModel.ts";

export type WorkbenchStage = "content" | "assets" | "shots" | "delivery";
export type ShotMode = "table" | "image" | "video";
export type SceneKey = { source: "derived" | "storyboard"; value: string };
export type ActiveAsset = { type: "character" | "scene"; id: string };

export interface WorkbenchCapabilities {
  autosave: boolean;
  singleShotVideo: boolean;
  timelineEdit: boolean;
  shotCrud: boolean;
  perRunModelOverride: boolean;
}

export const RELEASE_A_CAPABILITIES: Readonly<WorkbenchCapabilities> = Object.freeze({
  autosave: false,
  singleShotVideo: false,
  timelineEdit: false,
  shotCrud: false,
  perRunModelOverride: false
});

export interface WorkbenchState {
  activeStage: WorkbenchStage;
  activeEpisodeNo: number | null;
  activeSceneKey: SceneKey | null;
  activeAsset: ActiveAsset | null;
  activeShotId: string | null;
  selectedShotIds: string[];
  shotMode: ShotMode;
  dirtyEntityKey: string | null;
  inspectorOpen: boolean;
}

export interface WorkbenchStateInitializers extends Partial<WorkbenchState> {
  episodeNo?: number | null;
  sceneKey?: SceneKey | null;
  shotId?: string | null;
}

export type WorkbenchAction =
  | { type: "set-stage"; stage: WorkbenchStage }
  | { type: "set-episode"; episodeNo: number | null; storyboards: StoryboardShot[] }
  | { type: "set-scene"; sceneKey: SceneKey | null; storyboards: StoryboardShot[] }
  | { type: "set-asset"; asset: ActiveAsset | null }
  | { type: "set-shot"; shotId: string | null }
  | { type: "set-selected-shots"; shotIds: string[] }
  | { type: "set-shot-mode"; mode: ShotMode }
  | { type: "set-dirty-entity"; entityKey: string | null }
  | { type: "set-inspector-open"; open: boolean }
  | { type: "reconcile-workflow"; storyboards: StoryboardShot[] };

export interface TaskTypeSummary {
  type: TaskType;
  total: number;
  byStatus: Partial<Record<TaskStatus, number>>;
}

export function derivedScene(value: string): SceneKey {
  return { source: "derived", value };
}

export function storyboardScene(value: string): SceneKey {
  return { source: "storyboard", value };
}

export function createWorkbenchState(initial: WorkbenchStateInitializers = {}): WorkbenchState {
  return {
    activeStage: initial.activeStage ?? "content",
    activeEpisodeNo: initial.activeEpisodeNo ?? initial.episodeNo ?? null,
    activeSceneKey: initial.activeSceneKey ?? initial.sceneKey ?? null,
    activeAsset: initial.activeAsset ?? null,
    activeShotId: initial.activeShotId ?? initial.shotId ?? null,
    selectedShotIds: [...(initial.selectedShotIds ?? [])],
    shotMode: initial.shotMode ?? "table",
    dirtyEntityKey: initial.dirtyEntityKey ?? null,
    inspectorOpen: initial.inspectorOpen ?? true
  };
}

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "set-stage":
      return {
        ...state,
        activeStage: action.stage,
        selectedShotIds: state.activeStage === "shots" && action.stage !== "shots" ? [] : state.selectedShotIds
      };
    case "set-episode": {
      if (action.episodeNo === null) {
        return { ...state, activeEpisodeNo: null, activeSceneKey: null, activeShotId: null };
      }
      return reconcileSelection({ ...state, activeEpisodeNo: action.episodeNo }, action.storyboards);
    }
    case "set-scene": {
      if (action.sceneKey === null) {
        return { ...state, activeSceneKey: null, activeShotId: null };
      }
      return reconcileSelection({ ...state, activeSceneKey: action.sceneKey }, action.storyboards);
    }
    case "set-asset":
      return { ...state, activeAsset: action.asset };
    case "set-shot":
      return { ...state, activeShotId: action.shotId };
    case "set-selected-shots":
      return { ...state, selectedShotIds: [...action.shotIds] };
    case "set-shot-mode":
      return { ...state, shotMode: action.mode };
    case "set-dirty-entity":
      return { ...state, dirtyEntityKey: action.entityKey };
    case "set-inspector-open":
      return { ...state, inspectorOpen: action.open };
    case "reconcile-workflow":
      return reconcileSelection(state, action.storyboards);
  }
}

export function reconcileSelection(state: WorkbenchState, storyboards: StoryboardShot[]): WorkbenchState {
  const episodes = [...new Set(storyboards.map((shot) => shot.episodeNo))].sort((a, b) => a - b);
  const activeEpisodeNo = state.activeEpisodeNo !== null && episodes.includes(state.activeEpisodeNo)
    ? state.activeEpisodeNo
    : episodes[0] ?? null;

  const episodeShots = activeEpisodeNo === null
    ? []
    : storyboards.filter((shot) => shot.episodeNo === activeEpisodeNo);
  const sceneKeys = [...new Set(episodeShots.map((shot) => `${shot.episodeNo}:${shot.sceneNo}`))];
  const requestedSceneValue = state.activeSceneKey?.source === "storyboard" ? state.activeSceneKey.value : null;
  const activeSceneValue = requestedSceneValue && sceneKeys.includes(requestedSceneValue)
    ? requestedSceneValue
    : sceneKeys[0] ?? null;
  const activeSceneKey = activeSceneValue ? storyboardScene(activeSceneValue) : null;

  const sceneShotIds = activeSceneValue
    ? episodeShots
      .filter((shot) => `${shot.episodeNo}:${shot.sceneNo}` === activeSceneValue)
      .map((shot) => shot.id)
    : [];
  const activeShotId = state.activeShotId && sceneShotIds.includes(state.activeShotId)
    ? state.activeShotId
    : sceneShotIds[0] ?? null;
  const validShotIds = new Set(storyboards.map((shot) => shot.id));

  return {
    ...state,
    activeEpisodeNo,
    activeSceneKey,
    activeShotId,
    selectedShotIds: state.selectedShotIds.filter((shotId) => validShotIds.has(shotId))
  };
}

export type WorkbenchTheme = "light" | "dark";

export function resolveThemePreference(
  stored: string | null,
  systemPrefersDark: boolean | (() => boolean)
): WorkbenchTheme {
  if (stored === "light" || stored === "dark") return stored;
  const prefersDark = typeof systemPrefersDark === "function" ? systemPrefersDark() : systemPrefersDark;
  return prefersDark ? "dark" : "light";
}

export function buildTaskSummary(workflow: ProjectWorkflow): TaskTypeSummary[] {
  const summaries = new Map<TaskType, TaskTypeSummary>();
  for (const task of workflow.tasks) {
    const summary = summaries.get(task.type) ?? { type: task.type, total: 0, byStatus: {} };
    summary.total += 1;
    summary.byStatus[task.status] = (summary.byStatus[task.status] ?? 0) + 1;
    summaries.set(task.type, summary);
  }
  return [...summaries.values()];
}
