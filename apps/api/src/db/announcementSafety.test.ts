import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;

test("announcement schedules merge and serialize real PostgreSQL updates", { skip: !databaseUrl, timeout: 30_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const observerUrl = new URL(databaseUrl!);
  observerUrl.searchParams.set("connection_limit", "1");
  const observer = new PrismaClient({ datasourceUrl: observerUrl.toString() });
  const { createPlatformAnnouncement, updatePlatformAnnouncement } = await import("./repository.js");
  const title = `announcement_schedule_${crypto.randomUUID()}`;
  const time = (day: number) => new Date(`2030-01-${String(day).padStart(2, "0")}T00:00:00.123Z`);
  const create = (extra = {}) => createPlatformAnnouncement({ title, body: "Schedule fixture", startsAt: time(10), endsAt: time(20), ...extra }, db);
  const signal = () => { let resolve!: () => void; return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() }; };
  try {
    await t.test("invalid and empty intervals create no record; a complete Beijing calendar day and open endpoints are valid", async () => {
      for (const input of [{ startsAt: time(20), endsAt: time(10) }, { startsAt: time(10), endsAt: time(10) }, { startsAt: new Date("invalid") }]) {
        await assert.rejects(create(input), { status: 400 });
      }
      assert.equal(await db.platformAnnouncement.count({ where: { title } }), 0);
      const sameDay = await create({ startsAt: new Date("2030-01-09T16:00:00.000Z"), endsAt: new Date("2030-01-10T15:59:59.999Z") });
      assert.equal(new Date(sameDay.endsAt!).getTime() - new Date(sameDay.startsAt!).getTime(), 86_399_999);
      const unlimited = await create({ startsAt: null, endsAt: null });
      assert.equal(unlimited.startsAt, undefined); assert.equal(unlimited.endsAt, undefined);
    });

    await t.test("one-ended patches validate the persisted other endpoint and rejected edits are atomic", async () => {
      const row = await create();
      const before = await db.platformAnnouncement.findUniqueOrThrow({ where: { id: row.id } });
      for (const input of [{ startsAt: time(25) }, { endsAt: time(5) }, { startsAt: time(20) }, { endsAt: time(10) }]) {
        await assert.rejects(updatePlatformAnnouncement(row.id, { ...input, pinned: true, body: "Must not persist" }, db), { status: 400 });
        assert.deepEqual(await db.platformAnnouncement.findUniqueOrThrow({ where: { id: row.id } }), before);
      }
      const renamed = await updatePlatformAnnouncement(row.id, { body: "Only text changes", startsAt: undefined, endsAt: undefined }, db);
      assert.equal(renamed.startsAt, before.startsAt!.toISOString()); assert.equal(renamed.endsAt, before.endsAt!.toISOString());
      await assert.rejects(updatePlatformAnnouncement(`missing_${crypto.randomUUID()}`, { endsAt: time(12) }, db), { status: 404 });
    });

    await t.test("explicit null clears an endpoint while omitted dates preserve exact instants", async () => {
      const row = await create();
      const clearedEnd = await updatePlatformAnnouncement(row.id, { endsAt: null }, db);
      assert.equal(clearedEnd.startsAt, time(10).toISOString()); assert.equal(clearedEnd.endsAt, undefined);
      const laterStart = await updatePlatformAnnouncement(row.id, { startsAt: time(25) }, db);
      assert.equal(laterStart.startsAt, time(25).toISOString()); assert.equal(laterStart.endsAt, undefined);
      const reversedOpen = await updatePlatformAnnouncement(row.id, { startsAt: null, endsAt: time(5) }, db);
      assert.equal(reversedOpen.startsAt, undefined); assert.equal(reversedOpen.endsAt, time(5).toISOString());
    });

    await t.test("two individually valid competing endpoint edits cannot commit an inverted combined interval", async () => {
      const row = await create(), held = signal(), release = signal();
      const blocker = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "PlatformAnnouncement" WHERE "id" = ${row.id} FOR UPDATE`;
        held.resolve(); await release.promise;
      }, { timeout: 15_000 });
      await held.promise;
      const concurrent = Promise.allSettled([
        updatePlatformAnnouncement(row.id, { startsAt: time(15) }, db),
        updatePlatformAnnouncement(row.id, { endsAt: time(12) }, db)
      ]);
      try {
        let waiting = 0;
        for (let attempt = 0; attempt < 60; attempt++) {
          const rows = await observer.$queryRaw<Array<{ waiting: number }>>`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%PlatformAnnouncement%'`;
          waiting = rows[0]!.waiting;
          if (waiting >= 2) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(waiting >= 2, "both edits must actually wait for the row lock before competing");
      } finally { release.resolve(); await blocker; }
      const results = await concurrent;
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const rejected = results.find(result => result.status === "rejected");
      assert.ok(rejected && rejected.status === "rejected"); assert.equal(rejected.reason.status, 400);
      const current = await db.platformAnnouncement.findUniqueOrThrow({ where: { id: row.id } });
      assert.ok(current.endsAt!.getTime() > current.startsAt!.getTime());
    });
  } finally {
    await db.platformAnnouncement.deleteMany({ where: { title } });
    await db.$disconnect();
    await observer.$disconnect();
  }
});
