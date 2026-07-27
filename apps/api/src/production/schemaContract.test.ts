import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

test("persists episode versions and storyboard continuity", () => {
  assert.match(schema, /model ProductionEpisode/);
  assert.match(schema, /model EpisodeScriptVersion/);
  assert.match(schema, /allowExpansion\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /activeStoryboardVersion\s+Int\s+@default\(1\)/);
  for (const field of ["segmentProfile", "boundaryType", "firstFramePrompt", "lastFramePrompt", "continuitySourceShotId"]) {
    assert.match(schema, new RegExp(field));
  }
});
