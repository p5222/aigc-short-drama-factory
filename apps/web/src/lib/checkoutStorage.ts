import type { CheckoutExpectation } from "@aifilm/shared";

export interface CheckoutRequest {
  planId: string;
  kind: "recharge" | "membership";
  requestId: string;
  expected: CheckoutExpectation;
}
const prefix = (userId: string) => `manjiao:checkout:v1:${encodeURIComponent(userId)}:`;
const key = (userId: string, input: Pick<CheckoutRequest, "kind" | "planId">) => `${prefix(userId)}${input.kind}:${encodeURIComponent(input.planId)}`;
const unavailable = () => new Error("浏览器无法保存购买请求，已暂停新购买。请允许本站存储后刷新；已有订单仍可在下方核对。");
function decode(raw: string): CheckoutRequest {
  const value = JSON.parse(raw) as CheckoutRequest;
  if (!value || !["recharge", "membership"].includes(value.kind) || typeof value.planId !== "string" ||
      typeof value.requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.requestId) ||
      !value.expected || typeof value.expected.planName !== "string" ||
      !["amountFen", "credits", "bonusCredits", "discountPercent", "priorityLevel"].every(name =>
        Number.isSafeInteger(value.expected[name as keyof CheckoutExpectation]))) throw unavailable();
  return value;
}
export function pendingCheckoutRequests(userId: string, storage?: Storage): CheckoutRequest[] {
  if (!userId) throw unavailable();
  try {
    storage ??= localStorage;
    const probe = prefix(userId) + "probe";
    storage.setItem(probe, "1");
    if (storage.getItem(probe) !== "1") throw unavailable();
    storage.removeItem(probe);
    const items: CheckoutRequest[] = [];
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name?.startsWith(prefix(userId))) items.push(decode(storage.getItem(name)!));
    }
    return items;
  } catch { throw unavailable(); }
}
/** Save before sending. Concurrent tabs may use different identities; the server
 * persistently aliases both to one order. Never replace an unresolved identity. */
export function persistCheckoutRequest(userId: string, input: Omit<CheckoutRequest, "requestId">, storage?: Storage): CheckoutRequest {
  try {
    storage ??= localStorage;
    if (!userId) throw unavailable();
    const name = key(userId, input), raw = storage.getItem(name);
    if (raw) {
      const existing = decode(raw);
      if (existing.kind !== input.kind || existing.planId !== input.planId) throw unavailable();
      return existing;
    }
    const next = { ...input, requestId: crypto.randomUUID() };
    const encoded = JSON.stringify(next);
    storage.setItem(name, encoded);
    if (storage.getItem(name) !== encoded) throw unavailable();
    return next;
  } catch { throw unavailable(); }
}
export function completeCheckoutRequest(userId: string, input: CheckoutRequest, storage?: Storage) {
  try {
    storage ??= localStorage;
    const name = key(userId, input), raw = storage.getItem(name);
    if (raw && decode(raw).requestId === input.requestId) storage.removeItem(name);
  } catch { throw unavailable(); }
}
