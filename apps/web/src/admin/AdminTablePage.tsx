import type { ReactNode } from "react";
import { canLeaveAdminEditor } from "./adminDirtyState";
import { StatePanel, InlineNotice } from "../design-system/ui";

export interface AdminColumn<T> {
  key: string;
  label: string;
  width?: string;
  align?: "left" | "right" | "center";
  sticky?: "right";
  render: (row: T) => ReactNode;
}

export function AdminTablePage<T>({
  title,
  summary,
  filters,
  actions,
  columns,
  rows,
  rowKey,
  loading,
  error,
  emptyText = "暂无数据",
  page,
  totalPages,
  total,
  pageSize,
  onPageSizeChange,
  onPageChange,
  onRowClick
}: {
  title: string;
  summary?: string;
  filters?: ReactNode;
  actions?: ReactNode;
  columns: AdminColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string;
  emptyText?: string;
  page?: number;
  totalPages?: number;
  total?: number;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: T) => void;
}) {
  return (
    <section className="adm-table-page">
      <header className="adm-page-heading">
        <div><h2>{title}</h2>{summary ? <p>{summary}</p> : null}</div>
        {actions}
      </header>
      {filters ? <div className="adm-filterbar">{filters}</div> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <p className="adm-table-mobile-hint">左右滑动表格，查看完整字段</p>
      <div className="adm-table-scroll" aria-busy={loading} role="region" aria-label={`${title}，表格可横向滚动`} tabIndex={0}>
        <table>
          <caption>{title}</caption>
          <thead><tr>{columns.map((column) => <th scope="col" key={column.key} data-sticky={column.sticky} style={{ width: column.width, textAlign: column.align }}>{column.label}</th>)}</tr></thead>
          <tbody>
            {!loading && !error && rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={onRowClick ? "adm-clickable-row" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("button,input,select,textarea,a,label,summary")) return;
                  onRowClick?.(row);
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget || !onRowClick || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  onRowClick(row);
                }}
              >
                {columns.map((column) => <td key={column.key} data-sticky={column.sticky} style={{ textAlign: column.align }}>{column.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? <StatePanel kind="loading" title="正在读取数据" description="列表同步后即可继续操作。" compact /> : !rows.length && !error ? <StatePanel title={emptyText} compact /> : null}
      </div>
      {page != null && totalPages != null ? (
        <footer className="adm-pagination">
          <span>{total != null && pageSize ? total === 0 ? "暂无匹配记录" : `第 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} 条，共 ${total.toLocaleString()} 条` : `第 ${page} / ${Math.max(1, totalPages)} 页`}</span>
          <div>
            {onPageSizeChange && pageSize ? <label className="adm-page-size">每页<select aria-label="每页条数" value={pageSize} disabled={loading} onChange={event => { if (canLeaveAdminEditor()) onPageSizeChange(Number(event.target.value)); }}>{[10, 25, 50, 100].map(size => <option key={size} value={size}>{size} 条</option>)}</select></label> : null}
            <button type="button" disabled={loading || !onPageChange || page <= 1} onClick={() => { if (canLeaveAdminEditor()) onPageChange?.(page - 1); }}>上一页</button>
            {total != null ? <span aria-live="polite">{page} / {Math.max(1, totalPages)}</span> : null}
            <button type="button" disabled={loading || !onPageChange || page >= totalPages} onClick={() => { if (canLeaveAdminEditor()) onPageChange?.(page + 1); }}>下一页</button>
          </div>
        </footer>
      ) : null}
    </section>
  );
}
