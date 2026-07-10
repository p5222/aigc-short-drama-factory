import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMediaCandidates,
  getCardPose,
  normalizeMediaTier,
  relativeCardOffset,
  shouldCorrectDrift
} from "./cineHomeModel.ts";

test("normalizes configured media tiers", () => {
  assert.equal(normalizeMediaTier("4k"), "4k");
  assert.equal(normalizeMediaTier("2k"), "2k");
  assert.equal(normalizeMediaTier("fast"), "fast");
  assert.equal(normalizeMediaTier("unknown"), "4k");
  assert.equal(normalizeMediaTier(undefined), "4k");
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

test("wraps five-card offsets around the active card", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((index) => relativeCardOffset(index, 0, 5)), [0, 1, 2, -2, -1]);
  assert.deepEqual([0, 1, 2, 3, 4].map((index) => relativeCardOffset(index, 3, 5)), [2, -2, -1, 0, 1]);
});

test("returns the approved B1 collapsed geometry", () => {
  assert.deepEqual(getCardPose(0, 0, false, 5), {
    x: 0, y: -6, z: 120, rotateY: 0, rotateZ: 0, scale: 1, opacity: 1, zIndex: 90
  });
  assert.equal(getCardPose(1, 0, false, 5).x, 20);
  assert.equal(getCardPose(2, 0, false, 5).x, 40);
  assert.equal(getCardPose(4, 0, false, 5).x, -20);
});

test("returns the approved expanded geometry", () => {
  assert.deepEqual(getCardPose(0, 0, true, 5), {
    x: 0, y: -20, z: 120, rotateY: 0, rotateZ: 0, scale: 1.04, opacity: 1, zIndex: 90
  });
  assert.equal(getCardPose(1, 0, true, 5).x, 124);
  assert.equal(getCardPose(2, 0, true, 5).x, 220);
  assert.equal(getCardPose(3, 0, true, 5).x, -220);
});

test("only corrects visible playback drift beyond 120ms", () => {
  assert.equal(shouldCorrectDrift(4, 4.1), false);
  assert.equal(shouldCorrectDrift(4, 4.121), true);
  assert.equal(shouldCorrectDrift(4.2, 4), true);
});
