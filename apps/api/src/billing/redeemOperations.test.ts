import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { redeemCodeStatus } from "@aifilm/shared";

const databaseUrl = process.env.AIFILM_TEST_COMMERCE_DATABASE_URL;
test("PostgreSQL redemption operations: bounded pages, accounting, atomic state and receipt ownership", { skip: !databaseUrl, timeout: 90000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_commerce_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false"; process.env.DATABASE_URL = databaseUrl;
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const ops = await import("../db/redeemOperations.js");
  const repository = await import("../db/repository.js");
  const run = crypto.randomUUID();
  const userId = `redeem_ops_${run}`, otherId = `redeem_ops_other_${run}`, batchId = `redeem_ops_batch_${run}`;
  await db.user.createMany({ data: [{ id: userId, name: `查账用户${run}` }, { id: otherId, name: "Other" }] });
  await db.creditAccount.createMany({ data: [userId, otherId].map(id => ({ id: `credit_${id}`, userId: id, balance: 0 })) });
  await db.redeemBatch.create({ data: { id: batchId, name: `活动_${run}`, prefix: "OPS", credits: 10, totalCodes: 33 } });
  const baseTime = Date.now();
  const rows = Array.from({ length: 33 }, (_, i) => ({
    id: `ops_${run}_${String(i).padStart(2, "0")}`, batchId, code: `OPS-${run}-${i}`.toUpperCase(), name: i === 0 ? `100%_真实${run}` : `操作码${run}`,
    credits: 10, maxRedemptions: 2, usedCount: i === 2 ? 2 : 0,
    enabled: i !== 1, startsAt: i === 3 ? new Date(baseTime + 86400000) : null,
    endsAt: i === 4 ? new Date(baseTime - 1000) : null,
    createdAt: new Date(baseTime), updatedAt: new Date(baseTime - 60000)
  }));
  await db.redeemCode.createMany({ data: rows });
  try {
    const query = (extra = {}) => ops.redeemCodePageSchema.parse({ batchId, ...extra });
    await t.test("pages are stable and every status and aggregate uses the same filtered scope", async () => {
      const first = await ops.listRedeemCodePage(query(), db), second = await ops.listRedeemCodePage(query({ page: 2 }), db);
      assert.equal(first.total, 33); assert.equal(first.items.length, 20); assert.equal(second.items.length, 13);
      assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 33);
      assert.deepEqual(first.summary, { codes: 33, active: 29, disabled: 1, expired: 1, scheduled: 1, used_up: 1, remainingCredits: 600, redeemedCredits: 0, redemptions: 0 });
      for (const status of ["active", "disabled", "expired", "scheduled", "used_up"]) {
        const page = await ops.listRedeemCodePage(query({ status }), db);
        assert.ok(page.items.every(row => redeemCodeStatus(row) === status));
        assert.equal(page.total, first.summary[status as keyof typeof first.summary]);
      }
      const literal = await ops.listRedeemCodePage(query({ search: "100%_" }), db);
      assert.equal(literal.total, 1); assert.equal(literal.items[0]!.id, rows[0]!.id);
      const exact = await ops.listRedeemCodePage(query({ codeId: rows[5]!.id }), db);
      assert.equal(exact.total, 1); assert.equal(exact.items[0]!.id, rows[5]!.id);
      assert.equal((await ops.listRedeemCodePage(query({ page: 999 }), db)).page, 2);
      const batches = await ops.listRedeemBatchPage(ops.redeemBatchPageSchema.parse({ search: run }), db);
      assert.equal(batches.total, 1); assert.deepEqual(batches.items[0]!.summary, first.summary);
      assert.equal((await ops.exportRedeemCodes(query({ distributable: "true" }), db)).total, 29);
    });
    await t.test("single edits detect stale versions and bulk conflicts roll back every selected row", async () => {
      const initial = await db.redeemCode.findUniqueOrThrow({ where: { id: rows[0]!.id } });
      const version = initial.updatedAt.toISOString();
      const results = await Promise.allSettled([
        repository.updateRedeemCode(initial.id, { name: "编辑一", expectedUpdatedAt: version }),
        repository.updateRedeemCode(initial.id, { name: "编辑二", expectedUpdatedAt: version })
      ]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(results.filter(result => result.status === "rejected").length, 1);
      await assert.rejects(ops.setRedeemCodeStatuses({ enabled: false, codes: [initial, rows[5]!].map(row => ({ id: row.id, updatedAt: row.updatedAt.toISOString() })) }, db), /未修改任何码/);
      assert.equal((await db.redeemCode.findUniqueOrThrow({ where: { id: rows[5]!.id } })).enabled, true);
      const selected = (await db.redeemCode.findMany({ where: { id: { in: [initial.id, rows[5]!.id] } } })).map(row => ({ id: row.id, updatedAt: row.updatedAt.toISOString() }));
      assert.deepEqual(await ops.setRedeemCodeStatuses({ enabled: false, codes: selected }, db), { requested: 2, changed: 2, unchanged: 0 });
      assert.deepEqual(await ops.setRedeemCodeStatuses({ enabled: false, codes: selected }, db), { requested: 2, changed: 0, unchanged: 2 });
      await assert.rejects(ops.setRedeemCodeStatuses({ enabled: true, codes: [] }, db), /请选择/);
      await assert.rejects(ops.setRedeemCodeStatuses({ enabled: true, codes: [...selected, { id: "missing", updatedAt: version }] }, db), /未修改任何码/);
      assert.equal((await db.redeemCode.findUniqueOrThrow({ where: { id: initial.id } })).enabled, false);
    });
    await t.test("batch gate serializes with redemption and preserves individual disabled flags", async () => {
      let acquired!: () => void, release!: () => void;
      const locked = new Promise<void>(resolve => { acquired = resolve; });
      const unlock = new Promise<void>(resolve => { release = resolve; });
      const lock = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "RedeemCode" WHERE "batchId" = ${batchId} ORDER BY id FOR UPDATE`;
        await tx.redeemBatch.update({ where: { id: batchId }, data: { enabled: false } });
        acquired(); await unlock;
      });
      await locked;
      const redemption = repository.redeemExperienceCode(userId, rows[6]!.code);
      release(); await lock;
      await assert.rejects(redemption, /批次已停用/);
      const closed = await ops.listRedeemCodePage(query(), db);
      assert.equal(closed.summary.disabled, 33); assert.equal(closed.summary.remainingCredits, 0);
      const currentBatch = await db.redeemBatch.findUniqueOrThrow({ where: { id: batchId } });
      const input = { enabled: true, expectedUpdatedAt: currentBatch.updatedAt.toISOString() };
      await ops.setRedeemBatchStatus(batchId, input, db);
      assert.equal((await db.redeemCode.findUniqueOrThrow({ where: { id: rows[1]!.id } })).enabled, false);
      assert.equal((await ops.setRedeemBatchStatus(batchId, input, db)).changed, 0);
      await assert.rejects(ops.setRedeemBatchStatus(batchId, { ...input, enabled: false }, db), /已被其他操作更新/);
    });
    await t.test("history and receipt use actual posted credits and isolate user ownership", async () => {
      await repository.redeemExperienceCode(userId, rows[6]!.code);
      // Model a legacy record whose historical credit differs from current configuration.
      await db.redeemRedemption.create({ data: { id: `ops_receipt_${run}`, redeemCodeId: rows[7]!.id, userId, credits: 7 } });
      const page = await ops.listRedeemCodePage(query(), db);
      assert.equal(page.summary.redeemedCredits, 17); assert.equal(page.summary.redemptions, 2);
      const history = await repository.listRedeemHistory({ admin: true, batchId, search: `查账用户${run}` });
      assert.equal(history.total, 2); assert.equal(history.items.reduce((sum, row) => sum + row.credits, 0), 17);
      assert.equal((await repository.listRedeemHistory({ admin: true, batchId, search: "absent-query" })).total, 0);
      assert.equal((await repository.listRedeemHistory({ admin: true, batchId, from: new Date(baseTime + 86400000).toISOString() })).total, 0);
      const own = await ops.lookupRedeemReceipt(userId, rows[6]!.code.toLowerCase(), db);
      assert.equal(own.receipt?.credits, 10); assert.equal(own.receipt?.user, undefined);
      assert.ok(!JSON.stringify(own).includes(rows[6]!.code));
      assert.deepEqual(await ops.lookupRedeemReceipt(otherId, rows[6]!.code, db), { found: false });
      assert.deepEqual(await ops.lookupRedeemReceipt(otherId, "DOES-NOT-EXIST", db), { found: false });
      assert.equal((await db.creditAccount.findUniqueOrThrow({ where: { userId } })).balance, 10);
    });
    await t.test("large exports require narrowing and empty historical batches remain visible", async () => {
      const largeId = `ops_large_${run}`;
      await db.redeemBatch.create({ data: { id: largeId, name: "Large", prefix: "BIG", credits: 1, totalCodes: 1001 } });
      try {
        await db.redeemCode.createMany({ data: Array.from({ length: 1001 }, (_, i) => ({ id: `${largeId}_${i}`, code: `${largeId}_${i}`, batchId: largeId, name: "large", credits: 1 })) });
        await assert.rejects(ops.exportRedeemCodes(query({ batchId: largeId }), db), /1000/);
        assert.equal((await ops.listRedeemCodePage(query({ batchId: largeId }), db)).items.length, 20);
        await db.redeemCode.deleteMany({ where: { batchId: largeId } });
        const page = await ops.listRedeemBatchPage(ops.redeemBatchPageSchema.parse({ search: largeId }), db);
        assert.equal(page.items[0]!.summary.codes, 0);
      } finally {
        await db.redeemCode.deleteMany({ where: { batchId: largeId } });
        await db.redeemBatch.delete({ where: { id: largeId } });
      }
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await db.redeemCode.deleteMany({ where: { batchId } });
    await db.redeemBatch.delete({ where: { id: batchId } });
    await db.$disconnect();
  }
});
