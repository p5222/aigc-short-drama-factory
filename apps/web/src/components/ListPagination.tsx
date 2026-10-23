import { ChevronLeft, ChevronRight } from "lucide-react";
import "./list-pagination.css";

export function ListPagination({ total, page, pageSize, onChange }: { total: number; page: number; pageSize: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return <nav className="list-pagination" aria-label="任务列表分页">
    <span role="status">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / 共 {total} 条</span>
    <div><button type="button" aria-label="上一页任务" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} /></button><span>{page} / {pages}</span><button type="button" aria-label="下一页任务" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={16} /></button></div>
  </nav>;
}
