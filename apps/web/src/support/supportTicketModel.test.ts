import assert from "node:assert/strict";
import test from "node:test";
import type { SupportTicketSummary } from "@aifilm/shared";
import { attachSupportContext, captureSupportAttempt, claimSupportDraft, completeSupportAttempt, createSupportReadGate, emptySupportDraft, mergeSupportSummary, readSupportDraft, supportRequestId, supportStorageKey, validateSupportCreate, validateSupportMessage, writeSupportDraft } from "./supportTicketModel.ts";

test("attaching task context preserves draft fields, does not duplicate diagnostics and refuses overflow without truncation", () => {
  const context = { subject: "任务问题", category: "generation" as const, body: "平台任务编号：task-1" };
  const draft = { subject: "账单问题", category: "billing" as const, body: "我原来写下的内容" };
  const merged = attachSupportContext(draft, context);
  assert.equal(merged.subject, draft.subject);
  assert.equal(merged.category, draft.category);
  assert.equal(merged.body, `${draft.body}\n\n${context.body}`);
  assert.deepEqual(attachSupportContext(merged, context), merged);
  assert.deepEqual(attachSupportContext(emptySupportDraft(), context), context);
  assert.throws(() => attachSupportContext({ ...draft, body: "文".repeat(5000) }, context), /原草稿已保留/);
  assert.equal(draft.body, "我原来写下的内容");
});

function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
test("logical retries retain their request ID across remounts and version refreshes", () => {
  const store = storage(), key = supportStorageKey("user-a", "user", "reply:ticket-a");
  const first = supportRequestId(store, key, { body: "同一个问题", expectedVersion: 1 }, () => "request-one");
  assert.equal(supportRequestId(store, key, { expectedVersion: 3, body: "同一个问题" }, () => "must-not-use"), first);
  assert.notEqual(supportRequestId(store, key, { body: "修改问题", expectedVersion: 3 }, () => "request-two"), first);
});
test("successful actions start a fresh identity while failed actions keep the draft", () => {
  const store = storage(), key = supportStorageKey("user-a", "user", "create");
  const draft = { subject: "导出错误", category: "export" as const, body: "任务说明" };
  writeSupportDraft(store, key, draft);
  supportRequestId(store, key, draft, () => "request-one");
  assert.deepEqual(readSupportDraft(store, key), draft);
  assert.equal(completeSupportAttempt(store, key, captureSupportAttempt(store, key)), true);
  assert.deepEqual(readSupportDraft(store, key), emptySupportDraft());
  assert.equal(supportRequestId(store, key, draft, () => "request-two"), "request-two");
});
test("late create and reply responses cannot clear a remounted panel's newer draft or request", async () => {
  for (const action of ["create", "reply:ticket-one"]) {
    const store = storage(), key = supportStorageKey("user-a", "user", action);
    const draftA = { subject: "Old question", category: "other" as const, body: "Old body" };
    const draftB = { ...draftA, body: "New body after remount" };
    writeSupportDraft(store, key, draftA);
    supportRequestId(store, key, { body: draftA.body }, () => "request-old");
    const attemptA = captureSupportAttempt(store, key);
    let finishA!: () => void;
    const lateA = new Promise<void>(resolve => { finishA = resolve; }).then(() => completeSupportAttempt(store, key, attemptA));
    writeSupportDraft(store, key, draftB);
    supportRequestId(store, key, { body: draftB.body }, () => "request-new");
    const attemptB = captureSupportAttempt(store, key);
    finishA();
    assert.equal(await lateA, false);
    assert.deepEqual(readSupportDraft(store, key), draftB);
    assert.deepEqual(captureSupportAttempt(store, key), attemptB);
    assert.equal(completeSupportAttempt(store, key, attemptB), true);
  }
});
test("same-input remounts retain the accepted request identity but own a distinct draft revision", () => {
  const store = storage(), key = supportStorageKey("user-a", "user", "create");
  const draft = { subject: "Same question", category: "account" as const, body: "Same body" };
  writeSupportDraft(store, key, draft);
  const requestId = supportRequestId(store, key, draft, () => "request-same");
  const attemptA = captureSupportAttempt(store, key);
  writeSupportDraft(store, key, draft);
  assert.equal(supportRequestId(store, key, draft, () => "must-not-use"), requestId);
  const attemptB = captureSupportAttempt(store, key);
  assert.notEqual(attemptA?.draft, attemptB?.draft);
  assert.equal(completeSupportAttempt(store, key, attemptA), false);
  assert.deepEqual(captureSupportAttempt(store, key), attemptB);
  assert.equal(completeSupportAttempt(store, key, attemptB), true);
});
test("a newly edited unsent draft prevents late cleanup even before it has a new request ID", () => {
  const store = storage(), key = supportStorageKey("user-a", "user", "reply:ticket-one");
  const draftA = { ...emptySupportDraft(), body: "Submitted reply" }, draftB = { ...emptySupportDraft(), body: "New unsent reply" };
  writeSupportDraft(store, key, draftA);
  supportRequestId(store, key, { body: draftA.body }, () => "request-one");
  const attemptA = captureSupportAttempt(store, key);
  writeSupportDraft(store, key, draftB);
  assert.equal(completeSupportAttempt(store, key, attemptA), false);
  assert.deepEqual(readSupportDraft(store, key), draftB);
  assert.equal(captureSupportAttempt(store, key)?.request, attemptA?.request);
});

test("opening a saved reply claims its revision before an unchanged-text retry", () => {
  const store = storage(), key = supportStorageKey("user-a", "user", "reply:ticket-one");
  const draft = { ...emptySupportDraft(), body: "Reply awaiting confirmation" };
  writeSupportDraft(store, key, draft);
  const requestId = supportRequestId(store, key, { body: draft.body }, () => "request-same");
  const oldAttempt = captureSupportAttempt(store, key);
  assert.deepEqual(claimSupportDraft(store, key), draft);
  const reopened = captureSupportAttempt(store, key);
  assert.notEqual(reopened?.draft, oldAttempt?.draft);
  assert.equal(completeSupportAttempt(store, key, oldAttempt), false);
  assert.equal(supportRequestId(store, key, { body: draft.body }, () => "must-not-use"), requestId);
  assert.equal(completeSupportAttempt(store, key, reopened), true);
});
test("late close responses cannot clear newer reply drafts, with or without a previous request", () => {
  for (const previousRequest of [false, true]) {
    const store = storage(), key = supportStorageKey("user-a", "user", "reply:closing-ticket");
    const draftA = { ...emptySupportDraft(), body: "Draft at close" }, draftB = { ...emptySupportDraft(), body: "New draft after remount" };
    writeSupportDraft(store, key, draftA);
    if (previousRequest) supportRequestId(store, key, { body: draftA.body }, () => "old-reply-request");
    const closeAttempt = captureSupportAttempt(store, key);
    writeSupportDraft(store, key, draftB);
    supportRequestId(store, key, { body: draftB.body }, () => "new-reply-request");
    const next = captureSupportAttempt(store, key);
    assert.equal(completeSupportAttempt(store, key, closeAttempt), false);
    assert.deepEqual(captureSupportAttempt(store, key), next);
    assert.deepEqual(readSupportDraft(store, key), draftB);
  }
});
test("cleanup verifies the signature as well as the request ID and fails closed without a snapshot", () => {
  const store = storage(), key = supportStorageKey("user-a", "user", "create");
  supportRequestId(store, key, { body: "Original payload" }, () => "same-request-id");
  const original = captureSupportAttempt(store, key);
  supportRequestId(store, key, { body: "Different payload" }, () => "same-request-id");
  const next = captureSupportAttempt(store, key);
  assert.equal(completeSupportAttempt(store, key, original), false);
  assert.equal(completeSupportAttempt(store, key, undefined), false);
  assert.deepEqual(captureSupportAttempt(store, key), next);
});
test("drafts and attempts never cross accounts, staff views or tickets", () => {
  const store = storage(), draft = { subject: "私有标题", category: "billing" as const, body: "私有说明" };
  writeSupportDraft(store, supportStorageKey("a", "user", "reply:one"), draft);
  for (const key of [supportStorageKey("b", "user", "reply:one"), supportStorageKey("a", "staff", "reply:one"), supportStorageKey("a", "user", "reply:two")]) assert.deepEqual(readSupportDraft(store, key), emptySupportDraft());
});
test("unavailable persistence blocks submission identity instead of silently making an unsafe retry", () => {
  assert.throws(() => supportRequestId(undefined, "key", { body: "test" }), /重试标识/);
  const store = { ...storage(), setItem: () => { throw new Error("quota"); } };
  assert.throws(() => supportRequestId(store, "key", { body: "test" }), /存储权限/);
});
test("stale detail reads cannot replace a newly selected ticket", () => {
  const gate = createSupportReadGate(), a = gate.begin(), b = gate.begin();
  assert.equal(gate.current(a), false); assert.equal(gate.current(b), true);
  gate.cancel(); assert.equal(gate.current(b), false);
});
test("saved records replace one row and leave a status-filtered queue when their status changes", () => {
  const old = { id: "a", status: "open" } as SupportTicketSummary, next = { ...old, status: "answered" as const };
  assert.deepEqual(mergeSupportSummary([old], next, "open"), []);
  assert.deepEqual(mergeSupportSummary([old], next, "all"), [next]);
});
test("empty or oversized submissions are rejected without altering their inputs", () => {
  const draft = emptySupportDraft(); assert.match(validateSupportCreate(draft), /标题/);
  assert.match(validateSupportCreate({ ...draft, subject: "问题" }), /说明/);
  assert.equal(validateSupportCreate({ subject: " 问题 ", category: "account", body: " 有效说明 " }), "");
  assert.match(validateSupportMessage("x".repeat(5001)), /5000/);
  assert.deepEqual(draft, emptySupportDraft());
});
