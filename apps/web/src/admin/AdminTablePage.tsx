import type { ReactNode } from "react";

export interface AdminColumn<T> {
  key: string;
  label: string;
  width?: string;
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
      {error ? <div className="adm-error" role="alert">{error}</div> : null}
      <div className="adm-table-scroll">
        <table>
          <thead><tr>{columns.map((column) => <th key={column.key} style={{ width: column.width }}>{column.label}</th>)}</tr></thead>
          <tbody>
            {!loading && rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={onRowClick ? "adm-clickable-row" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={() => onRowClick?.(row)}
                onKeyDown={(event) => {
                  if (!onRowClick || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  onRowClick(row);
                }}
              >
                {columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? <div className="adm-table-state" role="status">正在加载数据...</div> : !rows.length ? <div className="adm-table-state">{emptyText}</div> : null}
      </div>
      {page != null && totalPages != null ? (
        <footer className="adm-pagination">
          <span>第 {page} / {Math.max(1, totalPages)} 页</span>
          <div>
            <button type="button" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>上一页</button>
            <button type="button" disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)}>下一页</button>
          </div>
        </footer>
      ) : null}
    </section>
  );
}
