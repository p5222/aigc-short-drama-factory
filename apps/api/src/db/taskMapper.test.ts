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

test("review presentation distinguishes active submissions, unknown results and resolved tasks", () => {
  const execution = { version: 1, reviewRequired: false, attempts: [{ id: "attempt", state: "submitted" }] };
  assert.equal(mapTask({ ...row, execution }).reviewRequired, false);
  const unknown = mapTask({ ...row, execution: { ...execution, attempts: [{ id: "attempt", state: "unknown" }] } });
  assert.equal(unknown.reviewRequired, true); assert.match(unknown.refundPolicy!, /仍冻结/);
  const media = { ...row, status: "failed", errorReason: JSON.stringify({ kind: "media_checkpoint", metadata: { needsReconciliation: true } }) };
  assert.equal(mapTask(media).reviewRequired, true);
  assert.equal(mapTask(media).retryable, false);
  assert.equal(mapTask({ ...media, status: "canceled" }).reviewRequired, false);
});

test("only well-formed content billing links expose a story destination", () => {
  assert.equal(mapTask({ ...row, jobId: "content:story-42:billing:parent-1:child-1" }).contentProjectId, "story-42");
  for (const jobId of ["content:story-42:billing:parent-1", "content:../bad:billing:parent:child", "content:story:billing:parent:child:extra", "media:story:billing:parent:child"]) {
    assert.equal(mapTask({ ...row, jobId }).contentProjectId, undefined);
  }
});
