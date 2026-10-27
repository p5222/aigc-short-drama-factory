import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { defaultCreditPolicy, verifiedOfficialCosts, type OfficialCostRule } from "@aifilm/shared";
import { reserveTaskCredits, settleTaskCredits, releaseTaskCredits } from "./taskCredits.js";
import { quotePrice } from "./pricing.js";
import { ensureFunding, grantFunding, spendFunding } from "./funding.js";
import { withTaskMeter, recordTextUsage } from "./metering.js";

const database = process.env.AIFILM_TEST_DATABASE_URL;
test("PostgreSQL credit overhaul: official prices, immutable quotes and cash attribution", { skip: !database }, async t => {
  const url = new URL(database!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  assert.equal(process.env.DATABASE_URL, database, "Default repository must point at the isolated database");
  const db = new PrismaClient({ datasourceUrl: database });
  const users: string[] = [], providers: string[] = [], plans: string[] = [];
  const oldPolicy = await db.creditPricingPolicy.findUnique({ where: { id: "global" } });
  const { adjustUserCredits } = await import("../db/repository.js");
  const { ledgerPage, savePricingPolicy, verifyTaskCost, accountPage } = await import("./creditCenter.js");
  const rule = (model: string) => structuredClone(verifiedOfficialCosts.find(r => r.model === model)!);
  async function policy(protectMargin = true) {
    await db.creditPricingPolicy.upsert({ where: { id: "global" }, create: { id: "global", policy: { ...defaultCreditPolicy, protectMargin } },
      update: { version: 1, policy: { ...defaultCreditPolicy, protectMargin } } });
  }
  async function fixture(cost?: OfficialCostRule, estimate = 100) {
    const userId = `audit_overhaul_${crypto.randomUUID()}`, provider = `audit_provider_${crypto.randomUUID()}`;
    users.push(userId); providers.push(provider);
    await db.user.create({ data: { id: userId, name: "Credit overhaul fixture", credit: { create: { id: `account_${userId}`, balance: 10000 } } } });
    const modality = cost?.kind === "character" ? "tts" : cost?.kind === "image" ? "image" : "text", model = cost?.model ?? "manual";
    await db.modelProvider.create({ data: { id: provider, name: "Isolated", modality, models: [model], costHint: "isolated", capability: {} } });
    const price = await db.modelPrice.create({ data: { id: `price_${provider}`, providerId: provider, providerName: "Isolated", model,
      modality, unit: modality === "tts" ? "tts_character" : modality === "image" ? "image" : "text_run",
      unitCredits: estimate, ...(cost ? { billing: JSON.parse(JSON.stringify(cost)) } : {}) } });
    const task = await db.generationTask.create({ data: { id: `task_${crypto.randomUUID()}`, userId, provider, model, type: modality, title: "Isolated credit task", estimatedCredits: estimate, status: "running" } });
    return { userId, price, task, account: () => db.creditAccount.findUniqueOrThrow({ where: { userId } }) };
  }
  const reserve = (f: Awaited<ReturnType<typeof fixture>>) => db.$transaction(tx => reserveTaskCredits(tx, { userId: f.userId, taskId: f.task.id }));
  const settle = (f: Awaited<ReturnType<typeof fixture>>, finalCredits?: number) => db.$transaction(async tx => {
    const result = await settleTaskCredits(tx, { userId: f.userId, taskId: f.task.id, finalCredits });
    if (result.applied) await tx.generationTask.update({ where: { id: f.task.id }, data: { status: "succeeded" } });
    return result;
  });
  const latest = (f: Awaited<ReturnType<typeof fixture>>) => db.generationTask.findUniqueOrThrow({ where: { id: f.task.id } });
  async function membership(userId: string) {
    await db.rechargeOrder.create({ data: { id: `order_${crypto.randomUUID()}`, userId, planName: "Fixture member", channel: "mock", kind: "membership",
      membershipPlanId: "fixture", status: "paid", amountCny: 0, credits: 0, membershipDiscountPercent: 20,
      membershipStartsAt: new Date(Date.now() - 60000), membershipEndsAt: new Date(Date.now() + 3600000) } });
  }
  try {
    await policy();
    await t.test("1000-character narration quotes 14 credits, freezes and settles once despite later price changes", async () => {
      const f = await fixture(rule("qwen3-tts-flash"), 14);
      assert.equal(await quotePrice(f.price, { characters: 1000 }, db), 14);
      await db.generationTask.update({ where: { id: f.task.id }, data: { requestPayload: { billingInput: { characters: 1000 } } } });
      await reserve(f);
      await db.modelPrice.update({ where: { id: f.price.id }, data: { billing: { ...rule("qwen3-tts-flash"), rateMicros: 8000000 }, unitCredits: 1334 } });
      await savePricingPolicy({ expectedVersion: 1, policy: { ...defaultCreditPolicy, targetMarginBps: 8000 } });
      const results = await Promise.all(Array.from({ length: 8 }, () => settle(f)));
      assert.equal(results.filter(r => r.applied).length, 1);
      assert.equal((await f.account()).balance, 9986); assert.equal((await f.account()).frozenBalance, 0);
      const s = (await latest(f)).billingSettlement as any;
      assert.equal(s.costMicros, 80000); assert.equal(s.costStatus, "output_quantity");
      assert.equal(s.funding.unknownCredits, 14); assert.equal(s.funding.cashMicros, 0);
      await assert.rejects(savePricingPolicy({ expectedVersion: 1, policy: defaultCreditPolicy }), /已被/);
      await policy();
    });
    await t.test("provider token usage separates failed-call costs from delivered charges, including cache", async () => {
      const cost = { ...rule("qwen3.7-plus"), cachedInputMicros: 200000 };
      const f = await fixture(cost, 400); await reserve(f);
      await assert.rejects(withTaskMeter(f.task.id, async () => {
        recordTextUsage({ usage: { prompt_tokens: 100000, completion_tokens: 20000 } }, f.task.provider, f.task.model);
        throw new Error("invalid JSON after charged provider call");
      }, db), /invalid JSON/);
      await withTaskMeter(f.task.id, async () => {
        recordTextUsage({ usage: { prompt_tokens: 100000, completion_tokens: 10000, prompt_tokens_details: { cached_tokens: 50000 } } }, f.task.provider, f.task.model);
      }, db);
      assert.equal((await settle(f)).credits, 32);
      const s = (await latest(f)).billingSettlement as any;
      assert.equal(s.costMicros, 550000); assert.equal(s.releasedCredits, 368); assert.equal(s.costStatus, "usage_derived");
    });
    await t.test("a retry excludes an earlier generated response that could not be persisted", async () => {
      const f = await fixture(rule("qwen3.7-plus"), 100); await reserve(f);
      for (const [attemptId, inputTokens, outputTokens] of [["old", 100000, 5000], ["new", 1000, 100]] as const) {
        await db.generationTask.update({ where: { id: f.task.id }, data: { errorReason: JSON.stringify({ kind: "creation_lease", leaseId: attemptId }) } });
        await withTaskMeter(f.task.id, async () => { recordTextUsage({ usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens } }, f.task.provider, f.task.model); }, db, attemptId);
      }
      const settled = await db.$transaction(tx => settleTaskCredits(tx, { taskId: f.task.id, userId: f.userId, attemptId: "new" }));
      assert.equal(settled.credits, 1);
      assert.equal(((await latest(f)).billingSettlement as any).costMicros, 242800);
    });
    await t.test("unexpected delivered quantities are capped at the confirmed maximum", async () => {
      const f = await fixture(rule("qwen-image-2.0-pro"), 84); await reserve(f);
      await db.generationTask.update({ where: { id: f.task.id }, data: { billingUsage: { calls: [{ provider: f.task.provider, model: f.task.model, delivered: true, usage: { images: 4 } }] } } });
      assert.equal((await settle(f)).credits, 84);
      const s = (await latest(f)).billingSettlement as any;
      assert.equal(s.calculatedCredits, 334); assert.equal(s.capped, true); assert.equal(s.costMicros, 2000000);
    });
    await t.test("manual members freeze the discounted amount and receive exactly one discount", async () => {
      const f = await fixture(); await membership(f.userId);
      assert.equal((await reserve(f)).credits, 80);
      assert.equal((await settle(f)).credits, 80);
      assert.equal((await f.account()).totalConsume, 80);
    });
    await t.test("automatic discounts obey the snapshotted protection setting", async () => {
      for (const protectedMode of [true, false]) {
        await policy(protectedMode);
        const f = await fixture(rule("qwen3-tts-flash"), 14); await membership(f.userId);
        await db.generationTask.update({ where: { id: f.task.id }, data: { requestPayload: { billingInput: { characters: 1000 } } } });
        assert.equal((await reserve(f)).credits, protectedMode ? 14 : 12);
        assert.equal((await settle(f)).credits, protectedMode ? 14 : 12);
      }
      await policy();
    });
    await t.test("unspent historical paid lots protect margin after the old offer is disabled", async () => {
      const f = await fixture(rule("qwen3-tts-flash"), 14);
      const planId = `audit_old_plan_${crypto.randomUUID()}`; plans.push(planId);
      await db.plan.create({ data: { id: planId, name: "Retired offer", price: 0.2, credits: 100, features: [], enabled: false } });
      await db.$transaction(tx => grantFunding(tx, { userId: f.userId, credits: 100, source: "paid", cashMicros: 200000 }));
      assert.equal(await quotePrice(f.price, { characters: 1000 }, db), 67);
      await policy(false);
      assert.equal(await quotePrice(f.price, { characters: 1000 }, db), 14);
      await policy();
      await db.$transaction(tx => spendFunding(tx, f.userId, 100));
      assert.equal(await quotePrice(f.price, { characters: 1000 }, db), 14);
    });
    await t.test("FIFO conserves cash micro-units and distinguishes gift from unknown funding", async () => {
      const f = await fixture();
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "CreditAccount" WHERE "userId" = ${f.userId} FOR UPDATE`;
        await tx.creditAccount.update({ where: { userId: f.userId }, data: { balance: 115 } });
        await grantFunding(tx, { userId: f.userId, credits: 100, source: "paid", cashMicros: 1000001 });
        await grantFunding(tx, { userId: f.userId, credits: 10, source: "gift", cashMicros: 0 });
        await grantFunding(tx, { userId: f.userId, credits: 5, source: "admin_unknown" });
        // All inserts share a transaction timestamp: the sequence must preserve FIFO.
        await ensureFunding(tx, f.userId, 115);
        const a = await spendFunding(tx, f.userId, 99), b = await spendFunding(tx, f.userId, 16);
        assert.equal(a.cashMicros + b.cashMicros, 1000001);
        assert.equal(b.giftCredits, 10); assert.equal(b.unknownCredits, 5);
        assert.equal((await tx.creditFundingLot.aggregate({ where: { userId: f.userId }, _sum: { remainingCredits: true } }))._sum.remainingCredits, 0);
        await tx.creditAccount.update({ where: { userId: f.userId }, data: { balance: 0 } });
      });
    });
    await t.test("manual deduction remains an adjustment with idempotency and no generation consumption", async () => {
      const f = await fixture();
      await reserve(f);
      const input = { userId: f.userId, amount: -50, description: "Isolated correction", requestId: "correction-1" };
      await Promise.all([adjustUserCredits(input), adjustUserCredits(input)]);
      assert.equal((await f.account()).balance, 9950); assert.equal((await f.account()).totalConsume, 0);
      assert.equal(await db.creditTransaction.count({ where: { userId: f.userId, type: "adjust" } }), 1);
      const rows = await accountPage({ keyword: f.userId });
      assert.equal(rows.items[0]?.frozenLedger, 100); assert.equal(rows.items[0]?.anomaly, false);
      await assert.rejects(adjustUserCredits({ ...input, requestId: "too-much", amount: -9900 }), /冻结/);
    });
    await t.test("pagination uses stable nonoverlapping pages and scopes every ledger to its user", async () => {
      const f = await fixture(), other = await fixture();
      await db.creditTransaction.createMany({ data: Array.from({ length: 45 }, (_, i) => ({ id: `ledger_${f.userId}_${String(i).padStart(2, "0")}`, userId: f.userId, type: "adjust", amount: 1, balanceAfter: i + 1, description: "paged fixture", createdAt: new Date(1000 + i) })) });
      const a = await ledgerPage(f.userId, { page: 1, pageSize: 20 }), b = await ledgerPage(f.userId, { page: 2, pageSize: 20 });
      assert.equal(a.total, 45); assert.equal(b.items.length, 20); assert.equal(new Set([...a.items, ...b.items].map(l => l.id)).size, 40);
      assert.equal((await ledgerPage(other.userId, { keyword: "paged fixture" })).total, 0);
    });
    await t.test("costs arriving after cancellation survive refunds and cannot overwrite a verified invoice", async () => {
      const f = await fixture(rule("qwen3.7-plus"), 100); await reserve(f);
      await withTaskMeter(f.task.id, async () => {
        await db.$transaction(async tx => {
          await releaseTaskCredits(tx, { userId: f.userId, taskId: f.task.id });
          await tx.generationTask.update({ where: { id: f.task.id }, data: { status: "canceled" } });
        });
        recordTextUsage({ usage: { prompt_tokens: 100000, completion_tokens: 10000 } }, f.task.provider, f.task.model);
      }, db);
      assert.equal(((await latest(f)).billingSettlement as any).costMicros, 280000);
      const invoice = await latest(f);
      await verifyTaskCost({ taskId: f.task.id, expectedUpdatedAt: invoice.updatedAt.toISOString(), costMicros: 300000, invoiceReference: "isolated-test-invoice" });
      await assert.rejects(verifyTaskCost({ taskId: f.task.id, expectedUpdatedAt: invoice.updatedAt.toISOString(), costMicros: 1, invoiceReference: "stale" }), /已变化/);
      await withTaskMeter(f.task.id, async () => { recordTextUsage({ usage: { prompt_tokens: 1, completion_tokens: 1 } }, f.task.provider, f.task.model); }, db);
      assert.equal(((await latest(f)).billingSettlement as any).costMicros, 300000);
      assert.equal((await f.account()).balance, 10000); assert.equal((await f.account()).frozenBalance, 0);
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.modelProvider.deleteMany({ where: { id: { in: providers } } });
    await db.plan.deleteMany({ where: { id: { in: plans } } });
    if (oldPolicy) await db.creditPricingPolicy.upsert({ where: { id: "global" }, create: { id: "global", version: oldPolicy.version, policy: oldPolicy.policy ?? Prisma.JsonNull }, update: { version: oldPolicy.version, policy: oldPolicy.policy ?? Prisma.JsonNull } });
    else await db.creditPricingPolicy.deleteMany({ where: { id: "global" } });
    await db.$disconnect();
  }
});
