import type { ExportJob, Project, ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import { isPublishableVideoUrl } from "@aifilm/shared";
import { buildContentSceneRows, collectContentEpisodeNumbers, createWorkbenchState, reconcileSelection, type WorkbenchStage, type WorkbenchState } from "../workbench/model.ts";
import { partitionDeliveryExportJobs } from "../workbench/stages/deliveryModel.ts";
import { createRequestEpoch } from "../lib/creatorNavigation.ts";

/** Workflow changes, explicit refreshes and unmounts share one source-data generation. */
export function createWorkbenchSourceSync() {
  const epoch = createRequestEpoch();
  return {
    invalidate: () => epoch.invalidate(),
    begin() {
      const token = epoch.begin();
      return {
        isCurrent: () => epoch.current(token),
        async read<T>(load: () => Promise<T>, apply: (value: T) => void): Promise<T | undefined> {
          // An onRefresh continuation can already have been replaced by the new workflow effect.
          if (!epoch.current(token)) return;
          try {
            const value = await load();
            if (epoch.current(token)) { apply(value); return value; }
          } catch (error) {
            if (epoch.current(token)) throw error;
          }
        }
      };
    }
  };
}

/** A clip, one episode, or a legacy export of unknown scope cannot finish a project. */
export function isWorkbenchDeliveryComplete(project: Pick<Project, "id" | "status">, storyboards: Pick<StoryboardShot, "id">[], jobs: ExportJob[]): boolean {
  if (project.status !== "completed" || !storyboards.length) return false;
  const current = partitionDeliveryExportJobs(jobs.filter(job => job.projectId === project.id), storyboards.map(shot => shot.id)).current;
  return current.some(job => job.type === "video_export" && job.status === "succeeded" && job.outputKind === "mp4"
    && isPublishableVideoUrl(job.outputUrl) && /\.mp4(?:[?#]|$)/i.test(job.outputUrl));
}

type NavigationState = Pick<WorkbenchState, "activeStage" | "activeEpisodeNo">;
type PageWorkflow = Pick<ProjectWorkflow, "project" | "script" | "storyboards">;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const stages: readonly WorkbenchStage[] = ["content", "assets", "shots", "delivery"];
export const workbenchSessionKey = (projectId: string) => `manjiao:workbench:v1:${encodeURIComponent(projectId)}`;

export function restoreWorkbenchPageState(workflow: PageWorkflow, raw: string | null): WorkbenchState {
  let saved: Partial<NavigationState> = {};
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (record.version === 1 && record.projectId === workflow.project.id) {
        saved = {
          activeStage: stages.includes(record.activeStage as WorkbenchStage) ? record.activeStage as WorkbenchStage : "content",
          activeEpisodeNo: Number.isSafeInteger(record.activeEpisodeNo) && Number(record.activeEpisodeNo) > 0 ? Number(record.activeEpisodeNo) : null
        };
      }
    }
  } catch { /* A corrupt browser preference must not block project recovery. */ }
  const episodes = collectContentEpisodeNumbers(buildContentSceneRows(workflow.script, workflow.storyboards), workflow.project.episodes);
  const activeEpisodeNo = saved.activeEpisodeNo && episodes.includes(saved.activeEpisodeNo) ? saved.activeEpisodeNo : episodes[0] ?? null;
  const state = createWorkbenchState({ activeStage: saved.activeStage ?? "content", activeEpisodeNo });
  // Only navigation is persisted. Rebuild scene/shot selection from the current server data.
  const emptyContentEpisode = state.activeStage === "content" && !workflow.storyboards.some(shot => shot.episodeNo === activeEpisodeNo);
  return workflow.storyboards.length && !emptyContentEpisode ? reconcileSelection(state, workflow.storyboards, workflow.project.episodes) : state;
}

export function createWorkbenchPageSession(storage: () => StorageLike | undefined) {
  return {
    load(workflow: PageWorkflow): WorkbenchState {
      let raw: string | null = null;
      try { raw = storage()?.getItem(workbenchSessionKey(workflow.project.id)) ?? null; } catch { /* unavailable */ }
      return restoreWorkbenchPageState(workflow, raw);
    },
    save(projectId: string, state: NavigationState): boolean {
      try {
        const target = storage();
        if (!target) return false;
        target.setItem(workbenchSessionKey(projectId), JSON.stringify({ version: 1, projectId, activeStage: state.activeStage, activeEpisodeNo: state.activeEpisodeNo }));
        return true;
      } catch { return false; }
    }
  };
}

export const workbenchPageSession = createWorkbenchPageSession(() => window.sessionStorage);
