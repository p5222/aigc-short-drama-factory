import { useEffect, useState } from "react";
import type { CreatorInsights } from "@aifilm/shared";
import { requestJson } from "../lib/httpClient";

const stages = [
  ["creator_guide_shown", "看到起步引导"], ["creator_guide_started", "主动开始"], ["creator_brief_saved", "保存短片意图"],
  ["creator_script_viewed", "看到剧本"], ["creator_script_accepted", "确认剧本"],
  ["creator_preview_viewed", "查看分镜预览"], ["creator_export_viewed", "查看成片"], ["creator_export_accepted", "反馈成片可用"]
];
export function CreatorInsightsPanel() {
  const [data, setData] = useState<CreatorInsights | null>(null), [error, setError] = useState(""), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void requestJson<CreatorInsights>("/admin/creator-insights").then(value => {
      if (!Array.isArray(value.stages)) throw new Error("创作路径数据暂未读取成功");
      if (active) setData(value);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "读取失败"); });
    return () => { active = false; };
  }, [reload]);
  return <section className="admin-v2-card" aria-label="首作路径观察">
    <div className="admin-v2-card-head"><div><h2>首作路径观察</h2><p>最近 30 天，按事件去重统计创作者。用于定位卡点，逐步积累基线。</p></div><button className="ghost-button" type="button" onClick={() => setReload(value => value + 1)}>刷新路径数据</button></div>
    {error ? <p className="admin-toast danger" role="status">{error}</p> : null}
    <div className="adm-inline-overview">{stages.map(([event, title]) => <span key={event}>{title} <strong>{data ? data.stages.find(item => item.event === event)?.users ?? 0 : "未读取"}</strong></span>)}</div>
    {data ? <><div className="admin-policy-strip">
      <div><strong>首次确认用时</strong><p>{data.firstAccepted.medianSeconds === null ? "尚无已确认样本" : `${Math.round(data.firstAccepted.medianSeconds / 60)} 分钟（中位数）`} · {data.firstAccepted.projects} 个作品</p></div>
      <div><strong>接受时的修改</strong><p>修改后确认 {data.feedback.acceptedEdits} 次 · 未改文本确认 {data.feedback.acceptedUnchanged} 次</p></div>
      <div><strong>需要关注的执行</strong><p>结果待核对 {data.runs.find(run => run.status === "unknown")?.count ?? 0} · 需要修订 {data.runs.find(run => run.status === "needs_repair")?.count ?? 0} · 失败 {data.runs.find(run => run.status === "failed")?.count ?? 0}</p></div>
    </div><p className="admin-list-note">阶段人数来自各自事件，可能涉及不同用户与作品，不能直接相除作为首作转化率。首次确认从保存意图开始计时，只包含已确认作品。成片可用为作者反馈；真实质量、长期留存和供应商账单仍需单独核验。</p></> : !error ? <p className="admin-list-note">正在读取路径数据…</p> : null}
  </section>;
}
