import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.AIFILM_TEST_COMMERCE_DATABASE_URL;
test("checkout recovery keeps durable identities across sales and network failures", { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_commerce_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  process.env.DATABASE_URL = databaseUrl;
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const { createPaymentOrder, prepareCheckout, reconcilePayment } = await import("./payments.js");
  const { PaymentError } = await import("./wechat.js");
  const userIds: string[] = [], planIds: string[] = [];
  async function setup() {
    const userId = crypto.randomUUID(), planId = crypto.randomUUID();
    userIds.push(userId); planIds.push(planId);
    await db.user.create({ data: { id: userId, name: "Checkout test", credit: { create: { id: crypto.randomUUID(), balance: 0 } } } });
    await db.membershipPlan.create({ data: { id: planId, name: "Snapshot", monthlyPrice: 10.5, monthlyCredits: 100, discountPercent: 10, priorityLevel: 1, features: [] } });
    const input = { planId, kind: "membership" as const, requestId: crypto.randomUUID(),
      expected: { planName: "Snapshot", amountFen: 1050, credits: 100, bonusCredits: 0, discountPercent: 10, priorityLevel: 1 } };
    return { userId, input };
  }
  try {
    await t.test("different request IDs concurrently alias one pending order; late replay is terminal forever", async () => {
      const { userId, input } = await setup();
      const inputs = Array.from({ length: 5 }, () => ({ ...input, requestId: crypto.randomUUID() }));
      const orders = await Promise.all(inputs.map(value => createPaymentOrder(userId, value, db)));
      assert.equal(new Set(orders.map(row => row.id)).size, 1);
      assert.equal(await db.checkoutRequest.count({ where: { userId } }), 5);
      await db.rechargeOrder.update({ where: { id: orders[0]!.id }, data: { status: "paid" } });
      for (const value of inputs) assert.equal((await createPaymentOrder(userId, value, db)).status, "paid");
      assert.equal(await db.rechargeOrder.count({ where: { userId } }), 1);
      await db.rechargeOrder.update({ where: { id: orders[0]!.id }, data: { status: "expired" } });
      assert.equal((await createPaymentOrder(userId, inputs[0]!, db)).id, orders[0]!.id);
      const fresh = await createPaymentOrder(userId, { ...input, requestId: crypto.randomUUID() }, db);
      assert.notEqual(fresh.id, orders[0]!.id);
      await assert.rejects(createPaymentOrder(userId, { ...inputs[0]!, kind: "recharge" }, db), /关联其他套餐/);
    });
    await t.test("paused or retired plans recover old identities with their original rights; new snapshots are checked", async () => {
      const { userId, input } = await setup();
      const first = await createPaymentOrder(userId, input, db);
      await db.membershipPlan.update({ where: { id: input.planId }, data: { monthlyPrice: 20, discountPercent: 20, enabled: false } });
      const paused = async () => { throw new PaymentError(503, "Paused"); };
      const resumed = await createPaymentOrder(userId, { ...input, requestId: crypto.randomUUID() }, db, paused);
      assert.equal(resumed.id, first.id); assert.equal(resumed.amountFen, 1050); assert.equal(resumed.membershipDiscountPercent, 10);
      await db.rechargeOrder.update({ where: { id: first.id }, data: { status: "expired" } });
      await assert.rejects(createPaymentOrder(userId, { ...input, requestId: crypto.randomUUID() }, db),
        (error: unknown) => error instanceof PaymentError && error.code === "checkout_not_created");
      await db.membershipPlan.update({ where: { id: input.planId }, data: { enabled: true } });
      await assert.rejects(createPaymentOrder(userId, { ...input, requestId: crypto.randomUUID() }, db),
        (error: unknown) => error instanceof PaymentError && error.code === "checkout_not_created");
      const current = { ...input, requestId: crypto.randomUUID(), expected: { ...input.expected, amountFen: 2000, discountPercent: 20 } };
      await assert.rejects(createPaymentOrder(userId, current, db, paused), /Paused/);
      assert.equal(await db.rechargeOrder.count({ where: { userId } }), 1);
      assert.equal(await db.checkoutRequest.count({ where: { userId, requestId: current.requestId } }), 0);
    });
    await t.test("legacy identities gain aliases; accounts never share checkout identities", async () => {
      const a = await setup(), b = await setup();
      const old = await createPaymentOrder(a.userId, a.input, db);
      await db.checkoutRequest.deleteMany({ where: { userId: a.userId } });
      const restored = await createPaymentOrder(a.userId, a.input, db);
      assert.equal(restored.id, old.id);
      assert.equal(await db.checkoutRequest.count({ where: { userId: a.userId } }), 1);
      const other = await createPaymentOrder(b.userId, a.input, db);
      assert.notEqual(other.id, old.id);
      await assert.rejects(prepareCheckout(old.id, b.userId, db, async () => { throw new Error("must not access gateway"); }), /订单不存在/);
    });
    await t.test("existing QR, terminal and non-WeChat reads do not require a gateway", async () => {
      const { userId, input } = await setup();
      const order = await createPaymentOrder(userId, input, db);
      const unavailable = async () => { throw new Error("must not access gateway"); };
      await db.rechargeOrder.update({ where: { id: order.id }, data: { codeUrl: "weixin://fixture-only" } });
      assert.equal((await prepareCheckout(order.id, userId, db, unavailable)).codeUrl, "weixin://fixture-only");
      await db.rechargeOrder.update({ where: { id: order.id }, data: { status: "paid" } });
      assert.equal((await prepareCheckout(order.id, userId, db, unavailable)).status, "paid");
      assert.equal((await reconcilePayment(order.id)).status, "paid");
      await db.rechargeOrder.update({ where: { id: order.id }, data: { channel: "mock", status: "pending" } });
      assert.equal((await prepareCheckout(order.id, userId, db, unavailable)).channel, "mock");
      assert.equal((await reconcilePayment(order.id)).channel, "mock");
    });
    await t.test("paused sales may query a missing QR but cannot create another upstream order", async () => {
      const { userId, input } = await setup();
      const order = await createPaymentOrder(userId, input, db);
      let queries = 0, creates = 0;
      const pay = { query: async () => { queries++; return null; }, create: async () => { creates++; return "weixin://never"; } };
      await assert.rejects(prepareCheckout(order.id, userId, db, async accept => {
        if (accept) throw new PaymentError(503, "Paused");
        return pay as unknown as import("./wechat.js").WechatPay;
      }), /Paused/);
      assert.equal(queries, 1); assert.equal(creates, 0);
      const stored = await db.rechargeOrder.findUniqueOrThrow({ where: { id: order.id } });
      assert.equal(stored.checkoutLeaseUntil, null); assert.equal(stored.codeUrl, null);
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.membershipPlan.deleteMany({ where: { id: { in: planIds } } });
    await db.$disconnect();
  }
});
