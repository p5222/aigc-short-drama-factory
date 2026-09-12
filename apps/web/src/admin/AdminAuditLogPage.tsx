import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { requestJson } from "../lib/httpClient";
import { AdminTablePage } from "./AdminTablePage";
import { AdminMasterDetail } from "./AdminMasterDetail";

interface AdminAuditLog {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  target: string;
  details: { fields?: string[]; values?: Record<string, unknown> };
  status: "started" | "succeeded" | "failed";
  statusCode?: number | null;
  createdAt: string;
  completedAt?: string | null;
}

const statusLabels = { started: "结果待核对", succeeded: "已成功", failed: "已失败" };

export function AdminAuditLogPage() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const [actorId, setActorId] = useState("");
  const [reload, setReload] = useState(0);
  const [rows, setRows] = useState<AdminAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const selected = rows.find((row) => row.id === selectedId);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ page: String(page), pageSize: "30", keyword: keyword.trim(), status, actorId: actorId.trim() });
      void requestJson<{ items: AdminAuditLog[]; total: number; page: number; pageSize: number }>(`/admin/audit-logs?${query}`, { signal: controller.signal }).then((result) => {
        if (!active) return;
        const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
        if (page > lastPage) { setPage(lastPage); return; }
        setRows(result.items);
        setTotal(result.total);
      }).catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "操作记录读取失败");
      }).finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [page, keyword, status, actorId, reload]);

  return <>
    <AdminTablePage
      title="管理员操作记录"
      summary={`共匹配 ${total} 条。记录操作人、目标和执行结果；“结果待核对”表示已记录请求，但尚无完成结果，需核对实际数据。`}
      actions={<button className="adm-icon-btn" type="button" disabled={loading} aria-label="刷新操作记录" onClick={() => setReload((value) => value + 1)}><RefreshCw /></button>}
      filters={<>
        <input aria-label="搜索操作目标" placeholder="搜索操作或目标路径" value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
        <input aria-label="操作人 ID" placeholder="按操作人 ID 筛选" value={actorId} onChange={(event) => { setActorId(event.target.value); setPage(1); }} />
        <select aria-label="执行结果" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">全部结果</option><option value="succeeded">已成功</option><option value="failed">已失败</option><option value="started">结果待核对</option></select>
      </>}
      columns={[
        { key: "date", label: "发生时间", render: (row) => new Date(row.createdAt).toLocaleString("zh-CN") },
        { key: "actor", label: "操作人", render: (row) => <div><strong>{row.actorId}</strong><small>{row.actorRole}</small></div> },
        { key: "action", label: "操作", render: (row) => row.action },
        { key: "target", label: "目标", render: (row) => row.target },
        { key: "result", label: "结果", render: (row) => <span className="adm-status" data-status={row.status}>{statusLabels[row.status] ?? row.status}</span> },
        { key: "code", label: "响应状态", render: (row) => row.statusCode ?? "待核对" }
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      emptyText="没有匹配的操作记录。请调整筛选条件；新操作完成后可刷新查看。"
      page={page}
      totalPages={Math.max(1, Math.ceil(total / 30))}
      onPageChange={setPage}
      onRowClick={(row) => setSelectedId(row.id)}
    />
    <AdminMasterDetail title="操作记录详情" open={Boolean(selected)} onClose={() => setSelectedId("")}>
      {selected ? <div className="adm-audit-detail"><dl>
        <dt>记录 ID</dt><dd>{selected.id}</dd>
        <dt>操作人</dt><dd>{selected.actorId} · {selected.actorRole}</dd>
        <dt>目标</dt><dd>{selected.action} {selected.target}</dd>
        <dt>执行结果</dt><dd>{statusLabels[selected.status] ?? selected.status}</dd>
        <dt>开始时间</dt><dd>{new Date(selected.createdAt).toLocaleString("zh-CN")}</dd>
        <dt>结束时间</dt><dd>{selected.completedAt ? new Date(selected.completedAt).toLocaleString("zh-CN") : "尚未记录，需核对实际数据"}</dd>
      </dl><details className="admin-advanced-panel"><summary>查看审计字段</summary><p>以下仅包含服务器允许记录的字段。</p><pre>{JSON.stringify(selected.details ?? {}, null, 2)}</pre></details></div> : null}
    </AdminMasterDetail>
  </>;
}
