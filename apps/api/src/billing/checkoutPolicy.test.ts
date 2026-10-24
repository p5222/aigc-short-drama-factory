import assert from "node:assert/strict";
import test from "node:test";
import { mockCheckoutEnabled } from "./checkoutPolicy.js";

test("production rejects simulated checkout even when an old deployment enables its flag", () => {
  for (const ENABLE_MOCK_PAYMENT of [undefined, "true", "false"]) {
    assert.equal(mockCheckoutEnabled({ NODE_ENV: "production", ENABLE_MOCK_PAYMENT }), false);
  }
  assert.equal(mockCheckoutEnabled({ NODE_ENV: "test" }), true);
  assert.equal(mockCheckoutEnabled({ NODE_ENV: "development", ENABLE_MOCK_PAYMENT: "false" }), false);
});
