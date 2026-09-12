import assert from "node:assert/strict";
import test from "node:test";
import type { ContentProjectSummary } from "@aifilm/shared";
import { buildProductionDraft, chapterGenerationPlan, chapterNavigationStage, contentEditorDirty, contentNavigationDecision, contentSourceForProject, reconcileContentEditor, isCurrentRequest, modeLabel, reconcileProjectId, sourceKindForMode, statusLabel } from "./model.ts";

const project = (id: string): ContentProjectSummary => ({ id, title: id, mode: "original", status: "draft", activeStep: "source", styleProfile: { key: "", name: "", category: "", summary: "", characterRules: [], sceneRules: [], lightingRules: [], cameraRules: [], materialRules: [], negativeRules: [] }, textProvider: "manjiao", textModel: "gpt-5.5", updatedAt: "", sourceCount: 0, chapterCount: 0, scriptCount: 0, hasEntities: false });

test("outline edits survive same-version refresh and retain edits to other chapters", () => {
  const base = { chapters: [{ title: "One" }, { title: "Two" }] };
  const current = reconcileContentEditor(null, "project-a:outline-1", base);
  const editing = { ...current, value: { chapters: [{ title: "Edited one" }, { title: "Two" }] } };
  const refreshed = reconcileContentEditor(editing, current.key, structuredClone(base));
  assert.equal(refreshed, editing);
  assert.equal(contentEditorDirty(refreshed), true);
  assert.equal(refreshed.value.chapters[0].title, "Edited one");
  assert.equal(refreshed.value.chapters[1].title, "Two");
});

test("a new content project or outline version never inherits another draft", () => {
  const current = { key: "project-a:outline-1", base: { title: "Original" }, value: { title: "Unsaved" } };
  for (const key of ["project-b:outline-1", "project-a:outline-2"]) {
    const next = reconcileContentEditor(current, key, { title: "Server" });
    assert.equal(next.value.title, "Server");
    assert.equal(contentEditorDirty(next), false);
  }
  const clean = reconcileContentEditor(null, current.key, { title: "Original" });
  assert.equal(reconcileContentEditor(clean, current.key, { title: "Updated on server" }).value.title, "Updated on server");
});

test("content navigation cannot discard a pending save and requires an explicit answer for dirty edits", () => {
  let confirmations = 0;
  assert.equal(contentNavigationDecision(true, true, () => { confirmations++; return true; }), "blocked");
  assert.equal(confirmations, 0);
  assert.equal(contentNavigationDecision(false, true, () => false), "blocked");
  assert.equal(contentNavigationDecision(false, true, () => true), "discard");
  assert.equal(contentNavigationDecision(false, false, () => { throw new Error("clean navigation must not prompt"); }), "continue");
});

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

test("plans the next chapter batch and all remaining chapters from persisted chapter numbers", () => {
  const outline = [1, 2, 3, 4, 5].map((chapterNo) => ({ chapterNo }));
  assert.deepEqual(chapterGenerationPlan(outline, [{ chapterNo: 1 }, { chapterNo: 2 }], 2), {
    nextChapter: 3,
    nextBatchSize: 2,
    remainingCount: 3
  });
  assert.deepEqual(chapterGenerationPlan(outline, outline, 3), {
    nextChapter: 6,
    nextBatchSize: 0,
    remainingCount: 0
  });
});

test("opens chapter content for editing even after a production script exists", () => {
  assert.equal(chapterNavigationStage("handoff"), "chapter");
  assert.equal(chapterNavigationStage("chapter"), "chapter");
});


test("returning to a cached project initializes the saved source without a false dirty draft", () => {
  const sources = { a: { title: "A source", content: "Saved source A" }, b: { title: "B source", content: "Saved source B" } };
  for (const id of ["a", "b", "a"]) {
    const source = contentSourceForProject(sources, id);
    assert.deepEqual(source, sources[id as "a" | "b"]);
    assert.equal(contentEditorDirty({ key: id, base: sources[id as "a" | "b"], value: source }), false);
  }
  const editable = contentSourceForProject(sources, "a");
  editable.content = "User edit";
  assert.equal(sources.a.content, "Saved source A");
  assert.deepEqual(contentSourceForProject(sources, "new"), { title: "", content: "" });
});
