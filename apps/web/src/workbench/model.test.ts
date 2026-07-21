import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationTask, ProjectWorkflow, StoryboardShot, TaskStatus, TaskType } from "@aifilm/shared";
import {
  RELEASE_A_CAPABILITIES,
  buildTaskSummary,
  createWorkbenchState,
  derivedScene,
  reconcileSelection,
  resolveThemePreference,
  storyboardScene,
  workbenchReducer
} from "./model.ts";

function shot(id: string, episodeNo: number, sceneNo: number): StoryboardShot {
  return {
    id,
    projectId: "project-1",
    episodeNo,
    sceneNo,
    shotNo: 1,
    duration: 3,
    shotSize: "medium",
    cameraAngle: "eye-level",
    cameraMovement: "static",
    characters: [],
    scene: `Scene ${sceneNo}`,
    pictureDesc: "",
    dialogue: "",
    voiceOver: "",
    environmentSound: "",
    soundEffect: "",
    imagePrompt: "",
    videoPrompt: "",
    referenceAssetIds: [],
    status: "pending"
  };
}

function task(id: string, type: TaskType, status: TaskStatus): GenerationTask {
  return {
    id,
    projectId: "project-1",
    type,
    title: id,
    provider: "provider",
    model: "model",
    status,
    progress: status === "succeeded" ? 100 : 20,
    estimatedCredits: 1,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z"
  };
}

function workflow(storyboards: StoryboardShot[], tasks: GenerationTask[] = []): ProjectWorkflow {
  return { storyboards, tasks } as ProjectWorkflow;
}

test("release A hides every unsupported command", () => {
  assert.equal(Object.isFrozen(RELEASE_A_CAPABILITIES), true);
  assert.deepEqual(RELEASE_A_CAPABILITIES, {
    autosave: false,
    singleShotVideo: false,
    timelineEdit: false,
    shotCrud: false,
    perRunModelOverride: false
  });
});

test("stored theme wins and system preference is only the fallback", () => {
  assert.equal(resolveThemePreference("light", true), "light");
  assert.equal(resolveThemePreference("dark", false), "dark");
  assert.equal(resolveThemePreference(null, true), "dark");
  assert.equal(resolveThemePreference("unsupported", false), "light");
});

test("creates conservative state and scene keys", () => {
  assert.deepEqual(createWorkbenchState(), {
    activeStage: "content",
    activeEpisodeNo: null,
    activeSceneKey: null,
    activeAsset: null,
    activeShotId: null,
    selectedShotIds: [],
    shotMode: "table",
    dirtyEntityKey: null,
    inspectorOpen: true
  });
  assert.deepEqual(derivedScene("script-scene-1"), { source: "derived", value: "script-scene-1" });
  assert.deepEqual(storyboardScene("1:2"), { source: "storyboard", value: "1:2" });
});

test("keeps a valid shot while changing mode and visiting delivery", () => {
  const initial = createWorkbenchState({ episodeNo: 1, sceneKey: storyboardScene("1:1"), shotId: "shot-2" });
  const shots = workbenchReducer(initial, { type: "set-stage", stage: "shots" });
  const selected = workbenchReducer(shots, { type: "set-selected-shots", shotIds: ["shot-1", "shot-2"] });
  const video = workbenchReducer(selected, { type: "set-shot-mode", mode: "video" });
  assert.deepEqual(video.selectedShotIds, ["shot-1", "shot-2"]);

  const delivery = workbenchReducer(video, { type: "set-stage", stage: "delivery" });
  assert.equal(delivery.activeShotId, "shot-2");
  assert.deepEqual(delivery.selectedShotIds, []);
  assert.equal(workbenchReducer(delivery, { type: "set-stage", stage: "shots" }).activeShotId, "shot-2");
});

test("updates simple fields and reconciles episode and scene child selections", () => {
  const data = workflow([
    shot("e1-s1-a", 1, 1),
    shot("e2-s2-a", 2, 2),
    shot("e2-s3-a", 2, 3)
  ]);
  let state = createWorkbenchState({ episodeNo: 1, sceneKey: storyboardScene("1:1"), shotId: "e1-s1-a" });
  state = workbenchReducer(state, { type: "set-episode", episodeNo: 2, workflow: data });
  assert.deepEqual(
    [state.activeSceneKey, state.activeShotId],
    [storyboardScene("2:2"), "e2-s2-a"]
  );
  state = workbenchReducer(state, { type: "set-scene", sceneKey: storyboardScene("2:3"), workflow: data });
  assert.equal(state.activeShotId, "e2-s3-a");

  state = workbenchReducer(state, { type: "set-asset", asset: { type: "character", id: "character-1" } });
  state = workbenchReducer(state, { type: "set-shot", shotId: "e2-s3-a" });
  state = workbenchReducer(state, { type: "set-dirty-entity", entityKey: "character:character-1" });
  state = workbenchReducer(state, { type: "set-inspector-open", open: false });
  assert.deepEqual(
    [state.activeAsset, state.activeShotId, state.dirtyEntityKey, state.inspectorOpen],
    [{ type: "character", id: "character-1" }, "e2-s3-a", "character:character-1", false]
  );
});

test("reconciles invalid parents and children to the first real candidates", () => {
  const state = createWorkbenchState({
    episodeNo: 9,
    sceneKey: storyboardScene("9:9"),
    shotId: "missing-shot",
    selectedShotIds: ["missing-shot"]
  });
  const reconciled = reconcileSelection(state, workflow([
    shot("e1-s1-a", 1, 1),
    shot("e1-s1-b", 1, 1),
    shot("e2-s3-a", 2, 3)
  ]));

  assert.equal(reconciled.activeEpisodeNo, 1);
  assert.deepEqual(reconciled.activeSceneKey, storyboardScene("1:1"));
  assert.equal(reconciled.activeShotId, "e1-s1-a");
  assert.deepEqual(reconciled.selectedShotIds, []);
});

test("preserves a valid child and clears scene and shot IDs removed by rebuild", () => {
  const state = createWorkbenchState({ episodeNo: 2, sceneKey: storyboardScene("2:3"), shotId: "e2-s3-b" });
  const kept = reconcileSelection(state, workflow([
    shot("e1-s1-a", 1, 1),
    shot("e2-s3-a", 2, 3),
    shot("e2-s3-b", 2, 3)
  ]));
  assert.equal(kept.activeShotId, "e2-s3-b");

  const rebuilt = workbenchReducer(kept, {
    type: "reconcile-workflow",
    workflow: workflow([shot("e1-s4-a", 1, 4)])
  });
  assert.equal(rebuilt.activeEpisodeNo, 1);
  assert.deepEqual(rebuilt.activeSceneKey, storyboardScene("1:4"));
  assert.equal(rebuilt.activeShotId, "e1-s4-a");
});

test("clears selections when a rebuild has no valid scene or shot keys", () => {
  const state = createWorkbenchState({ episodeNo: 1, sceneKey: derivedScene("obsolete"), shotId: "obsolete-shot" });
  const rebuilt = reconcileSelection(state, workflow([]));
  assert.equal(rebuilt.activeEpisodeNo, null);
  assert.equal(rebuilt.activeSceneKey, null);
  assert.equal(rebuilt.activeShotId, null);
});

test("summarizes only real task type and status counts", () => {
  const summary = buildTaskSummary(workflow([], [
    task("image-1", "image", "running"),
    task("image-2", "image", "succeeded"),
    task("image-3", "image", "succeeded"),
    task("video-1", "video", "failed")
  ]));

  assert.deepEqual(summary, [
    { type: "image", total: 3, byStatus: { running: 1, succeeded: 2 } },
    { type: "video", total: 1, byStatus: { failed: 1 } }
  ]);
  assert.equal("entityProgress" in summary[0], false);
});
