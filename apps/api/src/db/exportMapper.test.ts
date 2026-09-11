import assert from "node:assert/strict";
import test from "node:test";
import { mapExportJob } from "./mappers.js";

const row = { id: "export-1", projectId: "project-1", type: "video_export", status: "succeeded", outputUrl: "/storage/video.mp4", createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") };

test("export metadata preserves exact shot order and is not displayed as a failure", () => {
  const job = mapExportJob({ ...row, errorReason: JSON.stringify({ kind: "export_diagnostics", storyboardIds: ["b", "a"], outputKind: "mp4" }) });
  assert.deepEqual(job.storyboardIds, ["b", "a"]);
  assert.equal(job.errorReason, undefined);
});

test("legacy and invalid export ranges stay unknown instead of partially matching an episode", () => {
  for (const storyboardIds of [undefined, [], ["a", 2], [""], ["a", "a"]]) {
    const job = mapExportJob({ ...row, errorReason: JSON.stringify({ kind: "export_diagnostics", storyboardIds }) });
    assert.equal(job.storyboardIds, undefined);
  }
  assert.equal(mapExportJob({ ...row, errorReason: "配音失败" }).errorReason, "配音失败");
});
