import assert from "node:assert/strict";
import test from "node:test";
import { planSourceSlices } from "./episodeService.js";

test("plans one novel episode per 20000 effective characters without losing source", () => {
  const content = "完整的正文句子。".repeat(6000);
  const slices = planSourceSlices(content, "novel");
  assert.equal(slices.length, 3);
  assert.equal(slices.map((slice) => slice.content).join(""), content);
  assert.deepEqual(slices.map((slice) => slice.episodeNo), [1, 2, 3]);
  assert.ok(slices.every(slice => slice.content.endsWith("。")));
});

test("source partitions preserve preambles, whitespace and unsplittable sentences", () => {
  const source = "故事前言\n\n第1集 雪夜\n甲入城。\n\n第2集 婚书\n乙迎战。\n";
  const slices = planSourceSlices(source, "script");
  assert.equal(slices.map(s => s.content).join(""), source);
  for (const slice of slices) assert.equal(source.slice(slice.start, slice.end), slice.content);
  assert.equal(planSourceSlices("未断句".repeat(20000), "novel").length, 1);
});

test("keeps explicit script episodes as source boundaries", () => {
  const content = "第1集 雪夜\n甲入城。\n第2集 婚书\n乙迎战。\n第3集 真相\n二人相认。";
  const slices = planSourceSlices(content, "script");
  assert.equal(slices.length, 3);
  assert.match(slices[0]!.content, /雪夜/);
  assert.doesNotMatch(slices[0]!.content, /婚书/);
  assert.match(slices[2]!.content, /二人相认/);
});
