import assert from "node:assert/strict";
import test from "node:test";
import { rechargeCheckoutUrl } from "./creditCheckoutModel.ts";

test("checkout requires an enabled plan and its own configured web shop URL", () => {
  assert.equal(rechargeCheckoutUrl({ enabled: true, shopUrl: "https://shop.test/plan-a" }), "https://shop.test/plan-a");
  assert.equal(rechargeCheckoutUrl({ enabled: false, shopUrl: "https://shop.test/plan-a" }), null);
  assert.equal(rechargeCheckoutUrl({ enabled: true }), null);
  assert.equal(rechargeCheckoutUrl({ enabled: true, shopUrl: " " }), null);
  assert.equal(rechargeCheckoutUrl({ enabled: true, shopUrl: "javascript:alert(1)" }), null);
  assert.equal(rechargeCheckoutUrl({ enabled: true, shopUrl: "https://name:pass@shop.test" }), null);
});
