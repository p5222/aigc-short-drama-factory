import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectWorkflow } from "@aifilm/shared";
import { assessVideoExportCompletion, captureVideoExportSnapshot, readVideoExportSnapshot } from "./exportCompletion.js";

function workflow(): ProjectWorkflow {
  return {
    project: { id: "project", episodes: 2, videoRatio: "9:16", status: "rendering", name: "Film" },
    storyboards: [
      { id: "a", episodeNo: 1, sceneNo: 1, shotNo: 1, duration: 2, dialogue: "甲：你好", voiceOver: "", status: "succeeded", characters: ["甲"] },
      { id: "b", episodeNo: 2, sceneNo: 1, shotNo: 1, duration: 3, dialogue: "甲：再见", voiceOver: "", status: "succeeded", characters: ["甲"] }
    ],
    characters: [{ id: "character", name: "甲", voiceId: "voice-1" }],
    assets: [
      { id: "video_a", status: "succeeded", referenceUrl: "/storage/videos/a.mp4" },
      { id: "video_b", status: "succeeded", referenceUrl: "/storage/videos/b.mp4" }
    ]
  } as unknown as ProjectWorkflow;
}
const result = { status: "succeeded", outputKind: "mp4", outputUrl: "/storage/exports/final.mp4", ffmpegReady: true, clipCount: 2 } as const;

test("only successful full current MP4 export can complete a multiepisode project", () => {
  const current = workflow();
  assert.deepEqual(assessVideoExportCompletion(captureVideoExportSnapshot(current), current, result), { complete: true, reason: "complete" });
  for (const changed of [{ status: "running" }, { status: "failed" }, { outputKind: "diagnostic_bundle" }, { outputKind: "audio" }, { outputUrl: "/storage/exports/diagnostic.json" }, { ffmpegReady: false }]) {
    assert.equal(assessVideoExportCompletion(captureVideoExportSnapshot(current), current, { ...result, ...changed } as typeof result).complete, false);
  }
});

test("single episode and partial exports remain incomplete even with a real MP4", () => {
  const current = workflow();
  const selected = { ...current, storyboards: current.storyboards.slice(0, 1) };
  assert.equal(assessVideoExportCompletion(captureVideoExportSnapshot(selected), current, { ...result, clipCount: 1 }).reason, "partial_scope");
  const plannedButMissing = { ...current, project: { ...current.project, episodes: 3 } };
  assert.equal(assessVideoExportCompletion(captureVideoExportSnapshot(plannedButMissing), plannedButMissing, result).reason, "planned_episodes_incomplete");
});

test("missing clips, empty scopes and repeated shots cannot manufacture full coverage", () => {
  const current = workflow();
  assert.equal(assessVideoExportCompletion(captureVideoExportSnapshot(current), current, { ...result, clipCount: 1 }).reason, "clip_count_mismatch");
  assert.equal(assessVideoExportCompletion(captureVideoExportSnapshot(current), current, { ...result, clipCount: undefined }).reason, "clip_count_mismatch");
  assert.equal(assessVideoExportCompletion({ ...captureVideoExportSnapshot(current), storyboardIds: ["a", "a"] }, current, result).reason, "partial_scope");
  const empty = { ...current, storyboards: [] };
  assert.equal(assessVideoExportCompletion(captureVideoExportSnapshot(empty), empty, { ...result, clipCount: 0 }).complete, false);
});

test("explicit ordering of every current shot is preserved as a valid full cut", () => {
  const current = workflow(), cut = { ...current, storyboards: [...current.storyboards].reverse() };
  assert.equal(assessVideoExportCompletion(captureVideoExportSnapshot(cut), current, result).complete, true);
});

test("editing source inputs during export invalidates completion even when shot IDs stay the same", () => {
  const exported = workflow(), snapshot = captureVideoExportSnapshot(exported);
  const edits = [
    (value: ProjectWorkflow) => { value.storyboards[0]!.duration = 9; },
    (value: ProjectWorkflow) => { value.storyboards[0]!.dialogue = "内容已修改"; },
    (value: ProjectWorkflow) => { value.storyboards[0]!.videoPrompt = "new shot"; },
    (value: ProjectWorkflow) => { value.assets[0]!.referenceUrl = "/storage/videos/new-a.mp4"; },
    (value: ProjectWorkflow) => { value.assets[0]!.status = "running"; },
    (value: ProjectWorkflow) => { value.assets.splice(0, 1); },
    (value: ProjectWorkflow) => { value.characters[0]!.voiceId = "voice-2"; },
    (value: ProjectWorkflow) => { value.project.videoRatio = "16:9"; }
  ];
  for (const edit of edits) {
    const current = workflow(); edit(current);
    assert.equal(assessVideoExportCompletion(snapshot, current, result).reason, "source_changed");
  }
});

test("new or removed shots prevent old exports from completing the current project", () => {
  const current = workflow(), snapshot = captureVideoExportSnapshot(current);
  assert.equal(assessVideoExportCompletion(snapshot, { ...current, storyboards: current.storyboards.slice(0, 1) }, result).complete, false);
  assert.equal(assessVideoExportCompletion(snapshot, { ...current, storyboards: [...current.storyboards, { ...current.storyboards[0]!, id: "new" }] }, result).complete, false);
});

test("export's own output assets and bookkeeping updates do not invalidate source content", () => {
  const current = workflow(), snapshot = captureVideoExportSnapshot(current);
  current.assets.push({ id: "asset_video_export_new", referenceUrl: "/storage/exports/final.mp4", status: "succeeded" } as ProjectWorkflow["assets"][number]);
  current.assets.push({ id: "audio_tts_cached", referenceUrl: "/storage/exports/voice.wav", status: "succeeded" } as ProjectWorkflow["assets"][number]);
  current.project.creditsSpent = 100;
  current.project.updatedAt = new Date().toISOString();
  current.project.status = "completed";
  assert.equal(assessVideoExportCompletion(snapshot, current, result).complete, true);
});

test("stored completion proof accepts only a complete valid snapshot shape", () => {
  const snapshot = captureVideoExportSnapshot(workflow());
  assert.deepEqual(readVideoExportSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  for (const invalid of [undefined, null, "legacy", {}, { ...snapshot, projectId: "" }, { ...snapshot, storyboardIds: [] },
    { ...snapshot, storyboardIds: ["a", "a"] }, { ...snapshot, storyboardIds: [1] }, { ...snapshot, inputFingerprint: "unknown" }]) {
    assert.equal(readVideoExportSnapshot(invalid), null);
  }
});
