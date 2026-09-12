import assert from "node:assert/strict";
import test from "node:test";
import { hasFeedbackDraftChanges, hasShowcaseDraftChanges } from "./adminEditorDraftModel.ts";

const work = { title: "作品", description: "说明", category: "故事", creatorName: "作者", coverUrl: "cover", videoUrl: "video", durationLabel: "10 秒", featured: false, sortOrder: 0 };
test("showcase fields and review notes remain dirty until the actual saved value matches", () => {
  assert.equal(hasShowcaseDraftChanges(work, { ...work }, ""), false);
  assert.equal(hasShowcaseDraftChanges(work, { ...work, title: "新标题" }, ""), true);
  assert.equal(hasShowcaseDraftChanges(work, { ...work }, "需要修改结尾"), true);
  assert.equal(hasShowcaseDraftChanges({ ...work, title: "新标题", reviewNote: "说明" }, { ...work, title: "新标题" }, "说明"), false);
});

test("the feedback editor protects conclusions but does not treat its initial inferred cause as an edit", () => {
  const saved = { status: "open", priority: "p2" }, draft = { ...saved, rootCause: "视频缺失", assignee: "", resolution: "" };
  assert.equal(hasFeedbackDraftChanges(saved, draft, "视频缺失"), false);
  assert.equal(hasFeedbackDraftChanges(saved, { ...draft, resolution: "已复现，待修改" }, "视频缺失"), true);
  assert.equal(hasFeedbackDraftChanges({ ...saved, rootCause: "视频缺失", resolution: "已复现，待修改" }, { ...draft, resolution: "已复现，待修改" }, "视频缺失"), false);
});
