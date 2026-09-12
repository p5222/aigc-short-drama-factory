import assert from "node:assert/strict";
import test from "node:test";
import { adminPageRange } from "./adminPaginationModel.ts";

test("empty collections report zero entries and never show an impossible 1–0 range", () => {
  assert.deepEqual(adminPageRange(0, 8), { page: 1, pages: 1, pageSize: 20, start: 0, end: 0, total: 0 });
});
test("all fifty-one records remain reachable in nonoverlapping pages", () => {
  const rows = Array.from({ length: 51 }, (_, index) => index);
  const visited = [1, 2, 3].flatMap(page => { const range = adminPageRange(rows.length, page); return rows.slice(range.start, range.end); });
  assert.deepEqual(visited, rows);
});
test("a deletion clamps the former last page to the remaining range", () => {
  assert.deepEqual(adminPageRange(20, 2), { page: 1, pages: 1, pageSize: 20, start: 0, end: 20, total: 20 });
});
