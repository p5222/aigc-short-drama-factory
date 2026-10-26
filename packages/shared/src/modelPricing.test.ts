import assert from "node:assert/strict";
import test from "node:test";
import { inspectModelPrice } from "./modelPricing.ts";

const route = { providerId: "video-a", model: "wan-v2", modality: "video" as const };
const price = { ...route, unit: "video_second" as const, unitCredits: 5, enabled: true };

test("billing rejects another route, modality, disabled rows, wrong units and conflicting prices", () => {
  assert.equal(inspectModelPrice([{ ...price, providerId: "video-b" }], route).state, "missing");
  assert.equal(inspectModelPrice([{ ...price, modality: "text" as const }], route).state, "missing");
  assert.equal(inspectModelPrice([{ ...price, enabled: false }], route).state, "missing");
  assert.equal(inspectModelPrice([{ ...price, unit: "image" as const }], route).state, "invalid");
  assert.equal(inspectModelPrice([price, { ...price, unitCredits: 10 }], route).state, "conflict");
});

test("only nonnegative safe integer prices qualify; explicit zero and legacy image2 remain supported", () => {
  for (const unitCredits of [-1, 1.2, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(inspectModelPrice([{ ...price, unitCredits }], route).state, "invalid");
  }
  assert.equal(inspectModelPrice([{ ...price, unitCredits: 0 }], route).price?.unitCredits, 0);
  const imageRoute = { ...route, modality: "image" as const };
  assert.equal(inspectModelPrice([{ ...price, ...imageRoute, unit: "image2" as const }], imageRoute).state, "ready");
});
