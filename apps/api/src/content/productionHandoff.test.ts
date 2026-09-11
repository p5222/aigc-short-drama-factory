import assert from "node:assert/strict";
import test from "node:test";
import { collectHandoffEntities, handoffEntityId } from "./productionHandoff.js";

test("handoff combines known named entities and dialogue without inventing placeholder characters", () => {
  const result = collectHandoffEntities({ script: "地点：旧车站\n旁白：雨停了。\n小雨（低声）：你终于来了。\n阿青：我等了很久。", outline: { characters: [{ name: "小雨", identity: "修表师", appearance: "短发" }] }, episodes: [{ scenes: [{ location: "旧车站", characters: ["小雨", "阿青"] }], dialogue: [{ speaker: "阿青", text: "我们走吧" }], props: [{ name: "怀表", description: "刻有日期" }] }] });
  assert.deepEqual(result.characters.map((item) => item.name), ["小雨", "阿青"]);
  assert.equal(result.characters[0]!.identity, "修表师");
  assert.deepEqual(result.scenes.map((item) => item.name), ["旧车站"]);
  assert.deepEqual(result.props.map((item) => item.name), ["怀表"]);
  assert.deepEqual(collectHandoffEntities({ script: "没有明确角色或场景的描述" }), { characters: [], scenes: [], props: [] });
});

test("handoff entity identity is stable across repeated syncs and independent between projects", () => {
  assert.equal(handoffEntityId("role", "p", "小雨"), handoffEntityId("role", "p", "小雨"));
  assert.notEqual(handoffEntityId("role", "p", "小雨"), handoffEntityId("role", "q", "小雨"));
});
