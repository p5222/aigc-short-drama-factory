import assert from "node:assert/strict";
import test from "node:test";
import { formatAdminMoney, formatAdminTaskSuccess } from "./adminMetricsModel.ts";

test("unknown costs never become zero currency or profit", () => {
  assert.equal(formatAdminMoney(null), "待对账");
  assert.equal(formatAdminMoney(undefined), "待对账");
  assert.equal(formatAdminMoney(NaN), "待对账");
  assert.equal(formatAdminMoney(0), "¥0.00");
  assert.equal(formatAdminMoney(18.2), "¥18.20");
});

test("empty or missing task denominator does not report false 0 percent failure", () => {
  assert.equal(formatAdminTaskSuccess(0, 0), "暂无已结束任务");
  assert.equal(formatAdminTaskSuccess(undefined, undefined), "未读取");
  assert.equal(formatAdminTaskSuccess(75, 4), "75%");
});
