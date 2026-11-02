import assert from "node:assert/strict";
import test from "node:test";
import { mapTask } from "./mappers.js";

const row = { id: "task-1", type: "text", provider: "deepseek", model: "selected-model", status: "running", createdAt: new Date(), updatedAt: new Date() };

test("task responses hide internal execution leases and provider checkpoints", () => {
  for (const errorReason of [
    JSON.stringify({ kind: "creation_lease", leaseId: "private-lease" }),
    JSON.stringify({ kind: "media_checkpoint", metadata: { leaseId: "private-lease", remoteTaskId: "upstream-id", remoteVideoUrl: "https://cdn.example/private" } })
  ]) {
    assert.equal(mapTask({ ...row, errorReason }).errorReason, undefined);
  }
});

test("task responses retain actionable errors without exposing checkpoint metadata", () => {
  assert.equal(mapTask({ ...row, errorReason: JSON.stringify({ kind: "media_checkpoint", metadata: { lastError: "上游仍在处理中", leaseId: "private" } }) }).errorReason, "上游仍在处理中");
  assert.equal(mapTask({ ...row, errorReason: "额度不足" }).errorReason, "额度不足");
  assert.match(mapTask(row).fallbackHint!, /沿用本次任务的模型与报价/);
});

test("unknown submission state disables direct retry and cancellation without exposing private attempts", () => {
  const mapped = mapTask({ ...row, status: "pending", jobId: "creation-example",
    execution: { version: 1, reviewRequired: true, attempts: [{ id: "private-attempt-id", state: "unknown" }] } });
  assert.equal(mapped.reviewRequired, true); assert.equal(mapped.retryable, false); assert.equal(mapped.cancelable, false);
  assert.doesNotMatch(JSON.stringify(mapped), /private-attempt-id/);
  assert.equal(mapTask({ ...row, status: "failed", jobId: "creation-legacy" }).retryable, false);
  assert.equal(mapTask({ ...row, status: "canceled", jobId: "creation-new", execution: { version: 1, attempts: [], reviewRequired: false } }).retryable, true);
});
