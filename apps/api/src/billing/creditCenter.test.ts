import assert from "node:assert/strict";
import test from "node:test";
import { ledgerCsv, pageQuery } from "./creditCenter.js";
test("ledger pagination rejects unsafe limits and negative offsets", () => {
  assert.deepEqual(pageQuery({ page: "2", pageSize: "20" }), { page: 2, pageSize: 20, skip: 20 });
  for (const query of [{ page: 0 }, { page: "2.5" }, { pageSize: 1000 }, { page: 100001 }, { pageSize: -1 }]) assert.throws(() => pageQuery(query), /分页/);
});
test("financial CSV guards spreadsheet formulas and quotes/newlines", () => {
  const csv = ledgerCsv([{ id: "tx_test", type: "adjust", amount: -10, balanceAfter: 20, description: '=HYPERLINK("unsafe")\nsecond line', createdAt: "2026-10-26T00:00:00Z" }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes(`"'=HYPERLINK(""unsafe"")\nsecond line"`));
  assert.ok(csv.includes(`"'-10"`));
});
