export const CREATION_ATTEMPT_KEY = "manjiao_creation_attempt";
type AttemptStorage = Pick<Storage, "getItem" | "setItem">;

export function creationRequestSignature(input: Record<string, unknown>) {
  return JSON.stringify(Object.fromEntries(Object.entries(input).filter(([key]) => !["requestId", "maxCredits"].includes(key)).sort(([a], [b]) => a.localeCompare(b))));
}

export function getCreationRequestId(storage: AttemptStorage, input: Record<string, unknown>, createId: () => string): string {
  const signature = creationRequestSignature(input);
  let previous: { requestId?: string; signature?: string } | undefined;
  try { previous = JSON.parse(storage.getItem(CREATION_ATTEMPT_KEY) ?? "null") ?? undefined; } catch { /* Replace invalid old metadata before sending. */ }
  if (previous?.signature === signature && typeof previous.requestId === "string" && previous.requestId) return previous.requestId;
  const requestId = createId();
  storage.setItem(CREATION_ATTEMPT_KEY, JSON.stringify({ requestId, signature }));
  return requestId;
}
