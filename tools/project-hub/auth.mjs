import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';

const scrypt = promisify(scryptCallback);
const LIFE_MS = 8 * 60 * 60 * 1000;
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('管理员密码需为 12–1024 字符。');
  const salt = randomBytes(24);
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function constantEqual(a, b) {
  const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}
export function parsePasswordHash(value) {
  const parts = String(value || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '16384' || parts[2] !== '8' || parts[3] !== '1') throw new Error('密码摘要配置格式错误。');
  const salt = Buffer.from(parts[4], 'base64'), hash = Buffer.from(parts[5], 'base64');
  if (salt.length < 16 || hash.length !== 64) throw new Error('密码摘要配置格式错误。');
  return { salt, hash };
}
export function createAuth(config) {
  const parsed = parsePasswordHash(config.passwordHash), sessions = new Map(), attempts = new Map();
  const normalizedAddress = value => typeof value === 'string' && value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  const trustedProxies = new Set((config.trustedProxyAddresses || []).map(normalizedAddress));
  if ([...trustedProxies].some(address => !isIP(address))) throw new Error('受信代理必须是明确的 IPv4 或 IPv6 地址。');
  let inFlight = 0;
  function clientAddress(req) {
    const peer = normalizedAddress(req.socket.remoteAddress || 'unknown');
    if (!trustedProxies.has(peer)) return peer;
    const forwarded = req.headers['x-project-hub-client-ip'];
    if (typeof forwarded !== 'string' || !isIP(forwarded)) throw Object.assign(new Error('代理客户端地址缺失或无效，请联系管理员。'), { status: 403 });
    return normalizedAddress(forwarded);
  }
  const cookieName = 'project_hub_session';
  function getSession(req) {
    const match = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='));
    const key = match?.slice(cookieName.length + 1), session = sessions.get(key);
    if (!session || session.expiresAt < Date.now()) { if (key) sessions.delete(key); return null; }
    return { ...session, key };
  }
  const cookie = (value, expired = false) => `${cookieName}=${value}; Path=/ops/; HttpOnly; SameSite=Strict; Max-Age=${expired ? 0 : LIFE_MS / 1000}${config.publicOrigin.startsWith('https://') ? '; Secure' : ''}`;
  return {
    getSession,
    requireOrigin(req) { if (req.headers.origin !== config.publicOrigin) throw Object.assign(new Error('拒绝跨站请求。'), { status: 403 }); },
    requireCsrf(req, session) { if (!constantEqual(req.headers['x-csrf-token'], session.csrfToken)) throw Object.assign(new Error('会话校验失败，请刷新页面。'), { status: 403 }); },
    async login(req, res, input) {
      const now = Date.now(), key = clientAddress(req);
      for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
      const record = attempts.get(key) || { count: 0, until: now + 15 * 60_000 };
      if (record.count >= 10) throw Object.assign(new Error('此网络地址登录尝试过多，请 15 分钟后重试。'), { status: 429 });
      if (inFlight >= 4) throw Object.assign(new Error('登录服务正忙，请稍后重试。'), { status: 429 });
      record.count++; attempts.set(key, record);
      const password = typeof input.password === 'string' && input.password.length <= 1024 ? input.password : '';
      let hash; inFlight++;
      try { hash = await scrypt(password, parsed.salt, 64, { N: 16384, r: 8, p: 1 }); } finally { inFlight--; }
      if (!timingSafeEqual(hash, parsed.hash) || !constantEqual(input.username, config.username)) throw Object.assign(new Error('账号或密码错误。'), { status: 401 });
      attempts.delete(key);
      const old = getSession(req); if (old) sessions.delete(old.key);
      for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
      if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
      const id = randomBytes(32).toString('hex'), session = { username: config.username, csrfToken: randomBytes(32).toString('hex'), expiresAt: now + LIFE_MS };
      sessions.set(id, session); res.setHeader('Set-Cookie', cookie(id));
      return { authenticated: true, username: session.username, csrfToken: session.csrfToken };
    },
    logout(req, res) { const session = getSession(req); if (session) sessions.delete(session.key); res.setHeader('Set-Cookie', cookie('', true)); return { ok: true }; },
  };
}
