export class AnnouncementScheduleError extends Error {
  constructor(public readonly status: 400 | 404, message: string) {
    super(message);
    this.name = "AnnouncementScheduleError";
  }
}

export function assertAnnouncementSchedule(startsAt?: Date | null, endsAt?: Date | null) {
  if ([startsAt, endsAt].some(value => value != null && (!(value instanceof Date) || !Number.isFinite(value.getTime())))) {
    throw new AnnouncementScheduleError(400, "公告开始和结束时间必须是有效日期。");
  }
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new AnnouncementScheduleError(400, "公告结束时间必须晚于开始时间，请检查完整生效区间。");
  }
}
