import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectWorkflow } from "@aifilm/shared";
import { captureExportSource, exportSourceFromDiagnostics, exportSourceStatus, readExportSource } from "./exportSource.js";

function workflow(): ProjectWorkflow {
  return {
    project: { id: "source-project", name: "Project", videoRatio: "9:16", episodes: 1 },
    storyboards: [
      { id: "a", episodeNo: 1, sceneNo: 1, shotNo: 1, duration: 2, dialogue: "甲：你好。", voiceOver: "", pictureDesc: "书店", characters: ["甲"], referenceAssetIds: [], status: "succeeded" },
      { id: "b", episodeNo: 1, sceneNo: 1, shotNo: 2, duration: 3, dialogue: "甲：再见。", voiceOver: "", pictureDesc: "海边", characters: ["甲"], referenceAssetIds: [], status: "succeeded" }
    ],
    characters: [{ id: "character-a", name: "甲", voiceId: "voice-one" }],
    assets: [
      { id: "video_a", status: "succeeded", referenceUrl: "/storage/a.mp4" }, { id: "video_b", status: "succeeded", referenceUrl: "/storage/b.mp4" },
      { id: "image_a", status: "succeeded", referenceUrl: "/storage/a.png" }, { id: "image_b", status: "succeeded", referenceUrl: "/storage/b.png" }
    ]
  } as unknown as ProjectWorkflow;
}

test("partial exports verify only their saved ordered scope while whole-project exports notice new shots", () => {
  const full = workflow(), selected = { ...full, storyboards: [full.storyboards[0]!] };
  const partial = captureExportSource(selected, "video_export", "selection"), whole = captureExportSource(full, "video_export", "project");
  full.storyboards[1]!.dialogue = "Other episode edited";
  assert.equal(exportSourceStatus(partial, full, "video_export"), "current");
  assert.equal(exportSourceStatus(whole, full, "video_export"), "stale");
  const unchanged = workflow(); unchanged.storyboards.push({ ...unchanged.storyboards[1]!, id: "c" });
  assert.equal(exportSourceStatus(whole, unchanged, "video_export"), "stale");
  assert.equal(exportSourceStatus(partial, unchanged, "video_export"), "current");
  unchanged.storyboards.shift();
  assert.equal(exportSourceStatus(partial, unchanged, "video_export"), "stale");
});

test("subtitle and TTS fingerprints follow actual text/timing/voice inputs instead of media bookkeeping", () => {
  const current = workflow(), subtitle = captureExportSource(current, "subtitle"), narration = captureExportSource(current, "tts");
  current.assets[0]!.referenceUrl = "/storage/replaced-video.mp4";
  current.project.updatedAt = "bookkeeping"; current.project.creditsSpent = 30; current.storyboards[0]!.status = "pending";
  assert.equal(exportSourceStatus(subtitle, current, "subtitle"), "current");
  assert.equal(exportSourceStatus(narration, current, "tts"), "current");
  current.characters[0]!.voiceId = "voice-two";
  assert.equal(exportSourceStatus(subtitle, current, "subtitle"), "current");
  assert.equal(exportSourceStatus(narration, current, "tts"), "stale");
  current.storyboards[0]!.duration += 1;
  assert.equal(exportSourceStatus(subtitle, current, "subtitle"), "stale");
  const changedText = workflow(); changedText.storyboards[0]!.dialogue = "甲：新的台词。";
  assert.equal(exportSourceStatus(subtitle, changedText, "subtitle"), "stale");
  assert.equal(exportSourceStatus(narration, changedText, "tts"), "stale");
});

test("video source changes detect missing/replaced canonical clips, first frames and narration", () => {
  const snapshot = captureExportSource(workflow(), "video_export");
  for (const change of [
    (current: ProjectWorkflow) => { current.assets[0]!.referenceUrl = "/storage/replaced.mp4"; },
    (current: ProjectWorkflow) => { current.assets[2]!.referenceUrl = "/storage/replaced.png"; },
    (current: ProjectWorkflow) => { current.assets.shift(); },
    (current: ProjectWorkflow) => { current.characters[0]!.voiceId = "voice-two"; },
    (current: ProjectWorkflow) => { current.storyboards[0]!.videoPrompt = "revised motion"; }
  ]) {
    const current = workflow(); change(current);
    assert.equal(exportSourceStatus(snapshot, current, "video_export"), "stale");
  }
});

test("legacy or malformed proof is unknown and valid snapshots contain no text or asset URLs", () => {
  const current = workflow(), snapshot = captureExportSource(current, "tts");
  assert.deepEqual(readExportSource(snapshot), snapshot);
  assert.deepEqual(exportSourceFromDiagnostics(JSON.stringify({ sourceSnapshot: snapshot })), snapshot);
  for (const value of [null, {}, { ...snapshot, version: 0 }, { ...snapshot, scope: "all" }, { ...snapshot, storyboardIds: ["a", "a"] }, { ...snapshot, inputFingerprint: "not-a-hash" }]) assert.equal(readExportSource(value), null);
  assert.equal(exportSourceFromDiagnostics("legacy message"), null);
  assert.equal(exportSourceStatus(null, current, "tts"), "unknown");
  assert.equal(exportSourceStatus(snapshot, current, "subtitle"), "unknown");
  assert.equal(exportSourceStatus(snapshot, null, "tts"), "stale");
  assert.doesNotMatch(JSON.stringify(snapshot), /你好|\/storage\/|voice-one/);
});
