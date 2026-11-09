import assert from "node:assert/strict";
import test from "node:test";
import { contentProjectInput } from "./routes.js";

test("content project input leaves omitted routes for platform default resolution", () => {
  assert.deepEqual(contentProjectInput.parse({ title: " 新故事 ", mode: "original" }), {
    title: "新故事", mode: "original"
  });
});

test("content project input accepts a complete selection and rejects incomplete routes", () => {
  const base = { title: "新故事", mode: "original" };
  const selected = { ...base, textProvider: "deepseek", textModel: "deepseek-v4-pro" };
  assert.deepEqual(contentProjectInput.parse(selected), selected);
  for (const route of [
    { textProvider: "deepseek" }, { textModel: "deepseek-v4-pro" },
    { textProvider: "", textModel: "" }, { textProvider: "deepseek", textModel: " " }
  ]) {
    assert.equal(contentProjectInput.safeParse({ ...base, ...route }).success, false);
  }
});
