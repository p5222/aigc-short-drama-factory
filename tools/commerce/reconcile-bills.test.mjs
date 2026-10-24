import assert from "node:assert/strict";
import test from "node:test";
import { reconcileBills } from "./reconcile-bills.mjs";
const snapshot = { payments: [{ channel: "wechat", tradeNo: "fixture-trade", orderId: "fixture-order", amountMinor: 3990 }],
  providerRequests: [{ providerId: "fixture-video", requestId: "fixture-request", taskId: "fixture-task", platformCredits: 136 }] };
const bills = { payments: [{ ...snapshot.payments[0], currency: "CNY", status: "succeeded" }],
  providers: [{ providerId: "fixture-video", requestId: "fixture-request", amountMinor: 123, currency: "USD" }] };
test("exact bill matching retains currency and never converts platform credits to cash", () => {
  const result = reconcileBills(snapshot, bills);
  assert.equal(result.status, "matched"); assert.equal(result.costByProviderCurrency["fixture-video:USD"], 123);
  assert.equal(result.supplierMatches[0].platformCredits, 136);
});
test("empty bills are insufficient evidence", () => {
  assert.equal(reconcileBills({ payments: [], providerRequests: [] }, { payments: [], providers: [] }).status, "insufficient_evidence");
});
test("amount, order or refund mismatches require review", () => {
  for (const change of [{ amountMinor: 3991 }, { orderId: "wrong" }, { status: "refunded" }]) {
    const result = reconcileBills(snapshot, { ...bills, payments: [{ ...bills.payments[0], ...change }] });
    assert.equal(result.status, "needs_review");
  }
});
test("unmatched supplier charges, missing bills and untraceable tasks block a matched result", () => {
  const result = reconcileBills({ ...snapshot, untraceableTasks: [{ taskId: "unknown-receipt" }] },
    { ...bills, providers: [{ ...bills.providers[0], requestId: "other" }] });
  assert.equal(result.status, "needs_review"); assert.equal(result.issues.length, 3);
});
test("duplicate supplier request identifiers and malformed money are rejected", () => {
  assert.throws(() => reconcileBills(snapshot, { ...bills, providers: [bills.providers[0], bills.providers[0]] }), /duplicate/);
  assert.throws(() => reconcileBills(snapshot, { ...bills, providers: [{ ...bills.providers[0], amountMinor: 1.5 }] }), /amount/);
});
