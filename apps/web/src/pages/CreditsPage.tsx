import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Coins, CreditCard, Gift, ReceiptText, Sparkles, WalletCards } from "lucide-react";
import type { CreditAccount, CreditTransaction, MembershipPlan, ModelPrice, Plan } from "@aifilm/shared";
import { api } from "../lib/api";

const modalityOrder: Record<string, number> = { text: 0, image: 1, video: 2, tts: 3, embedding: 4 };

export function RechargePage({ plans, membershipPlans, modelPrices, onRefresh }: { plans: Plan[]; membershipPlans: MembershipPlan[]; modelPrices: ModelPrice[]; onRefresh: () => void }) {
  const [message, setMessage] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [error, setError] = useState("");
  const defaultShopUrl = "https://pay.ldxp.cn/shop/ZHP28OV1";
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
    <div className="page-stack recharge-page">
      <div className="page-title">
        <h1>积分充值</h1>
        <p>充值即获积分，用于 AI 生成，永久有效；消费参考会按后台价格策略同步展示。</p>
      </div>
      <section className="panel recharge-plan-panel">
        <div className="panel-head">
          <div><h2>选择充值金额</h2><small>购买后请在店铺获取卡密，再回到本页兑换入账。</small></div>
          <span className="recharge-validity">积分永久有效 · 可用于所有 AI 生成能力</span>
        </div>
        <div className="plan-grid recharge-plan-grid" data-tour-id="recharge-plans">
        {plans.map((plan) => {
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
              <button
                className="primary-button"
                onClick={() => openCheckout("recharge", { id: plan.id, name: plan.name, price: plan.price, shopUrl: plan.shopUrl })}
              >
                前往充值
              </button>
            </article>
          );
        })}
        </div>
      </section>
      <section className="panel credit-usage-panel">
        <div className="panel-head">
          <div><h2>积分消费参考</h2><small>按后台价格策略实时渲染；实际消耗以生成时选择的模型、画质与时长为准，生成先冻结、成功扣费、失败退回。</small></div>
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
        <div className="model-price-table compact-model-price-table credit-usage-table">
          <div className="model-price-row header"><span>渠道</span><span>模型</span><span>类型</span><span>计费单位</span><span>积分</span></div>
          {sortedModelPrices.map((price) => (
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
      <section className="panel payment-method-panel">
        <div className="panel-head">
          <div><h2>支付方式</h2><small>当前使用店铺下单 + 卡密兑换入账，后续可接入原生支付回调。</small></div>
        </div>
        <div className="payment-method-row">
          <button type="button" className="payment-method-card" onClick={() => window.open(defaultShopUrl, "_blank", "noopener,noreferrer")}>
            <WalletCards size={22} />
            <span><strong>支付宝 / 店铺卡密</strong><small>安全可靠，购买后回到本页兑换</small></span>
            <CheckCircle2 size={20} />
          </button>
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
  const textRun = creditFor(prices, (price) => price.unit === "text_run" || price.modality === "text", 50);
  const image = creditFor(prices, (price) => price.modality === "image", 100);
  const videoSecond = creditFor(prices, (price) => price.unit === "video_second" || price.modality === "video", 80);
  return [
    { title: "内容分析", desc: "题材、人物与剧情结构", credits: `${textRun} 积分 / 次`, icon: <Coins size={19} /> },
    { title: "剧本生成", desc: "小说改编与分集剧本", credits: `${textRun} 积分 / 次`, icon: <ReceiptText size={19} /> },
    { title: "分镜规划", desc: "按剧本场次规划镜头", credits: `${textRun} 积分 / 次`, icon: <ClipboardList size={19} /> },
    { title: "角色与场景图", desc: "视觉资产图片生成", credits: `${image} 积分 / 张`, icon: <CreditCard size={19} /> },
    { title: "镜头画面", desc: "分镜画面图片生成", credits: `${image} 积分 / 张`, icon: <Gift size={19} /> },
    { title: "镜头视频", desc: "图生视频 · 按秒计费", credits: `${videoSecond} 积分 / 秒`, icon: <WalletCards size={19} /> }
  ];
}

function creditFor(prices: ModelPrice[], predicate: (price: ModelPrice) => boolean, fallback: number) {
  return prices.find(predicate)?.unitCredits ?? fallback;
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
    <div className="page-stack ledger-page">
      <div className="page-title">
        <h1>积分明细</h1>
        <p>中文化展示消费、充值、冻结、退款和后台调整记录，方便你核对每一次生成成本。</p>
      </div>
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
        <div className="ledger-filter-tabs">
          {ledgerFilters.map((item) => (
            <button className={filter === item.id ? "active" : undefined} key={item.id} type="button" onClick={() => changeFilter(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="task-table ledger ledger-table-cn">
          <div className="task-row header">
            <span>类型</span>
            <span>积分变动</span>
            <span>余额</span>
            <span>说明</span>
            <span>时间</span>
          </div>
          {visibleTransactions.map((tx) => (
            <div className="task-row" key={tx.id}>
              <span className={`ledger-type-chip ${tx.type}`}>{transactionTypeLabel(tx.type)}</span>
              <strong className={tx.amount >= 0 ? "ledger-positive" : "ledger-negative"}>{tx.amount >= 0 ? "+" : ""}{tx.amount}</strong>
              <span>{tx.balanceAfter}</span>
              <span>{transactionDescriptionText(tx.description)}{tx.taskId || tx.projectId ? <small className="ledger-trace">{tx.projectId ? `项目 ${tx.projectId.slice(0, 10)}` : ""}{tx.taskId ? ` · 任务 ${tx.taskId.slice(0, 10)}` : ""}</small> : null}</span>
              <span>{formatLedgerDate(tx.createdAt)}</span>
            </div>
          ))}
          {!filteredTransactions.length ? (
            <div className="empty-state">
              {filter === "all"
                ? "暂无积分流水。充值入账或开始生成任务后，这里会出现每一笔冻结、扣费与退还记录。"
                : `暂无「${ledgerFilters.find((item) => item.id === filter)?.label ?? ""}」类型的流水记录，切回「全部」查看完整历史。`}
            </div>
          ) : null}
        </div>
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
