import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { CreateSupportTicketInput, ReplySupportTicketInput } from "@aifilm/shared";

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;

test("support tickets persist an isolated, idempotent and append-only PostgreSQL conversation", { skip: !databaseUrl, timeout: 45_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const observerUrl = new URL(databaseUrl!);
  observerUrl.searchParams.set("connection_limit", "1");
  const observer = new PrismaClient({ datasourceUrl: observerUrl.toString() });
  const { createSupportTicket, getSupportTicket, listSupportTickets, replySupportTicket, closeSupportTicket } = await import("./supportTickets.js");
  const run = crypto.randomUUID();
  const ids = [`support_owner_${run}`, `support_other_${run}`, `support_staff_${run}`];
  const owner = { id: ids[0]! }, other = { id: ids[1]! }, staff = { id: ids[2]!, staff: true };
  const input = (extra = {}): CreateSupportTicketInput => ({ requestId: crypto.randomUUID(), subject: "生成进度未更新", category: "generation", body: "任务编号 fixture，仅离线测试。", ...extra });
  const create = (extra = {}) => createSupportTicket(owner.id, input(extra), db);
  const snapshot = async () => ({
    tickets: await db.supportTicket.findMany({ where: { userId: { in: ids } }, orderBy: { id: "asc" } }),
    messages: await db.supportTicketMessage.findMany({ where: { ticket: { userId: { in: ids } } }, orderBy: { id: "asc" } }),
    requests: await db.supportTicketRequest.findMany({ where: { actorId: { in: ids } }, orderBy: { id: "asc" } })
  });
  // Fail only the final request insert while using a real PostgreSQL transaction.
  const failRequestDb = { $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(tx => work(new Proxy(tx, {
    get(target, key) {
      if (key === "supportTicketRequest") return new Proxy(target.supportTicketRequest, { get(delegate, method) {
        if (method === "create") return async () => { throw new Error("forced final request persistence failure"); };
        return Reflect.get(delegate, method);
      } });
      return Reflect.get(target, key);
    }
  }))) } as unknown as PrismaClient;
  try {
    for (const [index, id] of ids.entries()) await db.user.create({ data: { id, name: `Support fixture ${index}`, email: `${id}@example.test`, role: index === 2 ? "admin" : "creator" } });

    await t.test("concurrent creation has one ticket, first message and persisted key; another user may reuse the key", async () => {
      const payload = input();
      const results = await Promise.all(Array.from({ length: 5 }, () => createSupportTicket(owner.id, payload, db)));
      assert.equal(new Set(results.map(row => row.ticket.id)).size, 1);
      assert.equal(results.filter(row => !row.replayed).length, 1);
      const row = results[0]!;
      assert.equal(row.ticket.status, "open"); assert.equal(row.ticket.version, 1); assert.equal(row.messages.length, 1);
      assert.equal(row.messages[0]!.authorId, owner.id); assert.equal(row.messages[0]!.authorRole, "user");
      assert.equal(await db.supportTicketMessage.count({ where: { ticketId: row.ticket.id } }), 1);
      assert.equal(await db.supportTicketRequest.count({ where: { actorId: owner.id, requestId: payload.requestId } }), 1);
      for (const changed of [{ subject: "另外的问题" }, { body: "不同正文" }, { category: "billing" as const }]) {
        await assert.rejects(createSupportTicket(owner.id, { ...payload, ...changed }, db), { status: 409 });
      }
      const second = await createSupportTicket(other.id, payload, db);
      assert.notEqual(second.ticket.id, row.ticket.id); assert.equal(second.replayed, false);
    });

    await t.test("failure of the final idempotency insert rolls back the ticket and first message, and permits safe retry", async () => {
      const payload = input(); const before = await snapshot();
      await assert.rejects(createSupportTicket(owner.id, payload, failRequestDb), /forced final request persistence failure/);
      assert.deepEqual(await snapshot(), before);
      const retry = await createSupportTicket(owner.id, payload, db);
      assert.equal(retry.messages.length, 1); assert.equal(retry.replayed, false);
    });

    await t.test("owner-scoped detail, lists, replies and closes do not disclose or mutate another user's ticket", async () => {
      const row = await create(); const before = await snapshot();
      await assert.rejects(getSupportTicket(other, row.ticket.id, db), { status: 404 });
      await assert.rejects(replySupportTicket(other, row.ticket.id, { requestId: crypto.randomUUID(), expectedVersion: 1, body: "跨账号回复" }, db), { status: 404 });
      await assert.rejects(closeSupportTicket(other, row.ticket.id, { expectedVersion: 1 }, db), { status: 404 });
      await assert.rejects(getSupportTicket(owner, "", db), { status: 404 });
      assert.deepEqual(await snapshot(), before);
      const page = await listSupportTickets(other, { pageSize: 1 }, db);
      assert.equal(page.items.length, 1); assert.ok(page.items.every(item => item.userId === other.id));
      assert.equal(page.total, await db.supportTicket.count({ where: { userId: other.id } }));
      assert.equal((await listSupportTickets(owner, { page: 1000, pageSize: 1 }, db)).items.length, 0);
      assert.equal((await getSupportTicket(staff, row.ticket.id, db)).ticket.id, row.ticket.id);
    });

    await t.test("staff answer and user supplement append plaintext, transition status, and safely replay after newer messages", async () => {
      const row = await create();
      const response = { requestId: crypto.randomUUID(), expectedVersion: 1, body: "<script>literal text only</script> 已排查。" };
      const answered = await replySupportTicket(staff, row.ticket.id, response, db);
      assert.equal(answered.ticket.status, "answered"); assert.equal(answered.ticket.version, 2);
      assert.equal(answered.messages[1]!.authorRole, "staff"); assert.equal(answered.messages[1]!.body, response.body);
      const reopened = await replySupportTicket(owner, row.ticket.id, { requestId: crypto.randomUUID(), expectedVersion: 2, body: "还有补充信息。" }, db);
      assert.equal(reopened.ticket.status, "open"); assert.equal(reopened.ticket.version, 3);
      assert.deepEqual(reopened.messages.slice(0, 2), answered.messages);
      const replay = await replySupportTicket(staff, row.ticket.id, response, db);
      assert.equal(replay.replayed, true); assert.equal(replay.ticket.version, 3); assert.equal(replay.messages.length, 3);
      const before = await snapshot();
      await assert.rejects(replySupportTicket(staff, row.ticket.id, { ...response, body: "改变已提交内容" }, db), { status: 409 });
      await assert.rejects(replySupportTicket(owner, row.ticket.id, { requestId: crypto.randomUUID(), expectedVersion: 1, body: "过期页面" }, db), { status: 409 });
      assert.deepEqual(await snapshot(), before);
      assert.ok((await listSupportTickets(owner, { status: "open" }, db)).items.every(item => item.status === "open"));
    });

    await t.test("concurrent duplicate replies append once and a key cannot be rebound to another ticket", async () => {
      const row = await create(), second = await create();
      const reply = { requestId: crypto.randomUUID(), expectedVersion: 1, body: "重复点击或响应丢失" };
      const replies = await Promise.all(Array.from({ length: 5 }, () => replySupportTicket(owner, row.ticket.id, reply, db)));
      assert.equal(replies.filter(result => !result.replayed).length, 1);
      assert.equal((await getSupportTicket(owner, row.ticket.id, db)).messages.length, 2);
      await assert.rejects(replySupportTicket(owner, second.ticket.id, reply, db), { status: 409 });
      assert.equal((await getSupportTicket(owner, second.ticket.id, db)).messages.length, 1);
    });

    await t.test("failed reply request persistence rolls back the appended message and ticket version/status", async () => {
      const row = await create(), before = await snapshot();
      const reply = { requestId: crypto.randomUUID(), expectedVersion: 1, body: "事务回滚回复" };
      await assert.rejects(replySupportTicket(staff, row.ticket.id, reply, failRequestDb), /forced final request persistence failure/);
      assert.deepEqual(await snapshot(), before);
      const retry = await replySupportTicket(staff, row.ticket.id, reply, db);
      assert.equal(retry.ticket.version, 2); assert.equal(retry.messages.length, 2); assert.equal(retry.replayed, false);
    });

    await t.test("a closed ticket is terminal; successful earlier requests replay without reopening or duplicating messages", async () => {
      const payload = input(), row = await createSupportTicket(owner.id, payload, db);
      const reply = { requestId: crypto.randomUUID(), expectedVersion: 1, body: "处理完成" };
      await replySupportTicket(staff, row.ticket.id, reply, db);
      const closed = await closeSupportTicket(owner, row.ticket.id, { expectedVersion: 2 }, db);
      assert.equal(closed.ticket.status, "closed"); assert.equal(closed.ticket.version, 3); assert.ok(closed.ticket.closedAt);
      const before = await snapshot();
      for (const actor of [owner, staff]) await assert.rejects(replySupportTicket(actor, row.ticket.id, { requestId: crypto.randomUUID(), expectedVersion: 3, body: "关闭后新消息" }, db), { status: 409 });
      await assert.rejects(closeSupportTicket(staff, row.ticket.id, { expectedVersion: 2 }, db), { status: 409 });
      assert.equal((await closeSupportTicket(staff, row.ticket.id, { expectedVersion: 3 }, db)).replayed, true);
      const replay = await replySupportTicket(staff, row.ticket.id, reply, db);
      assert.equal(replay.replayed, true); assert.equal(replay.ticket.status, "closed"); assert.equal(replay.messages.length, 2);
      assert.equal((await createSupportTicket(owner.id, payload, db)).ticket.status, "closed");
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("a real row lock serializes reply versus close, so one stale action conflicts without losing a message", async () => {
      const row = await create();
      let acquired!: () => void, release!: () => void;
      const held = new Promise<void>(resolve => { acquired = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      const blocker = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id"=${row.ticket.id} FOR UPDATE`;
        acquired(); await released;
      }, { timeout: 10_000 });
      await held;
      const concurrent = Promise.allSettled([
        replySupportTicket(staff, row.ticket.id, { requestId: crypto.randomUUID(), expectedVersion: 1, body: "并发答复" }, db),
        closeSupportTicket(owner, row.ticket.id, { expectedVersion: 1 }, db)
      ]);
      try {
        let waiting = 0;
        for (let attempt = 0; attempt < 80; attempt++) {
          // Keep observation outside the three connections occupied by blocker/reply/close in CI.
          const locks = await observer.$queryRaw<Array<{ waiting: number }>>`SELECT count(DISTINCT a.pid)::int AS waiting FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND NOT l.granted AND a.query LIKE '%SupportTicket%'`;
          waiting = locks[0]!.waiting; if (waiting >= 2) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(waiting >= 2, "both mutations must actually block at a PostgreSQL lock");
      } finally { release(); await blocker; }
      const results = await concurrent;
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const failure = results.find(result => result.status === "rejected");
      assert.ok(failure && failure.status === "rejected"); assert.equal(failure.reason.status, 409);
      const current = await getSupportTicket(owner, row.ticket.id, db);
      assert.equal(current.ticket.version, 2);
      assert.equal(current.messages.length, current.ticket.status === "closed" ? 1 : 2);
      assert.ok(["answered", "closed"].includes(current.ticket.status));
    });

    await t.test("invalid text, categories, request keys and versions cannot mutate persisted conversations", async () => {
      const row = await create(), before = await snapshot();
      for (const invalid of [{ requestId: "bad" }, { requestId: "bad space key" }, { subject: " " }, { subject: "x".repeat(121) }, { body: "x".repeat(5001) }, { body: "nul\0text" }, { category: "invalid" }]) {
        await assert.rejects(createSupportTicket(owner.id, input(invalid), db), { status: 400 });
      }
      for (const invalid of [{ expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: "1" }, { body: " " }, { requestId: "" }]) {
        const reply = { requestId: crypto.randomUUID(), expectedVersion: 1, body: "invalid fixture", ...invalid } as ReplySupportTicketInput;
        await assert.rejects(replySupportTicket(owner, row.ticket.id, reply, db), { status: 400 });
      }
      await assert.rejects(closeSupportTicket(owner, row.ticket.id, { expectedVersion: 0 }, db), { status: 400 });
      assert.deepEqual(await snapshot(), before);
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    await observer.$disconnect();
  }
});
