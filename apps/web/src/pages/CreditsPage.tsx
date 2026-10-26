import { useMemo, useRef, useState } from "react";
import { CheckCircle2, ClipboardList, Coins, CreditCard, Gift, ReceiptText, Sparkles, WalletCards } from "lucide-react";
import type { CreditAccount, CreditTransaction, MembershipPlan, ModelPrice, Plan } from "@aifilm/shared";
import { api } from "../lib/api";
import { modelCreditRange, rechargeCheckoutUrl } from "./creditCheckoutModel";
import { createTaskActionRunner } from "./taskActionModel";
import { InlineNotice, PageHeader, StatePanel } from "../design-system/ui";
import { ModelIdentity } from "../components/ModelIdentity";
import "../components/model-experience.css";
import "./creator-pages.css";
import { OnlineCheckout } from "./OnlineCheckout";

const modalityOrder: Record<string, number> = { text: 0, image: 1, video: 2, tts: 3, embedding: 4 };

export function RechargePage({ plans, membershipPlans, modelPrices, onRefresh }: { plans: Plan[]; membershipPlans: MembershipPlan[]; modelPrices: ModelPrice[]; onRefresh: () => void | Promise<void> }) {
  const [message, setMessage] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [error, setError] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const redeemRunner = useRef(createTaskActionRunner()).current;
  const availablePlans = plans.filter((plan) => plan.enabled);
  const enabledModelPrices = modelPrices.filter((price) => price.enabled);
  const usageReferences = useMemo(() => buildCreditUsageReferences(enabledModelPrices), [enabledModelPrices]);
  const sortedModelPrices = useMemo(
    () => [...enabledModelPrices].sort((a, b) =>
      (modalityOrder[a.modality] ?? 9) - (modalityOrder[b.modality] ?? 9)
      || a.unitCredits - b.unitCredits
      || a.providerName.localeCompare(b.providerName)
    ),
    [enabledModelPrices]
  );

  async function redeem() {
    if (!redeemCode.trim()) return;
    const code = redeemCode.trim();
    setMessage("");
    setError("");
    const codePrefix = code.split("-")[0] || "manual";
    const result = await redeemRunner.run("redeem", "retry", async () => {
      void api.trackEvent({ eventName: "redeem_code_start", campaignCode: codePrefix, properties: { codePrefix } }).catch(() => undefined);
      const account = await api.redeemCode(code);
      void api.trackEvent({ eventName: "redeem_code_success", campaignCode: codePrefix, properties: { codePrefix, balance: account.balance } }).catch(() => undefined);
      setMessage(`兑换成功，当前积分余额 ${account.balance.toLocaleString()}。`);
      setRedeemCode("");
      try { await onRefresh(); }
      catch { setMessage(`兑换成功，当前积分余额 ${account.balance.toLocaleString()}。余额面板刷新失败，可稍后刷新查看，请勿重复兑换。`); }
    }, (pending) => setRedeeming(Boolean(pending.redeem)));
    if (result.status === "failed") {
      void api.trackEvent({ eventName: "redeem_code_fail", campaignCode: codePrefix, properties: { codePrefix, message: result.message } }).catch(() => undefined);
      setError(result.message);
    }
  }

  function openCheckout(item: Plan) {
    setMessage("");
    setError("");
    const shopUrl = rechargeCheckoutUrl(item);
    if (!shopUrl) { setError("该套餐暂未开放购买，请稍后重试或联系平台支持。"); return; }
    void api.trackEvent({
      eventName: "recharge_shop_open",
      properties: { itemId: item.id, itemName: item.name, amountCny: item.price, shopUrl }
    }).catch(() => undefined);
    setMessage(`购买「${item.name}」后，请在店铺获取卡密，再回到本页兑换入账。`);
  }

  return (
    <div className="page-stack recharge-page creator-page">
      <PageHeader title="积分充值" description="选择已开放的支付方式充值，或使用店铺卡密兑换。每次生成前可查看本次费用。" />
      <OnlineCheckout plans={plans} memberships={membershipPlans} onRefresh={onRefresh} />
      <section className="panel creator-redeem-panel" aria-labelledby="creator-redeem-title">
        <div><h2 id="creator-redeem-title">已有卡密？直接兑换</h2><p>兑换成功后，积分立即计入当前账户。</p></div>
        <form className="redeem-row" onSubmit={event => { event.preventDefault(); void redeem(); }}>
          <label className="creator-redeem-input"><span className="creator-sr-only">兑换码</span><input value={redeemCode} disabled={redeeming} onChange={event => setRedeemCode(event.target.value.toUpperCase())} placeholder="输入店铺提供的兑换码" autoComplete="off" /></label>
          <button type="submit" className="primary-button" disabled={redeeming || !redeemCode.trim()}>{redeeming ? "兑换中…" : "兑换积分"}</button>
        </form>
        {message ? <InlineNotice tone={message.startsWith("兑换成功") ? "success" : "info"} onDismiss={() => setMessage("")}>{message}</InlineNotice> : null}
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      </section>
      <section className="panel recharge-plan-panel">
        <div className="panel-head">
          <div><h2>购买积分</h2><small>选择套餐后将在新窗口打开购买页。</small></div>
          <span className="recharge-validity">积分永久有效 · 可用于所有 AI 生成能力</span>
        </div>
        <div className="plan-grid recharge-plan-grid" data-tour-id="recharge-plans">
        {availablePlans.map((plan) => {
          const featured = Boolean(plan.badge && plan.badge.includes("推荐"));
          const totalCredits = plan.credits + plan.bonusCredits;
          return (
            <article className={featured ? "plan-card recharge-card featured" : "plan-card recharge-card"} key={plan.id}>
              {plan.badge ? (
                <span className={featured ? "badge recharge-card-badge featured" : "badge recharge-card-badge"}>
                  {featured ? <Sparkles size={13} /> : null}
                  {plan.badge}
                </span>
              ) : null}
              <span className="recharge-card-name">{plan.name}</span>
              <div className="recharge-card-price">
                <em>¥</em>
                <strong>{formatPlanPrice(plan.price)}</strong>
              </div>
              <div className="recharge-card-credits">
                <b>{totalCredits.toLocaleString()}</b>
                <i>积分</i>
                {plan.bonusCredits ? <small>含赠送 {plan.bonusCredits.toLocaleString()}</small> : null}
              </div>
              <ul className="recharge-card-features">
                {plan.features.map((feature) => (
                  <li key={feature}><CheckCircle2 size={14} />{feature}</li>
                ))}
              </ul>
              {rechargeCheckoutUrl(plan) ? <a className="primary-button creator-purchase-link" href={rechargeCheckoutUrl(plan)!} target="_blank" rel="noopener noreferrer" onClick={() => openCheckout(plan)}>前往店铺购买</a> : <span className="creator-unavailable">暂未开放购买</span>}
            </article>
          );
        })}
        </div>
        {!availablePlans.length ? <StatePanel compact title="暂未开放新套餐" description="已有卡密仍可在上方兑换。套餐开放后会显示在这里。" /> : null}
      </section>
      <section className="panel credit-usage-panel">
        <div className="panel-head">
          <div><h2>生成费用参考</h2><small>以下为已开放模型的价格范围；实际消耗以每次生成前的报价为准。</small></div>
          <span className="recharge-validity"><ClipboardList size={16} /> 共 {enabledModelPrices.length} 条启用价格</span>
        </div>
        <div className="credit-usage-grid">
          {usageReferences.map((item) => (
            <article className="credit-usage-card" key={item.title}>
              <div>
                {item.icon}
                <strong>{item.title}</strong>
                <span>{item.desc}</span>
              </div>
              <b>{item.credits}</b>
            </article>
          ))}
        </div>
        <details className="creator-price-details"><summary>查看全部模型价格 · {enabledModelPrices.length} 条</summary><div className="model-price-table compact-model-price-table credit-usage-table">
          <div className="model-price-row header"><span>渠道</span><span>模型</span><span>类型</span><span>计费单位</span><span>积分</span></div>
          {sortedModelPrices.map((price) => (
            <div className="model-price-row" key={price.id}>
              <strong>{price.providerName}</strong>
              <ModelIdentity model={price.model} modality={price.modality} compact />
              <span className={`model-price-chip modality-${price.modality}`}>{priceModalityText(price.modality)}</span>
              <span className="model-price-unit">{priceUnitText(price.unit)}</span>
              <b>{price.unitCredits}</b>
            </div>
          ))}
          {!enabledModelPrices.length ? <StatePanel compact title="暂无可用价格信息" description="请稍后刷新，或在生成前获取对应模型的报价。" /> : null}
        </div></details>
      </section>
      <section className="panel payment-method-panel">
        <div className="panel-head">
          <div><h2>购买与入账方式</h2><small>从上方已开放的充值套餐进入对应购买页，再将获得的卡密填入兑换框。</small></div>
        </div>
        <div className="payment-method-row">
          <div className="payment-method-card">
            <WalletCards size={22} />
            <span><strong>店铺卡密</strong><small>店铺完成支付后，回到本页兑换入账</small></span>
            <CheckCircle2 size={20} />
          </div>
        </div>
      </section>
    </div>
  );
}

function formatPlanPrice(price: number) {
  return Number.isInteger(price) ? String(price) : price.toFixed(price * 10 % 1 ? 2 : 1);
}

function priceModalityText(value: ModelPrice["modality"]) {
  const labels: Record<string, string> = { text: "文本", image: "生图", video: "视频", tts: "配音", embedding: "向量" };
  return labels[value] ?? value;
}

function priceUnitText(value: ModelPrice["unit"]) {
  const labels: Record<string, string> = { text_run: "每次", image: "每张", image2: "每张", video_second: "每秒", tts_character: "每字符", export: "每次导出" };
  return labels[value] ?? value;
}

function buildCreditUsageReferences(prices: ModelPrice[]) {
  const reference = (unit: ModelPrice["unit"], label: string) => {
    const range = modelCreditRange(prices, unit);
    return range === null ? "暂无报价" : `${range} 积分 / ${label}`;
  };
  const textRun = reference("text_run", "次");
  const image = reference("image", "张");
  const videoSecond = reference("video_second", "秒");
  return [
    { title: "内容分析", desc: "题材、人物与剧情结构", credits: textRun, icon: <Coins size={19} /> },
    { title: "剧本生成", desc: "小说改编与分集剧本", credits: textRun, icon: <ReceiptText size={19} /> },
    { title: "分镜规划", desc: "按剧本场次规划镜头", credits: textRun, icon: <ClipboardList size={19} /> },
    { title: "角色与场景图", desc: "视觉资产图片生成", credits: image, icon: <CreditCard size={19} /> },
    { title: "镜头画面", desc: "分镜画面图片生成", credits: image, icon: <Gift size={19} /> },
    { title: "镜头视频", desc: "图生视频 · 按秒计费", credits: videoSecond, icon: <WalletCards size={19} /> }
  ];
}

const ledgerPageSize = 20;

export function LedgerPage({ account, transactions }: { account?: CreditAccount; transactions: CreditTransaction[] }) {
  const [filter, setFilter] = useState<CreditTransaction["type"] | "all">("all");
  const [visibleCount, setVisibleCount] = useState(ledgerPageSize);
  const filteredTransactions = filter === "all" ? transactions : transactions.filter((tx) => tx.type === filter);
  const visibleTransactions = filteredTransactions.slice(0, visibleCount);
  const remainingCount = filteredTransactions.length - visibleTransactions.length;
  const recharged = transactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const consumed = Math.abs(transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0));

  function changeFilter(next: CreditTransaction["type"] | "all") {
    setFilter(next);
    setVisibleCount(ledgerPageSize);
  }

  return (
    <div className="page-stack ledger-page creator-page">
      <PageHeader title="积分明细" description="核对每一笔充值、冻结、消耗和退还。" />
      <div className="ledger-summary-grid">
        <article>
          <WalletCards size={22} />
          <span>当前可用积分</span>
          <strong>{(account?.balance ?? 0).toLocaleString()}</strong>
        </article>
        <article>
          <Gift size={22} />
          <span>累计充值</span>
          <strong>{(account?.totalRecharge ?? recharged).toLocaleString()}</strong>
        </article>
        <article>
          <ReceiptText size={22} />
          <span>累计消费</span>
          <strong>{(account?.totalConsume ?? consumed).toLocaleString()}</strong>
        </article>
      </div>
      <section className="panel ledger-table-panel">
        <div className="panel-head">
          <div><h2>流水记录</h2><small>共 {transactions.length} 条，筛选后 {filteredTransactions.length} 条，已显示 {visibleTransactions.length} 条。</small></div>
        </div>
        <div className="ledger-filter-tabs" role="group" aria-label="流水类型">
          {ledgerFilters.map((item) => (
            <button className={filter === item.id ? "active" : undefined} aria-pressed={filter === item.id} key={item.id} type="button" onClick={() => changeFilter(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="creator-table-scroll" tabIndex={0} role="region" aria-label="积分流水，可横向滚动"><table className="creator-data-table"><caption className="creator-sr-only">当前筛选的积分流水</caption><thead><tr><th scope="col">类型</th><th scope="col">积分变动</th><th scope="col">余额</th><th scope="col">说明</th><th scope="col">时间</th></tr></thead><tbody>
          {visibleTransactions.map((tx) => (
            <tr key={tx.id}>
              <td><span className={`ledger-type-chip ${tx.type}`}>{transactionTypeLabel(tx.type)}</span></td>
              <td><strong className={tx.amount >= 0 ? "ledger-positive" : "ledger-negative"}>{tx.amount >= 0 ? "+" : ""}{tx.amount}</strong></td>
              <td>{tx.balanceAfter}</td>
              <td>{transactionDescriptionText(tx.description)}{tx.taskId || tx.projectId ? <small className="ledger-trace">{tx.projectId ? `项目 ${tx.projectId}` : ""}{tx.taskId ? ` · 任务 ${tx.taskId}` : ""}</small> : null}</td>
              <td>{formatLedgerDate(tx.createdAt)}</td>
            </tr>
          ))}
          </tbody></table></div>
          {!filteredTransactions.length ? (
            <StatePanel compact title={filter === "all" ? "暂无积分流水" : "此类型暂无记录"} description={filter === "all" ? "兑换积分或开始生成后，每一笔变动都会保留在这里。" : "可以切回全部类型查看完整历史。"} action={filter !== "all" ? <button type="button" className="ghost-button" onClick={() => changeFilter("all")}>查看全部</button> : undefined} />
          ) : null}
        {remainingCount > 0 ? (
          <button className="ghost-button ledger-load-more" type="button" onClick={() => setVisibleCount((value) => value + ledgerPageSize)}>
            加载更多（还有 {remainingCount} 条）
          </button>
        ) : null}
      </section>
    </div>
  );
}

const ledgerFilters: Array<{ id: CreditTransaction["type"] | "all"; label: string }> = [
  { id: "all", label: "全部" },
  { id: "recharge", label: "充值" },
  { id: "consume", label: "消费" },
  { id: "freeze", label: "冻结" },
  { id: "refund", label: "退款" },
  { id: "adjust", label: "调整" }
];

function transactionTypeLabel(value: CreditTransaction["type"]) {
  const labels: Record<CreditTransaction["type"], string> = {
    recharge: "充值入账",
    freeze: "冻结积分",
    consume: "消费扣费",
    refund: "退款退回",
    adjust: "后台调整"
  };
  return labels[value] ?? value;
}

function transactionDescriptionText(value: string) {
  const dictionary: Record<string, string> = {
    "Storyboard generation credits": "分镜生成扣费",
    "Single shot image regeneration credits": "单镜头图片重生成扣费",
    "Character reference image credits": "角色参考图生成扣费",
    "Image generation credits": "图片生成扣费",
    "Video generation credits": "视频生成扣费",
    "Recharge order paid": "充值订单入账",
    "Redeem code": "兑换码入账"
  };
  if (value.startsWith("Redeemed code")) return "兑换码入账";
  return dictionary[value] ?? value;
}

function formatLedgerDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
