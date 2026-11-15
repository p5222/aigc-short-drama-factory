import { useMemo, useState } from "react";
import { Activity, ArrowUpRight, CheckCircle2, CircleDollarSign, Gift, MessageSquareText, ReceiptText, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import type { ReactNode } from "react";
import type { AdminActivityDay, AdminSummary, ModelPrice, ModelProvider } from "@aifilm/shared";
import { formatAdminMoney, formatAdminTaskSuccess } from "./adminMetricsModel";
import { navigateAdminHash } from "./adminNavigation";
import { providerHealth } from "./providerHealthModel";
import { ProviderHealth } from "./ProviderHealth";
import { CreatorInsightsPanel } from "./CreatorInsightsPanel";
import "./operations-overview.css";

const views = ["总览", "创作路径", "渠道健康", "收款积分"] as const;
const number = (value?: number) => value === undefined ? "未读取" : value.toLocaleString("zh-CN");
const stageNames: Record<string, string> = { text: "文本创作", image: "图片生成", video: "视频生成", tts: "配音生成", export: "成片导出", evaluation: "内容评测", embedding: "向量检索" };

export function OperationsOverview({ summary, providers, modelPrices, onConfigure }: {
  summary?: AdminSummary; providers: ModelProvider[]; modelPrices: ModelPrice[]; onConfigure: (id: string) => void;
}) {
  const [view, setView] = useState<typeof views[number]>("总览");
  const health = useMemo(() => providers.map(provider => providerHealth(provider, modelPrices)), [providers, modelPrices]);
  const attention = health.filter(item => item.needsAttention).length;
  const operations = summary?.operations;
  return <section className="ops-workspace" aria-label="运营数据">
    <div className="ops-viewbar">
      <nav className="ops-tabs" aria-label="运营数据分区">{views.map(item => <button type="button" key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item}{item === "渠道健康" && attention > 0 ? <b>{attention}</b> : null}</button>)}</nav>
      <span className="ops-updated">{operations ? `更新于 ${new Date(operations.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" })} · 北京时间` : "等待读取运营数据"}</span>
    </div>
    {view === "总览" ? <>
      <div className="ops-kpis">
        <Metric label="注册用户" value={number(summary?.users)} hint="累计注册账号" icon={<UserRound size={18} />} />
        <Metric label="创作项目" value={number(summary?.projects)} hint="累计创作项目" icon={<ReceiptText size={18} />} />
        <Metric label="今日任务" value={number(summary?.tasksToday)} hint="北京时间 00:00 起" icon={<Activity size={18} />} />
        <Metric label="实扣积分" value={number(summary?.creditsConsumed)} hint="累计消耗流水" icon={<WalletCards size={18} />} />
      </div>
      <div className="ops-actions" aria-label="运营待办">
        <strong>待办</strong>
        <Action icon={<MessageSquareText size={16} />} label="待处理工单" value={operations?.openTickets} action="回复待处理工单" target="支持工单" />
        <Action icon={<ShieldCheck size={16} />} label="待审核作品" value={operations?.pendingWorks} action="审核待发布作品" target="创作现场管理" />
        <Action icon={<ReceiptText size={16} />} label="待确认订单" value={operations?.pendingOrders} action="查看用户与账单" target="用户管理" />
        <Action icon={<Activity size={16} />} label="活动任务" value={operations?.activeTasks} action="检查活动与异常任务" target="异常任务" />
      </div>
      <div className="ops-main-grid">
        <ActivityChart data={summary?.activity} />
        <TaskHealth summary={summary} />
      </div>
      <section className="ops-card ops-capabilities" aria-label="创作能力准备情况">
        <header><div><h2>创作能力</h2><p>按模型检查密钥、协议、价格与额度</p></div><button className="admin-text-btn" type="button" onClick={() => setView("渠道健康")}>渠道详情<ArrowUpRight size={15} /></button></header>
        <div className="ops-capability-grid">{(["text", "image", "video", "tts"] as const).map(type => {
          const pool = health.filter(item => item.provider.modality === type && item.provider.enabled);
          const total = pool.reduce((sum, item) => sum + item.models.length, 0), ready = pool.reduce((sum, item) => sum + item.ready, 0);
          return <button key={type} type="button" onClick={() => setView("渠道健康")}>
            <span>{stageNames[type]}<strong>{ready}<small> / {total}</small></strong></span>
            <meter min={0} max={Math.max(total, 1)} value={ready} aria-label={`${stageNames[type]}配置齐全 ${ready}/${total}`} />
            <small>{total ? `${ready === total ? "配置齐全" : `${total - ready} 个待处理`} · 启用模型` : "尚未启用模型"}</small>
          </button>;
        })}</div>
      </section>
    </> : null}
    {view === "创作路径" ? <CreatorInsightsPanel /> : null}
    {view === "渠道健康" ? <ProviderHealth providers={providers} prices={modelPrices} onConfigure={onConfigure} onPrices={() => navigateAdminHash("价格策略")} /> : null}
    {view === "收款积分" ? <FinanceOverview summary={summary} /> : null}
    <details className="ops-definitions"><summary>统计口径与数据范围</summary><p>{summary?.metricsNote || "累计指标来自平台记录；今日与趋势按北京时间统计，任务不包含内部操作锁。"}</p><p>渠道配置齐全不代表真实生成已验收。店铺收款由店铺记录核对；兑换码到账不计为站内现金实收。</p></details>
  </section>;
}

function Metric({ label, value, hint, icon }: { label: string; value: ReactNode; hint: string; icon: ReactNode }) {
  return <article className="ops-kpi"><div><span>{label}</span>{icon}</div><strong>{value}</strong><small>{hint}</small></article>;
}

function Action({ label, value, action, target, icon }: { label: string; value?: number; action: string; target: string; icon: ReactNode }) {
  return <button type="button" aria-label={action} onClick={() => navigateAdminHash(target)} data-attention={value ? true : undefined}>{icon}<span>{label}</span><b>{number(value)}</b><ArrowUpRight size={13} /></button>;
}

const activityMetrics = {
  tasks: { label: "生成任务", unit: "个" },
  newUsers: { label: "新增用户", unit: "人" },
  creditsConsumed: { label: "实扣积分", unit: "积分" },
  redemptions: { label: "兑换次数", unit: "次" }
};
function ActivityChart({ data }: { data?: AdminActivityDay[] }) {
  const [days, setDays] = useState(7), [metric, setMetric] = useState<keyof typeof activityMetrics>("tasks");
  const [selected, setSelected] = useState<string>();
  const rows = data?.slice(-days) ?? [], spec = activityMetrics[metric];
  const total = rows.reduce((sum, row) => sum + row[metric], 0);
  const maximum = Math.max(1, ...rows.map(row => row[metric]));
  const active = rows.find(row => row.date === selected) ?? rows.at(-1);
  return <section className="ops-card ops-trend" aria-label="运营趋势">
    <header><div><h2>运营趋势</h2><p>按日期查看实际发生量</p></div><div className="ops-range" role="group" aria-label="趋势时间范围">{[7, 30].map(value => <button key={value} type="button" aria-pressed={days === value} onClick={() => { setDays(value); setSelected(undefined); }}>近 {value} 天</button>)}</div></header>
    <div className="ops-chart-heading"><label><span className="ops-sr-only">趋势指标</span><select value={metric} onChange={event => setMetric(event.target.value as keyof typeof activityMetrics)}>{Object.entries(activityMetrics).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><strong>{data ? number(total) : "未读取"} <small>{spec.unit}</small></strong><span>{active ? `${active.date.slice(5).replace("-", "/")} · ${number(active[metric])} ${spec.unit}` : "暂无趋势数据"}</span></div>
    {rows.length ? <div className="ops-chart" aria-label={`近 ${days} 天${spec.label}，共 ${total} ${spec.unit}`}>
      <span className="ops-chart-max">{number(maximum)}</span>
      <div className="ops-bars">{rows.map(row => <button key={row.date} type="button" onFocus={() => setSelected(row.date)} onMouseEnter={() => setSelected(row.date)} onClick={() => setSelected(row.date)} aria-label={`${row.date} ${spec.label} ${row[metric]} ${spec.unit}`} aria-pressed={active?.date === row.date}>
        <span style={{ height: `${row[metric] / maximum * 100}%` }} />
      </button>)}</div>
      <div className="ops-chart-axis"><span>{rows[0]!.date.slice(5).replace("-", "/")}</span><span>{total === 0 ? "这段时间暂无记录" : "悬停或选择柱条查看当天数据"}</span><span>{rows.at(-1)!.date.slice(5).replace("-", "/")}</span></div>
    </div> : <div className="ops-chart-empty" role="status">趋势数据尚未读取</div>}
  </section>;
}

function TaskHealth({ summary }: { summary?: AdminSummary }) {
  const done = summary?.completedTasks, failed = summary?.failedTasks, total = summary?.totalTasks;
  const active = summary?.operations?.activeTasks;
  const known = done !== undefined && failed !== undefined && active !== undefined && total !== undefined;
  const succeeded = known ? Math.max(0, done - failed) : 0;
  const statuses = [{ label: "成功", count: known ? succeeded : undefined, tone: "success" }, { label: "失败", count: failed, tone: "danger" }, { label: "排队 / 运行", count: active, tone: "active" }, { label: "其他状态", count: known ? Math.max(0, total - done - active) : undefined, tone: "other" }];
  const successAngle = total && known ? succeeded / total * 360 : 0;
  const failedAngle = total && known ? (succeeded + failed) / total * 360 : 0;
  const activeAngle = total && known ? (succeeded + failed + active) / total * 360 : 0;
  return <section className="ops-card ops-health" aria-label="任务健康度">
    <header><div><h2>任务健康度</h2><p>累计 {number(total)} 个任务</p></div><button className="admin-text-btn" type="button" onClick={() => navigateAdminHash("异常任务")}>处理异常<ArrowUpRight size={15} /></button></header>
    <div className="ops-health-body">
      <div className="ops-ring" role="img" aria-label={`已结束任务成功率：${formatAdminTaskSuccess(summary?.successRate, done)}`} style={{ background: `conic-gradient(var(--adm-accent) 0deg ${successAngle}deg, var(--adm-danger) ${successAngle}deg ${failedAngle}deg, var(--ops-active) ${failedAngle}deg ${activeAngle}deg, var(--adm-border) ${activeAngle}deg 360deg)` }}>
        <div><strong>{done ? formatAdminTaskSuccess(summary?.successRate, done) : "—"}</strong><span>已结束成功率</span></div>
      </div>
      <ul>{statuses.map(item => <li key={item.label} data-tone={item.tone}><i /><span>{item.label}</span><b>{number(item.count)}</b></li>)}</ul>
    </div>
    <p className="ops-health-note">{done ? `${number(done)} 个成功或失败任务参与成功率计算` : done === 0 ? "尚无已结束任务，暂不计算成功率" : "等待任务统计"} · 结果待核对请进入异常任务</p>
  </section>;
}

function FinanceOverview({ summary }: { summary?: AdminSummary }) {
  const rows = summary?.costByStage ?? [];
  const maximum = Math.max(1, ...rows.map(row => row.credits));
  const redemptions = summary?.activity?.reduce((sum, row) => sum + row.redemptions, 0);
  const redeemed = summary?.activity?.reduce((sum, row) => sum + row.redeemedCredits, 0);
  return <div className="ops-finance">
    <div className="ops-kpis">
      <Metric label="站内充值实收" value={formatAdminMoney(summary?.paidRechargeCny, "未读取")} hint="已支付的非模拟订单" icon={<CircleDollarSign size={18} />} />
      <Metric label="实扣积分" value={number(summary?.creditsConsumed)} hint="累计 consume 消耗流水" icon={<WalletCards size={18} />} />
      <Metric label="供应商实际成本" value={formatAdminMoney(summary?.providerCost)} hint={summary?.providerCostStatus === "recorded" ? "已记录实际成本" : "账单待接入，毛利暂不可计算"} icon={<ReceiptText size={18} />} />
      <Metric label="近 30 天兑换到账" value={number(redeemed)} hint={`${number(redemptions)} 次兑换 · 积分`} icon={<Gift size={18} />} />
    </div>
    <div className="ops-main-grid">
      <section className="ops-card ops-spending"><header><div><h2>积分消耗分布</h2><p>按任务类型 · 已结算积分</p></div></header>{rows.length ? rows.map(row => <div className="ops-spend-row" key={row.stage}><div><strong>{stageNames[row.stage] || row.stage}</strong><span>{number(row.credits)} 积分<small>{row.tasks} 个任务</small></span></div><meter min={0} max={maximum} value={row.credits} aria-label={`${stageNames[row.stage] || row.stage} ${row.credits} 积分`} /></div>) : <p>{summary ? "暂无任务消耗记录" : "等待读取消耗数据"}</p>}</section>
      <section className="ops-card ops-store"><header><div><h2>小店购买与兑换</h2><p>收款在小店，积分在漫角到账</p></div><Gift size={20} /></header>
        <ol><li><b>1</b><div><strong>配置购买链接</strong><span>为启用套餐设置小店商品地址</span></div><button type="button" onClick={() => navigateAdminHash("套餐会员")} aria-label="管理小店套餐"><ArrowUpRight size={16} /></button></li>
          <li><b>2</b><div><strong>准备兑换码</strong><span>生成单次码，导出给小店发货</span></div><button type="button" onClick={() => navigateAdminHash("兑换码")} aria-label="管理小店兑换码"><ArrowUpRight size={16} /></button></li>
          <li><b>3</b><div><strong>核对兑换到账</strong><span>按批次追踪使用情况与积分流水</span></div><button type="button" onClick={() => navigateAdminHash("积分中心")} aria-label="核对积分流水"><ArrowUpRight size={16} /></button></li></ol>
        <p>小店现金收入需核对小店订单，兑换次数和积分不等同现金实收。</p>
      </section>
    </div>
    <div className="ops-ledger-check">{summary?.unreconciledCredits === 0 ? <CheckCircle2 size={18} /> : <ReceiptText size={18} />}<span>积分账务核对</span><strong>{summary?.unreconciledCredits === undefined ? "未读取" : summary.unreconciledCredits ? `相差 ${number(summary.unreconciledCredits)} 积分` : "累计值与消耗流水一致"}</strong><span>解冻 {number(summary?.refundCredits)} 积分</span><button className="admin-text-btn" type="button" onClick={() => navigateAdminHash("积分中心")}>查看账务<ArrowUpRight size={14} /></button></div>
  </div>;
}
