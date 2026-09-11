import assert from "node:assert/strict";
import test from "node:test";
import type { CreateProjectInput } from "@aifilm/shared";
import { createWizardDraftStorage, MANUAL_WIZARD_DRAFT_KEY } from "./wizardDraftStorage.ts";

function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
const draft = { content: "客户脚本", title: "未提交作品" } as CreateProjectInput;

test("automatic draft resumes in current tab without writing customer content to localStorage", () => {
  const local = storage(); const session = storage();
  const drafts = createWizardDraftStorage(() => ({ local, session }));
  assert.equal(drafts.save(draft), true);
  assert.equal(local.getItem(MANUAL_WIZARD_DRAFT_KEY), null);
  assert.deepEqual(createWizardDraftStorage(() => ({ local, session })).read(), draft);
  assert.equal(createWizardDraftStorage(() => ({ local, session: storage() })).read(), null);
});

test("only explicit manual save persists; logout/new project clears both copies", () => {
  const local = storage(); const session = storage();
  const drafts = createWizardDraftStorage(() => ({ local, session }));
  drafts.save(draft, true);
  drafts.save({ ...draft, content: "本次未保存修改" });
  assert.equal(drafts.read()?.content, "本次未保存修改");
  assert.deepEqual(createWizardDraftStorage(() => ({ local })).read(), draft);
  drafts.clear();
  assert.equal(drafts.read(), null);
});

test("corrupt and blocked storage do not crash the creation form", () => {
  const local = storage(); local.setItem(MANUAL_WIZARD_DRAFT_KEY, "[]");
  assert.equal(createWizardDraftStorage(() => ({ local })).read(), null);
  assert.equal(createWizardDraftStorage(() => ({})).save(draft), false);
});
