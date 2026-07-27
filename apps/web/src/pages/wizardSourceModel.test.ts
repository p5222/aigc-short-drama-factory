import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSourceEpisodes, episodeScopeOptions, parseSampleManifest } from "./wizardSourceModel.ts";

test("uses explicit novel chapters instead of collapsing them by total character count", () => {
  const content = [1, 2, 3, 4, 5].map((chapter) => `第${chapter}章 标题\n${"正文".repeat(340)}`).join("\n\n");
  const analysis = analyzeSourceEpisodes(content, "novel");
  assert.equal(analysis.maxEpisodes, 5);
  assert.equal(analysis.unitCount, 5);
  assert.equal(analysis.basis, "chapter");
});

test("uses explicit episode headings for an existing script", () => {
  const analysis = analyzeSourceEpisodes("第1集 雪夜\n场景1\n剧情\n第2集 入城\n场景1\n剧情\n第3集 婚书\n场景1\n剧情", "script");
  assert.equal(analysis.maxEpisodes, 3);
  assert.equal(analysis.basis, "episode");
});

test("falls back to roughly 2000 characters only when no structure exists", () => {
  const analysis = analyzeSourceEpisodes("故事".repeat(1700), "novel");
  assert.equal(analysis.maxEpisodes, 2);
  assert.equal(analysis.basis, "length");
});

test("offers first episode, first two episodes and all detected episodes", () => {
  assert.deepEqual(episodeScopeOptions({ maxEpisodes: 5 }), [
    { value: 1, label: "先生成 1 集" },
    { value: 2, label: "先生成前 2 集" },
    { value: 5, label: "生成全部 5 集" }
  ]);
  assert.deepEqual(episodeScopeOptions({ maxEpisodes: 1 }), [{ value: 1, label: "生成全部 1 集" }]);
});

test("accepts a normal-flow sample only when its episodes are ordered", () => {
  const sample = parseSampleManifest({ title: "北境婚书", sourceType: "script", episodes: [
    { episodeNo: 1, title: "雪夜", content: "场景 / 剧情 / 人物 / 动作 / 对话" },
    { episodeNo: 2, title: "入城", content: "场景 / 剧情 / 人物 / 动作 / 对话" }
  ], assets: { characters: 6, scenes: 18, props: 10 } });
  assert.equal(sample.targetEpisodes, 2);
  assert.match(sample.content, /第1集 雪夜/);
  assert.match(sample.content, /第2集 入城/);
  assert.throws(() => parseSampleManifest({ title: "坏样例", sourceType: "script", episodes: [{ episodeNo: 2, title: "错序", content: "内容" }] }), /连续/);
});
