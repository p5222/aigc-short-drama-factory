import assert from "node:assert/strict";
import test from "node:test";
import { applyDeliveryEdit, validateDeliveryClips, shotVideoVersions, type ProjectWorkflow } from "@aifilm/shared";
import { captureExportSource, exportSourceStatus } from "./exportSource.js";
import { buildExportSrt, buildVoiceCues } from "./videoComposer.js";

const historyId = "video_a_history_12345678-1234-1234-1234-123456789abc";
function fixture(): ProjectWorkflow {
  return { project: { id: "p", videoRatio: "16:9", episodes: 1 }, characters: [], tasks: [],
    storyboards: [{ id: "a", projectId: "p", episodeNo: 1, duration: 5, dialogue: "第一句", characters: [] },
      { id: "b", projectId: "p", episodeNo: 1, duration: 4, dialogue: "第二句", characters: [] },
      { id: "c", projectId: "p", episodeNo: 2, duration: 3, dialogue: "", characters: [] }],
    assets: ["video_a", "video_b", historyId].map(id => ({ id, projectId: "p", type: "video", status: "succeeded", referenceUrl: `/storage/${id}.mp4` })),
    deliveryEdits: [{ projectId: "p", episodeNo: 1, revision: 1, updatedAt: "", clips: [
      { shotId: "b", sourceAssetId: "video_b", sourceUrl: "/storage/video_b.mp4", inPoint: 1.25, outPoint: 3.5 },
      { shotId: "a", sourceAssetId: historyId, sourceUrl: `/storage/${historyId}.mp4`, inPoint: 2.1, outPoint: 2.6 }
    ] }] } as unknown as ProjectWorkflow;
}

test("saved cut preserves fractional timing, selected historical source and original media", () => {
  const workflow = fixture(), edited = applyDeliveryEdit(workflow, { episodeNo: 1, revision: 1 });
  assert.deepEqual(edited.storyboards.map(shot => [shot.id, shot.duration, shot.videoTrimStart]), [["b", 2.25, 1.25], ["a", 0.5, 2.1]]);
  assert.equal(edited.assets.find(asset => asset.id === "video_a")?.referenceUrl, `/storage/${historyId}.mp4`);
  assert.equal(workflow.storyboards[0].duration, 5);
  assert.equal(workflow.assets[0].referenceUrl, "/storage/video_a.mp4");
  assert.deepEqual(buildVoiceCues(edited).map(cue => cue.duration), [2.25, 0.5]);
  assert.match(buildExportSrt(edited), /00:00:02,250 --> 00:00:02,750/);
});

test("foreign clips, wrong episodes, duplicate shots, nonfinite and invalid trim ranges are rejected", () => {
  const workflow = fixture(), base = workflow.deliveryEdits![0].clips[0];
  for (const patch of [{ shotId: "c" }, { sourceAssetId: "video_a" }, { inPoint: -1 }, { outPoint: 10 },
    { inPoint: Number.NaN }, { outPoint: Number.POSITIVE_INFINITY }, { inPoint: 2, outPoint: 2.1 }]) {
    assert.throws(() => validateDeliveryClips(workflow, 1, [{ ...base, ...patch }]));
  }
  assert.throws(() => validateDeliveryClips(workflow, 1, [base, base]));
  workflow.assets[1].projectId = "foreign";
  assert.throws(() => validateDeliveryClips(workflow, 1, [base]));
});

test("edited export source becomes stale after revision or source change; old snapshot stays valid after unrelated updates", () => {
  const workflow = fixture(), snapshot = captureExportSource(applyDeliveryEdit(workflow, { episodeNo: 1, revision: 1 }), "video_export");
  assert.equal(exportSourceStatus(snapshot, workflow, "video_export"), "current");
  workflow.storyboards[2].dialogue = "其他集更新";
  assert.equal(exportSourceStatus(snapshot, workflow, "video_export"), "current");
  workflow.deliveryEdits![0].revision = 2;
  assert.equal(exportSourceStatus(snapshot, workflow, "video_export"), "stale");
  assert.throws(() => applyDeliveryEdit(workflow, { episodeNo: 1, revision: 1 }));
  workflow.deliveryEdits![0].revision = 1;
  workflow.assets[1].referenceUrl = "/storage/replacement.mp4";
  assert.throws(() => applyDeliveryEdit(workflow, { episodeNo: 1, revision: 1 }), /已替换/);
  assert.equal(exportSourceStatus(snapshot, workflow, "video_export"), "stale");
  assert.equal(shotVideoVersions(workflow.assets, "a").length, 2);
});
