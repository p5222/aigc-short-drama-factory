import assert from "node:assert/strict";
import test from "node:test";
import { modelCreditRange, rechargeCheckoutUrl } from "./creditCheckoutModel.ts";
import type { ModelPrice } from "@aifilm/shared";

test("checkout requires an enabled plan and its own configured web shop URL", () => {
  assert.equal(rechargeCheckoutUrl({ enabled: true, shopUrl: "https://shop.test/plan-a" }), "https://shop.test/plan-a");
  assert.equal(rechargeCheckoutUrl({ enabled: false, shopUrl: "https://shop.test/plan-a" }), null);
  assert.equal(rechargeCheckoutUrl({ enabled: true }), null);
  assert.equal(rechargeCheckoutUrl({ enabled: true, shopUrl: " " }), null);
  assert.equal(rechargeCheckoutUrl({ enabled: true, shopUrl: "javascript:alert(1)" }), null);
  assert.equal(rechargeCheckoutUrl({ enabled: true, shopUrl: "https://name:pass@shop.test" }), null);
});

const price = (unit: ModelPrice["unit"], unitCredits: number, enabled = true) => ({ unit, unitCredits, enabled }) as ModelPrice;

test("price references use the complete enabled range rather than whichever model is first", () => {
  const prices = [price("image", 120), price("image", 40), price("image", 80), price("image", 1, false), price("text_run", 8)];
  assert.equal(modelCreditRange(prices, "image"), "40–120");
  assert.equal(modelCreditRange([...prices].reverse(), "image"), "40–120");
  assert.equal(modelCreditRange(prices, "text_run"), "8");
});

test("missing or invalid prices do not turn into invented fees and a real zero remains zero", () => {
  assert.equal(modelCreditRange([], "video_second"), null);
  assert.equal(modelCreditRange([price("video_second", 90, false), price("video_second", Number.NaN), price("video_second", -1)], "video_second"), null);
  assert.equal(modelCreditRange([price("text_run", 0)], "text_run"), "0");
});
