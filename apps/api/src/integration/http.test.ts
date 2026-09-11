import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../auth/password.js";
import { releaseTaskCredits, reserveTaskCredits } from "../billing/taskCredits.js";

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;
test("HTTP business boundaries: sessions, administrator writes, private media and audit history", { skip: !databaseUrl, timeout: 120_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  const redisUrl = new URL(process.env.AIFILM_TEST_REDIS_URL || "redis://127.0.0.1:6379/14");
  assert.ok(["localhost", "127.0.0.1"].includes(redisUrl.hostname));
  assert.ok(Number(redisUrl.pathname.slice(1)) >= 10);
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const root = await mkdtemp(resolve(tmpdir(), "manjiao-http-review-"));
  const run = crypto.randomUUID();
  const password = `Review-${run}`;
  const ids = [`api_owner_${run}`, `api_other_${run}`, `api_admin_${run}`];
  const projectId = `api_project_${run}`;
  const providerId = `api_provider_${run}`;
  const port = 41000 + Math.floor(Math.random() * 10000);
  const base = `http://127.0.0.1:${port}`;
  const passwordHash = await hashPassword(password);
  for (let i = 0; i < ids.length; i++) await db.user.create({ data: {
    id: ids[i]!, name: `HTTP review ${i}`, email: `${ids[i]}@example.test`, passwordHash,
    role: i === 2 ? "admin" : "creator", credit: { create: { id: `credit_${ids[i]}`, balance: 100 } }
  } });
  await db.project.create({ data: { id: projectId, userId: ids[0]!, name: "Private test", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "planning" } });
  const mediaPath = `/storage/images/${run}.png`;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=", "base64");
  await mkdir(resolve(root, "images"));
  await writeFile(resolve(root, "images", `${run}.png`), bytes);
  await db.asset.create({ data: { id: `api_asset_${run}`, projectId, type: "image", name: "Private image", description: "Test fixture", prompt: "", referenceUrl: mediaPath, status: "succeeded" } });
  await db.modelProvider.create({ data: { id: providerId, name: "Private route", costHint: "test", modality: "text", enabled: true, models: ["test-model"], baseUrl: "https://private.example.test", apiKey: "never-disclose-test-secret", capability: {} } });
  await db.modelPrice.createMany({ data: [
    { id: `api_text_price_${run}`, providerId, providerName: "Private route", model: "test-model", modality: "text", unit: "text_episode", unitCredits: 37 },
    { id: `api_other_price_${run}`, providerName: "Other route", model: "test-model", modality: "text", unit: "text_episode", unitCredits: 1 },
    { id: `api_image_price_${run}`, providerId, providerName: "Private route", model: "test-image", modality: "image", unit: "image", unitCredits: 999 },
    { id: `api_video_price_${run}`, providerId, providerName: "Private route", model: "test-video", modality: "video", unit: "video_second", unitCredits: 999 }
  ] });
  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, "src/server.ts"], {
    cwd: resolve(import.meta.dirname, "../.."), stdio: ["ignore", "pipe", "pipe"], env: {
      ...process.env, AIFILM_LOAD_ENV_FILES: "false", NODE_ENV: "test", DATABASE_URL: databaseUrl!,
      DEEPSEEK_API_KEY: "",
      REDIS_URL: redisUrl.toString(), API_PORT: String(port), PUBLIC_API_BASE_URL: base,
      OBJECT_STORAGE_LOCAL_DIR: root, MEDIA_SIGNING_KEY: "http-review-test-signing-key-at-least-32-bytes",
      SEED_DEFAULT_USERS: "false", SEED_DEMO_USER: "false", SEED_DEMO_DATA: "false", API_RATE_LIMIT_MAX: "1000"
    }
  });
  let logs = "";
  child.stdout.on("data", data => { logs = (logs + data).slice(-6000); });
  child.stderr.on("data", data => { logs = (logs + data).slice(-6000); });
  const request = (path: string, token?: string, method = "GET", body?: unknown, headers?: Record<string, string>) => fetch(base + path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000)
  });
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error(`API exited during startup: ${logs}`);
      try { ready = (await request("/ready")).ok; } catch { /* startup */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, logs);
    const sessions = [];
    for (const id of ids) {
      const response = await request("/api/auth/login", undefined, "POST", { account: `${id}@example.test`, password });
      assert.equal(response.status, 200);
      const body = await response.json() as { token: string };
      sessions.push({ token: body.token, cookie: response.headers.get("set-cookie")!.split(";")[0]! });
    }
    const [owner, other, admin] = sessions as [typeof sessions[number], typeof sessions[number], typeof sessions[number]];
    type AuditPage = { total: number; items: Array<{ actorId: string; action: string; target: string; status: string; statusCode: number | null; details: unknown }> };
    async function waitForAudit(keyword: string, complete: (page: AuditPage) => boolean) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const response = await request(`/api/admin/audit-logs?actorId=${ids[2]}&keyword=${encodeURIComponent(keyword)}`, admin.token);
        assert.equal(response.status, 200);
        const page = await response.json() as AuditPage;
        if (complete(page)) return page;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error("Audit did not reach its expected final HTTP status");
    }
    await t.test("private media denies anonymous and another account but supports owner cookies and ranges", async () => {
      assert.equal((await request(mediaPath)).status, 404);
      assert.equal((await request(mediaPath, other.token)).status, 404);
      const authorized = await request(mediaPath, undefined, "GET", undefined, { Cookie: owner.cookie });
      assert.equal(authorized.status, 200);
      assert.match(authorized.headers.get("cache-control")!, /no-store/);
      assert.deepEqual(Buffer.from(await authorized.arrayBuffer()), bytes);
      const range = await request(mediaPath, owner.token, "GET", undefined, { Range: "bytes=0-7" });
      assert.equal(range.status, 206);
      assert.equal((await range.arrayBuffer()).byteLength, 8);
    });
    await t.test("creator cannot call admin APIs or spend platform money through connection tests", async () => {
      for (const path of ["/api/admin/users/page", "/api/admin/audit-logs"]) assert.equal((await request(path, owner.token)).status, 403);
      for (const kind of ["model-test", "image-model-test", "video-model-test"]) assert.equal((await request(`/api/settings/${kind}`, owner.token, "POST", {})).status, 403);
      const publicProviders = await (await request("/api/providers", owner.token)).json() as Array<Record<string, unknown>>;
      const provider = publicProviders.find(row => row.id === providerId)!;
      assert.ok(provider);
      assert.equal(provider.baseUrl, undefined);
      assert.equal(provider.apiKeyPreview, undefined);
      assert.ok(!JSON.stringify(publicProviders).includes("never-disclose"));
    });
    await t.test("admin duplicate credit submission creates one ledger entry and auditable action", async () => {
      const input = { userId: ids[0], amount: 25, description: "HTTP review adjustment", requestId: run };
      const responses = await Promise.all(Array.from({ length: 4 }, () => request("/api/admin/users/credits/adjust", admin.token, "POST", input)));
      assert.ok(responses.every(response => response.ok), JSON.stringify(await Promise.all(responses.map(response => response.text()))));
      assert.equal((await db.creditAccount.findUniqueOrThrow({ where: { userId: ids[0]! } })).balance, 125);
      assert.equal(await db.creditTransaction.count({ where: { userId: ids[0]! } }), 1);
      const page = await waitForAudit("credits", page => page.total === 4 && page.items.every(item => item.status === "succeeded" && item.statusCode === 200));
      assert.equal(page.total, 4);
      assert.ok(page.items.every(item => item.actorId === ids[2]));
      assert.ok(!JSON.stringify(page).includes(password));
    });
    await t.test("creation quotes charge only the exact text model and reject unconfirmed or stale caps without side effects", async () => {
      const input = { requestId: `quoted-${run}`, title: "Quoted creation", sourceType: "script", content: "第1集 夜行\n场景1 庭院\n甲：回来。\n第2集 清晨\n场景1 客厅\n乙：我到了。", mode: "director", targetEpisodes: 2,
        genre: "test", videoRatio: "9:16", artStyle: "test", textProvider: providerId, textModel: "test-model", imageProvider: providerId, imageModel: "test-image", videoProvider: providerId, videoModel: "test-video" };
      const quoteResponse = await request("/api/creation/estimate", owner.token, "POST", input);
      assert.equal(quoteResponse.status, 200, await quoteResponse.clone().text());
      const quote = await quoteResponse.json() as { estimatedCredits: number; suggestedEpisodes: number; breakdown: Array<{ providerId: string; model: string; quantity: number; unitCredits: number; totalCredits: number }> };
      assert.equal(quote.suggestedEpisodes, 2); assert.equal(quote.estimatedCredits, 74); assert.equal(quote.breakdown.length, 1);
      assert.equal(quote.breakdown[0]!.providerId, providerId); assert.equal(quote.breakdown[0]!.model, "test-model");
      assert.equal(quote.breakdown[0]!.unitCredits, 37); assert.equal(quote.breakdown[0]!.quantity, 2); assert.equal(quote.breakdown[0]!.totalCredits, 74);
      const preferred = await request("/api/creation/estimate", owner.token, "POST", { ...input, textModel: undefined });
      assert.equal(preferred.status, 200); assert.equal((await preferred.json() as typeof quote).estimatedCredits, 74);
      const snapshot = async () => ({ projects: await db.project.count({ where: { userId: ids[0]! } }), tasks: await db.generationTask.count({ where: { userId: ids[0]! } }), transactions: await db.creditTransaction.count({ where: { userId: ids[0]! } }), account: await db.creditAccount.findUniqueOrThrow({ where: { userId: ids[0]! } }) });
      const before = await snapshot();
      for (const maxCredits of [undefined, -1, null, "74", 73]) {
        const response = await request("/api/creation/start", owner.token, "POST", { ...input, maxCredits });
        assert.ok(response.status >= 400 && response.status < 500, await response.text());
        assert.deepEqual(await snapshot(), before);
      }
      await db.modelPrice.update({ where: { id: `api_text_price_${run}` }, data: { unitCredits: 40 } });
      const stale = await request("/api/creation/start", owner.token, "POST", { ...input, maxCredits: quote.estimatedCredits });
      assert.ok(stale.status >= 400 && stale.status < 500); assert.match(await stale.text(), /重新获取报价/);
      assert.deepEqual(await snapshot(), before);
      const fresh = await request("/api/creation/estimate", owner.token, "POST", input);
      assert.equal((await fresh.json() as typeof quote).estimatedCredits, 80);
    });
    await t.test("creation HTTP replay returns the original project, rejects mismatched input and isolates users", async () => {
      // This provider has no key or URL: the test worker uses only its local fixture generator.
      await db.modelProvider.update({ where: { id: providerId }, data: { apiKey: null, baseUrl: null } });
      const input = { requestId: `http-create-${run}`, title: "HTTP replay", sourceType: "script", content: "第1集 雨后\n场景1 书店\n小林：雨停了。", mode: "director", targetEpisodes: 1,
        genre: "test", videoRatio: "9:16", artStyle: "test", textProvider: providerId, textModel: "test-model", maxCredits: 40 };
      assert.equal((await request("/api/creation/start", owner.token, "POST", { ...input, requestId: undefined })).status, 400);
      const responses = await Promise.all(Array.from({ length: 4 }, () => request("/api/creation/start", owner.token, "POST", input)));
      assert.equal(responses.filter(response => response.status === 201).length, 1);
      assert.equal(responses.filter(response => response.status === 200).length, 3);
      const results = await Promise.all(responses.map(response => response.json())) as Array<{ project: { id: string }; task: { id: string }; estimate: { estimatedCredits: number }; replayed: boolean }>;
      assert.equal(new Set(results.map(row => row.project.id)).size, 1);
      assert.equal(new Set(results.map(row => row.task.id)).size, 1);
      const original = results[0]!;
      assert.equal(await db.creationRequest.count({ where: { userId: ids[0], requestId: input.requestId } }), 1);
      assert.equal(await db.creditTransaction.count({ where: { taskId: original.task.id, type: "freeze" } }), 1);
      assert.equal(await db.creditTransaction.count({ where: { taskId: original.task.id, type: "consume" } }), 1);
      const before = await db.creditAccount.findUniqueOrThrow({ where: { userId: ids[0] } });
      await db.modelProvider.update({ where: { id: providerId }, data: { enabled: false } });
      const replay = await request("/api/creation/start", owner.token, "POST", { ...input, maxCredits: 0 });
      assert.equal(replay.status, 200);
      const replayBody = await replay.json() as typeof original;
      assert.equal(replayBody.project.id, original.project.id); assert.equal(replayBody.task.id, original.task.id); assert.equal(replayBody.replayed, true);
      assert.deepEqual(replayBody.estimate, original.estimate);
      assert.equal((await request("/api/creation/start", owner.token, "POST", { ...input, title: "Changed creation" })).status, 409);
      assert.deepEqual(await db.creditAccount.findUniqueOrThrow({ where: { userId: ids[0] } }), before);
      await db.modelProvider.update({ where: { id: providerId }, data: { enabled: true } });
      const secondUser = await request("/api/creation/start", other.token, "POST", input);
      assert.equal(secondUser.status, 201);
      assert.notEqual((await secondUser.json() as typeof original).project.id, original.project.id);
    });
    await t.test("retired prune and unsafe project deletion cannot discard active tasks or billing history", async () => {
      const id = `api_delete_${run}`, taskId = `api_delete_task_${run}`;
      await db.project.create({ data: { id, userId: ids[0]!, name: "Deletion safety", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "planning" } });
      await db.generationTask.create({ data: { id: taskId, userId: ids[0]!, projectId: id, type: "text", title: "Pending delete fixture", provider: "fixture", model: "fixture", status: "pending", estimatedCredits: 5 } });
      await db.$transaction(tx => reserveTaskCredits(tx, { taskId, userId: ids[0]! }));
      const snapshot = async () => ({ account: await db.creditAccount.findUniqueOrThrow({ where: { userId: ids[0] } }), tasks: await db.generationTask.count({ where: { userId: ids[0] } }), projects: await db.project.count({ where: { userId: ids[0] } }), ledger: await db.creditTransaction.count({ where: { userId: ids[0] } }) });
      const before = await snapshot();
      assert.equal((await request("/api/projects/prune-to-latest", owner.token, "POST", {})).status, 410);
      assert.equal((await request(`/api/projects/${id}`, owner.token, "DELETE")).status, 409);
      assert.equal((await request(`/api/projects/${id}`, other.token, "DELETE")).status, 404);
      assert.deepEqual(await snapshot(), before);
      await db.generationTask.update({ where: { id: taskId }, data: { status: "failed" } });
      assert.equal((await request(`/api/projects/${id}`, owner.token, "DELETE")).status, 409, "terminal status alone must not erase unresolved reservations");
      await db.$transaction(tx => releaseTaskCredits(tx, { taskId, userId: ids[0]! }));
      const settled = await snapshot();
      assert.equal((await request(`/api/projects/${id}`, owner.token, "DELETE")).status, 200);
      const after = await snapshot();
      assert.deepEqual(after.account, settled.account); assert.equal(after.tasks, settled.tasks); assert.equal(after.ledger, settled.ledger);
      assert.equal(after.projects, settled.projects - 1);
      assert.equal((await db.generationTask.findUniqueOrThrow({ where: { id: taskId } })).projectId, null);
      assert.equal(await db.creditTransaction.count({ where: { taskId, projectId: null } }), 2);
    });
    await t.test("a duplicate admin-created email is HTTP 409 in both the response and completed audit", async () => {
      const response = await request("/api/admin/users", admin.token, "POST", {
        name: "Duplicate email review", email: `${ids[0]}@example.test`, password, role: "creator", status: "active", initialCredits: 0
      });
      assert.equal(response.status, 409);
      const page = await waitForAudit("/api/admin/users", page => page.items.some(item => item.target === "/api/admin/users" && item.action === "POST" && item.status === "failed" && item.statusCode === 409));
      const entry = page.items.find(item => item.target === "/api/admin/users" && item.action === "POST")!;
      assert.equal(entry.actorId, ids[2]); assert.equal(entry.statusCode, response.status);
      assert.ok(!JSON.stringify(entry).includes(password));
      assert.equal(await db.user.count({ where: { email: `${ids[0]}@example.test` } }), 1);
    });
    await t.test("self-disable is rejected and disabling another account revokes both API and media sessions", async () => {
      const self = await request(`/api/admin/users/${ids[2]}`, admin.token, "PATCH", { status: "disabled" });
      assert.ok(self.status >= 400);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: ids[2]! } })).status, "active");
      assert.equal((await request(`/api/admin/users/${ids[0]}`, admin.token, "PATCH", { status: "disabled" })).status, 200);
      assert.equal((await request("/api/auth/me", owner.token)).status, 401);
      assert.equal((await request(mediaPath, undefined, "GET", undefined, { Cookie: owner.cookie })).status, 404);
    });
  } finally {
    child.kill();
    if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 5000))]);
    await db.adminAuditLog.deleteMany({ where: { actorId: { in: ids } } });
    await db.modelPrice.deleteMany({ where: { id: { in: [`api_text_price_${run}`, `api_other_price_${run}`, `api_image_price_${run}`, `api_video_price_${run}`] } } });
    await db.modelProvider.deleteMany({ where: { id: providerId } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
