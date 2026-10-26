import { useEffect, useRef, useState } from "react";
import { Calculator, CheckCircle2, Download, RefreshCw, Search } from "lucide-react";
import { calculateOfficialCredits, officialSampleUsage, validateCostRule, type BillingUsage, type CreditPolicy, type CreditPricingOverview, type CreditAccountRow, type CreditBillingTask, type CreditFundingRow, type CreditLedgerPage, type CreditPage, type OfficialCostRule } from "@aifilm/shared";
import { api } from "../lib/api";
import { InlineNotice, StatePanel } from "../design-system/ui";
import { confirmAdminAction } from "./AdminConfirm";
import { canLeaveAdminEditor } from "./adminDirtyState";
import { saveCreditCsv } from "../lib/creditCsv";
import "./credit-center.css";

const money = (micros: number | null | undefined) => micros === null || micros === undefined ? "未核验" : `¥${(micros / 1000000).toFixed(4)}`;
const sourceName: Record<string, string> = { paid: "在线支付", gift: "推广赠送", legacy_unknown: "历史余额 · 实收未知", admin_unknown: "人工入账 · 实收未知", redeem_unknown: "卡密 · 实收未知", checkout_unverified: "测试支付 · 实收未知" };
const ledgerName: Record<string, string> = { recharge: "充值入账", consume: "消费扣费", freeze: "冻结积分", refund: "释放冻结", adjust: "后台调整" };
function cashMargin(task: CreditBillingTask) {
  const s = task.settlement, f = s?.funding;
  if (s?.costStatus !== "invoice_verified" || s.costMicros == null || !f || f.unknownCredits) return "现金毛利待核验";
  if (!f.cashMicros) return `无消费实收 · API成本${money(s.costMicros)}`;
  return `现金毛利 ${((f.cashMicros - s.costMicros) / f.cashMicros * 100).toFixed(2)}%`;
}
function Pagination({ page, total, setPage }: { page: number; total: number; setPage: (page: number) => void }) {
  return <div className="credit-pager"><span>共 {total} 条 · 第 {page} 页</span><button className="ghost-button" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><button className="ghost-button" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>下一页</button></div>;
}
export function CreditCenter() {
  const [tab, setTab] = useState("pricing"), [overview, setOverview] = useState<CreditPricingOverview>(), [draft, setDraft] = useState<CreditPolicy>();
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const gate = useRef(false);
  const [priceId, setPriceId] = useState(""), [ruleJson, setRuleJson] = useState(""), [preview, setPreview] = useState<string>(), [quantity, setQuantity] = useState(1);
  const [tokenInput, setTokenInput] = useState(8000), [tokenOutput, setTokenOutput] = useState(16000), [tokenCached, setTokenCached] = useState(0), [resolution, setResolution] = useState("720P");
  const [keyword, setKeyword] = useState(""), [page, setPage] = useState(1), [accounts, setAccounts] = useState<CreditPage<CreditAccountRow>>(), [tasks, setTasks] = useState<CreditPage<CreditBillingTask>>();
  const [userId, setUserId] = useState(""), [lots, setLots] = useState<CreditFundingRow[]>(), [ledger, setLedger] = useState<CreditLedgerPage>(), [ledgerPage, setLedgerPage] = useState(1);
  const [selectedTask, setSelectedTask] = useState<CreditBillingTask>(), [invoiceCost, setInvoiceCost] = useState(""), [invoiceReference, setInvoiceReference] = useState("");
  const [overviewLoading, setOverviewLoading] = useState(false), [listLoading, setListLoading] = useState(false), [fundingLoading, setFundingLoading] = useState(false);
  const loading = overviewLoading || listLoading || fundingLoading;
  const price = overview?.prices.find(p => p.id === priceId);
  const policyDirty = Boolean(draft && overview && JSON.stringify(draft) !== JSON.stringify(overview.policy));
  const ruleDirty = Boolean(price && ruleJson !== (price.billing || price.officialCandidate ? JSON.stringify(price.billing ?? price.officialCandidate, null, 2) : ""));
  useEffect(() => {
    let live = true; setOverviewLoading(true); setError("");
    api.creditPricing().then(data => { if (live) { setOverview(data); setDraft(data.policy); const p = data.prices.find(p => p.id === priceId); if (p) setRuleJson(p.billing || p.officialCandidate ? JSON.stringify(p.billing ?? p.officialCandidate, null, 2) : ""); } }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setOverviewLoading(false); });
    return () => { live = false; };
  }, [refresh]);
  useEffect(() => {
    let live = true;
    if (tab === "accounts" || tab === "tasks") {
      setListLoading(true); setError("");
      const read = tab === "accounts" ? api.creditAccounts(page, keyword).then(data => { if (live) setAccounts(data); }) : api.creditBillingTasks(page, keyword).then(data => { if (live) setTasks(data); });
      read.catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setListLoading(false); });
    }
    else setListLoading(false);
    return () => { live = false; };
  }, [tab, page, keyword, refresh]);
  useEffect(() => {
    let live = true;
    if (userId) {
      setLots(undefined); setLedger(undefined); setFundingLoading(true);
      Promise.all([api.creditFunding(userId), api.adminCreditLedger(userId, ledgerPage)]).then(([f, l]) => { if (live) { setLots(f.items); setLedger(l); } }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setFundingLoading(false); });
    }
    else setFundingLoading(false);
    return () => { live = false; };
  }, [userId, ledgerPage, refresh]);
  async function mutate(run: () => Promise<unknown>, success: string) {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError(""); setMessage("");
    try { const result = await run(); if (result === false) return; setMessage(success); setPreview(undefined); setRuleJson(""); setRefresh(v => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "操作失败，请核对后重试"); }
    finally { gate.current = false; setBusy(false); }
  }
  function switchTab(next: string) {
    if (!canLeaveAdminEditor()) return;
    setTab(next); setPage(1); setKeyword(""); setError(""); setMessage(""); setPreview(undefined);
    setSelectedTask(undefined); setInvoiceReference(""); setInvoiceCost("");
    setRuleJson(price?.billing || price?.officialCandidate ? JSON.stringify(price.billing ?? price.officialCandidate, null, 2) : "");
    if (overview) setDraft(overview.policy);
  }
  function choosePrice(id: string) {
    if (ruleDirty && !canLeaveAdminEditor()) return;
    setPriceId(id); setPreview(undefined);
    const p = overview?.prices.find(p => p.id === id);
    setRuleJson(p?.billing || p?.officialCandidate ? JSON.stringify(p.billing ?? p.officialCandidate, null, 2) : "");
  }
  const usage = (rule: OfficialCostRule): BillingUsage => rule.kind === "tokens" ? { inputTokens: tokenInput, outputTokens: tokenOutput, cachedInputTokens: tokenCached }
    : rule.kind === "image" ? { images: quantity } : rule.kind === "second" ? { seconds: quantity, resolution } : { characters: quantity };
  function previewRule() {
    setError("");
    try {
      if (!overview || !price) throw new Error("请选择模型价格");
      const rule = JSON.parse(ruleJson) as OfficialCostRule;
      validateCostRule(rule, overview.effectivePolicy);
      if (rule.model !== price.model) throw new Error("成本模型与当前价格不一致");
      const result = calculateOfficialCredits(rule, usage(rule), overview.effectivePolicy);
      setPreview(`当前参考单价 ${price.unitCredits} 积分；此用量官方成本 ${money(result.costMicros)}，新报价 ${result.payableCredits} 积分，毛利 ${result.marginBps === null ? "未知" : (result.marginBps / 100).toFixed(2) + "%"}。`);
    } catch (e) { setPreview(undefined); setError(e instanceof Error ? e.message : "规则格式不正确"); }
  }
  return <div className="credit-center" data-admin-dirty={policyDirty || ruleDirty || Boolean(invoiceReference) ? "true" : "false"}>
    <div className="credit-toolbar"><div className="credit-tabs" role="group" aria-label="积分中心模块">{[["pricing", "计价与毛利"], ["accounts", "账户与资金"], ["tasks", "任务对账"]].map(([id, title]) => <button key={id} type="button" aria-pressed={tab === id} className={tab === id ? "active" : ""} onClick={() => switchTab(id)}>{title}</button>)}</div><button className="ghost-button" disabled={busy} onClick={() => { if (canLeaveAdminEditor()) setRefresh(v => v + 1); }}><RefreshCw size={15} /> 刷新</button></div>
    {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}{message ? <InlineNotice tone="success">{message}</InlineNotice> : null}
    {loading ? <p role="status">正在读取积分数据…</p> : null}
    <fieldset disabled={busy || loading} className="credit-fields">
    {tab === "pricing" && overview && draft ? <>
      <section className="panel credit-section"><div className="panel-head"><div><h2>定价政策 <small>版本 {overview.version}</small></h2><p>售价 = 成本 ×（1 + 运营费用）÷（1 − 毛利）÷ 每积分价值</p></div><Calculator size={22} /></div>
        <div className="credit-form-grid"><label>目标毛利率（%）<input type="number" min="0" max="99.99" step=".01" value={draft.targetMarginBps / 100} onChange={e => setDraft({ ...draft, targetMarginBps: Math.round(Number(e.target.value) * 100) })} /></label>
        <label>每积分基础价值（元）<input type="number" min=".000001" step=".000001" value={draft.creditValueMicros / 1000000} onChange={e => setDraft({ ...draft, creditValueMicros: Math.round(Number(e.target.value) * 1000000) })} /></label>
        <label>美元结算汇率（人民币 / 美元）<input type="number" min=".000001" step=".000001" placeholder="未配置，美元规则不可应用" value={draft.usdCnyMicros === null ? "" : draft.usdCnyMicros / 1000000} onChange={e => setDraft({ ...draft, usdCnyMicros: e.target.value ? Math.round(Number(e.target.value) * 1000000) : null })} /></label>
        <label>运营费用 / API成本（%）<input type="number" min="0" max="100" value={draft.overheadBps / 100} onChange={e => setDraft({ ...draft, overheadBps: Math.round(Number(e.target.value) * 100) })} /></label>
        <label>促销毛利保护<select value={draft.protectMargin ? "true" : "false"} onChange={e => setDraft({ ...draft, protectMargin: e.target.value === "true" })}><option value="true">开启：考虑付费套餐赠送与成本底价</option><option value="false">关闭：允许折扣降低毛利</option></select></label></div>
        <p className="credit-explanation">当前有效每积分价值：{money(overview.effectivePolicy.creditValueMicros)}，保护开启时包含现售套餐及仍有余额的历史付费批次。自动成本规则不低于成本底价，会员实际减免以任务报价为准。40%为API口径毛利，赠送和实收未知资金不保证现金毛利。</p>
        <button className="primary-button" disabled={!policyDirty} onClick={() => void mutate(async () => { if (!await confirmAdminAction("保存定价政策？新任务采用新价，已经冻结的任务保留原报价。", { title: "保存积分政策", confirmLabel: "保存政策" })) return false; await api.saveCreditPolicy(overview.version, draft); }, "定价政策已保存；新任务使用新版本。")}>保存政策</button>
      </section>
      <section className="panel credit-section"><div className="panel-head"><div><h2>官方成本与调价预览</h2><p>先选模型，再核对官方来源、地域、日期与单位。</p></div></div>
        <label>模型价格<select value={priceId} onChange={e => choosePrice(e.target.value)}><option value="">请选择渠道与模型</option>{overview.prices.map(p => <option key={p.id} value={p.id}>{p.providerName} · {p.model}{p.billing ? " · 自动计价" : " · 手工计价"}</option>)}</select></label>
        {price ? <><p>{price.officialCandidate ? "已匹配核验目录，可预览后逐条应用。" : "该模型未匹配自动目录，请按真实渠道账单填写成本规则。"} {price.enabled ? "" : "该价格当前停用；应用成本规则不会自动启用模型。"}</p>
          <label>成本规则（JSON，金额为百万分之一货币）<textarea rows={9} value={ruleJson} placeholder='{"version":1,"currency":"USD","kind":"tokens",...}' onChange={e => { setRuleJson(e.target.value); setPreview(undefined); }} /></label>
          <div className="credit-form-grid"><label>图片张数 / 视频秒数 / 配音字符数<input type="number" min="0" value={quantity} onChange={e => { setQuantity(Number(e.target.value)); setPreview(undefined); }} /></label><label>输入 Token<input type="number" min="0" value={tokenInput} onChange={e => { setTokenInput(Number(e.target.value)); setPreview(undefined); }} /></label><label>输出 Token<input type="number" min="0" value={tokenOutput} onChange={e => { setTokenOutput(Number(e.target.value)); setPreview(undefined); }} /></label><label>缓存输入 Token<input type="number" min="0" value={tokenCached} onChange={e => { setTokenCached(Number(e.target.value)); setPreview(undefined); }} /></label><label>视频分辨率<select value={resolution} onChange={e => { setResolution(e.target.value); setPreview(undefined); }}><option>480P</option><option>720P</option><option>1080P</option></select></label></div>
          {preview ? <div className="credit-preview" role="status"><CheckCircle2 size={17} />{preview}</div> : null}
          <div className="credit-toolbar"><button className="ghost-button" onClick={previewRule}>预览报价</button><button className="primary-button" disabled={!preview} onClick={() => void mutate(async () => { if (!await confirmAdminAction(`${preview} 应用到 ${price.model} 的新任务？`, { title: "应用成本规则", confirmLabel: "应用此规则" })) return false; await api.saveCreditCostRule({ priceId: price.id, expectedUpdatedAt: price.updatedAt, expectedPolicyVersion: overview.version, rule: JSON.parse(ruleJson) }); }, "成本规则已应用，请核对最新模型价格。")}>应用预览规则</button>{price.billing ? <button className="ghost-button" onClick={() => void mutate(() => api.saveCreditCostRule({ priceId: price.id, expectedUpdatedAt: price.updatedAt, expectedPolicyVersion: overview.version, rule: null }), "已转为手工价格，单价保留。")}>切回手工计价</button> : null}</div></> : null}
      </section>
      <section className="panel credit-section"><h2>赠送与会员的实收影响</h2><div className="credit-table-scroll"><table><thead><tr><th>套餐</th><th>价格</th><th>本金 + 赠送积分</th><th>每积分实收</th><th>状态</th></tr></thead><tbody>{overview.plans.map(p => <tr key={p.id}><td>{p.name}</td><td>¥{p.price}</td><td>{p.credits} + {p.bonusCredits}</td><td>{money(p.cashValueMicros)}</td><td>{p.enabled ? "启用" : "停用"}</td></tr>)}</tbody></table></div>
        {overview.memberships.map(m => <p key={m.id}>{m.name}：¥{m.monthlyPrice} / 月，{m.monthlyCredits} 积分，减免{m.discountPercent}%；{m.enabled ? "启用" : "停用"}。</p>)}{overview.warnings.map(w => <p key={w} className="credit-explanation">{w}</p>)}
      </section>
    </> : null}
    {(tab === "accounts" || tab === "tasks") ? <div className="credit-search"><Search size={17} /><label className="creator-sr-only" htmlFor="credit-search">搜索账户或任务</label><input id="credit-search" placeholder={tab === "accounts" ? "搜索用户名、邮箱或用户ID" : "搜索任务ID、模型或任务名称"} value={keyword} onChange={e => { setKeyword(e.target.value); setPage(1); }} /></div> : null}
    {tab === "accounts" && accounts ? <><section className="panel credit-section"><div className="credit-table-scroll"><table><thead><tr><th>用户</th><th>可用 / 冻结</th><th>总余额</th><th>充值 / 生成消费</th><th>核对</th><th>操作</th></tr></thead><tbody>{accounts.items.map(a => <tr key={a.userId}><td>{a.name}<small>{a.email || a.userId}</small></td><td>{a.available} / {a.frozenBalance}<small>流水冻结 {a.frozenLedger ?? "—"}</small></td><td>{a.balance}<small>资金批次 {a.fundedBalance ?? "—"}{a.unclassifiedBalance ? ` · 历史未归档 ${a.unclassifiedBalance}` : ""}</small></td><td>{a.totalRecharge} / {a.totalConsume}</td><td>{a.anomaly ? "有差异 · 请核对" : "消费与冻结流水一致"}</td><td><button className="ghost-button" onClick={() => { setUserId(a.userId); setLedgerPage(1); }}>查看账务</button></td></tr>)}</tbody></table></div><Pagination page={page} total={accounts.total} setPage={setPage} />{!accounts.items.length ? <StatePanel compact title="暂无匹配账户" description="调整搜索条件后重试。" /> : null}</section>
      {userId ? <section className="panel credit-section"><div className="panel-head"><h2>账户账务 · {userId}</h2><button className="ghost-button" disabled={!ledger} onClick={() => void mutate(async () => saveCreditCsv(await api.exportCreditLedger({ userId, page: ledgerPage, pageSize: 20 }, true)), "本页流水已导出。")}><Download size={15} /> 导出本页流水</button></div>
        <h3>资金来源（最近100批次）</h3><p className="credit-explanation">资金在结算时按入账顺序分摊；冻结归属以任务流水为准，批次余额包含冻结积分。</p><div className="credit-table-scroll"><table><thead><tr><th>来源</th><th>原始 / 剩余积分</th><th>原始实收</th><th>凭据</th></tr></thead><tbody>{lots?.map(l => <tr key={l.id}><td>{sourceName[l.source] || l.source}</td><td>{l.originalCredits} / {l.remainingCredits}</td><td>{money(l.cashMicros)}</td><td>{l.referenceId || "—"}</td></tr>)}</tbody></table></div>{lots?.length === 0 ? <p>历史账户尚未参与新入账或结算；原余额的实收保持未知。</p> : null}
        <h3>账户流水</h3><div className="credit-table-scroll"><table><thead><tr><th>类型</th><th>积分</th><th>说明</th><th>时间</th></tr></thead><tbody>{ledger?.items.map(l => <tr key={l.id}><td>{ledgerName[l.type] || l.type}</td><td>{l.amount}</td><td>{l.description}</td><td>{new Date(l.createdAt).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>{ledger ? <Pagination page={ledgerPage} total={ledger.total} setPage={setLedgerPage} /> : null}
      </section> : null}</> : null}
    {tab === "tasks" && tasks ? <section className="panel credit-section"><div className="credit-table-scroll"><table><thead><tr><th>任务 / 模型</th><th>状态</th><th>上限 / 实扣 / 释放</th><th>API成本</th><th>实收分摊与毛利</th><th>异常与核验</th></tr></thead><tbody>{tasks.items.map(t => <tr key={t.id}><td>{t.title}<small>{t.model} · {t.id}</small></td><td>{t.status}</td><td>{t.billing?.maximumCredits ?? t.estimatedCredits} / {t.finalCredits ?? "待结算"} / {t.settlement?.releasedCredits ?? "—"}</td><td>{money(t.settlement?.costMicros)}<small>{({ invoice_verified: "账单已核验", usage_derived: "按供应商usage推导", output_quantity: "按交付数量推导" } as Record<string, string>)[t.settlement?.costStatus ?? ""] || "成本未知"}</small></td><td>{t.settlement?.funding && !t.settlement.funding.unknownCredits ? money(t.settlement.funding.cashMicros) : "含未知资金"}<small>{cashMargin(t)}</small>{t.settlement?.funding?.giftCredits ? <small>含赠送消费</small> : null}</td><td>{t.settlement?.capped ? <small>超确认上限，差额平台承担</small> : null}{t.settlement?.routeMismatch ? <small>模型路线不匹配</small> : null}<button className="ghost-button" disabled={["running", "pending"].includes(t.status)} onClick={() => { if (invoiceReference && !canLeaveAdminEditor()) return; setSelectedTask(t); setInvoiceCost(""); setInvoiceReference(""); }}>核对账单</button></td></tr>)}</tbody></table></div><Pagination page={page} total={tasks.total} setPage={setPage} />{!tasks.items.length ? <StatePanel compact title="暂无匹配任务" description="调整搜索条件后重试。" /> : null}
      {selectedTask ? <div className="credit-invoice"><h3>真实账单核验 · {selectedTask.title}</h3><div className="credit-form-grid"><label>供应商账单成本（人民币元）<input type="number" min="0" step=".000001" value={invoiceCost} onChange={e => setInvoiceCost(e.target.value)} /></label><label>账单编号或核验凭据<input value={invoiceReference} maxLength={200} onChange={e => setInvoiceReference(e.target.value)} /></label></div><p>只更新成本证据，用户积分不变。请填写实际人民币结算成本。</p><button className="primary-button" disabled={!invoiceReference.trim() || invoiceCost === ""} onClick={() => void mutate(async () => { await api.verifyCreditCost({ taskId: selectedTask.id, expectedUpdatedAt: selectedTask.updatedAt, costMicros: Math.round(Number(invoiceCost) * 1000000), invoiceReference }); setSelectedTask(undefined); setInvoiceReference(""); }, "账单成本已核验，用户扣费保持不变。")}>保存账单核验</button></div> : null}
    </section> : null}
    </fieldset>
  </div>;
}
