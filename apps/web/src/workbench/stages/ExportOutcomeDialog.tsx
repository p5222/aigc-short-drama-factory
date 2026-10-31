import { useEffect, useRef, useState } from "react";
import type { ExportJob, ExportOutcomeReport } from "@aifilm/shared";
import { Dialog } from "../../design-system/ui";
import { requestJson } from "../../lib/httpClient";
import "./creator-outcome.css";

export function ExportOutcomeDialog({ job, onClose }: { job: ExportJob; onClose: () => void }) {
  const [report, setReport] = useState<ExportOutcomeReport | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [verdict, setVerdict] = useState<"usable" | "needs_changes" | "">(""), [note, setNote] = useState("");
  const touched = useRef(false), alive = useRef(true);
  const path = `/projects/${encodeURIComponent(job.projectId)}/export/jobs/${encodeURIComponent(job.id)}/outcome`;
  async function load() {
    setError("");
    try {
      const value = await requestJson<ExportOutcomeReport>(path);
      if (!alive.current) return;
      if (!value.outputFingerprint) throw new Error("成片反馈暂时无法读取");
      setReport(value);
      if (!touched.current) { setVerdict(value.review?.verdict ?? ""); setNote(value.review?.note ?? ""); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "成片反馈读取失败"); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [path]);
  async function save() {
    if (!report || busy || !verdict) return;
    setBusy(true); setError(""); setSaved(false);
    try {
      const value = await requestJson<ExportOutcomeReport>(path, { method: "POST", body: JSON.stringify({ expectedRevision: report.reviewRevision, outputFingerprint: report.outputFingerprint, verdict, note }) });
      if (alive.current) { setReport(value); setSaved(true); touched.current = false; }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "反馈保存失败"); }
    finally { if (alive.current) setBusy(false); }
  }
  function close() { if (!busy && (!touched.current || window.confirm("反馈尚未保存，确认关闭？"))) onClose(); }
  const costs = report?.costs;
  return <Dialog open title="这版成片，可以使用了吗？" description="反馈绑定当前导出版本。先预览成片，再按你的交付标准评价。" onClose={close} className="export-outcome-dialog" footer={<><button className="ghost-button" type="button" onClick={close} disabled={busy}>关闭</button><button className="primary-button" type="button" onClick={() => void save()} disabled={busy || !report || !touched.current || !verdict}>{busy ? "保存中…" : "保存作者反馈"}</button></>}>
    <div className="export-outcome">
      {error ? <p role="alert">{error}<button className="ghost-button" type="button" disabled={busy} onClick={() => void load()}>重新读取，保留草稿</button></p> : null}
      {!report && !error ? <p role="status">正在核对成片版本和消耗记录…</p> : null}
      {report ? <>
        <p className="creator-caption">{job.deliveryEdit ? `第 ${job.deliveryEdit.episodeNo} 集 · 剪辑 v${job.deliveryEdit.revision}` : "所选导出版本"} · {new Date(job.createdAt).toLocaleString("zh-CN")}{report.review ? ` · 反馈 v${report.review.revision}` : ""}</p>
        <fieldset disabled={busy}><legend>作者判断</legend><label><input type="radio" name="export-verdict" checked={verdict === "usable"} onChange={() => { touched.current = true; setVerdict("usable"); setSaved(false); }} />可用，达到我的交付要求</label><label><input type="radio" name="export-verdict" checked={verdict === "needs_changes"} onChange={() => { touched.current = true; setVerdict("needs_changes"); setSaved(false); }} />还需要修改</label></fieldset>
        <label className="export-outcome-note">具体原因 / 下一版要改什么<textarea disabled={busy} rows={4} maxLength={2000} value={note} onChange={event => { touched.current = true; setNote(event.target.value); setSaved(false); }} placeholder="人物是否一致、故事是否清楚、节奏或声音哪里需要调整…" /></label>
        {costs ? <section className="export-outcome-costs"><h3>完成这版作品的累计消耗</h3><dl>
          <div><dt>生成任务</dt><dd>{costs.taskCount} 次（含失败 / 取消 {costs.failedTaskCount} 次）</dd></div>
          <div><dt>已结算积分</dt><dd>{costs.credits ?? costs.knownCredits}{costs.credits === null ? `（未完整结算，${costs.unsettledTasks} 项待核对）` : " 积分"}</dd></div>
          <div><dt>成片时长</dt><dd>{report.durationSeconds === null ? "历史版本未记录" : `${report.durationSeconds.toFixed(1)} 秒`}</dd></div>
          <div><dt>每可用秒积分</dt><dd>{costs.creditsPerUsableSecond === null ? "确认可用且记录完整后计算" : costs.creditsPerUsableSecond.toFixed(2)}</dd></div>
          <div><dt>供应商成本</dt><dd>{costs.costMicros === null ? `未知（${costs.unknownCostTasks} 项缺少完整记录）` : `¥${(costs.costMicros / 1_000_000).toFixed(4)}`}</dd></div>
          <div><dt>账单核验</dt><dd>{{ invoice_verified: "全部已核验", partially_verified: "部分已核验", unverified: "尚未完整核验" }[costs.invoiceStatus]}</dd></div>
        </dl><p>累计范围：此制作项目及关联故事在本版导出完成前的生成、修复和失败任务。不同导出版本不相加；复用的 {costs.reusedAssets} 份历史素材，其原始成本不重复分摊。服务器、存储与支付费用未计入。</p></section> : null}
        {report.history.length ? <details><summary>历次反馈（{report.history.length}）</summary>{[...report.history].reverse().map(item => <article key={item.revision}><strong>v{item.revision} · {item.verdict === "usable" ? "可用" : "需要修改"}</strong><p>{item.note || "未填写原因"}</p><small>{new Date(item.reviewedAt).toLocaleString("zh-CN")}</small></article>)}</details> : null}
        {saved ? <p role="status">作者反馈已保存。该判断与自动规则检查分别记录。</p> : null}
      </> : null}
    </div>
  </Dialog>;
}
