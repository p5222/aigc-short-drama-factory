import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient, type User } from "@prisma/client";
import { Redis } from "ioredis";
import { AccountSecurityService } from "./accountSecurity.js";
import { EmailVerificationError, EmailVerificationService } from "./emailVerification.js";
import { hashPassword, verifyPassword } from "./password.js";
import { resetAdminUserPassword, updateAdminUser } from "../db/repository.js";

const databaseUrl = process.env.AIFILM_TEST_DATABASE_URL;
test("account security binds one-time email proofs to the original PostgreSQL account state", { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  const redisUrl = new URL(process.env.AIFILM_TEST_REDIS_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(redisUrl.hostname)); assert.ok(Number(redisUrl.pathname.slice(1)) >= 10);
  const db = new PrismaClient({ datasourceUrl: databaseUrl }), redis = new Redis(redisUrl.toString());
  const run = crypto.randomBytes(6).toString("hex"), prefix = `account-security-test:${run}:`, ids: string[] = [];
  const passwords = { old: "Original-test-password", next: "New-account-test-password" };
  const hash = await hashPassword(passwords.old), codes = new Map<string, string>();
  const mail = (purpose: string) => new EmailVerificationService(redis, async (email, code) => { codes.set(`${purpose}:${email}`, code); }, () => true, `${prefix}${purpose}:`);
  const binding = mail("binding"), recovery = mail("recovery"), registration = mail("registration");
  const security = new AccountSecurityService(db, binding, recovery);
  async function user(extra: Partial<Pick<User, "role" | "status" | "emailVerifiedAt">> = {}) {
    const id = `account-security-${crypto.randomUUID()}`; ids.push(id);
    return db.user.create({ data: { id, name: "Account fixture", email: `${id}@qq.com`, passwordHash: hash, emailVerifiedAt: new Date(), ...extra } });
  }
  async function grant(row: User) {
    await security.sendRecovery(row.email!, row.id);
    return security.verifyRecovery(row.email!, codes.get(`recovery:${row.email}`)!);
  }
  async function sessions(id: string) {
    await db.authSession.createMany({ data: [0, 1].map(() => ({ id: crypto.randomUUID(), userId: id, tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) })) });
  }
  try {
    await t.test("ordinary recovery sends once, rejects wrong guesses and accepts concurrent reset only once", async () => {
      const row = await user(); await sessions(row.id);
      await security.sendRecovery(row.email!, row.id);
      await assert.rejects(security.sendRecovery(row.email!, row.id), { status: 429 });
      const code = codes.get(`recovery:${row.email}`)!;
      await assert.rejects(security.verifyRecovery(row.email!, code === "000000" ? "111111" : "000000"), { status: 400 });
      const verified = await security.verifyRecovery(row.email!, code);
      const results = await Promise.allSettled([0, 1, 2].map(() => security.resetPassword(row.email!, verified.verificationToken, passwords.next)));
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const saved = await db.user.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(saved.authVersion, 1); assert.ok(await verifyPassword(passwords.next, saved.passwordHash));
      assert.equal(await db.authSession.count({ where: { userId: row.id, revokedAt: null } }), 0);
      await assert.rejects(security.resetPassword(row.email!, verified.verificationToken, passwords.old), EmailVerificationError);
    });
    await t.test("unknown, unverified, disabled and administrator requests have identical send and verify outcomes", async () => {
      const rows = await Promise.all([user({ emailVerifiedAt: null }), user({ status: "disabled" }), user({ role: "admin" })]);
      const emails = [`unknown.${run}@qq.com`, ...rows.map(row => row.email!)];
      const failures: string[] = [];
      for (const email of emails) {
        assert.deepEqual(await security.sendRecovery(email, email), { sent: true, expiresInSeconds: 600, resendAfterSeconds: 60 });
        assert.match(codes.get(`recovery:${email}`)!, /^\d{6}$/);
        await assert.rejects(security.verifyRecovery(email, codes.get(`recovery:${email}`)!), (error: unknown) => {
          assert.ok(error instanceof EmailVerificationError); assert.equal(error.status, 400); failures.push(error.message); return true;
        });
        await assert.rejects(security.resetPassword(email, "a".repeat(64), passwords.next), (error: unknown) => {
          assert.ok(error instanceof EmailVerificationError); assert.equal(error.status, 400); assert.equal(error.message, failures[0]); return true;
        });
      }
      assert.equal(new Set(failures).size, 1);
    });
    await t.test("registration and binding proofs cannot reset passwords or authorize another account", async () => {
      const row = await user(), other = await user();
      await registration.send(row.email!, row.id);
      const registered = await registration.verify(row.email!, codes.get(`registration:${row.email}`)!);
      await assert.rejects(security.resetPassword(row.email!, registered.verificationToken, passwords.next), { status: 400 });
      await security.sendBinding(row.id, row.email!, passwords.old, row.id);
      const code = codes.get(`binding:${row.email}`)!;
      await assert.rejects(security.verifyRecovery(row.email!, code), { status: 400 });
      await assert.rejects(security.verifyBinding(other.id, row.email!, passwords.old, code), { status: 400 });
      const verified = await security.verifyBinding(row.id, row.email!, passwords.old, code);
      await assert.rejects(security.resetPassword(row.email!, verified.verificationToken, passwords.next), { status: 400 });
      await assert.rejects(security.bindEmail(other.id, row.email!, passwords.old, verified.verificationToken), { status: 400 });
    });
    await t.test("legacy users can verify their existing QQ email and every session is revoked", async () => {
      const row = await user({ emailVerifiedAt: null }); await sessions(row.id);
      await assert.rejects(security.sendBinding(row.id, row.email!, "wrong-password", row.id), { status: 400 });
      await security.sendBinding(row.id, row.email!, passwords.old, row.id);
      const verified = await security.verifyBinding(row.id, row.email!, passwords.old, codes.get(`binding:${row.email}`)!);
      const updated = await security.bindEmail(row.id, row.email!, passwords.old, verified.verificationToken);
      assert.ok(updated.emailVerifiedAt); assert.equal(updated.authVersion, 1);
      assert.equal(await db.authSession.count({ where: { userId: row.id, revokedAt: null } }), 0);
    });
    await t.test("codes issued before a password mutation fail even when verification starts afterwards", async () => {
      const row = await user();
      await security.sendRecovery(row.email!, row.id);
      const code = codes.get(`recovery:${row.email}`)!;
      await security.sendBinding(row.id, row.email!, passwords.old, row.id);
      const bindingCode = codes.get(`binding:${row.email}`)!;
      await security.changePassword(row.id, passwords.old, passwords.next);
      await assert.rejects(security.verifyRecovery(row.email!, code), { status: 400 });
      await assert.rejects(security.verifyBinding(row.id, row.email!, passwords.next, bindingCode), { status: 400 });
    });
    await t.test("administrator disable/re-enable, email change and password reset invalidate outstanding grants", async () => {
      const disabled = await user(), emailChanged = await user(), passwordChanged = await user();
      const grants = await Promise.all([disabled, emailChanged, passwordChanged].map(grant));
      await updateAdminUser(disabled.id, { status: "disabled" }); await updateAdminUser(disabled.id, { status: "active" });
      await updateAdminUser(emailChanged.id, { email: `changed.${run}@qq.com` });
      const changed = await db.user.findUniqueOrThrow({ where: { id: emailChanged.id } });
      assert.equal(changed.emailVerifiedAt, null);
      await resetAdminUserPassword(passwordChanged.id, passwords.next);
      for (const [index, row] of [disabled, emailChanged, passwordChanged].entries()) {
        await assert.rejects(security.resetPassword(row.email!, grants[index].verificationToken, passwords.old), EmailVerificationError);
      }
    });
    await t.test("a verified email replacement invalidates the old recovery grant", async () => {
      const row = await user(); const oldGrant = await grant(row);
      const nextEmail = `replacement.${run}@qq.com`;
      await security.sendBinding(row.id, nextEmail, passwords.old, row.id);
      const verified = await security.verifyBinding(row.id, nextEmail, passwords.old, codes.get(`binding:${nextEmail}`)!);
      await security.bindEmail(row.id, nextEmail, passwords.old, verified.verificationToken);
      await assert.rejects(security.resetPassword(row.email!, oldGrant.verificationToken, passwords.next), EmailVerificationError);
      await assert.rejects(security.resetPassword(nextEmail, oldGrant.verificationToken, passwords.next), EmailVerificationError);
    });
    await t.test("parallel old-password changes have one winner and revoke the current session too", async () => {
      const row = await user(); await sessions(row.id);
      const outcomes = await Promise.allSettled([passwords.next, passwords.next + "2"].map(next => security.changePassword(row.id, passwords.old, next)));
      assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: row.id } })).authVersion, 1);
      assert.equal(await db.authSession.count({ where: { userId: row.id, revokedAt: null } }), 0);
    });
    await t.test("failed session revocation rolls back password and restores only the original grant lifetime", async () => {
      const row = await user(); await sessions(row.id);
      const verified = await grant(row);
      const failedDb = db.$extends({ query: { authSession: { updateMany() { throw new Error("Isolated transaction failure"); } } } }) as unknown as PrismaClient;
      await assert.rejects(new AccountSecurityService(failedDb, binding, recovery).resetPassword(row.email!, verified.verificationToken, passwords.next), { status: 503 });
      const unchanged = await db.user.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(unchanged.passwordHash, hash); assert.equal(unchanged.authVersion, 0);
      assert.equal(await db.authSession.count({ where: { userId: row.id, revokedAt: null } }), 2);
      await security.resetPassword(row.email!, verified.verificationToken, passwords.next);
      assert.equal(await db.authSession.count({ where: { userId: row.id, revokedAt: null } }), 0);
    });
    await t.test("every stored email secret expires and plaintext codes and password hashes are absent", async () => {
      for (const key of await redis.keys(prefix + "*")) {
        assert.ok(await redis.ttl(key) > 0);
        const value = await redis.get(key);
        assert.ok(!value?.includes(hash));
        if (key.includes(":code:")) for (const code of codes.values()) assert.ok(!value?.includes(`"${code}"`));
      }
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect();
    const keys = await redis.keys(prefix + "*"); if (keys.length) await redis.del(...keys); await redis.quit();
  }
});
