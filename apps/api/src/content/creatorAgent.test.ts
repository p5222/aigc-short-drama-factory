import assert from "node:assert/strict";
import test from "node:test";
import { assembleContext } from "./contextBudget.js";
import { checkCreatorScript, creatorRunInput } from "./creatorContracts.js";
import { factConflict, relevantFacts } from "./storyMemory.js";
import type { StoryFact } from "@aifilm/shared";

const fact = (values: Partial<StoryFact> = {}): StoryFact => ({
  id: "fact", subject: "阿青", predicate: "伤势", value: "右手受伤", status: "locked", sourceType: "chapter",
  sourceId: "chapter2", sourceVersion: 1, validFrom: 2, validTo: null, knownBy: ["阿青"], revision: 1, ...values
});
test("flashbacks and knowledge scope exclude future or privately known facts", () => {
  const facts = [fact(), fact({ id: "identity", predicate: "身份", value: "修表师", validFrom: 1, knownBy: [] }),
    fact({ id: "old", status: "stale" }), fact({ id: "candidate", status: "candidate" })];
  assert.deepEqual(relevantFacts(facts, 1).map(f => f.id), ["identity"]);
  assert.deepEqual(relevantFacts(facts, 3, "小雨").map(f => f.id), ["identity"]);
  assert.deepEqual(relevantFacts(facts, 3, "阿青").map(f => f.id), ["fact", "identity"]);
  assert.equal(factConflict(fact(), fact({ value: "健康", validFrom: 1, validTo: 1 })), false);
  assert.equal(factConflict(fact(), fact({ value: "健康", validFrom: 3 })), true);
});
test("context keeps mandatory facts, exposes omissions, and refuses silent truncation", () => {
  const sources = [{ id: "lock", label: "锁定设定", content: "重要身份", required: true },
    { id: "history", label: "旧章节", content: "正文".repeat(500), required: false }];
  const result = assembleContext(sources, { budgetTokens: 150, reservedOutputTokens: 40, safetyTokens: 20 });
  assert.equal(result.selected.lock, "重要身份");
  assert.equal(result.manifest.sources.find(s => s.id === "history")?.included, false);
  assert.throws(() => assembleContext(sources.map(s => ({ ...s, required: true })), { budgetTokens: 150, reservedOutputTokens: 40, safetyTokens: 20 }), /必需资料/);
});
test("quality checks separate structural conflicts from author acceptance", () => {
  const raw = { title: "旧表", synopsis: "寻找旧信", script: "场景：旧书店。阿青翻开书，看见一封旧信。小雨推门而入，两人决定先读完信再行动。".repeat(3),
    estimatedSeconds: 60, characters: [{ name: "阿青" }], scenes: [{ location: "旧书店", description: "书架" }], factUpdates: [] };
  const valid = checkCreatorScript(raw, 60, []);
  assert.ok(valid.script);
  assert.equal(valid.findings.some(f => f.severity === "blocking"), false);
  assert.equal(valid.findings[0]?.layer, "author");
  assert.ok(checkCreatorScript({ ...raw, estimatedSeconds: 120 }, 30, []).findings.some(f => f.code === "duration"));
  assert.ok(checkCreatorScript({ ...raw, factUpdates: [{ subject: "阿青", predicate: "伤势", value: "健康", validFrom: 3 }] }, 60, [fact()]).findings.some(f => f.code === "locked_fact_conflict"));
  assert.equal(checkCreatorScript({ script: "缺少字段" }, 30, []).script, null);
});
test("run contract cannot expand call budget or carry arbitrary tool permissions", () => {
  const input = { requestId: "952069dd-cf3b-47e4-a861-a9c9ec9ab82e", expectedRevision: 1, maximumCredits: 100, maxCalls: 3 };
  assert.equal(creatorRunInput.safeParse(input).success, false);
  assert.equal(creatorRunInput.safeParse({ ...input, maxCalls: 1, tools: ["shell"] }).success, false);
});
