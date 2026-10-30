import { useEffect, useRef, useState } from "react";
import { Copy, Download, Search } from "lucide-react";
import { redeemCodeStatus, type RedeemCode, type RedeemCodePage, type RedeemCodeQuery, type RedeemSummary } from "@aifilm/shared";
import { api } from "../lib/api";
import { InlineNotice, StatePanel } from "../design-system/ui";
import { RedeemHistory } from "../components/RedeemHistory";
import { AdminDialog } from "./AdminDialog";
import { AdminPagination } from "./AdminPagination";
import { confirmAdminAction } from "./AdminConfirm";
import { downloadRedeemCodes, redeemError, redeemNumber, redeemStatusLabels, redeemTime } from "./redeemModel";
import { RedeemEditor } from "./RedeemEditor";

export function RedeemTotals({ summary }: { summary: RedeemSummary }) {
  return <div className="redeem-totals">
    <div><span>兑换码</span><strong>{redeemNumber(summary.codes)}<small>份</small></strong><small>{summary.active} 可兑换 · {summary.scheduled} 未开始</small></div>
    <div><span>成功兑换</span><strong>{redeemNumber(summary.redemptions)}<small>次</small></strong><small>以实际到账记录为准</small></div>
    <div><span>已到账积分</span><strong>{redeemNumber(summary.redeemedCredits)}</strong><small>保留每次兑换时的额度</small></div>
    <div><span>待兑积分上限</span><strong>{redeemNumber(summary.remainingCredits)}</strong><small>可兑换与未开始码的剩余额度</small></div>
  </div>;
}

export function RedeemCodeList({ batchId, refreshKey, initialLegacy = false, onChanged, compact = false, disabled = false, onBusy }: {
  batchId?: string; refreshKey: number; initialLegacy?: boolean; onChanged: () => void; compact?: boolean; disabled?: boolean; onBusy?: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState<RedeemCodeQuery>({ page: 1, status: "all", legacy: initialLegacy });
  const [search, setSearch] = useState(""), [data, setData] = useState<RedeemCodePage>(), [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(""), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<RedeemCode>(), [history, setHistory] = useState<RedeemCode>();
  const gate = useRef(false), selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  useEffect(() => {
    let live = true; setLoading(true); setReadError(""); setData(undefined); setSelected([]);
    api.adminRedeemCodePage({ ...query, batchId }).then(result => {
      if (!result || !Array.isArray(result.items) || !result.summary) throw new Error("兑换码数据暂时不可用，请重新读取。");
      if (live) setData(result);
    }).catch(reason => { if (live) setReadError(redeemError(reason)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query, batchId, refreshKey, retry]);
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selected.length > 0 && selected.length < (data?.items.length ?? 0); }, [selected, data]);
  const blocked = disabled || loading || busy || !!readError;
  const chosen = (data?.items ?? []).filter(code => selected.includes(code.id));
  function filter(next: Partial<RedeemCodeQuery>) { setSelected([]); setMessage(""); setQuery(value => ({ ...value, ...next, page: 1 })); }
  async function setStatuses(enabled: boolean) {
    if (gate.current || blocked || !chosen.length) return;
    gate.current = true;
    try {
      if (!await confirmAdminAction(`将当前页选中的 ${chosen.length} 个兑换码${enabled ? "启用" : "停用"}。${enabled ? "批次已暂停、已过期或已用完的码仍不能兑换。" : "已到账积分及兑换记录保留。"}此操作一次提交，全部成功后生效。`, { title: `${enabled ? "启用" : "停用"}选中码`, confirmLabel: `${enabled ? "启用" : "停用"} ${chosen.length} 个码`, danger: !enabled })) return;
      setBusy(true); setError(""); setMessage("");
      if (chosen.some(code => !code.updatedAt)) throw new Error("版本信息缺失，请刷新码明细后再操作。");
      const result = await api.setRedeemCodeStatuses(chosen.map(code => ({ id: code.id, updatedAt: code.updatedAt! })), enabled);
      setMessage(`已处理 ${result.requested} 个码：${result.changed} 个已${enabled ? "启用" : "停用"}，${result.unchanged} 个原已处于该状态。`);
      setSelected([]); onChanged();
    } catch (reason) { setError(redeemError(reason)); setRetry(value => value + 1); }
    finally { setBusy(false); gate.current = false; }
  }
  async function exportFiltered() {
    if (gate.current || blocked) return;
    gate.current = true; setBusy(true); setError("");
    try {
      const result = await api.adminRedeemExport({ ...query, batchId });
      if (!result.items.length) { setMessage("当前筛选没有可导出的兑换码。"); return; }
      downloadRedeemCodes(result.items, batchId ? `批次筛选-${batchId.slice(-8)}` : "当前筛选", result.exportedAt);
      setMessage(`已导出当前筛选 ${result.total} 份，包含全部匹配页面。`);
    } catch (reason) { setError(redeemError(reason)); }
    finally { setBusy(false); gate.current = false; }
  }
  async function copyCode(code: RedeemCode) {
    try { await navigator.clipboard.writeText(code.code); setMessage(`已复制尾号 ${code.code.slice(-4)} 的兑换码。`); }
    catch { setError("复制失败，请选中完整兑换码手动复制。"); }
  }
  return <section className={compact ? "redeem-code-list" : "redeem-panel redeem-code-list"} aria-label={batchId ? "本批次码明细" : "码明细"} aria-busy={loading || busy}>
    {!compact ? <div className="redeem-section-head"><div><h2>精确查码与发放</h2><p>搜索和汇总覆盖全部匹配结果，勾选仅限当前页。</p></div></div> : null}
    {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
    {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    {!compact && data && !loading && !readError ? <><RedeemTotals summary={data.summary} /><p className="redeem-caption">以上为当前筛选范围汇总</p></> : null}
    <form className="redeem-filters" onSubmit={event => { event.preventDefault(); filter({ search: search.trim() }); }}>
      <label className="redeem-search"><span>搜索兑换码</span><div><Search size={16} /><input maxLength={200} value={search} disabled={disabled || busy} onChange={event => setSearch(event.target.value)} placeholder="完整码、尾号或活动名称" /></div></label>
      <label><span>兑换状态</span><select aria-label="兑换状态" disabled={disabled || busy || loading} value={query.status} onChange={event => filter({ status: event.target.value as RedeemCodeQuery["status"] })}><option value="all">全部状态</option>{Object.entries(redeemStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {!batchId ? <label><span>码来源</span><select aria-label="码来源" disabled={disabled || busy || loading} value={query.legacy ? "legacy" : "all"} onChange={event => filter({ legacy: event.target.value === "legacy" })}><option value="all">全部来源</option><option value="legacy">历史单码</option></select></label> : null}
      <button type="submit" className="admin-secondary-btn" disabled={disabled || loading || busy}>查找</button>
      {query.search || query.status !== "all" || query.legacy ? <button type="button" className="admin-text-btn" disabled={disabled || loading || busy} onClick={() => { setSearch(""); filter({ search: "", status: "all", legacy: false }); }}>重置</button> : null}
    </form>
    {loading ? <p role="status" className="redeem-note">正在读取码明细…</p> : readError ? <InlineNotice tone="error">{readError} <button type="button" className="admin-text-btn" onClick={() => setRetry(value => value + 1)}>重新读取码明细</button></InlineNotice> : data ? <>
      <fieldset className="redeem-fieldset" disabled={blocked}>
        <div className="redeem-selection">
          <label><input ref={selectAll} type="checkbox" aria-label="选择当前页全部兑换码" checked={!!data.items.length && selected.length === data.items.length} disabled={!data.items.length} onChange={event => setSelected(event.target.checked ? data.items.map(code => code.id) : [])} /><span>{selected.length ? `已选 ${selected.length} 个 · 仅当前页` : `本页 ${data.items.length} 个 · 可批量选择`}</span></label>
          <div className="redeem-actions">{selected.length ? <>
            <button type="button" className="admin-text-btn" onClick={() => setSelected([])}>取消选择</button>
            <button type="button" className="admin-text-btn" onClick={() => void setStatuses(true)}>启用选中</button>
            <button type="button" className="admin-text-btn danger" onClick={() => void setStatuses(false)}>停用选中</button>
            <button type="button" className="admin-secondary-btn" onClick={() => downloadRedeemCodes(chosen, "当前选择")}>导出选中 {selected.length} 份</button>
          </> : <button type="button" className="admin-secondary-btn" disabled={!data.total || data.total > 1000} title={data.total > 1000 ? "超过 1000 份，请缩小筛选范围" : "导出全部匹配页面"} onClick={() => void exportFiltered()}><Download size={15} />导出当前筛选 {redeemNumber(data.total)} 份</button>}</div>
        </div>
        {data.total > 1000 && !selected.length ? <p className="redeem-caption">每次最多导出 1,000 份。请缩小筛选范围，或勾选本页需要的码。</p> : null}
        {data.items.length ? <div className="redeem-table-wrap"><table className="redeem-table redeem-codes-table" aria-label="兑换码列表"><thead><tr><th><span className="creator-sr-only">选择</span></th><th>兑换码 / 活动</th><th>额度与次数</th><th>有效期</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.items.map(code => <tr key={code.id} className={selected.includes(code.id) ? "selected" : ""}>
          <td className="redeem-select-cell"><input type="checkbox" aria-label={`选择兑换码 ${code.code}`} checked={selected.includes(code.id)} onChange={event => setSelected(value => event.target.checked ? [...value, code.id] : value.filter(id => id !== code.id))} /></td>
          <td data-label="兑换码"><code className="redeem-code-value">{code.code}</code><small>{code.name}{!code.batchId ? " · 历史单码" : ""}</small></td>
          <td data-label="额度与次数"><strong>{redeemNumber(code.credits)} 积分 / 次</strong><small>已用 {code.usedCount} / {code.maxRedemptions} 次</small></td>
          <td data-label="有效期"><span>{code.endsAt ? `${redeemTime(code.endsAt)} 截止` : "长期有效"}</span><small>{code.startsAt ? `${redeemTime(code.startsAt)} 开始` : "立即开始"}</small></td>
          <td data-label="状态"><span className={`redeem-tag ${code.status === "active" ? "positive" : ""}`}>{redeemStatusLabels[code.status ?? redeemCodeStatus(code)]}</span>{code.batchEnabled === false ? <small>批次已暂停{code.enabled ? "" : " · 单码已停用"}</small> : null}</td>
          <td data-label="操作"><div className="redeem-actions"><button type="button" className="admin-text-btn" aria-label={`复制兑换码 ${code.code}`} onClick={() => void copyCode(code)}><Copy size={14} />复制</button><button type="button" className="admin-text-btn" onClick={() => setHistory(code)}>记录</button><button type="button" className="admin-text-btn primary" onClick={() => setEditor(code)}>编辑</button></div></td>
        </tr>)}</tbody></table></div> : <StatePanel compact title="没有匹配的兑换码" description="调整搜索、状态或来源后再查找。" />}
      </fieldset>
      <AdminPagination total={data.total} page={data.page} pageSize={data.pageSize} busy={blocked} onPageChange={page => { setSelected([]); setQuery(value => ({ ...value, page })); }} />
    </> : null}
    {editor ? <RedeemEditor code={editor} onClose={() => setEditor(undefined)} onSaved={() => { setEditor(undefined); setMessage("兑换码配置已保存。"); onChanged(); }} /> : null}
    {history ? <AdminDialog open title="兑换记录" description={`${history.name} · 尾号 ${history.code.slice(-4)}`} onClose={() => setHistory(undefined)} wide cancelLabel="关闭"><RedeemHistory admin codeId={history.id} refreshKey={refreshKey} /></AdminDialog> : null}
  </section>;
}
