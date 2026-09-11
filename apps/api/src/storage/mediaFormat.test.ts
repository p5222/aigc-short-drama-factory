import test from "node:test";
import assert from "node:assert/strict";
import { mediaExtension } from "./mediaFormat.js";

test("media recognizes actual binary signatures regardless of CDN headers", () => {
  assert.equal(mediaExtension(Buffer.from([137,80,78,71,13,10,26,10,0]), "images"), "png");
  assert.equal(mediaExtension(Buffer.from("RIFFxxxxWEBPxxxx"), "images"), "webp");
  assert.equal(mediaExtension(Buffer.from("\x00\x00\x00\x18ftypisom"), "videos"), "mp4");
});
test("HTML, SVG and wrong media types cannot masquerade as image or video assets", () => {
  for (const bytes of [Buffer.from("<html>error</html>"), Buffer.from("<svg onload='alert(1)'>"), Buffer.alloc(0)]) {
    assert.throws(() => mediaExtension(bytes, "images"));
    assert.throws(() => mediaExtension(bytes, "videos"));
  }
  assert.throws(() => mediaExtension(Buffer.from("GIF89axxxx"), "videos"));
});
