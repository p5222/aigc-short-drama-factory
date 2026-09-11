import assert from "node:assert/strict";
import test from "node:test";
import { CREATION_ATTEMPT_KEY, getCreationRequestId } from "./creationAttemptStorage.ts";
test("a lost creation response and page reload reuse the durable request key, including a new credit confirmation", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  let sequence = 0; const create = () => `request-${++sequence}`;
  const input = { title: "夜行", content: "场景一", textModel: "model-a", maxCredits: 20 };
  assert.equal(getCreationRequestId(storage, input, create), "request-1");
  assert.equal(getCreationRequestId({ ...storage }, { maxCredits: 30, textModel: "model-a", content: "场景一", title: "夜行" }, create), "request-1");
  assert.equal(getCreationRequestId(storage, { ...input, title: "新作品" }, create), "request-2");
  values.delete(CREATION_ATTEMPT_KEY);
  assert.equal(getCreationRequestId(storage, input, create), "request-3");
});
test("blocked request persistence fails before a paid create request can be submitted", () => {
  assert.throws(() => getCreationRequestId({ getItem: () => null, setItem: () => { throw new Error("storage blocked"); } }, { content: "scene" }, () => "new-id"), /storage blocked/);
});
