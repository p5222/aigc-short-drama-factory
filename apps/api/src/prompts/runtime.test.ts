import test from "node:test";
import assert from "node:assert/strict";
import { materializePrompt, renderPrompt } from "./runtime.js";

test("renders nested variables and preserves JSON values", () => {
  assert.equal(renderPrompt("角色 {{character.name}} / {{tags}}", { character: { name: "林晚" }, tags: ["冷静", "坚定"] }), '角色 林晚 / ["冷静","坚定"]');
});

test("fails closed when a prompt variable is missing", () => {
  assert.throws(() => renderPrompt("{{missing}}", {}), /缺少变量/);
});

test("materializes a versioned prompt snapshot", () => {
  const result = materializePrompt("novel_to_script", { content: "雨夜重逢", episodes: 1, ratio: "9:16", styleProfile: "新三维国风" });
  assert.equal(result.key, "novel_to_script");
  assert.equal(result.version, "1.0.0");
  assert.match(result.userPrompt, /雨夜重逢/);
  assert.equal(result.snapshot.key, "novel_to_script");
});
