import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { SMTPServer } from "smtp-server";
import { EmailVerificationError, EmailVerificationService } from "../auth/emailVerification.js";

function registrationCodeFromMessage(raw: string) {
  const body = raw.split(/\r?\n\r?\n/, 2)[1];
  return body?.match(/^(\d{6})(?:\r?\n|$)/)?.[1];
}

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;
test("QQ registration: real local TLS SMTP, Redis one-time verification and atomic PostgreSQL signup", { skip: !databaseUrl, timeout: Number(process.env.AIFILM_TEST_EMAIL_TIMEOUT_MS) || 90_000 }, async t => {
  const dbUrl = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(dbUrl.hostname));
  assert.match(dbUrl.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  const redisUrl = new URL(process.env.AIFILM_TEST_REDIS_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(redisUrl.hostname));
  assert.ok(Number(redisUrl.pathname.slice(1)) >= 10);
  const redis = new Redis(redisUrl.toString());
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const root = await mkdtemp(resolve(tmpdir(), "manjiao-qq-registration-"));
  const run = crypto.randomBytes(6).toString("hex");
  assert.equal(registrationCodeFromMessage("To: signup.123456@qq.com\r\nMessage-ID: <654321@test>\r\n\r\n012345\r\n\r\nBody"), "012345");
  assert.equal(registrationCodeFromMessage("Message-ID: <123456@test>\r\n\r\nNo code"), undefined);
  const email = `signup.${run}@qq.com`;
  const phone = `139${crypto.randomInt(0, 100_000_000).toString().padStart(8, "0")}`;
  const key = resolve(root, "test-key.pem"), cert = resolve(root, "test-cert.pem");
  const openssl = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { encoding: "utf8" });
  assert.equal(openssl.status, 0, "Local SMTP fixture requires OpenSSL");
  const deliveries: Array<{ email: string; code: string }> = [];
  let rejectMail = false;
  const smtp = new SMTPServer({
    key: await readFile(key), cert: await readFile(cert), logger: false,
    onAuth(auth, _session, callback) {
      if (auth.username !== "fixture@example.test" || auth.password !== "test-smtp-only") return callback(new Error("Invalid fixture credentials"));
      callback(null, { user: "fixture" });
    },
    onData(stream, session, callback) {
      let raw = "";
      stream.on("data", data => { raw += data; });
      stream.on("end", () => {
        if (rejectMail) return callback(new Error("Isolated SMTP unavailable"));
        const code = registrationCodeFromMessage(raw);
        if (!code) return callback(new Error("No verification code in fixture message"));
        deliveries.push({ email: session.envelope.rcptTo[0]!.address, code });
        callback();
      });
    }
  });
  await new Promise<void>(done => smtp.listen(0, "127.0.0.1", done));
  const smtpPort = (smtp.server.address() as { port: number }).port;
  const apiPort = 41000 + crypto.randomInt(10000);
  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, "src/server.ts"], {
    cwd: resolve(import.meta.dirname, "../.."), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AIFILM_LOAD_ENV_FILES: "false", NODE_ENV: "test", DATABASE_URL: databaseUrl!,
      REDIS_URL: redisUrl.toString(), API_PORT: String(apiPort), API_RATE_LIMIT_MAX: "1000",
      OBJECT_STORAGE_LOCAL_DIR: root, SEED_DEFAULT_USERS: "false", SEED_DEMO_USER: "false", SEED_DEMO_DATA: "false",
      DEEPSEEK_API_KEY: "", WECHAT_PAY_ENABLED: "false", NODE_EXTRA_CA_CERTS: cert,
      REGISTRATION_SMTP_HOST: "localhost", REGISTRATION_SMTP_PORT: String(smtpPort), REGISTRATION_SMTP_SECURE: "false",
      REGISTRATION_SMTP_USER: "fixture@example.test", REGISTRATION_SMTP_PASSWORD: "test-smtp-only" }
  });
  let logs = "";
  child.stdout.on("data", data => { logs = (logs + data).slice(-6000); });
  child.stderr.on("data", data => { logs = (logs + data).slice(-6000); });
  const request = (path: string, body?: unknown, token?: string, method = body ? "POST" : "GET") => fetch(`http://127.0.0.1:${apiPort}${path}`, {
    method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25_000)
  });
  const prefix = `test-registration:${run}:`;
  const service = new EmailVerificationService(redis, async () => undefined, () => true, prefix);
  try {
    let ready = false;
    let readiness: unknown;
    const startupDeadline = Date.now() + (Number(process.env.AIFILM_TEST_EMAIL_STARTUP_MS) || 45_000);
    while (Date.now() < startupDeadline) {
      if (child.exitCode !== null) throw new Error(logs);
      try { const result = await request("/ready"); readiness = await result.json(); ready = result.ok; } catch { /* startup */ }
      if (ready) break;
      await new Promise(done => setTimeout(done, 250));
    }
    assert.ok(ready, JSON.stringify(readiness) + "\n" + logs);
    await t.test("mail delivery, failed guesses, email binding and one successful concurrent signup", async () => {
      assert.equal((await (await request("/api/auth/registration-policy")).json()).mailAvailable, true);
      assert.equal((await request("/api/auth/email/send", { email: "test@example.test" })).status, 400);
      assert.equal((await request("/api/auth/email/send", { email })).status, 200);
      assert.equal(deliveries.length, 1);
      const throttled = await request("/api/auth/email/send", { email });
      assert.equal(throttled.status, 429);
      assert.ok(Number(throttled.headers.get("Retry-After")) > 0);
      assert.equal((await request("/api/auth/email/verify", { email, code: deliveries[0]!.code === "000000" ? "111111" : "000000" })).status, 400);
      const verified = await request("/api/auth/email/verify", { email: email.toUpperCase(), code: deliveries[0]!.code });
      assert.equal(verified.status, 200);
      const { verificationToken } = await verified.json();
      assert.equal((await request("/api/auth/email/verify", { email, code: deliveries[0]!.code })).status, 400);
      const signup = { email, phone, password: "QQ-fixture-password", verificationToken };
      assert.equal((await request("/api/auth/register", { ...signup, email: `other.${run}@qq.com` })).status, 400);
      assert.equal((await request("/api/auth/register", { ...signup, phone: "" })).status, 400);
      const results = await Promise.all(Array.from({ length: 3 }, () => request("/api/auth/register", signup)));
      assert.equal(results.filter(item => item.status === 201).length, 1);
      assert.ok(results.every(item => [201, 400, 409].includes(item.status)));
      const users = await db.user.findMany({ where: { email }, include: { credit: true } });
      assert.equal(users.length, 1);
      assert.equal(users[0]!.phone, phone);
      assert.ok(users[0]!.emailVerifiedAt);
      assert.ok(users[0]!.credit);
      assert.equal(users[0]!.credit!.balance, users[0]!.credit!.totalRecharge);
      assert.equal(users[0]!.credit!.frozenBalance, 0);
      assert.equal((await request("/api/auth/register", { ...signup, phone: "13800000001" })).status, 409);
      for (const account of [email, phone]) assert.equal((await request("/api/auth/login", { account, password: signup.password })).status, 200);
    });
    await t.test("TLS email proof authorizes binding and recovery, while all previous HTTP sessions expire", async () => {
      const signedIn = await (await request("/api/auth/login", { account: email, password: "QQ-fixture-password" })).json();
      assert.equal(signedIn.user.emailVerified, true);
      // A legacy database row must remain unverified until its own mailbox is proven.
      await db.user.update({ where: { email }, data: { emailVerifiedAt: null } });
      assert.equal((await request("/api/auth/profile", { email, currentPassword: "QQ-fixture-password" }, signedIn.token, "PATCH")).status, 400);
      assert.equal((await request("/api/auth/email-binding/send", { email, currentPassword: "QQ-fixture-password" })).status, 401);
      assert.equal((await request("/api/auth/email-binding/send", { email, currentPassword: "QQ-fixture-password" }, signedIn.token)).status, 200);
      const bindingProof = await request("/api/auth/email-binding/verify", { email, currentPassword: "QQ-fixture-password", code: deliveries.at(-1)!.code }, signedIn.token);
      assert.equal(bindingProof.status, 200);
      const { verificationToken } = await bindingProof.json();
      const saved = await request("/api/auth/profile", { email, currentPassword: "QQ-fixture-password", verificationToken }, signedIn.token, "PATCH");
      assert.equal(saved.status, 200); assert.equal((await saved.json()).requiresLogin, true);
      assert.equal((await request("/api/auth/me", undefined, signedIn.token)).status, 401);
      const beforeReset = await (await request("/api/auth/login", { account: email, password: "QQ-fixture-password" })).json();
      assert.equal((await request("/api/auth/recovery/send", { email })).status, 200);
      const recovered = await request("/api/auth/recovery/verify", { email, code: deliveries.at(-1)!.code });
      assert.equal(recovered.status, 200);
      const proof = await recovered.json();
      assert.equal((await request("/api/auth/recovery/reset", { email, verificationToken: proof.verificationToken, newPassword: "Recovered-fixture-password" })).status, 200);
      assert.equal((await request("/api/auth/me", undefined, beforeReset.token)).status, 401);
      assert.equal((await request("/api/auth/login", { account: email, password: "QQ-fixture-password" })).status, 401);
      const next = await (await request("/api/auth/login", { account: email, password: "Recovered-fixture-password" })).json();
      assert.ok(next.token);
      assert.equal((await request("/api/auth/password", { currentPassword: "Recovered-fixture-password", newPassword: "Changed-fixture-password" }, next.token)).status, 200);
      assert.equal((await request("/api/auth/me", undefined, next.token)).status, 401);
      assert.equal(await db.authSession.count({ where: { user: { email }, revokedAt: null } }), 0);
    });
    await t.test("SMTP rejection cannot acknowledge a sent code or permit verification", async () => {
      rejectMail = true;
      const before = deliveries.length;
      const failed = `failed.${run}@qq.com`;
      assert.equal((await request("/api/auth/email/send", { email: failed })).status, 503);
      assert.equal((await request("/api/auth/email/verify", { email: failed, code: "123456" })).status, 400);
      assert.equal(deliveries.length, before);
    });
    await t.test("Redis enforces attempts, expiration, parallel send limits, one-time grants and retries", async () => {
      let code = "";
      const verifying = new EmailVerificationService(redis, async (_email, value) => { code = value; }, () => true, prefix);
      const codeKey = (mail: string) => prefix + "code:" + crypto.createHash("sha256").update(mail).digest("hex");
      const mail = `attempts.${run}@qq.com`;
      const sends = await Promise.allSettled(Array.from({ length: 4 }, () => verifying.send(mail, "fixture-ip")));
      assert.equal(sends.filter(item => item.status === "fulfilled").length, 1);
      for (let i = 0; i < 5; i++) await assert.rejects(verifying.verify(mail, code === "000000" ? "111111" : "000000"), EmailVerificationError);
      await assert.rejects(verifying.verify(mail, code), EmailVerificationError);
      assert.equal(await redis.exists(codeKey(mail)), 0);
      const expired = `expired.${run}@qq.com`;
      await verifying.send(expired, "fixture-ip");
      await redis.pexpire(codeKey(expired), 1);
      await new Promise(done => setTimeout(done, 10));
      await assert.rejects(verifying.verify(expired, code), EmailVerificationError);
      const grantMail = `grant.${run}@qq.com`;
      await verifying.send(grantMail, "fixture-ip");
      const grant = await verifying.verify(grantMail, code);
      await assert.rejects(service.consume(mail, grant.verificationToken), EmailVerificationError);
      const ttl = await service.consume(grantMail, grant.verificationToken);
      await assert.rejects(service.consume(grantMail, grant.verificationToken), EmailVerificationError);
      await service.restore(grantMail, grant.verificationToken, Date.now() + ttl * 1000);
      assert.ok(await service.consume(grantMail, grant.verificationToken) <= ttl);
      await service.restore(grantMail, grant.verificationToken, Date.now() - 1);
      await assert.rejects(service.consume(grantMail, grant.verificationToken), EmailVerificationError);
      const expiredGrantMail = `expired-grant.${run}@qq.com`;
      await verifying.send(expiredGrantMail, "fixture-ip");
      const expiredGrant = await verifying.verify(expiredGrantMail, code);
      await redis.pexpire(prefix + "grant:" + crypto.createHash("sha256").update(expiredGrant.verificationToken).digest("hex"), 1);
      await new Promise(done => setTimeout(done, 10));
      await assert.rejects(service.consume(expiredGrantMail, expiredGrant.verificationToken), EmailVerificationError);
      await redis.set(prefix + "ip-hour:" + crypto.createHash("sha256").update("capped").digest("hex"), "20", "EX", 3600);
      await assert.rejects(service.send(`limited.${run}@qq.com`, "capped"), (error: unknown) => error instanceof EmailVerificationError && error.status === 429);
      const disconnected = new Redis(redisUrl.toString(), { lazyConnect: true, enableOfflineQueue: false });
      disconnected.disconnect();
      await assert.rejects(new EmailVerificationService(disconnected, async () => undefined, () => true).send(mail, "fixture-ip"), (error: unknown) => error instanceof EmailVerificationError && error.status === 503);
      for (const stored of await redis.keys(prefix + "*")) assert.ok(await redis.ttl(stored) > 0, "Registration Redis keys must be bounded by TTL");
    });
  } finally {
    child.kill();
    if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise(done => setTimeout(done, 5000))]);
    await new Promise<void>(done => smtp.close(done));
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
    const keys = (await redis.keys("registration:v1:*")).concat(await redis.keys("email-binding:v1:*"), await redis.keys("password-recovery:v1:*"), await redis.keys(prefix + "*"));
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    await rm(root, { recursive: true, force: true });
  }
});
