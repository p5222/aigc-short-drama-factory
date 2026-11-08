import { lockCreditAccount } from "../billing/accountCredits.js";
import { ensureFunding, grantFunding } from "../billing/funding.js";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  AnalyticsEventInput,
  EvaluationDataset,
  EvaluationDatasetInput,
  EvaluationRun,
  EvaluationRunDetail,
  EvaluationOverview,
  ExperimentRun,
  FeedbackInput,
  PagedResult,
  PromptVersion,
  QualityAssetLineageStage,
  QualityCenterOverview,
  QualityEventRow,
  QualityGateStatus,
  QualityProjectRow,
  QualityReport,
  UserFeedback
} from "@aifilm/shared";
import { prisma } from "./client.js";
import { mapEvaluationDataset, mapEvaluationRun, mapExperimentRun, mapProject, mapPromptVersion, mapQualityReport, mapUserFeedback } from "./mappers.js";
import { runEvaluation as runQualityEvaluation, createFrozenDataset, reconcileStaleRuns, withEvaluationSnapshot } from "../evaluation/runner.js";
import { runEvidence } from "../evaluation/reviews.js";
import { compareEvidence } from "../evaluation/comparison.js";
import { updateFeedback as updateAdminFeedback } from "../evaluation/feedback.js";
export { runQualityEvaluation };
export { updateAdminFeedback };

type Stage = "script" | "character" | "storyboard" | "image" | "video";
type ModelMonitorGroup = {
  provider: string;
  model: string;
  modality: string;
  stage: string;
  tasks: number;
  succeeded: number;
  credits: number;
  costCny: number;
  latencies: number[];
  scores: number[];
  errors: Map<string, number>;
};

const stageLabels: Record<Stage, string> = {
  script: "剧本确认",
  character: "角色定稿",
  storyboard: "分镜拆解",
  image: "分镜图",
  video: "视频草稿"
};

export async function recordAnalyticsEvent(userId: string | undefined, input: AnalyticsEventInput) {
  if (userId && input.projectId && !await prisma.project.findFirst({ where: { id: input.projectId, userId }, select: { id: true } })) throw new Error("事件关联项目不属于当前用户");
  if (userId && input.taskId && !await prisma.generationTask.findFirst({ where: { id: input.taskId, userId, ...(input.projectId ? { projectId: input.projectId } : {}) }, select: { id: true } })) throw new Error("事件关联任务不属于当前用户或项目");

  const event = await prisma.analyticsEvent.create({
    data: {
      id: `event_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      userId,
      sessionId: input.sessionId?.slice(0, 120),
      eventName: input.eventName.trim(),
      entityType: input.entityType?.slice(0, 80),
      entityId: input.entityId?.slice(0, 160),
      projectId: input.projectId,
      taskId: input.taskId,
      sourceChannel: input.sourceChannel?.slice(0, 80),
      campaignCode: input.campaignCode?.slice(0, 80),
      properties: toJsonObject(input.properties)
    }
  });
  return event;
}

export async function createUserFeedback(userId: string, input: FeedbackInput): Promise<UserFeedback> {
  if (input.assetId) {
    const asset = await prisma.asset.findFirst({ where: { id: input.assetId, project: { userId }, ...(input.projectId ? { projectId: input.projectId } : {}) }, select: { projectId: true } });
    if (!asset) throw new Error("反馈关联的资产不存在或不属于当前用户。");
    input = { ...input, projectId: asset.projectId };
  }
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, userId }, select: { id: true } });
    if (!project) throw new Error("反馈关联的项目不存在或不属于当前用户。");
  }
  if (input.taskId) {
    const task = await prisma.generationTask.findFirst({ where: { id: input.taskId, userId }, select: { id: true, projectId: true } });
    if (!task || (input.projectId && task.projectId !== input.projectId)) throw new Error("反馈关联的任务不存在或与项目不匹配。");
  }

  const feedback = await prisma.$transaction(async (tx) => {
    if (input.projectId) await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`feedback:${userId}:${input.projectId}:${input.stage}`}))`;
    const priorStageFeedback = input.projectId
      ? await tx.userFeedback.findFirst({
          where: { userId, projectId: input.projectId, stage: input.stage },
          select: { id: true }
        })
      : null;
    const created = await tx.userFeedback.create({
      data: {
        id: `feedback_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        userId,
        projectId: input.projectId,
        taskId: input.taskId,
        assetId: input.assetId,
        stage: input.stage,
        rating: clamp(Math.round(input.rating), 1, 5),
        usability: input.usability,
        tags: input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
        content: (input.content ?? "").trim().slice(0, 1000),
        source: (input.source ?? "creator").trim().slice(0, 40) || "creator",
        priority: inferFeedbackPriority(input),
        status: "open"
      }
    });

    if (input.projectId && !priorStageFeedback) {
      const account = await lockCreditAccount(tx, userId);
      await ensureFunding(tx, userId, account.balance);
      await grantFunding(tx, { userId, credits: 10, source: "gift", cashMicros: 0 });
      const updated = await tx.creditAccount.update({
        where: { userId },
        data: {
          balance: { increment: 10 },
          totalRecharge: { increment: 10 }
        }
      });
      await tx.creditTransaction.create({
        data: {
          id: `tx_${Date.now()}_feedback_${crypto.randomUUID().slice(0, 8)}`,
          userId,
          projectId: input.projectId,
          type: "recharge",
          amount: 10,
          balanceAfter: updated.balance,
          description: `${stageLabels[input.stage]}首次有效反馈奖励，提交前余额 ${account.balance}`
        }
      });
    }

    return created;
  });

  await recordAnalyticsEvent(userId, {
    eventName: "submit_feedback",
    entityType: input.assetId ? "asset" : input.taskId ? "task" : "project",
    entityId: input.assetId ?? input.taskId ?? input.projectId,
    projectId: input.projectId,
    taskId: input.taskId,
    properties: {
      stage: input.stage,
      rating: input.rating,
      usability: input.usability,
      tags: input.tags
    }
  }).catch(() => undefined);

  return mapUserFeedback(feedback);
}

export async function generateProjectQualityReports(projectId: string, userId?: string, stages: Stage[] = ["script", "character", "storyboard", "image", "video"]): Promise<QualityReport[]> {
  const result = await runQualityEvaluation({
    projectIds: [projectId],
    stages,
    mode: "rules",
    maxLlmCalls: 0
  }, userId);
  return result.reports;
}

export async function listEvaluationDatasets(): Promise<EvaluationDataset[]> {
  const rows = await prisma.evaluationDataset.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
  return rows.map(mapEvaluationDataset);
}

export async function createEvaluationDataset(input: EvaluationDatasetInput): Promise<EvaluationDataset> {
  const row = await withEvaluationSnapshot(tx => createFrozenDataset(input, tx));
  return mapEvaluationDataset(row);
}

export async function listEvaluationRuns(): Promise<EvaluationRun[]> {
  await reconcileStaleRuns();
  const rows = await prisma.evaluationRun.findMany({
    include: { dataset: true, promptVersion: true },
    orderBy: { startedAt: "desc" },
    take: 100
  });
  return rows.map(mapEvaluationRun);
}

export async function listEvaluationDatasetsPage(options: { page?: number; pageSize?: number; keyword?: string } = {}): Promise<PagedResult<EvaluationDataset>> {
  const { page, pageSize, skip } = pagination(options.page, options.pageSize);
  const keyword = options.keyword?.trim();
  const where = keyword ? { OR: [{ name: { contains: keyword } }, { description: { contains: keyword } }] } : {};
  const [rows, total] = await prisma.$transaction([
    prisma.evaluationDataset.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take: pageSize }),
    prisma.evaluationDataset.count({ where })
  ]);
  return paged(rows.map(mapEvaluationDataset), page, pageSize, total);
}

export async function listEvaluationRunsPage(options: { page?: number; pageSize?: number; keyword?: string; status?: string } = {}): Promise<PagedResult<EvaluationRun>> {
  await reconcileStaleRuns();
  const { page, pageSize, skip } = pagination(options.page, options.pageSize);
  const keyword = options.keyword?.trim();
  const where = {
    ...(options.status && options.status !== "all" ? { status: options.status } : {}),
    ...(keyword ? { name: { contains: keyword } } : {})
  };
  const [rows, total] = await prisma.$transaction([
    prisma.evaluationRun.findMany({ where, include: { dataset: true, promptVersion: true }, orderBy: { startedAt: "desc" }, skip, take: pageSize }),
    prisma.evaluationRun.count({ where })
  ]);
  return paged(rows.map(mapEvaluationRun), page, pageSize, total);
}

export async function listAdminFeedbackPage(options: { page?: number; pageSize?: number; keyword?: string; stage?: string; status?: string } = {}): Promise<PagedResult<UserFeedback>> {
  const { page, pageSize, skip } = pagination(options.page, options.pageSize);
  const keyword = options.keyword?.trim();
  const where = {
    ...(options.stage && options.stage !== "all" ? { stage: options.stage } : {}),
    ...(options.status && options.status !== "all" ? { status: options.status } : {}),
    ...(keyword ? { OR: [{ content: { contains: keyword } }, { rootCause: { contains: keyword } }, { resolution: { contains: keyword } }] } : {})
  };
  const [rows, total] = await prisma.$transaction([
    prisma.userFeedback.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
    prisma.userFeedback.count({ where })
  ]);
  return paged(rows.map(mapUserFeedback), page, pageSize, total);
}

export async function listPromptVersionsPage(options: { page?: number; pageSize?: number; keyword?: string; stage?: string; status?: string; purpose?: string } = {}): Promise<PagedResult<PromptVersion>> {
  const { page, pageSize, skip } = pagination(options.page, options.pageSize);
  const keyword = options.keyword?.trim();
  const where = {
    ...(options.stage && options.stage !== "all" ? { stage: options.stage } : {}),
    ...(options.status && options.status !== "all" ? { status: options.status } : {}),
    ...(options.purpose && options.purpose !== "all" ? { purpose: options.purpose } : {}),
    ...(keyword ? { OR: [{ name: { contains: keyword } }, { key: { contains: keyword } }, { notes: { contains: keyword } }] } : {})
  };
  const [rows, total] = await prisma.$transaction([
    prisma.promptVersion.findMany({ where, orderBy: [{ stage: "asc" }, { updatedAt: "desc" }], skip, take: pageSize }),
    prisma.promptVersion.count({ where })
  ]);
  return paged(rows.map(mapPromptVersion), page, pageSize, total);
}

export async function createPromptVersion(input: {
  key: string;
  name: string;
  stage: Stage;
  purpose: "generation" | "evaluation";
  version: string;
  content: string;
  status?: "draft" | "active" | "archived";
  owner?: string;
  notes?: string;
}): Promise<PromptVersion> {
  const status = input.status ?? "draft";
  const key = input.key.trim().slice(0, 80);
  const row = await prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`evaluation-prompt:${key}`}))`;
  if (status === "active") await tx.promptVersion.updateMany({ where: { key, status: "active" }, data: { status: "archived" } });
  return tx.promptVersion.create({
    data: {
      id: `prompt_version_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      key,
      name: input.name.trim().slice(0, 100),
      stage: input.stage,
      purpose: input.purpose,
      version: input.version.trim().slice(0, 40),
      content: input.content.trim().slice(0, 20_000),
      status,
      owner: input.owner?.trim().slice(0, 80),
      notes: input.notes?.trim().slice(0, 800) ?? ""
    }
  });
  });
  return mapPromptVersion(row);
}

export async function updatePromptVersion(id: string, input: Partial<{
  name: string;
  content: string;
  status: "draft" | "active" | "archived";
  owner: string | null;
  notes: string;
}>): Promise<PromptVersion> {
  const existing = await prisma.promptVersion.findUnique({ where: { id } });
  if (!existing) throw new Error("提示词版本不存在。");
  const row = await prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`evaluation-prompt:${existing.key}`}))`;
  if (input.status === "active") await tx.promptVersion.updateMany({ where: { key: existing.key, status: "active", NOT: { id } }, data: { status: "archived" } });
  return tx.promptVersion.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim().slice(0, 100) } : {}),
      ...(input.content !== undefined ? { content: input.content.trim().slice(0, 20_000) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.owner !== undefined ? { owner: cleanNullable(input.owner, 80) } : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim().slice(0, 800) } : {})
    }
  });
  });
  return mapPromptVersion(row);
}

export async function listExperimentRunsPage(options: { page?: number; pageSize?: number; keyword?: string; stage?: string } = {}): Promise<PagedResult<ExperimentRun>> {
  const { page, pageSize, skip } = pagination(options.page, options.pageSize);
  const keyword = options.keyword?.trim();
  const where = {
    ...(options.stage && options.stage !== "all" ? { stage: options.stage } : {}),
    ...(keyword ? { OR: [{ name: { contains: keyword } }, { hypothesis: { contains: keyword } }] } : {})
  };
  const include = { dataset: true, baselineRun: true, candidateRun: true };
  const [rows, total] = await prisma.$transaction([
    prisma.experimentRun.findMany({ where, include, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
    prisma.experimentRun.count({ where })
  ]);
  return paged(rows.map(mapExperimentRun), page, pageSize, total);
}

export async function createExperimentRun(input: {
  name: string;
  stage: Stage;
  hypothesis: string;
  experimentType: "model" | "prompt" | "combined";
  baselineRunId: string;
  candidateRunId: string;
  successMetric?: string;
}): Promise<ExperimentRun> {
  if (input.baselineRunId === input.candidateRunId) throw new Error("基线与候选必须选择不同的评测运行。");
  const [baselineRow, candidateRow] = await Promise.all([
    prisma.evaluationRun.findUnique({ where: { id: input.baselineRunId }, include: { dataset: true, promptVersion: true, reports: { where: { stage: input.stage }, include: { project: { select: { name: true } } } } } }),
    prisma.evaluationRun.findUnique({ where: { id: input.candidateRunId }, include: { dataset: true, promptVersion: true, reports: { where: { stage: input.stage }, include: { project: { select: { name: true } } } } } })
  ]);
  if (!baselineRow || !candidateRow) throw new Error("基线或候选评测运行不存在。");
  if (baselineRow.status !== "completed" || candidateRow.status !== "completed") throw new Error("只有已完成的评测运行可以进入对比实验。");
  if (!baselineRow.stages.includes(input.stage) || !candidateRow.stages.includes(input.stage)) throw new Error("基线和候选运行都必须覆盖所选评测阶段。");
  const baseline = mapEvaluationRun(baselineRow);
  const candidate = mapEvaluationRun(candidateRow);
  const metrics = await compareEvidence(baseline.id, candidate.id, input.stage);
  // Current projects do not retain identical original inputs. Evaluator score shifts
  // and manually selected generation labels cannot establish production improvement.
  const winner = "pending";
  const baselineVersion = evaluationRunVariantLabel(baseline, input.experimentType);
  const candidateVersion = evaluationRunVariantLabel(candidate, input.experimentType);
  const row = await prisma.experimentRun.create({
    data: {
      id: `experiment_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      name: input.name.trim().slice(0, 100),
      stage: input.stage,
      hypothesis: input.hypothesis.trim().slice(0, 1000),
      baselineVersion,
      candidateVersion,
      experimentType: input.experimentType,
      datasetId: candidate.datasetId ?? baseline.datasetId,
      baselineRunId: baseline.id,
      candidateRunId: candidate.id,
      baselineConfig: toJsonValue(evaluationRunConfigSnapshot(baseline)),
      candidateConfig: toJsonValue(evaluationRunConfigSnapshot(candidate)),
      metrics: toJsonValue(metrics),
      winner,
      successMetric: input.successMetric?.trim().slice(0, 200) || "平均分与通过率不低于基线",
      resultSummary: `待验证：${metrics.comparability?.reasons.join("；") || "仅提供配对样本的描述性分差，尚不能证明生产效果提升。"}。`,
      status: "completed",
      startAt: baseline.startedAt < candidate.startedAt ? new Date(baseline.startedAt) : new Date(candidate.startedAt),
      endAt: new Date()
    },
    include: { dataset: true, baselineRun: true, candidateRun: true }
  });
  return mapExperimentRun(row);
}

export async function getEvaluationRun(id: string): Promise<EvaluationRunDetail | null> {
  await reconcileStaleRuns();
  const run = await prisma.evaluationRun.findUnique({
    where: { id },
    include: {
      dataset: true,
      promptVersion: true,
      reports: { orderBy: [{ projectId: "asc" }, { stage: "asc" }, { createdAt: "desc" }], take: 500 }
    }
  });
  if (!run) return null;
  return {
    run: mapEvaluationRun(run),
    reports: run.reports.map(mapQualityReport),
    ...await runEvidence(id)
  };
}

export async function deleteEvaluationDataset(id: string) {
  const row = await prisma.evaluationDataset.findUnique({ where: { id }, include: { _count: { select: { runs: true } } } });
  if (!row) throw new Error("评测数据集不存在。");
  if (row.protocolVersion >= 2) throw new Error("固定样本集保留复测与反馈证据，不能删除。");
  await prisma.evaluationRun.updateMany({ where: { datasetId: id }, data: { datasetId: null } });
  await prisma.evaluationDataset.delete({ where: { id } });
  return { id, deleted: true, detachedRuns: row._count.runs };
}

export async function deleteEvaluationRun(id: string) {
  const row = await prisma.evaluationRun.findUnique({ where: { id }, include: { _count: { select: { reports: true } } } });
  if (!row) throw new Error("评测记录不存在。");
  if (row.protocolVersion >= 2) throw new Error("固定样本评测保留调用及复核证据，不能删除。");
  if (["running", "needs_review"].includes(row.status)) throw new Error("执行中或待核对的记录不能删除。");
  await prisma.$transaction([
    prisma.qualityReport.deleteMany({ where: { evaluationRunId: id } }),
    prisma.evaluationRun.delete({ where: { id } })
  ]);
  return { id, deleted: true, deletedReports: row._count.reports };
}

export async function deleteProjectQualityData(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new Error("项目不存在。");
  if (await prisma.evaluationSample.count({ where: { projectId } })) throw new Error("项目已有固定评测证据，不能清除质量历史。");
  const [reports, feedbacks] = await prisma.$transaction([
    prisma.qualityReport.deleteMany({ where: { projectId } }),
    prisma.userFeedback.deleteMany({ where: { projectId } })
  ]);
  return { projectId, deletedReports: reports.count, deletedFeedbacks: feedbacks.count };
}

export async function getProjectQualityReports(projectId: string, userId?: string) {
  if (userId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true } });
    if (!project) throw new Error("项目不存在或无权查看评测。");
  }
  return (
    await prisma.qualityReport.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ).map(mapQualityReport);
}

export async function getAdminEvaluationOverview(): Promise<EvaluationOverview> {
  const [projects, reports, feedbacks, tasks] = await Promise.all([
    prisma.project.findMany({ orderBy: { updatedAt: "desc" }, take: 300 }),
    prisma.qualityReport.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }),
    prisma.userFeedback.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.generationTask.findMany({ orderBy: { createdAt: "desc" }, take: 1000 })
  ]);

  const latestReports = latestReportsByProjectStage(reports.map(mapQualityReport));
  const projectLatest = new Map<string, QualityReport[]>();
  latestReports.forEach((report) => {
    projectLatest.set(report.projectId, [...(projectLatest.get(report.projectId) ?? []), report]);
  });
  const latestVideoFeedback = new Map<string, typeof feedbacks[number]>();
  for (const feedback of feedbacks) if (feedback.projectId && feedback.stage === "video" && !latestVideoFeedback.has(feedback.projectId)) latestVideoFeedback.set(feedback.projectId, feedback);
  const effectiveProjects = [...latestVideoFeedback.values()].filter(item => item.usability === "usable").length;
  const stages: Stage[] = ["script", "character", "storyboard", "image", "video"];

  return {
    northStar: {
      effectiveProjects,
      totalProjects: projects.length,
      completionRate: projects.length ? Math.round((effectiveProjects / projects.length) * 100) : 0
    },
    funnel: stages.map((stage) => {
      const stageReports = latestReports.filter((report) => report.stage === stage);
      const pass = stageReports.filter((report) => report.pass).length;
      return {
        stage,
        label: stageLabels[stage],
        total: stageReports.length,
        pass,
        passRate: stageReports.length ? Math.round((pass / stageReports.length) * 100) : 0,
        averageScore: average(stageReports.map((report) => report.totalScore))
      };
    }),
    feedback: {
      total: feedbacks.length,
      unusable: feedbacks.filter((item) => item.usability === "unusable").length,
      topTags: topTags(feedbacks.flatMap((item) => item.tags))
    },
    failures: summarizeFailures(tasks),
    modelQuality: summarizeModelQuality(tasks, reports.map(mapQualityReport)),
    recentReports: reports.slice(0, 12).map(mapQualityReport),
    recentFeedback: feedbacks.slice(0, 12).map(mapUserFeedback)
  };
}

export async function listAdminQualityProjects(): Promise<QualityProjectRow[]> {
  const projects = await prisma.project.findMany({
    include: {
      user: { select: { name: true, email: true } },
      qualityReports: { orderBy: { createdAt: "desc" }, take: 20 },
      feedbacks: { orderBy: { createdAt: "desc" }, take: 20 }
    },
    orderBy: { updatedAt: "desc" },
    take: 100
  });

  return projects.map((project) => {
    const reports = latestReportsByProjectStage(project.qualityReports.map(mapQualityReport));
    const feedbacks = project.feedbacks.map(mapUserFeedback);
    return {
      project: mapProject(project),
      userName: project.user.name,
      userEmail: project.user.email ?? undefined,
      reports,
      feedbacks,
      latestStage: reports[0]?.stage ?? "none",
      averageScore: average(reports.filter(report => report.evidenceScope === "structure").map((report) => report.totalScore)),
      blockedReasons: [
        ...reports.filter((report) => !report.pass).flatMap((report) => report.problems.slice(0, 2)),
        ...feedbacks.filter((feedback) => feedback.usability === "unusable").flatMap((feedback) => feedback.tags.slice(0, 2))
      ].slice(0, 5)
    };
  });
}

export async function listAdminFeedback(limit = 200): Promise<UserFeedback[]> {
  const rows = await prisma.userFeedback.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(500, limit))
  });
  return rows.map(mapUserFeedback);
}

export async function getAdminQualityCenter(): Promise<QualityCenterOverview> {
  const [
    projects,
    tasks,
    feedbackRows,
    reportRows,
    datasetRows,
    runRows,
    providerRows,
    priceRows,
    templateRows
  ] = await Promise.all([
    prisma.project.findMany({
      include: {
        user: { select: { name: true, email: true } },
        tasks: { orderBy: { createdAt: "desc" }, take: 80 },
        assets: { orderBy: { createdAt: "desc" }, take: 120 },
        qualityReports: { orderBy: { createdAt: "desc" }, take: 80 },
        feedbacks: { orderBy: { createdAt: "desc" }, take: 80 }
      },
      orderBy: { updatedAt: "desc" },
      take: 40
    }),
    prisma.generationTask.findMany({
      include: {
        project: { select: { id: true, name: true, textProvider: true, textModel: true, imageProvider: true, imageModel: true, videoProvider: true, videoModel: true } },
        user: { select: { name: true, email: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 300
    }),
    prisma.userFeedback.findMany({
      include: {
        user: { select: { name: true, email: true } },
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true, provider: true, model: true, type: true, status: true, errorReason: true } },
        asset: { select: { id: true, name: true, type: true, status: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    }),
    prisma.qualityReport.findMany({
      include: {
        project: { select: { id: true, name: true, user: { select: { name: true, email: true } } } },
        task: { select: { id: true, title: true, provider: true, model: true, type: true, status: true } },
        asset: { select: { id: true, name: true, type: true, status: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 400
    }),
    prisma.evaluationDataset.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.evaluationRun.findMany({ include: { dataset: true, promptVersion: true }, orderBy: { startedAt: "desc" }, take: 50 }),
    prisma.modelProvider.findMany(),
    prisma.modelPrice.findMany({ where: { enabled: true } }),
    prisma.promptTemplate.findMany({ where: { enabled: true }, orderBy: { updatedAt: "desc" } })
  ]);

  const reports = reportRows.map(mapQualityReport);
  const datasets = datasetRows.map(mapEvaluationDataset);
  const runs = runRows.map(mapEvaluationRun);
  const feedback = feedbackRows.map(mapUserFeedback);
  const priceIndex = buildModelPriceIndex(priceRows);
  const events = buildQualityEvents(feedbackRows, tasks, reportRows).slice(0, 180);
  const modelMonitoring = buildModelMonitoring(tasks, reports, priceIndex);
  const samples = buildSampleRows(datasets, runs);
  const lineage = buildAssetLineageRows(projects, templateRows);
  const attribution = buildAttributionRows(events);
  const costAnomalies = tasks.filter(isCostAnomalyTask).length;
  const completedTasks = tasks.filter((task) => ["succeeded", "failed", "canceled", "refunded"].includes(task.status));
  const succeededTasks = tasks.filter((task) => task.status === "succeeded").length;
  const healthyModels = modelMonitoring.filter((row) => row.healthStatus !== "blocked").length;
  const stageOptimization = await getStageOptimizationOverview(30);

  return {
    summary: {
      successRate: completedTasks.length ? Math.round((succeededTasks / completedTasks.length) * 100) : 0,
      failureRate: completedTasks.length ? Math.round(((completedTasks.length - succeededTasks) / completedTasks.length) * 100) : 0,
      averageScore: average(reports.filter(report => report.evidenceScope === "structure").map((report) => report.totalScore)),
      p95LatencyMs: percentile(tasks.map(taskLatencyMs).filter((value) => value > 0), 95),
      costAnomalies,
      modelHealth: modelMonitoring.length ? Math.round((healthyModels / modelMonitoring.length) * 100) : 0,
      openEvents: events.filter((event) => !["resolved", "ignored"].includes(event.status)).length,
      sampleCount: samples.reduce((sum, sample) => sum + sample.sampleCount, 0)
    },
    events,
    voc: feedbackRows.map((row) => buildVocRow(row)).slice(0, 300),
    modelMonitoring,
    lab: {
      datasets,
      runs,
      recentReports: reports.slice(0, 80)
    },
    samples,
    attribution,
    releaseGates: [],
    lineage,
    stageOptimization,
    generatedAt: new Date().toISOString()
  };
}

export async function getStageOptimizationOverview(windowDays = 30): Promise<QualityCenterOverview["stageOptimization"]> {
  const days = clamp(Math.floor(windowDays), 1, 365);
  const since = new Date(Date.now() - days * 86_400_000);
  const [reportGroups, feedbackGroups, taskGroups, recentReports, recentFeedback] = await Promise.all([
    prisma.qualityReport.groupBy({
      by: ["stage", "pass"],
      where: { createdAt: { gte: since }, evidenceScope: "structure" },
      _count: { _all: true },
      _avg: { totalScore: true }
    }),
    prisma.userFeedback.groupBy({
      by: ["stage", "status", "usability"],
      where: { createdAt: { gte: since } },
      _count: { _all: true }
    }),
    prisma.generationTask.groupBy({
      by: ["type", "status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true }
    }),
    prisma.qualityReport.findMany({
      where: { createdAt: { gte: since }, pass: false, evidenceScope: "structure" },
      select: { stage: true, problems: true },
      orderBy: { createdAt: "desc" },
      take: 300
    }),
    prisma.userFeedback.findMany({
      where: { createdAt: { gte: since }, rootCause: { not: null } },
      select: { stage: true, rootCause: true },
      orderBy: { createdAt: "desc" },
      take: 300
    })
  ]);
  const contracts: Array<{ key: "content" | "assets" | "storyboard" | "final"; label: string; stages: Stage[]; taskTypes: string[] }> = [
    { key: "content", label: "内容", stages: ["script"], taskTypes: ["text"] },
    { key: "assets", label: "资产", stages: ["character", "image"], taskTypes: ["character", "image"] },
    { key: "storyboard", label: "分镜", stages: ["storyboard"], taskTypes: ["storyboard"] },
    { key: "final", label: "成片", stages: ["video"], taskTypes: ["video", "tts", "export"] }
  ];
  const rows = contracts.map((contract) => {
    const reportRows = reportGroups.filter((row) => contract.stages.includes(row.stage as Stage));
    const reportCount = reportRows.reduce((sum, row) => sum + row._count._all, 0);
    const passed = reportRows.filter((row) => row.pass).reduce((sum, row) => sum + row._count._all, 0);
    const averageScore = reportCount
      ? Math.round(reportRows.reduce((sum, row) => sum + (row._avg.totalScore ?? 0) * row._count._all, 0) / reportCount)
      : 0;
    const feedbackRows = feedbackGroups.filter((row) => contract.stages.includes(row.stage as Stage));
    const openFeedback = feedbackRows
      .filter((row) => !["resolved", "ignored"].includes(row.status))
      .reduce((sum, row) => sum + row._count._all, 0);
    const unusableFeedback = feedbackRows
      .filter((row) => row.usability === "unusable")
      .reduce((sum, row) => sum + row._count._all, 0);
    const failedTasks = taskGroups
      .filter((row) => contract.taskTypes.includes(row.type) && row.status === "failed")
      .reduce((sum, row) => sum + row._count._all, 0);
    const topProblems = mostFrequentText(recentReports
      .filter((row) => contract.stages.includes(row.stage as Stage))
      .flatMap((row) => Array.isArray(row.problems) ? row.problems.map((problem) => String(problem)) : []), 4);
    const topRootCauses = mostFrequentText(recentFeedback.filter((row) => contract.stages.includes(row.stage as Stage)).map((row) => row.rootCause ?? ""), 4);
    const passRate = reportCount ? Math.round((passed / reportCount) * 100) : 0;
    const health: QualityGateStatus = averageScore > 0 && averageScore < 60 || unusableFeedback >= 5 ? "blocked" : !reportCount || passRate < 80 || openFeedback || failedTasks ? "warning" : "pass";
    return {
      key: contract.key,
      label: contract.label,
      stages: contract.stages,
      reportCount,
      averageScore,
      passRate,
      openFeedback,
      unusableFeedback,
      failedTasks,
      topProblems,
      topRootCauses,
      recommendation: stageOptimizationRecommendation(contract.key, { reportCount, averageScore, passRate, openFeedback, unusableFeedback, failedTasks, topProblems, topRootCauses }),
      health
    };
  });
  const ranked = rows.filter((row) => row.reportCount || row.openFeedback || row.failedTasks)
    .sort((a, b) => stageOptimizationRisk(b) - stageOptimizationRisk(a));
  return { windowDays: days, bottleneck: ranked[0]?.key, rows };
}

function latestReportsByProjectStage(reports: QualityReport[]) {
  const map = new Map<string, QualityReport>();
  reports
    .filter(report => report.evidenceScope === "structure")
    .sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)))
    .forEach((report) => {
      const key = `${report.projectId}:${report.stage}`;
      if (!map.has(key)) map.set(key, report);
    });
  return [...map.values()];
}

function topTags(tags: string[]) {
  const counts = new Map<string, number>();
  tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));
}

function inferFeedbackPriority(input: FeedbackInput): UserFeedback["priority"] {
  const text = `${input.content ?? ""} ${input.tags.join(" ")}`;
  if (input.usability === "unusable" && /(扣费|付费|充值|导出|下载|无法生成|Failed|失败|卡死|串到|换脸|丢失)/i.test(text)) return "p0";
  if (input.usability === "unusable") return "p1";
  if (input.usability === "barely_usable") return "p2";
  return "p3";
}

function cleanNullable(value: string | undefined | null, maxLength: number) {
  const clean = (value ?? "").trim().slice(0, maxLength);
  return clean || null;
}

function summarizeFailures(tasks: Array<{ provider: string; model: string; type: string; status: string; errorReason: string | null }>) {
  const map = new Map<string, { provider: string; model: string; stage: string; count: number; reason: string }>();
  tasks
    .filter((task) => task.status === "failed")
    .forEach((task) => {
      const reason = task.errorReason || "未记录失败原因";
      const key = `${task.provider}:${task.model}:${task.type}:${reason}`;
      const current = map.get(key) ?? { provider: task.provider, model: task.model, stage: task.type, count: 0, reason };
      current.count += 1;
      map.set(key, current);
    });
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 10);
}

function buildModelPriceIndex(rows: Array<{ providerId: string | null; providerName: string; model: string; modality: string; vendorCostCny: number }>) {
  const map = new Map<string, { vendorCostCny: number }>();
  rows.forEach((row) => {
    [
      `${row.providerId ?? ""}:${row.model}:${row.modality}`,
      `${row.providerName}:${row.model}:${row.modality}`,
      `${row.providerId ?? ""}:${row.model}:all`,
      `${row.providerName}:${row.model}:all`
    ].forEach((key) => map.set(key, { vendorCostCny: row.vendorCostCny }));
  });
  return map;
}

function buildQualityEvents(feedbackRows: any[], tasks: any[], reportRows: any[]): QualityEventRow[] {
  const feedbackEvents = feedbackRows.map((row) => {
    const mapped = mapUserFeedback(row);
    const text = `${mapped.content} ${mapped.tags.join(" ")} ${mapped.rootCause ?? ""}`;
    return {
      id: `feedback:${mapped.id}`,
      source: "user_feedback",
      sourceLabel: "用户反馈",
      title: row.project?.name ?? row.task?.title ?? "未关联作品反馈",
      description: mapped.content || "用户未填写补充说明。",
      stage: mapped.stage,
      priority: mapped.priority,
      status: mapped.status,
      rootCause: mapped.rootCause ?? inferQualityRootCause(text, mapped.stage),
      projectId: mapped.projectId,
      projectName: row.project?.name,
      userName: row.user?.name ?? mapped.userId,
      taskId: mapped.taskId,
      taskTitle: row.task?.title,
      assetId: mapped.assetId,
      provider: row.task?.provider,
      model: row.task?.model,
      score: mapped.rating * 20,
      actionLabel: feedbackActionLabel(mapped),
      createdAt: mapped.createdAt
    } satisfies QualityEventRow;
  });

  const taskEvents = tasks
    .filter((task) => task.status === "failed")
    .map((task) => {
      const reason = task.errorReason || "任务失败，未记录上游错误。";
      return {
        id: `task:${task.id}`,
        source: task.provider || task.model ? "model_error" : "task_failure",
        sourceLabel: task.provider || task.model ? "模型错误" : "任务失败",
        title: task.title || task.project?.name || `${task.type} 任务失败`,
        description: reason,
        stage: task.type || "unknown",
        priority: priorityFromFailure(reason, task.type),
        status: "detected",
        rootCause: inferQualityRootCause(reason, task.type),
        projectId: task.projectId ?? undefined,
        projectName: task.project?.name,
        userName: task.user?.name ?? task.userId,
        taskId: task.id,
        taskTitle: task.title,
        provider: task.provider ?? undefined,
        model: task.model ?? undefined,
        latencyMs: taskLatencyMs(task),
        costCredits: task.finalCredits ?? task.estimatedCredits ?? 0,
        actionLabel: "排查模型、参数、队列和输入素材",
        createdAt: task.updatedAt.toISOString()
      } satisfies QualityEventRow;
    });

  const reportEvents = reportRows
    .filter((row) => !row.pass)
    .map((row) => {
      const report = mapQualityReport(row);
      const problemText = report.problems.join("；") || report.recommendedAction;
      return {
        id: `report:${report.id}`,
        source: "evaluation_failure",
        sourceLabel: "评测失败",
        title: `${row.project?.name ?? report.projectId} · ${stageLabels[report.stage] ?? report.stage}`,
        description: problemText || "评测未通过。",
        stage: report.stage,
        priority: report.totalScore < 55 ? "p1" : "p2",
        status: "detected",
        rootCause: inferQualityRootCause(`${problemText} ${report.recommendedAction}`, report.stage),
        projectId: report.projectId,
        projectName: row.project?.name,
        userName: row.project?.user?.name,
        taskId: report.taskId,
        taskTitle: row.task?.title,
        assetId: report.assetId,
        provider: report.provider,
        model: report.model,
        score: report.totalScore,
        actionLabel: actionLabelFromReport(report),
        createdAt: report.createdAt
      } satisfies QualityEventRow;
    });

  const manualReviewEvents = feedbackRows
    .filter((row) => ["triaged", "processing", "resolved"].includes(row.status) && (row.assignee || row.resolution))
    .map((row) => {
      const mapped = mapUserFeedback(row);
      return {
        id: `review:${mapped.id}`,
        source: "manual_review",
        sourceLabel: "人工复核",
        title: row.project?.name ?? "人工复核任务",
        description: mapped.resolution || mapped.content || "人工复核已创建。",
        stage: mapped.stage,
        priority: mapped.priority,
        status: mapped.status === "resolved" ? "resolved" : "queued",
        rootCause: mapped.rootCause ?? inferQualityRootCause(`${mapped.content} ${mapped.resolution ?? ""}`, mapped.stage),
        projectId: mapped.projectId,
        projectName: row.project?.name,
        userName: row.user?.name ?? mapped.userId,
        taskId: mapped.taskId,
        taskTitle: row.task?.title,
        assetId: mapped.assetId,
        provider: row.task?.provider,
        model: row.task?.model,
        score: mapped.rating * 20,
        actionLabel: mapped.status === "resolved" ? "等待回归验证" : "继续复现并记录修复结论",
        createdAt: mapped.updatedAt ?? mapped.createdAt
      } satisfies QualityEventRow;
    });

  return [...feedbackEvents, ...taskEvents, ...reportEvents, ...manualReviewEvents]
    .sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
}

function buildVocRow(row: any): QualityCenterOverview["voc"][number] {
  const feedback = mapUserFeedback(row);
  const compensationNeeded = feedback.priority === "p0" || /扣费|退费|充值|积分|补偿|余额/.test(`${feedback.content} ${feedback.tags.join(" ")}`);
  return {
    ...feedback,
    projectName: row.project?.name,
    userName: row.user?.name ?? feedback.userId,
    taskTitle: row.task?.title,
    compensationNeeded,
    customerAction: feedback.status === "resolved"
      ? "回访确认"
      : compensationNeeded
        ? "核实扣费并给出补偿结论"
        : feedback.priority === "p0" || feedback.priority === "p1"
          ? "优先联系用户同步处理进度"
          : "归因后进入产品迭代池"
  };
}

function buildModelMonitoring(
  tasks: any[],
  reports: QualityReport[],
  priceIndex: Map<string, { vendorCostCny: number }>
): QualityCenterOverview["modelMonitoring"] {
  const groups = new Map<string, ModelMonitorGroup>();

  tasks.forEach((task) => {
    const provider = task.provider || "unknown";
    const model = task.model || "unknown";
    const stage = task.type || "unknown";
    const key = `${provider}:${model}:${stage}`;
    const group: ModelMonitorGroup = groups.get(key) ?? { provider, model, modality: stage, stage, tasks: 0, succeeded: 0, credits: 0, costCny: 0, latencies: [], scores: [], errors: new Map<string, number>() };
    const credits = Number(task.finalCredits ?? task.estimatedCredits ?? 0);
    const price = priceIndex.get(`${provider}:${model}:${stage}`) ?? priceIndex.get(`${provider}:${model}:all`);
    group.tasks += 1;
    if (task.status === "succeeded") group.succeeded += 1;
    if (task.status === "failed") {
      const reason = normalizeReason(task.errorReason);
      group.errors.set(reason, (group.errors.get(reason) ?? 0) + 1);
    }
    group.credits += credits;
    group.costCny += price ? price.vendorCostCny : 0;
    const latency = taskLatencyMs(task);
    if (latency > 0 && ["succeeded", "failed", "canceled", "refunded"].includes(task.status)) group.latencies.push(latency);
    groups.set(key, group);
  });

    // Evaluation report provider/model identify the judge, not the generator.
    // Production quality scores require provenance and calibration; omit them here.

  return [...groups.values()]
    .map((group) => {
      const successRate = group.tasks ? Math.round((group.succeeded / group.tasks) * 100) : 0;
      const errorCount = [...group.errors.values()].reduce((sum, count) => sum + count, 0);
      const p95LatencyMs = percentile(group.latencies, 95);
      const healthStatus: QualityGateStatus = successRate < 70 || errorCount >= 5 ? "blocked" : successRate < 90 || p95LatencyMs > 120000 ? "warning" : "pass";
      return {
        provider: group.provider,
        model: group.model,
        modality: group.modality,
        stage: group.stage,
        tasks: group.tasks,
        successRate,
        failureRate: group.tasks ? Math.round(((group.tasks - group.succeeded) / group.tasks) * 100) : 0,
        averageScore: average(group.scores),
        averageLatencyMs: average(group.latencies),
        p95LatencyMs,
        credits: group.credits,
        costCny: Number(group.costCny.toFixed(2)),
        errorCount,
        topErrors: [...group.errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count })),
        healthStatus
      };
    })
    .sort((a, b) => b.tasks - a.tasks)
    .slice(0, 80);
}

function buildSampleRows(datasets: EvaluationDataset[], runs: EvaluationRun[]): QualityCenterOverview["samples"] {
  const runsByDataset = new Map<string, EvaluationRun[]>();
  runs.forEach((run) => {
    if (!run.datasetId) return;
    runsByDataset.set(run.datasetId, [...(runsByDataset.get(run.datasetId) ?? []), run]);
  });

  return datasets.map((dataset) => {
    const datasetRuns = runsByDataset.get(dataset.id) ?? [];
    const latest = datasetRuns[0];
    const sampleType = inferSampleType(dataset);
      const structure = latest?.summary.channels?.find(channel => channel.channel === "structure-v2");
      const readiness = latest?.status === "failed" ? "blocked" : "warning";
    return {
      id: dataset.id,
      name: dataset.name,
      description: dataset.description,
      source: dataset.source,
      sampleType,
      sampleCount: dataset.sampleCount,
      stages: dataset.stages,
      projectIds: dataset.projectIds,
      owner: dataset.owner,
      latestRunName: latest?.name,
        latestRunScore: structure?.reports ? structure.averageScore : undefined,
        latestRunPassRate: structure?.reports ? structure.passRate : undefined,
      readiness,
      createdAt: dataset.createdAt,
      updatedAt: dataset.updatedAt
    };
  });
}

function buildAttributionRows(events: QualityEventRow[]): QualityCenterOverview["attribution"] {
  const groups = new Map<string, QualityEventRow[]>();
  events.forEach((event) => groups.set(event.rootCause, [...(groups.get(event.rootCause) ?? []), event]));
  return [...groups.entries()]
    .map(([rootCause, items]) => {
      const resolved = items.filter((event) => ["resolved", "ignored"].includes(event.status)).length;
      return {
        rootCause,
        count: items.length,
        open: items.length - resolved,
        resolved,
          averageScore: 0,
        stages: uniqueText(items.map((event) => event.stage)).slice(0, 6),
        recommendation: attributionRecommendation(rootCause),
        recentEvents: items.slice(0, 4)
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function buildAssetLineageRows(projects: any[], templates: any[]): QualityCenterOverview["lineage"] {
  const templateByStage = new Map<string, any>();
  templates.forEach((template) => {
    const type = String(template.type ?? "").toLowerCase();
    ["script", "character", "storyboard", "image", "video"].forEach((stage) => {
      if (!templateByStage.has(stage) && type.includes(stage)) templateByStage.set(stage, template);
    });
  });

  return projects.slice(0, 80).map((project) => {
    const stages: QualityAssetLineageStage[] = ["script", "character", "storyboard", "image", "video", "tts", "export"].map((stage) => {
      const stageTasks = project.tasks.filter((task: any) => task.type === taskTypeForLineage(stage));
      const reportStage = normalizeLineageReportStage(stage);
        const stageReports = project.qualityReports.filter((report: any) => report.stage === reportStage && report.evidenceScope === "structure").slice(0, 1);
      const stageFeedback = project.feedbacks.filter((feedback: any) => feedback.stage === reportStage);
      const stageAssets = project.assets.filter((asset: any) => assetMatchesStage(asset.type, stage));
      const score = average(stageReports.map((report: any) => report.totalScore));
      const failed = stageTasks.some((task: any) => task.status === "failed") || stageReports.some((report: any) => !report.pass);
      const warning = stageFeedback.some((feedback: any) => feedback.usability !== "usable") || (score > 0 && score < 75);
      const latestTask = stageTasks[0];
      const latestReport = stageReports[0];
      const providerModel = lineageProviderModel(project, stage, latestTask);
      const status: QualityGateStatus = failed ? "blocked" : warning ? "warning" : "pass";
      return {
        stage,
        provider: providerModel.provider,
        model: providerModel.model,
          promptVersion: "实际生成版本请查看固定样本",
        tasks: stageTasks.length,
        assets: stageAssets.length,
        reports: stageReports.length,
        feedbacks: stageFeedback.length,
        score,
        costCredits: stageTasks.reduce((sum: number, task: any) => sum + Number(task.finalCredits ?? task.estimatedCredits ?? 0), 0),
        status,
        generatedAt: latestTask?.updatedAt?.toISOString?.() ?? latestReport?.createdAt?.toISOString?.()
      };
    });
    const safetyStatus: QualityGateStatus = stages.some((stage) => stage.status === "blocked") ? "blocked" : stages.some((stage) => stage.status === "warning") ? "warning" : "pass";
    const roleThumbs = project.assets
      .filter((asset: any) => ["role", "role_derivative", "role_reference"].includes(asset.type))
      .filter((asset: any) => asset.referenceUrl)
      .slice(0, 8)
      .map((asset: any) => ({
        assetId: asset.id,
        name: asset.name,
        type: asset.type,
        url: asset.referenceUrl ?? undefined,
        status: asset.status,
        characterId: asset.relatedCharacterId ?? undefined
      }));
    const storyboardThumbs = project.assets
      .filter((asset: any) => asset.type === "image")
      .filter((asset: any) => asset.referenceUrl)
      .slice(0, 10)
      .map((asset: any) => ({
        assetId: asset.id,
        name: asset.name,
        url: asset.referenceUrl ?? undefined,
        status: asset.status,
        shotNo: String(asset.name ?? "").match(/\d+-\d+-\d+/)?.[0]
      }));
      const latestReports = project.qualityReports.filter((report: any) => report.evidenceScope === "structure").slice(0, 5).map((report: any) => ({
      id: report.id,
      stage: report.stage as Stage,
      score: report.totalScore,
      pass: report.pass,
      action: report.recommendedAction
    }));
    const latestTasks = project.tasks.slice(0, 5).map((task: any) => ({
      id: task.id,
      type: task.type,
      title: task.title,
      provider: task.provider,
      model: task.model,
      status: task.status,
      credits: Number(task.finalCredits ?? task.estimatedCredits ?? 0),
      errorReason: task.errorReason ?? undefined
    }));
    const feedbackTagRows = topTags(project.feedbacks.flatMap((feedback: any) => feedback.tags)).slice(0, 5);
    return {
      projectId: project.id,
      projectName: project.name,
      userName: project.user?.name ?? project.userId,
      userEmail: project.user?.email ?? undefined,
      artStyle: project.artStyle,
      videoRatio: project.videoRatio,
      modelRoutes: {
        text: [project.textProvider, project.textModel].filter(Boolean).join(" / ") || undefined,
        image: [project.imageProvider, project.imageModel].filter(Boolean).join(" / ") || undefined,
        video: [project.videoProvider, project.videoModel].filter(Boolean).join(" / ") || undefined
      },
      roleThumbs,
      storyboardThumbs,
      latestTasks,
      latestReports,
      feedbackSummary: {
        total: project.feedbacks.length,
        unusable: project.feedbacks.filter((feedback: any) => feedback.usability === "unusable").length,
        topTags: feedbackTagRows.map((item) => item.tag)
      },
      totalCredits: stages.reduce((sum, stage) => sum + stage.costCredits, 0),
      safetyStatus,
      stages,
      updatedAt: project.updatedAt.toISOString()
    };
  });
}

function feedbackActionLabel(feedback: UserFeedback) {
  if (feedback.status === "converted") return "已沉淀为评测样本";
  if (feedback.status === "resolved") return "回访用户并进入回归验证";
  if (feedback.status === "processing") return "继续人工复核";
  if (feedback.priority === "p0" || feedback.priority === "p1") return "优先联系用户并归因";
  return "归类后进入迭代池";
}

function actionLabelFromReport(report: QualityReport) {
  if (report.recommendedAction.includes("rewrite")) return "重写或调整提示词";
  if (report.recommendedAction.includes("regenerate")) return "保留样本并重生成";
  if (report.stage === "character") return "复核角色一致性锚点";
  if (report.stage === "video") return "复核首帧、运动和视频模型";
  return "进入对应阶段修复";
}

function inferQualityRootCause(text: string, stage?: string) {
  const value = `${text} ${stage ?? ""}`;
  if (/模型|通道|接口|失败|timeout|rate|quota|provider|Failed/i.test(value)) return "模型失败";
  if (/prompt|提示词|约束|跑偏|不按|剧本|爽点|冲突/.test(value)) return "提示词问题";
  if (/角色|三视图|参考图|串脸|一致|服装|外貌/.test(value)) return "角色一致性";
  if (/流程|步骤|队列|卡住|状态|继续|导出/.test(value)) return "工作流问题";
  if (/按钮|页面|看不清|颜色|错位|点击|UI/.test(value)) return "UI误导";
  if (/扣费|积分|价格|成本|余额|充值|退费/.test(value)) return "成本异常";
  if (/上传|素材|图片|参考|数据|Excel|字段|缺失/.test(value)) return "数据缺失";
  return "其他";
}

function priorityFromFailure(reason: string, stage?: string): UserFeedback["priority"] {
  const text = `${reason} ${stage ?? ""}`;
  if (/扣费|充值|支付|余额|导出|下载|无法生成|panic|crash|quota/i.test(text)) return "p0";
  if (/failed|timeout|模型|视频|image|生成失败/i.test(text)) return "p1";
  return "p2";
}

function normalizeReason(value: unknown) {
  const reason = String(value || "未记录错误原因").replace(/\s+/g, " ").trim();
  return reason.slice(0, 120) || "未记录错误原因";
}

function inferSampleType(dataset: EvaluationDataset): QualityCenterOverview["samples"][number]["sampleType"] {
  const text = `${dataset.name} ${dataset.description} ${dataset.source}`.toLowerCase();
  if (/golden|黄金|标杆/.test(text)) return "golden";
  if (/badcase|bad case|失败|问题|反馈/.test(text)) return "badcase";
  if (/regression|回归/.test(text)) return "regression";
  if (/boundary|边界|极限/.test(text)) return "boundary";
  return "manual";
}

function attributionRecommendation(rootCause: string) {
  const map: Record<string, string> = {
    模型失败: "检查候选模型池、错误码、限流和自动降级策略。",
    提示词问题: "回到提示词评分模板，补充反例约束并跑核心样本回归。",
    角色一致性: "强化角色身份板、参考图锁定、多视图锚点和 Seed 策略。",
    工作流问题: "检查任务状态机、重试/继续逻辑、导出链路和队列超时。",
    UI误导: "优化入口、状态文案、禁用条件和异常提示。",
    成本异常: "复核价格策略、任务扣费、退款补偿和供应商单价。",
    数据缺失: "补齐 trace、资产、字段映射和用户输入校验。"
  };
  return map[rootCause] ?? "先聚类复现样本，再判断是否进入本轮迭代。";
}

function taskLatencyMs(task: { createdAt: Date; updatedAt: Date }) {
  const started = Number(new Date(task.createdAt));
  const ended = Number(new Date(task.updatedAt));
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
}

function percentile(values: number[], p: number) {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[index]);
}

function isCostAnomalyTask(task: { estimatedCredits: number; finalCredits: number | null }) {
  const finalCredits = Number(task.finalCredits ?? 0);
  const estimated = Number(task.estimatedCredits ?? 0);
  return estimated > 0 && finalCredits > estimated * 1.3;
}

function taskTypeForLineage(stage: string) {
  if (stage === "script") return "text";
  if (stage === "storyboard") return "storyboard";
  return stage;
}

function normalizeLineageReportStage(stage: string) {
  return ["script", "character", "storyboard", "image", "video"].includes(stage) ? stage : "video";
}

function assetMatchesStage(type: string, stage: string) {
  if (stage === "character") return ["role", "role_derivative", "role_reference"].includes(type);
  if (stage === "image") return ["image", "cover", "scene", "prop"].includes(type);
  if (stage === "video") return type === "video";
  if (stage === "tts") return ["audio", "subtitle"].includes(type);
  return false;
}

function lineageProviderModel(project: any, stage: string, task?: any) {
  if (task?.provider || task?.model) return { provider: task.provider ?? undefined, model: task.model ?? undefined };
  if (stage === "image") return { provider: project.imageProvider ?? undefined, model: project.imageModel ?? undefined };
  if (stage === "video" || stage === "tts" || stage === "export") return { provider: project.videoProvider ?? undefined, model: project.videoModel ?? undefined };
  return { provider: project.textProvider ?? undefined, model: project.textModel ?? undefined };
}

function summarizeModelQuality(
  tasks: Array<{ provider: string; model: string; type: string; status: string; finalCredits: number | null; estimatedCredits: number }>,
  reports: QualityReport[]
) {
  const groups = new Map<string, { provider: string; model: string; stage: string; tasks: number; succeeded: number; credits: number; scores: number[] }>();
  tasks.forEach((task) => {
    const key = `${task.provider}:${task.model}:${task.type}`;
    const group = groups.get(key) ?? { provider: task.provider, model: task.model, stage: task.type, tasks: 0, succeeded: 0, credits: 0, scores: [] };
    group.tasks += 1;
    if (task.status === "succeeded") group.succeeded += 1;
    group.credits += task.finalCredits ?? task.estimatedCredits;
    groups.set(key, group);
  });
  // Judge scores do not establish the generation model's quality.
  return [...groups.values()]
    .map((group) => ({
      provider: group.provider,
      model: group.model,
      stage: group.stage,
      tasks: group.tasks,
      successRate: group.tasks ? Math.round((group.succeeded / group.tasks) * 100) : 0,
      averageScore: average(group.scores),
      credits: group.credits
    }))
    .sort((a, b) => b.tasks - a.tasks)
    .slice(0, 12);
}

function pagination(pageValue?: number, pageSizeValue?: number) {
  const page = clamp(Math.floor(pageValue ?? 1), 1, 100_000);
  const pageSize = clamp(Math.floor(pageSizeValue ?? 20), 1, 100);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function paged<T>(items: T[], page: number, pageSize: number, total: number): PagedResult<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

function evaluationRunVariantLabel(run: EvaluationRun, experimentType: ExperimentRun["experimentType"]) {
  const models = run.evaluatorModels.map((model) => model.name || `${model.provider}/${model.model}`).join(" + ");
  if (experimentType === "model" && models) return models;
  if (experimentType === "prompt" && run.generationPromptVersionName) return run.generationPromptVersionName;
  if (experimentType === "prompt" && run.promptVersionName) return `评分：${run.promptVersionName}`;
  if (experimentType === "combined") return [run.generationPromptVersionName, models, run.promptVersionName ? `评分：${run.promptVersionName}` : ""].filter(Boolean).join(" + ") || run.name;
  if (models) return models;
  return run.name;
}

function evaluationRunConfigSnapshot(run: EvaluationRun) {
  return {
    runId: run.id,
    runName: run.name,
    datasetId: run.datasetId,
    datasetName: run.datasetName,
    stages: run.stages,
    mode: run.mode,
    evaluatorModels: run.evaluatorModels,
    promptVersionId: run.promptVersionId,
    promptVersionName: run.promptVersionName,
    promptSnapshot: run.promptSnapshot,
    generationPromptVersionId: run.generationPromptVersionId,
    generationPromptVersionName: run.generationPromptVersionName,
    generationPromptSnapshot: run.generationPromptSnapshot,
    summary: run.summary,
    startedAt: run.startedAt
  };
}

function mostFrequentText(values: string[], limit: number) {
  const counts = new Map<string, number>();
  values.map((value) => value.trim()).filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value]) => value);
}

function stageOptimizationRisk(row: QualityCenterOverview["stageOptimization"]["rows"][number]) {
  const scorePenalty = row.averageScore ? Math.max(0, 85 - row.averageScore) : 15;
  return scorePenalty + Math.max(0, 90 - row.passRate) * 0.5 + row.openFeedback * 3 + row.unusableFeedback * 4 + row.failedTasks * 2;
}

function stageOptimizationRecommendation(
  key: "content" | "assets" | "storyboard" | "final",
  row: Pick<QualityCenterOverview["stageOptimization"]["rows"][number], "reportCount" | "averageScore" | "passRate" | "openFeedback" | "unusableFeedback" | "failedTasks" | "topProblems" | "topRootCauses">
) {
  if (!row.reportCount) return "先补充该阶段的代表性样本并运行一次基线评测，建立可比较的起点。";
  const focus = row.topProblems[0] || row.topRootCauses[0];
  if (key === "content") return focus ? `优先针对“${focus}”调整内容生成提示词，并用相同样本对比新旧版本。` : "对比内容模型与生成提示词，重点观察结构、角色动机和对白可拍性。";
  if (key === "assets") return focus ? `优先修复“${focus}”，固定角色参考与视觉约束后重跑资产回归。` : "对比生图模型、角色提示词和参考图策略，重点观察角色一致性。";
  if (key === "storyboard") return focus ? `围绕“${focus}”调整分镜拆解提示词，再比较镜头覆盖和连续性。` : "对比分镜模型与拆镜提示词，重点观察镜头覆盖、连续性和可生成性。";
  return row.failedTasks
    ? `先处理 ${row.failedTasks} 个生成失败，再对比视频模型的可用率、连续性、耗时和成本。`
    : focus ? `围绕“${focus}”对比视频模型与运动提示词，观察成片可用率。` : "对比视频模型与运动提示词，联合观察可用率、连续性、耗时和成本。";
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function uniqueText(values: string[]) {
  return unique(values.map((value) => String(value).trim()).filter(Boolean));
}

function average(values: number[]) {
  const filtered = values.filter((value) => Number.isFinite(value));
  return filtered.length ? Math.round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length) : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toJsonObject(value: Record<string, unknown> | undefined): Prisma.InputJsonObject {
  if (!value) return {};
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
