import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { MembershipPlan, MembershipStatus, Plan, RechargeOrder } from "@aifilm/shared";
import { api } from "../lib/api";
import { InlineNotice } from "../design-system/ui";

const label = (order: RechargeOrder) => ({ pending: "待支付", paid: "已到账", expired: "已过期", closed: "已关闭", refunded: "已退款" }[order.status]);
export function OnlineCheckout({ plans, memberships, onRefresh }: {
  plans: Plan[]; memberships: MembershipPlan[]; onRefresh: () => void | Promise<void>;
}) {
  const [available, setAvailable] = useState({ wechat: false, membership: false });
  const [membership, setMembership] = useState<MembershipStatus>();
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [selected, setSelected] = useState<RechargeOrder>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const request = useRef<{ key: string; id: string } | undefined>(undefined);
  const actionLock = useRef(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const now = useRef(Date.now());
  const [, tick] = useState(0);

  async function load() {
    try {
      const [availability, member, history] = await Promise.all([api.paymentAvailability(), api.membership(), api.orders()]);
      setAvailable(availability); setMembership(member); setOrders(history.filter(order => order.amountFen !== undefined));
      setLoaded(true); setError("");
    } catch { setError("在线支付信息暂时加载失败，稍后可重试。"); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { now.current = Date.now(); tick(n => n + 1); }, 10_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!selected || selected.status !== "pending") return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const order = await api.paymentOrder(selected!.id);
        if (canceled) return;
        setSelected(order);
        setOrders(items => items.map(item => item.id === order.id ? order : item));
        if (order.status !== "pending") request.current = undefined;
        if (order.status === "paid") {
          request.current = undefined;
          await load();
          try { await refresh.current(); } catch { setError("支付已到账，余额面板刷新失败，请稍后刷新页面。"); }
        }
      } catch { if (!canceled) setError("订单核对暂时失败，系统会继续重试；请勿重复付款。"); }
      if (!canceled) timer = setTimeout(() => void poll(), 12_000);
    }
    timer = setTimeout(() => void poll(), 3000);
    return () => { canceled = true; clearTimeout(timer); };
  }, [selected?.id, selected?.status]);

  async function buy(planId: string, kind: "recharge" | "membership") {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError("");
    const key = `${kind}:${planId}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try {
      const pending = orders.find(order => order.planId === planId && order.kind === kind && order.status === "pending" &&
        order.expiresAt && Date.parse(order.expiresAt) > Date.now());
      const order = pending ? await api.resumeCheckout(pending.id) : await api.checkout({ planId, kind, requestId: request.current.id });
      if (order.status !== "pending") request.current = undefined;
      setSelected(order);
      setOrders(items => [order, ...items.filter(item => item.id !== order.id)]);
    } catch (error) {
      setError(error instanceof Error ? error.message : "暂时无法创建订单，请稍后重试。");
      // Recover a durable order even if the QR request timed out.
      try { setOrders((await api.orders()).filter(order => order.amountFen !== undefined)); } catch { /* Keep current state. */ }
    } finally { setBusy(false); actionLock.current = false; }
  }
  async function resume(order: RechargeOrder) {
    setSelected(order);
    if (order.status !== "pending" || actionLock.current) return;
    actionLock.current = true; setBusy(true); setError("");
    try { setSelected(await api.resumeCheckout(order.id)); }
    catch (error) { setError(error instanceof Error ? error.message : "请稍后刷新订单。"); }
    finally { actionLock.current = false; setBusy(false); }
  }
  const qrAvailable = selected?.status === "pending" && selected.codeUrl && selected.expiresAt && Date.parse(selected.expiresAt) > now.current;
  if (loaded && !available.wechat && !orders.length && !membership?.active) return null;
  return <section className="panel online-checkout" aria-labelledby="online-payment-title">
    <div className="panel-head"><div><h2 id="online-payment-title">微信支付与月度会员</h2><small>扫码支付成功后自动入账，可在本页核对订单。</small></div></div>
    {error && <InlineNotice tone="error">{error}<button className="ghost-button" type="button" onClick={() => void load()}>刷新支付信息</button></InlineNotice>}
    {!loaded && !error && <p role="status">正在读取支付状态…</p>}
    {membership?.active && <InlineNotice tone="success">
      当前为{membership.active.planName}，有效期至 {new Date(membership.paidThrough!).toLocaleString("zh-CN")}。
      本期任务结算减免 {membership.active.discountPercent}%，创作队列等级 {membership.active.priorityLevel}。
    </InlineNotice>}
    {available.wechat && <div className="online-plan-list" aria-label="微信充值套餐">
      {plans.filter(plan => plan.enabled).map(plan => <button type="button" className="ghost-button" disabled={busy} key={plan.id} onClick={() => void buy(plan.id, "recharge")}>
        {plan.name} · ¥{plan.price.toFixed(2)} · {(plan.credits + plan.bonusCredits).toLocaleString()} 积分
      </button>)}
    </div>}
    {available.membership && <>
      <div className="plan-grid recharge-plan-grid">{memberships.filter(plan => plan.enabled).map(plan => <article className="plan-card recharge-card" key={plan.id}>
        <span className="recharge-card-name">{plan.name}</span>
        <div className="recharge-card-price"><em>¥</em><strong>{plan.monthlyPrice.toFixed(2)}</strong><small>/ 月</small></div>
        <p>购买后立即发放 {plan.monthlyCredits.toLocaleString()} 积分</p>
        <p>生成任务结算减免 {plan.discountPercent}% · 创作队列等级 {plan.priorityLevel}</p>
        <button className="primary-button" disabled={busy || Boolean(membership?.active && membership.active.planId !== plan.id)}
          onClick={() => void buy(plan.id, "membership")}>{busy ? "正在处理…" : membership?.active?.planId === plan.id ? "同档续费一个月" : "购买一个月"}</button>
      </article>)}</div>
      <p className="online-payment-note">每次购买一个自然月，不自动扣款。同档续费从已购有效期末顺延，积分在本次支付后立即发放且永久有效。生成前按原价上限冻结，完成后按开始时的会员折扣结算并释放差额，向上取整到整数积分。优先级适用于平台创作任务队列；上游模型处理速度取决于供应商。</p>
    </>}
    {selected && <div className="online-cashier" role="region" aria-label="当前支付订单" aria-live="polite">
      <div><h3>{selected.planName} · ¥{selected.amountCny.toFixed(2)}</h3><p>订单 {selected.id}</p><strong>{label(selected)}</strong>
        {selected.status === "paid" ? <p>积分已计入账户{selected.kind === "membership" ? "，会员有效期已更新" : ""}。</p> : <p>请核对金额后使用微信扫一扫。支付结果由微信确认，请勿重复支付。</p>}
        {selected.reconcileError && <p>{selected.reconcileError}</p>}
        {selected.expiresAt && selected.status === "pending" && <p>二维码支付截止：{new Date(selected.expiresAt).toLocaleString("zh-CN")}</p>}
        {!qrAvailable && selected.status === "pending" && <p>当前二维码不可用，可刷新订单核对支付状态。</p>}
        <button className="ghost-button" disabled={busy} onClick={() => void resume(selected)}>刷新订单</button>
      </div>
      {qrAvailable && <div className="online-qr"><QRCodeSVG value={selected.codeUrl!} size={208} marginSize={4} title={`微信支付 ${selected.amountCny.toFixed(2)} 元`} /><span>微信扫一扫</span></div>}
    </div>}
    {orders.length > 0 && <details className="creator-price-details" open><summary>在线订单 · {orders.length} 笔</summary>
      <div className="online-order-list">{orders.slice(0, 50).map(order => <button className="ghost-button" type="button" disabled={busy} key={order.id} onClick={() => void resume(order)}>
        <span>{order.planName}</span><span>¥{order.amountCny.toFixed(2)}</span><span>{label(order)}</span><small>{new Date(order.createdAt).toLocaleString("zh-CN")}</small>
      </button>)}</div>
    </details>}
  </section>;
}
