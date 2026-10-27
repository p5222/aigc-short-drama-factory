export type AdminActionResult = void | boolean | Promise<void | boolean>;

export interface AdminActionNotice {
  pending: boolean;
  message: string;
  error: string;
}

/** The guard is synchronous so a second click cannot spend or create twice before React renders. */
export function createAdminActionRunner(notify: (state: AdminActionNotice) => void) {
  let pending = false;
  return async (action: () => Promise<unknown>, success: string, refresh?: () => unknown): Promise<boolean> => {
    if (pending) return false;
    pending = true;
    notify({ pending: true, message: "正在提交，请稍候…", error: "" });
    try {
      await action();
    } catch (reason) {
      pending = false;
      notify({ pending: false, message: "", error: reason instanceof Error ? reason.message : "操作失败，请重试。" });
      return false;
    }
    let refreshError = "";
    try {
      await refresh?.();
    } catch (reason) {
      refreshError = `操作已成功，但列表刷新失败，请刷新查看，勿重复提交。${reason instanceof Error ? ` ${reason.message}` : ""}`;
    }
    pending = false;
    notify({ pending: false, message: success, error: refreshError });
    return true;
  };
}

export async function closeAfterAdminSuccess(action: () => AdminActionResult, close: () => void) {
  const result = await action();
  if (result !== false) close();
  return result;
}

export async function runAdminBatch<T>(items: T[], action: (item: T) => AdminActionResult) {
  const completed: T[] = [];
  for (const item of items) {
    if (await action(item) === false) break;
    completed.push(item);
  }
  return completed;
}

export function isValidCreditAdjustment(amount: string, description: string) {
  const value = Number(amount);
  return amount.trim() !== "" && Number.isSafeInteger(value) && value !== 0 && description.trim().length > 0;
}

export function isValidModelPriceDraft(unitCredits: string, vendorCostCny: string) {
  return unitCredits.trim() !== "" && Number.isSafeInteger(Number(unitCredits)) && Number(unitCredits) >= 0
    && vendorCostCny.trim() !== "" && Number.isFinite(Number(vendorCostCny)) && Number(vendorCostCny) >= 0;
}

export function readAdminHash(hash: string) {
  try { return decodeURIComponent(hash.replace(/^#/, "")); } catch { return ""; }
}

export function createCreditAdjustmentAttempt(newId: () => string = () => crypto.randomUUID()) {
  let current: { fingerprint: string; requestId: string } | undefined;
  return {
    getRequestId(input: { userId: string; amount: number; description: string }) {
      const fingerprint = JSON.stringify([input.userId, input.amount, input.description]);
      if (current?.fingerprint !== fingerprint) current = { fingerprint, requestId: newId() };
      return current.requestId;
    },
    complete() { current = undefined; }
  };
}
