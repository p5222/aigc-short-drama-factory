import { useState } from "react";
import type { MembershipPlan, MembershipStatus, RechargeOrder } from "@aifilm/shared";
import { Dialog, InlineNotice } from "../design-system/ui";

const date = (value: string) => new Date(value).toLocaleString("zh-CN");
const queue = (level: number) => level > 0 ? `创作队列优先等级 ${level}` : "标准创作队列";
export function MembershipCenter({ plans, status, available, loaded, busy, orders, error, onBuy }: {
  plans: MembershipPlan[]; status?: MembershipStatus; available: boolean; loaded: boolean;
  busy: boolean; orders: RechargeOrder[]; error: string; onBuy: (planId: string) => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState<MembershipPlan>();
  const enabled = plans.filter(plan => plan.enabled);
  const pending = orders.find(order => order.kind === "membership" && order.status === "pending");
  const lockedPlan = status?.active?.planId ?? status?.scheduled?.[0]?.planId ?? pending?.planId;
  const stateLabel = !loaded ? "会员状态读取中" : status?.active ? "会员权益生效中"
    : status?.scheduled?.length ? "已有待生效会员" : status?.lastExpired ? "会员已到期" : "普通创作者";
  async function purchase() {
    if (confirm && await onBuy(confirm.id)) setConfirm(undefined);
  }
  return <div className="membership-center">
    <div className="membership-intro"><div><span className="membership-eyebrow">创作权益</span><h3>选择适合创作节奏的会员</h3><p>按需补充积分，按月购买权益，手动续费。</p></div><span className="membership-state">{stateLabel}</span></div>
    {loaded && <div className="membership-current" aria-label="我的会员权益">
      {status?.active ? <>
        <strong>{status.active.planName}</strong>
        <dl><div><dt>本期权益截止</dt><dd>{date(status.active.endsAt)}</dd></div>
          <div><dt>已购会员到期</dt><dd>{date(status.paidThrough ?? status.active.endsAt)}</dd></div>
          <div><dt>本期结算权益</dt><dd>符合计价规则的任务减免 {status.active.discountPercent}%</dd></div>
          <div><dt>本期队列权益</dt><dd>{queue(status.active.priorityLevel)}</dd></div></dl>
        <p>本期权益以已付订单为准；模型计价规则可能限制减免，实际扣分以生成前报价为准。</p>
      </> : status?.lastExpired ? <>
        <strong>{status.lastExpired.planName}已到期</strong><p>上期于 {date(status.lastExpired.endsAt)} 结束。账户积分仍永久有效，当前没有生效中的会员折扣和队列权益。</p>
      </> : status?.scheduled?.length ? <p>会员将在已购权益期开始时生效；本次购买的积分已随支付入账。</p>
        : <p>普通创作者可使用已开放的创作功能，按实际报价消耗积分；会员用于补充月度权益。</p>}
      {(status?.scheduled?.length ?? 0) > 0 && <details className="membership-scheduled">
        <summary>已购待生效权益 · {status?.scheduledCount ?? status?.scheduled?.length} 期</summary>
        {status!.scheduled!.map(term => <div key={`${term.planId}:${term.startsAt}`}><strong>{term.planName}</strong><span>{date(term.startsAt)} 至 {date(term.endsAt)}</span><small>结算减免 {term.discountPercent}% · {queue(term.priorityLevel)}，以届时报价为准</small></div>)}
        {(status?.scheduledCount ?? 0) > status!.scheduled!.length && <p>此处展示最近 12 期；已购到期为 {date(status!.paidThrough!)}。</p>}
      </details>}
    </div>}
    {loaded && !available && <InlineNotice>会员购买暂未开放。套餐和已购权益可在此查看，购买开放后可手动续费。</InlineNotice>}
    {loaded && pending && <InlineNotice>有一笔会员订单待确认，请先在下方订单中核对。二维码过期后仍需确认支付结果，当前仅支持同档购买。</InlineNotice>}
    <div className="plan-grid recharge-plan-grid membership-plan-grid" aria-label="会员套餐比较">
      {enabled.map(plan => <article className="plan-card recharge-card membership-card" key={plan.id} data-current={status?.active?.planId === plan.id || undefined}>
        <div className="membership-card-head"><span className="recharge-card-name">{plan.name}</span>{status?.active?.planId === plan.id && <small>当前档位</small>}</div>
        <div className="recharge-card-price"><em>¥</em><strong>{plan.monthlyPrice.toFixed(2)}</strong><small>/ 自然月</small></div>
        <ul><li>支付后立即获得 <strong>{plan.monthlyCredits.toLocaleString()}</strong> 积分</li><li>积分永久有效，会员到期仍可使用</li>
          <li>符合计价规则的任务结算减免 {plan.discountPercent}%</li><li>{queue(plan.priorityLevel)}</li><li>手动续费，不自动扣款</li></ul>
        <button type="button" className="primary-button" disabled={busy || !loaded || !available || Boolean(lockedPlan && lockedPlan !== plan.id)}
          onClick={() => setConfirm(plan)}>{!loaded ? "正在读取…" : !available ? "暂未开放购买" : status?.active?.planId === plan.id ? "同档续费一个月" : "购买一个月"}</button>
        {lockedPlan && lockedPlan !== plan.id && <small>当前仅支持同档续费，跨档购买暂未开放</small>}
      </article>)}
    </div>
    {!enabled.length && loaded && <p>暂无开放的会员套餐。已购权益按原订单期限继续生效。</p>}
    {status?.active && !enabled.some(plan => plan.id === status.active!.planId) && <p>当前档位暂停售卖，原订单权益仍在本期内有效。</p>}
    <details className="creator-price-details membership-rules"><summary>会员购买与计费规则</summary>
      <p>每次购买一个自然月，不自动扣款。同档续费从已购有效期末顺延，积分在本次支付后立即发放且永久有效。自然月按 UTC 计算，月末不足同一天时取月末。</p>
      <p>生成前按报价冻结积分，按任务开始时的权益与计价规则结算，向上取整到整数积分并释放应退差额。按成本计价的模型可能限制会员减免，以生成前展示的实际报价为准。</p>
      <p>优先级适用于平台创作任务队列；上游模型处理速度取决于供应商。当前采用手动续费，跨档购买暂未开放。</p>
    </details>
    <Dialog open={Boolean(confirm)} title="确认会员购买" onClose={() => setConfirm(undefined)} busy={busy}
      footer={<><button type="button" className="ghost-button" disabled={busy} onClick={() => setConfirm(undefined)}>取消</button>
        <button type="button" className="primary-button" disabled={busy || !available} onClick={() => void purchase()}>{busy ? "正在创建订单…" : "确认并获取付款码"}</button></>}>
      {confirm && <div className="membership-confirm"><h3>{confirm.name} · ¥{confirm.monthlyPrice.toFixed(2)}</h3>
        <p>本次支付后立即发放 {confirm.monthlyCredits.toLocaleString()} 积分，永久有效。</p>
        <p>{lockedPlan === confirm.id && status?.paidThrough && Date.parse(status.paidThrough) > Date.now()
          ? `从已购到期 ${date(status.paidThrough)} 起顺延一个自然月，未来权益按本次订单生效。` : "支付确认后开始一个自然月的会员权益。"}</p>
        <p>本次权益：符合计价规则的任务结算减免 {confirm.discountPercent}% · {queue(confirm.priorityLevel)}。实际扣分以生成前报价为准。</p>
        <p>手动续费，不自动扣款。付款前请核对订单最终金额；套餐调整时，以下单后的订单为准。</p>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
      </div>}
    </Dialog>
  </div>;
}
