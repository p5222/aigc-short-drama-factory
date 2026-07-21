import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationTask, Project, ProjectWorkflow, ScriptDraft, StoryboardShot, TaskStatus, TaskType } from "@aifilm/shared";
import {
  RELEASE_A_CAPABILITIES,
  buildContentSceneRows,
  buildStoryboardGenerationPayload,
  buildTaskSummary,
  collectContentEpisodeNumbers,
  createWorkbenchState,
  derivedScene,
  nextWorkbenchTheme,
  reconcileContentSelection,
  reconcileSelection,
  resolveThemePreference,
  shouldReconcileStoryboardSelection,
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

function script(content: string): ScriptDraft {
  return {
    id: "script-1",
    projectId: "project-1",
    name: "测试剧本",
    content,
    synopsis: "一段测试梗概",
    version: 1,
    createdAt: "2026-07-20T00:00:00.000Z"
  };
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

if (false) {
  // @ts-expect-error Release A capabilities are immutable at compile time.
  RELEASE_A_CAPABILITIES.autosave = true;
}

test("stored theme wins and system preference is only the fallback", () => {
  assert.equal(resolveThemePreference("light", true), "light");
  assert.equal(resolveThemePreference("dark", false), "dark");
  assert.equal(resolveThemePreference(null, true), "dark");
  assert.equal(resolveThemePreference("unsupported", false), "light");
});

test("reads system preference lazily only when storage has no valid theme", () => {
  let systemPreferenceReads = 0;
  const readSystemPreference = () => {
    systemPreferenceReads += 1;
    return false;
  };

  assert.equal(resolveThemePreference("dark", readSystemPreference), "dark");
  assert.equal(systemPreferenceReads, 0);
  assert.equal(resolveThemePreference(null, readSystemPreference), "light");
  assert.equal(systemPreferenceReads, 1);
});

test("returns the opposite theme for a manual toggle", () => {
  assert.equal(nextWorkbenchTheme("light"), "dark");
  assert.equal(nextWorkbenchTheme("dark"), "light");
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

test("isolates selected shots from initializer array mutations", () => {
  const selectedShotIds = ["shot-1"];
  const state = createWorkbenchState({ selectedShotIds });
  selectedShotIds.push("shot-2");
  assert.deepEqual(state.selectedShotIds, ["shot-1"]);
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
  const storyboards = [
    shot("e1-s1-a", 1, 1),
    shot("e2-s2-a", 2, 2),
    shot("e2-s3-a", 2, 3)
  ];
  let state = createWorkbenchState({ episodeNo: 1, sceneKey: storyboardScene("1:1"), shotId: "e1-s1-a" });
  state = workbenchReducer(state, { type: "set-episode", episodeNo: 2, storyboards });
  assert.deepEqual(
    [state.activeSceneKey, state.activeShotId],
    [storyboardScene("2:2"), "e2-s2-a"]
  );
  state = workbenchReducer(state, { type: "set-scene", sceneKey: storyboardScene("2:3"), storyboards });
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

test("explicitly clearing a parent also clears its child context", () => {
  const storyboards = [shot("e1-s1-a", 1, 1)];
  const initial = createWorkbenchState({ episodeNo: 1, sceneKey: storyboardScene("1:1"), shotId: "e1-s1-a" });
  const noScene = workbenchReducer(initial, { type: "set-scene", sceneKey: null, storyboards });
  assert.deepEqual(
    [noScene.activeEpisodeNo, noScene.activeSceneKey, noScene.activeShotId],
    [1, null, null]
  );

  const noEpisode = workbenchReducer(initial, { type: "set-episode", episodeNo: null, storyboards });
  assert.deepEqual(
    [noEpisode.activeEpisodeNo, noEpisode.activeSceneKey, noEpisode.activeShotId],
    [null, null, null]
  );
});

test("reconciles invalid parents and children to the first real candidates", () => {
  const state = createWorkbenchState({
    episodeNo: 9,
    sceneKey: storyboardScene("9:9"),
    shotId: "missing-shot",
    selectedShotIds: ["missing-shot"]
  });
  const reconciled = reconcileSelection(state, [
    shot("e1-s1-a", 1, 1),
    shot("e1-s1-b", 1, 1),
    shot("e2-s3-a", 2, 3)
  ]);

  assert.equal(reconciled.activeEpisodeNo, 1);
  assert.deepEqual(reconciled.activeSceneKey, storyboardScene("1:1"));
  assert.equal(reconciled.activeShotId, "e1-s1-a");
  assert.deepEqual(reconciled.selectedShotIds, []);
});

test("preserves a valid child and clears scene and shot IDs removed by rebuild", () => {
  const state = createWorkbenchState({ episodeNo: 2, sceneKey: storyboardScene("2:3"), shotId: "e2-s3-b" });
  const kept = reconcileSelection(state, [
    shot("e1-s1-a", 1, 1),
    shot("e2-s3-a", 2, 3),
    shot("e2-s3-b", 2, 3)
  ]);
  assert.equal(kept.activeShotId, "e2-s3-b");

  const rebuilt = workbenchReducer(kept, {
    type: "reconcile-workflow",
    storyboards: [shot("e1-s4-a", 1, 4)]
  });
  assert.equal(rebuilt.activeEpisodeNo, 1);
  assert.deepEqual(rebuilt.activeSceneKey, storyboardScene("1:4"));
  assert.equal(rebuilt.activeShotId, "e1-s4-a");
});

test("clears selections when a rebuild has no valid scene or shot keys", () => {
  const state = createWorkbenchState({ episodeNo: 1, sceneKey: derivedScene("obsolete"), shotId: "obsolete-shot" });
  const rebuilt = reconcileSelection(state, []);
  assert.equal(rebuilt.activeEpisodeNo, null);
  assert.equal(rebuilt.activeSceneKey, null);
  assert.equal(rebuilt.activeShotId, null);
});

test("collects every configured episode while keeping real storyboard episodes", () => {
  const rows = buildContentSceneRows(undefined, [shot("e3-s1", 3, 1)]);
  assert.deepEqual(collectContentEpisodeNumbers(rows, 2), [1, 2, 3]);
});

test("labels script-derived scenes as 从剧本识别", () => {
  const rows = buildContentSceneRows(script("【旧车站 夜】\n林夏：你终于来了。\n她合上雨伞。"), []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.source, "derived");
  assert.equal(rows[0]?.sourceLabel, "从剧本识别");
  assert.deepEqual(rows[0]?.key, derivedScene("script-scene-1-1"));
  assert.equal(rows[0]?.emotion, "");
});

test("maps buildLocalScript-style episodes without mixing their content", () => {
  const content = [
    "第1集 旧车站",
    "剧情节拍：林夏在雨夜抵达旧车站。",
    "场景动作：林夏收起雨伞。",
    "林夏：你终于来了。",
    "旁白：列车声从远处传来。",
    "结尾钩子：站台尽头出现熟悉身影。",
    "",
    "第2集 医院走廊",
    "剧情节拍：林夏追查病历。",
    "场景动作：她推开档案室。",
    "顾沉：这里没有你要找的东西。",
    "旁白：灯光忽然熄灭。",
    "结尾钩子：病历上的名字被划掉。"
  ].join("\n");
  const rows = buildContentSceneRows(script(content), []);

  assert.deepEqual(rows.map((row) => row.episodeNo), [1, 2]);
  assert.deepEqual(rows.map((row) => row.title), ["旧车站", "医院走廊"]);
  assert.equal(rows.some((row) => row.lines.some((line) => /^第\s*\d+\s*集/.test(line))), false);
  assert.equal(rows[0]?.lines.some((line) => line.includes("病历")), false);
  assert.equal(rows[1]?.lines.some((line) => line.includes("旧车站")), false);
});

test("parses compound scene headings as one boundary per real scene", () => {
  const content = [
    "第1集 失踪",
    "第1场【车站 夜】",
    "林夏走下列车。",
    "第2场【巷口 雨】",
    "她发现一把伞。",
    "",
    "第2集 追踪",
    "第1场【医院 白天】",
    "顾沉翻开病历。"
  ].join("\n");
  const rows = buildContentSceneRows(script(content), []);

  assert.deepEqual(rows.map((row) => row.episodeNo), [1, 1, 2]);
  assert.deepEqual(rows.map((row) => row.title), ["车站 夜", "巷口 雨", "医院 白天"]);
  assert.equal(rows.length, 3);
  assert.equal(rows.some((row) => row.lines.some((line) => /^第\s*\d+\s*集/.test(line))), false);
});

test("recognizes conservative Chinese-numeral episode headings", () => {
  const rows = buildContentSceneRows(script("第一集 码头\n开场。\n\n第二集 仓库\n追踪。"), []);
  assert.deepEqual(rows.map((row) => row.episodeNo), [1, 2]);
});

test("does not storyboard-reconcile explicit empty episode selection in content", () => {
  assert.equal(shouldReconcileStoryboardSelection("content"), false);
  assert.equal(shouldReconcileStoryboardSelection("assets"), true);
});

test("keeps explicit weather separate from time metadata", () => {
  const [rainyScene] = buildContentSceneRows(script("【旧车站 雨】\n她站在檐下。"), []);
  assert.equal(rainyScene?.weather, "雨天");
  assert.equal(rainyScene?.timeOfDay, "");

  const [rainyStoryboardScene] = buildContentSceneRows(undefined, [
    { ...shot("rainy-storyboard", 1, 1), scene: "旧车站 雨" }
  ]);
  assert.equal(rainyStoryboardScene?.weather, "雨天");
  assert.equal(rainyStoryboardScene?.timeOfDay, "");

  const [unspecifiedScene] = buildContentSceneRows(script("【旧车站】\n她站在檐下。"), []);
  assert.equal(unspecifiedScene?.weather, "");
  assert.equal(unspecifiedScene?.timeOfDay, "");
});

test("uses only real shot emotion for content metadata", () => {
  const dialogueOnly = {
    ...shot("dialogue-only", 1, 1),
    dialogue: "我很害怕。",
    voiceOver: "空气令人不安。"
  };
  assert.equal(buildContentSceneRows(undefined, [dialogueOnly])[0]?.emotion, "");

  const realEmotion = { ...shot("emotion", 1, 1), emotion: "紧张" };
  assert.equal(buildContentSceneRows(undefined, [dialogueOnly, realEmotion])[0]?.emotion, "紧张");
});

test("reconciles content selection to one scene in the active episode", () => {
  const rows = buildContentSceneRows(undefined, [
    shot("e1-s1", 1, 1),
    shot("e1-s2", 1, 2),
    shot("e2-s1", 2, 1)
  ]);
  const selection = reconcileContentSelection(1, storyboardScene("1:9"), [1, 2], rows);
  assert.equal(selection.activeEpisodeNo, 1);
  assert.deepEqual(selection.activeSceneKey, storyboardScene("1:1"));
});

test("keeps an explicitly selected empty second episode empty", () => {
  const rows = buildContentSceneRows(script("【第一场】\n只有第一集的内容。"), []);
  const selection = reconcileContentSelection(2, derivedScene("script-scene-1"), [1, 2], rows);
  assert.equal(selection.activeEpisodeNo, 2);
  assert.equal(selection.activeSceneKey, null);
});

test("storyboard payload preserves the project's art style and video ratio", () => {
  const project = { artStyle: "电影写实", videoRatio: "9:16" } as Project;
  assert.deepEqual(buildStoryboardGenerationPayload(project), {
    artStyle: "电影写实",
    videoRatio: "9:16"
  });
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
