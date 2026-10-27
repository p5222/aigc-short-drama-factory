import assert from "node:assert/strict";
import test from "node:test";
import { closeAfterAdminSuccess, createAdminActionRunner, createCreditAdjustmentAttempt, isValidCreditAdjustment, isValidModelPriceDraft, readAdminHash, runAdminBatch } from "./adminActionModel.ts";

test("double click executes one mutation and keeps pending through refresh", async () => {
  const notices: { pending: boolean; message: string; error: string }[] = [];
  let finish!: () => void;
  let calls = 0;
  const run = createAdminActionRunner((state) => notices.push(state));
  const first = run(async () => { calls += 1; }, "已保存", () => new Promise<void>((resolve) => { finish = resolve; }));
  await Promise.resolve();
  assert.equal(await run(async () => { calls += 1; }, "重复"), false);
  assert.equal(calls, 1);
  assert.equal(notices.at(-1)?.pending, true);
  finish();
  assert.equal(await first, true);
  assert.equal(notices.at(-1)?.pending, false);
});

test("mutation rejection retains modal draft and permits retry", async () => {
  let closed = false;
  const notices: { error: string }[] = [];
  const run = createAdminActionRunner((state) => notices.push(state));
  assert.equal(await closeAfterAdminSuccess(() => run(async () => { throw new Error("邮箱已被使用"); }, "已创建"), () => { closed = true; }), false);
  assert.equal(closed, false);
  assert.match(notices.at(-1)!.error, /邮箱已被使用/);
  await closeAfterAdminSuccess(() => run(async () => {}, "已创建"), () => { closed = true; });
  assert.equal(closed, true);
});

test("refresh failure reports committed mutation instead of encouraging duplicate credit adjustment", async () => {
  const notices: { message: string; error: string }[] = [];
  const run = createAdminActionRunner((state) => notices.push(state));
  assert.equal(await run(async () => {}, "积分已调整", async () => { throw new Error("断网"); }), true);
  assert.match(notices.at(-1)!.message, /积分已调整/);
  assert.match(notices.at(-1)!.error, /勿重复提交/);
});

test("batch stops after failure and retains unprocessed selection", async () => {
  const called: string[] = [];
  const completed = await runAdminBatch(["a", "b", "c"], async (id) => { called.push(id); return id !== "b"; });
  assert.deepEqual(called, ["a", "b"]);
  assert.deepEqual(completed, ["a"]);
});

test("credit adjustment requires a nonzero safe integer and reason", () => {
  for (const amount of ["", "0", "1.5", "NaN", "Infinity", "9007199254740992"]) assert.equal(isValidCreditAdjustment(amount, "补偿"), false);
  assert.equal(isValidCreditAdjustment("100", ""), false);
  assert.equal(isValidCreditAdjustment("-10", "纠正错误入账"), true);
});

test("price forms reject blank or fractional credits while preserving explicit free prices and decimal costs", () => {
  for (const value of ["", " ", "-1", "1.5", "Infinity", "NaN", "9007199254740992"]) assert.equal(isValidModelPriceDraft(value, "0.01"), false);
  for (const cost of ["", " ", "-0.1", "Infinity", "NaN"]) assert.equal(isValidModelPriceDraft("20", cost), false);
  assert.equal(isValidModelPriceDraft("0", "0"), true);
  assert.equal(isValidModelPriceDraft("20", "0.001"), true);
});
test("malformed admin hash cannot crash page", () => {
  assert.equal(readAdminHash("#%E0%A4%A"), "");
  assert.equal(readAdminHash("#%E7%94%A8%E6%88%B7%E7%AE%A1%E7%90%86"), "用户管理");
});

test("credit retries preserve request id until committed or explicitly edited", () => {
  let next = 0;
  const attempt = createCreditAdjustmentAttempt(() => `id-${++next}`);
  const input = { userId: "user-1", amount: 100, description: "运营补偿" };
  const requestId = attempt.getRequestId(input);
  assert.equal(attempt.getRequestId({ ...input }), requestId);
  assert.notEqual(attempt.getRequestId({ ...input, amount: 101 }), requestId);
  const edited = attempt.getRequestId({ ...input, amount: 101 });
  attempt.complete();
  assert.notEqual(attempt.getRequestId({ ...input, amount: 101 }), edited);
});
