import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createRateLimitMiddleware, positiveInteger, RequestRateLimiter } from "./rateLimit.js";

test("rate limit releases expired IPs, keeps active limits and bounds hostile identity churn", () => {
  const limiter = new RequestRateLimiter(1000, 2);
  assert.equal(limiter.consume("first", 2, 0).allowed, true);
  assert.equal(limiter.consume("first", 2, 1).allowed, true);
  assert.deepEqual(limiter.consume("first", 2, 2), { allowed: false, retryAfterSeconds: 1 });
  assert.equal(limiter.consume("second", 2, 10).allowed, true);
  for (let i = 0; i < 5000; i++) assert.equal(limiter.consume(`attacker-${i}`, 2, 20).allowed, false);
  assert.equal(limiter.size, 2);
  assert.equal(limiter.consume("first", 2, 30).allowed, false);
  assert.equal(limiter.consume("new", 2, 1000).allowed, true);
  assert.equal(limiter.size, 2);
  limiter.sweep(2001);
  assert.equal(limiter.size, 0);
});

test("invalid limits cannot disable protection or prevent every legitimate request", () => {
  for (const value of ["", "0", "-1", "NaN", "Infinity", "1.5", "999999"]) {
    assert.equal(positiveInteger(value, 180, 100_000), 180);
  }
  assert.equal(positiveInteger("300", 180, 100_000), 300);
});

test("real HTTP throttling precedes request parsing, sends retry time and keeps readiness available", async () => {
  const app = express();
  app.use(createRateLimitMiddleware(new RequestRateLimiter(60_000, 100), 2));
  app.use(express.json());
  app.all("/{*path}", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/items`)).status, 200);
    assert.equal((await fetch(`${base}/api/auth/me`)).status, 200);
    const denied = await fetch(`${base}/api/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{invalid" });
    assert.equal(denied.status, 429);
    assert.match(denied.headers.get("retry-after") ?? "", /^[1-9]\d*$/);
    assert.equal(denied.headers.get("cache-control"), "no-store");
    assert.match((await denied.json() as { message: string }).message, /秒后重试/);
    // Reading the current user must not exhaust the separate sign-in budget.
    assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST" })).status, 200);
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
