import test from "node:test";
import assert from "node:assert/strict";
import { contentStepStatusSchema, entityCatalogSchema, storyAnalysisSchema, storyOutlineSchema } from "./schemas.js";

test("story analysis rejects missing production facts", () => {
  assert.equal(storyAnalysisSchema.safeParse({ logline: "A" }).success, false);
});

test("story outline rejects duplicate chapter numbers", () => {
  const chapter = { chapterNo: 1, title: "起", objective: "找人", conflict: "受阻", turn: "发现", cliffhanger: "门开了" };
  assert.equal(storyOutlineSchema.safeParse({ title: "故事", premise: "前提", chapters: [chapter, chapter] }).success, false);
});

test("entity catalog rejects IDs duplicated across groups", () => {
  const result = entityCatalogSchema.safeParse({
    characters: [{ id: "entity_1", name: "人物", description: "主角" }],
    scenes: [{ id: "entity_1", name: "场景", description: "街道" }],
    props: []
  });
  assert.equal(result.success, false);
});

test("content status is a closed set", () => {
  assert.equal(contentStepStatusSchema.safeParse("succeeded").success, true);
  assert.equal(contentStepStatusSchema.safeParse("queued").success, false);
});
