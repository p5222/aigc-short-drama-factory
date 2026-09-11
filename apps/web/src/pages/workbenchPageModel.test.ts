import assert from "node:assert/strict";
import test from "node:test";
import type { ExportJob, ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import { createWorkbenchPageSession, createWorkbenchSourceSync, isWorkbenchDeliveryComplete, restoreWorkbenchPageState, workbenchSessionKey } from "./workbenchPageModel.ts";

const shots: StoryboardShot[] = [
  { id: "e1", projectId: "p", episodeNo: 1, sceneNo: 1, shotNo: 1, characters: [], dialogue: "", pictureDesc: "", scene: "" },
  { id: "e2", projectId: "p", episodeNo: 2, sceneNo: 1, shotNo: 1, characters: [], dialogue: "", pictureDesc: "", scene: "" }
].map(shot => ({ ...shot, duration: 1, shotSize: "", cameraAngle: "", cameraMovement: "", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: "", videoPrompt: "", referenceAssetIds: [], status: "succeeded" }));
const workflow = { project: { id: "p", status: "completed", episodes: 2 }, storyboards: shots } as ProjectWorkflow;
const job: ExportJob = { id: "export", projectId: "p", type: "video_export", status: "succeeded", sourceStatus: "current", outputKind: "mp4", outputUrl: "/storage/exports/final.mp4", storyboardIds: ["e1", "e2"], createdAt: "2026-09-12", updatedAt: "2026-09-12" };
const saved = (activeStage: unknown = "delivery", activeEpisodeNo: unknown = 2, projectId = "p") => JSON.stringify({ version: 1, projectId, activeStage, activeEpisodeNo });

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("older export and production-package reads cannot overwrite a newer workflow source check", async () => {
  const sync = createWorkbenchSourceSync();
  const oldExports = deferred<string>(), oldPackage = deferred<string>();
  let exports = "unknown", productionPackage = "";
  const older = sync.begin();
  const oldRead = older.read(() => oldExports.promise, value => { exports = value; });
  const oldPackageRead = older.read(() => oldPackage.promise, value => { productionPackage = value; });
  const newer = sync.begin();
  await newer.read(async () => "stale", value => { exports = value; });
  await newer.read(async () => "latest source", value => { productionPackage = value; });
  oldExports.resolve("current"); oldPackage.resolve("outdated source");
  await Promise.all([oldRead, oldPackageRead]);
  assert.equal(exports, "stale");
  assert.equal(productionPackage, "latest source");
});

test("workflow effect takes ownership while an earlier explicit refresh waits, without launching stale follow-up requests", async () => {
  const sync = createWorkbenchSourceSync();
  const workflowRefresh = deferred<void>();
  let reads = 0, applied = "";
  const explicit = sync.begin();
  const continuation = (async () => {
    await workflowRefresh.promise;
    await explicit.read(async () => { reads++; return "outdated"; }, value => { applied = value; });
  })();
  sync.invalidate();
  const effect = sync.begin();
  await effect.read(async () => { reads++; return "latest"; }, value => { applied = value; });
  workflowRefresh.resolve();
  await continuation;
  assert.equal(reads, 1);
  assert.equal(applied, "latest");
});

test("only current source failures surface and old failures cannot clear a newer production package", async () => {
  const sync = createWorkbenchSourceSync();
  const pending = deferred<string>();
  let shownError = "", productionPackage = "latest";
  const oldRead = sync.begin().read(() => pending.promise, () => {}).catch(() => { productionPackage = ""; shownError = "old failure"; });
  const current = sync.begin();
  pending.reject(new Error("obsolete failure"));
  await oldRead;
  assert.equal(productionPackage, "latest");
  assert.equal(shownError, "");
  await assert.rejects(current.read(async () => { throw new Error("current failure"); }, () => {}), /current failure/);
});

test("workflow invalidation or unmount prevents any pending source result from updating the page", async () => {
  const sync = createWorkbenchSourceSync();
  const pending = deferred<string>();
  let applied = false;
  const read = sync.begin().read(() => pending.promise, () => { applied = true; });
  sync.invalidate();
  pending.resolve("private previous project");
  await read;
  assert.equal(applied, false);
  const fresh = sync.begin();
  await fresh.read(async () => "new project", () => { applied = true; });
  assert.equal(applied, true);
});

test("a replaced refresh rejects late without an unhandled rejection or returning its old workflow", async () => {
  const sync = createWorkbenchSourceSync();
  const pending = deferred<string>();
  let latestWorkflow = "old";
  const older = sync.begin();
  const refresh = (async () => {
    const workflow = await older.read(() => pending.promise, () => {}) ?? latestWorkflow;
    await older.read(async () => "old exports", () => { assert.fail("a replaced refresh cannot publish sources"); });
    return workflow;
  })();
  sync.invalidate();
  sync.begin();
  latestWorkflow = "new";
  pending.reject(new Error("older workflow request timed out"));
  assert.equal(await refresh, "new");
});

test("delivery completes only when the server and a current full-project MP4 agree", () => {
  assert.equal(isWorkbenchDeliveryComplete(workflow.project, shots, [job]), true);
  assert.equal(isWorkbenchDeliveryComplete({ ...workflow.project, status: "rendering" }, shots, [job]), false);
  assert.equal(isWorkbenchDeliveryComplete(workflow.project, [], [job]), false);
  assert.equal(isWorkbenchDeliveryComplete(workflow.project, shots, []), false);
});

test("partial, old, reordered, unrelated and non-video exports never finish the delivery stage", () => {
  const invalid: ExportJob[] = [
    { ...job, storyboardIds: ["e1"] }, { ...job, storyboardIds: undefined }, { ...job, storyboardIds: [] },
    { ...job, storyboardIds: ["e2", "e1"] }, { ...job, storyboardIds: ["e1", "deleted"] },
    { ...job, projectId: "other" }, { ...job, status: "running" }, { ...job, status: "failed" },
    { ...job, type: "tts" }, { ...job, outputKind: "diagnostic_bundle" },
    { ...job, outputUrl: "/storage/exports/diagnostics.zip" }, { ...job, outputUrl: "data:video/mp4;base64,AAAA" },
    { ...job, outputUrl: undefined }
  ];
  for (const item of invalid) assert.equal(isWorkbenchDeliveryComplete(workflow.project, shots, [item]), false, JSON.stringify(item));
});

test("session restores stage and episode but rebuilds the current shot and discards drafts", () => {
  const state = restoreWorkbenchPageState(workflow, JSON.stringify({ ...JSON.parse(saved()), activeShotId: "deleted", selectedShotIds: ["deleted"], dirtyEntityKey: "draft", shotMode: "video" }));
  assert.equal(state.activeStage, "delivery");
  assert.equal(state.activeEpisodeNo, 2);
  assert.equal(state.activeShotId, "e2");
  assert.deepEqual(state.selectedShotIds, []);
  assert.equal(state.dirtyEntityKey, null);
  assert.equal(state.shotMode, "table");
});

test("corrupt preferences and deleted episodes recover to a valid current selection", () => {
  for (const raw of ["{", "null", "[]", saved("unknown", -1), saved("shots", "2"), saved("delivery", 2, "other")]) {
    const state = restoreWorkbenchPageState(workflow, raw);
    assert.ok(["content", "shots"].includes(state.activeStage));
    assert.equal(state.activeEpisodeNo, 1);
    assert.equal(state.activeShotId, "e1");
  }
  const deleted = restoreWorkbenchPageState({ ...workflow, storyboards: shots.slice(0, 1) }, saved());
  assert.equal(deleted.activeStage, "delivery");
  assert.equal(deleted.activeEpisodeNo, 1);
  assert.equal(deleted.activeShotId, "e1");
  const empty = restoreWorkbenchPageState({ ...workflow, storyboards: [] }, saved("content", 2));
  assert.equal(empty.activeStage, "content");
  assert.equal(empty.activeEpisodeNo, 2);
  assert.equal(empty.activeShotId, null);
  const emptyConfiguredEpisode = restoreWorkbenchPageState({ ...workflow, storyboards: shots.slice(0, 1) }, saved("content", 2));
  assert.equal(emptyConfiguredEpisode.activeEpisodeNo, 2);
  assert.equal(emptyConfiguredEpisode.activeShotId, null);
});

test("preferences are isolated by project and blocked session storage remains usable", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const session = createWorkbenchPageSession(() => storage);
  assert.equal(session.save("p", { activeStage: "delivery", activeEpisodeNo: 2 }), true);
  assert.equal(session.save("other", { activeStage: "assets", activeEpisodeNo: 1 }), true);
  assert.equal(session.load(workflow).activeStage, "delivery");
  assert.equal(session.load({ ...workflow, project: { ...workflow.project, id: "other" } }).activeStage, "assets");
  assert.notEqual(workbenchSessionKey("p"), workbenchSessionKey("other"));
  assert.equal(values.size, 2);
  const blocked = createWorkbenchPageSession(() => { throw new Error("Storage blocked"); });
  assert.equal(blocked.save("p", { activeStage: "shots", activeEpisodeNo: 1 }), false);
  assert.equal(blocked.load(workflow).activeStage, "content");
});
