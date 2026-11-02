import crypto from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { CheckoutExpectation } from "@aifilm/shared";
import { effectiveWechatConfig, lockPaymentConfiguration } from "../config/platformSettings.js";
import { prisma } from "../db/client.js";
import { mapRechargeOrder } from "../db/mappers.js";
import { handleRechargeCallback } from "../db/repository.js";
import { lockCreditAccount } from "./accountCredits.js";
import { membershipOverview } from "./membership.js";
import { moneyFen, PaymentError, WechatPay, wechatConfig, type WechatTransaction } from "./wechat.js";

export async function paymentAvailability() {
  try { const ready = Boolean(await effectiveWechatConfig(true)); return { wechat: ready, membership: ready, autoRenew: false as const }; }
  catch { return { wechat: false, membership: false, autoRenew: false as const }; }
}
async function gateway(acceptNewOrders = false, db: PrismaClient | Prisma.TransactionClient = prisma) {
  const config = await effectiveWechatConfig(acceptNewOrders, db);
  if (!config) throw new PaymentError(503, "微信支付暂未开放，请使用店铺卡密或稍后重试。");
  return new WechatPay(config);
}
export async function getMembership(userId: string, db: PrismaClient = prisma) {
  return membershipOverview(db, userId);
}

export type CheckoutInput = { planId: string; kind: "recharge" | "membership"; requestId: string; expected: CheckoutExpectation };
/** Persistent request identity prevents browser/network retries from creating new payable orders. */
export async function createPaymentOrder(userId: string, input: CheckoutInput, db: PrismaClient = prisma, beforeCreate?: (tx: Prisma.TransactionClient) => Promise<void>) {
  const requestHash = crypto.createHash("sha256").update(JSON.stringify({ planId: input.planId, kind: input.kind })).digest("hex");
  return db.$transaction(async tx => {
    // Keep the same lock order as payment configuration changes. Only a genuinely
    // new order needs new-sales availability; every alias survives terminal states.
    await lockPaymentConfiguration(tx, true);
    await lockCreditAccount(tx, userId);
    const alias = await tx.checkoutRequest.findUnique({ where: { userId_requestId: { userId, requestId: input.requestId } }, include: { order: true } });
    if (alias) {
      if (alias.requestHash !== requestHash) throw new PaymentError(409, "本次购买请求已关联其他套餐，请刷新后重试。");
      return alias.order;
    }
    const remember = async (order: Awaited<ReturnType<typeof tx.rechargeOrder.create>>) => {
      await tx.checkoutRequest.create({ data: { userId, requestId: input.requestId, requestHash, orderId: order.id } });
      return order;
    };
    const old = await tx.rechargeOrder.findUnique({ where: { userId_requestId: { userId, requestId: input.requestId } } });
    if (old) {
      if (old.requestHash !== requestHash) throw new PaymentError(409, "本次购买请求已关联其他套餐，请刷新后重试。");
      return remember(old);
    }
    // Expired QR codes still require reconciliation before another payable order.
    const pending = await tx.rechargeOrder.findFirst({ where: { userId, kind: input.kind, planId: input.planId,
      channel: "wechat", amountFen: { not: null }, status: "pending" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (pending) return remember(pending);
    let planName: string, amountFen: number, credits: number, bonusCredits = 0, discount = 0, priority = 0;
    if (input.kind === "membership") {
      const plan = await tx.membershipPlan.findFirst({ where: { id: input.planId, enabled: true } });
      if (!plan) throw new PaymentError(404, "会员套餐不存在或已停用。", "checkout_not_created");
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
      if (!plan) throw new PaymentError(404, "积分套餐不存在或已停用。", "checkout_not_created");
      planName = plan.name; amountFen = moneyFen(plan.price); credits = plan.credits; bonusCredits = plan.bonusCredits;
    }
    if (![credits, bonusCredits, credits + bonusCredits].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2_147_483_647))
      throw new PaymentError(400, "套餐积分配置无效。");
    const expected: CheckoutExpectation = { planName, amountFen, credits, bonusCredits, discountPercent: discount, priorityLevel: priority };
    if (!input.expected || (Object.keys(expected) as Array<keyof CheckoutExpectation>).some(key => input.expected[key] !== expected[key]))
      throw new PaymentError(409, "套餐价格或权益已变化，本次未创建订单。请关闭确认窗口，刷新套餐并重新选择。", "checkout_not_created");
    await beforeCreate?.(tx);
    return remember(await tx.rechargeOrder.create({ data: {
      id: crypto.randomBytes(16).toString("hex"), userId, planId: input.planId, planName,
      requestId: input.requestId, requestHash, kind: input.kind, channel: "wechat",
      amountFen, amountCny: amountFen / 100, credits, bonusCredits, expiresAt: new Date(Date.now() + 30 * 60_000),
      membershipPlanId: input.kind === "membership" ? input.planId : null,
      membershipDiscountPercent: discount, membershipPriorityLevel: priority
    } }));
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
  const order = await createPaymentOrder(userId, input, prisma, async tx => {
    await gateway(true, tx);
  });
  return prepareCheckout(order.id, userId);
}

export async function prepareCheckout(id: string, userId: string, db: PrismaClient = prisma,
  getGateway: (acceptNewOrders: boolean) => Promise<WechatPay> = accept => gateway(accept, db)) {
  const order = await db.rechargeOrder.findFirst({ where: { id, userId } });
  if (!order) throw new PaymentError(404, "订单不存在。");
  if (order.channel !== "wechat" || order.amountFen === null || order.status !== "pending" || !order.expiresAt || order.expiresAt.getTime() < Date.now() + 60_000)
    return mapRechargeOrder(order);
  if (order.codeUrl) return mapRechargeOrder(order);
  const lease = new Date(Date.now() + 30_000);
  const claimed = await db.rechargeOrder.updateMany({ where: { id, status: "pending",
    OR: [{ checkoutLeaseUntil: null }, { checkoutLeaseUntil: { lt: new Date() } }] },
    data: { checkoutLeaseUntil: lease } });
  if (!claimed.count) throw new PaymentError(409, "订单正在创建，请稍后刷新订单。");
  try {
    const pay = await getGateway(false);
    // Query first: a timed-out previous create may already have succeeded.
    const transaction = await pay.query(id);
    if (transaction?.trade_state === "SUCCESS") await acceptWechatTransaction(transaction);
    else if (transaction && !["NOTPAY", "USERPAYING"].includes(transaction.trade_state))
      await db.rechargeOrder.updateMany({ where: { id, status: "pending" }, data: { status: "expired" } });
    else {
      // Querying old orders is allowed while paused; creating a QR still needs
      // current new-sales permission, even if this request previously had it.
      const creator = await getGateway(true);
      const codeUrl = await creator.create({ ...order, amountFen: order.amountFen!, expiresAt: order.expiresAt });
      await db.rechargeOrder.updateMany({ where: { id, status: "pending", checkoutLeaseUntil: lease }, data: { codeUrl, reconcileError: null } });
    }
  } finally {
    await db.rechargeOrder.updateMany({ where: { id, checkoutLeaseUntil: lease }, data: { checkoutLeaseUntil: null } });
  }
  return mapRechargeOrder(await db.rechargeOrder.findUniqueOrThrow({ where: { id } }));
}

export async function reconcilePayment(id: string, pay?: WechatPay) {
  const order = await prisma.rechargeOrder.findUniqueOrThrow({ where: { id } });
  if (order.channel !== "wechat" || order.amountFen === null || order.status !== "pending") return mapRechargeOrder(order);
  // DB claim bounds upstream query rate across concurrent browsers and API replicas.
  const claimed = await prisma.rechargeOrder.updateMany({ where: { id, status: "pending",
    OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(Date.now() - 10_000) } }] }, data: { checkedAt: new Date() } });
  if (!claimed.count) return mapRechargeOrder(order);
  try {
    pay ??= await gateway();
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
  if (reconciling) return;
  reconciling = true;
  try {
    const config = await effectiveWechatConfig();
    if (!config) return;
    const pay = new WechatPay(config);
    const orders = await prisma.rechargeOrder.findMany({
      where: { channel: "wechat", amountFen: { not: null }, status: "pending" },
      orderBy: [{ checkedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }], take: 20
    });
    for (const order of orders) await reconcilePayment(order.id, pay);
  } finally { reconciling = false; }
}
