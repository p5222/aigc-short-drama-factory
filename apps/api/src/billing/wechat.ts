import crypto from "node:crypto";
import { z } from "zod";

export class PaymentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type WechatConfig = {
  appId: string; merchantId: string; serial: string; privateKey: string;
  apiV3Key: string; publicKeys: Record<string, string>; notifyUrl: string;
};
const pem = (value: string) => value.replace(/\\n/g, "\n");

/** Public-key mode: provision trusted keys out of band; never trust a callback's key URL. */
export function wechatConfig(env: NodeJS.ProcessEnv = process.env): WechatConfig | null {
  if (env.WECHAT_PAY_ENABLED !== "true") return null;
  const required = ["WECHAT_PAY_APP_ID", "WECHAT_PAY_MCH_ID", "WECHAT_PAY_SERIAL",
    "WECHAT_PAY_PRIVATE_KEY", "WECHAT_PAY_API_V3_KEY", "WECHAT_PAY_PUBLIC_KEYS_JSON", "WECHAT_PAY_NOTIFY_URL"];
  if (required.some(key => !env[key]?.trim())) throw new PaymentError(503, "微信支付配置不完整，请联系平台支持。");
  try {
    const publicKeys = z.record(z.string().min(1), z.string().min(1)).parse(JSON.parse(env.WECHAT_PAY_PUBLIC_KEYS_JSON!));
    if (!Object.keys(publicKeys).length) throw new Error("Missing verification keys");
    for (const id of Object.keys(publicKeys)) {
      publicKeys[id] = pem(publicKeys[id]!);
      const key = crypto.createPublicKey(publicKeys[id]!);
      if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error("Invalid public key");
    }
    const privateKey = pem(env.WECHAT_PAY_PRIVATE_KEY!);
    const key = crypto.createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error("Invalid private key");
    if (Buffer.byteLength(env.WECHAT_PAY_API_V3_KEY!) !== 32) throw new Error("Invalid API key");
    const url = new URL(env.WECHAT_PAY_NOTIFY_URL!);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        url.pathname !== "/api/billing/wechat/notify") throw new Error("Invalid callback URL");
    if (!/^\d+$/.test(env.WECHAT_PAY_MCH_ID!) || !/^[A-Za-z0-9]+$/.test(env.WECHAT_PAY_SERIAL!)) throw new Error("Invalid merchant identity");
    return { appId: env.WECHAT_PAY_APP_ID!, merchantId: env.WECHAT_PAY_MCH_ID!, serial: env.WECHAT_PAY_SERIAL!,
      privateKey, apiV3Key: env.WECHAT_PAY_API_V3_KEY!, publicKeys, notifyUrl: url.href };
  } catch {
    throw new PaymentError(503, "微信支付配置校验失败，请联系平台支持。");
  }
}

export function moneyFen(value: number) {
  const fen = Math.round(value * 100);
  if (!Number.isFinite(value) || !Number.isSafeInteger(fen) || fen <= 0 || fen > 100_000_000 ||
      Math.abs(value * 100 - fen) > 0.000001) throw new PaymentError(400, "支付金额必须为有效的人民币分金额。");
  return fen;
}

export function verifyWechat(body: string, headers: Headers, config: WechatConfig, now = Date.now()) {
  const timestamp = headers.get("wechatpay-timestamp") ?? "";
  const nonce = headers.get("wechatpay-nonce") ?? "";
  const serial = headers.get("wechatpay-serial") ?? "";
  const signature = headers.get("wechatpay-signature") ?? "";
  const key = config.publicKeys[serial];
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 ||
      !nonce || nonce.length > 256 || !key || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature) ||
      !crypto.verify("RSA-SHA256", Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), key, Buffer.from(signature, "base64"))) {
    throw new PaymentError(401, "微信支付签名校验失败。");
  }
}

const transactionSchema = z.object({
  appid: z.string(), mchid: z.string(), out_trade_no: z.string().min(6).max(32),
  trade_state: z.enum(["SUCCESS", "REFUND", "NOTPAY", "CLOSED", "REVOKED", "USERPAYING", "PAYERROR"]),
  trade_type: z.string().optional(), transaction_id: z.string().min(1).max(64).optional(),
  success_time: z.string().optional(),
  amount: z.object({ total: z.number().int().positive(), currency: z.literal("CNY") }).optional()
});
export type WechatTransaction = z.infer<typeof transactionSchema>;
export function parseWechatTransaction(value: unknown, config: WechatConfig): WechatTransaction {
  const parsed = transactionSchema.safeParse(value);
  if (!parsed.success || parsed.data.appid !== config.appId || parsed.data.mchid !== config.merchantId)
    throw new PaymentError(400, "微信支付商户或交易信息不匹配。");
  const data = parsed.data;
  if (data.trade_state === "SUCCESS" && (!data.transaction_id || !data.amount || data.trade_type !== "NATIVE" ||
      !data.success_time || !Number.isFinite(Date.parse(data.success_time)) || Date.parse(data.success_time) > Date.now() + 300_000))
    throw new PaymentError(400, "微信支付成功凭证不完整。");
  return data;
}

export function decryptWechatNotification(body: string, headers: Headers, config: WechatConfig) {
  verifyWechat(body, headers, config);
  const notice = z.object({
    id: z.string().min(1), event_type: z.literal("TRANSACTION.SUCCESS"), resource_type: z.literal("encrypt-resource"),
    resource: z.object({ algorithm: z.literal("AEAD_AES_256_GCM"), original_type: z.literal("transaction"),
      nonce: z.string(), associated_data: z.string().optional(), ciphertext: z.string().min(24) })
  }).parse(JSON.parse(body));
  const encrypted = Buffer.from(notice.resource.ciphertext, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(config.apiV3Key), Buffer.from(notice.resource.nonce));
  decipher.setAuthTag(encrypted.subarray(-16));
  decipher.setAAD(Buffer.from(notice.resource.associated_data ?? ""));
  const value = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString("utf8"));
  const transaction = parseWechatTransaction(value, config);
  if (transaction.trade_state !== "SUCCESS") throw new PaymentError(400, "回调支付状态不匹配。");
  return transaction;
}

export class WechatPay {
  constructor(public config: WechatConfig, private transport: typeof fetch = fetch) {}

  async request(method: string, path: string, value?: unknown): Promise<unknown> {
    const body = value === undefined ? "" : JSON.stringify(value);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString("hex");
    const signature = crypto.sign("RSA-SHA256", Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`), this.config.privateKey).toString("base64");
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${this.config.serial}",signature="${signature}"`;
    const response = await this.transport(`https://api.mch.weixin.qq.com${path}`, {
      method, body: body || undefined, redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: authorization, Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Manjiao-Pay/1" }
    });
    const text = await response.text();
    verifyWechat(text, response.headers, this.config);
    if (!response.ok) {
      // Do not surface upstream body (which can contain merchant data) to customers.
      const code = z.object({ code: z.string() }).safeParse(JSON.parse(text));
      if (response.status === 404 && code.success && code.data.code === "ORDER_NOT_EXIST") return null;
      throw new PaymentError(502, "微信支付暂未确认，请稍后刷新订单，勿重复付款。");
    }
    return text ? JSON.parse(text) : {};
  }

  async create(order: { id: string; planName: string; amountFen: number; expiresAt: Date }) {
    const data = await this.request("POST", "/v3/pay/transactions/native", {
      appid: this.config.appId, mchid: this.config.merchantId, description: `漫角-${order.planName}`.slice(0, 100),
      out_trade_no: order.id, notify_url: this.config.notifyUrl, time_expire: order.expiresAt.toISOString(),
      amount: { total: order.amountFen, currency: "CNY" }
    });
    return z.object({ code_url: z.string().max(512).startsWith("weixin://wxpay/") }).parse(data).code_url;
  }

  async query(id: string) {
    const data = await this.request("GET", `/v3/pay/transactions/out-trade-no/${encodeURIComponent(id)}?mchid=${encodeURIComponent(this.config.merchantId)}`);
    if (data === null) return null;
    const transaction = parseWechatTransaction(data, this.config);
    if (transaction.out_trade_no !== id) throw new PaymentError(400, "微信支付订单号不匹配。");
    return transaction;
  }

  async close(id: string) {
    await this.request("POST", `/v3/pay/transactions/out-trade-no/${encodeURIComponent(id)}/close`, { mchid: this.config.merchantId });
  }
}
