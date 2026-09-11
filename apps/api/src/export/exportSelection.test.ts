import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectWorkflow } from "@aifilm/shared";
import { selectExportWorkflow } from "./exportSelection.js";
import { buildLingGuoSrt } from "../agents/lingguoAdapter.js";

const workflow = { storyboards: [
  { id: "a", episodeNo: 1, dialogue: "第一集", duration: 2 },
  { id: "b", episodeNo: 2, dialogue: "第二集前镜头", duration: 3 },
  { id: "c", episodeNo: 2, dialogue: "第二集后镜头", duration: 4 }
] } as ProjectWorkflow;

test("exports only selected episode shots in the creator's order, including subtitles", () => {
  const selected = selectExportWorkflow(workflow, ["c", "b"]);
  assert.deepEqual(selected.storyboards.map(shot => shot.id), ["c", "b"]);
  const srt = buildLingGuoSrt(selected);
  assert.ok(srt.indexOf("第二集后镜头") < srt.indexOf("第二集前镜头"));
  assert.match(srt, /00:00:04,000 --> 00:00:07,000/);
  assert.ok(!srt.includes("第一集"));
  assert.equal(workflow.storyboards.length, 3);
});

test("rejects empty, repeated, stale and foreign export selections", () => {
  for (const ids of [[], ["a", "a"], ["foreign"]]) {
    assert.throws(() => selectExportWorkflow(workflow, ids));
  }
  assert.equal(selectExportWorkflow(workflow), workflow);
});
