import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { CheckoutExpectation, MembershipPlan, MembershipStatus, Plan, RechargeOrder } from "@aifilm/shared";
import { api } from "../lib/api";
import { InlineNotice } from "../design-system/ui";
import { MembershipCenter } from "./MembershipCenter";
import { completeCheckoutRequest, pendingCheckoutRequests, persistCheckoutRequest, type CheckoutRequest } from "../lib/checkoutStorage";
import { HttpError } from "../lib/httpClient";

const label = (order: RechargeOrder) => ({ pending: "待支付", paid: "已到账", expired: "已过期", closed: "已关闭", refunded: "已退款" }[order.status]);
export function OnlineCheckout({ userId, plans, memberships, onRefresh }: {
  userId: string; plans: Plan[]; memberships: MembershipPlan[]; onRefresh: () => void | Promise<void>;
}) {
  const [available, setAvailable] = useState({ wechat: false, membership: false });
  const [membership, setMembership] = useState<MembershipStatus>();
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [selected, setSelected] = useState<RechargeOrder>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const request = useRef<CheckoutRequest | undefined>(undefined);
  const requestOrderId = useRef<string | undefined>(undefined);
  const loadSequence = useRef(0);
  const [savedRequests, setSavedRequests] = useState<CheckoutRequest[]>([]);
  const [storageError, setStorageError] = useState("");
  const actionLock = useRef(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const now = useRef(Date.now());
  const [clock, tick] = useState(0);
  const checkedBoundary = useRef<string | undefined>(undefined);

  async function load() {
    const sequence = ++loadSequence.current;
    setLoaded(false);
    try {
      const [availability, member, history] = await Promise.all([api.paymentAvailability(), api.membership(), api.orders()]);
      if (sequence !== loadSequence.current) return;
      setAvailable(availability); setMembership(member); setOrders(history.filter(order => order.amountFen !== undefined));
      setLoaded(true); setError("");
    } catch { if (sequence === loadSequence.current) setError("在线支付信息暂时加载失败，稍后可重试。"); }
    readSaved();
  }
  function readSaved() {
    try { setSavedRequests(pendingCheckoutRequests(userId)); setStorageError(""); }
    catch (error) { setStorageError((error as Error).message); }
  }
  function complete(order: RechargeOrder, identity = requestOrderId.current === order.id ? request.current : undefined) {
    if (order.status === "pending" || !identity || identity.planId !== order.planId || identity.kind !== order.kind) return;
    try { completeCheckoutRequest(userId, identity); request.current = undefined; readSaved(); }
    catch (error) { setStorageError((error as Error).message); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const update = () => readSaved();
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, [userId]);
  useEffect(() => {
    const timer = window.setInterval(() => { now.current = Date.now(); tick(n => n + 1); }, 10_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const boundary = membership?.active?.endsAt ?? membership?.scheduled?.[0]?.startsAt;
    if (boundary && Date.parse(boundary) <= now.current && checkedBoundary.current !== boundary) {
      checkedBoundary.current = boundary;
      void load();
    }
  }, [clock, membership]);
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
        complete(order);
        if (order.status === "paid") {
          await load();
          try { await refresh.current(); } catch { setError("支付已到账，余额面板刷新失败，请稍后刷新页面。"); }
        }
      } catch { if (!canceled) setError("订单核对暂时失败，系统会继续重试；请勿重复付款。"); }
      if (!canceled) timer = setTimeout(() => void poll(), 12_000);
    }
    timer = setTimeout(() => void poll(), 3000);
    return () => { canceled = true; clearTimeout(timer); };
  }, [selected?.id, selected?.status]);

  async function buy(planId: string, kind: "recharge" | "membership", expected: CheckoutExpectation) {
    if (actionLock.current || !loaded || storageError) return false;
    actionLock.current = true; setBusy(true); setError("");
    requestOrderId.current = undefined;
    try {
      const saved = pendingCheckoutRequests(userId).find(item => item.planId === planId && item.kind === kind);
      const pending = orders.find(order => order.planId === planId && order.kind === kind && order.status === "pending");
      let order: RechargeOrder;
      if (!saved && pending) {
        request.current = undefined;
        order = await api.resumeCheckout(pending.id);
      } else {
        request.current = saved ?? persistCheckoutRequest(userId, { planId, kind, expected });
        readSaved();
        order = await api.checkout(request.current);
        requestOrderId.current = order.id;
      }
      complete(order);
      setSelected(order);
      setOrders(items => [order, ...items.filter(item => item.id !== order.id)]);
      if (order.status === "paid") {
        await load();
        try { await refresh.current(); } catch { setError("支付已到账，余额面板刷新失败，请稍后刷新页面。"); }
      }
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "暂时无法创建订单，请稍后重试。");
      if (error instanceof HttpError && error.code === "checkout_not_created" && request.current) {
        try {
          completeCheckoutRequest(userId, request.current);
          request.current = undefined;
          readSaved();
          await refresh.current();
        } catch { setLoaded(false); }
      }
      // Recover a durable order even if the QR request timed out.
      try { setOrders((await api.orders()).filter(order => order.amountFen !== undefined)); }
      catch { setLoaded(false); }
      return false;
    } finally { setBusy(false); actionLock.current = false; }
  }
  async function resume(order: RechargeOrder) {
    request.current = undefined;
    requestOrderId.current = undefined;
    setSelected(order);
    if (order.status !== "pending" || actionLock.current) return;
    actionLock.current = true; setBusy(true); setError("");
    try {
      const updated = await api.resumeCheckout(order.id);
      setSelected(updated); setOrders(items => items.map(item => item.id === updated.id ? updated : item));
      if (updated.status === "paid") {
        await load();
        try { await refresh.current(); } catch { setError("支付已到账，余额面板刷新失败，请稍后刷新页面。"); }
      }
    }
    catch (error) { setError(error instanceof Error ? error.message : "请稍后刷新订单。"); }
    finally { actionLock.current = false; setBusy(false); }
  }
  const qrAvailable = selected?.status === "pending" && selected.codeUrl && selected.expiresAt && Date.parse(selected.expiresAt) > now.current;
  return <section className="panel online-checkout" aria-labelledby="online-payment-title">
    <div className="panel-head"><div><h2 id="online-payment-title">会员中心与在线支付</h2><small>查看创作权益，核对购买与续费订单。</small></div>
      <button className="ghost-button" type="button" disabled={busy} onClick={() => void load()}>刷新会员与订单</button></div>
    {error && <InlineNotice tone="error">{error}<button className="ghost-button" type="button" onClick={() => void load()}>刷新支付信息</button></InlineNotice>}
    {storageError && <InlineNotice tone="error">{storageError}</InlineNotice>}
    {savedRequests.length > 0 && <div aria-label="待恢复购买请求"><p>上次购买尚待核对，可恢复原请求查看结果。</p>
      {savedRequests.map(item => <button className="ghost-button" key={item.requestId} disabled={busy || !loaded || Boolean(storageError)}
        onClick={() => void buy(item.planId, item.kind, item.expected)}>恢复上次购买 · {item.expected.planName}</button>)}</div>}
    {!loaded && !error && <p role="status">正在读取支付状态…</p>}
    <MembershipCenter plans={memberships} status={membership} available={available.membership} loaded={loaded} busy={busy} blocked={Boolean(storageError)}
      orders={orders} error={error || storageError} onBuy={plan => buy(plan.id, "membership", { planName: plan.name, amountFen: Math.round(plan.monthlyPrice * 100),
        credits: plan.monthlyCredits, bonusCredits: 0, discountPercent: plan.discountPercent, priorityLevel: plan.priorityLevel })} />
    {available.wechat && <div className="online-plan-list" aria-label="微信充值套餐">
      {plans.filter(plan => plan.enabled).map(plan => <button type="button" className="ghost-button" disabled={busy || !loaded || Boolean(storageError)} key={plan.id}
        onClick={() => void buy(plan.id, "recharge", { planName: plan.name, amountFen: Math.round(plan.price * 100), credits: plan.credits,
          bonusCredits: plan.bonusCredits, discountPercent: 0, priorityLevel: 0 })}>
        {plan.name} · ¥{plan.price.toFixed(2)} · {(plan.credits + plan.bonusCredits).toLocaleString()} 积分
      </button>)}
    </div>}
    {selected && <div className="online-cashier" role="region" aria-label="当前支付订单" aria-live="polite">
      <div><h3>{selected.planName} · ¥{selected.amountCny.toFixed(2)}</h3><p>订单 {selected.id}</p><strong>{label(selected)}</strong>
        <p>本单积分：{(selected.credits + selected.bonusCredits).toLocaleString()}
          {selected.kind === "membership" && selected.membershipDiscountPercent !== undefined
            ? ` · 结算减免 ${selected.membershipDiscountPercent}% · 队列优先等级 ${selected.membershipPriorityLevel ?? 0}` : ""}。权益以本单记录为准。</p>
        {selected.status === "paid" ? <p>积分已计入账户{selected.kind === "membership" ? "，会员有效期已更新" : ""}。</p>
          : selected.status === "pending" ? <p>请核对金额后使用微信扫一扫。支付结果由微信确认，请勿重复支付。</p>
          : <p>此订单已结束，不能继续付款。订单或权益有疑问时可联系支持核对。</p>}
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
