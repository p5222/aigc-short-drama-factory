import assert from "node:assert/strict";
import test from "node:test";
import { completeCheckoutRequest, pendingCheckoutRequests, persistCheckoutRequest } from "./checkoutStorage.ts";

function store() {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear() };
}
const input = { planId: "one", kind: "membership" as const,
  expected: { planName: "One", amountFen: 500, credits: 50, bonusCredits: 0, discountPercent: 10, priorityLevel: 1 } };
test("checkout retries survive reload, preserve the approved snapshot, and are isolated by account", () => {
  const storage = store();
  const first = persistCheckoutRequest("user-a", input, storage);
  const second = persistCheckoutRequest("user-a", { ...input, expected: { ...input.expected, amountFen: 600 } }, storage);
  assert.deepEqual(second, first);
  assert.deepEqual(pendingCheckoutRequests("user-a", storage), [first]);
  assert.deepEqual(pendingCheckoutRequests("user-b", storage), []);
  assert.notEqual(persistCheckoutRequest("user-b", input, storage).requestId, first.requestId);
});
test("terminal completion removes only its own identity and preserves other purchases", () => {
  const storage = store(), first = persistCheckoutRequest("user-a", input, storage);
  completeCheckoutRequest("user-a", first, storage);
  const next = persistCheckoutRequest("user-a", input, storage);
  completeCheckoutRequest("user-a", first, storage);
  assert.deepEqual(pendingCheckoutRequests("user-a", storage), [next]);
  completeCheckoutRequest("user-a", next, storage);
  assert.deepEqual(pendingCheckoutRequests("user-a", storage), []);
});
test("denied, silently dropped or malformed storage prevents unsafe new purchase identities", () => {
  const denied = { ...store(), setItem: () => { throw new Error("Quota"); } };
  assert.throws(() => persistCheckoutRequest("a", input, denied), /已暂停新购买/);
  assert.throws(() => pendingCheckoutRequests("a", denied), /已暂停新购买/);
  const silent = { ...store(), setItem: () => {} };
  assert.throws(() => persistCheckoutRequest("a", input, silent), /已暂停新购买/);
  const malformed = store();
  malformed.setItem("manjiao:checkout:v1:a:membership:one", "{}");
  assert.throws(() => pendingCheckoutRequests("a", malformed), /已暂停新购买/);
  assert.throws(() => persistCheckoutRequest("", input, store()), /已暂停新购买/);
});
