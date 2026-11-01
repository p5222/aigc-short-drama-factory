import assert from "node:assert/strict";
import test from "node:test";
import { appendRevisionFeedback, briefQuestions, estimateSpeechSeconds, scriptRevisionRecipes } from "./creativeQuality.ts";
import type { CreatorBrief } from "./creatorAgent.ts";

test("optional brief questions follow missing fields without blocking an idea", () => {
  const brief = { protagonistGoal: "主角送信", obstacle: " " } as CreatorBrief;
  assert.equal(briefQuestions(brief).length, 4);
  assert.ok(briefQuestions(brief).some(question => question.includes("挡住")));
});
test("revision recipes preserve author feedback, avoid duplicates and never truncate a long draft", () => {
  const recipe = scriptRevisionRecipes[0].text;
  const combined = appendRevisionFeedback("一定保留原结局。", recipe)!;
  assert.ok(combined.startsWith("一定保留原结局。"));
  assert.equal(appendRevisionFeedback(combined, recipe), combined);
  assert.equal(appendRevisionFeedback("稿".repeat(1999), recipe), null);
});
test("speech estimate counts mixed languages and pauses, excluding stage directions", () => {
  assert.ok(estimateSpeechSeconds("你好，see you tomorrow。") > estimateSpeechSeconds("你好"));
  assert.equal(estimateSpeechSeconds("（低声）你好"), estimateSpeechSeconds("你好"));
});
