import test from "node:test";
import assert from "node:assert/strict";
import { auditPayload } from "./audit.js";

test("audit stores business action metadata without credentials or private scripts", () => {
  const value = auditPayload({ password: "secret-password", apiKey: "sk-secret", script: "private-story", status: "active", amount: 12, nested: { token: "secret" } });
  const json = JSON.stringify(value);
  assert.ok(!json.includes("secret") && !json.includes("private-story"));
  assert.equal(value.values?.amount, 12);
  assert.equal(value.values?.status, "active");
});
