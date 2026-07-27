import assert from "node:assert/strict";
import test from "node:test";
import { analyzeProductionEpisodes, episodeGenerationOptions, resolveNextEpisodeNumbers } from "./episodePlanning.ts";

test("budgets novels at about 20000 effective characters per episode", () => {
  const analysis = analyzeProductionEpisodes(`第一章\n${"正文".repeat(22_500)}`, "novel");
  assert.equal(analysis.maxEpisodes, 3);
  assert.equal(analysis.basis, "chapter");
});

test("uses explicit episode headings as a script hard limit", () => {
  const analysis = analyzeProductionEpisodes("第1集 雪夜\n剧情\n第2集 入城\n剧情\n第3集 婚书\n剧情", "script");
  assert.equal(analysis.maxEpisodes, 3);
  assert.equal(analysis.basis, "episode");
});

test("offers every remaining count and all remaining", () => {
  assert.deepEqual(episodeGenerationOptions(5, [1, 2]).map((item) => item.value), [1, 2, 3, "all"]);
  assert.deepEqual(resolveNextEpisodeNumbers(5, [1, 2, 3], 2), [4, 5]);
  assert.throws(() => resolveNextEpisodeNumbers(3, [1, 2], 2), /仅剩余 1 集/);
});
