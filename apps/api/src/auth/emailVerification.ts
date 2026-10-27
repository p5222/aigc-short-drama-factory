import crypto from "node:crypto";
import nodemailer from "nodemailer";
import type { Redis } from "ioredis";

export const QQ_EMAIL_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?@qq\.com$/i;
const CODE_TTL = 600;
const GRANT_TTL = 600;
const COOLDOWN = 60;
const MAX_ATTEMPTS = 5;
const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export class EmailVerificationError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

export function registrationMailConfig(env: NodeJS.ProcessEnv = process.env) {
  const user = env.REGISTRATION_SMTP_USER?.trim();
  const pass = env.REGISTRATION_SMTP_PASSWORD;
  const host = env.REGISTRATION_SMTP_HOST?.trim() || "smtp.qq.com";
  const port = Number(env.REGISTRATION_SMTP_PORT || 465);
  const secure = env.REGISTRATION_SMTP_SECURE !== "false";
  if (!user || !pass || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, secure, auth: { user, pass } };
}

export async function sendRegistrationEmail(email: string, code: string) {
  const config = registrationMailConfig();
  if (!config) throw new EmailVerificationError(503, "邮箱验证服务暂未开通，请稍后再试或联系平台管理员。");
  const transport = nodemailer.createTransport({
    ...config, pool: false, requireTLS: !config.secure,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true }
  });
  try {
    const result = await transport.sendMail({
      from: { name: "漫角", address: config.auth.user }, to: email,
      subject: "漫角注册邮箱验证码",
      textEncoding: "quoted-printable",
      text: `${code}\n\n以上是你的漫角注册验证码，10 分钟内有效，用于验证 QQ 邮箱。\n如非本人操作，请忽略此邮件。请勿向他人透露验证码。`
    });
    if (!result.accepted.some((recipient: string | { address: string }) => (typeof recipient === "string" ? recipient : recipient.address).toLowerCase() === email)) {
      throw new Error("Recipient not accepted");
    }
  } catch {
    throw new EmailVerificationError(503, "验证码邮件发送失败，请稍后重试或联系平台管理员。");
  } finally { transport.close(); }
}

// All counters, codes and grants expire. Lua makes parallel requests share limits and
// ensures a code/grant can succeed only once, including across multiple API replicas.
const RESERVE_SEND = `
if redis.call('EXISTS', KEYS[1]) == 1 then return math.max(1, redis.call('TTL', KEYS[1])) end
for i = 2, 4 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then
    return math.max(1, redis.call('TTL', KEYS[i]))
  end
end
redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])
for i = 2, 4 do
  local n = redis.call('INCR', KEYS[i])
  if n == 1 then redis.call('EXPIRE', KEYS[i], 3600) end
end
redis.call('SET', KEYS[5], ARGV[5], 'EX', ARGV[6])
return 0`;

const VERIFY = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local item = cjson.decode(raw)
if item.pending then return 0 end
if item.hash ~= ARGV[1] then
  item.attempts = item.attempts + 1
  if item.attempts >= tonumber(ARGV[2]) then redis.call('DEL', KEYS[1])
  else redis.call('SET', KEYS[1], cjson.encode(item), 'KEEPTTL') end
  return -1
end
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
redis.call('DEL', KEYS[1])
return 1`;

export class EmailVerificationService {
  constructor(
    private redis: Redis,
    private sendMail = sendRegistrationEmail,
    private mailAvailable = () => Boolean(registrationMailConfig()),
    private prefix = "registration:v1:"
  ) {}

  policy() {
    return { emailDomain: "qq.com" as const, phoneRequired: true as const, smsRequired: false as const,
      emailVerificationRequired: true as const, mailAvailable: this.mailAvailable(), codeTtlSeconds: CODE_TTL, resendAfterSeconds: COOLDOWN };
  }

  private async operation<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) {
      if (error instanceof EmailVerificationError) throw error;
      throw new EmailVerificationError(503, "邮箱验证服务暂时不可用，请稍后重试。");
    }
  }

  async send(email: string, ip: string) {
    if (!QQ_EMAIL_PATTERN.test(email)) throw new EmailVerificationError(400, "请使用 qq.com 邮箱注册。");
    if (!this.mailAvailable()) throw new EmailVerificationError(503, "邮箱验证服务暂未开通，请稍后再试或联系平台管理员。");
    return this.operation(async () => {
      const codeKey = this.prefix + "code:" + digest(email);
      const nonce = crypto.randomBytes(24).toString("hex");
      const pending = JSON.stringify({ pending: nonce });
      const delay = Number(await this.redis.eval(RESERVE_SEND, 5,
        this.prefix + "cooldown:" + digest(email), this.prefix + "email-hour:" + digest(email),
        this.prefix + "ip-hour:" + digest(ip), this.prefix + "global-hour", codeKey,
        COOLDOWN, 5, 20, 200, pending, CODE_TTL));
      if (delay > 0) throw new EmailVerificationError(429, `发送过于频繁，请在 ${delay} 秒后重试。`, delay);
      const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
      try {
        await this.sendMail(email, code);
        const published = Number(await this.redis.eval(`
          if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
          redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
          return 1`, 1, codeKey, pending, JSON.stringify({ salt: nonce, hash: digest(nonce + code), attempts: 0 }), CODE_TTL));
        if (!published) throw new EmailVerificationError(503, "验证码已失效，请重新发送。");
      } catch (error) {
        await this.redis.eval(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`, 1, codeKey, pending).catch(() => undefined);
        if (error instanceof EmailVerificationError) throw error;
        throw new EmailVerificationError(503, "验证码邮件发送失败，请稍后重试。");
      }
      return { sent: true as const, expiresInSeconds: CODE_TTL, resendAfterSeconds: COOLDOWN };
    });
  }

  async verify(email: string, code: string) {
    return this.operation(async () => {
      if (!QQ_EMAIL_PATTERN.test(email) || !/^\d{6}$/.test(code)) throw new EmailVerificationError(400, "请输入 QQ 邮箱和 6 位邮箱验证码。");
      const key = this.prefix + "code:" + digest(email);
      const raw = await this.redis.get(key);
      const item = raw ? JSON.parse(raw) as { salt?: string } : null;
      const token = crypto.randomBytes(32).toString("hex");
      const result = Number(await this.redis.eval(VERIFY, 2, key, this.prefix + "grant:" + digest(token),
        digest((item?.salt || "") + code), MAX_ATTEMPTS, email, GRANT_TTL));
      if (result !== 1) throw new EmailVerificationError(400, result === -1 ? "邮箱验证码不正确；连续错误 5 次后需重新发送。" : "邮箱验证码已失效，请重新发送。");
      return { verificationToken: token, expiresInSeconds: GRANT_TTL };
    });
  }

  async consume(email: string, token: string) {
    return this.operation(async () => {
      if (!/^[a-f0-9]{64}$/.test(token)) throw new EmailVerificationError(400, "请先验证 QQ 邮箱后再注册。");
      const key = this.prefix + "grant:" + digest(token);
      const ttl = Number(await this.redis.eval(`
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
        local ttl = redis.call('TTL', KEYS[1])
        redis.call('DEL', KEYS[1])
        return ttl`, 1, key, email));
      if (ttl <= 0) throw new EmailVerificationError(400, "邮箱验证已失效或已使用，请重新验证邮箱。");
      return ttl;
    });
  }

  // A rejected DB transaction may retry with the same grant, without extending validity.
  async restore(email: string, token: string, expiresAt: number) {
    const ttl = Math.floor((expiresAt - Date.now()) / 1000);
    if (ttl > 0) await this.redis.set(this.prefix + "grant:" + digest(token), email, "EX", ttl, "NX").catch(() => undefined);
  }
}
