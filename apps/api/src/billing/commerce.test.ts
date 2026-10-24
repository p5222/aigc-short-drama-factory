import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.AIFILM_TEST_COMMERCE_DATABASE_URL;
test("PostgreSQL commerce and startup configuration are idempotent", { skip: !databaseUrl }, async (t) => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_commerce_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  process.env.DATABASE_URL = databaseUrl;
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const repository = await import("../db/repository.js");
  const { createPaymentOrder, getMembership } = await import("./payments.js");
  const { reserveTaskCredits, settleTaskCredits } = await import("./taskCredits.js");
  const evaluation = await import("../db/evaluation.js");
  const seed = await import("../db/seed.js");
  const catalog = await import("../seed/catalogData.js");
  const users: string[] = [];
  const codes: string[] = [];
  const providerIds: string[] = [];
  const memberPlanIds: string[] = [];
  async function user(balance = 100) {
    const id = `commerce_user_${crypto.randomUUID()}`;
    users.push(id);
    await db.user.create({ data: { id, name: "Commerce test", credit: { create: { id: `credit_${id}`, balance } } } });
    return id;
  }
  async function order(userId: string, credits = 20) {
    return db.rechargeOrder.create({ data: { id: `order_${crypto.randomUUID()}`, userId, planName: "Test plan", amountCny: 10, credits, channel: "mock", status: "pending" } });
  }
  async function project(userId: string) {
    return db.project.create({ data: { id: `project_${crypto.randomUUID()}`, userId, name: "Test", type: "test", sourceType: "idea", artStyle: "test", videoRatio: "9:16", status: "planning" } });
  }
  const account = (userId: string) => db.creditAccount.findUniqueOrThrow({ where: { userId } });
  try {
    await t.test("concurrent duplicate payment callbacks create one credit entry and payment", async () => {
      const userId = await user(); const invoice = await order(userId);
      const input = { orderId: invoice.id, userId, channel: "mock", providerTradeNo: `trade_${crypto.randomUUID()}`, amountCny: 10 };
      const results = await Promise.all(Array.from({ length: 12 }, () => repository.handleRechargeCallback(input)));
      assert.equal(new Set(results.map((result) => result.payment.id)).size, 1);
      assert.equal((await account(userId)).balance, 120);
      assert.equal(await db.creditTransaction.count({ where: { userId, type: "recharge" } }), 1);
    });
    await t.test("one provider trade cannot pay two different orders", async () => {
      const userId = await user(); const orders = [await order(userId), await order(userId)]; const trade = `trade_${crypto.randomUUID()}`;
      const results = await Promise.allSettled(orders.map((item) => repository.handleRechargeCallback({ orderId: item.id, userId, providerTradeNo: trade, amountCny: 10 })));
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal((await account(userId)).balance, 120);
    });
    await t.test("a mismatched amount cannot credit the account", async () => {
      const userId = await user(); const invoice = await order(userId);
      await assert.rejects(repository.handleRechargeCallback({ orderId: invoice.id, userId, amountCny: 9.99 }), /amount mismatch/);
      assert.equal((await account(userId)).balance, 100);
    });
    await t.test("real checkout identity, payment and membership renewal are atomic under concurrent retries", async () => {
      const userId = await user();
      const planId = `member_${crypto.randomUUID()}`; memberPlanIds.push(planId);
      await db.membershipPlan.create({ data: { id: planId, name: "Integration month", monthlyPrice: 39.9,
        monthlyCredits: 4000, discountPercent: 10, priorityLevel: 2, features: [] } });
      const input = { planId, kind: "membership" as const, requestId: crypto.randomUUID() };
      const orders = await Promise.all(Array.from({ length: 12 }, () => createPaymentOrder(userId, input, db)));
      assert.equal(new Set(orders.map(row => row.id)).size, 1);
      assert.equal(orders[0]!.amountFen, 3990);
      await assert.rejects(createPaymentOrder(userId, { ...input, kind: "recharge" }, db), /关联其他/);
      // Edits after purchase must not change the payable amount or entitlement snapshot.
      await db.membershipPlan.update({ where: { id: planId }, data: { monthlyPrice: 49.9, monthlyCredits: 5000, discountPercent: 20 } });
      const payment = { orderId: orders[0]!.id, channel: "wechat", providerTradeNo: `wechat_${crypto.randomUUID()}`, amountFen: 3990, paidAt: new Date() };
      await assert.rejects(repository.handleRechargeCallback({ ...payment, amountFen: 3991 }), /amount mismatch/);
      await assert.rejects(repository.handleRechargeCallback({ ...payment, paidAt: undefined }), /完整/);
      const paid = await Promise.all(Array.from({ length: 12 }, () => repository.handleRechargeCallback(payment)));
      assert.equal(new Set(paid.map(row => row.payment.id)).size, 1);
      assert.equal((await account(userId)).balance, 4100);
      const firstMember = await getMembership(userId, db);
      assert.equal(firstMember.active?.discountPercent, 10);
      const renewal = await createPaymentOrder(userId, { ...input, requestId: crypto.randomUUID() }, db);
      await repository.handleRechargeCallback({ ...payment, orderId: renewal.id, providerTradeNo: `renew_${crypto.randomUUID()}`, amountFen: 4990 });
      const updated = await getMembership(userId, db);
      assert.ok(Date.parse(updated.paidThrough!) > Date.parse(firstMember.paidThrough!));
      assert.equal(updated.active?.discountPercent, 10, "future renewal must not change current-term benefits");
      assert.equal((await account(userId)).balance, 9100);
      assert.equal(await db.creditTransaction.count({ where: { userId, type: "recharge" } }), 2);
      const terms = await db.rechargeOrder.findMany({ where: { userId, status: "paid" }, orderBy: { membershipStartsAt: "asc" } });
      assert.equal(terms[0]!.membershipEndsAt!.getTime(), terms[1]!.membershipStartsAt!.getTime());
      const { activeMembership } = await import("./membership.js");
      assert.equal((await activeMembership(db, userId, terms[1]!.membershipStartsAt!))?.discountPercent, 20);
      assert.equal(await activeMembership(db, userId, terms[1]!.membershipEndsAt!), null);

      const owned = await project(userId);
      const task = await db.generationTask.create({ data: { id: `member_task_${crypto.randomUUID()}`, userId,
        projectId: owned.id, type: "text", title: "Member settlement", provider: "test", model: "test", status: "running", estimatedCredits: 31 } });
      await db.$transaction(tx => reserveTaskCredits(tx, { taskId: task.id, userId }));
      const snapshot = await db.generationTask.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(snapshot.billingDiscountPercent, 10); assert.equal(snapshot.queuePriority, 98);
      // Membership can expire/change while a long-running task is executing.
      await db.rechargeOrder.updateMany({ where: { userId }, data: { membershipEndsAt: new Date(0) } });
      const settlement = await db.$transaction(tx => settleTaskCredits(tx, { taskId: task.id, userId }));
      assert.equal(settlement.credits, 28);
      assert.equal((await account(userId)).frozenBalance, 0);
      assert.equal((await account(userId)).balance, 9072);
    });
    await t.test("pending membership orders prevent a different tier stranding a late paid notification", async () => {
      const userId = await user();
      const ids = [`member_${crypto.randomUUID()}`, `member_${crypto.randomUUID()}`]; memberPlanIds.push(...ids);
      for (const id of ids) await db.membershipPlan.create({ data: { id, name: "Tier", monthlyPrice: 10, monthlyCredits: 100, features: [] } });
      const first = await createPaymentOrder(userId, { planId: ids[0]!, kind: "membership", requestId: crypto.randomUUID() }, db);
      await db.rechargeOrder.update({ where: { id: first.id }, data: { expiresAt: new Date(0) } });
      await assert.rejects(createPaymentOrder(userId, { planId: ids[1]!, kind: "membership", requestId: crypto.randomUUID() }, db), /同档续费/);
      await repository.handleRechargeCallback({ orderId: first.id, channel: "wechat", amountFen: 1000, paidAt: new Date(),
        providerTradeNo: `late_${crypto.randomUUID()}` });
      assert.equal((await getMembership(userId, db)).active?.planId, ids[0]);
    });
    await t.test("concurrent users cannot exceed a redeem code's total capacity", async () => {
      const people = await Promise.all(Array.from({ length: 8 }, () => user()));
      const code = `AUDIT_${crypto.randomUUID().toUpperCase()}`; codes.push(code);
      const row = await db.redeemCode.create({ data: { id: `code_${crypto.randomUUID()}`, code, name: "Test", credits: 25, maxRedemptions: 1 } });
      const results = await Promise.allSettled(people.map((id) => repository.redeemExperienceCode(id, code)));
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal((await db.redeemCode.findUniqueOrThrow({ where: { id: row.id } })).usedCount, 1);
      assert.equal(await db.redeemRedemption.count({ where: { redeemCodeId: row.id } }), 1);
    });
    await t.test("the same user cannot redeem a multi-use code twice concurrently", async () => {
      const userId = await user(); const code = `AUDIT_${crypto.randomUUID().toUpperCase()}`; codes.push(code);
      await db.redeemCode.create({ data: { id: `code_${crypto.randomUUID()}`, code, name: "Test", credits: 25, maxRedemptions: 20 } });
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => repository.redeemExperienceCode(userId, code)));
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal((await account(userId)).balance, 125);
    });
    await t.test("concurrent admin debits cannot overspend or consume a reservation", async () => {
      const userId = await user();
      const results = await Promise.allSettled(Array.from({ length: 2 }, () => repository.adjustUserCredits({ userId, amount: -60, description: "Test debit" })));
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal((await account(userId)).balance, 40);
      await db.creditAccount.update({ where: { userId }, data: { frozenBalance: 30 } });
      await assert.rejects(repository.adjustUserCredits({ userId, amount: -20, description: "Test reservation protection" }), /冻结积分/);
    });
    await t.test("admin adjustment idempotency survives concurrent retries and rejects changed payloads", async () => {
      const userId = await user();
      const input = { userId, amount: 25, description: "Approved test adjustment", requestId: crypto.randomUUID() };
      await Promise.all(Array.from({ length: 12 }, () => repository.adjustUserCredits(input)));
      assert.equal((await account(userId)).balance, 125);
      assert.equal(await db.creditTransaction.count({ where: { userId } }), 1);
      await assert.rejects(repository.adjustUserCredits({ ...input, amount: 30 }), /不一致|重复|不同/);
      assert.equal((await account(userId)).balance, 125);
    });
    await t.test("admin user search reaches users beyond the latest one hundred", async () => {
      const prefix = `adminpage_${crypto.randomUUID()}`;
      const ids = Array.from({ length: 105 }, (_, index) => `${prefix}_${index}`); users.push(...ids);
      await db.user.createMany({ data: ids.map((id, index) => ({ id, name: `${prefix}_${index}`, createdAt: new Date(Date.UTC(2000, 0, index + 1)) })) });
      const result = await repository.listAdminUsersPage({ keyword: ids[0], pageSize: 10 });
      assert.equal(result.total, 1); assert.equal(result.items[0]?.id, ids[0]);
      const page = await repository.listAdminUsersPage({ keyword: prefix, page: 6, pageSize: 20 });
      assert.equal(page.total, 105); assert.equal(page.items.length, 5); assert.equal(page.page, 6);
    });
    await t.test("provider secrets stay server-side and masked edits preserve the credential", async () => {
      const id = `audit-provider-${crypto.randomUUID()}`; providerIds.push(id);
      const key = `test-only-${crypto.randomUUID()}`;
      await repository.createProvider({ id, name: "Test provider", modality: "image", models: ["test-image"], apiKey: key, baseUrl: "https://provider.invalid/v1", unitCredits: 5 });
      await db.modelProvider.update({ where: { id }, data: { capability: { customSecret: key, supportsSeed: true } } });
      const publicProvider = (await repository.listProviders()).find((row) => row.id === id)!;
      assert.equal("baseUrl" in publicProvider, false); assert.equal("apiKeyPreview" in publicProvider, false);
      assert.equal(JSON.stringify(publicProvider).includes(key), false); assert.equal("customSecret" in publicProvider.capability, false);
      await repository.updateProvider(id, { apiKey: "********masked" });
      assert.equal((await db.modelProvider.findUniqueOrThrow({ where: { id } })).apiKey, key);
      await assert.rejects(repository.updateProvider(id, { baseUrl: "https://embedded:password@provider.invalid" }), /不能嵌入/);
      assert.equal((await db.modelProvider.findUniqueOrThrow({ where: { id } })).baseUrl, "https://provider.invalid/v1");
      const price = await db.modelPrice.findFirstOrThrow({ where: { providerId: id } });
      await assert.rejects(repository.createModelPrice({ providerId: id, providerName: "Test provider", modality: "image", model: "test-image", unitCredits: 8 }), /已存在/);
      await assert.rejects(repository.updateModelPrice(price.id, { unitCredits: -1 }), /非负/);
      await repository.deleteModelPrice(price.id); await repository.deleteProvider(id);
      assert.equal((await db.modelPrice.findUniqueOrThrow({ where: { id: price.id } })).enabled, false);
      assert.equal((await db.modelProvider.findUniqueOrThrow({ where: { id } })).enabled, false);
    });
    await t.test("user recycle bin preserves assets and balances, requires restore before edits, and revokes contact sessions", async () => {
      const id = await user(123); const owned = await project(id);
      const email = `${id}@example.test`;
      await db.user.update({ where: { id }, data: { email } });
      await db.authSession.create({ data: { id: `session_${crypto.randomUUID()}`, userId: id, tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
      await assert.rejects(repository.updateAdminUser(id, { email: "", phone: "" }), /至少保留/);
      await repository.updateAdminUser(id, { email: `updated-${email}` });
      assert.equal(await db.authSession.count({ where: { userId: id, revokedAt: null } }), 0);
      await assert.rejects(repository.updateAdminUser(id, { status: "deleted" }), /先停用/);
      await repository.updateAdminUser(id, { status: "disabled" });
      await assert.rejects(repository.updateAdminUser(id, { status: "deleted" }, id), /当前操作账号/);
      await repository.updateAdminUser(id, { status: "deleted" });
      assert.equal((await repository.listAdminUsersPage({ keyword: id })).total, 0);
      assert.equal((await repository.listAdminUsersPage({ keyword: id, status: "deleted" })).total, 1);
      assert.equal((await account(id)).balance, 123);
      assert.ok(await db.project.findUnique({ where: { id: owned.id } }));
      await assert.rejects(repository.updateAdminUser(id, { status: "active" }), /先恢复/);
      await assert.rejects(repository.updateAdminUser(id, { name: "Hidden edit" }), /先恢复/);
      await assert.rejects(repository.resetAdminUserPassword(id, "Test-reset-password-2026"), /先恢复/);
      await repository.updateAdminUser(id, { status: "disabled" });
      assert.equal((await repository.listAdminUsersPage({ keyword: id })).items[0]?.status, "disabled");
      await repository.updateAdminUser(id, { status: "active" });
    });
    await t.test("redeem edits preserve usage capacity and deleting preserves redemption history", async () => {
      const userId = await user(); const code = `AUDIT_${crypto.randomUUID().toUpperCase()}`; codes.push(code);
      const row = await db.redeemCode.create({ data: { id: `code_${crypto.randomUUID()}`, code, name: "Test", credits: 5, maxRedemptions: 2 } });
      await repository.redeemExperienceCode(userId, code);
      await assert.rejects(repository.updateRedeemCode(row.id, { maxRedemptions: 0 }), /上限/);
      await assert.rejects(repository.updateRedeemCode(row.id, { startsAt: new Date("2030-02-01"), endsAt: new Date("2030-01-01") }), /晚于/);
      await repository.deleteRedeemCode(row.id);
      assert.equal((await db.redeemCode.findUniqueOrThrow({ where: { id: row.id } })).enabled, false);
      assert.equal(await db.redeemRedemption.count({ where: { redeemCodeId: row.id } }), 1);
    });
    await t.test("concurrent first feedback earns its stage reward exactly once", async () => {
      const userId = await user(); const own = await project(userId);
      const input = { projectId: own.id, stage: "image" as const, rating: 3, usability: "usable" as const, tags: [], content: "Test feedback on image quality" };
      await Promise.all(Array.from({ length: 12 }, () => evaluation.createUserFeedback(userId, input)));
      assert.equal((await account(userId)).balance, 110);
      assert.equal(await db.creditTransaction.count({ where: { userId, projectId: own.id } }), 1);
    });
    await t.test("asset-only feedback and analytics reject another user's project", async () => {
      const owner = await user(); const stranger = await user(); const owned = await project(owner);
      const asset = await db.asset.create({ data: { id: `asset_${crypto.randomUUID()}`, projectId: owned.id, type: "image", name: "Private", description: "Private", prompt: "Test", status: "succeeded" } });
      await assert.rejects(evaluation.createUserFeedback(stranger, { assetId: asset.id, stage: "image", rating: 1, usability: "usable", tags: [], content: "Unauthorized" }), /不属于/);
      await assert.rejects(evaluation.recordAnalyticsEvent(stranger, { projectId: owned.id, eventName: "unauthorized" }), /不属于/);
      assert.equal((await account(stranger)).balance, 100);
    });
    await t.test("production startup preserves admin and operating catalog edits", async () => {
      process.env.NODE_ENV = "production";
      process.env.SEED_DEFAULT_USERS = "true";
      process.env.ADMIN_SEED_PASSWORD = "Test-only-admin-bootstrap-2026";
      process.env.SEED_DEMO_USER = "false";
      process.env.SEED_DEMO_DATA = "false";
      process.env.SEED_RESET_DEFAULT_USERS = "false";
      process.env.SEED_SYNC_EDITABLE_CONFIG = "false";
      process.env.SEED_SYNC_BILLING_PRESET = "false";
      await seed.ensureSeedData();
      const plan = catalog.plans[0]!;
      const price = catalog.modelPrices.find((item) => item.providerId === "dashscope-image")!;
      await db.user.update({ where: { id: seed.ADMIN_USER_ID }, data: { name: "Operator-owned admin", passwordHash: "preserved-test-hash", status: "disabled" } });
      await db.plan.update({ where: { id: plan.id }, data: { price: 123, credits: 456, enabled: false } });
      await db.modelPrice.update({ where: { id: price.id }, data: { unitCredits: 77, enabled: false } });
      await db.modelProvider.update({ where: { id: "dashscope-image" }, data: { models: ["operator-model"], enabled: false, capability: { custom: true } } });
      const demo = catalog.redeemCodes[0]!;
      await db.redeemCode.upsert({ where: { code: demo.code }, update: { enabled: true }, create: { id: demo.id, code: demo.code, name: demo.name, credits: demo.credits, enabled: true } });
      await seed.ensureSeedData();
      const admin = await db.user.findUniqueOrThrow({ where: { id: seed.ADMIN_USER_ID } });
      assert.equal(admin.passwordHash, "preserved-test-hash"); assert.equal(admin.name, "Operator-owned admin"); assert.equal(admin.status, "disabled");
      const preservedPlan = await db.plan.findUniqueOrThrow({ where: { id: plan.id } });
      assert.equal(preservedPlan.price, 123); assert.equal(preservedPlan.credits, 456); assert.equal(preservedPlan.enabled, false);
      assert.equal((await db.modelPrice.findUniqueOrThrow({ where: { id: price.id } })).unitCredits, 77);
      assert.deepEqual((await db.modelProvider.findUniqueOrThrow({ where: { id: "dashscope-image" } })).models, ["operator-model"]);
      assert.equal((await db.redeemCode.findUniqueOrThrow({ where: { code: demo.code } })).enabled, false);
      assert.equal(await db.user.findUnique({ where: { id: seed.DEMO_USER_ID } }), null);
    });
    await t.test("concurrent admin demotion cannot remove the last active admin and revokes sessions", async () => {
      assert.equal(await db.user.count({ where: { role: "admin", status: "active" } }), 0, "This test requires the dedicated commerce fixture database");
      const ids = await Promise.all([user(), user()]);
      for (const id of ids) {
        await db.user.update({ where: { id }, data: { role: "admin" } });
        await db.authSession.create({ data: { id: `session_${crypto.randomUUID()}`, userId: id, tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
      }
      const result = await Promise.allSettled(ids.map((id) => repository.updateAdminUser(id, { role: "creator" })));
      assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(await db.user.count({ where: { id: { in: ids }, role: "admin", status: "active" } }), 1);
      const demoted = await db.user.findFirstOrThrow({ where: { id: { in: ids }, role: "creator" } });
      assert.equal(await db.authSession.count({ where: { userId: demoted.id, revokedAt: null } }), 0);
      const remaining = ids.find((id) => id !== demoted.id)!;
      await assert.rejects(repository.updateAdminUser(remaining, { status: "disabled" }), /至少保留/);
    });
    await t.test("password reset atomically revokes sessions and rejects weak or malformed hashes", async () => {
      const userId = await user(); const password = "Test-reset-password-2026";
      await db.authSession.create({ data: { id: `session_${crypto.randomUUID()}`, userId, tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
      await repository.resetAdminUserPassword(userId, password);
      const { hashPassword, verifyPassword } = await import("../auth/password.js");
      assert.equal(await verifyPassword(password, (await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash), true);
      assert.equal(await db.authSession.count({ where: { userId, revokedAt: null } }), 0);
      assert.equal(await verifyPassword(password, "scrypt$malformed$hash"), false);
      await assert.rejects(hashPassword("short"), /密码长度/); await assert.rejects(hashPassword("x".repeat(1025)), /密码长度/);
      await assert.rejects(repository.createAdminUser({ name: "Invalid", email: "broken", password }), /邮箱格式/);
      await assert.rejects(repository.createAdminUser({ name: "Invalid", email: "test@example.invalid", password, initialCredits: 1.5 }), /有效非负整数/);
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.redeemCode.deleteMany({ where: { code: { in: codes } } });
    await db.modelProvider.deleteMany({ where: { id: { in: providerIds } } });
    await db.membershipPlan.deleteMany({ where: { id: { in: memberPlanIds } } });
    await db.$disconnect();
  }
});
