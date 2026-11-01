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

test("story beats must quote actual text and include all spoken lines within time", () => {
  const raw = { title: "等到灯亮", synopsis: "主角按信上的线索留下灯", script: "场景一：旧书店，夜。阿青准备关门，发现门缝中的信纸。信上写着：请为晚归的人留一盏灯。阿青把信纸放在柜台，伸向开关的手停住。门外的脚步声渐近。\n阿青：今晚这盏灯，为你留着。\n他退回桌边坐下，门外的影子渐渐走近，灯光照亮门牌。", estimatedSeconds: 30,
    characters: [{ name: "阿青" }], scenes: [{ location: "书店", description: "夜灯" }],
    storyDesign: { goal: "关门", obstacle: "有人未归", choice: "留灯", payoff: "人影走近", beats: [
      { seconds: 15, action: "读信", evidence: "信上写着：请为晚归的人留一盏灯。", spokenText: "" },
      { seconds: 15, action: "留灯等人", evidence: "他退回桌边坐下", spokenText: "今晚这盏灯，为你留着。" }
    ] } };
  assert.equal(checkCreatorScript(raw, 30, [], { requireDesign: true }).findings.some(f => f.severity === "blocking"), false);
  assert.ok(checkCreatorScript({ ...raw, storyDesign: undefined }, 30, [], { requireDesign: true }).findings.some(f => f.code === "missing_story_design"));
  assert.ok(checkCreatorScript({ ...raw, storyDesign: { ...raw.storyDesign, beats: raw.storyDesign.beats.map(b => ({ ...b, evidence: "不在正文里的线索" })) } }, 30, []).findings.some(f => f.code.startsWith("beat_evidence")));
  assert.ok(checkCreatorScript({ ...raw, storyDesign: { ...raw.storyDesign, beats: raw.storyDesign.beats.map(b => ({ ...b, spokenText: "" })) } }, 30, []).findings.some(f => f.code === "unmapped_speech"));
  assert.ok(checkCreatorScript({ ...raw, storyDesign: { ...raw.storyDesign, beats: [raw.storyDesign.beats[0], { ...raw.storyDesign.beats[1], seconds: 1 }] } }, 30, []).findings.some(f => f.code.startsWith("speech_overflow")));
});

test("real sample regression catches omitted lines, paraphrased evidence and reordered dialogue", () => {
  const raw = { title: "雨夜修表店", synopsis: "女孩送还怀表，阿青读到旧字条", estimatedSeconds: 30,
    script: "场次一 店门口 夜 外\n雨声持续，阿青准备将停业通知贴在门上，女孩从雨棚边递来一只旧怀表。\n小女孩：我没打开过。\n阿青：谢谢。\n场次二 店内 夜 内\n他打开怀表后盖，展开字条。字条上写着：慢慢修，总有人等着。阿青把停业通知折起，放进抽屉。",
    characters: [{ name: "阿青" }, { name: "小女孩" }], scenes: [{ location: "修表店", description: "雨夜" }],
    storyDesign: { goal: "关店", obstacle: "失去信心", choice: "收起停业通知", payoff: "继续修表", beats: [
      { seconds: 8, action: "归还", evidence: "小女孩：我没打开过。", spokenText: "我没打开过。" },
      { seconds: 4, action: "致谢", evidence: "阿青：谢谢。", spokenText: "谢谢。" },
      { seconds: 18, action: "读信", evidence: "他打开怀表后盖", spokenText: "" }
    ] } };
  const blocked = (value: unknown) => checkCreatorScript(value, 30, [], { requireDesign: true }).findings.filter(f => f.severity === "blocking");
  assert.deepEqual(blocked(raw), []);
  const withBeats = (beats: typeof raw.storyDesign.beats) => ({ ...raw, storyDesign: { ...raw.storyDesign, beats } });
  const [first, second, third] = raw.storyDesign.beats;
  assert.ok(blocked(withBeats([{ ...first, spokenText: "" }, second, third])).some(f => f.code === "unmapped_speech"));
  assert.ok(blocked(withBeats([first, second, { ...third, evidence: "阿青打开怀表后盖" }])).some(f => f.code === "beat_evidence:2"));
  assert.ok(blocked(withBeats([second, first, third])).some(f => f.code === "speech_alignment"));
  assert.ok(blocked(withBeats([first, second, { ...third, spokenText: "谢谢。" }])).some(f => f.code === "speech_alignment"));
  const chatty = { ...raw, storyDesign: undefined, script: raw.script + "\n阿青：今天这件事情说来很长，我原本打算关掉这家店，谁也不再等了，但这块怀表让我想起父亲教我修表的时候，他总是说不要着急，慢慢来，每个人都有值得等待的事情，所以我想明天还会照常开门。" };
  assert.ok(checkCreatorScript(chatty, 30, [], { originalSpeechBudget: true }).findings.some(f => f.code === "original_speech_budget"));
  assert.equal(checkCreatorScript(chatty, 30, []).findings.some(f => f.code === "original_speech_budget"), false);
  const shortExchanges = { ...raw, storyDesign: undefined, script: raw.script + "\n阿青：嗯。\n小女孩：好。\n阿青：谢谢。\n小女孩：再见。\n阿青：再见。" };
  assert.equal(checkCreatorScript(shortExchanges, 30, [], { originalSpeechBudget: true }).findings.some(f => f.code === "original_speech_budget"), false);
});
