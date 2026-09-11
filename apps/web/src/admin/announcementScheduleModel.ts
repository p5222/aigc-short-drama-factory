export interface AnnouncementSchedule {
  startsAt?: string | null;
  endsAt?: string | null;
}

export type AnnouncementScheduleStatus = "disabled" | "scheduled" | "active" | "expired";
export const announcementStatusLabels: Record<AnnouncementScheduleStatus, string> = {
  disabled: "停用", scheduled: "待开始", active: "展示中", expired: "已过期"
};

/** Announcement calendar dates always use Beijing time, independently of the browser time zone. */
export function announcementDateInput(value?: string | null): string {
  if (!value) return "";
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

function dateBoundary(value: string, field: keyof AnnouncementSchedule): string | null | undefined {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const calendarDay = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== value) return undefined;
  const time = field === "startsAt" ? "00:00:00.000" : "23:59:59.999";
  return new Date(`${value}T${time}+08:00`).toISOString();
}

type ScheduleResult =
  | { ok: true; startsAt: string | null; endsAt: string | null; patch: AnnouncementSchedule }
  | { ok: false; field: keyof AnnouncementSchedule; error: string };

export function buildAnnouncementSchedule(dates: { startsAt: string; endsAt: string }, original?: AnnouncementSchedule): ScheduleResult {
  const patch: AnnouncementSchedule = {};
  const values: Record<keyof AnnouncementSchedule, string | null> = { startsAt: null, endsAt: null };
  for (const field of ["startsAt", "endsAt"] as const) {
    const changed = !original || dates[field] !== announcementDateInput(original[field]);
    const value = changed ? dateBoundary(dates[field], field) : original[field] ?? null;
    if (value === undefined || (value !== null && !Number.isFinite(Date.parse(value)))) {
      return { ok: false, field, error: `请填写有效的${field === "startsAt" ? "开始" : "结束"}日期。` };
    }
    values[field] = value;
    if (changed) patch[field] = value;
  }
  if (values.startsAt && values.endsAt && Date.parse(values.endsAt) <= Date.parse(values.startsAt)) {
    return { ok: false, field: "endsAt", error: "结束日期不能早于开始日期，结束时刻必须晚于开始时刻。请修改排期后再保存。" };
  }
  return { ok: true, ...values, patch };
}

export function announcementScheduleStatus(announcement: AnnouncementSchedule & { enabled: boolean }, now = Date.now()): AnnouncementScheduleStatus {
  if (!announcement.enabled) return "disabled";
  if (announcement.startsAt && Date.parse(announcement.startsAt) > now) return "scheduled";
  if (announcement.endsAt && Date.parse(announcement.endsAt) < now) return "expired";
  return "active";
}

interface AnnouncementFilterItem extends AnnouncementSchedule {
  title: string;
  body: string;
  type: string;
  enabled: boolean;
  pinned?: boolean;
}

/** Keep these selected rows until the filters or server list change; live status updates must not discard an editor. */
export function selectAnnouncementRows<T extends AnnouncementFilterItem>(
  announcements: readonly T[],
  filters: { keyword: string; type: string; segment: string },
  now = Date.now()
): T[] {
  const { keyword, type, segment } = filters;
  return announcements.filter((item) => {
    const matchedKeyword = `${item.title} ${item.body}`.toLowerCase().includes(keyword.toLowerCase());
    const matchedType = type === "all" || item.type === type;
    const matchedSegment = segment === "all" ||
      (segment === "pinned" && item.pinned) ||
      announcementScheduleStatus(item, now) === segment || item.type === segment;
    return matchedKeyword && matchedType && matchedSegment;
  });
}
