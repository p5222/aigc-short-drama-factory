import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectWorkflow } from "@aifilm/shared";
import { assertRealNarration, assertVideoExportReady } from "./exportRequirements.js";

test("formal video export rejects missing, unfinished and diagnostic assets", () => {
  const workflow = { storyboards: [{ id: "shot" }], assets: [] } as unknown as ProjectWorkflow;
  assert.throws(() => assertVideoExportReady(workflow));
  for (const asset of [
    { id: "video_shot", status: "running", referenceUrl: "/storage/videos/a.mp4" },
    { id: "video_shot", status: "succeeded", referenceUrl: "/storage/exports/diagnostic.json" }
  ]) assert.throws(() => assertVideoExportReady({ ...workflow, assets: [asset] } as ProjectWorkflow));
  assert.doesNotThrow(() => assertVideoExportReady({ ...workflow, assets: [
    { id: "video_shot", status: "succeeded", referenceUrl: "/storage/videos/a.mp4" }
  ] } as ProjectWorkflow));
});

test("speech cannot be substituted with a scratch waveform; intentional silence is allowed", () => {
  assert.throws(() => assertRealNarration("scratch-local-wav", true));
  assert.doesNotThrow(() => assertRealNarration("silence", false));
  assert.doesNotThrow(() => assertRealNarration("dashscope-tts", true));
});
