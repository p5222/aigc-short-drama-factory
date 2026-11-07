import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { TaskOperationRow, TaskResolutionResult } from "@aifilm/shared";
import { HttpError, requestJson } from "../lib/httpClient";
import { AdminTablePage } from "./AdminTablePage";
import { AdminMasterDetail } from "./AdminMasterDetail";
import { InlineNotice } from "../design-system/ui";
import { canLeaveAdminEditor } from "./adminDirtyState";

const labels: Record<string, string> = { pending: "待处理", running: "执行中", succeeded: "已完成", failed: "已失败", canceled: "已结束", refunded: "已释放" };
const attemptLabels: Record<string, string> = { prepared: "提交前", submitted: "已提交", rejected: "明确拒绝", not_submitted: "未提交", unknown: "结果未知", delivered: "已交付" };
type TaskPage = { items: TaskOperationRow[]; page: number; pageSize: number; total: number };

export function TaskOperations() {
  const [kind, setKind] = useState<"generation" | "export">("generation"), [view, setView] = useState("attention");
  const [page, setPage] = useState(1), [keyword, setKeyword] = useState(""), [reload, setReload] = useState(0);
  const [data, setData] = useState<TaskPage>({ items: [], total: 0, page: 1, pageSize: 30 });
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [selected, setSelected] = useState<TaskOperationRow>(), [reason, setReason] = useState(""), [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false), [detailError, setDetailError] = useState(""), [remote, setRemote] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<{ key: string; id: string } | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      void requestJson<TaskPage>(`/admin/task-operations?${new URLSearchParams({ kind, view, page: String(page), pageSize: "30", keyword })}`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) { setData(result); if (page > Math.max(1, Math.ceil(result.total / 30))) setPage(Math.max(1, Math.ceil(result.total / 30))); } })
        .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "任务列表读取失败。"); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [kind, view, page, keyword, reload]);
  function open(row: TaskOperationRow) {
    if (!canLeaveAdminEditor()) return;
    setSelected(row); setReason(""); setChecked(false); setDetailError(""); setRemote(""); setNeedsRefresh(false); attempt.current = undefined;
  }
  async function refreshDetail() {
    if (!selected || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const row = await requestJson<TaskOperationRow>(`/admin/task-operations/${selected.kind}/${encodeURIComponent(selected.id)}`);
      setSelected(row); setNeedsRefresh(false); setChecked(false); setDetailError(""); attempt.current = undefined;
    } catch (e) { setDetailError(e instanceof Error ? e.message : "详情读取失败，草稿已保留。"); setNeedsRefresh(true); }
    finally { lock.current = false; setBusy(false); }
  }
  async function query() {
    if (!selected || lock.current) return;
    lock.current = true; setBusy(true); setDetailError("");
    try {
      const result = await requestJson<{ status: string; message: string; checkedAt: string }>(`/admin/task-operations/generation/${encodeURIComponent(selected.id)}/query`, { method: "POST", body: "{}" });
      setRemote(`${labels[result.status] ?? result.status} · ${new Date(result.checkedAt).toLocaleTimeString("zh-CN")}。${result.message}`);
    } catch (e) { setDetailError(e instanceof Error ? e.message : "上游查询失败。"); }
    finally { lock.current = false; setBusy(false); }
  }
  async function resolve() {
    if (!selected || lock.current || needsRefresh || !checked || reason.trim().length < 8) return;
    lock.current = true; setBusy(true); setDetailError("");
    const key = JSON.stringify({ id: selected.id, kind: selected.kind, reason: reason.trim(), expectedUpdatedAt: selected.updatedAt });
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    try {
      const result = await requestJson<TaskResolutionResult>(`/admin/task-operations/${selected.kind}/${encodeURIComponent(selected.id)}/resolve`, {
        method: "POST", body: JSON.stringify({ requestId: attempt.current.id, reason: reason.trim(), expectedUpdatedAt: selected.updatedAt })
      });
      setMessage(`已结束 ${result.affectedTaskIds.length} 项关联任务，释放 ${result.releasedCredits} 积分。核对记录已保存。`);
      setReason(""); setChecked(false); setSelected(undefined); setReload(value => value + 1);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "处置结果暂未确认。请保留当前理由重试，将复用同一次操作。");
      if (e instanceof HttpError && e.status === 409) { setNeedsRefresh(true); setChecked(false); }
    }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
    <AdminTablePage title="异常任务核对" summary="默认显示失败记录，以及超过两分钟没有更新的未结束任务。先查供应商结果和冻结积分，再处置可结束的任务；已交付内容与已消耗积分保留。"
      actions={<button className="admin-secondary-btn" disabled={loading || busy} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} />刷新任务</button>}
      filters={<><select aria-label="任务类别" value={kind} onChange={e => { setKind(e.target.value as typeof kind); setPage(1); }}><option value="generation">生成任务</option><option value="export">导出任务</option></select>
        <select aria-label="核对范围" value={view} onChange={e => { setView(e.target.value); setPage(1); }}><option value="attention">待核对任务</option><option value="all">全部任务</option></select>
        <input aria-label="搜索任务" placeholder="任务、用户或作品 ID" value={keyword} onChange={e => { setKeyword(e.target.value); setPage(1); }} /></>}
      columns={[
        { key: "task", label: "任务", render: row => <div><strong>{row.title}</strong><small>{row.id}</small></div> },
        { key: "owner", label: "所属用户 / 作品", render: row => <div>{row.userId}<small>{row.projectName || row.projectId || row.contentProjectId || "未关联作品"}</small></div> },
        { key: "route", label: "渠道 / 模型", render: row => <div>{row.provider || "本地导出"}<small>{row.model || "—"}</small></div> },
        { key: "status", label: "状态", render: row => <span className="adm-status" data-status={row.status}>{row.reviewRequired ? "结果待核对" : labels[row.status] || row.status}</span> },
        { key: "frozen", label: "本项冻结", align: "right", render: row => `${row.frozenCredits} 积分` },
        { key: "updated", label: "最后更新", render: row => new Date(row.updatedAt).toLocaleString("zh-CN") },
        { key: "action", label: "核对", sticky: "right", render: row => <button className="adm-row-open" onClick={() => open(row)}>查看任务</button> }
      ]} rows={data.items} rowKey={row => row.id} loading={loading} error={error} emptyText="当前没有匹配的待核对任务。"
      page={page} totalPages={Math.max(1, Math.ceil(data.total / 30))} total={data.total} pageSize={30} onPageChange={setPage} onRowClick={open} />
    <AdminMasterDetail title="任务核对与结束" open={Boolean(selected)} onClose={() => setSelected(undefined)} busy={busy}
      footer={<><button className="admin-secondary-btn" disabled={busy} onClick={() => { if (canLeaveAdminEditor()) setSelected(undefined); }}>关闭详情</button>
        <button className="admin-primary-btn" disabled={busy || needsRefresh || !selected?.canResolve || !checked || reason.trim().length < 8} onClick={() => void resolve()}>{busy ? "处理中…" : "结束未交付任务并释放冻结"}</button></>}>
      {selected ? <div className="adm-audit-detail" data-admin-dirty={reason || checked ? "true" : "false"}>
        <dl><dt>平台任务</dt><dd>{selected.id}</dd><dt>所属用户</dt><dd>{selected.userId}</dd>
          <dt>执行状态</dt><dd>{labels[selected.status] ?? selected.status}</dd><dt>本项冻结 / 已扣费</dt><dd>{selected.frozenCredits} / {selected.chargedCredits} 积分</dd>
          <dt>上游任务编号</dt><dd>{selected.remoteTaskId || "未记录，请人工核对"}</dd><dt>素材指纹</dt><dd>{selected.sourceFingerprint || "未记录"}</dd>
          <dt>关联处理</dt><dd>{selected.contentProjectId ? "将一并结束同一内容操作下的未交付任务；已完成章节和剧本保留。" : selected.kind === "export" ? "仅结束此导出；配音任务与已完成素材单独保留。" : "仅释放本任务未消耗的冻结积分。"}</dd></dl>
        {selected.attempts.length ? <div><h3>持久调用记录</h3>{selected.attempts.map(item => <p key={item.id}>{attemptLabels[item.state] || item.state} · {new Date(item.submittedAt || item.startedAt).toLocaleString("zh-CN")}</p>)}</div> : null}
        {selected.canQuery ? <button className="admin-secondary-btn" disabled={busy} onClick={() => void query()}>查询原上游任务</button> : null}
        <button className="admin-secondary-btn" disabled={busy} onClick={() => void refreshDetail()}>刷新详情与核对记录</button>
        {selected.resolutions?.map(item => <p key={item.id}>已核对 · {new Date(item.createdAt).toLocaleString("zh-CN")} · 释放 {item.releasedCredits} 积分<br />{item.reason}</p>)}
        {remote ? <InlineNotice tone="info">{remote}</InlineNotice> : null}
        {detailError ? <InlineNotice tone="error">{detailError}</InlineNotice> : null}
        {!selected.canResolve ? <InlineNotice tone="info">当前任务已有结果、已经结束，或仍有近期心跳，不能在此结束。</InlineNotice> : <>
          <p>确认未交付后结束任务，会阻止旧进程继续保存结果。此操作不代表供应商没有产生费用；供应商费用请在积分中心按账单核对。</p>
          <label>核对依据<textarea aria-label="核对依据" rows={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="说明核对时间、供应商记录与未交付情况，至少 8 个字。请勿填写密钥或完整提示词。" /></label>
          <label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />我已核对供应商记录，确认结束未交付部分</label>
        </>}
      </div> : null}
    </AdminMasterDetail>
  </>;
}
