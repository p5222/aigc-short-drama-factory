import type { GenerationTask } from "@aifilm/shared";

export type TaskAction = "retry" | "cancel" | "refresh";
export type PendingTaskActions = Record<string, TaskAction>;
export type TaskActionResult = { status: "ignored" | "succeeded" } | { status: "failed"; message: string };

export function canRetryTask(task: GenerationTask): boolean {
  return ["failed", "canceled", "refunded"].includes(task.status) && task.retryable !== false;
}

export function canCancelTask(task: GenerationTask): boolean {
  return ["pending", "running"].includes(task.status) && task.cancelable !== false;
}

/** One in-flight mutation per task, including clicks made before React renders. */
export function createTaskActionRunner() {
  const pending = new Map<string, TaskAction>();
  return {
    async run(
      taskId: string,
      action: TaskAction,
      execute: () => void | Promise<void>,
      onPendingChange: (value: PendingTaskActions) => void
    ): Promise<TaskActionResult> {
      if (pending.has(taskId)) return { status: "ignored" };
      pending.set(taskId, action);
      onPendingChange(Object.fromEntries(pending));
      try {
        await execute();
        return { status: "succeeded" };
      } catch (error) {
        return { status: "failed", message: error instanceof Error ? error.message : "操作失败，请稍后重试。" };
      } finally {
        pending.delete(taskId);
        onPendingChange(Object.fromEntries(pending));
      }
    }
  };
}
