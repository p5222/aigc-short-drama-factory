import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseEpisodeShots, readBeijingMarriagePackage } from "./beijingMarriage.js";

const manifestPath = fileURLToPath(new URL("../../../web/public/samples/beijing-marriage/manifest.json", import.meta.url));

test("reads the completed package without mixing scripts and prompts", async () => {
  const pkg = await readBeijingMarriagePackage(manifestPath);
  assert.equal(pkg.episodes.length, 12);
  assert.match(pkg.episodes[0].script, /第1集/);
  assert.match(pkg.episodes[0].storyboard, /镜头 1/);
  assert.match(pkg.episodes[0].videoPrompt, /15秒/);
  assert.doesNotMatch(pkg.episodes[0].script, /分批生图清单/);
});

test("parses sixty continuity-aware shots", async () => {
  const pkg = await readBeijingMarriagePackage(manifestPath);
  const shots = pkg.episodes.flatMap(parseEpisodeShots);
  assert.equal(shots.length, 60);
  assert.equal(shots[0].boundaryType, "CUT_SCENE");
  assert.ok(shots.every((shot) => shot.videoPrompt));
});
