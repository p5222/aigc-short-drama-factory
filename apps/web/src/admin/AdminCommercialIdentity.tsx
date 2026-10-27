import type { AdminUserRow } from "@aifilm/shared";
import "./commercial-identity.css";
export const membershipLabels = { active: "有效会员", scheduled: "待生效会员", expired: "会员已到期", none: "普通创作者" };
export function AdminCommercialIdentity({ user, detail = false }: { user: AdminUserRow; detail?: boolean }) {
  const item = user.commercial;
  if (!item) return <span>商业身份暂未读取</span>;
  return <div className="adm-commercial-identity" role={detail ? "group" : undefined} aria-label={detail ? "商业身份与付费记录" : undefined}>
    <strong>{membershipLabels[item.membership]}{item.planName ? ` · ${item.planName}` : ""}</strong>
    <small>{item.onlinePaidOrders > 0 ? `在线付费 · ${item.onlinePaidOrders} 笔` : "暂无在线付费记录"}</small>
    {detail && <>
      {item.currentEndsAt && <small>本期权益截止：{new Date(item.currentEndsAt).toLocaleString("zh-CN")}</small>}
      {item.paidThrough && <small>已购会员到期：{new Date(item.paidThrough).toLocaleString("zh-CN")}</small>}
      <small>在线已付订单金额：¥{item.onlinePaidCny.toFixed(2)}；不含卡密、赠送和管理员调整。</small>
      <small>会员身份不授予后台权限；账号停用和删除不改变原有资金与购买记录。</small>
    </>}
  </div>;
}
