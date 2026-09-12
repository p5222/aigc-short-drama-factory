import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { canLeaveAdminEditor } from "./adminDirtyState";
import { adminPageRange } from "./adminPaginationModel";

export function useAdminPagination<T>(rows: T[], resetKey: string, pageSize = 20) {
  const [requestedPage, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const range = adminPageRange(rows.length, requestedPage, pageSize);
  return { ...range, items: rows.slice(range.start, range.end), setPage };
}

export function AdminPagination({ total, page, pageSize = 20, onPageChange, busy = false }: { total: number; page?: number; pageSize?: number; onPageChange?: (page: number) => void; busy?: boolean }) {
  const range = adminPageRange(total, page, pageSize);
  const paginated = page !== undefined && Boolean(onPageChange);
  return <footer className="admin-list-footer"><span>{paginated && total ? `${range.start + 1}–${range.end} / 共 ${total} 条` : `共 ${total} 条`}</span>{paginated && range.pages > 1 ? <nav aria-label="列表分页"><button type="button" disabled={busy || range.page <= 1} aria-label="上一页" onClick={() => { if (canLeaveAdminEditor()) onPageChange?.(range.page - 1); }}><ChevronLeft size={16} /></button><span>{range.page} / {range.pages}</span><button type="button" disabled={busy || range.page >= range.pages} aria-label="下一页" onClick={() => { if (canLeaveAdminEditor()) onPageChange?.(range.page + 1); }}><ChevronRight size={16} /></button></nav> : null}</footer>;
}
