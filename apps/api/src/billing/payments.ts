import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.js";
import { mapRechargeOrder } from "../db/mappers.js";
import { handleRechargeCallback } from "../db/repository.js";
import { lockCreditAccount } from "./accountCredits.js";
import { activeMembership } from "./membership.js";
import { moneyFen, PaymentError, WechatPay, wechatConfig, type WechatTransaction } from "./wechat.js";

export function paymentAvailability() {
  try { return { wechat: Boolean(wechatConfig()), membership: Boolean(wechatConfig()), autoRenew: false as const }; }
  catch { return { wechat: false, membership: false, autoRenew: false as const }; }
}
function gateway() {
  const config = wechatConfig();
  if (!config) throw new PaymentError(503, "微信支付暂未开放，请使用店铺卡密或稍后重试。");
  return new WechatPay(config);
}
export async function getMembership(userId: string, db: PrismaClient = prisma) {
  const [active, total] = await Promise.all([activeMembership(db, userId), db.userMembership.findUnique({ where: { userId } })]);
  return { active, paidThrough: total?.endsAt.toISOString() ?? null, autoRenew: false as const };
}

export type CheckoutInput = { planId: string; kind: "recharge" | "membership"; requestId: string };
/** Persistent request identity prevents browser/network retries from creating new payable orders. */
export async function createPaymentOrder(userId: string, input: CheckoutInput, db: PrismaClient = prisma) {
  const requestHash = crypto.createHash("sha256").update(JSON.stringify({ planId: input.planId, kind: input.kind })).digest("hex");
  return db.$transaction(async tx => {
    await lockCreditAccount(tx, userId);
    const old = await tx.rechargeOrder.findUnique({ where: { userId_requestId: { userId, requestId: input.requestId } } });
    if (old) {
      if (old.requestHash !== requestHash) throw new PaymentError(409, "本次购买请求已关联其他套餐，请刷新后重试。");
      return old;
    }
    let planName: string, amountFen: number, credits: number, bonusCredits = 0, discount = 0, priority = 0;
    if (input.kind === "membership") {
      const plan = await tx.membershipPlan.findFirst({ where: { id: input.planId, enabled: true } });
      if (!plan) throw new PaymentError(404, "会员套餐不存在或已停用。");
      const now = new Date();
      const member = await tx.userMembership.findUnique({ where: { userId } });
      // Pending, unresolved orders keep their plan lock even after their QR expires:
      // a late paid notification must never be stranded by a different-tier purchase.
      const other = await tx.rechargeOrder.findFirst({ where: { userId, kind: "membership", status: "pending", membershipPlanId: { not: plan.id } } });
      if ((member && member.endsAt > now && member.planId !== plan.id) || other)
        throw new PaymentError(409, "当前会员有效期内或存在待确认订单时，仅支持同档续费。");
      planName = plan.name; amountFen = moneyFen(plan.monthlyPrice); credits = plan.monthlyCredits;
      discount = plan.discountPercent; priority = plan.priorityLevel;
      if (!Number.isInteger(discount) || discount < 0 || discount > 100 || !Number.isSafeInteger(priority) || priority < 0)
        throw new PaymentError(400, "会员权益配置无效。");
    } else {
      const plan = await tx.plan.findFirst({ where: { id: input.planId, enabled: true } });
      if (!plan) throw new PaymentError(404, "积分套餐不存在或已停用。");
      planName = plan.name; amountFen = moneyFen(plan.price); credits = plan.credits; bonusCredits = plan.bonusCredits;
    }
    if (![credits, bonusCredits, credits + bonusCredits].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2_147_483_647))
      throw new PaymentError(400, "套餐积分配置无效。");
    return tx.rechargeOrder.create({ data: {
      id: crypto.randomBytes(16).toString("hex"), userId, planId: input.planId, planName,
      requestId: input.requestId, requestHash, kind: input.kind, channel: "wechat",
      amountFen, amountCny: amountFen / 100, credits, bonusCredits, expiresAt: new Date(Date.now() + 30 * 60_000),
      membershipPlanId: input.kind === "membership" ? input.planId : null,
      membershipDiscountPercent: discount, membershipPriorityLevel: priority
    } });
  });
}

export async function acceptWechatTransaction(transaction: WechatTransaction) {
  if (transaction.trade_state !== "SUCCESS") return;
  return handleRechargeCallback({
    orderId: transaction.out_trade_no, channel: "wechat", providerTradeNo: transaction.transaction_id!,
    amountFen: transaction.amount!.total, paidAt: new Date(transaction.success_time!),
    // Save the minimal verifiable transaction, not payer identity or encrypted callback.
    payload: { source: "wechat-v3-verified", tradeNo: transaction.transaction_id,
      amountFen: transaction.amount!.total, paidAt: transaction.success_time }
  });
}

export async function startCheckout(userId: string, input: CheckoutInput) {
  const pay = gateway();
  const order = await createPaymentOrder(userId, input);
  return prepareCheckout(order.id, userId, pay);
}

export async function prepareCheckout(id: string, userId: string, pay = gateway()) {
  const order = await prisma.rechargeOrder.findFirst({ where: { id, userId, channel: "wechat", amountFen: { not: null } } });
  if (!order) throw new PaymentError(404, "订单不存在。");
  if (order.status !== "pending" || !order.expiresAt || order.expiresAt.getTime() < Date.now() + 60_000)
    return mapRechargeOrder(order);
  if (order.codeUrl) return mapRechargeOrder(order);
  const claimed = await prisma.rechargeOrder.updateMany({ where: { id, status: "pending",
    OR: [{ checkoutLeaseUntil: null }, { checkoutLeaseUntil: { lt: new Date() } }] },
    data: { checkoutLeaseUntil: new Date(Date.now() + 30_000) } });
  if (!claimed.count) throw new PaymentError(409, "订单正在创建，请稍后刷新订单。");
  try {
    // Query first: a timed-out previous create may already have succeeded.
    const transaction = await pay.query(id);
    if (transaction?.trade_state === "SUCCESS") await acceptWechatTransaction(transaction);
    else if (transaction && !["NOTPAY", "USERPAYING"].includes(transaction.trade_state))
      await prisma.rechargeOrder.updateMany({ where: { id, status: "pending" }, data: { status: "expired" } });
    else {
      const codeUrl = await pay.create({ ...order, amountFen: order.amountFen!, expiresAt: order.expiresAt });
      await prisma.rechargeOrder.updateMany({ where: { id, status: "pending" }, data: { codeUrl, reconcileError: null } });
    }
  } finally {
    await prisma.rechargeOrder.update({ where: { id }, data: { checkoutLeaseUntil: null } });
  }
  return mapRechargeOrder(await prisma.rechargeOrder.findUniqueOrThrow({ where: { id } }));
}

export async function reconcilePayment(id: string, pay = gateway()) {
  const order = await prisma.rechargeOrder.findUniqueOrThrow({ where: { id } });
  if (order.channel !== "wechat" || order.amountFen === null || order.status !== "pending") return mapRechargeOrder(order);
  // DB claim bounds upstream query rate across concurrent browsers and API replicas.
  const claimed = await prisma.rechargeOrder.updateMany({ where: { id, status: "pending",
    OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(Date.now() - 10_000) } }] }, data: { checkedAt: new Date() } });
  if (!claimed.count) return mapRechargeOrder(order);
  try {
    const transaction = await pay.query(id);
    if (transaction?.trade_state === "SUCCESS") await acceptWechatTransaction(transaction);
    else if (transaction?.trade_state === "REFUND") throw new Error("provider_refund_requires_review");
    else if (transaction && ["CLOSED", "REVOKED", "PAYERROR"].includes(transaction.trade_state))
      await prisma.rechargeOrder.updateMany({ where: { id, status: "pending" }, data: { status: "expired" } });
    else if (order.expiresAt && order.expiresAt < new Date(Date.now() - 60_000) &&
        (!order.checkoutLeaseUntil || order.checkoutLeaseUntil < new Date())) {
      // Closing the provider order before local expiry prevents late payment/plan conflicts.
      if (transaction) await pay.close(id);
      await prisma.rechargeOrder.updateMany({ where: { id, status: "pending" }, data: { status: "expired" } });
    }
    await prisma.rechargeOrder.update({ where: { id }, data: { reconcileError: null } });
  } catch {
    await prisma.rechargeOrder.update({ where: { id }, data: { reconcileError: "支付状态暂未确认，系统会继续核对。" } });
  }
  return mapRechargeOrder(await prisma.rechargeOrder.findUniqueOrThrow({ where: { id } }));
}

let reconciling = false;
export async function recoverPayments() {
  if (reconciling || !paymentAvailability().wechat) return;
  reconciling = true;
  try {
    const pay = gateway();
    const orders = await prisma.rechargeOrder.findMany({
      where: { channel: "wechat", amountFen: { not: null }, status: "pending" },
      orderBy: [{ checkedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }], take: 20
    });
    for (const order of orders) await reconcilePayment(order.id, pay);
  } finally { reconciling = false; }
}
