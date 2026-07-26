import assert from "node:assert/strict";
import test from "node:test";
import type { AssetItem, CharacterProfile, GenerationTask, ModelPrice, ModelProvider, Project, ProjectWorkflow, ScriptDraft, StoryboardShot, TaskStatus, TaskType } from "@aifilm/shared";
import { defaultImageUnitCredits, normalizeImageProviderId, resolveImageUnitCredits } from "@aifilm/shared";
import { modelPrices, providers } from "../../../api/src/seed/catalogData.ts";
import {
  RELEASE_A_CAPABILITIES,
  buildAssetFeedbackTarget,
  buildCharacterGenerationPayload,
  buildContentSceneRows,
  deriveSceneAssetList,
  buildStoryboardGenerationPayload,
  buildShotAssetMap,
  buildShotImageGenerationPayload,
  buildProjectVideoGenerationArgs,
  buildBatchResultSummary,
  buildStoryboardShotUpdatePayload,
  collectPendingShotIds,
  collectEligibleVideoShotIds,
  createShotDraftState,
  reduceShotDraftState,
  buildTaskSummary,
  collectContentEpisodeNumbers,
  createWorkbenchState,
  derivedScene,
  listCharacterReferenceAssets,
  commitMutationThenSync,
  nextWorkbenchTheme,
  reconcileActiveAsset,
  reconcileContentSelection,
  reconcileSelection,
  reconcileShotDraft,
  resolveCharacterIdentityAsset,
  resolveImageRoutePair,
  resolveShotSelection,
  resolveVideoUnitCredits,
  resolveVideoAssetStatus,
  isPersistedPlayableVideoReference,
  resolveThemePreference,
  shouldReconcileStoryboardSelection,
  storyboardScene,
  updateCharacterReferenceDraft,
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

function character(id: string, referenceAssetId?: string): CharacterProfile {
  return {
    id,
    projectId: "project-1",
    name: `Character ${id}`,
    identity: "Lead",
    appearance: "Black hair",
    costume: "Coat",
    personality: "Calm",
    prompt: "",
    negativePrompt: "",
    referenceAssetId,
    consistencyLevel: "high"
  };
}

function asset(id: string, type: AssetItem["type"], relatedCharacterId?: string, referenceUrl?: string): AssetItem {
  return {
    id,
    projectId: "project-1",
    type,
    name: id,
    description: "",
    prompt: "",
    referenceUrl,
    relatedCharacterId,
    status: referenceUrl ? "succeeded" : "pending"
  };
}

function imageProvider(id: string, models: string[], enabled = true): ModelProvider {
  return { id, modality: "image", models, enabled } as ModelProvider;
}

function imagePrice(providerId: string, model: string, unitCredits: number, enabled = true): ModelPrice {
  return { providerId, model, unitCredits, enabled, modality: "image" } as ModelPrice;
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

test("shot media maps only through exact persisted asset ids", () => {
  const explicit = asset("image_shot-1", "image", undefined, "https://example.com/frame.jpg");
  const unrelated = asset("opaque-image", "image", undefined, "https://example.com/unrelated.jpg");

  assert.deepEqual([...buildShotAssetMap([shot("shot-1", 1, 1)], [explicit, unrelated], "image")], [["shot-1", explicit]]);
});

test("image generation scopes submit exact shot ids", () => {
  assert.deepEqual(buildShotImageGenerationPayload("shot-2", ["shot-3", "shot-1"], ["shot-1", "shot-2"]), {
    current: { shotIds: ["shot-2"] },
    selected: { shotIds: ["shot-3", "shot-1"] },
    pending: { shotIds: ["shot-1", "shot-2"] }
  });
});

test("release A video generation has no per-shot or regeneration payload", () => {
  assert.deepEqual(buildProjectVideoGenerationArgs(), []);
});

test("pending shot ids only include shots without a real image", () => {
  const ready = asset("image_shot-2", "image", undefined, "https://example.com/frame.jpg");
  assert.deepEqual(collectPendingShotIds([shot("shot-1", 1, 1), shot("shot-2", 1, 1)], [ready]), ["shot-1"]);
});

test("shot drafts preserve failed saves and separate committed writes from failed refreshes", () => {
  const clean = createShotDraftState("shot-1", { pictureDesc: "Before" });
  const dirty = reduceShotDraftState(clean, { type: "edit", patch: { pictureDesc: "After" } });
  assert.equal(dirty.status, "dirty");
  assert.equal(reduceShotDraftState(dirty, { type: "save-start" }).status, "saving");

  const failed = reduceShotDraftState(dirty, { type: "save-failed", error: "network" });
  assert.equal(failed.status, "error");
  assert.equal(failed.draft.pictureDesc, "After");
  assert.equal(failed.committed, false);

  const refreshFailed = reduceShotDraftState(dirty, { type: "save-committed", refreshError: "refresh" });
  assert.equal(refreshFailed.status, "sync-required");
  assert.equal(refreshFailed.draft.pictureDesc, "After");
  assert.equal(refreshFailed.committed, true);
});

test("successful refresh reconciliation clears sync error and returns the draft to saved", () => {
  const syncRequired = reduceShotDraftState(
    createShotDraftState("shot-1", { pictureDesc: "Saved" }),
    { type: "save-committed", refreshError: "refresh" }
  );
  const reconciled = reduceShotDraftState(syncRequired, { type: "sync-succeeded" });

  assert.equal(reconciled.status, "saved");
  assert.equal(reconciled.error, undefined);
  assert.equal(reconciled.committed, true);
});

test("committed shot draft adopts the canonical duration that was actually sent", () => {
  const saving = reduceShotDraftState(
    createShotDraftState("shot-1", { duration: 8.6 }),
    { type: "save-start" }
  );
  const committed = reduceShotDraftState(saving, {
    type: "save-committed",
    draft: buildStoryboardShotUpdatePayload(saving.draft)
  });

  assert.equal(committed.status, "saved");
  assert.equal(committed.draft.duration, 9);
});

test("sync-required retry adopts the refreshed canonical shot", () => {
  const syncRequired = reduceShotDraftState(
    createShotDraftState("shot-1", { duration: 8.6 }),
    { type: "save-committed", draft: { duration: 9 }, refreshError: "refresh" }
  );
  const reconciled = reduceShotDraftState(syncRequired, { type: "sync-succeeded", draft: { duration: 9 } });

  assert.equal(reconciled.status, "saved");
  assert.equal(reconciled.draft.duration, 9);
});

test("workflow refresh never overwrites an uncommitted dirty shot draft", () => {
  const dirty = reduceShotDraftState(createShotDraftState("shot-1", { duration: 8 }), {
    type: "edit",
    patch: { duration: 12 }
  });
  const reconciled = reconcileShotDraft(dirty, "shot-1", { duration: 9 });

  assert.equal(reconciled, dirty);
  assert.equal(reconciled.draft.duration, 12);
});

test("stale save completion for shot A cannot overwrite shot B", () => {
  const dirtyA = reduceShotDraftState(createShotDraftState("shot-a", { duration: 8 }), {
    type: "edit",
    patch: { duration: 9 }
  });
  const savingA = reduceShotDraftState(dirtyA, { type: "save-start", token: "save-a" });
  const shotB = reduceShotDraftState(savingA, { type: "rebuild", shotId: "shot-b", draft: { duration: 5 } });
  const stale = reduceShotDraftState(shotB, { type: "save-committed", token: "save-a", draft: { duration: 9 } });

  assert.equal(stale, shotB);
  assert.equal(stale.shotId, "shot-b");
  assert.equal(stale.draft.duration, 5);
});

test("stale retry completion for shot A cannot overwrite shot B", () => {
  const syncA = reduceShotDraftState(createShotDraftState("shot-a", { duration: 9 }), {
    type: "sync-start",
    token: "refresh-a"
  });
  const shotB = reduceShotDraftState(syncA, { type: "rebuild", shotId: "shot-b", draft: { duration: 5 } });
  const stale = reduceShotDraftState(shotB, { type: "sync-succeeded", token: "refresh-a", draft: { duration: 9 } });

  assert.equal(stale, shotB);
  assert.equal(stale.shotId, "shot-b");
});

test("failed refresh clears the active operation and remains retryable", () => {
  const syncRequired = reduceShotDraftState(createShotDraftState("shot-a", { duration: 9 }), {
    type: "save-committed",
    refreshError: "first refresh"
  });
  const refreshing = reduceShotDraftState(syncRequired, { type: "sync-start", token: "refresh-a-1" });
  const failed = reduceShotDraftState(refreshing, { type: "sync-failed", token: "refresh-a-1", error: "still offline" });

  assert.equal(failed.status, "sync-required");
  assert.equal(failed.activeOperation, undefined);
  assert.equal(failed.error, "still offline");
  const retrying = reduceShotDraftState(failed, { type: "sync-start", token: "refresh-a-2" });
  assert.equal(retrying.activeOperation?.token, "refresh-a-2");
});

test("stale refresh failure cannot affect the current shot", () => {
  const refreshingA = reduceShotDraftState(createShotDraftState("shot-a", { duration: 9 }), {
    type: "sync-start",
    token: "refresh-a"
  });
  const shotB = reduceShotDraftState(refreshingA, { type: "rebuild", shotId: "shot-b", draft: { duration: 5 } });
  const stale = reduceShotDraftState(shotB, { type: "sync-failed", token: "refresh-a", error: "offline" });

  assert.equal(stale, shotB);
  assert.equal(stale.error, undefined);
});

test("canceling a dirty shot switch confirms once and preserves the draft", () => {
  const dirty = reduceShotDraftState(createShotDraftState("shot-1", { pictureDesc: "Before" }), {
    type: "edit",
    patch: { pictureDesc: "Unsaved" }
  });
  let confirmations = 0;
  const result = resolveShotSelection("shot-1", "shot-2", dirty, () => {
    confirmations += 1;
    return false;
  });

  assert.deepEqual(result, { accepted: false, shotId: "shot-1" });
  assert.equal(confirmations, 1);
  assert.equal(dirty.draft.pictureDesc, "Unsaved");
});

test("shot update payload constrains duration to integer seconds between one and thirty", () => {
  assert.equal(buildStoryboardShotUpdatePayload({ duration: 0.2 }).duration, 1);
  assert.equal(buildStoryboardShotUpdatePayload({ duration: 8.6 }).duration, 9);
  assert.equal(buildStoryboardShotUpdatePayload({ duration: 80 }).duration, 30);
  assert.equal(buildStoryboardShotUpdatePayload({ pictureDesc: "Keep" }).pictureDesc, "Keep");
});

test("video pricing never borrows a same-named model from another provider", () => {
  const prices = [{
    id: "foreign-price",
    providerId: "another-provider",
    providerName: "Another",
    modality: "video",
    model: "shared-model",
    unit: "video_second",
    unitCredits: 99,
    vendorCostCny: 0,
    enabled: true
  }] as ModelPrice[];

  assert.equal(resolveVideoUnitCredits(prices, "dashscope-video", "shared-model"), 16);
  assert.equal(resolveVideoUnitCredits(prices, "unknown-provider", "shared-model"), 0);
});

test("video eligibility requires a succeeded image and no succeeded playable video", () => {
  const shots = [shot("shot-1", 1, 1), shot("shot-2", 1, 1), shot("shot-3", 1, 1)];
  const imageReady = { ...asset("image_shot-1", "image", undefined, "https://cdn.test/frame.jpg"), status: "succeeded" as const };
  const imageRunning = { ...asset("image_shot-2", "image", undefined, "https://cdn.test/frame-2.jpg"), status: "running" as const };
  const imageReadyThree = { ...asset("image_shot-3", "image", undefined, "https://cdn.test/frame-3.jpg"), status: "succeeded" as const };
  const queuedVideo = { ...asset("video_shot-1", "video", undefined, "task-123"), status: "running" as const };
  const completedVideo = { ...asset("video_shot-3", "video", undefined, "https://cdn.test/clip.mp4"), status: "succeeded" as const };

  assert.deepEqual(collectEligibleVideoShotIds(shots, [imageReady, imageRunning, imageReadyThree, queuedVideo, completedVideo]), ["shot-1"]);
  assert.equal(resolveVideoAssetStatus(queuedVideo), "running");
  assert.equal(resolveVideoAssetStatus(completedVideo), "succeeded");
  assert.equal(resolveVideoAssetStatus({ ...completedVideo, status: "running" }), "running");
});

test("web video readiness follows the shared persisted URL contract", () => {
  assert.equal(isPersistedPlayableVideoReference("https://cdn.example.com/video?id=42"), true);
  assert.equal(isPersistedPlayableVideoReference("/storage/projects/p1/video/clip"), true);
  assert.equal(isPersistedPlayableVideoReference("task-123"), false);
  assert.equal(isPersistedPlayableVideoReference(""), false);
});

test("batch success summary uses actual backend result instead of requested range", () => {
  const summary = buildBatchResultSummary("首帧", 8, {
    assetsCreated: 1,
    task: { finalCredits: 24 }
  });
  assert.equal(summary, "首帧请求范围 8 个；服务端本批次实际接收/创建 1 个，实际扣费 24 积分。");
});

test("rebuilding or discarding a shot draft invalidates the previous entity", () => {
  const dirty = reduceShotDraftState(createShotDraftState("shot-1", { pictureDesc: "Before" }), {
    type: "edit",
    patch: { pictureDesc: "After" }
  });
  const rebuilt = reduceShotDraftState(dirty, { type: "rebuild", shotId: "shot-2", draft: { pictureDesc: "Next" } });
  assert.equal(rebuilt.shotId, "shot-2");
  assert.equal(rebuilt.status, "unchanged");
  assert.equal(rebuilt.draft.pictureDesc, "Next");
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
  const initial = createWorkbenchState({ episodeNo: 1, sceneKey: storyboardScene("1:1"), shotId: "shot-2", dirtyEntityKey: "shot:shot-2" });
  const shots = workbenchReducer(initial, { type: "set-stage", stage: "shots" });
  const selected = workbenchReducer(shots, { type: "set-selected-shots", shotIds: ["shot-1", "shot-2"] });
  const video = workbenchReducer(selected, { type: "set-shot-mode", mode: "video" });
  assert.deepEqual(video.selectedShotIds, ["shot-1", "shot-2"]);

  const delivery = workbenchReducer(video, { type: "set-stage", stage: "delivery" });
  assert.equal(delivery.activeShotId, "shot-2");
  assert.deepEqual(delivery.selectedShotIds, []);
  assert.equal(delivery.dirtyEntityKey, null);
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
  assert.equal(buildContentSceneRows(undefined, [dialogueOnly, realEmotion]).find((row) => row.shotId === "emotion")?.emotion, "紧张");
});

test("reconciles content selection to one scene in the active episode", () => {
  const rows = buildContentSceneRows(undefined, [
    shot("e1-s1", 1, 1),
    shot("e1-s2", 1, 2),
    shot("e2-s1", 2, 1)
  ]);
  const selection = reconcileContentSelection(1, storyboardScene("1:9"), [1, 2], rows);
  assert.equal(selection.activeEpisodeNo, 1);
  assert.deepEqual(selection.activeSceneKey, storyboardScene("1:1:1"));
});

test("keeps script structure labels inside one scene instead of treating them as scenes", () => {
  const rows = buildContentSceneRows(script(["第1集", "【开场画面】", "雨夜宫墙。", "【动作】", "女主推门。", "【台词】", "女主：谁在那里？", "【旁白】", "风声骤停。"].join("\n")), []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.lines.some((line) => line === "【动作】"), true);
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

test("resolves a generated character identity without treating creator references as identity", () => {
  const profile = character("char-1", "primary-role");
  const assets = [
    asset("creator-reference", "role_reference", profile.id, "https://cdn.test/reference.jpg"),
    asset("primary-role", "role", profile.id, "https://cdn.test/primary.jpg"),
    asset("latest-derivative", "role_derivative", profile.id, "https://cdn.test/derivative.jpg")
  ];

  assert.equal(resolveCharacterIdentityAsset(profile, assets)?.id, "primary-role");
  assert.deepEqual(listCharacterReferenceAssets(profile.id, assets).map((item) => item.id), ["creator-reference"]);
  assert.equal(resolveCharacterIdentityAsset(profile, assets.filter((item) => item.type !== "role_reference"))?.id, "primary-role");
  assert.equal(resolveCharacterIdentityAsset(character("char-2"), [assets[0]!] as AssetItem[]), undefined);
});

test("falls back from a missing primary character identity to a generated derivative", () => {
  const profile = character("char-1", "missing-role");
  const assets = [
    asset("empty-primary", "role", profile.id),
    asset("generated-derivative", "role_derivative", profile.id, "https://cdn.test/identity.jpg")
  ];
  assert.equal(resolveCharacterIdentityAsset(profile, assets)?.id, "generated-derivative");
});

test("keeps creator reference URL drafts isolated by character", () => {
  const first = updateCharacterReferenceDraft({}, "char-a", "https://cdn.test/a.jpg");
  const second = updateCharacterReferenceDraft(first, "char-b", "https://cdn.test/b.jpg");
  const clearedA = updateCharacterReferenceDraft(second, "char-a", "");
  assert.deepEqual(second, {
    "char-a": "https://cdn.test/a.jpg",
    "char-b": "https://cdn.test/b.jpg"
  });
  assert.equal(clearedA["char-a"], "");
  assert.equal(clearedA["char-b"], "https://cdn.test/b.jpg");
});

test("derives only real scene and prop assets in workflow order", () => {
  const assets = [
    asset("role", "role"),
    asset("scene-1", "scene", undefined, "https://cdn.test/scene.jpg"),
    asset("image", "image"),
    asset("prop-1", "prop")
  ];
  assert.deepEqual(deriveSceneAssetList(assets).map((item) => item.id), ["scene-1", "prop-1"]);
});

test("reconciles active asset to a valid item while preserving its selected mode", () => {
  const characters = [character("char-1"), character("char-2")];
  const scenes = [asset("scene-1", "scene"), asset("scene-2", "scene")];

  assert.deepEqual(reconcileActiveAsset({ type: "character", id: "char-2" }, characters, scenes), { type: "character", id: "char-2" });
  assert.deepEqual(reconcileActiveAsset({ type: "character", id: "removed" }, characters, scenes), { type: "character", id: "char-1" });
  assert.deepEqual(reconcileActiveAsset({ type: "scene", id: "removed" }, characters, scenes), { type: "scene", id: "scene-1" });
  assert.deepEqual(reconcileActiveAsset(null, [], scenes), { type: "scene", id: "scene-1" });
  assert.equal(reconcileActiveAsset(null, [], []), null);
});

test("builds exact generation and feedback targets for the selected asset", () => {
  const sceneAsset = asset("scene-7", "scene");
  assert.deepEqual(buildCharacterGenerationPayload("char-4", true), {
    characterIds: ["char-4"],
    forceRegenerate: true
  });
  assert.deepEqual(buildAssetFeedbackTarget({ type: "scene", asset: sceneAsset }), {
    stage: "image",
    assetId: "scene-7",
    label: "场景资产反馈"
  });
  assert.deepEqual(buildAssetFeedbackTarget({ type: "character", asset: asset("identity-2", "role", "char-2") }), {
    stage: "character",
    assetId: "identity-2",
    label: "角色身份板反馈"
  });
  assert.deepEqual(buildAssetFeedbackTarget({ type: "character" }), {
    stage: "character",
    assetId: undefined,
    label: "角色身份板反馈"
  });
});

test("classifies mutation failure without attempting workflow sync", async () => {
  let syncCalls = 0;
  const mutationError = new Error("mutation failed");
  const result = await commitMutationThenSync(
    async () => { throw mutationError; },
    async () => { syncCalls += 1; }
  );
  assert.equal(result.status, "mutation-failed");
  assert.equal(result.error, mutationError);
  assert.equal(syncCalls, 0);
});

test("preserves committed mutation when workflow sync fails", async () => {
  let mutationCalls = 0;
  const syncError = new Error("refresh failed");
  const result = await commitMutationThenSync(
    async () => { mutationCalls += 1; return { id: "asset-1" }; },
    async () => { throw syncError; }
  );
  assert.equal(result.status, "sync-required");
  assert.deepEqual(result.value, { id: "asset-1" });
  assert.equal(result.error, syncError);
  assert.equal(mutationCalls, 1);
});

test("reports a fully synced mutation separately", async () => {
  const result = await commitMutationThenSync(async () => "created", async () => undefined);
  assert.deepEqual(result, { status: "synced", value: "created" });
});

test("normalizes unavailable and mismatched image routes to valid provider-model pairs", () => {
  const providers = [
    imageProvider("disabled", ["disabled-model"], false),
    imageProvider("provider-a", ["blocked", "model-a"]),
    imageProvider("provider-b", ["model-b"])
  ];
  const blocked = new Set(["blocked"]);

  assert.deepEqual(resolveImageRoutePair("missing", "missing-model", providers, blocked), {
    imageProvider: "provider-a",
    imageModel: "model-a"
  });
  assert.deepEqual(resolveImageRoutePair("provider-b", "model-a", providers, blocked), {
    imageProvider: "provider-b",
    imageModel: "model-b"
  });
  assert.deepEqual(resolveImageRoutePair("provider-b", "model-b", providers, blocked), {
    imageProvider: "provider-b",
    imageModel: "model-b"
  });
});

test("uses image pricing only for the exact enabled provider-model pair", () => {
  const prices = [
    imagePrice("dashscope-image", "shared-model", 3),
    imagePrice("zml-image", "shared-model", 9),
    imagePrice("zml-image", "disabled-model", 15, false)
  ];
  assert.equal(resolveImageUnitCredits(prices, "zml", "shared-model"), 9);
  assert.equal(resolveImageUnitCredits(prices, "zml-image", "missing-model"), 28);
  assert.equal(resolveImageUnitCredits(prices, "zml-image", "disabled-model"), 28);
});

test("normalizes every Google image provider alias to the catalog provider", () => {
  const googleProvider = providers.find((provider) => provider.id === "google-gemini-image");
  assert.ok(googleProvider);
  const defaultModelPrice = modelPrices.find((price) => (
    price.enabled
    && price.modality === "image"
    && price.providerId === googleProvider.id
    && price.model === googleProvider.models[0]
  ));
  assert.ok(defaultModelPrice);

  for (const alias of ["google", "google-ai-studio", "google-gemini-image"]) {
    assert.equal(normalizeImageProviderId(alias), googleProvider.id);
    assert.equal(defaultImageUnitCredits(alias), defaultModelPrice.unitCredits);
  }
});

test("keeps every Google image catalog price exact across the shared contract", () => {
  const googleProvider = providers.find((provider) => provider.id === "google-gemini-image");
  assert.ok(googleProvider);
  const googlePrices = modelPrices.filter((price) => (
    price.enabled
    && price.modality === "image"
    && price.providerId === googleProvider.id
  ));
  assert.equal(googlePrices.length, googleProvider.models.length);

  for (const model of googleProvider.models) {
    const catalogPrice = googlePrices.find((price) => price.model === model);
    assert.ok(catalogPrice, `missing enabled catalog price for ${model}`);
    assert.equal(resolveImageUnitCredits(modelPrices, "google", model), catalogPrice.unitCredits);
    assert.equal(resolveImageUnitCredits(modelPrices, "google-ai-studio", model), catalogPrice.unitCredits);
  }
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
