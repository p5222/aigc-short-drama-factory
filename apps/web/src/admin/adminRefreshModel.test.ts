import assert from "node:assert/strict";
import test from "node:test";
import { firstAdminRefreshFailure } from "./adminRefreshModel.ts";

test("partial admin refresh failure surfaces the actual permission or network error", () => {
  const denied = new Error("没有此模块权限");
  assert.equal(firstAdminRefreshFailure([{ status: "fulfilled", value: [] }, { status: "rejected", reason: denied }]), denied);
  assert.match(firstAdminRefreshFailure([{ status: "rejected", reason: undefined }])!.message, /读取失败/);
});

test("complete refresh does not report an error", () => {
  assert.equal(firstAdminRefreshFailure([{ status: "fulfilled", value: [] }, { status: "fulfilled", value: 0 }]), undefined);
});
