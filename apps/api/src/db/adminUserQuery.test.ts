import assert from "node:assert/strict";
import test from "node:test";
import { adminUserPageQuery } from "./adminUserQuery.js";

test("admin account filters reject invalid ranges, arbitrary sort fields and oversized pages", () => {
  assert.equal(adminUserPageQuery.safeParse({ registeredFrom: "2026-10-26T00:00:00Z", registeredTo: "2026-10-25T23:59:59Z" }).success, false);
  assert.equal(adminUserPageQuery.safeParse({ registeredFrom: "not-a-date" }).success, false);
  assert.equal(adminUserPageQuery.safeParse({ sort: "passwordHash" }).success, false);
  assert.equal(adminUserPageQuery.safeParse({ pageSize: "101" }).success, false);
  const query = adminUserPageQuery.parse({ pageSize: "50", registeredFrom: "2026-10-25T00:00:00+08:00", registeredTo: "2026-10-25T23:59:59+08:00", sort: "login_desc" });
  assert.equal(query.pageSize, 50);
  assert.equal(query.page, 1);
});
