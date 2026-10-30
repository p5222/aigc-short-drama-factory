import { redeemCodeStatus, type RedeemCode, type RedeemHistoryPage } from "@aifilm/shared";

export const redeemStatusLabels = { active: "可兑换", disabled: "已停用", used_up: "已用完", expired: "已过期", scheduled: "未开始" };
export const redeemNumber = (value: number) => value.toLocaleString("zh-CN");
export const redeemTime = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });
export const redeemError = (reason: unknown) => reason instanceof Error ? reason.message : "读取失败，请重试。";
export const redeemLiability = (codes: RedeemCode[]) => codes.reduce((sum, code) =>
  sum + (["active", "scheduled"].includes(redeemCodeStatus(code)) ? Math.max(0, code.maxRedemptions - code.usedCount) * code.credits : 0), 0);

function cell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[\s]*[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function redeemCsv(codes: RedeemCode[], scope = "当前筛选", exportedAt = new Date().toISOString()) {
  return "\ufeff" + [
    ["兑换码", "活动名称", "批次", "每次积分", "已用次数", "总次数", "状态", "开始时间", "结束时间", "导出范围", "导出数量", "导出时间"],
    ...codes.map(code => [code.code, code.name, code.batchId ?? "历史单码", code.credits, code.usedCount, code.maxRedemptions,
      redeemStatusLabels[code.status ?? redeemCodeStatus(code)], code.startsAt ?? "立即", code.endsAt ?? "长期有效", scope, codes.length, exportedAt])
  ].map(row => row.map(cell).join(",")).join("\r\n");
}

function downloadCsv(csv: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = fileName; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadRedeemCodes(codes: RedeemCode[], scope = "当前筛选", exportedAt = new Date().toISOString()) {
  downloadCsv(redeemCsv(codes, scope, exportedAt), `兑换码-${scope.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 40)}-${codes.length}份-${exportedAt.slice(0, 19).replace(/[:T]/g, "-")}.csv`);
}

export function downloadRedeemHistory(data: RedeemHistoryPage) {
  const rows = [["活动", "码尾号", "用户", "用户编号", "到账积分", "到账时间", "记录编号"],
    ...data.items.map(row => [row.name, row.maskedCode, row.user?.name ?? "", row.user?.id ?? "", row.credits, row.createdAt, row.id])];
  downloadCsv("\ufeff" + rows.map(row => row.map(cell).join(",")).join("\r\n"), `兑换记录-第${data.page}页-${data.items.length}条-${new Date().toISOString().slice(0, 10)}.csv`);
}

/** datetime-local values use the browser's local timezone, with minute-level precision. */
export function redeemDateInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export const redeemDateIso = (value: string) => value ? new Date(value).toISOString() : null;
