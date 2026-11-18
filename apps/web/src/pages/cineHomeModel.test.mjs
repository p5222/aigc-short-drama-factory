import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMediaCandidates,
  normalizeMediaTier,
  resolveMediaTier
} from "./cineHomeModel.ts";

test("normalizes configured media tiers", () => {
  assert.equal(normalizeMediaTier("4k"), "4k");
  assert.equal(normalizeMediaTier("2k"), "2k");
  assert.equal(normalizeMediaTier("fast"), "fast");
  assert.equal(normalizeMediaTier("unknown"), "fast");
  assert.equal(normalizeMediaTier(undefined), "fast");
});

test("reduces media tiers on constrained connections", () => {
  assert.equal(resolveMediaTier("4k", false, "4g"), "4k");
  assert.equal(resolveMediaTier("4k", false, "3g"), "2k");
  assert.equal(resolveMediaTier("4k", false, "2g"), "fast");
  assert.equal(resolveMediaTier("4k", true, "4g"), "fast");
  assert.equal(resolveMediaTier("2k", false, "4g"), "2k");
  assert.equal(resolveMediaTier("fast", false, "4g"), "fast");
});

test("builds ordered fallback candidates", () => {
  assert.deepEqual(buildMediaCandidates("desert", "4k", ""), [
    "/media/cineart-home/desert_4k.mp4",
    "/media/cineart-home/desert_2k.mp4",
    "/media/cineart-home/desert_fast.mp4"
  ]);
  assert.deepEqual(buildMediaCandidates("photo-w", "2k", "https://cdn.example.com/"), [
    "https://cdn.example.com/media/cineart-home/photo-w_2k.mp4",
    "https://cdn.example.com/media/cineart-home/photo-w_fast.mp4"
  ]);
  assert.deepEqual(buildMediaCandidates("punk-future", "fast", ""), [
    "/media/cineart-home/punk-future_fast.mp4"
  ]);
});

test("keeps each scene fallback list independent", () => {
  const desert = buildMediaCandidates("desert", "4k", "");
  const bicycle = buildMediaCandidates("bicycle-smile", "4k", "");
  assert.equal(desert[0], "/media/cineart-home/desert_4k.mp4");
  assert.equal(bicycle[0], "/media/cineart-home/bicycle-smile_4k.mp4");
  assert.notEqual(desert[1], bicycle[1]);
});
