import { useEffect, useState } from "react";
import type { RedeemHistoryPage } from "@aifilm/shared";
import { api } from "../lib/api";
import { InlineNotice, StatePanel } from "../design-system/ui";
import { downloadRedeemHistory } from "../admin/redeemModel";
import "./redeem-history.css";

export function RedeemHistory({ admin = false, codeId = "", batchId = "", refreshKey = 0 }: { admin?: boolean; codeId?: string; batchId?: string; refreshKey?: number }) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [data, setData] = useState<RedeemHistoryPage>(), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [applied, setApplied] = useState<{ search?: string; from?: string; to?: string }>({});
  useEffect(() => { setPage(1); }, [codeId, batchId, refreshKey]);
  useEffect(() => {
    let stale = false;
    setLoading(true); setError(""); setData(undefined);
    (admin ? api.adminRedeemHistory(page, codeId, batchId, applied) : api.redeemHistory(page)).then(result => {
      if (!result || !Array.isArray(result.items)) throw new Error("兑换记录暂时不可用，请重试。");
      if (!stale) setData(result);
    }).catch(reason => { if (!stale) setError(reason instanceof Error ? reason.message : "兑换记录读取失败"); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [admin, page, codeId, batchId, refreshKey, retry, applied]);
  const datesValid = !from || !to || from <= to;
  function applyFilters() {
    if (!datesValid) return;
    const exclusiveEnd = to ? new Date(`${to}T00:00:00`) : null;
    exclusiveEnd?.setDate(exclusiveEnd.getDate() + 1);
    setPage(1); setApplied({ search: search.trim(), ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}), ...(exclusiveEnd ? { to: exclusiveEnd.toISOString() } : {}) });
  }
  const button = admin ? "admin-secondary-btn" : "ghost-button";
  return <section className="redeem-history" aria-label={admin ? "兑换记录" : "我的兑换记录"} aria-busy={loading}>
    <div className="redeem-history-heading"><div><h3>{admin ? "兑换记录" : "我的兑换记录"}</h3><p>按实际到账时间记录，每条保留当次积分。</p></div><button className={button} type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>刷新记录</button></div>
    {admin ? <form className="redeem-history-filters" onSubmit={event => { event.preventDefault(); applyFilters(); }}>
      <label className="redeem-history-search"><span>搜索记录</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="活动、兑换码、用户名称或编号" maxLength={200} /></label>
      <label><span>到账开始日期</span><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label><span>到账结束日期</span><input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      <button className={button} type="submit" disabled={loading || !datesValid}>筛选记录</button>
      <button className={button} type="button" disabled={loading || !data?.items.length} onClick={() => data && downloadRedeemHistory(data)}>导出本页记录</button>
      {!datesValid ? <p role="alert">结束日期不能早于开始日期。</p> : null}
    </form> : null}
    {loading ? <p role="status">正在读取兑换记录…</p> : error ? <InlineNotice tone="error">{error}</InlineNotice> : data?.items.length ? <>
      <ol>{data.items.map(row => <li key={row.id}><div><strong>{row.name}</strong><small>{row.maskedCode}{row.user ? ` · ${row.user.name} (${row.user.id})` : ""}</small></div><div><strong>+{row.credits.toLocaleString()} 积分</strong><small>{new Date(row.createdAt).toLocaleString("zh-CN")}</small></div></li>)}</ol>
      <div className="redeem-history-pagination"><span>共 {data.total} 条 · 第 {data.page} 页</span><button className={button} disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><button className={button} disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>下一页</button></div>
    </> : <StatePanel compact title="暂无兑换记录" description={admin ? "此范围内还没有成功兑换记录。" : "成功兑换后，可以在这里核对到账积分和时间。"} />}
  </section>;
}
