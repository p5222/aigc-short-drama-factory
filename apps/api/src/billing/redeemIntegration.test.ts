import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { normalizeRedeemCode, redeemCodeStatus } from "@aifilm/shared";

test("redeem availability uses inclusive expiry and preserves hyphen identity", () => {
  const code = { enabled: true, usedCount: 0, maxRedemptions: 1, startsAt: "2026-01-01", endsAt: "2026-02-01" };
  assert.equal(redeemCodeStatus(code, Date.parse(code.startsAt)), "active");
  assert.equal(redeemCodeStatus(code, Date.parse(code.endsAt)), "expired");
  assert.equal(redeemCodeStatus({ ...code, batchEnabled: false }, Date.parse(code.startsAt)), "disabled");
  assert.equal(normalizeRedeemCode(" ｔｒｉａｌ — ＡＢＣ１２３ \n"), "TRIAL-ABC123");
  assert.notEqual(normalizeRedeemCode("AB-C"), normalizeRedeemCode("A-BC"));
});

const databaseUrl = process.env.AIFILM_TEST_COMMERCE_DATABASE_URL;
test("PostgreSQL redeem batch retries, lifecycle and scoped history", { skip: !databaseUrl, timeout: 60000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_commerce_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false"; process.env.DATABASE_URL = databaseUrl;
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const repository = await import("../db/repository.js");
  const users = Array.from({ length: 3 }, () => `redeem_test_${crypto.randomUUID()}`);
  const batchIds: string[] = [], codeIds: string[] = [];
  for (const id of users) await db.user.create({ data: { id, name: "Redeem test", credit: { create: { id: `credit_${id}`, balance: 0 } } } });
  try {
    const input = { name: "重试批次", prefix: "AUDIT", credits: 25, count: 3, maxRedemptions: 2, requestId: crypto.randomUUID(), endsAt: new Date(Date.now() + 3600000).toISOString() };
    let codes: Awaited<ReturnType<typeof repository.createRedeemCodeBatch>>;
    await t.test("simultaneous retries reuse one batch; mismatches reject even after edits", async () => {
      const results = await Promise.all(Array.from({ length: 4 }, () => repository.createRedeemCodeBatch(input, users[0]!)));
      codes = results[0]!; batchIds.push(codes[0]!.batchId!);
      assert.equal(codes.length, 3);
      assert.equal(new Set(results.flatMap(rows => rows.map(code => code.id))).size, 3);
      assert.match(codes[0]!.code, /^AUDIT-[0-9A-F]{24}$/);
      await assert.rejects(repository.createRedeemCodeBatch({ ...input, credits: 26 }, users[0]!), /此请求/);
      await repository.updateRedeemCode(codes[0]!.id, { name: "活动更名" });
      assert.deepEqual((await repository.createRedeemCodeBatch(input, users[0]!)).map(row => row.id), codes.map(row => row.id));
      const other = await repository.createRedeemCodeBatch(input, users[1]!); batchIds.push(other[0]!.batchId!);
      assert.notEqual(other[0]!.batchId, codes[0]!.batchId);
    });
    await t.test("one person cannot redeem twice concurrently; history keeps original credit and hides other users", async () => {
      const code = codes![0]!;
      const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => repository.redeemExperienceCode(users[0], ` ${code.code.toLowerCase()} `)));
      assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
      await repository.redeemExperienceCode(users[1], code.code);
      await assert.rejects(repository.redeemExperienceCode(users[2], code.code), /额度已用完/);
      await assert.rejects(repository.updateRedeemCode(code.id, { credits: 99 }), /不可修改/);
      await assert.rejects(repository.updateRedeemCode(code.id, { code: "CHANGED" }), /不可修改/);
      await repository.deleteRedeemCode(code.id);
      const own = await repository.listRedeemHistory({ userId: users[0]! });
      assert.equal(own.total, 1); assert.equal(own.items[0]!.credits, 25);
      assert.equal(own.items[0]!.user, undefined); assert.ok(!JSON.stringify(own).includes(code.code));
      assert.equal((await repository.listRedeemHistory({ userId: users[2]! })).total, 0);
      const admin = await repository.listRedeemHistory({ admin: true, codeId: code.id });
      assert.equal(admin.total, 2); assert.ok(admin.items.every(row => row.user?.id && row.credits === 25));
      assert.equal((await db.creditAccount.findUniqueOrThrow({ where: { userId: users[0]! } })).balance, 25);
      assert.equal(await db.creditTransaction.count({ where: { userId: users[0]!, type: "recharge" } }), 1);
    });
    await t.test("expiry is checked after acquiring the row lock and all partial edits preserve fields", async () => {
      const code = codes![1]!;
      await repository.updateRedeemCode(code.id, { enabled: false, name: undefined, credits: undefined });
      assert.equal((await db.redeemCode.findUniqueOrThrow({ where: { id: code.id } })).credits, 25);
      let acquired!: () => void;
      const locked = new Promise<void>(resolve => { acquired = resolve; });
      const lock = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "RedeemCode" WHERE "id" = ${code.id} FOR UPDATE`;
        await tx.redeemCode.update({ where: { id: code.id }, data: { enabled: true, endsAt: new Date(Date.now() + 150) } });
        acquired();
        await new Promise(resolve => setTimeout(resolve, 400));
      });
      await locked;
      await assert.rejects(repository.redeemExperienceCode(users[0], code.code), /已过期/); await lock;
      await db.redeemBatch.update({ where: { id: code.batchId }, data: { enabled: false } });
      assert.equal((await repository.listRedeemCodes()).find(row => row.id === codes![2]!.id)?.status, "disabled");
      await assert.rejects(repository.redeemExperienceCode(users[0], codes![2]!.code), /批次已停用/);
    });
    await t.test("invalid batches reject without creating codes; legacy exact spelling remains valid", async () => {
      await assert.rejects(repository.createRedeemCodeBatch({ ...input, requestId: crypto.randomUUID(), endsAt: new Date(0).toISOString() }, users[0]!), /未来/);
      await assert.rejects(repository.createRedeemCodeBatch({ ...input, requestId: crypto.randomUUID(), prefix: "!!!" }, users[0]!), /前缀/);
      const id = `legacy_${crypto.randomUUID()}`; codeIds.push(id);
      const value = `OLD ${crypto.randomUUID().toUpperCase()}`;
      await db.redeemCode.create({ data: { id, code: value, name: "Legacy", credits: 3 } });
      await repository.redeemExperienceCode(users[2], value);
      assert.equal((await repository.listRedeemHistory({ userId: users[2]! })).items[0]?.credits, 3);
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.redeemCode.deleteMany({ where: { OR: [{ batchId: { in: batchIds } }, { id: { in: codeIds } }] } });
    await db.redeemBatch.deleteMany({ where: { id: { in: batchIds } } });
    await db.$disconnect();
  }
});
