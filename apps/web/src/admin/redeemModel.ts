import { redeemCodeStatus, type RedeemCode } from "@aifilm/shared";

export const redeemStatusLabels = { active: "可兑换", disabled: "已停用", used_up: "已用完", expired: "已过期", scheduled: "未开始" };
export const redeemLiability = (codes: RedeemCode[]) => codes.reduce((sum, code) =>
  sum + (["active", "scheduled"].includes(redeemCodeStatus(code)) ? Math.max(0, code.maxRedemptions - code.usedCount) * code.credits : 0), 0);

export function redeemCsv(codes: RedeemCode[]) {
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    const safe = /^[\s]*[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "\ufeff" + [
    ["兑换码", "活动名称", "批次", "每次积分", "已用次数", "总次数", "状态", "开始时间", "结束时间"],
    ...codes.map(code => [code.code, code.name, code.batchId ?? "历史单码", code.credits, code.usedCount, code.maxRedemptions,
      redeemStatusLabels[redeemCodeStatus(code)], code.startsAt ?? "立即", code.endsAt ?? "长期有效"])
  ].map(row => row.map(cell).join(",")).join("\r\n");
}

export function downloadRedeemCodes(codes: RedeemCode[]) {
  const url = URL.createObjectURL(new Blob([redeemCsv(codes)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = `兑换码-${codes.length}份.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** datetime-local values use the browser's local timezone, with minute-level precision. */
export function redeemDateInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export const redeemDateIso = (value: string) => value ? new Date(value).toISOString() : null;
