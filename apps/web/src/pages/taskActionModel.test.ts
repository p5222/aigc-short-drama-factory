import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationTask } from "@aifilm/shared";
import { canRetryTask, canCancelTask, createTaskActionRunner, type PendingTaskActions } from "./taskActionModel.ts";

test("task capabilities never override terminal state and honor explicit refusal", () => {
  const task = (status: GenerationTask["status"], extra = {}) => ({ status, ...extra }) as GenerationTask;
  assert.equal(canRetryTask(task("failed")), true);
  assert.equal(canRetryTask(task("failed", { retryable: false })), false);
  assert.equal(canRetryTask(task("running", { retryable: true })), false);
  assert.equal(canCancelTask(task("running")), true);
  assert.equal(canCancelTask(task("pending", { cancelable: false })), false);
  assert.equal(canCancelTask(task("succeeded", { cancelable: true })), false);
});

test("same task cannot retry and cancel concurrently; independent tasks can run", async () => {
  const runner = createTaskActionRunner();
  const states: PendingTaskActions[] = [];
  let release!: () => void;
  let calls = 0;
  const first = runner.run("a", "retry", () => { calls++; return new Promise<void>((resolve) => { release = resolve; }); }, (state) => states.push(state));
  assert.deepEqual(await runner.run("a", "cancel", () => { calls++; }, () => undefined), { status: "ignored" });
  assert.deepEqual(await runner.run("b", "retry", () => { calls++; }, (state) => states.push(state)), { status: "succeeded" });
  assert.deepEqual(states[0], { a: "retry" });
  assert.deepEqual(states[1], { a: "retry", b: "retry" });
  release();
  assert.deepEqual(await first, { status: "succeeded" });
  assert.equal(calls, 2);
  assert.deepEqual(states.at(-1), {});
});

test("API rejection is visible and unlocks the task for a later retry", async () => {
  const runner = createTaskActionRunner();
  let pending: PendingTaskActions = {};
  assert.deepEqual(await runner.run("a", "retry", async () => { throw new Error("积分不足"); }, (state) => { pending = state; }), { status: "failed", message: "积分不足" });
  assert.deepEqual(pending, {});
  assert.deepEqual(await runner.run("a", "retry", async () => undefined, () => undefined), { status: "succeeded" });
});
