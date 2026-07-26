import assert from "node:assert/strict";
import test from "node:test";
import { getPromptDefinition } from "./catalog.js";

test("content creation modes use distinct prompt definitions", () => {
  const keys = ["title_story_planning", "genre_story_research", "reference_story_research"];
  for (const key of keys) {
    const definition = getPromptDefinition(key);
    assert.ok(definition, `${key} must exist`);
    assert.equal(definition.stage, "analysis");
    assert.match(definition.systemPrompt, /model_prior|模型|作品/);
  }
});

test("chapter prompt preserves one chapter and continuity handoff", () => {
  const definition = getPromptDefinition("chapter_generation");
  assert.ok(definition);
  assert.ok(definition.variables.includes("previousHandoff"));
  assert.match(definition.systemPrompt, /仅生成指定章节/);
});
