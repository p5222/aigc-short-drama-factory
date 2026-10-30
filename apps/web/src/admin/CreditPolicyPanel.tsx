import { useState } from "react";
import { validateCreditPolicy, type CreditPolicy, type CreditPricingOverview } from "@aifilm/shared";
import { InlineNotice } from "../design-system/ui";
import { api } from "../lib/api";
import { confirmAdminAction } from "./AdminConfirm";
import { creditMoney, creditNumber } from "./creditPresentation";

export function CreditPolicyPanel({ overview, draft, setDraft, busy, mutate }: {
  overview: CreditPricingOverview; draft: CreditPolicy; setDraft: (draft: CreditPolicy) => void; busy: boolean;
  mutate: (run: () => Promise<unknown>, message: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false), [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(overview.policy);
  return <section className="panel credit-section" data-admin-dirty={dirty ? "true" : "false"}>
    <div className="credit-section-head"><div><h2>定价政策 <small>v{overview.version}</small></h2><p>成本 → 运营费用 → 目标毛利 → 积分报价</p></div>
      {!editing ? <button type="button" className="admin-secondary-btn" disabled={busy} onClick={() => setEditing(true)}>编辑政策</button> : <span className="credit-tag">{dirty ? "有未保存修改" : "查看政策设置"}</span>}</div>
    <div className="credit-stat-grid">
      <div><span>目标 API 毛利</span><strong>{overview.policy.targetMarginBps / 100}<small>%</small></strong><small>按成本口径计算</small></div>
      <div><span>有效每积分价值</span><strong>{creditMoney(overview.effectivePolicy.creditValueMicros)}</strong><small>基础 {creditMoney(overview.policy.creditValueMicros)}</small></div>
      <div><span>促销毛利保护</span><strong className="credit-stat-label">{overview.policy.protectMargin ? "已开启" : "已关闭"}</strong><small>{overview.policy.protectMargin ? "计入付费套餐赠送影响" : "折扣可能降低毛利"}</small></div>
      <div><span>美元结算汇率</span><strong className="credit-stat-label">{overview.policy.usdCnyMicros == null ? "未配置" : overview.policy.usdCnyMicros / 1000000}</strong><small>{overview.policy.usdCnyMicros == null ? "美元规则暂不可应用" : "人民币 / 美元"}</small></div>
    </div>
    {editing ? <form className="credit-policy-form" onSubmit={event => {
      event.preventDefault(); setError("");
      try { validateCreditPolicy(draft); } catch (reason) { setError((reason as Error).message); return; }
      void mutate(async () => {
        if (!await confirmAdminAction("保存定价政策？新任务采用新价，已经冻结的任务保留原报价。", { title: "保存积分政策", confirmLabel: "保存政策" })) return false;
        return api.saveCreditPolicy(overview.version, draft);
      }, "定价政策已保存；新任务使用新版本。").then(saved => { if (saved) setEditing(false); });
    }}>
      <fieldset className="credit-fields" disabled={busy}>
        <div className="credit-form-grid">
          <label>目标毛利率（%）<input required type="number" min="0" max="99.99" step=".01" value={draft.targetMarginBps / 100} onChange={e => setDraft({ ...draft, targetMarginBps: Math.round(Number(e.target.value) * 100) })} /></label>
          <label>每积分基础价值（元）<input required type="number" min=".000001" step=".000001" value={draft.creditValueMicros / 1000000} onChange={e => setDraft({ ...draft, creditValueMicros: Math.round(Number(e.target.value) * 1000000) })} /></label>
          <label>美元结算汇率（人民币 / 美元）<input type="number" min=".000001" step=".000001" placeholder="未配置" value={draft.usdCnyMicros == null ? "" : draft.usdCnyMicros / 1000000} onChange={e => setDraft({ ...draft, usdCnyMicros: e.target.value ? Math.round(Number(e.target.value) * 1000000) : null })} /></label>
          <label>运营费用 / API成本（%）<input required type="number" min="0" max="100" step=".01" value={draft.overheadBps / 100} onChange={e => setDraft({ ...draft, overheadBps: Math.round(Number(e.target.value) * 100) })} /></label>
          <label>促销毛利保护<select value={String(draft.protectMargin)} onChange={e => setDraft({ ...draft, protectMargin: e.target.value === "true" })}><option value="true">开启 · 保护成本底价</option><option value="false">关闭 · 允许折扣降低毛利</option></select></label>
        </div>
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        <div className="credit-actions"><button type="submit" className="admin-primary-btn" disabled={!dirty}>保存政策</button>
          <button type="button" className="admin-secondary-btn" onClick={() => { setDraft(overview.policy); setEditing(false); setError(""); }}>{dirty ? "放弃政策修改" : "收起设置"}</button></div>
      </fieldset>
    </form> : null}
    <p className="credit-explanation">售价 = API 成本 ×（1 + {overview.policy.overheadBps / 100}% 运营费用）÷（1 − {overview.policy.targetMarginBps / 100}% 目标毛利）÷ 每积分价值。赠送和实收未知的积分，须核对资金来源后才能计算现金毛利。</p>
    <details className="credit-advanced"><summary>套餐与赠送影响 · {overview.plans.filter(plan => plan.enabled).length} 个在售充值套餐</summary>
      <p className="credit-explanation">保护开启时，有效价值包含现售套餐及仍有余额的历史付费批次。下表为套餐名义实收，退款等情况以订单账务为准。</p>
      {overview.plans.length ? <div className="credit-table-scroll"><table><thead><tr><th>套餐</th><th>售价</th><th>本金 + 赠送积分</th><th>每积分实收</th><th>状态</th></tr></thead><tbody>
        {overview.plans.map(plan => <tr key={plan.id}><td>{plan.name}</td><td>¥{plan.price}</td><td>{creditNumber(plan.credits)} + {creditNumber(plan.bonusCredits)}</td><td>{creditMoney(plan.cashValueMicros)}</td><td>{plan.enabled ? "启用" : "停用"}</td></tr>)}
      </tbody></table></div> : <p className="credit-explanation">暂无充值套餐。</p>}
      {overview.memberships.length ? <p className="credit-explanation">另有 {overview.memberships.length} 项会员预留配置。是否开放购买与减免，请以实际支付可用性和任务报价为准。</p> : null}
    </details>
    {overview.warnings.length ? <details className="credit-advanced"><summary>成本来源说明 · {overview.warnings.length} 项</summary>
      {overview.warnings.map(warning => <p key={warning} className="credit-explanation">{warning}</p>)}</details> : null}
  </section>;
}
