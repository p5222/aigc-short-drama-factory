import type { RequestHandler } from "express";

export function positiveInteger(raw: string | undefined, fallback: number, max: number): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= max ? value : fallback;
}

/** A bounded, process-local limiter. Expired identities cannot accumulate forever;
 * capacity exhaustion rejects new identities instead of evicting an active limit. */
export class RequestRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(readonly windowMs: number, readonly capacity = 10_000) {}
  get size() { return this.buckets.size; }

  sweep(now = Date.now()) {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }

  consume(key: string, max: number, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    let bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= now) {
      this.buckets.delete(key);
      bucket = undefined;
    }
    if (!bucket) {
      if (this.buckets.size >= this.capacity) this.sweep(now);
      if (this.buckets.size >= this.capacity) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(this.windowMs / 1000)) };
      }
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count = Math.min(bucket.count + 1, max + 1);
    return {
      allowed: bucket.count <= max,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }
}

export function createRateLimitMiddleware(limiter: RequestRateLimiter, max: number): RequestHandler {
  return (req, res, next) => {
    if (req.path === "/health" || req.path === "/ready") return next();
    const authentication = req.path.startsWith("/api/auth/") && !["GET", "HEAD", "OPTIONS"].includes(req.method);
    const result = limiter.consume(`${req.ip ?? "unknown"}:${authentication ? "auth" : "api"}`, authentication ? Math.min(max, 30) : max);
    if (result.allowed) return next();
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    res.setHeader("Cache-Control", "no-store");
    res.status(429).json({ message: `请求过于频繁，请在 ${result.retryAfterSeconds} 秒后重试。` });
  };
}
