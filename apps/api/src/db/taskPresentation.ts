import { creationExecution } from "../queue/creationState.js";

/** A live submitted attempt is still running; only an unresolved result needs attention. */
export function taskReviewRequired(task: { status: string; execution?: unknown; errorReason?: string | null }) {
  if (!["pending", "running", "failed"].includes(task.status)) return false;
  const state = creationExecution(task.execution);
  if (state.reviewRequired || state.attempts.at(-1)?.state === "unknown") return true;
  try {
    const data = JSON.parse(task.errorReason ?? "{}");
    return data?.kind === "media_checkpoint" && data.metadata?.needsReconciliation === true;
  } catch { return false; }
}

export function contentTaskIdentity(jobId?: string | null) {
  const match = /^content:([a-z0-9_-]{1,200}):(operation|billing):([a-z0-9_-]{1,200})(?::([a-z0-9_-]{1,200}))?$/i.exec(jobId ?? "");
  if (!match || (match[2] === "billing") !== Boolean(match[4])) return undefined;
  return { contentId: match[1], parentId: match[3] };
}
