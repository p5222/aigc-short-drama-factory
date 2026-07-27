import assert from "node:assert/strict";
import test from "node:test";
import { estimateCreation } from "./workflow.js";

test("uses the shared 20000-character production budget", () => {
  const estimate = estimateCreation({
    content: "故事".repeat(22_500),
    sourceType: "novel",
    mode: "director",
    targetEpisodes: 3
  });
  assert.equal(estimate.suggestedEpisodes, 3);
  assert.match(estimate.notes[0], /20,000/);
});

test("does not allow requested episodes above the source budget", () => {
  const estimate = estimateCreation({ content: "短故事", sourceType: "novel", mode: "director", targetEpisodes: 30 });
  assert.equal(estimate.suggestedEpisodes, 1);
});
