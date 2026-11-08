import type { EvaluationStage, ExperimentRun, QualityReport } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { avg } from "./evidence.js";

export async function compareEvidence(baselineId: string, candidateId: string, stage: EvaluationStage): Promise<ExperimentRun["metrics"]> {
  const rows = await prisma.evaluationAttempt.findMany({ where: { runId: { in: [baselineId, candidateId] }, sample: { stage } }, include: { sample: true } });
  const baseline = rows.filter(a => a.runId === baselineId), candidate = rows.filter(a => a.runId === candidateId);
  const key = (a: typeof rows[number]) => `${a.sample.sampleKey}:${a.evaluatorKey}`;
  const keys = [...new Set(rows.map(key))];
  const reasons = new Set<string>();
  const pairs: Array<{ channel: string; b: QualityReport; c: QualityReport }> = [];
  let changed = 0, unmatched = 0;
  const sampleDeltas = keys.map(k => {
    const b = baseline.find(a => key(a) === k), c = candidate.find(a => key(a) === k), sample = (c ?? b)!.sample;
    const comparable = !!b && !!c && b.status === "succeeded" && c.status === "succeeded" && b.sample.fingerprint === c.sample.fingerprint && b.contractHash === c.contractHash;
    if (!b || !c || b.status !== "succeeded" || c.status !== "succeeded") unmatched++;
    else if (!comparable) changed++;
    const br = b?.report as unknown as QualityReport | undefined, cr = c?.report as unknown as QualityReport | undefined;
    if (comparable) pairs.push({ channel: b!.evaluatorKey, b: br!, c: cr! });
    const delta = comparable ? cr!.totalScore - br!.totalScore : undefined;
    return { projectId: sample.projectId, stage, channel: (c ?? b)!.evaluatorKey, baseline: br?.totalScore, candidate: cr?.totalScore, delta, evidenceChanged: !!b && !!c && !comparable,
      status: (!b ? "new" : !c ? "missing" : delta === undefined ? "same" : delta > 0 ? "improved" : delta < 0 ? "regressed" : "same") as ExperimentRun["metrics"]["sampleDeltas"][number]["status"] };
  });
  if (!rows.length) reasons.add("旧版运行缺少固定样本与评分契约");
  if (unmatched) reasons.add(`${unmatched} 项没有匹配的成功评测，不计入分差`);
  if (changed) reasons.add(`${changed} 项样本或评分契约改变，无法直接比较`);
  if (baseline.some(b => !candidate.some(c => c.evaluatorKey === b.evaluatorKey))) reasons.add("评测器变化需要人工标注校准，分数高不代表更准确");
  const channels = [...new Set(pairs.map(p => p.channel))].map(channel => {
    const group = pairs.filter(p => p.channel === channel);
    const b = avg(group.map(p => p.b.totalScore)), c = avg(group.map(p => p.c.totalScore));
    return { channel, paired: group.length, baseline: b, candidate: c, delta: c - b, passRateDelta: avg(group.map(p => p.c.pass ? 100 : 0)) - avg(group.map(p => p.b.pass ? 100 : 0)) };
  });
  const regressions = pairs.filter(p => p.c.totalScore < p.b.totalScore || (p.b.pass && !p.c.pass)).length;
  if (regressions) reasons.add(`${regressions} 项出现分数或通过状态回退`);
  reasons.add("尚无相同原始输入与可追溯生产版本的因果证据，结论待验证");
  const single = channels.length === 1;
  return { baselineScore: single ? channels[0].baseline : 0, candidateScore: single ? channels[0].candidate : 0, scoreDelta: single ? channels[0].delta : 0,
    baselinePassRate: single ? avg(pairs.map(p => p.b.pass ? 100 : 0)) : 0, candidatePassRate: single ? avg(pairs.map(p => p.c.pass ? 100 : 0)) : 0, passRateDelta: single ? channels[0].passRateDelta : 0,
    baselineReports: baseline.filter(a => a.status === "succeeded").length, candidateReports: candidate.filter(a => a.status === "succeeded").length, stageDeltas: [], sampleDeltas,
    comparability: { status: pairs.length ? "descriptive" : "insufficient", reasons: [...reasons], paired: pairs.length, changed, unmatched, regressions, channels } };
}
