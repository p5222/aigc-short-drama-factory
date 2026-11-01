import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.AIFILM_TEST_DATABASE_URL;
test("PostgreSQL configuration versions, secret overrides, defaults and pending payment protection", { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  process.env.DATABASE_URL = databaseUrl;
  process.env.PLATFORM_SETTINGS_KEY = "91".repeat(32);
  process.env.REGISTRATION_SMTP_PASSWORD = "fixture-server-mail-password";
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const settings = await import("./platformSettings.js");
  const rollback = new Error("intentional fixture rollback");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  try {
    // All mutations run in a real transaction that is rolled back. Other suites
    // never observe temporary platform defaults or payment/mail credentials.
    await assert.rejects(db.$transaction(async tx => {
      const fixtureDb = { $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as PrismaClient;
      const write = (group: "routing" | "email" | "payment", input: Parameters<typeof settings.updatePlatformSettings>[1]) =>
        settings.updatePlatformSettings(group, input, "configuration-test", fixtureDb);
      await t.test("secret replacement encrypts at rest, is never returned, and restores environment explicitly", async () => {
        const original = await settings.readPlatformSettings("email", tx);
        const saved = await write("email", { expectedVersion: original.version, values: { password: "fixture-database-secret", user: "sender@qq.com" } });
        assert.equal(saved.version, original.version + 1); assert.equal(saved.secrets.password, true);
        assert.equal(saved.sources.password, "database"); assert.equal("password" in saved.values, false);
        assert.equal(JSON.stringify(saved).includes("fixture-database-secret"), false);
        const row = await tx.platformSetting.findUniqueOrThrow({ where: { key: "email" } });
        assert.equal(JSON.stringify(row).includes("fixture-database-secret"), false);
        assert.match(String((row.values as Record<string, unknown>).password), /^enc:v1:/);
        assert.equal((await settings.settingsEnvironment("email", tx)).REGISTRATION_SMTP_PASSWORD, "fixture-database-secret");
        await assert.rejects(write("email", { expectedVersion: original.version, values: { host: "other.invalid" } }), error => error instanceof settings.SettingsError && error.status === 409);
        const preserved = await write("email", { expectedVersion: saved.version, values: { port: 587, secure: false } });
        assert.equal((await settings.effectiveSettings("email", tx)).password, "fixture-database-secret");
        const restored = await write("email", { expectedVersion: preserved.version, values: { password: null } });
        assert.equal(restored.sources.password, "environment");
        assert.equal((await settings.effectiveSettings("email", tx)).password, "fixture-server-mail-password");
        await assert.rejects(write("email", { expectedVersion: restored.version, values: { password: "" } }), /密钥留空/);
        await assert.rejects(write("email", { expectedVersion: restored.version, values: { port: 0 } }), /端口/);
        await assert.rejects(write("email", { expectedVersion: restored.version, values: { arbitraryEnv: "not-allowed" } }), /未知/);
      });
      await t.test("new defaults honor selected models and cannot override explicit author routes", async () => {
        const id = `config_text_${crypto.randomUUID()}`;
        await tx.modelProvider.create({ data: { id, name: "Configuration test", modality: "text", enabled: true, models: ["model-a", "model-b"],
          capability: { connection: { protocol: "openai-chat" }, routing: { preferredModel: "model-b" } }, costHint: "fixture" } });
        const original = await settings.readPlatformSettings("routing", tx);
        // TTS is intentionally empty in this isolated fixture.
        await write("routing", { expectedVersion: original.version, values: { textProvider: id, imageProvider: "", videoProvider: "", ttsProvider: "" } });
        const picked = await settings.applyDefaultModelRoutes({} as { textProvider?: string; textModel?: string }, tx);
        assert.equal(picked.textProvider, id); assert.equal(picked.textModel, "model-b");
        assert.deepEqual(await settings.applyDefaultModelRoutes({ textProvider: "author-locked", textModel: "author-model" }, tx),
          { textProvider: "author-locked", textModel: "author-model" });
        const current = await settings.readPlatformSettings("routing", tx);
        await assert.rejects(write("routing", { expectedVersion: current.version, values: { videoProvider: id } }), /镜头视频/);
      });
      await t.test("pausing new sales retains callback verification and pending orders block credential changes", async () => {
        const original = await settings.readPlatformSettings("payment", tx);
        const saved = await write("payment", { expectedVersion: original.version, values: {
          enabled: true, appId: "wxfixture", merchantId: "1234567890", serial: "ABC123", privateKey, apiV3Key: "a".repeat(32),
          publicKeys: JSON.stringify({ PUB_KEY_ID_TEST: publicKey }), notifyUrl: "https://fixture.invalid/api/billing/wechat/notify"
        } });
        assert.ok(await settings.effectiveWechatConfig(true, tx));
        const userId = `config_user_${crypto.randomUUID()}`;
        await tx.user.create({ data: { id: userId, name: "Configuration fixture" } });
        await tx.rechargeOrder.create({ data: { id: crypto.randomBytes(16).toString("hex"), userId, planId: "fixture", planName: "Fixture",
          amountCny: 1, amountFen: 100, credits: 1, channel: "wechat", status: "pending" } });
        await assert.rejects(write("payment", { expectedVersion: saved.version, values: { merchantId: "9876543210" } }), /待确认微信订单/);
        const paused = await write("payment", { expectedVersion: saved.version, values: { enabled: false } });
        assert.equal(paused.values.enabled, false);
        assert.equal(await settings.effectiveWechatConfig(true, tx), null);
        assert.equal((await settings.effectiveWechatConfig(false, tx))?.merchantId, "1234567890");
        assert.equal(JSON.stringify(paused).includes(privateKey), false);
      });
      throw rollback;
    }, { timeout: 40000 }), error => error === rollback);
  } finally { await db.$disconnect(); }
});
