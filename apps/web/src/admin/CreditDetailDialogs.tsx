import { useEffect, useRef, useState } from "react";
import type { CreditAccountRow, CreditBillingTask, CreditFundingRow, CreditLedgerPage } from "@aifilm/shared";
import { api } from "../lib/api";
import { saveCreditCsv } from "../lib/creditCsv";
import { InlineNotice, StatePanel } from "../design-system/ui";
import { AdminDialog, AdminDialogActions } from "./AdminDialog";
import { ModelIdentity } from "../components/ModelIdentity";
import { cashMargin, creditCostStates, creditDate, creditLedgerNames, creditMoney, creditNumber, creditSources, creditTaskStates } from "./creditPresentation";

export function CreditPagination({ page, total, pageSize = 20, setPage, busy = false }: { page: number; total: number; pageSize?: number; setPage: (page: number) => void; busy?: boolean }) {
  return <div className="credit-pager"><span>共 {creditNumber(total)} 条 · 第 {page} / {Math.max(1, Math.ceil(total / pageSize))} 页</span>
    <button type="button" className="admin-secondary-btn" disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
    <button type="button" className="admin-secondary-btn" disabled={busy || page * pageSize >= total} onClick={() => setPage(page + 1)}>下一页</button></div>;
}
export function CreditAccountDialog({ account, onClose }: { account: CreditAccountRow; onClose: () => void }) {
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [lots, setLots] = useState<CreditFundingRow[]>(), [ledger, setLedger] = useState<CreditLedgerPage>();
  const [loading, setLoading] = useState(true), [exporting, setExporting] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const exportGate = useRef(false);
  useEffect(() => {
    let live = true; setLoading(true); setError(""); setLedger(undefined);
    Promise.all([api.creditFunding(account.userId), api.adminCreditLedger(account.userId, page)]).then(([funding, result]) => {
      if (live) { setLots(funding.items); setLedger(result); }
    }).catch(reason => { if (live) setError(reason.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [account.userId, page, retry]);
  async function exportPage() {
    if (!ledger || exportGate.current) return;
    exportGate.current = true; setExporting(true); setError(""); setMessage("");
    try { saveCreditCsv(await api.exportCreditLedger({ userId: account.userId, page: ledger.page, pageSize: ledger.pageSize }, true)); setMessage("本页流水已导出。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "导出失败，请重试"); }
    finally { exportGate.current = false; setExporting(false); }
  }
  return <AdminDialog open title={`账户账务 · ${account.name}`} description={account.email || account.userId} onClose={onClose} busy={exporting} wide cancelLabel="关闭账务"
    notice={error ? <InlineNotice tone="error">{error} <button className="admin-text-btn" onClick={() => setRetry(value => value + 1)}>重新读取</button></InlineNotice> : message ? <InlineNotice tone="success">{message}</InlineNotice> : null}>
    <div className="credit-detail">
      <div className="credit-stat-grid">
        <div><span>可用积分</span><strong>{creditNumber(account.available)}</strong></div>
        <div><span>冻结积分</span><strong>{creditNumber(account.frozenBalance)}</strong></div>
        <div><span>总余额</span><strong>{creditNumber(account.balance)}</strong></div>
        <div><span>资金批次余额</span><strong>{creditNumber(account.fundedBalance ?? 0)}</strong></div>
      </div>
      <p className={`credit-check ${account.anomaly ? "warning" : ""}`}>{account.anomaly ? "账务有差异，需进一步核对。" : "消费与冻结流水一致"}
        <small>消费记录 {creditNumber(account.consumeLedger)} / 账户累计 {creditNumber(account.totalConsume)}；冻结记录 {creditNumber(account.frozenLedger)} / 账户冻结 {creditNumber(account.frozenBalance)}。
          {account.unclassifiedBalance ? ` 未归档余额 ${creditNumber(account.unclassifiedBalance)}，实收未知。` : ""}</small></p>
      {loading ? <p role="status" className="credit-explanation">正在读取账户账务…</p> : null}
      {!loading && !error ? <>
        <h3>资金来源 <small>最近 100 批次</small></h3>
        <p className="credit-explanation">结算按入账顺序分摊，批次余额包含冻结积分。实收未知的批次不计作已核验现金收入。</p>
        {lots?.length ? <div className="credit-table-scroll credit-responsive"><table><thead><tr><th>来源 / 时间</th><th>原始 / 剩余积分</th><th>原始实收</th><th>凭据</th></tr></thead><tbody>
          {lots.map(lot => <tr key={lot.id}><td data-label="来源 / 时间"><span>{creditSources[lot.source] || "其他来源"}</span><small>{creditDate(lot.createdAt)}</small></td><td data-label="原始 / 剩余积分">{creditNumber(lot.originalCredits)} / {creditNumber(lot.remainingCredits)}</td><td data-label="原始实收">{creditMoney(lot.cashMicros)}</td><td data-label="凭据" className="credit-reference">{lot.referenceId || "无凭据"}</td></tr>)}
        </tbody></table></div> : <StatePanel compact title="尚无资金批次" description="历史余额的实收保持未知，后续入账和结算将按规则归档。" />}
        <div className="credit-section-head"><h3>账户流水</h3><button className="admin-secondary-btn" disabled={!ledger || exporting} onClick={() => void exportPage()}>{exporting ? "正在导出…" : "导出本页流水"}</button></div>
        {ledger?.items.length ? <div className="credit-table-scroll credit-responsive"><table><thead><tr><th>类型</th><th>积分变动</th><th>变动后总余额</th><th>说明 / 时间</th></tr></thead><tbody>
          {ledger.items.map(row => <tr key={row.id}><td data-label="类型">{creditLedgerNames[row.type] || "其他流水"}</td><td data-label="积分变动" className={row.amount > 0 ? "credit-positive" : ""}>{row.amount > 0 ? "+" : ""}{creditNumber(row.amount)}</td><td data-label="变动后总余额">{creditNumber(row.balanceAfter)}</td><td data-label="说明 / 时间">{row.description}<small>{creditDate(row.createdAt)}</small></td></tr>)}
        </tbody></table></div> : <StatePanel compact title="暂无流水" description="此账户还没有积分变动记录。" />}
      </> : null}
      {ledger ? <CreditPagination page={page} total={ledger.total} pageSize={ledger.pageSize} setPage={setPage} busy={loading || exporting} /> : null}
    </div>
  </AdminDialog>;
}
export function CreditTaskDialog({ task, onClose, onSaved }: { task: CreditBillingTask; onClose: () => void; onSaved: () => void }) {
  const [cost, setCost] = useState(""), [reference, setReference] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const gate = useRef(false);
  const settlement = task.settlement;
  const costMicros = Math.round(Number(cost) * 1000000);
  const valid = cost !== "" && Number.isSafeInteger(costMicros) && costMicros >= 0 && reference.trim().length > 0;
  async function save() {
    if (gate.current || !valid) return;
    gate.current = true; setBusy(true); setError("");
    try {
      await api.verifyCreditCost({ taskId: task.id, expectedUpdatedAt: task.updatedAt, costMicros, invoiceReference: reference.trim() });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "核验保存失败，请重试"); }
    finally { gate.current = false; setBusy(false); }
  }
  return <AdminDialog open wide title={`真实账单核验 · ${task.title}`} description="核验实际人民币成本，只更新成本证据，用户积分不变。" onClose={onClose} busy={busy}
    notice={error ? <InlineNotice tone="error">{error}</InlineNotice> : null}>
    <form id="credit-invoice-form" className="credit-detail" data-admin-dirty={cost !== "" || reference !== "" ? "true" : "false"} onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="credit-route-head"><ModelIdentity model={task.model} providerName={task.provider} /><span className="credit-tag">{creditTaskStates[task.status] || "未知状态"}</span></div>
      <div className="credit-stat-grid">
        <div><span>确认上限</span><strong>{creditNumber(task.billing?.maximumCredits ?? task.estimatedCredits)}</strong></div>
        <div><span>实际扣除</span><strong>{task.finalCredits == null ? "待结算" : creditNumber(task.finalCredits)}</strong></div>
        <div><span>已释放积分</span><strong>{settlement?.releasedCredits == null ? "—" : creditNumber(settlement.releasedCredits)}</strong></div>
        <div><span>当前成本</span><strong>{creditMoney(settlement?.costMicros)}</strong></div>
      </div>
      <p className="credit-explanation">{creditCostStates[settlement?.costStatus ?? ""] || "成本未知"} · {cashMargin(task)}。
        {settlement?.invoiceReference ? ` 原凭据：${settlement.invoiceReference}。` : ""}</p>
      {settlement?.capped || settlement?.routeMismatch ? <InlineNotice>{settlement.capped ? "费用超过确认上限，差额由平台承担。" : ""}{settlement.routeMismatch ? "本次模型路线不匹配，请核对实际调用渠道。" : ""}</InlineNotice> : null}
      <fieldset disabled={busy} className="credit-fields"><div className="credit-form-grid">
        <label>供应商账单成本（人民币元）<input required type="number" min="0" step=".000001" value={cost} onChange={e => setCost(e.target.value)} placeholder="填写最终结算成本" /></label>
        <label className="credit-form-double">账单编号或核验凭据<input required value={reference} maxLength={200} onChange={e => setReference(e.target.value)} placeholder="填写可追溯的供应商账单编号" /></label>
      </div></fieldset>
      <details className="credit-advanced"><summary>任务与用量信息</summary><dl className="credit-definition">
        <dt>任务 ID</dt><dd>{task.id}</dd><dt>最后更新</dt><dd>{creditDate(task.updatedAt)}</dd>
        <dt>报价政策</dt><dd>{task.billing ? `v${task.billing.policyVersion} · ${task.billing.mode === "official" ? "自动计价" : "手工计价"}` : "历史报价"}</dd>
        <dt>记录用量</dt><dd>{settlement?.usage ? Object.entries(settlement.usage).map(([key, value]) => `${({ inputTokens: "输入 Token", outputTokens: "输出 Token", cachedInputTokens: "缓存 Token", images: "图片张数", seconds: "视频秒数", characters: "配音字符数", resolution: "分辨率" } as Record<string, string>)[key] || key}：${value}`).join("；") : "暂无可核验用量"}</dd>
      </dl></details>
      <AdminDialogActions><button type="submit" form="credit-invoice-form" className="admin-primary-btn" aria-busy={busy} disabled={busy || !valid}>保存账单核验</button></AdminDialogActions>
    </form>
  </AdminDialog>;
}
