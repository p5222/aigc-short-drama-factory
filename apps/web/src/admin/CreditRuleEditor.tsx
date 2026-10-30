import { useEffect, useRef, useState } from "react";
import { calculateOfficialCredits, officialSampleUsage, validateCostRule, type BillingUsage, type CreditPricingOverview, type OfficialCostRule } from "@aifilm/shared";
import { ModelIdentity } from "../components/ModelIdentity";
import { InlineNotice } from "../design-system/ui";
import { api } from "../lib/api";
import { confirmAdminAction } from "./AdminConfirm";
import { canLeaveAdminEditor } from "./adminDirtyState";
import { creditDate, creditKinds, creditKindNames, creditMoney, initialCreditRule, parseCreditRule } from "./creditPresentation";

type Quote = ReturnType<typeof calculateOfficialCredits>;
type Preview = { sample: Quote; reference: Quote };
export function CreditRuleEditor({ overview, busy, policyDirty, mutate }: {
  overview: CreditPricingOverview; busy: boolean; policyDirty: boolean;
  mutate: (run: () => Promise<unknown>, message: string) => Promise<boolean>;
}) {
  const [priceId, setPriceId] = useState("");
  const [ruleJson, setRuleJson] = useState("");
  const [usage, setUsage] = useState<BillingUsage>({});
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const baseline = useRef("");
  const price = overview.prices.find(p => p.id === priceId);
  const dirty = !!price && ruleJson !== initialCreditRule(price);
  useEffect(() => {
    const current = overview.prices.find(p => p.id === priceId);
    const next = current ? initialCreditRule(current) : "";
    const previous = baseline.current;
    setRuleJson(value => !current || value === previous || value === next ? next : value);
    baseline.current = next;
    setPreview(undefined); setError("");
  }, [overview]);
  let rule: OfficialCostRule | undefined, parseError = "";
  if (ruleJson) {
    try { rule = parseCreditRule(ruleJson); } catch (reason) { parseError = (reason as Error).message; }
  }
  function choose(id: string) {
    if (dirty && !canLeaveAdminEditor()) return;
    const p = overview.prices.find(item => item.id === id);
    baseline.current = p ? initialCreditRule(p) : "";
    setPriceId(id); setRuleJson(baseline.current); setPreview(undefined); setError(""); setAdvanced(false);
    const initial = p?.billing ?? p?.officialCandidate;
    setUsage(initial ? { ...officialSampleUsage(initial), resolution: Object.keys(initial.resolutionRates ?? {})[0] } :
      { inputTokens: 8000, outputTokens: 16000, images: 1, seconds: 5, characters: 1000 });
  }
  function change(next: OfficialCostRule) {
    setRuleJson(JSON.stringify(next, null, 2)); setPreview(undefined); setError("");
  }
  function changeUsage(key: keyof BillingUsage, value: number | string) {
    setUsage({ ...usage, [key]: value }); setPreview(undefined);
  }
  function previewRule() {
    setError(""); setPreview(undefined);
    try {
      if (!price) throw new Error("请选择模型价格");
      if (policyDirty) throw new Error("请先保存或放弃政策修改，再按当前生效政策试算。");
      const candidate = parseCreditRule(ruleJson);
      validateCostRule(candidate, overview.effectivePolicy);
      if (candidate.model !== price.model || candidate.kind !== creditKinds[price.modality]) throw new Error("成本规则与当前模型类型不匹配");
      setPreview({ sample: calculateOfficialCredits(candidate, usage, overview.effectivePolicy),
        reference: calculateOfficialCredits(candidate, officialSampleUsage(candidate), overview.effectivePolicy) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "规则格式不正确"); }
  }
  const rate = (label: string, value: number | undefined, onChange: (value: number | undefined) => void, optional = false) =>
    <label>{label}<input type="number" min="0" step=".000001" value={value === undefined ? "" : value / 1000000}
      placeholder={optional ? "未配置，使用普通输入费率" : "请填写真实单位成本"}
      onChange={event => onChange(event.target.value === "" ? undefined : Math.round(Number(event.target.value) * 1000000))} /></label>;
  return <section className="panel credit-section credit-rule" data-admin-dirty={dirty ? "true" : "false"}>
    <div className="credit-section-head"><div><h2>模型成本与报价</h2><p>按真实渠道核对成本来源，再试算并应用到新任务。</p></div>
      <span className="credit-tag">{overview.prices.filter(p => p.billing).length} / {overview.prices.length} 条自动计价</span></div>
    <label>模型价格<select value={priceId} disabled={busy} onChange={event => choose(event.target.value)}><option value="">请选择渠道与模型</option>
      {overview.prices.map(p => <option key={p.id} value={p.id}>{p.providerName} · {p.model}{p.billing ? " · 自动计价" : " · 手工计价"}{p.enabled ? "" : " · 停用"}</option>)}</select></label>
    {!price ? <p className="credit-explanation">支持文本 Token、图片、视频秒数和配音字符计价。规则来源与任务账单核验分别记录。</p> : <>
      <div className="credit-route-head"><ModelIdentity model={price.model} providerName={price.providerName} />
        <div><span className={`credit-tag ${price.enabled ? "positive" : ""}`}>{price.enabled ? "价格已启用" : "价格已停用"}</span>
          <span className="credit-tag">{price.billing ? "自动计价" : "手工计价"}</span></div></div>
      {!creditKinds[price.modality] ? <InlineNotice>当前模型类型暂不支持自动成本规则，请在价格策略中维护手工单价。</InlineNotice> : <>
        <p className="credit-explanation">{price.officialCandidate ? `参考目录核验时间：${creditDate(price.officialCandidate.verifiedAt)}。请确认当前地域、规格和渠道价格。` : "该渠道暂无目录参考，请根据供应商定价文档填写，保留可核对的来源。"}
          {!price.enabled ? " 应用规则会保留停用状态。" : ""}</p>
        <fieldset disabled={busy} className="credit-fields">
          {rule ? <>
            <div className="credit-form-grid">
              <label>结算币种<select value={rule.currency} onChange={e => change({ ...rule!, currency: e.target.value as "CNY" | "USD" })}><option value="CNY">人民币 CNY</option><option value="USD">美元 USD</option></select></label>
              <label>服务地域<input value={rule.region} placeholder="如 cn-beijing" onChange={e => change({ ...rule!, region: e.target.value })} /></label>
              <label>来源核验日期<input type="date" value={rule.verifiedAt.slice(0, 10)} onChange={e => change({ ...rule!, verifiedAt: e.target.value ? `${e.target.value}T00:00:00.000Z` : "" })} /></label>
              <label className="credit-form-full">成本来源链接<input type="url" value={rule.sourceUrl} placeholder="https://供应商官方定价页面" onChange={e => change({ ...rule!, sourceUrl: e.target.value })} /></label>
            </div>
            <h3>{creditKindNames[rule.kind]} <small>金额单位：{rule.currency === "USD" ? "美元" : "人民币元"}</small></h3>
            <div className="credit-form-grid">
              {rule.kind === "tokens" ? <>
                {rate("输入成本 / 百万 Token", rule.inputMicros, value => change({ ...rule!, inputMicros: value }))}
                {rate("输出成本 / 百万 Token", rule.outputMicros, value => change({ ...rule!, outputMicros: value }))}
                {rate("缓存输入成本 / 百万 Token（选填）", rule.cachedInputMicros, value => change({ ...rule!, cachedInputMicros: value }), true)}
              </> : rate(`单位成本 / ${rule.kind === "image" ? "张" : rule.kind === "second" ? "秒" : "万字符"}`, rule.rateMicros, value => change({ ...rule!, rateMicros: value }))}
            </div>
            {rule.kind === "tokens" ? <details className="credit-advanced" open={rule.tiers?.length ? true : undefined}>
              <summary>长上下文阶梯{rule.tiers?.length ? ` · ${rule.tiers.length} 档` : "（选填）"}</summary>
              <p className="credit-explanation">输入超过阈值时使用该档价格，阈值按从小到大排列。</p>
              {rule.tiers?.map((tier, i) => <div className="credit-rate-row" key={i}>
                <label>输入超过（Token）<input type="number" min="0" step="1" value={tier.aboveInputTokens} onChange={e => change({ ...rule!, tiers: rule!.tiers!.map((t, n) => n === i ? { ...t, aboveInputTokens: Number(e.target.value) } : t) })} /></label>
                {rate("阶梯输入 / 百万 Token", tier.inputMicros, value => change({ ...rule!, tiers: rule!.tiers!.map((t, n) => n === i ? { ...t, inputMicros: value ?? 0 } : t) }))}
                {rate("阶梯输出 / 百万 Token", tier.outputMicros, value => change({ ...rule!, tiers: rule!.tiers!.map((t, n) => n === i ? { ...t, outputMicros: value ?? 0 } : t) }))}
                <button type="button" className="admin-text-btn danger" onClick={() => change({ ...rule!, tiers: rule!.tiers!.filter((_, n) => n !== i) })}>移除此档</button>
              </div>)}
              <button type="button" className="admin-secondary-btn" onClick={() => change({ ...rule!, tiers: [...(rule!.tiers ?? []), { aboveInputTokens: (rule!.tiers?.at(-1)?.aboveInputTokens ?? 0) + 128000, inputMicros: rule!.inputMicros ?? 0, outputMicros: rule!.outputMicros ?? 0 }] })}>添加阶梯</button>
            </details> : null}
            {rule.kind === "second" ? <details className="credit-advanced" open={rule.resolutionRates ? true : undefined}>
              <summary>分辨率成本{rule.resolutionRates ? ` · ${Object.keys(rule.resolutionRates).length} 档` : "（选填）"}</summary>
              <div className="credit-form-grid">{["480P", "720P", "1080P", ...Object.keys(rule.resolutionRates ?? {}).filter(key => !["480P", "720P", "1080P"].includes(key))].map(key =>
                <div key={key}>{rate(`${key} / 秒`, rule!.resolutionRates?.[key], value => {
                  const rates = { ...rule!.resolutionRates }; if (value === undefined) delete rates[key]; else rates[key] = value;
                  change({ ...rule!, resolutionRates: Object.keys(rates).length ? rates : undefined });
                })}</div>)}</div>
              <p className="credit-explanation">留空表示该规格未配置。全部留空时使用通用每秒成本。</p>
            </details> : null}
          </> : null}
          <details className="credit-advanced" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
            <summary>高级规则 JSON</summary>
            <p className="credit-explanation">金额保存为百万分之一货币，表单已自动换算。适用于导入或检查完整规则。</p>
            <label>成本规则（JSON，金额为百万分之一货币）<textarea rows={10} value={ruleJson} spellCheck={false} onChange={e => { setRuleJson(e.target.value); setPreview(undefined); setError(""); }} /></label>
          </details>
          {parseError ? <InlineNotice tone="error">{parseError}</InlineNotice> : null}
          <div className="credit-simulator">
            <h3>用量试算 <small>当前生效政策 v{overview.version}</small></h3>
            {policyDirty ? <InlineNotice>政策有未保存修改，请保存或放弃后试算。</InlineNotice> : null}
            <div className="credit-form-grid">
              {rule?.kind === "tokens" ? <>
                <label>输入 Token<input type="number" min="0" step="1" value={usage.inputTokens ?? 0} onChange={e => changeUsage("inputTokens", Number(e.target.value))} /></label>
                <label>输出 Token<input type="number" min="0" step="1" value={usage.outputTokens ?? 0} onChange={e => changeUsage("outputTokens", Number(e.target.value))} /></label>
                <label>缓存输入 Token<input type="number" min="0" step="1" value={usage.cachedInputTokens ?? 0} onChange={e => changeUsage("cachedInputTokens", Number(e.target.value))} /></label>
              </> : rule ? <label>{rule.kind === "image" ? "图片张数" : rule.kind === "second" ? "视频秒数" : "配音字符数"}<input type="number" min="0" step="1"
                value={(rule.kind === "image" ? usage.images : rule.kind === "second" ? usage.seconds : usage.characters) ?? 0}
                onChange={e => changeUsage(rule!.kind === "image" ? "images" : rule!.kind === "second" ? "seconds" : "characters", Number(e.target.value))} /></label> : null}
              {rule?.kind === "second" ? <label>视频分辨率<select value={usage.resolution ?? ""} onChange={e => changeUsage("resolution", e.target.value)}><option value="">通用规格 / 基础费率</option>
                {Object.keys(rule.resolutionRates ?? { "480P": 0, "720P": 0, "1080P": 0 }).map(key => <option key={key}>{key}</option>)}</select></label> : null}
            </div>
            {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
            {preview && !policyDirty ? <div className="credit-preview" role="status">
              <div><span>本次配置成本</span><strong>{creditMoney(preview.sample.costMicros)}</strong><small>根据上方规则与用量计算</small></div>
              <div><span>新报价</span><strong>{preview.sample.payableCredits} 积分</strong><small>未叠加会员减免</small></div>
              <div><span>API 口径毛利</span><strong>{preview.sample.marginBps == null ? "—" : `${(preview.sample.marginBps / 100).toFixed(2)}%`}</strong><small>非现金毛利核验</small></div>
              <p>应用后参考报价 {preview.reference.listCredits} 积分 / {rule?.kind === "tokens" ? "参考次（8千输入 / 1.6万输出 Token）" : rule?.kind === "character" ? "万字符" : rule?.kind === "second" ? "秒（基础费率）" : "张"}。实际任务按用量结算，原冻结报价保留。</p>
            </div> : null}
            <div className="credit-actions">
              <button type="button" className="admin-secondary-btn" disabled={!rule || policyDirty} onClick={previewRule}>预览报价</button>
              <button type="button" className="admin-primary-btn" disabled={!preview || policyDirty} onClick={() => void mutate(async () => {
                if (!await confirmAdminAction(`应用 ${price.model} 的成本规则？本次试算 ${preview!.sample.payableCredits} 积分，模型参考报价 ${preview!.reference.listCredits} 积分。新任务将使用当前政策 v${overview.version}。`, { title: "应用成本规则", confirmLabel: "应用此规则" })) return false;
                return api.saveCreditCostRule({ priceId: price.id, expectedUpdatedAt: price.updatedAt, expectedPolicyVersion: overview.version, rule: parseCreditRule(ruleJson) });
              }, "成本规则已应用，请核对最新模型价格。")}>应用预览规则</button>
              {dirty ? <button type="button" className="admin-text-btn" onClick={() => { if (canLeaveAdminEditor()) { setRuleJson(initialCreditRule(price)); setPreview(undefined); setError(""); } }}>放弃规则修改</button> : null}
            </div>
          </div>
          {price.billing ? <div className="credit-manual"><p>切回手工计价后，将保留当前参考积分作为固定单价。</p>
            <button type="button" className="admin-text-btn" disabled={policyDirty} onClick={() => void mutate(async () => {
              if (!await confirmAdminAction("切回手工计价？将停止按实际用量自动计算此模型的新报价，现有单价保留。", { title: "切回手工计价", confirmLabel: "确认切换" })) return false;
              return api.saveCreditCostRule({ priceId: price.id, expectedUpdatedAt: price.updatedAt, expectedPolicyVersion: overview.version, rule: null });
            }, "已转为手工价格，单价保留。")}>切回手工计价</button></div> : null}
        </fieldset>
      </>}
    </>}
  </section>;
}
