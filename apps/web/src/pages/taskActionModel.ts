import type { GenerationTask } from "@aifilm/shared";

export type TaskAction = "retry" | "cancel" | "refresh";
export type PendingTaskActions = Record<string, TaskAction>;
export type TaskActionResult = { status: "ignored" | "succeeded" } | { status: "failed" | "sync-required"; message: string };

export function canRetryTask(task: GenerationTask): boolean {
  return ["failed", "canceled", "refunded"].includes(task.status) && task.retryable !== false;
}

export function canCancelTask(task: GenerationTask): boolean {
  return ["pending", "running"].includes(task.status) && task.cancelable !== false;
}

export function taskRecoveryHint(task: GenerationTask): string {
  if (["pending", "running"].includes(task.status)) return "任务仍在后台处理。请先刷新核对结果，避免重复提交同一生成请求。";
  if (task.status === "succeeded") return "回到所属作品查看结果，继续下一阶段。";
  if (canRetryTask(task)) return "核对失败原因、渠道和积分后，可以重试此任务。";
  return "此任务不能从队列直接重试。请回到所属作品核对结果与渠道；结果不明时先刷新，或保留平台任务编号提交工单。";
}

/** Explicit allowlist: never copy request payloads, prompts, provider errors or internal job identifiers. */
export function taskSupportDiagnostic(task: GenerationTask): string {
  return [
    `平台任务编号：${task.id}`,
    `任务类型：${task.type}`,
    `状态：${task.status}`,
    `渠道 / 模型：${task.provider || "未记录"} / ${task.model || "未记录"}`,
    `预估冻结：${task.estimatedCredits} 积分`,
    `实际扣费：${task.finalCredits ?? "未结算"}`,
    `创建时间：${task.createdAt}`,
    `更新时间：${task.updatedAt}`,
    `可直接重试：${canRetryTask(task) ? "是" : "否"}`,
    "请在工单中补充操作步骤和看到的问题。"
  ].join("\n");
}

/** One in-flight mutation per task, including clicks made before React renders. */
export function createTaskActionRunner() {
  const pending = new Map<string, TaskAction>();
  const awaitingSync = new Set<string>();
  async function run(
    taskId: string,
    action: TaskAction,
    execute: () => void | Promise<void>,
    onPendingChange: (value: PendingTaskActions) => void
  ): Promise<TaskActionResult> {
    if (pending.has(taskId) || (action === "refresh" && pending.size > 0)) return { status: "ignored" };
    pending.set(taskId, action);
    onPendingChange(Object.fromEntries(pending));
    try {
      await execute();
      if (action === "refresh") awaitingSync.clear();
      return { status: "succeeded" };
    } catch (error) {
      return { status: "failed", message: error instanceof Error ? error.message : "操作失败，请稍后重试。" };
    } finally {
      pending.delete(taskId);
      onPendingChange(Object.fromEntries(pending));
    }
  }
  return {
    run,
    isAwaitingSync: (taskId: string) => awaitingSync.has(taskId),
    async mutate(
      taskId: string,
      action: Exclude<TaskAction, "refresh">,
      execute: () => void | Promise<void>,
      refresh: () => void | Promise<void>,
      onPendingChange: (value: PendingTaskActions) => void
    ): Promise<TaskActionResult> {
      if (awaitingSync.has(taskId) || pending.has("__refresh__")) return { status: "ignored" };
      let refreshError = "";
      const result = await run(taskId, action, async () => {
        await execute();
        awaitingSync.add(taskId);
        try {
          await refresh();
          awaitingSync.delete(taskId);
        } catch (error) {
          refreshError = `操作已受理，但最新状态读取失败。请刷新核对，当前任务不会重复提交。${error instanceof Error ? ` ${error.message}` : ""}`;
        }
      }, onPendingChange);
      return result.status === "succeeded" && refreshError
        ? { status: "sync-required", message: refreshError }
        : result;
    }
  };
}
