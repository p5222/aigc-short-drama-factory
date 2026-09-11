import assert from "node:assert/strict";
import test from "node:test";
import type { StoryboardShot } from "@aifilm/shared";
import { createShotDraftState, reduceShotDraftState } from "../model.ts";
import { canDiscardContentDraft, contentShotDraft } from "./contentDraftModel.ts";

const shot = { id: "a", pictureDesc: "旧画面", action: "走进房间", dialogue: "你好", voiceOver: "天亮了", emotion: "平静" } as StoryboardShot;

test("canceling content navigation preserves all unsaved dialogue and narration", () => {
  const dirty = reduceShotDraftState(createShotDraftState("a", contentShotDraft(shot)), { type: "edit", patch: { dialogue: "修改的台词", voiceOver: "修改的旁白" } });
  let confirmations = 0;
  assert.equal(canDiscardContentDraft(dirty, () => { confirmations += 1; return false; }), false);
  assert.equal(confirmations, 1);
  assert.equal(dirty.draft.dialogue, "修改的台词");
  assert.equal(dirty.draft.voiceOver, "修改的旁白");
  assert.equal(canDiscardContentDraft(dirty, () => true), true);
  const canceled = reduceShotDraftState(dirty, { type: "rebuild", shotId: shot.id, draft: contentShotDraft(shot) });
  assert.equal(canceled.draft.dialogue, "你好");
  assert.equal(canceled.draft.voiceOver, "天亮了");
  assert.equal(canceled.status, "unchanged");
});

test("save errors keep the content draft protected while committed refresh failures are safe to leave", () => {
  const dirty = reduceShotDraftState(createShotDraftState("a", contentShotDraft(shot)), { type: "edit", patch: { voiceOver: "新旁白" } });
  const saving = reduceShotDraftState(dirty, { type: "save-start", token: "save-a" });
  assert.equal(canDiscardContentDraft(saving, () => { throw new Error("saving must not prompt"); }), false);
  const failed = reduceShotDraftState(saving, { type: "save-failed", token: "save-a", error: "offline" });
  assert.equal(canDiscardContentDraft(failed, () => false), false);
  assert.equal(failed.draft.voiceOver, "新旁白");
  const committed = reduceShotDraftState(saving, { type: "save-committed", token: "save-a", refreshError: "刷新失败" });
  assert.equal(canDiscardContentDraft(committed, () => { throw new Error("already saved"); }), true);
  assert.equal(committed.draft.voiceOver, "新旁白");
});

test("polling and late saves do not replace a content edit or a different selected scene", () => {
  const dirty = reduceShotDraftState(createShotDraftState("a", contentShotDraft(shot)), { type: "edit", patch: { dialogue: "未保存" } });
  const polled = reduceShotDraftState(dirty, { type: "reconcile-canonical", shotId: "a", draft: contentShotDraft(shot) });
  assert.equal(polled.draft.dialogue, "未保存");
  const saving = reduceShotDraftState(dirty, { type: "save-start", token: "a-save" });
  const other = reduceShotDraftState(saving, { type: "rebuild", shotId: "b", draft: { dialogue: "另一个镜头" } });
  const late = reduceShotDraftState(other, { type: "save-committed", token: "a-save", draft: { dialogue: "未保存" } });
  assert.equal(late.shotId, "b");
  assert.equal(late.draft.dialogue, "另一个镜头");
});
