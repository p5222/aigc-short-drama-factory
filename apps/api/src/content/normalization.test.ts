import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDevelopmentAnalysis, normalizeDevelopmentOutline } from "./normalization.js";

test("turns nested model analysis objects into concise creator-facing summaries", () => {
  const result = normalizeDevelopmentAnalysis({
    evidence: { mode: "model_prior", confidence: "0.7" },
    dimensions: {
      opening: { workBreakdown: [{ structuralRole: "开篇立即制造身份反差", usablePattern: "前三百字兑现标题承诺" }] },
      climax: ["矛盾集中爆发", { recommendedBeat: "主角主动夺回选择权" }],
      reversal: { summary: "旧线索在中段改写因果关系" },
      payoffs: { targetAdaptationFor20000Words: { recommendedBeat: "每两章兑现一次阶段收益" } }
    }
  });

  assert.equal(result.evidence.confidence, 0.7);
  assert.match(result.dimensions.opening, /身份反差/);
  assert.match(result.dimensions.opening, /兑现标题承诺/);
  assert.doesNotMatch(result.dimensions.opening, /workBreakdown|workId|evidenceType/);
  assert.match(result.dimensions.climax, /矛盾集中爆发/);
  assert.match(result.dimensions.payoffs, /阶段收益/);
});

test("coerces loose outline numbers and fills optional fields without rejecting a usable model result", () => {
  const result = normalizeDevelopmentOutline({
    title: "雾港回声",
    premise: "失忆调查员追查一场被抹去的事故。",
    chapters: [{ chapterNo: "1", title: "失踪名单", objective: "找到第一条线索", conflict: "证人拒绝开口", cliffhanger: "名单上出现主角自己", targetWords: "2000" }]
  });

  assert.equal(result.chapters[0]?.chapterNo, 1);
  assert.equal(result.chapters[0]?.targetWords, 2000);
  assert.equal(result.chapters[0]?.turn, "");
});
