import { useEffect, useState } from "react";
import type { RedeemHistoryPage } from "@aifilm/shared";
import { api } from "../lib/api";
import { InlineNotice, StatePanel } from "../design-system/ui";
import "./redeem-history.css";

export function RedeemHistory({ admin = false, codeId = "", batchId = "", refreshKey = 0 }: { admin?: boolean; codeId?: string; batchId?: string; refreshKey?: number }) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [data, setData] = useState<RedeemHistoryPage>(), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  useEffect(() => { setPage(1); }, [codeId, batchId, refreshKey]);
  useEffect(() => {
    let stale = false;
    setLoading(true); setError(""); setData(undefined);
    (admin ? api.adminRedeemHistory(page, codeId, batchId) : api.redeemHistory(page)).then(result => {
      if (!result || !Array.isArray(result.items)) throw new Error("兑换记录暂时不可用，请重试。");
      if (!stale) setData(result);
    }).catch(reason => { if (!stale) setError(reason instanceof Error ? reason.message : "兑换记录读取失败"); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [admin, page, codeId, batchId, refreshKey, retry]);
  const button = admin ? "admin-secondary-btn" : "ghost-button";
  return <section className="redeem-history" aria-label={admin ? "兑换记录" : "我的兑换记录"} aria-busy={loading}>
    <div className="redeem-history-heading"><div><h3>{admin ? "兑换记录" : "我的兑换记录"}</h3><p>按实际到账时间记录，每条保留当次积分。</p></div><button className={button} type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>刷新记录</button></div>
    {loading ? <p role="status">正在读取兑换记录…</p> : error ? <InlineNotice tone="error">{error}</InlineNotice> : data?.items.length ? <>
      <ol>{data.items.map(row => <li key={row.id}><div><strong>{row.name}</strong><small>{row.maskedCode}{row.user ? ` · ${row.user.name} (${row.user.id})` : ""}</small></div><div><strong>+{row.credits.toLocaleString()} 积分</strong><small>{new Date(row.createdAt).toLocaleString("zh-CN")}</small></div></li>)}</ol>
      <div className="redeem-history-pagination"><span>共 {data.total} 条 · 第 {data.page} 页</span><button className={button} disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><button className={button} disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>下一页</button></div>
    </> : <StatePanel compact title="暂无兑换记录" description={admin ? "此范围内还没有成功兑换记录。" : "成功兑换后，可以在这里核对到账积分和时间。"} />}
  </section>;
}
