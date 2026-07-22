import assert from "node:assert/strict";
import test from "node:test";
import { isPersistedPlayableVideoReference, isPublishableVideoUrl } from "./videoMedia.ts";

test("recognizes canonical persisted video references across API and web", () => {
  assert.equal(isPersistedPlayableVideoReference("https://cdn.example.com/media/video?id=42"), true);
  assert.equal(isPersistedPlayableVideoReference("http://cdn.example.com/no-extension?token=abc"), true);
  assert.equal(isPersistedPlayableVideoReference("/storage/projects/p1/video/clip"), true);
  assert.equal(isPersistedPlayableVideoReference("data:video/mp4;base64,AAAA"), true);
  assert.equal(isPersistedPlayableVideoReference("task-123"), false);
  assert.equal(isPersistedPlayableVideoReference("blob:https://example.com/local"), false);
  assert.equal(isPersistedPlayableVideoReference(""), false);
  assert.equal(isPersistedPlayableVideoReference(undefined), false);
});

test("enforces the strict showcase publishable video file contract", () => {
  assert.equal(isPublishableVideoUrl("https://cdn.example.com/final.mp4"), true);
  assert.equal(isPublishableVideoUrl("http://cdn.example.com/final.webm?token=abc"), true);
  assert.equal(isPublishableVideoUrl("/storage/projects/p1/final.mov#preview"), true);
  assert.equal(isPublishableVideoUrl("https://example.com/poster.jpg"), false);
  assert.equal(isPublishableVideoUrl("https://example.com/watch?id=42"), false);
  assert.equal(isPublishableVideoUrl("data:video/mp4;base64,AAAA"), false);
  assert.equal(isPublishableVideoUrl("task-123"), false);
  assert.equal(isPublishableVideoUrl("blob:https://example.com/local"), false);
});
