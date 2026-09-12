export function formatAdminMoney(value: number | null | undefined, unavailable = "待对账") {
  return typeof value === "number" && Number.isFinite(value) ? `¥${value.toFixed(2)}` : unavailable;
}

export function formatAdminTaskSuccess(rate: number | undefined, completedTasks: number | undefined) {
  if (completedTasks === 0) return "暂无已结束任务";
  if (completedTasks === undefined || typeof rate !== "number" || !Number.isFinite(rate)) return "未读取";
  return `${rate}%`;
}

export function qualityMetricAvailability(snapshot?: {
  summary: { successRate: number; failureRate: number; p95LatencyMs: number };
  lab: { recentReports: unknown[] };
  modelMonitoring: unknown[];
}) {
  return {
    // The API returns both rates as zero when there are no terminal tasks.
    // For a non-empty denominator their rounded, complementary rates sum to 100.
    completedTasks: !!snapshot && snapshot.summary.successRate + snapshot.summary.failureRate > 0,
    reports: !!snapshot?.lab.recentReports.length,
    models: !!snapshot?.modelMonitoring.length,
    latency: !!snapshot && snapshot.summary.p95LatencyMs > 0
  };
}
