import type { SupportTicketCategory, SupportTicketStatus, SupportTicketSummary } from "@aifilm/shared";

export const supportCategories: Record<SupportTicketCategory, string> = { account: "账号问题", billing: "积分与账单", generation: "内容生成", export: "成片与导出", other: "其他问题" };
export const supportStatuses: Record<SupportTicketStatus, string> = { open: "待处理", answered: "已回复", closed: "已关闭" };
export type SupportCreateDraft = { subject: string; category: SupportTicketCategory; body: string };
export const emptySupportDraft = (): SupportCreateDraft => ({ subject: "", category: "other", body: "" });
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function supportStorageKey(userId: string, mode: "user" | "staff", action: string) {
  return `manjiao_support:${encodeURIComponent(userId)}:${mode}:${encodeURIComponent(action)}`;
}

export function readSupportDraft(storage: Store | undefined, key: string): SupportCreateDraft {
  try {
    const value = JSON.parse(storage?.getItem(`${key}:draft`) ?? "null");
    if (value && typeof value.subject === "string" && typeof value.body === "string" && Object.hasOwn(supportCategories, value.category)) {
      return { subject: value.subject.slice(0, 120), category: value.category, body: value.body.slice(0, 5000) };
    }
  } catch { /* Invalid browser drafts do not replace server records. */ }
  return emptySupportDraft();
}

export function writeSupportDraft(storage: Store | undefined, key: string, draft: SupportCreateDraft) {
  try { storage?.setItem(`${key}:draft`, JSON.stringify({ ...draft, revision: crypto.randomUUID() })); } catch { /* Keep the editable in-memory draft. */ }
}

export function claimSupportDraft(storage: Store | undefined, key: string): SupportCreateDraft {
  const draft = readSupportDraft(storage, key);
  // Opening a saved reply is a new editing session, even before its text changes.
  writeSupportDraft(storage, key, draft);
  return draft;
}

export function supportRequestId(storage: Store | undefined, key: string, input: Record<string, unknown>, createId: () => string = () => crypto.randomUUID()): string {
  const signature = JSON.stringify(Object.fromEntries(Object.entries(input).filter(([name]) => !["requestId", "expectedVersion"].includes(name)).sort(([a], [b]) => a.localeCompare(b))));
  if (!storage) throw new Error("浏览器无法保存重试标识，请允许会话存储后再提交；当前输入仍保留在页面中。");
  try {
    let saved: { requestId?: string; signature?: string } | null = null;
    try { saved = JSON.parse(storage.getItem(`${key}:request`) ?? "null"); } catch { /* Replace invalid old metadata. */ }
    if (saved?.signature === signature && typeof saved.requestId === "string" && saved.requestId.length >= 8) return saved.requestId;
    const requestId = createId();
    storage.setItem(`${key}:request`, JSON.stringify({ requestId, signature }));
    return requestId;
  } catch { throw new Error("无法保存工单重试标识，请检查浏览器存储权限后重试。当前输入未清空。"); }
}

export interface SupportAttemptSnapshot {
  /** The serialized record contains both the expected requestId and semantic signature. */
  request: string | null;
  /** Includes the draft revision, so a remount writing identical text is still a new draft. */
  draft: string | null;
}

export function captureSupportAttempt(storage: Store | undefined, key: string): SupportAttemptSnapshot | undefined {
  if (!storage) return undefined;
  try { return { request: storage.getItem(`${key}:request`), draft: storage.getItem(`${key}:draft`) }; }
  catch { return undefined; }
}

export function completeSupportAttempt(storage: Store | undefined, key: string, expected: SupportAttemptSnapshot | undefined): boolean {
  if (!storage || !expected) return false;
  try {
    // Never let an old response clear a newer attempt or even a newer unsent draft.
    // Retaining both records also keeps same-input retries tied to the accepted request.
    if (storage.getItem(`${key}:request`) !== expected.request || storage.getItem(`${key}:draft`) !== expected.draft) return false;
    storage.removeItem(`${key}:draft`);
    storage.removeItem(`${key}:request`);
    return true;
  } catch { return false; }
}

export function validateSupportCreate(draft: SupportCreateDraft): string {
  if (!draft.subject.trim() || draft.subject.trim().length > 120) return "请填写 1–120 字的问题标题。";
  if (!Object.hasOwn(supportCategories, draft.category)) return "请选择有效的问题分类。";
  return validateSupportMessage(draft.body);
}

export function validateSupportMessage(body: string): string {
  return !body.trim() || body.trim().length > 5000 ? "请填写 1–5000 字的问题说明或回复。" : "";
}

export function mergeSupportSummary(items: SupportTicketSummary[], ticket: SupportTicketSummary, status: SupportTicketStatus | "all") {
  const rest = items.filter(item => item.id !== ticket.id);
  return status !== "all" && ticket.status !== status ? rest : [ticket, ...rest];
}

export function createSupportReadGate() {
  let sequence = 0;
  return { begin: () => ++sequence, current: (token: number) => token === sequence, cancel: () => { sequence++; } };
}
