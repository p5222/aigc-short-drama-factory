import assert from "node:assert/strict";
import test from "node:test";
import { defaultImageUnitCredits, normalizeImageProviderId, resolveImageUnitCredits } from "./imageGeneration.ts";

test("keeps Ripp image pricing isolated from ZML and other relays", () => {
  assert.equal(normalizeImageProviderId("ripp-image"), "ripp-image");
  assert.equal(defaultImageUnitCredits("ripp-image"), 28);
  assert.equal(resolveImageUnitCredits([
    { providerId: "ripp-image", modality: "image", model: "gpt-image-2", unitCredits: 31, enabled: true },
    { providerId: "zml-image", modality: "image", model: "gpt-image-2", unitCredits: 99, enabled: true }
  ], "ripp-image", "gpt-image-2"), 31);
});
