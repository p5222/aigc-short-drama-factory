import assert from "node:assert/strict";
import test from "node:test";
import { scopedAdminNotice } from "./adminNoticeModel.ts";

test("opening another dialog cannot inherit an earlier mutation error or success", () => {
  const previous = { version: 4, message: "积分已调整", error: "邮箱已被使用" };
  assert.deepEqual(scopedAdminNotice(previous, 4), { message: "", error: "" });
  assert.deepEqual(scopedAdminNotice(previous, 5), { message: "", error: "" });
});

test("current dialog retains its failed attempt and successful retry until it is reopened", () => {
  const openedAt = 4;
  assert.deepEqual(scopedAdminNotice({ version: 6, message: "", error: "邮箱已被使用" }, openedAt), { message: "", error: "邮箱已被使用" });
  const retry = { version: 8, message: "账号已创建", error: "" };
  assert.deepEqual(scopedAdminNotice(retry, openedAt), { message: "账号已创建", error: "" });
  assert.deepEqual(scopedAdminNotice(retry, retry.version), { message: "", error: "" });
});
