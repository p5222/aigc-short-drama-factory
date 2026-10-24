import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
const require = createRequire("/app/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");
const { Queue, Worker } = require("bullmq");
const db = new PrismaClient();
const base = process.env.DR_BASE_URL || "http://" + process.env.HOSTNAME.replace(/-api$/, "-nginx");
const reports = [];
const connection = { host: "redis", maxRetriesPerRequest: null };
const queue = new Queue("generation", { connection });
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "postgres"); assert.equal(url.pathname, "/audit_api_full_dr");
async function request(path, token, extra = {}) {
  return fetch(base + path, { signal: AbortSignal.timeout(5000), ...extra,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra.headers } });
}
async function finance() {
  return db.$queryRawUnsafe(`SELECT json_build_object(
    'projects',(SELECT count(*) FROM "Project"),
    'tasks',(SELECT count(*) FROM "GenerationTask"),
    'ledger',(SELECT count(*) FROM "CreditTransaction"),
    'orders',(SELECT count(*) FROM "RechargeOrder"),
    'balance',(SELECT COALESCE(sum(balance),0) FROM "CreditAccount"),
    'frozen',(SELECT COALESCE(sum("frozenBalance"),0) FROM "CreditAccount")) AS snapshot`);
}
const before = await finance();
try {
  for (let i = 0; i < 90; i++) {
    try { if ((await request("/ready")).ok) break; } catch {}
    if (i === 89) throw new Error("Restored API did not become ready");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const ready = await (await request("/ready")).json();
  assert.equal(ready.ok, true); assert.equal(ready.revision, process.env.DR_REVISION);
  assert.ok(Object.values(ready.checks).every(Boolean));
  assert.ok(await queue.isPaused(), "Production queue must remain paused throughout the drill");
  const html = await (await request("/")).text();
  const localHtml = await fs.readFile("/app/apps/web/dist/index.html", "utf8");
  assert.equal(html, localHtml);
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]))];
  for (const asset of assets) {
    const response = await request(asset); assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, await fs.readFile("/app/apps/web/dist" + asset));
  }
  assert.equal((await request("/api/credits/account")).status, 401);
  await assert.rejects(fetch("https://api.mch.weixin.qq.com/", { signal: AbortSignal.timeout(1500) }));
  reports.push({ check: "restored-runtime", revision: ready.revision, jsCssAssets: assets.length,
    redisSnapshotKeys: Number(process.env.DR_REDIS_KEYS), productionQueuePaused: true, externalNetworkBlocked: true });

  // Create a dedicated session in the disposable DB; never expose production tokens.
  const id = `dr_check_${crypto.randomUUID()}`, token = crypto.randomBytes(32).toString("hex");
  await db.user.create({ data: { id, name: "Isolated DR check", role: "admin",
    credit: { create: { id: `credit_${id}`, balance: 0 } },
    sessions: { create: { id: `session_${id}`, tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 120_000) } } } });
  try {
    const account = await request("/api/credits/account", token); assert.equal(account.status, 200);
    // Verify restored references against actual stored bytes (range avoids large transfers).
    const references = await db.asset.findMany({ where: { referenceUrl: { contains: "/storage/" } }, take: 100 });
    let mediaChecked = 0, missing = 0;
    for (const asset of references) {
      const path = new URL(asset.referenceUrl, "http://local").pathname;
      if (!path.startsWith("/storage/")) continue;
      const file = "/app" + decodeURIComponent(path);
      try {
        const handle = await fs.open(file, "r");
        const stat = await handle.stat();
        if (!stat.size) { await handle.close(); missing++; continue; }
        const expected = Buffer.alloc(Math.min(4096, stat.size));
        await handle.read(expected, 0, expected.length, 0); await handle.close();
        const response = await request(path, token, { headers: { Range: `bytes=0-${expected.length - 1}` } });
        assert.equal(response.status, 206, "Restored media must be readable through auth + Nginx");
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
        mediaChecked++;
      } catch (error) {
        if (error.code === "ENOENT") missing++; else throw error;
      }
      if (mediaChecked === 5) break;
    }
    assert.equal(missing, 0, "Restored DB media references must exist in the storage archive");
    reports.push({ check: "restored-private-media", checkedFiles: mediaChecked, missingFiles: missing,
      note: mediaChecked ? "original stored bytes and HTTP range verified" : "no local media references in this backup" });
    const endpoints = ["/api/credits/account", "/api/projects", "/api/billing/orders", "/api/tasks", "/api/providers"];
    // Capacity test removes the per-IP limit ONLY in the disposable API container.
    // Open-loop arrivals, max 40 in flight, three 15-second phases. No paid endpoints.
    for (const rps of [10, 20, 30]) {
      const started = performance.now(), samples = [], pending = new Set();
      let sent = 0, failed = 0, dropped = 0;
      while (performance.now() - started < 15_000) {
        const due = Math.floor((performance.now() - started) * rps / 1000);
        while (sent <= due) {
          const path = endpoints[sent % endpoints.length]; sent++;
          if (pending.size >= 40) { dropped++; continue; }
          const began = performance.now();
          const promise = request(path, token).then(async response => {
            await response.arrayBuffer(); if (!response.ok) failed++;
          }).catch(() => { failed++; }).finally(() => { samples.push(performance.now() - began); pending.delete(promise); });
          pending.add(promise);
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await Promise.all(pending);
      samples.sort((a,b) => a-b);
      const percentile = value => Math.round(samples[Math.min(samples.length - 1, Math.floor(samples.length * value))]);
      const result = { check: "isolated-http-load", targetRps: rps, durationSeconds: 15, sent, completed: samples.length,
        failed, dropped, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99),
        throughputRps: Number((samples.length / ((performance.now()-started)/1000)).toFixed(1)),
        limits: "API 1 CPU/512 MiB; PostgreSQL .75 CPU/768 MiB; limiter raised only for isolated capacity measurement" };
      reports.push(result);
      console.log(JSON.stringify(result));
      assert.equal(dropped, 0); assert.ok(failed / sent <= .01); assert.ok(result.p95Ms < 1000);
    }
  } finally { await db.user.delete({ where: { id } }); }
  const loadQueue = new Queue(`dr-load-${crypto.randomUUID()}`, { connection });
  let worker;
  try {
    const begun = performance.now(), completed = [], failures = [];
    await loadQueue.addBulk(Array.from({ length: 200 }, (_, index) => ({ name: "fixture",
      data: { index }, opts: { jobId: `fixture-${index}`, priority: index < 20 ? 1 : 100,
        attempts: 2, backoff: { type: "fixed", delay: 20 }, removeOnComplete: false } })));
    worker = new Worker(loadQueue.name, async job => {
      if (job.data.index % 10 === 0 && job.attemptsMade === 0) throw new Error("isolated retry fixture");
      completed.push(job.data.index); return true;
    }, { connection, concurrency: 4 });
    worker.on("failed", job => { if (job?.attemptsMade >= 2) failures.push(job.id); });
    while (completed.length < 200 && performance.now()-begun < 15_000) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(completed.length, 200); assert.equal(new Set(completed).size, 200); assert.equal(failures.length, 0);
    assert.ok(completed.slice(0, 15).every(index => index < 20), "membership priorities must run first");
    reports.push({ check: "isolated-real-redis-queue", jobs: 200, retryFixtures: 20, concurrency: 4,
      seconds: Number(((performance.now()-begun)/1000).toFixed(2)), uniqueCompletions: 200, terminalFailures: 0, priorityVerified: true });
  } finally { if (worker) await worker.close(); await loadQueue.obliterate({ force: true }); await loadQueue.close(); }
  assert.deepEqual(await finance(), before, "Restored financial totals and production tasks must remain unchanged by the drill");
  console.log(JSON.stringify({ check: "full-restore-evidence", financeUnchanged: true, finance: before[0].snapshot, reports }));
} finally { await queue.close(); await db.$disconnect(); }
