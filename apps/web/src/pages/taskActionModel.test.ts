import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationTask } from "@aifilm/shared";
import { canRetryTask, canCancelTask, createTaskActionRunner, taskRecoveryHint, taskSupportDiagnostic, taskSupportDraft, type PendingTaskActions } from "./taskActionModel.ts";

test("blocked recovery does not invite another charge and diagnostics exclude private payloads", () => {
  const task = { id: "platform-id", jobId: "private-queue-id", type: "video", status: "failed", retryable: false,
    errorReason: "private error", title: "private title", requestPayload: { apiKey: "secret" }, estimatedCredits: 20,
    createdAt: "2026-10-26", updatedAt: "2026-10-26" } as unknown as GenerationTask;
  assert.match(taskRecoveryHint(task), /不能从队列直接重试/);
  assert.match(taskRecoveryHint({ ...task, status: "running" }), /先刷新/);
  assert.match(taskRecoveryHint({ ...task, retryable: true }), /可以重试/);
  const diagnostic = taskSupportDiagnostic(task);
  assert.match(diagnostic, /platform-id/);
  assert.doesNotMatch(diagnostic, /secret|private/);
  const draft = taskSupportDraft(task);
  assert.equal(draft.category, "generation");
  assert.doesNotMatch(JSON.stringify(draft), /secret|private/);
  assert.equal(taskSupportDraft({ ...task, type: "export" }).category, "export");
});

test("accepted mutation with failed refresh blocks another charge until an explicit refresh succeeds", async () => {
  const runner = createTaskActionRunner();
  let calls = 0;
  const execute = async () => { calls++; };
  const failedRefresh = async () => { throw new Error("断网"); };
  const result = await runner.mutate("a", "retry", execute, failedRefresh, () => undefined);
  assert.equal(result.status, "sync-required");
  assert.equal(runner.isAwaitingSync("a"), true);
  assert.deepEqual(await runner.mutate("a", "retry", execute, failedRefresh, () => undefined), { status: "ignored" });
  await runner.run("__refresh__", "refresh", failedRefresh, () => undefined);
  assert.equal(runner.isAwaitingSync("a"), true);
  await runner.run("__refresh__", "refresh", async () => {}, () => undefined);
  assert.equal(runner.isAwaitingSync("a"), false);
  await runner.mutate("a", "retry", execute, async () => {}, () => undefined);
  assert.equal(calls, 2);
});

test("mutations and refresh cannot overlap on the same queue snapshot", async () => {
  const runner = createTaskActionRunner();
  let finish!: () => void;
  const mutation = runner.mutate("a", "cancel", () => new Promise<void>(resolve => { finish = resolve; }), async () => {}, () => undefined);
  assert.deepEqual(await runner.run("__refresh__", "refresh", async () => {}, () => undefined), { status: "ignored" });
  finish(); await mutation;
  const refresh = runner.run("__refresh__", "refresh", () => new Promise<void>(resolve => { finish = resolve; }), () => undefined);
  assert.deepEqual(await runner.mutate("b", "retry", async () => {}, async () => {}, () => undefined), { status: "ignored" });
  finish(); await refresh;
});
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
