import assert from "node:assert/strict";
import test from "node:test";
import { isPlayableVideoUrl } from "./videoMedia.ts";

test("recognizes canonical persisted video URLs across API and web", () => {
  assert.equal(isPlayableVideoUrl("https://cdn.example.com/media/video?id=42"), true);
  assert.equal(isPlayableVideoUrl("http://cdn.example.com/no-extension?token=abc"), true);
  assert.equal(isPlayableVideoUrl("/storage/projects/p1/video/clip"), true);
  assert.equal(isPlayableVideoUrl("data:video/mp4;base64,AAAA"), true);
  assert.equal(isPlayableVideoUrl("task-123"), false);
  assert.equal(isPlayableVideoUrl("blob:https://example.com/local"), false);
  assert.equal(isPlayableVideoUrl(""), false);
  assert.equal(isPlayableVideoUrl(undefined), false);
});
