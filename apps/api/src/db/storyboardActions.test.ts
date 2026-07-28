import assert from "node:assert/strict";
import test from "node:test";
import { mergeGeneratedStoryboardScope } from "./storyboardActions.js";

test("regenerating one episode preserves every other episode", () => {
  const existing = [{ id: "old-1", episodeNo: 1 }, { id: "old-2", episodeNo: 2 }, { id: "old-3", episodeNo: 3 }];
  const generated = [{ id: "new-1", episodeNo: 1 }];
  assert.deepEqual(mergeGeneratedStoryboardScope(existing, generated).map((shot) => shot.id), ["new-1", "old-2", "old-3"]);
});

test("generating multiple episodes replaces only those episodes", () => {
  const existing = [{ id: "old-1", episodeNo: 1 }, { id: "old-2", episodeNo: 2 }, { id: "old-3", episodeNo: 3 }];
  const generated = [{ id: "new-2", episodeNo: 2 }, { id: "new-3", episodeNo: 3 }];
  assert.deepEqual(mergeGeneratedStoryboardScope(existing, generated).map((shot) => shot.id), ["old-1", "new-2", "new-3"]);
});
