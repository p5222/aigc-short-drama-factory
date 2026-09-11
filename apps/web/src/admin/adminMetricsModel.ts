export function formatAdminMoney(value: number | null | undefined, unavailable = "待对账") {
  return typeof value === "number" && Number.isFinite(value) ? `¥${value.toFixed(2)}` : unavailable;
}

export function formatAdminTaskSuccess(rate: number | undefined, completedTasks: number | undefined) {
  if (completedTasks === 0) return "暂无已结束任务";
  if (completedTasks === undefined || typeof rate !== "number" || !Number.isFinite(rate)) return "未读取";
  return `${rate}%`;
}
