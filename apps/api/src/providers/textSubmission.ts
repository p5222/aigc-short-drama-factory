import { AsyncLocalStorage } from "node:async_hooks";

export class TextSubmissionError extends Error {
  constructor(readonly outcome: "rejected" | "unknown", message: string, options?: ErrorOptions, readonly httpStatus?: number) {
    super(message, options);
    this.name = "TextSubmissionError";
  }
}

const submissionGuard = new AsyncLocalStorage<() => Promise<void>>();

/** Commit the task's submission marker before a byte can reach a paid provider. */
export function withTextSubmissionGuard<T>(beforeSubmit: () => Promise<void>, run: () => Promise<T>) {
  return submissionGuard.run(beforeSubmit, run);
}

export async function markTextSubmissionStarted() {
  await submissionGuard.getStore()?.();
}

export function textSubmissionOutcome(error: unknown): "rejected" | "unknown" | undefined {
  for (let depth = 0; error instanceof Error && depth < 8; depth++, error = error.cause) {
    if (error instanceof TextSubmissionError) return error.outcome;
  }
  return undefined;
}

export async function requestTextJson<T>(url: string, init: RequestInit, label: string, timeoutMs = 90_000): Promise<T> {
  await markTextSubmissionStarted();
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    text = await response.text();
  } catch (cause) {
    throw new TextSubmissionError("unknown", `${label}结果尚未确认，已停止自动重发，请核对供应商记录。`, { cause });
  }
  if (!response.ok) {
    // Timeouts, conflicts and server failures can occur after execution. Only
    // explicit request rejection is safe to submit again.
    const rejected = [400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(response.status);
    throw new TextSubmissionError(rejected ? "rejected" : "unknown",
      `${label} request failed: ${response.status} ${text.slice(0, 180)}`, undefined, response.status);
  }
  try { return JSON.parse(text) as T; }
  catch (cause) {
    throw new TextSubmissionError("unknown", `${label} returned an unreadable response; result unknown, automatic resubmission stopped.`, { cause });
  }
}
