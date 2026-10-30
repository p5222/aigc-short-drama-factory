import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, Download, Gift, Layers3, Plus, RefreshCw, Search } from "lucide-react";
import type { RedeemBatchPage, RedeemBatchRow, RedeemCode } from "@aifilm/shared";
import { api } from "../lib/api";
import { InlineNotice, StatePanel } from "../design-system/ui";
import { RedeemHistory } from "../components/RedeemHistory";
import { AdminDialog } from "./AdminDialog";
import { AdminPagination } from "./AdminPagination";
import { confirmAdminAction } from "./AdminConfirm";
import { downloadRedeemCodes, redeemNumber, redeemTime, redeemError } from "./redeemModel";
import { RedeemCodeList, RedeemTotals } from "./RedeemCodeList";
import { RedeemCreator } from "./RedeemEditor";
import "./redeem-workspace.css";

export function RedeemWorkspace({ userId }: { userId: string }) {
  const [tab, setTab] = useState<"batches" | "codes" | "history">("batches");
  const [refresh, setRefresh] = useState(0), [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState(""), [legacy, setLegacy] = useState(false);
  const [receipt, setReceipt] = useState<RedeemCode[]>([]);
  const refreshData = () => setRefresh(value => value + 1);
  return <div className="redeem-workspace">
    <div className="redeem-toolbar">
      <div className="redeem-tabs" role="group" aria-label="兑换码模块">
        {([["batches", "活动批次"], ["codes", "码明细"], ["history", "兑换记录"]] as const).map(([value, label]) =>
          <button type="button" key={value} disabled={busy} aria-pressed={tab === value} className={tab === value ? "active" : ""} onClick={() => { setTab(value); setLegacy(false); }}>{label}</button>)}
      </div>
      <div className="redeem-actions"><button type="button" className="admin-secondary-btn" disabled={busy} onClick={refreshData}><RefreshCw size={15} />刷新兑换码</button>
        <button type="button" className="admin-primary-btn" disabled={busy} onClick={() => setCreate(true)}><Plus size={16} />生成兑换码</button></div>
    </div>
    {receipt.length ? <div className="redeem-created" role="status">
      <CheckCircle2 size={21} /><div><strong>已生成 {receipt.length} 个兑换码 · {receipt[0].name}</strong><p>每次 {redeemNumber(receipt[0].credits)} 积分。进入批次核对状态后即可发放。</p></div>
      <div className="redeem-actions"><button type="button" className="admin-secondary-btn" onClick={() => downloadRedeemCodes(receipt, "新批次")}>导出新批次</button>
        <button type="button" className="admin-text-btn primary" onClick={() => setBatchId(receipt[0].batchId ?? "")}>查看新批次<ArrowUpRight size={14} /></button>
        <button type="button" className="admin-text-btn" onClick={() => setReceipt([])}>收起</button></div>
    </div> : null}
    {tab === "batches" ? <RedeemBatches refreshKey={refresh} onOpen={setBatchId} onLegacy={() => { setLegacy(true); setTab("codes"); }} onCreate={() => setCreate(true)} /> : null}
    {tab === "codes" ? <RedeemCodeList key={legacy ? "legacy" : "all"} refreshKey={refresh} initialLegacy={legacy} onChanged={refreshData} onBusy={setBusy} /> : null}
    {tab === "history" ? <div className="redeem-panel"><RedeemHistory admin refreshKey={refresh} /></div> : null}
    {create ? <RedeemCreator userId={userId} onClose={() => setCreate(false)} onCreated={codes => { setReceipt(codes); setCreate(false); refreshData(); }} /> : null}
    {batchId ? <RedeemBatchDetail batchId={batchId} refreshKey={refresh} onClose={() => setBatchId("")} onChanged={refreshData} /> : null}
  </div>;
}

function RedeemBatches({ refreshKey, onOpen, onLegacy, onCreate }: { refreshKey: number; onOpen: (id: string) => void; onLegacy: () => void; onCreate: () => void }) {
  const [data, setData] = useState<RedeemBatchPage>(), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [keyword, setKeyword] = useState(""), [page, setPage] = useState(1);
  const [status, setStatus] = useState<"all" | "enabled" | "disabled">("all"), [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setLoading(true); setError(""); setData(undefined);
    api.adminRedeemBatches({ page, search: keyword, status }).then(result => {
      if (!result || !Array.isArray(result.items)) throw new Error("批次数据暂时不可用，请重新读取。");
      if (live) setData(result);
    }).catch(reason => { if (live) setError(redeemError(reason)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [page, keyword, status, refreshKey, retry]);
  const filtered = keyword || status !== "all";
  return <section className="redeem-panel" aria-label="活动批次" aria-busy={loading}>
    <div className="redeem-section-head"><div><h2><Layers3 size={18} />按活动管理发放</h2><p>每个批次独立控制开关，兑换与到账明细长期保留。</p></div>
      {data && data.legacyCodes > 0 ? <button type="button" className="admin-text-btn" onClick={onLegacy}>历史单码 {redeemNumber(data.legacyCodes)} 份<ArrowUpRight size={14} /></button> : null}</div>
    <form className="redeem-filters" onSubmit={event => { event.preventDefault(); setKeyword(search.trim()); setPage(1); setRetry(value => value + 1); }}>
      <label className="redeem-search"><span>搜索批次</span><div><Search size={16} /><input maxLength={200} value={search} onChange={event => setSearch(event.target.value)} placeholder="活动名称、前缀或批次编号" /></div></label>
      <label><span>批次开关</span><select aria-label="批次开关" value={status} disabled={loading} onChange={event => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="all">全部批次</option><option value="enabled">已开放</option><option value="disabled">已暂停</option></select></label>
      <button type="submit" className="admin-secondary-btn" disabled={loading}>搜索批次</button>
      {filtered ? <button type="button" className="admin-text-btn" disabled={loading} onClick={() => { setKeyword(""); setSearch(""); setStatus("all"); setPage(1); }}>重置</button> : null}
    </form>
    {loading ? <p className="redeem-note" role="status">正在读取活动批次…</p> : error ? <InlineNotice tone="error">{error} <button type="button" className="admin-text-btn" onClick={() => setRetry(value => value + 1)}>重新读取批次</button></InlineNotice> : data ? <>
      <p className="redeem-caption">共 {redeemNumber(data.total)} 个匹配批次 · 每行额度按完整批次计算</p>
      {data.items.length ? <div className="redeem-table-wrap"><table className="redeem-table" aria-label="活动批次列表"><thead><tr><th>活动 / 批次</th><th>码数与进展</th><th>实际到账积分</th><th>待兑积分上限</th><th>批次开关</th><th>操作</th></tr></thead>
        <tbody>{data.items.map(batch => <tr key={batch.id}>
          <td data-label="活动"><button type="button" className="redeem-name" onClick={() => onOpen(batch.id)}>{batch.name}</button><small className="redeem-mono">{batch.prefix} · {batch.id.slice(-10)}</small><small>{redeemTime(batch.createdAt)}</small></td>
          <td data-label="码数与进展"><strong>{redeemNumber(batch.summary.codes)} 份</strong><small>{redeemNumber(batch.summary.redemptions)} 次兑换 · {redeemNumber(batch.summary.active)} 份可兑换</small><div className="redeem-progress" aria-label={`${batch.summary.used_up} 份已用完，共 ${batch.summary.codes} 份`}><i style={{ width: `${batch.summary.codes ? batch.summary.used_up / batch.summary.codes * 100 : 0}%` }} /></div></td>
          <td data-label="实际到账"><strong>{redeemNumber(batch.summary.redeemedCredits)}</strong><small>累计积分</small></td>
          <td data-label="待兑上限"><strong>{redeemNumber(batch.summary.remainingCredits)}</strong><small>含尚未开始的码</small></td>
          <td data-label="批次开关"><span className={`redeem-tag ${batch.enabled ? "positive" : ""}`}>{batch.enabled ? "已开放" : "已暂停"}</span></td>
          <td data-label="操作"><button type="button" className="admin-text-btn primary" onClick={() => onOpen(batch.id)}>管理批次<ArrowUpRight size={14} /></button></td>
        </tr>)}</tbody></table></div> : <StatePanel compact title={filtered ? "没有匹配的活动批次" : "创建第一批兑换码"} description={filtered ? "调整活动名称或批次开关后再搜索。" : "为新用户体验、活动赠送或定向补偿建立独立批次。"} action={!filtered ? <button type="button" className="admin-primary-btn" onClick={onCreate}><Gift size={16} />生成兑换码</button> : undefined} />}
      <AdminPagination total={data.total} page={data.page} pageSize={data.pageSize} onPageChange={setPage} />
    </> : null}
  </section>;
}

function RedeemBatchDetail({ batchId, refreshKey, onClose, onChanged }: { batchId: string; refreshKey: number; onClose: () => void; onChanged: () => void }) {
  const [batch, setBatch] = useState<RedeemBatchRow>(), [loading, setLoading] = useState(true), [readError, setReadError] = useState("");
  const [tab, setTab] = useState<"codes" | "history">("codes"), [retry, setRetry] = useState(0);
  const [childBusy, setChildBusy] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const gate = useRef(false);
  useEffect(() => {
    let live = true; setLoading(true); setReadError("");
    api.adminRedeemBatches({ search: batchId }).then(result => {
      const current = result.items.find(row => row.id === batchId);
      if (!current) throw new Error("此批次暂时无法读取，请刷新核对。");
      if (live) setBatch(current);
    }).catch(reason => { if (live) setReadError(redeemError(reason)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [batchId, refreshKey, retry]);
  async function toggleBatch() {
    if (!batch || gate.current || loading || readError) return;
    gate.current = true;
    const enabled = !batch.enabled;
    try {
      if (!await confirmAdminAction(`${enabled ? "恢复" : "暂停"}「${batch.name}」整批 ${redeemNumber(batch.summary.codes)} 个码？单码启停设置会保留。${enabled ? "过期或用完的码仍不能兑换。" : "暂停期间所有码均不能兑换，已到账积分不受影响。"}`, { title: enabled ? "恢复批次" : "暂停批次", confirmLabel: enabled ? "恢复整批" : "暂停整批", danger: !enabled })) return;
      setBusy(true); setError(""); setMessage("");
      await api.setRedeemBatchStatus(batch.id, enabled, batch.updatedAt);
      setMessage(enabled ? "批次已恢复，单码启停设置已保留。" : "批次已暂停，兑换记录及单码设置已保留。");
      onChanged();
    } catch (reason) { setError(redeemError(reason)); setRetry(value => value + 1); }
    finally { gate.current = false; setBusy(false); }
  }
  async function exportBatch(distributable: boolean) {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError("");
    try {
      const result = await api.adminRedeemExport({ batchId, ...(distributable ? { distributable: true } : {}) });
      if (!result.items.length) { setMessage("当前范围没有可导出的兑换码。"); return; }
      downloadRedeemCodes(result.items, `${distributable ? "可发放" : "整批"}-${batchId.slice(-8)}`, result.exportedAt);
      setMessage(`已导出${distributable ? "可发放" : "整批"} ${result.total} 份。`);
    } catch (reason) { setError(redeemError(reason)); }
    finally { gate.current = false; setBusy(false); }
  }
  return <AdminDialog open title="批次详情" description={batch ? `${batch.name} · ${batch.id}` : "正在读取批次"} onClose={onClose} busy={busy || childBusy} wide cancelLabel="关闭">
    <div className="redeem-detail">
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {loading ? <p role="status" className="redeem-note">正在核对批次数据…</p> : readError ? <InlineNotice tone="error">{readError}<button type="button" className="admin-text-btn" onClick={() => setRetry(value => value + 1)}>重新读取批次</button></InlineNotice> : null}
      {batch ? <><fieldset className="redeem-fieldset" disabled={busy || childBusy || loading || !!readError}>
        <div className="redeem-batch-gate"><div><span className={`redeem-tag ${batch.enabled ? "positive" : ""}`}>{batch.enabled ? "批次已开放" : "批次已暂停"}</span><p>批次开关统一控制兑换入口，恢复时保留单码启停设置。</p></div>
          <button type="button" className={batch.enabled ? "admin-secondary-btn" : "admin-primary-btn"} onClick={() => void toggleBatch()}>{batch.enabled ? "暂停批次" : "恢复批次"}</button></div>
        <RedeemTotals summary={batch.summary} />
        <div className="redeem-export-row"><p>可发放仅含当前可兑换且从未使用过的码。单次导出上限 1,000 份。</p><div className="redeem-actions">
          <button type="button" className="admin-secondary-btn" onClick={() => void exportBatch(true)}><Download size={15} />导出可发放码</button>
          <button type="button" className="admin-text-btn" onClick={() => void exportBatch(false)}>导出整批</button></div></div>
        <div className="redeem-tabs" role="group" aria-label="批次详情内容"><button type="button" className={tab === "codes" ? "active" : ""} aria-pressed={tab === "codes"} onClick={() => setTab("codes")}>本批次码明细</button><button type="button" className={tab === "history" ? "active" : ""} aria-pressed={tab === "history"} onClick={() => setTab("history")}>本批次兑换记录</button></div>
      </fieldset>
      {tab === "codes" ? <RedeemCodeList batchId={batchId} refreshKey={refreshKey} onChanged={onChanged} onBusy={setChildBusy} disabled={busy || loading || !!readError} compact /> : <RedeemHistory admin batchId={batchId} refreshKey={refreshKey} />}
      </> : null}
    </div>
  </AdminDialog>;
}
