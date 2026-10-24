import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { decryptWechatNotification, moneyFen, parseWechatTransaction, verifyWechat, WechatPay, wechatConfig, type WechatConfig } from "./wechat.js";
import { discountedCredits, nextMembershipMonth } from "./membership.js";

const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const config: WechatConfig = { appId: "wx-test", merchantId: "1234567890", serial: "ABCD", privateKey,
  apiV3Key: "12345678901234567890123456789012", publicKeys: { PUB_KEY_ID_test: publicKey },
  notifyUrl: "https://example.test/api/billing/wechat/notify" };
const transaction = { appid: config.appId, mchid: config.merchantId, out_trade_no: "abc123", trade_type: "NATIVE",
  trade_state: "SUCCESS", transaction_id: "real-trade-fixture", amount: { total: 3990, currency: "CNY" }, success_time: new Date().toISOString() };
function headers(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const nonce = "signed-fixture-nonce";
  return new Headers({ "wechatpay-timestamp": timestamp, "wechatpay-nonce": nonce, "wechatpay-serial": "PUB_KEY_ID_test",
    "wechatpay-signature": crypto.sign("RSA-SHA256", Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), privateKey).toString("base64") });
}
function notification() {
  const nonce = "123456789012", aad = "transaction";
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(config.apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(transaction)), cipher.final(), cipher.getAuthTag()]);
  return JSON.stringify({ id: "event-fixture", event_type: "TRANSACTION.SUCCESS", resource_type: "encrypt-resource",
    resource: { algorithm: "AEAD_AES_256_GCM", original_type: "transaction", nonce, associated_data: aad, ciphertext: encrypted.toString("base64") } });
}

test("WeChat signed raw body + AES-GCM notification roundtrip rejects tampering", () => {
  const body = notification();
  assert.deepEqual(decryptWechatNotification(body, headers(body), config), transaction);
  assert.throws(() => decryptWechatNotification(`${body}\n`, headers(body), config), /签名/);
  assert.throws(() => decryptWechatNotification(body, headers(body), { ...config, apiV3Key: "z".repeat(32) }));
  const modified = JSON.parse(body); modified.resource.associated_data = "bad";
  const changed = JSON.stringify(modified);
  assert.throws(() => decryptWechatNotification(changed, headers(changed), config));
});
test("WeChat rejects replay, unknown serial and signature probe", () => {
  const body = "{}";
  assert.throws(() => verifyWechat(body, headers(body, String(Math.floor(Date.now() / 1000) - 301)), config), /签名/);
  const unknown = headers(body); unknown.set("wechatpay-serial", "attacker");
  assert.throws(() => verifyWechat(body, unknown, config), /签名/);
  const probe = headers(body); probe.set("wechatpay-signature", "WECHATPAY/SIGNTEST/fake");
  assert.throws(() => verifyWechat(body, probe, config), /签名/);
});
test("WeChat binds successful payment to merchant, app, currency and native transaction", () => {
  for (const change of [{ mchid: "wrong" }, { appid: "wrong" }, { trade_type: "JSAPI" }, { transaction_id: undefined },
    { amount: { total: 3990.1, currency: "CNY" } }, { amount: { total: 3990, currency: "USD" } }, { success_time: "bad" }]) {
    assert.throws(() => parseWechatTransaction({ ...transaction, ...change }, config));
  }
});
test("merchant request signing covers exact method, URL, body and response verification", async () => {
  const pay = new WechatPay(config, async (url, init) => {
    assert.equal(url, "https://api.mch.weixin.qq.com/v3/pay/transactions/native");
    const authorization = new Headers(init?.headers).get("authorization")!;
    const values = Object.fromEntries([...authorization.matchAll(/(\w+)="([^"]+)"/g)].map(match => [match[1], match[2]]));
    assert.ok(crypto.verify("RSA-SHA256", Buffer.from(`POST\n/v3/pay/transactions/native\n${values.timestamp}\n${values.nonce_str}\n${init!.body}\n`),
      publicKey, Buffer.from(values.signature!, "base64")));
    const input = JSON.parse(init!.body as string);
    assert.equal(input.amount.total, 3990); assert.equal(input.notify_url, config.notifyUrl);
    const body = JSON.stringify({ code_url: "weixin://wxpay/bizpayurl?pr=fixture" });
    return new Response(body, { headers: headers(body) });
  });
  assert.match(await pay.create({ id: "abc123", planName: "Month", amountFen: 3990, expiresAt: new Date(Date.now() + 600_000) }), /^weixin:/);
  const invalid = new WechatPay(config, async () => new Response('{"code_url":"weixin://wxpay/fake"}'));
  await assert.rejects(invalid.create({ id: "abc123", planName: "Month", amountFen: 3990, expiresAt: new Date() }), /签名/);
});
test("verified order query still rejects a mismatched merchant order", async () => {
  const body = JSON.stringify(transaction);
  const pay = new WechatPay(config, async () => new Response(body, { headers: headers(body) }));
  await assert.rejects(pay.query("different"), /订单号/);
});
test("payment configuration fails closed and accepts provisioned RSA keys", () => {
  assert.equal(wechatConfig({}), null);
  assert.throws(() => wechatConfig({ WECHAT_PAY_ENABLED: "true" }), /不完整/);
  const env = { WECHAT_PAY_ENABLED: "true", WECHAT_PAY_APP_ID: config.appId, WECHAT_PAY_MCH_ID: config.merchantId,
    WECHAT_PAY_SERIAL: config.serial, WECHAT_PAY_PRIVATE_KEY: privateKey, WECHAT_PAY_API_V3_KEY: config.apiV3Key,
    WECHAT_PAY_PUBLIC_KEYS_JSON: JSON.stringify(config.publicKeys), WECHAT_PAY_NOTIFY_URL: config.notifyUrl };
  assert.ok(wechatConfig(env));
  assert.throws(() => wechatConfig({ ...env, WECHAT_PAY_NOTIFY_URL: "http://example.test/api/billing/wechat/notify" }), /配置校验/);
});
test("money conversion rejects sub-cent, nonfinite and negative prices", () => {
  assert.equal(moneyFen(39.9), 3990); assert.equal(moneyFen(0.01), 1);
  for (const value of [0, -1, NaN, Infinity, 0.001, 10.999, 1_000_001]) assert.throws(() => moneyFen(value));
});
test("membership calendar clamps month ends and settlement rounds up", () => {
  assert.equal(nextMembershipMonth(new Date("2028-01-31T12:00:00Z")).toISOString(), "2028-02-29T12:00:00.000Z");
  assert.equal(nextMembershipMonth(new Date("2026-12-31T12:00:00Z")).toISOString(), "2027-01-31T12:00:00.000Z");
  assert.equal(discountedCredits(31, 10), 28); assert.equal(discountedCredits(31, 100), 0);
  assert.throws(() => discountedCredits(31, 101));
});
