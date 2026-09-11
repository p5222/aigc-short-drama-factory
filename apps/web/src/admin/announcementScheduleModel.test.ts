import assert from "node:assert/strict";
import test from "node:test";
import { announcementDateInput, announcementScheduleStatus, announcementStatusLabels, buildAnnouncementSchedule, selectAnnouncementRows } from "./announcementScheduleModel.ts";

test("one Beijing calendar day includes midnight through its final millisecond", () => {
  const result = buildAnnouncementSchedule({ startsAt: "2026-09-12", endsAt: "2026-09-12" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.startsAt, "2026-09-11T16:00:00.000Z");
  assert.equal(result.endsAt, "2026-09-12T15:59:59.999Z");
  assert.equal(Date.parse(result.endsAt!) - Date.parse(result.startsAt!), 86_399_999);
  assert.deepEqual(result.patch, { startsAt: result.startsAt, endsAt: result.endsAt });
});

test("Beijing calendar conversion handles year boundaries and leap days", () => {
  assert.equal(announcementDateInput("2025-12-31T16:00:00.000Z"), "2026-01-01");
  assert.equal(announcementDateInput("2026-09-12T15:59:59.999Z"), "2026-09-12");
  assert.equal(announcementDateInput("2026-09-12T16:00:00.000Z"), "2026-09-13");
  assert.equal(announcementDateInput(undefined), "");
  assert.equal(announcementDateInput("not-a-date"), "");
  const leap = buildAnnouncementSchedule({ startsAt: "2028-02-29", endsAt: "2028-03-01" });
  assert.equal(leap.ok, true);
  if (leap.ok) assert.equal(leap.startsAt, "2028-02-28T16:00:00.000Z");
});

test("title-only edits preserve precise original instants and omit date updates", () => {
  const original = { startsAt: "2026-09-11T18:34:56.789Z", endsAt: "2026-09-12T13:22:33.456Z" };
  const result = buildAnnouncementSchedule({ startsAt: announcementDateInput(original.startsAt), endsAt: announcementDateInput(original.endsAt) }, original);
  assert.deepEqual(result, { ok: true, ...original, patch: {} });
});

test("another computer's time zone cannot shift announcement calendar dates or boundaries", () => {
  const previous = process.env.TZ;
  try {
    for (const timeZone of ["America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
      process.env.TZ = timeZone;
      assert.equal(announcementDateInput("2026-09-11T16:00:00.000Z"), "2026-09-12");
      const result = buildAnnouncementSchedule({ startsAt: "2026-09-12", endsAt: "2026-09-12" });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.startsAt, "2026-09-11T16:00:00.000Z");
        assert.equal(result.endsAt, "2026-09-12T15:59:59.999Z");
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("editing one endpoint changes only that date and clearing explicitly removes its limit", () => {
  const original = { startsAt: "2026-09-11T18:34:56.789Z", endsAt: "2026-09-12T13:22:33.456Z" };
  const changed = buildAnnouncementSchedule({ startsAt: "2026-09-12", endsAt: "2026-09-13" }, original);
  assert.equal(changed.ok, true);
  if (changed.ok) {
    assert.equal(changed.startsAt, original.startsAt);
    assert.deepEqual(changed.patch, { endsAt: "2026-09-13T15:59:59.999Z" });
  }
  const cleared = buildAnnouncementSchedule({ startsAt: "", endsAt: "2026-09-12" }, original);
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.deepEqual(cleared.patch, { startsAt: null });
  assert.deepEqual(buildAnnouncementSchedule({ startsAt: "", endsAt: "" }), { ok: true, startsAt: null, endsAt: null, patch: { startsAt: null, endsAt: null } });
});

test("inverted, equal precise instants and invalid calendar dates produce field errors without changing input", () => {
  const dates = { startsAt: "2026-09-14", endsAt: "2026-09-13" };
  const result = buildAnnouncementSchedule(dates);
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.field, "endsAt"); assert.match(result.error, /结束/); }
  assert.deepEqual(dates, { startsAt: "2026-09-14", endsAt: "2026-09-13" });
  assert.equal(buildAnnouncementSchedule({ startsAt: "2026-02-29", endsAt: "" }).ok, false);
  assert.equal(buildAnnouncementSchedule({ startsAt: "2026-13-01", endsAt: "" }).ok, false);
  assert.equal(buildAnnouncementSchedule({ startsAt: "2026-09-12", endsAt: "2026-09-12" }, { startsAt: "2026-09-12T00:00:00.000Z", endsAt: "2026-09-12T00:00:00.000Z" }).ok, false);
});

test("partial edits validate the effective range against the untouched exact endpoint", () => {
  const original = { startsAt: "2026-09-12T16:15:00.000Z", endsAt: "2026-09-15T12:00:00.000Z" };
  assert.equal(buildAnnouncementSchedule({ startsAt: "2026-09-13", endsAt: "2026-09-12" }, original).ok, false);
});

test("status labels use one rule for disabled, scheduled, active and expired including exact boundaries", () => {
  const record = { enabled: true, startsAt: "2026-09-11T16:00:00.000Z", endsAt: "2026-09-12T15:59:59.999Z" };
  const start = Date.parse(record.startsAt), end = Date.parse(record.endsAt);
  assert.equal(announcementScheduleStatus(record, start - 1), "scheduled");
  assert.equal(announcementScheduleStatus(record, start), "active");
  assert.equal(announcementScheduleStatus(record, end), "active");
  assert.equal(announcementScheduleStatus(record, end + 1), "expired");
  assert.equal(announcementScheduleStatus({ ...record, enabled: false }, end + 1), "disabled");
  assert.equal(announcementScheduleStatus({ enabled: true }, start), "active");
  assert.equal(announcementStatusLabels.scheduled, "待开始");
  assert.equal(announcementStatusLabels.expired, "已过期");
});

test("selected editor rows survive live start and expiry status changes until an explicit reselection", () => {
  const start = Date.parse("2030-01-01T00:00:00.000Z"), end = start + 60_000;
  const row = { id: "scheduled", title: "Draft stays mounted", body: "Text", type: "info", enabled: true, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
  const filters = { keyword: "", type: "all", segment: "scheduled" };
  const scheduledRows = selectAnnouncementRows([row], filters, start - 1);
  assert.deepEqual(scheduledRows, [row]);
  assert.equal(announcementScheduleStatus(row, start), "active");
  assert.deepEqual(scheduledRows, [row], "a badge clock tick must leave the selected editor intact");
  assert.deepEqual(selectAnnouncementRows([row], filters, start), [], "explicit filter/list refresh uses the current schedule");

  const activeFilters = { ...filters, segment: "active" };
  const activeRows = selectAnnouncementRows([row], activeFilters, end);
  assert.deepEqual(activeRows, [row]);
  assert.equal(announcementScheduleStatus(row, end + 1), "expired");
  assert.deepEqual(activeRows, [row]);
  assert.deepEqual(selectAnnouncementRows([row], activeFilters, end + 1), []);
});

test("explicit filter and server list changes select the correct current rows without mutating announcements", () => {
  const now = Date.parse("2030-01-01T00:00:00.000Z");
  const rows = [
    { id: "pinned", title: "MODEL Update", body: "Current body", type: "update", enabled: true, pinned: true },
    { id: "disabled", title: "Model warning", body: "Current body", type: "warning", enabled: false, pinned: true },
    { id: "plain", title: "Other", body: "Model setup", type: "guide", enabled: true }
  ];
  const before = structuredClone(rows);
  const base = { keyword: "model", type: "all", segment: "active" };
  assert.deepEqual(selectAnnouncementRows(rows, base, now).map(row => row.id), ["pinned", "plain"]);
  assert.deepEqual(selectAnnouncementRows(rows, { ...base, segment: "pinned", type: "warning" }, now).map(row => row.id), ["disabled"]);
  assert.deepEqual(selectAnnouncementRows(rows, { ...base, segment: "disabled" }, now).map(row => row.id), ["disabled"]);
  assert.deepEqual(selectAnnouncementRows(rows, { ...base, segment: "guide" }, now).map(row => row.id), ["plain"]);
  const updated = rows.map(row => row.id === "pinned" ? { ...row, enabled: false } : row);
  assert.deepEqual(selectAnnouncementRows(updated, base, now).map(row => row.id), ["plain"]);
  assert.deepEqual(rows, before);
});
