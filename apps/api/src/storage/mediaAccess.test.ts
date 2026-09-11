import assert from "node:assert/strict";
import test from "node:test";
import { localMediaPath, mediaSignature, validMediaSignature } from "./mediaAccess.js";

test("provider signatures bind one exact file and expire within an hour", () => {
  const key = Buffer.alloc(48, 7), now = 1_000_000, expires = 1200;
  const path = "/storage/images/owner-file.png", signature = mediaSignature(path, expires, key);
  assert.equal(validMediaSignature(path, expires, signature, key, now), true);
  assert.equal(validMediaSignature("/storage/images/other.png", expires, signature, key, now), false);
  assert.equal(validMediaSignature(path, expires, signature, key, expires * 1000), false);
  assert.equal(validMediaSignature(path, 5000, signature, key, now), false);
  assert.equal(validMediaSignature(path, expires, "x", key, now), false);
});

test("private media paths reject non-media buckets and hidden files", () => {
  assert.equal(localMediaPath("/storage/images/photo.png"), "/storage/images/photo.png");
  assert.equal(localMediaPath("/storage/logs/secret.txt"), undefined);
  assert.equal(localMediaPath("/storage/.media-signing-key"), undefined);
  assert.equal(localMediaPath("/storage/images/.hidden"), undefined);
  assert.equal(localMediaPath("https://unrelated.invalid/storage/images/photo.png"), undefined);
});
