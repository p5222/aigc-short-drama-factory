import assert from "node:assert/strict";
import test from "node:test";
import type { CreateProjectInput } from "@aifilm/shared";
import { assertUsableScriptOutput, assertStoryboardContent, structuredTextProviderOptions, buildScriptPrompt, extractSceneNames, normalizeScriptOutput, shouldUseResponsesApi } from "./generator.js";
import { analyzeScriptShotPlan, createToonflowStoryboardPlan } from "./toonflowAdapter.js";

const baseInput: CreateProjectInput = {
  title: "测试作品",
  sourceType: "script",
  content: "第1场：雨夜街口\n林晚：你终于来了。",
  mode: "nine_grid",
  genre: "都市",
  videoRatio: "9:16",
  artStyle: "二维国漫"
};

test("script source keeps the supplied script and creates a scene asset", () => {
  const result = normalizeScriptOutput("proj_test_script", baseInput, {
    synopsis: "雨夜重逢",
    script: baseInput.content,
    characters: [{ name: "林晚", identity: "主角", appearance: "短发", costume: "风衣", personality: "坚定" }]
  }, "real");
  assert.equal(result.script.content, baseInput.content);
  assert.ok(result.characters.length >= 1);
  assert.ok(result.assets.some((asset) => asset.type === "scene"));
});

test("novel source is routed through the built-in novel-to-script prompt", () => {
  const prompt = buildScriptPrompt({ ...baseInput, sourceType: "novel" });
  assert.match(prompt, /novel_to_script|小说|原文/);
  assert.match(prompt, /不得新增|唯一来源/);
});

test("script source is routed to structural decomposition without rewriting", () => {
  const prompt = buildScriptPrompt(baseInput);
  assert.match(prompt, /禁止改编、续写或重新创作/);
  assert.match(prompt, /完整保留原剧本正文/);
});

test("shot planning follows the parsed script instead of a fixed density", () => {
  const compactScript = "第1集\n第1场 雨夜街口\n林晚：你来了。\n顾沉转身。";
  const denseScript = "第1集\n第1场 雨夜街口\n林晚：你终于来了，我等了整整十年。\n顾沉转身，走近，停下。\n第2场 旧车站\n顾沉：我没有忘记。\n林晚后退，攥紧车票，抬头。";
  const compact = analyzeScriptShotPlan(compactScript, 1);
  const dense = analyzeScriptShotPlan(denseScript, 1);
  assert.ok(dense[0].suggestedShots > compact[0].suggestedShots);
  assert.equal(dense[0].sceneCount, 2);
  const prompt = createToonflowStoryboardPlan(baseInput, { synopsis: "重逢", content: denseScript }, [{ name: "林晚", identity: "主角", appearance: "短发", costume: "风衣", personality: "坚定" }]).prompt;
  assert.doesNotMatch(prompt, /exactly|每集 15 条/);
  assert.match(prompt, /剧本分析后的镜头计划/);
});

test("empty model output is rejected instead of being persisted", () => {
  assert.throws(
    () => assertUsableScriptOutput({ script: "", characters: [] }, "script"),
    /未返回剧本正文/
  );
  assert.throws(
    () => assertUsableScriptOutput({ script: "有正文", characters: [] }, "novel"),
    /未提取到有效角色/
  );
});

test("scene extraction always returns a usable scene", () => {
  assert.deepEqual(extractSceneNames("第1场：宫墙雨廊\n人物对白", "古装"), ["宫墙雨廊"]);
  assert.equal(extractSceneNames("只有对白，没有场景标题", "都市").length, 1);
});

test("storyboard generation rejects invented speech, foreign characters and duplicate shots", () => {
  const shot = { episodeNo: 1, sceneNo: 1, shotNo: 1, duration: 5, characters: ["林晚"], scene: "雨夜街口", pictureDesc: "她抬头", dialogue: "林晚：你终于来了。", voiceOver: "", imagePrompt: "静态抬头前", videoPrompt: "慢慢抬头" } as any;
  assert.doesNotThrow(() => assertStoryboardContent([shot], baseInput.content, ["林晚"]));
  assert.throws(() => assertStoryboardContent([{ ...shot, dialogue: "我是你的父亲。" }], baseInput.content, ["林晚"]), /无法在确认剧本/);
  assert.throws(() => assertStoryboardContent([{ ...shot, characters: ["新人"] }], baseInput.content, ["林晚"]), /未确认角色/);
  assert.throws(() => assertStoryboardContent([shot, { ...shot, dialogue: "" }], baseInput.content, ["林晚"]), /重复镜号/);
});
test("structured DeepSeek V4 generation disables default thinking without altering other routes", () => {
  assert.deepEqual(structuredTextProviderOptions("deepseek", "deepseek-v4-flash", true), { thinking: { type: "disabled" } });
  assert.deepEqual(structuredTextProviderOptions("deepseek", "deepseek-flash", true), { thinking: { type: "disabled" } });
  assert.deepEqual(structuredTextProviderOptions("deepseek", "deepseek-v4-pro", false), {});
  assert.deepEqual(structuredTextProviderOptions("deepseek", "deepseek-reasoner", true), {});
  assert.deepEqual(structuredTextProviderOptions("private", "deepseek-v4-flash", true), {});
});

test("storyboards preserve individual dialogue lines, their order and coverage", () => {
  const shot = { episodeNo: 1, sceneNo: 1, shotNo: 1, duration: 8, characters: ["甲", "乙"], scene: "店里", pictureDesc: "两人交谈", dialogue: "甲（低声）：留下吧。\n乙：我等你。", voiceOver: "灯还亮着。", imagePrompt: "两人站在店门口", videoPrompt: "甲放下饭盒" } as any;
  const source = "店里。\n甲（低声）：留下吧。\n乙：我等你。\n旁白：灯还亮着。";
  assert.doesNotThrow(() => assertStoryboardContent([shot], source, ["甲", "乙"]));
  assert.throws(() => assertStoryboardContent([{ ...shot, dialogue: "甲：留下吧。" }], source, ["甲", "乙"]), /未完整分配/);
  assert.throws(() => assertStoryboardContent([{ ...shot, dialogue: "乙：我等你。\n甲：留下吧。" }], source, ["甲", "乙"]), /按顺序定位/);
  assert.throws(() => assertStoryboardContent([shot, { ...shot, shotNo: 2 }], source, ["甲", "乙"]), /重复或倒置/);
});

test("scene extraction recognizes production script environment lines", () => {
  const script = [
    "第1集 七日前的煜星",
    "开场画面：黎明前的青黑屋内，炉火将熄，窗纸透出冷光。",
    "场景描述：沈宅药房，药柜、铜秤和药炉形成固定空间锚点。",
    "地点：沈宅后院雨廊"
  ].join("\n");
  assert.deepEqual(extractSceneNames(script, "古装"), ["黎明前的青黑屋内", "沈宅药房", "沈宅后院雨廊"]);
});

test("responses wire mode never overrides a resolved non-OpenAI provider", () => {
  const previous = process.env.OPENAI_TEXT_WIRE_API;
  process.env.OPENAI_TEXT_WIRE_API = "responses";
  try {
    assert.equal(shouldUseResponsesApi({}, "dashscope-text"), false);
    assert.equal(shouldUseResponsesApi({}, "manjiao"), false);
    assert.equal(shouldUseResponsesApi({}, "openai-upstream"), true);
    assert.equal(shouldUseResponsesApi({ textProvider: "openai-upstream" }, "openai-upstream"), true);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_TEXT_WIRE_API;
    else process.env.OPENAI_TEXT_WIRE_API = previous;
  }
});
