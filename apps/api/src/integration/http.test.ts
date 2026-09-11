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
import type { SupportTicketList, SupportTicketMutationResult, SupportTicketDetail } from "@aifilm/shared";
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
  const announcementIds: string[] = [];
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
    await t.test("announcement schedule errors are HTTP 400 with unchanged rows and matching final audit status", async () => {
      const title = `HTTP announcement ${run}`;
      const startsAt = "2030-01-09T16:00:00.123Z", endsAt = "2030-01-10T15:59:59.999Z";
      for (const invalid of [{ startsAt: endsAt, endsAt: startsAt }, { startsAt, endsAt: startsAt }, { startsAt: "not-a-date", endsAt }]) {
        const response = await request("/api/admin/announcements", admin.token, "POST", { title, body: "Schedule fixture", ...invalid });
        assert.equal(response.status, 400);
      }
      assert.equal(await db.platformAnnouncement.count({ where: { title } }), 0);
      const created = await request("/api/admin/announcements", admin.token, "POST", { title, body: "Schedule fixture", startsAt, endsAt });
      assert.equal(created.status, 201);
      const row = await created.json() as { id: string }; announcementIds.push(row.id);
      const before = await db.platformAnnouncement.findUniqueOrThrow({ where: { id: row.id } });
      for (const invalid of [{ startsAt: "2030-01-11T00:00:00.000Z" }, { endsAt: startsAt }]) {
        const response = await request(`/api/admin/announcements/${row.id}`, admin.token, "PATCH", { pinned: true, ...invalid });
        assert.equal(response.status, 400); assert.match((await response.json() as { message: string }).message, /结束时间必须晚于开始时间/);
        assert.deepEqual(await db.platformAnnouncement.findUniqueOrThrow({ where: { id: row.id } }), before);
      }
      const renamed = await request(`/api/admin/announcements/${row.id}`, admin.token, "PATCH", { body: "Body changed without date edits" });
      assert.equal(renamed.status, 200);
      const renamedBody = await renamed.json() as { startsAt: string; endsAt: string };
      assert.equal(renamedBody.startsAt, startsAt); assert.equal(renamedBody.endsAt, endsAt);
      const clear = await request(`/api/admin/announcements/${row.id}`, admin.token, "PATCH", { endsAt: null });
      assert.equal(clear.status, 200); assert.equal((await db.platformAnnouncement.findUniqueOrThrow({ where: { id: row.id } })).endsAt, null);
      const page = await waitForAudit(row.id, page => page.items.filter(item => item.action === "PATCH").length === 4 && page.items.every(item => item.status !== "started"));
      assert.equal(page.items.filter(item => item.status === "failed" && item.statusCode === 400).length, 2);
      assert.equal(page.items.filter(item => item.status === "succeeded" && item.statusCode === 200).length, 2);
      assert.equal((await request(`/api/admin/announcements/missing_${run}`, admin.token, "PATCH", { startsAt })).status, 404);
      assert.equal((await request(`/api/admin/announcements/${row.id}`, admin.token, "PATCH", { startsAt: null, pinned: true })).status, 200);
      const summary = await (await request("/api/workbench/summary", owner.token)).json() as { announcements: Array<{ id: string; pinned?: boolean }> };
      assert.equal(summary.announcements.find(item => item.id === row.id)?.pinned, true);
    });
    await t.test("support HTTP creates and replays actual tickets, enforces ownership and rejects client-supplied roles", async () => {
      const path = "/api/support/tickets";
      const payload = { requestId: `support-http-${run}`, subject: "导出进度问题", category: "export", body: "这是本机 HTTP 工单验收，不调用供应商。" };
      for (const [method, body] of [["GET", undefined], ["POST", payload]] as const) assert.equal((await request(path, undefined, method, body)).status, 401);
      for (const extra of [{ authorRole: "staff" }, { userId: ids[1] }, { category: "invalid" }, { body: " " }, { requestId: undefined }]) {
        assert.equal((await request(path, owner.token, "POST", { ...payload, ...extra })).status, 400);
      }
      assert.equal(await db.supportTicket.count({ where: { userId: ids[0]! } }), 0);
      const first = await request(path, owner.token, "POST", payload);
      assert.equal(first.status, 201, await first.clone().text());
      const row = await first.json() as SupportTicketMutationResult;
      assert.equal(row.ticket.userId, ids[0]); assert.equal(row.ticket.status, "open"); assert.equal(row.ticket.version, 1);
      assert.equal(row.messages.length, 1); assert.equal(row.messages[0]!.authorRole, "user"); assert.equal(row.replayed, false);
      const repeat = await request(path, owner.token, "POST", payload);
      assert.equal(repeat.status, 200); const replay = await repeat.json() as SupportTicketMutationResult;
      assert.equal(replay.ticket.id, row.ticket.id); assert.equal(replay.replayed, true); assert.equal(replay.messages.length, 1);
      assert.equal((await request(path, owner.token, "POST", { ...payload, body: "相同标识的新内容" })).status, 409);
      const ownerPage = await (await request(`${path}?page=1&pageSize=1`, owner.token)).json() as SupportTicketList;
      assert.equal(ownerPage.total, 1); assert.equal(ownerPage.items[0]!.id, row.ticket.id);
      const otherPage = await (await request(path, other.token)).json() as SupportTicketList;
      assert.equal(otherPage.total, 0); assert.deepEqual(otherPage.items, []);
      for (const [suffix, method, body] of [["", "GET", undefined], ["/messages", "POST", { requestId: `other-${run}`, expectedVersion: 1, body: "越权回复" }], ["/close", "POST", { expectedVersion: 1 }]] as const) {
        assert.equal((await request(`${path}/${row.ticket.id}${suffix}`, other.token, method, body)).status, 404);
      }
      assert.equal((await request(`${path}?pageSize=51`, owner.token)).status, 400);
      for (const adminPath of ["/api/admin/support/tickets", `/api/admin/support/tickets/${row.ticket.id}`]) assert.equal((await request(adminPath, owner.token)).status, 403);
      for (const suffix of ["messages", "close"]) assert.equal((await request(`/api/admin/support/tickets/${row.ticket.id}/${suffix}`, owner.token, "POST", { expectedVersion: 1, requestId: run, body: "伪装员工" })).status, 403);
      assert.equal((await request(`/api/admin/support/tickets/${row.ticket.id}`, admin.token)).status, 200);
      assert.equal((await db.supportTicket.findUniqueOrThrow({ where: { id: row.ticket.id } })).version, 1);
    });
    await t.test("support answer, supplement and terminal close preserve messages, reject stale versions and redact admin audit transcripts", async () => {
      const created = await request("/api/support/tickets", owner.token, "POST", { requestId: `support-thread-${run}`, subject: "账号使用问题", category: "account", body: "请协助检查账号。" });
      assert.equal(created.status, 201);
      const original = await created.json() as SupportTicketMutationResult;
      const path = `/api/support/tickets/${original.ticket.id}`, adminPath = `/api/admin/support/tickets/${original.ticket.id}`;
      const secretText = `support-private-transcript-${run}`;
      const reply = { requestId: `support-answer-${run}`, expectedVersion: 1, body: `<b>${secretText}</b> 已答复` };
      const answeredResponse = await request(`${adminPath}/messages`, admin.token, "POST", reply);
      assert.equal(answeredResponse.status, 200, await answeredResponse.clone().text());
      const answered = await answeredResponse.json() as SupportTicketMutationResult;
      assert.equal(answered.ticket.status, "answered"); assert.equal(answered.ticket.version, 2);
      assert.equal(answered.messages[1]!.body, reply.body); assert.equal(answered.messages[1]!.authorRole, "staff");
      const replayResponse = await request(`${adminPath}/messages`, admin.token, "POST", reply);
      assert.equal(replayResponse.status, 200); assert.equal((await replayResponse.json() as SupportTicketMutationResult).replayed, true);
      const supplement = { requestId: `support-more-${run}`, expectedVersion: 2, body: "问题仍有一个补充。" };
      const reopened = await request(`${path}/messages`, owner.token, "POST", supplement);
      assert.equal(reopened.status, 200); const reopenedRow = await reopened.json() as SupportTicketMutationResult;
      assert.equal(reopenedRow.ticket.status, "open"); assert.equal(reopenedRow.ticket.version, 3);
      assert.deepEqual(reopenedRow.messages.slice(0, 2), answered.messages);
      assert.equal((await request(`${adminPath}/messages`, admin.token, "POST", { ...reply, requestId: `stale-${run}` })).status, 409);
      assert.equal((await request(`${adminPath}/messages`, admin.token, "POST", { ...reply, body: "同标识不同正文", expectedVersion: 3 })).status, 409);
      assert.equal((await request(`${adminPath}/messages`, admin.token, "POST", { ...reply, expectedVersion: 3, description: secretText })).status, 400);
      assert.equal((await request(`${path}/close`, owner.token, "POST", { expectedVersion: 1 })).status, 409);
      const closedResponse = await request(`${adminPath}/close`, admin.token, "POST", { expectedVersion: 3 });
      assert.equal(closedResponse.status, 200); const closed = await closedResponse.json() as SupportTicketMutationResult;
      assert.equal(closed.ticket.status, "closed"); assert.equal(closed.ticket.version, 4); assert.ok(closed.ticket.closedAt);
      assert.equal((await request(`${path}/messages`, owner.token, "POST", { requestId: `closed-${run}`, expectedVersion: 4, body: "不能再回复" })).status, 409);
      const safeReplay = await request(`${path}/messages`, owner.token, "POST", supplement);
      assert.equal(safeReplay.status, 200); const safeRow = await safeReplay.json() as SupportTicketMutationResult;
      assert.equal(safeRow.replayed, true); assert.equal(safeRow.ticket.status, "closed"); assert.equal(safeRow.messages.length, 3);
      const finalDetail = await (await request(path, owner.token)).json() as SupportTicketDetail;
      assert.deepEqual(finalDetail.messages, reopenedRow.messages);
      const page = await waitForAudit(original.ticket.id, page => page.items.length === 6 && page.items.every(item => item.status !== "started"));
      assert.equal(page.items.filter(item => item.statusCode === 200).length, 3);
      assert.equal(page.items.filter(item => item.statusCode === 409).length, 2);
      assert.equal(page.items.filter(item => item.statusCode === 400).length, 1);
      assert.ok(!JSON.stringify(page).includes(secretText), "support body must not enter the administrator audit log");
      assert.ok(!logs.includes(secretText), "support body must not enter API console logs");
    });
    await t.test("administrator password reset revokes every old API/media session and only the new password can sign in", async () => {
      const resetPath = `/api/admin/users/${ids[0]}/password`;
      const secondLogin = await request("/api/auth/login", undefined, "POST", { account: `${ids[0]}@example.test`, password });
      assert.equal(secondLogin.status, 200);
      const secondToken = (await secondLogin.json() as { token: string }).token;
      const secondCookie = secondLogin.headers.get("set-cookie")!.split(";")[0]!;
      const resetPassword = `Reset-${crypto.randomUUID()}`;
      assert.equal((await request(resetPath, other.token, "POST", { password: resetPassword })).status, 403);
      assert.equal((await request(resetPath, admin.token, "POST", { password: "short" })).status, 400);
      assert.equal((await request("/api/auth/me", owner.token)).status, 200);
      assert.equal((await request("/api/auth/me", secondToken)).status, 200);
      const reset = await request(resetPath, admin.token, "POST", { password: resetPassword });
      assert.equal(reset.status, 200, await reset.clone().text());
      assert.equal(await db.authSession.count({ where: { userId: ids[0]!, revokedAt: null } }), 0);
      for (const token of [owner.token, secondToken]) assert.equal((await request("/api/auth/me", token)).status, 401);
      for (const cookie of [owner.cookie, secondCookie]) assert.equal((await request(mediaPath, undefined, "GET", undefined, { Cookie: cookie })).status, 404);
      assert.equal((await request("/api/auth/login", undefined, "POST", { account: `${ids[0]}@example.test`, password })).status, 401);
      const freshLogin = await request("/api/auth/login", undefined, "POST", { account: `${ids[0]}@example.test`, password: resetPassword });
      assert.equal(freshLogin.status, 200);
      owner.token = (await freshLogin.json() as { token: string }).token;
      owner.cookie = freshLogin.headers.get("set-cookie")!.split(";")[0]!;
      assert.equal((await request("/api/auth/me", owner.token)).status, 200);
      assert.equal((await request(mediaPath, undefined, "GET", undefined, { Cookie: owner.cookie })).status, 200);
      const page = await waitForAudit(resetPath, page => page.items.length === 2 && page.items.every(item => item.status !== "started"));
      assert.equal(page.items.filter(item => item.statusCode === 400 && item.status === "failed").length, 1);
      assert.equal(page.items.filter(item => item.statusCode === 200 && item.status === "succeeded").length, 1);
      assert.ok(!JSON.stringify(page).includes(resetPassword));
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
    await db.platformAnnouncement.deleteMany({ where: { id: { in: announcementIds } } });
    await db.modelPrice.deleteMany({ where: { id: { in: [`api_text_price_${run}`, `api_other_price_${run}`, `api_image_price_${run}`, `api_video_price_${run}`] } } });
    await db.modelProvider.deleteMany({ where: { id: providerId } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
