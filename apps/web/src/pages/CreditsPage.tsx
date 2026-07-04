import { useState } from "react";
import type { CreditAccount, CreditTransaction, MembershipPlan, ModelPrice, Plan } from "@aifilm/shared";
import { api } from "../lib/api";
import { MetricCard } from "../components/MetricCard";

export function RechargePage({ plans, membershipPlans, modelPrices, onRefresh }: { plans: Plan[]; membershipPlans: MembershipPlan[]; modelPrices: ModelPrice[]; onRefresh: () => void }) {
  const [message, setMessage] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [error, setError] = useState("");
  const defaultShopUrl = "https://pay.ldxp.cn/shop/ZHP28OV1";
  const enabledModelPrices = modelPrices.filter((price) => price.enabled);
  const modelPriceStats = {
    providers: new Set(enabledModelPrices.map((price) => price.providerName)).size,
    models: enabledModelPrices.length,
    avgCredits: enabledModelPrices.length ? Math.round(enabledModelPrices.reduce((sum, price) => sum + price.unitCredits, 0) / enabledModelPrices.length) : 0
  };

  async function redeem() {
    setMessage("");
    setError("");
    const codePrefix = redeemCode.trim().split("-")[0] || "manual";
    void api.trackEvent({ eventName: "redeem_code_start", campaignCode: codePrefix, properties: { codePrefix } }).catch(() => undefined);
    try {
      const account = await api.redeemCode(redeemCode);
      void api.trackEvent({ eventName: "redeem_code_success", campaignCode: codePrefix, properties: { codePrefix, balance: account.balance } }).catch(() => undefined);
      setMessage(`兑换成功，当前积分余额 ${account.balance.toLocaleString()}。`);
      setRedeemCode("");
      onRefresh();
    } catch (err) {
      void api.trackEvent({ eventName: "redeem_code_fail", campaignCode: codePrefix, properties: { codePrefix, message: err instanceof Error ? err.message : "兑换失败" } }).catch(() => undefined);
      setError(err instanceof Error ? err.message : "兑换失败");
    }
  }

  function openCheckout(kind: "recharge" | "membership", item: { id: string; name: string; shopUrl?: string; price: number }) {
    setMessage("");
    setError("");
    const shopUrl = item.shopUrl?.trim() || defaultShopUrl;
    void api.trackEvent({
      eventName: kind === "recharge" ? "recharge_shop_open" : "membership_shop_open",
      properties: { itemId: item.id, itemName: item.name, amountCny: item.price, shopUrl }
    }).catch(() => undefined);
    window.open(shopUrl, "_blank", "noopener,noreferrer");
    setMessage(`已打开「${item.name}」购买页。购买后请在店铺获取卡密，再回到本页兑换入账。`);
  }

  return (
    <div className="page-stack">
      <div className="page-title">
        <h1>积分充值</h1>
        <p>采用充值积分 + 兑换码体验额度 + 后台可调模型单价。充值积分永久有效，会员是每月额度和权益折扣，不做无限量。</p>
      </div>
      <div className="plan-grid" data-tour-id="recharge-plans">
        {plans.map((plan) => (
          <article className="plan-card" key={plan.id}>
            {plan.badge ? <span className="badge">{plan.badge}</span> : null}
            <span>{plan.name}</span>
            <strong>¥{plan.price.toFixed(2)}</strong>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <button
              className="primary-button"
              onClick={() => openCheckout("recharge", { id: plan.id, name: plan.name, price: plan.price, shopUrl: plan.shopUrl })}
            >
              前往充值
            </button>
          </article>
        ))}
      </div>
      {message ? <p className="success-text">{message}</p> : null}
      {error ? <p className="danger-text">{error}</p> : null}
      <section className="panel">
        <div className="panel-head">
          <div><h2>兑换体验额度</h2><small>适合新用户试用、内测邀请和运营活动；兑换到账积分永久有效。</small></div>
        </div>
        <div className="redeem-row">
          <input value={redeemCode} onChange={(event) => setRedeemCode(event.target.value.toUpperCase())} placeholder="输入兑换码，例如 TRIAL300" />
          <button className="ghost-button" onClick={redeem} disabled={!redeemCode.trim()}>兑换</button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div><h2>订阅会员权益</h2><small>后续增强：每月额度、权益折扣、优先队列，不提供无限生成。</small></div>
        </div>
        <div className="membership-grid">
          {membershipPlans.map((membership) => (
            <article className="membership-card" key={membership.id}>
              {membership.badge ? <span className="badge">{membership.badge}</span> : null}
              <span>{membership.name}</span>
              <strong>¥{membership.monthlyPrice.toFixed(2)} / 月</strong>
              <p>{membership.monthlyCredits.toLocaleString()} 积分/月 · {membership.discountPercent}% 权益折扣 · 队列等级 {membership.priorityLevel}</p>
              <ul>
                {membership.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <button
                className="primary-button"
                onClick={() => openCheckout("membership", { id: membership.id, name: membership.name, price: membership.monthlyPrice, shopUrl: membership.shopUrl })}
              >
                前往订阅
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="panel model-price-panel">
        <div className="panel-head">
          <div><h2>模型价格表</h2><small>后台价格策略实时同步到前台，方便估算一次剧本、分镜图或视频生成的积分成本。</small></div>
          <div className="model-price-summary">
            <span><b>{modelPriceStats.providers}</b> 渠道</span>
            <span><b>{modelPriceStats.models}</b> 模型</span>
            <span><b>{modelPriceStats.avgCredits || "-"}</b> 平均积分</span>
          </div>
        </div>
        <div className="model-price-table">
          <div className="model-price-row header"><span>渠道</span><span>模型</span><span>类型</span><span>计费单位</span><span>积分</span></div>
          {enabledModelPrices.slice(0, 16).map((price) => (
            <div className="model-price-row" key={price.id}>
              <strong>{price.providerName}</strong>
              <span>{price.model}</span>
              <span className={`model-price-chip modality-${price.modality}`}>{priceModalityText(price.modality)}</span>
              <span className="model-price-unit">{priceUnitText(price.unit)}</span>
              <b>{price.unitCredits}</b>
            </div>
          ))}
          {!enabledModelPrices.length ? <div className="empty-state">后台还没有启用的模型价格策略。</div> : null}
        </div>
      </section>
    </div>
  );
}

function priceModalityText(value: ModelPrice["modality"]) {
  const labels: Record<string, string> = { text: "文本", image: "生图", video: "视频", tts: "配音", embedding: "向量" };
  return labels[value] ?? value;
}

function priceUnitText(value: ModelPrice["unit"]) {
  const labels: Record<string, string> = { text_run: "每次", image: "每张", image2: "每张", video_second: "每秒", tts_character: "每字符", export: "每次导出" };
  return labels[value] ?? value;
}

export function LedgerPage({ account, transactions }: { account?: CreditAccount; transactions: CreditTransaction[] }) {
  return (
    <div className="page-stack">
      <div className="page-title">
        <h1>积分明细</h1>
        <p>消费记录、充值记录、冻结和退款都会永久保存，便于后台核账和用户解释。</p>
      </div>
      <div className="metric-grid three">
        <MetricCard label="当前可用积分" value={account?.balance ?? 0} />
        <MetricCard label="累计充值" value={account?.totalRecharge ?? 0} tone="success" />
        <MetricCard label="累计消费" value={account?.totalConsume ?? 0} tone="danger" />
      </div>
      <section className="panel">
        <div className="task-table ledger">
          <div className="task-row header">
            <span>类型</span>
            <span>金额</span>
            <span>余额</span>
            <span>说明</span>
            <span>时间</span>
          </div>
          {transactions.map((tx) => (
            <div className="task-row" key={tx.id}>
              <span>{tx.type}</span>
              <strong>{tx.amount}</strong>
              <span>{tx.balanceAfter}</span>
              <span>{tx.description}</span>
              <span>{new Date(tx.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
