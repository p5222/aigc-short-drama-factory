export type CreationAttempt = {
  id: string;
  state: "prepared" | "submitted" | "rejected" | "not_submitted" | "unknown" | "delivered";
  startedAt: string;
  submittedAt?: string;
  finishedAt?: string;
};
export type CreationExecution = { version: 1; attempts: CreationAttempt[]; reviewRequired: boolean };

export const CREATION_REVIEW_MESSAGE = "生成请求可能已送达供应商，结果尚未确认。已停止重复提交，请通过工单联系管理员核对；未交付积分仍冻结，核对结束后释放。";

export function creationExecution(value: unknown): CreationExecution {
  if (value && typeof value === "object" && (value as CreationExecution).version === 1 && Array.isArray((value as CreationExecution).attempts)) {
    return structuredClone(value as CreationExecution);
  }
  return { version: 1, attempts: [], reviewRequired: false };
}

export function creationNeedsReview(task: { execution?: unknown; jobId?: string | null; status: string }) {
  const state = creationExecution(task.execution);
  return state.reviewRequired || ["submitted", "unknown"].includes(state.attempts.at(-1)?.state ?? "");
}

/** Legacy failures lack proof that no billable request was sent. */
export function creationCanRetry(task: { execution?: unknown; jobId?: string | null; status: string }) {
  if (creationNeedsReview(task)) return false;
  if (!task.jobId?.startsWith("creation-")) return true;
  if ((task.execution as CreationExecution | undefined)?.version === 1 && !creationExecution(task.execution).attempts.length) return true;
  return ["not_submitted", "rejected"].includes(creationExecution(task.execution).attempts.at(-1)?.state ?? "");
}
