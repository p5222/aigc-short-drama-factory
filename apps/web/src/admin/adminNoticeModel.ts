export function scopedAdminNotice(notice: { version: number; message: string; error: string }, openedAt: number) {
  return notice.version > openedAt ? { message: notice.message, error: notice.error } : { message: "", error: "" };
}
