import { useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { CreditPolicy, CreditPricingOverview, CreditAccountRow, CreditBillingTask, CreditPage } from "@aifilm/shared";
import { api } from "../lib/api";
import { InlineNotice, StatePanel } from "../design-system/ui";
import { ModelIdentity } from "../components/ModelIdentity";
import { canLeaveAdminEditor } from "./adminDirtyState";
import { CreditPolicyPanel } from "./CreditPolicyPanel";
import { CreditRuleEditor } from "./CreditRuleEditor";
import { CreditAccountDialog, CreditPagination, CreditTaskDialog } from "./CreditDetailDialogs";
import { cashMargin, creditCostStates, creditDate, creditMoney, creditNumber, creditTaskStates } from "./creditPresentation";
import "./credit-center.css";

type CreditTab = "pricing" | "accounts" | "tasks";
export function CreditCenter() {
  const [tab, setTab] = useState<CreditTab>("pricing");
  const [overview, setOverview] = useState<CreditPricingOverview>(), [draft, setDraft] = useState<CreditPolicy>();
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(""), [keyword, setKeyword] = useState(""), [page, setPage] = useState(1), [status, setStatus] = useState("");
  const [accounts, setAccounts] = useState<CreditPage<CreditAccountRow>>(), [tasks, setTasks] = useState<CreditPage<CreditBillingTask>>();
  const [account, setAccount] = useState<CreditAccountRow>(), [task, setTask] = useState<CreditBillingTask>();
  const [editorReset, setEditorReset] = useState(0);
  const gate = useRef(false);
  const policyDirty = !!draft && !!overview && JSON.stringify(draft) !== JSON.stringify(overview.policy);
  useEffect(() => {
    let live = true; setLoading(true); setError("");
    const read = tab === "pricing" ? api.creditPricing().then(data => { if (live) { setOverview(data); setDraft(data.policy); } })
      : tab === "accounts" ? api.creditAccounts(page, keyword).then(data => { if (live) setAccounts(data); })
      : api.creditBillingTasks(page, keyword, status).then(data => { if (live) setTasks(data); });
    read.catch(reason => { if (live) setError(reason.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [tab, page, keyword, status, refresh]);
  async function mutate(run: () => Promise<unknown>, success: string) {
    if (gate.current) return false;
    gate.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await run(); if (result === false) return false;
      setMessage(success); setRefresh(value => value + 1); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败，请核对后重试"); return false; }
    finally { gate.current = false; setBusy(false); }
  }
  function switchTab(next: CreditTab) {
    if (next === tab || busy || !canLeaveAdminEditor()) return;
    setTab(next); setPage(1); setSearch(""); setKeyword(""); setStatus(""); setError(""); setMessage("");
    setAccount(undefined); setTask(undefined); setAccounts(undefined); setTasks(undefined);
    if (overview) setDraft(overview.policy);
  }
  function refreshData() {
    if (busy || !canLeaveAdminEditor()) return;
    setAccount(undefined); setTask(undefined); setMessage(""); setEditorReset(value => value + 1); setRefresh(value => value + 1);
  }
  const items = tab === "accounts" ? accounts : tasks;
  return <div className="credit-center" aria-busy={busy || loading}>
    <div className="credit-toolbar">
      <div className="credit-tabs" role="group" aria-label="积分中心模块">{([["pricing", "计价与毛利"], ["accounts", "账户与资金"], ["tasks", "任务对账"]] as const).map(([id, title]) =>
        <button key={id} type="button" disabled={busy} aria-pressed={tab === id} className={tab === id ? "active" : ""} onClick={() => switchTab(id)}>{title}</button>)}</div>
      <button type="button" className="admin-secondary-btn" disabled={busy || loading} onClick={refreshData}><RefreshCw size={15} /> 刷新</button>
    </div>
    {error ? <InlineNotice tone="error">{error} <button type="button" className="admin-text-btn" disabled={busy || loading} onClick={refreshData}>重新读取</button></InlineNotice> : null}
    {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
    {loading ? <p role="status" className="credit-explanation">正在读取积分数据…</p> : null}
    {tab === "pricing" && overview && draft ? <fieldset className="credit-fields" disabled={busy || loading}>
      <CreditPolicyPanel key={`policy-${editorReset}`} overview={overview} draft={draft} setDraft={setDraft} busy={busy || loading} mutate={mutate} />
      <CreditRuleEditor key={`rules-${editorReset}`} overview={overview} busy={busy || loading} policyDirty={policyDirty} mutate={mutate} />
    </fieldset> : null}
    {tab !== "pricing" ? <section className="panel credit-section credit-list">
      <div className="credit-section-head"><div><h2>{tab === "accounts" ? "账户资金核对" : "任务结算明细"}</h2>
        <p>{tab === "accounts" ? "核对余额、冻结与资金来源；历史实收未知将保留标记。" : "每次任务的确认上限、实际扣费、释放积分与成本证据。"}</p></div>
        <span className="credit-tag">{items ? `${creditNumber(items.total)} ${tab === "accounts" ? "个匹配账户" : "条匹配任务"}` : "正在读取"}</span></div>
      <div className="credit-list-tools">
        <form className="credit-search" onSubmit={event => { event.preventDefault(); setKeyword(search.trim()); setPage(1); }}>
          <Search size={16} aria-hidden="true" /><label className="creator-sr-only" htmlFor="credit-search">搜索账户或任务</label>
          <input id="credit-search" placeholder={tab === "accounts" ? "用户名、邮箱或用户 ID" : "任务 ID、模型或任务名称"} value={search} onChange={event => setSearch(event.target.value)} />
          <button type="submit" className="admin-secondary-btn" disabled={loading}>搜索</button>
        </form>
        {tab === "tasks" ? <label className="credit-status-filter"><span>任务状态</span><select value={status} disabled={loading} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="">全部状态</option>{["succeeded", "failed", "running", "pending", "canceled", "refunded"].map(value => <option key={value} value={value}>{creditTaskStates[value]}</option>)}</select></label> : null}
        {keyword ? <button type="button" className="admin-text-btn" disabled={loading} onClick={() => { setSearch(""); setKeyword(""); setPage(1); }}>清空搜索</button> : null}
      </div>
      {!loading && !error && tab === "accounts" && accounts ? <>
        <p className="credit-list-caption">本页 {accounts.items.length} 个账户 · {accounts.items.filter(a => a.anomaly).length} 个存在核对差异</p>
        {accounts.items.length ? <div className="credit-table-scroll credit-responsive"><table aria-label="账户资金"><thead><tr><th>用户</th><th>可用 / 冻结</th><th>总余额</th><th>充值 / 生成消费</th><th>核对状态</th><th>操作</th></tr></thead><tbody>
          {accounts.items.map(a => <tr key={a.userId}>
            <td data-label="用户"><strong>{a.name}</strong><small>{a.email || a.userId}</small></td>
            <td data-label="可用 / 冻结"><b>{creditNumber(a.available)}</b> / {creditNumber(a.frozenBalance)}<small>流水冻结 {creditNumber(a.frozenLedger ?? 0)}</small></td>
            <td data-label="总余额">{creditNumber(a.balance)}<small>批次余额 {creditNumber(a.fundedBalance ?? 0)}{a.unclassifiedBalance ? ` · 未归档 ${creditNumber(a.unclassifiedBalance)}` : ""}</small></td>
            <td data-label="充值 / 生成消费">{creditNumber(a.totalRecharge)} / {creditNumber(a.totalConsume)}</td>
            <td data-label="核对状态"><span className={`credit-tag ${a.anomaly ? "warning" : "positive"}`}>{a.anomaly ? "有差异 · 请核对" : "消费与冻结流水一致"}</span></td>
            <td data-label="操作"><button type="button" className="admin-text-btn" onClick={() => setAccount(a)}>查看账务</button></td>
          </tr>)}
        </tbody></table></div> : <StatePanel compact title="暂无匹配账户" description="调整搜索条件后重试。" />}
      </> : null}
      {!loading && !error && tab === "tasks" && tasks ? <>
        <p className="credit-list-caption">本页 {tasks.items.length} 条任务 · {tasks.items.filter(t => t.settlement?.costStatus === "invoice_verified").length} 条账单成本已核验</p>
        {tasks.items.length ? <div className="credit-table-scroll credit-responsive"><table aria-label="任务对账"><thead><tr><th>任务 / 模型</th><th>状态</th><th>确认上限 / 实扣 / 释放</th><th>API 成本</th><th>实收分摊与毛利</th><th>核验</th></tr></thead><tbody>
          {tasks.items.map(t => <tr key={t.id}>
            <td data-label="任务 / 模型"><strong>{t.title}</strong><ModelIdentity model={t.model} compact /><small>{creditDate(t.createdAt)}</small></td>
            <td data-label="状态"><span className={`credit-tag ${t.status === "succeeded" ? "positive" : t.status === "failed" ? "warning" : ""}`}>{creditTaskStates[t.status] || "未知状态"}</span></td>
            <td data-label="上限 / 实扣 / 释放">{creditNumber(t.billing?.maximumCredits ?? t.estimatedCredits)} / {t.finalCredits == null ? "待结算" : creditNumber(t.finalCredits)} / {t.settlement?.releasedCredits == null ? "—" : creditNumber(t.settlement.releasedCredits)}
              {t.settlement?.capped ? <small className="credit-warning">超出上限由平台承担</small> : null}</td>
            <td data-label="API 成本">{creditMoney(t.settlement?.costMicros)}<small>{creditCostStates[t.settlement?.costStatus ?? ""] || "成本未知"}</small></td>
            <td data-label="实收与毛利">{t.settlement?.funding ? t.settlement.funding.unknownCredits ? "含实收未知积分" : creditMoney(t.settlement.funding.cashMicros) : "尚无资金分摊"}<small>{cashMargin(t)}</small>
              {t.settlement?.funding?.giftCredits ? <small>含赠送消费 {creditNumber(t.settlement.funding.giftCredits)} 积分</small> : null}</td>
            <td data-label="核验">{t.settlement?.routeMismatch ? <small className="credit-warning">模型路线不匹配</small> : null}
              <button type="button" className="admin-text-btn" disabled={["running", "pending"].includes(t.status)} onClick={() => setTask(t)}>核对账单</button></td>
          </tr>)}
        </tbody></table></div> : <StatePanel compact title="暂无匹配任务" description="调整搜索条件或状态后重试。" />}
      </> : null}
      {items && !error ? <CreditPagination page={page} total={items.total} pageSize={items.pageSize} setPage={setPage} busy={loading} /> : null}
    </section> : null}
    {account ? <CreditAccountDialog key={account.userId} account={account} onClose={() => setAccount(undefined)} /> : null}
    {task ? <CreditTaskDialog key={task.id} task={task} onClose={() => setTask(undefined)} onSaved={() => { setTask(undefined); setMessage("账单成本已核验，用户扣费保持不变。"); setRefresh(value => value + 1); }} /> : null}
  </div>;
}
