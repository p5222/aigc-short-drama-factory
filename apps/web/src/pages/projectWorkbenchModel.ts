import type { StoryboardShot } from "@aifilm/shared";

export type SceneListFilter = "all" | "risk" | "ready" | "draft";

export interface WorkbenchSceneRowLike {
  id: string;
  episodeNo: number;
  status: "locked" | "ready" | "risk" | "draft" | "blocked";
  risk?: string;
}

export function collectEpisodeNumbers(storyboards: StoryboardShot[], fallbackCount = 1) {
  const values = [...new Set(storyboards.map((shot) => Math.max(1, shot.episodeNo || 1)))].sort((a, b) => a - b);
  if (values.length) return values;
  return Array.from({ length: Math.max(1, fallbackCount) }, (_, index) => index + 1);
}

export function filterSceneRows<T extends WorkbenchSceneRowLike>(rows: T[], episodeNo: number, filter: SceneListFilter) {
  return rows.filter((scene) => {
    if (scene.episodeNo !== episodeNo) return false;
    if (filter === "risk") return Boolean(scene.risk) || scene.status === "risk";
    if (filter === "ready") return scene.status === "ready" || scene.status === "locked";
    if (filter === "draft") return scene.status === "draft" || scene.status === "blocked";
    return true;
  });
}

export function resolveSceneSelection<T extends WorkbenchSceneRowLike>(rows: T[], episodeNo: number, filter: SceneListFilter, selectedId?: string) {
  const visibleRows = filterSceneRows(rows, episodeNo, filter);
  const selected = visibleRows.find((scene) => scene.id === selectedId) ?? visibleRows[0];
  return { visibleRows, selectedId: selected?.id ?? "" };
}

export interface TimelineClipLayout {
  id: string;
  index: number;
  start: number;
  duration: number;
  width: number;
}

export function buildTimelineClipLayout(storyboards: StoryboardShot[], pixelsPerSecond = 52, minimumWidth = 96) {
  let cursor = 0;
  return storyboards.map((shot, index) => {
    const duration = Math.max(1, shot.duration || 1);
    const clip = {
      id: shot.id,
      index,
      start: cursor,
      duration,
      width: Math.max(minimumWidth, Math.round(duration * pixelsPerSecond))
    } satisfies TimelineClipLayout;
    cursor += duration;
    return clip;
  });
}
