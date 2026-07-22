import assert from "node:assert/strict";
import test from "node:test";
import type { AssetItem, ExportJob, StoryboardShot } from "@aifilm/shared";
import { buildDeliveryClipLayout, getDeliveryCandidates, getExportSummary, getNextPlayableShotId, normalizeShotDuration, normalizePersistedMediaUrl, reduceDeliveryAutoPlay, resolveSingleDeliveryCandidate } from "./deliveryModel.ts";

const shot = (id: string, duration: number): StoryboardShot => ({ id, projectId: "p", episodeNo: 1, sceneNo: 1, shotNo: 1, duration, shotSize: "", cameraAngle: "", cameraMovement: "", characters: [], scene: "", pictureDesc: id, dialogue: "", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: "", videoPrompt: "", referenceAssetIds: [], status: "succeeded" });
const asset = (id: string, shotId: string, url?: string): AssetItem => ({ id: `video_${shotId}`, projectId: "p", type: "video", name: id, description: "", prompt: "", referenceUrl: url, status: url ? "succeeded" : "failed" });

test("normalizes invalid durations and lays clips sequentially", () => {
  assert.deepEqual(buildDeliveryClipLayout([shot("a", 0), shot("b", -2), shot("c", 3)]).map((clip) => ({ id: clip.id, start: clip.start, duration: clip.duration })), [
    { id: "a", start: 0, duration: 1 }, { id: "b", start: 1, duration: 1 }, { id: "c", start: 2, duration: 3 }
  ]);
  assert.equal(normalizeShotDuration(Number.NaN), 1);
  assert.deepEqual(buildDeliveryClipLayout([shot("a", 2), shot("b", 3)], 52, 96, new Map([["a", 5], ["b", Number.NaN]])).map((item) => item.duration), [5, 3]);
});

test("publishing resolves one latest MP4, otherwise one shot", () => {
  const shots = [shot("a", 2), shot("b", 4)];
  const assets = [asset("a", "a", "https://cdn.test/a.mp4"), asset("b", "b", "https://cdn.test/b.mp4")];
  const jobs: ExportJob[] = [{ id: "new", projectId: "p", type: "video_export", status: "succeeded", outputUrl: "https://cdn.test/new.mp4", outputKind: "mp4", createdAt: "2025-01-02", updatedAt: "2025-01-02" }];
  assert.equal(resolveSingleDeliveryCandidate(shots, assets, jobs)?.id, "export:new");
  assert.equal(resolveSingleDeliveryCandidate(shots, assets, [])?.id, "asset:video_a");
});

test("returns only persisted playable videos and latest successful mp4", () => {
  const shots = [shot("a", 2), shot("b", 4)];
  const assets = [asset("a", "a", "https://cdn.test/a.mp4"), asset("b", "b", "task-123")];
  const jobs: ExportJob[] = [
    { id: "old", projectId: "p", type: "video_export", status: "succeeded", outputUrl: "https://cdn.test/old.mp4", outputKind: "mp4", createdAt: "2025-01-01", updatedAt: "2025-01-01" },
    { id: "new", projectId: "p", type: "video_export", status: "succeeded", outputUrl: "https://cdn.test/new.mp4", outputKind: "mp4", createdAt: "2025-01-02", updatedAt: "2025-01-02" }
  ];
  assert.deepEqual(getDeliveryCandidates(shots, assets, jobs).map((candidate) => candidate.id), ["export:new", "asset:video_a"]);
  assert.equal(getNextPlayableShotId(shots, assets, ""), "a");
  assert.equal(getNextPlayableShotId(shots, assets, "b"), null);
});

test("summarizes export status, warnings and errors without hiding failures", () => {
  const summary = getExportSummary([{ id: "x", projectId: "p", type: "tts", status: "failed", warnings: ["缺少音频"], errorReason: "超时", createdAt: "", updatedAt: "" }]);
  assert.equal(summary.status, "failed");
  assert.deepEqual(summary.messages, ["缺少音频", "超时"]);
});

test("auto play targets the next playable clip exactly once and manual selection cancels", () => {
  const pending = reduceDeliveryAutoPlay(null, { type: "ended", shotId: "b", url: "https://cdn.test/b.mp4" });
  assert.deepEqual(pending, { shotId: "b", url: "https://cdn.test/b.mp4" });
  assert.equal(reduceDeliveryAutoPlay(pending, { type: "consumed", shotId: "b", url: "https://cdn.test/b.mp4" }), null);
  assert.equal(reduceDeliveryAutoPlay(pending, { type: "manual" }), null);
  assert.equal(reduceDeliveryAutoPlay(null, { type: "ended" }), null);
});

test("normalizes persisted media source identity across relative and absolute URLs", () => {
  assert.equal(normalizePersistedMediaUrl("/storage/clip.mp4?x=1#t"), normalizePersistedMediaUrl("https://studio.test/storage/clip.mp4?x=1#t"));
  assert.notEqual(normalizePersistedMediaUrl("/storage/clip.mp4?x=1"), normalizePersistedMediaUrl("/storage/clip.mp4?x=2"));
});
