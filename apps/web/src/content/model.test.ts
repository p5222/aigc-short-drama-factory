import assert from "node:assert/strict";
import test from "node:test";
import type { ContentProjectSummary } from "@aifilm/shared";
import { buildProductionDraft, isCurrentRequest, modeLabel, reconcileProjectId, sourceKindForMode, statusLabel } from "./model.ts";

const project = (id: string): ContentProjectSummary => ({ id, title: id, mode: "original", status: "draft", activeStep: "source", styleProfile: { key: "", name: "", category: "", summary: "", characterRules: [], sceneRules: [], lightingRules: [], cameraRules: [], materialRules: [], negativeRules: [] }, updatedAt: "", sourceCount: 0, chapterCount: 0, scriptCount: 0, hasEntities: false });

test("reconciles selection to a real project", () => {
  assert.equal(reconcileProjectId([project("a"), project("b")], "b"), "b");
  assert.equal(reconcileProjectId([project("a")], "missing"), "a");
  assert.equal(reconcileProjectId([], "a"), "");
});

test("maps mode, source kind and server status without inventing state", () => {
  assert.equal(modeLabel("adaptation"), "导入小说");
  assert.equal(sourceKindForMode("adaptation"), "novel");
  assert.equal(sourceKindForMode("same_genre"), "short_story");
  assert.equal(statusLabel("confirmed"), "已确认");
});

test("rejects stale async completion from another project or sequence", () => {
  const current = { projectId: "b", sequence: 2 };
  assert.equal(isCurrentRequest(current, { projectId: "a", sequence: 2 }), false);
  assert.equal(isCurrentRequest(current, { projectId: "b", sequence: 1 }), false);
  assert.equal(isCurrentRequest(current, { projectId: "b", sequence: 2 }), true);
});

test("hands completed content to production as a script without converting it again", () => {
  const draft = buildProductionDraft({ ...project("content-1"), title: "逆光之城", chapterCount: 3 }, "  第一场\n主角进入雨夜。  ");
  assert.equal(draft.sourceType, "script");
  assert.equal(draft.content, "第一场\n主角进入雨夜。");
  assert.equal(draft.title, "逆光之城");
  assert.equal(draft.targetEpisodes, 3);
  assert.equal(draft.contentProjectId, "content-1");
});
