import { useEffect, useState } from "react";
import type { CreatorInsights } from "@aifilm/shared";
import { requestJson } from "../lib/httpClient";

const stages = [
  ["creator_guide_shown", "看到起步引导"], ["creator_guide_started", "主动开始"], ["creator_brief_saved", "保存短片意图"],
  ["creator_script_viewed", "看到剧本"], ["creator_script_accepted", "确认剧本"],
  ["creator_preview_viewed", "查看分镜预览"], ["creator_export_viewed", "查看成片"], ["creator_export_accepted", "反馈成片可用"]
];
export function CreatorInsightsPanel() {
  const [data, setData] = useState<CreatorInsights | null>(null), [error, setError] = useState(""), [reload, setReload] = useState(0), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setError(""); setLoading(true);
    void requestJson<CreatorInsights>("/admin/creator-insights").then(value => {
      if (!Array.isArray(value.stages)) throw new Error("创作路径数据暂未读取成功");
      if (active) setData(value);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "读取失败"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const maximum = Math.max(1, ...stages.map(([event]) => data?.stages.find(item => item.event === event)?.users ?? 0));
  return <section className="ops-card ops-creator-path" aria-label="首作路径观察">
    <header><div><h2>首作路径观察</h2><p>最近 30 天 · 各阶段独立参与人数</p></div><button className="admin-secondary-btn compact" type="button" disabled={loading} onClick={() => setReload(value => value + 1)}>{loading ? "读取中…" : "刷新路径数据"}</button></header>
    {error ? <p className="admin-toast danger" role="status">{error}</p> : null}
    <div className="ops-path-grid"><div className="ops-path-bars">{stages.map(([event, title], index) => {
      const value = data?.stages.find(item => item.event === event)?.users ?? 0;
      return <div className="ops-path-row" key={event}><span><small>{String(index + 1).padStart(2, "0")}</small>{title}</span><meter min={0} max={maximum} value={value} aria-label={`${title} ${data ? value : "未读取"} 人`} /><strong>{data ? value : "—"}<small> 人</small></strong></div>;
    })}</div>
    {data ? <aside className="ops-path-insights">
      <div><span>首次确认用时</span><strong>{data.firstAccepted.medianSeconds === null ? "暂无样本" : `${Math.round(data.firstAccepted.medianSeconds / 60)} 分钟（中位数）`}</strong><p>{data.firstAccepted.projects} 个已确认作品</p></div>
      <div><span>剧本确认反馈</span><strong>{data.feedback.acceptedEdits + data.feedback.acceptedUnchanged} <small>次</small></strong><p>修改后确认 {data.feedback.acceptedEdits} 次 · 未改文本确认 {data.feedback.acceptedUnchanged} 次</p></div>
      <div><span>需要关注的执行</span><strong>结果待核对 {data.runs.find(run => run.status === "unknown")?.count ?? 0}</strong><p>需要修订 {data.runs.find(run => run.status === "needs_repair")?.count ?? 0} · 失败 {data.runs.find(run => run.status === "failed")?.count ?? 0}</p></div>
    </aside> : null}</div>
    <p className="ops-path-note">阶段人数来自各自事件，不能直接相除作为首作转化率。首次确认从保存意图开始计时，只含已确认作品；成片可用为作者反馈。</p>
  </section>;
}
