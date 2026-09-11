import assert from "node:assert/strict";
import test from "node:test";
import { searchCreatorItems } from "./creatorSearchModel.ts";
test("search matches existing authorized records, supports multiple words, and keeps duplicate names as distinct records", () => {
  const items = [
    { id: "a", label: "夜行 第一集", detail: "漫剧作品", kind: "project" as const },
    { id: "b", label: "夜行 第一集", detail: "内容创作", kind: "content" as const },
    { id: "c", label: "清晨", detail: "任务 已完成", kind: "task" as const }
  ];
  assert.deepEqual(searchCreatorItems(items, "夜行 第一"), items.slice(0, 2));
  assert.deepEqual(searchCreatorItems(items, "作品 夜行"), [items[0]]);
  assert.deepEqual(searchCreatorItems(items, ""), []);
  assert.deepEqual(searchCreatorItems(items, "missing"), []);
  assert.equal(searchCreatorItems(items, "夜行", 1).length, 1);
});
