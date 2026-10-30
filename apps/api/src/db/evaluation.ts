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
  QualityEvaluationRunInput,
  QualityEvaluationRunResult,
  QualityEvaluatorModel,
  QualityGateStatus,
  QualityProjectRow,
  QualityReport,
  UserFeedback
} from "@aifilm/shared";
import { callTextModelJson, hasTextModelConfig, textModelName, textProviderName } from "../agents/generator.js";
import { prisma } from "./client.js";
import { mapEvaluationDataset, mapEvaluationRun, mapExperimentRun, mapProject, mapPromptVersion, mapQualityReport, mapUserFeedback } from "./mappers.js";

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

export async function runQualityEvaluation(input: QualityEvaluationRunInput, userId?: string): Promise<QualityEvaluationRunResult> {
  const dataset = input.datasetId ? await prisma.evaluationDataset.findUnique({ where: { id: input.datasetId } }) : null;
  const promptVersion = input.promptVersionId ? await prisma.promptVersion.findUnique({ where: { id: input.promptVersionId } }) : null;
  const generationPromptVersion = input.generationPromptVersionId ? await prisma.promptVersion.findUnique({ where: { id: input.generationPromptVersionId } }) : null;
  if (input.promptVersionId && !promptVersion) throw new Error("所选提示词版本不存在。");
  if (promptVersion && promptVersion.purpose !== "evaluation") throw new Error("评分提示词必须选择用途为“评测”的版本。");
  if (input.generationPromptVersionId && !generationPromptVersion) throw new Error("所选生成提示词版本不存在。");
  if (generationPromptVersion && generationPromptVersion.purpose !== "generation") throw new Error("样本来源提示词必须选择用途为“生成”的版本。");
  const inputProjectIds = input.projectIds ?? [];
  const inputStages = input.stages ?? [];
  const selectedProjectIds = unique(inputProjectIds.length ? inputProjectIds : dataset?.projectIds ?? []).slice(0, 50);
  const selectedStages = unique(inputStages.length ? inputStages : dataset?.stages ?? []).filter((stage): stage is Stage => isStage(stage));
  const mode = input.mode ?? "rules";
  const maxLlmCalls = mode === "rules" ? 0 : clamp(Math.floor(input.maxLlmCalls ?? 3), 0, 50);
  const evaluators = mode === "rules" ? [] : normalizeEvaluatorModels(input.evaluatorModels);
  const skipped: QualityEvaluationRunResult["skipped"] = [];
  const allReports: QualityReport[] = [];
  let llmCalls = 0;
  let llmFailures = 0;
  let estimatedPromptItems = 0;

  const maxShotsPerPrompt = clamp(Math.floor(input.maxShotsPerPrompt ?? 8), 1, 25);
  const includeFeedback = input.includeFeedback ?? true;
  const run = await prisma.evaluationRun.create({
    data: {
      id: `eval_run_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      name: normalizeRunName(input.runName),
      datasetId: dataset?.id,
      datasetSnapshot: dataset ? toJsonValue(evaluationDatasetSnapshot(dataset)) : {},
      projectIds: selectedProjectIds,
      stages: selectedStages,
      mode,
      evaluatorModels: toJsonValue(evaluators),
      promptVersionId: promptVersion?.id,
      promptSnapshot: promptVersion ? toJsonValue(promptVersionSnapshot(promptVersion)) : {},
      generationPromptVersionId: generationPromptVersion?.id,
      generationPromptSnapshot: generationPromptVersion ? toJsonValue(promptVersionSnapshot(generationPromptVersion)) : {},
      maxLlmCalls,
      maxShotsPerPrompt,
      includeFeedback,
      status: "running",
      usage: emptyUsage(),
      skipped: [],
      summary: emptyRunSummary(selectedProjectIds.length),
      primaryProjectId: selectedProjectIds[0]
    },
    include: { dataset: true, promptVersion: true }
  });

  try {
    if (!selectedProjectIds.length || !selectedStages.length) {
      const result = emptyEvaluationRunResult({ projectCount: selectedProjectIds.length, stages: selectedStages, mode, skipped });
      const completedRun = await completeEvaluationRun(run.id, result);
      return { ...result, run: completedRun };
    }

    for (const projectId of selectedProjectIds) {
      const remainingCalls = maxLlmCalls - llmCalls;
      const result = await generateProjectQualityReportsControlled(projectId, userId, {
        stages: selectedStages,
        mode,
        evaluators: evaluators.slice(0, Math.max(0, remainingCalls)),
        maxLlmCalls: Math.max(0, remainingCalls),
        maxShotsPerPrompt,
        includeFeedback,
        promptVersion: promptVersion ?? undefined,
        evaluationRunId: run.id
      });
      allReports.push(...result.reports);
      llmCalls += result.usage.llmCalls;
      llmFailures += result.usage.llmFailures;
      estimatedPromptItems += result.usage.estimatedPromptItems;
      skipped.push(...result.skipped);
    }

    const result: QualityEvaluationRunResult = {
      projects: selectedProjectIds.length,
      stages: selectedStages,
      mode,
      reports: allReports,
      skipped,
      usage: {
        ruleReports: allReports.filter((report) => report.evaluatorType === "system").length,
        llmReports: allReports.filter((report) => report.evaluatorType === "ai").length,
        llmCalls,
        llmFailures,
        estimatedPromptItems
      }
    };
    const completedRun = await completeEvaluationRun(run.id, result);
    return { ...result, run: completedRun };
  } catch (error) {
    await prisma.evaluationRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorReason: formatError(error).slice(0, 1000),
        finishedAt: new Date(),
        usage: {
          ruleReports: allReports.filter((report) => report.evaluatorType === "system").length,
          llmReports: allReports.filter((report) => report.evaluatorType === "ai").length,
          llmCalls,
          llmFailures,
          estimatedPromptItems
        },
        skipped: toJsonValue(skipped),
        summary: buildRunSummary(allReports, selectedProjectIds.length)
      }
    });
    throw error;
  }
}

export async function listEvaluationDatasets(): Promise<EvaluationDataset[]> {
  const rows = await prisma.evaluationDataset.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
  return rows.map(mapEvaluationDataset);
}

export async function createEvaluationDataset(input: EvaluationDatasetInput): Promise<EvaluationDataset> {
  const projectIds = unique(input.projectIds).slice(0, 100);
  const stages = unique(input.stages).filter((stage): stage is Stage => isStage(stage));
  if (!projectIds.length) throw new Error("评测数据集至少需要选择 1 个项目。");
  if (!stages.length) throw new Error("评测数据集至少需要选择 1 个阶段。");

  const row = await prisma.evaluationDataset.create({
    data: {
      id: `eval_dataset_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      name: input.name.trim().slice(0, 80) || "未命名评测数据集",
      description: input.description?.trim().slice(0, 500) ?? "",
      source: input.source?.trim().slice(0, 40) || "manual",
      projectIds,
      stages,
      filters: toJsonObject(input.filters),
      sampleCount: projectIds.length,
      owner: input.owner?.trim().slice(0, 80)
    }
  });
  return mapEvaluationDataset(row);
}

export async function listEvaluationRuns(): Promise<EvaluationRun[]> {
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
  const metrics = compareEvaluationRuns(
    baseline,
    candidate,
    input.stage,
    baselineRow.reports.map((report) => ({ ...mapQualityReport(report), projectName: report.project.name })),
    candidateRow.reports.map((report) => ({ ...mapQualityReport(report), projectName: report.project.name }))
  );
  const winner = metrics.scoreDelta > 0 || (metrics.scoreDelta === 0 && metrics.passRateDelta > 0)
    ? "candidate"
    : metrics.scoreDelta < 0 || metrics.passRateDelta < 0 ? "baseline" : "tie";
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
      resultSummary: experimentResultSummary(metrics, winner, baselineVersion, candidateVersion),
      status: "completed",
      startAt: baseline.startedAt < candidate.startedAt ? new Date(baseline.startedAt) : new Date(candidate.startedAt),
      endAt: new Date()
    },
    include: { dataset: true, baselineRun: true, candidateRun: true }
  });
  return mapExperimentRun(row);
}

export async function getEvaluationRun(id: string): Promise<EvaluationRunDetail | null> {
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
    reports: run.reports.map(mapQualityReport)
  };
}

export async function deleteEvaluationDataset(id: string) {
  const row = await prisma.evaluationDataset.findUnique({ where: { id }, include: { _count: { select: { runs: true } } } });
  if (!row) throw new Error("评测数据集不存在。");
  await prisma.evaluationRun.updateMany({ where: { datasetId: id }, data: { datasetId: null } });
  await prisma.evaluationDataset.delete({ where: { id } });
  return { id, deleted: true, detachedRuns: row._count.runs };
}

export async function deleteEvaluationRun(id: string) {
  const row = await prisma.evaluationRun.findUnique({ where: { id }, include: { _count: { select: { reports: true } } } });
  if (!row) throw new Error("评测记录不存在。");
  await prisma.$transaction([
    prisma.qualityReport.deleteMany({ where: { evaluationRunId: id } }),
    prisma.evaluationRun.delete({ where: { id } })
  ]);
  return { id, deleted: true, deletedReports: row._count.reports };
}

export async function deleteProjectQualityData(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new Error("项目不存在。");
  const [reports, feedbacks] = await prisma.$transaction([
    prisma.qualityReport.deleteMany({ where: { projectId } }),
    prisma.userFeedback.deleteMany({ where: { projectId } })
  ]);
  return { projectId, deletedReports: reports.count, deletedFeedbacks: feedbacks.count };
}

async function completeEvaluationRun(runId: string, result: QualityEvaluationRunResult): Promise<EvaluationRun> {
  const updated = await prisma.evaluationRun.update({
    where: { id: runId },
    data: {
      status: "completed",
      finishedAt: new Date(),
      usage: toJsonValue(result.usage),
      skipped: toJsonValue(result.skipped),
      summary: toJsonValue(buildRunSummary(result.reports, result.projects))
    },
    include: { dataset: true, promptVersion: true }
  });
  return mapEvaluationRun(updated);
}

async function generateProjectQualityReportsControlled(
  projectId: string,
  userId: string | undefined,
  options: {
    stages: Stage[];
    mode: "rules" | "hybrid" | "llm";
    evaluators: QualityEvaluatorModel[];
    maxLlmCalls: number;
    maxShotsPerPrompt: number;
    includeFeedback: boolean;
    promptVersion?: { id: string; name: string; stage: string; version: string; content: string };
    evaluationRunId?: string;
  }
): Promise<QualityEvaluationRunResult> {
  const workflow = await prisma.project.findFirst({
    where: { id: projectId, ...(userId ? { userId } : {}) },
    include: {
      scripts: { orderBy: { createdAt: "desc" }, take: 1 },
      characterSet: { orderBy: { createdAt: "asc" } },
      assets: { orderBy: { createdAt: "asc" } },
      shots: { orderBy: [{ episodeNo: "asc" }, { sceneNo: "asc" }, { shotNo: "asc" }] },
      tasks: { orderBy: { createdAt: "desc" }, take: 20 },
      feedbacks: { orderBy: { createdAt: "desc" }, take: 20 }
    }
  });

  if (!workflow) {
    return emptyEvaluationRunResult({
      projectCount: 1,
      stages: options.stages,
      mode: options.mode,
      skipped: [{ projectId, reason: "项目不存在或无权评测。" }]
    });
  }

  const ruleReports = [
    workflow.scripts[0] ? buildScriptReport(workflow) : undefined,
    workflow.characterSet.length ? buildCharacterReport(workflow) : undefined,
    workflow.shots.length ? buildStoryboardReport(workflow) : undefined,
    workflow.assets.some((asset) => asset.type === "image") ? buildImageReport(workflow) : undefined,
    workflow.assets.some((asset) => asset.type === "video") ? buildVideoReport(workflow) : undefined
  ].filter((report): report is DraftReport => report ? options.stages.includes(report.stage) : false);

  if (!ruleReports.length) {
    return emptyEvaluationRunResult({
      projectCount: 1,
      stages: options.stages,
      mode: options.mode,
      skipped: [{ projectId, reason: "所选阶段没有可评测数据。" }]
    });
  }

  const reports: DraftReport[] = [];
  const skipped: QualityEvaluationRunResult["skipped"] = [];
  let llmCalls = 0;
  let llmFailures = 0;
  let estimatedPromptItems = 0;

  for (const ruleReport of ruleReports) {
    if (options.mode === "rules" || options.mode === "hybrid") reports.push(ruleReport);
    if (options.mode === "rules") continue;

    const remainingCalls = options.maxLlmCalls - llmCalls;
    if (remainingCalls <= 0) {
      skipped.push({ projectId, stage: ruleReport.stage, reason: `已达到本次 LLM 调用上限 ${options.maxLlmCalls}。` });
      continue;
    }

    const allowedEvaluators = options.evaluators.slice(0, remainingCalls);
    if (!allowedEvaluators.length) {
      skipped.push({ projectId, stage: ruleReport.stage, reason: "没有勾选可用的 LLM 评测模型。" });
      continue;
    }

    const llmResult = await runLlmEvaluators(workflow, ruleReport, {
      evaluators: allowedEvaluators,
      includeFeedback: options.includeFeedback,
      maxShotsPerPrompt: options.maxShotsPerPrompt,
      promptVersion: options.promptVersion
    });
    llmCalls += allowedEvaluators.length;
    llmFailures += llmResult.failures.length;
    estimatedPromptItems += estimatePromptItems(workflow, ruleReport.stage, options.maxShotsPerPrompt);
    reports.push(...llmResult.reports);
    if (options.mode === "hybrid" && llmResult.reports.length) {
      reports.push(buildEnsembleReport(ruleReport, llmResult.reports, llmResult.failures));
    }
    llmResult.failures.forEach((failure) => skipped.push({ projectId, stage: ruleReport.stage, reason: failure }));
  }

  if (!reports.length) {
    return emptyEvaluationRunResult({ projectCount: 1, stages: options.stages, mode: options.mode, skipped });
  }

  const created = await prisma.$transaction(
    reports.map((report, index) =>
      prisma.qualityReport.create({
        data: {
          id: `quality_${Date.now()}_${report.stage}_${crypto.randomUUID().slice(0, 8)}`,
          projectId: report.projectId ?? workflow.id,
          evaluationRunId: options.evaluationRunId,
          taskId: report.taskId,
          assetId: report.assetId,
          stage: report.stage,
          evaluatorType: report.evaluatorType,
          totalScore: report.totalScore,
          pass: report.pass,
          dimensionScores: report.dimensionScores,
          problems: report.problems,
          suggestions: report.suggestions,
          recommendedAction: report.recommendedAction,
          promptVersion: report.promptVersion,
          provider: report.provider,
          model: report.model,
          createdAt: new Date(Date.now() + index)
        }
      })
    )
  );

  const mapped = created.map(mapQualityReport);
  return {
    projects: 1,
    stages: options.stages,
    mode: options.mode,
    reports: mapped,
    skipped,
    usage: {
      ruleReports: mapped.filter((report) => report.evaluatorType === "system").length,
      llmReports: mapped.filter((report) => report.evaluatorType === "ai").length,
      llmCalls,
      llmFailures,
      estimatedPromptItems
    }
  };
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
  const effectiveProjects = [...projectLatest.values()].filter((items) => isEffectiveProject(items)).length;
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
      averageScore: average(reports.map((report) => report.totalScore)),
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
      averageScore: average(reports.map((report) => report.totalScore)),
      p95LatencyMs: percentile(tasks.map(taskLatencyMs).filter((value) => value > 0), 95),
      costAnomalies,
      modelHealth: modelMonitoring.length ? Math.round((healthyModels / modelMonitoring.length) * 100) : 0,
      openEvents: events.filter((event) => !["resolved", "ignored", "converted"].includes(event.status)).length,
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
      where: { createdAt: { gte: since } },
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
      where: { createdAt: { gte: since }, pass: false },
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
      .filter((row) => !["resolved", "ignored", "converted"].includes(row.status))
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

export async function updateAdminFeedback(
  id: string,
  input: Partial<Pick<UserFeedback, "status" | "priority">> & Partial<Record<"rootCause" | "assignee" | "resolution" | "convertedDatasetId", string | null>>
): Promise<UserFeedback> {
  const data: Prisma.UserFeedbackUpdateInput = {};
  if (input.status) {
    const status = normalizeFeedbackStatus(input.status);
    data.status = status;
    if (["resolved", "ignored", "converted"].includes(status)) {
      data.processedAt = new Date();
    } else if (status === "open") {
      data.processedAt = null;
    }
  }
  if (input.priority) data.priority = normalizeFeedbackPriority(input.priority);
  if ("rootCause" in input) data.rootCause = cleanNullable(input.rootCause, 80);
  if ("assignee" in input) data.assignee = cleanNullable(input.assignee, 80);
  if ("resolution" in input) data.resolution = cleanNullable(input.resolution, 800);
  if ("convertedDatasetId" in input) data.convertedDatasetId = cleanNullable(input.convertedDatasetId, 120);

  return mapUserFeedback(await prisma.userFeedback.update({ where: { id }, data }));
}

type DraftReport = {
  projectId?: string;
  stage: Stage;
  evaluatorType: "system" | "ai";
  totalScore: number;
  pass: boolean;
  dimensionScores: Record<string, number>;
  problems: string[];
  suggestions: string[];
  recommendedAction: string;
  promptVersion?: string;
  provider?: string;
  model?: string;
  taskId?: string;
  assetId?: string;
};

function buildScriptReport(workflow: any): DraftReport {
  const script = workflow.scripts[0];
  const content = `${script.synopsis}\n${script.content}`;
  const structure = scoreByLength(content, 500, 2500, 20);
  const hook = keywordScore(content, ["反转", "冲突", "危机", "秘密", "重生", "复仇", "误会", "真相"], 20);
  const episode = clamp(workflow.episodes > 0 ? 15 : 8, 0, 15);
  const character = clamp(workflow.characterSet.length * 5, 5, 15);
  const visual = keywordScore(content, ["镜头", "场景", "画面", "动作", "表情", "转身", "雨夜", "办公室", "街道"], 15);
  const production = clamp(15 - countTooHardScenes(content) * 3, 6, 15);
  const dimensions = { structure, hook, episode, character, visual, production };
  return reportFromDimensions({
    stage: "script",
    dimensions,
    passLine: 75,
    provider: workflow.textProvider,
    model: workflow.textModel,
    taskId: latestTaskId(workflow.tasks, "text"),
    problems: [
      structure < 14 ? "剧本结构还不够完整，后续分镜会缺少承接。" : "",
      hook < 14 ? "短剧钩子和情绪爆点偏弱，冷启动内容不容易打动用户。" : "",
      character < 10 ? "角色数量或角色目标不够清晰。" : "",
      visual < 10 ? "可视化动作和场景描写偏少。" : ""
    ],
    suggestions: [
      "补强开场冲突、关键反转和结尾钩子。",
      "把抽象心理活动改成动作、表情、场景和可生成画面。",
      "确保主要角色的目标、关系和冲突能被角色定稿模块读取。"
    ],
    recommendedAction: "continue"
  });
}

function buildCharacterReport(workflow: any): DraftReport {
  const roleAssets = workflow.assets.filter((asset: any) => asset.type === "role" || asset.type === "role_derivative" || asset.type === "role_reference");
  const primaryRefs = roleAssets.filter((asset: any) => asset.type === "role" && asset.referenceUrl && asset.status === "succeeded").length;
  const derivatives = roleAssets.filter((asset: any) => asset.type === "role_derivative" && asset.referenceUrl).length;
  const userReferences = roleAssets.filter((asset: any) => asset.type === "role_reference" && asset.referenceUrl).length;
  const characterCount = Math.max(1, workflow.characterSet.length);
  const identity = clamp(Math.round((workflow.characterSet.filter((item: any) => item.identity).length / characterCount) * 15), 0, 15);
  const appearance = clamp(Math.round((workflow.characterSet.filter((item: any) => item.appearance && item.costume).length / characterCount) * 20), 0, 20);
  const multiview = clamp(Math.round(((primaryRefs + derivatives * 0.5 + userReferences * 0.35) / characterCount) * 18), 0, 25);
  const storyMatch = workflow.characterSet.length ? 13 : 6;
  const referenceFollow = clamp(Math.round(((primaryRefs + userReferences * 0.5) / characterCount) * 15), 0, 15);
  const negativePrompt = clamp(Math.round((workflow.characterSet.filter((item: any) => item.negativePrompt).length / characterCount) * 10), 0, 10);
  const dimensions = { identity, appearance, multiview, storyMatch, referenceFollow, negativePrompt };
  return reportFromDimensions({
    stage: "character",
    dimensions,
    passLine: 80,
    provider: workflow.imageProvider,
    model: workflow.imageModel,
    taskId: latestTaskId(workflow.tasks, "character"),
    assetId: roleAssets.find((asset: any) => asset.referenceUrl)?.id,
    problems: [
      referenceFollow < 12 ? "角色参考图未完全锁定，后续分镜图容易脸和服装漂移。" : "",
      multiview < 16 ? "多视图资产不足，建议先补正面、侧面、背面和表情参考。" : "",
      appearance < 15 ? "角色外貌或服装锚点不够稳定。" : ""
    ],
    suggestions: [
      "先上传或生成角色正面参考图，再生成多视图设定表。",
      "把发型、服装主色、饰品和负面提示词固定下来。",
      "角色评分低于 80 时，不建议批量生成分镜图。"
    ],
    recommendedAction: referenceFollow < 12 ? "regenerate_multiview" : "lock_character"
  });
}

function buildStoryboardReport(workflow: any): DraftReport {
  const shots = workflow.shots;
  const total = Math.max(1, shots.length);
  const order = hasOrderedShots(shots) ? 10 : 5;
  const imageability = clamp(Math.round((shots.filter((shot: any) => shot.pictureDesc && shot.imagePrompt).length / total) * 20), 0, 20);
  const continuity = clamp(Math.round((shots.filter((shot: any) => shot.scene && shot.characters.length).length / total) * 20), 0, 20);
  const simplicity = clamp(15 - shots.filter((shot: any) => String(shot.cameraMovement).length > 18 || shot.duration > 12).length * 2, 6, 15);
  const rhythm = clamp(15 - Math.abs(Math.round(total / Math.max(1, workflow.episodes)) - 9), 6, 15);
  const prompt = clamp(Math.round((shots.filter((shot: any) => shot.imagePrompt && shot.videoPrompt).length / total) * 20), 0, 20);
  const dimensions = { order, imageability, continuity, simplicity, rhythm, prompt };
  return reportFromDimensions({
    stage: "storyboard",
    dimensions,
    passLine: 75,
    provider: workflow.textProvider,
    model: workflow.textModel,
    taskId: latestTaskId(workflow.tasks, "storyboard"),
    problems: [
      imageability < 15 ? "部分镜头画面描述或图片提示词不完整。" : "",
      continuity < 15 ? "部分镜头缺少角色、场景或动作承接。" : "",
      simplicity < 10 ? "镜头参数偏复杂，真实用户会难以理解和维护。" : "",
      prompt < 16 ? "图片/视频提示词不完整，后续生成可控性不足。" : ""
    ],
    suggestions: [
      "把复杂运镜收敛为少量用户能理解的镜头语言。",
      "保证每个镜头有角色、场景、动作、画面描述和图片提示词。",
      "把台词旁白保留为字幕/配音草稿，不作为当前生成必填项。"
    ],
    recommendedAction: "generate_images"
  });
}

function buildImageReport(workflow: any): DraftReport {
  const shots = workflow.shots;
  const imageAssets = workflow.assets.filter((asset: any) => asset.type === "image");
  const total = Math.max(1, shots.length);
  const succeeded = imageAssets.filter((asset: any) => asset.referenceUrl && asset.status === "succeeded").length;
  const promptMatch = clamp(Math.round((succeeded / total) * 20), 0, 20);
  const characterConsistency = clamp(Math.round((succeeded / total) * 20) + (hasRoleRefs(workflow) ? 5 : 0), 0, 25);
  const composition = clamp(Math.round((succeeded / total) * 15), 0, 15);
  const artifact = clamp(Math.round((succeeded / total) * 20), 0, 20);
  const videoReady = clamp(Math.round((succeeded / total) * 20), 0, 20);
  const dimensions = { promptMatch, characterConsistency, composition, artifact, videoReady };
  return reportFromDimensions({
    stage: "image",
    dimensions,
    passLine: 80,
    provider: workflow.imageProvider,
    model: workflow.imageModel,
    taskId: latestTaskId(workflow.tasks, "image"),
    assetId: imageAssets.find((asset: any) => asset.referenceUrl)?.id,
    problems: [
      succeeded < shots.length ? `还有 ${Math.max(0, shots.length - succeeded)} 张分镜图未生成或没有真实图片地址。` : "",
      !hasRoleRefs(workflow) ? "角色参考资产不足，分镜图一致性风险较高。" : "",
      videoReady < 16 ? "分镜图还不足以稳定进入图生视频。" : ""
    ],
    suggestions: [
      "优先补齐没有真实图片地址的镜头。",
      "低分图片只重生本镜头，不批量重跑全部镜头。",
      "角色漂移时先回到角色定稿补多视图，而不是只改分镜提示词。"
    ],
    recommendedAction: succeeded < shots.length ? "regenerate_missing_images" : "accept"
  });
}

function buildVideoReport(workflow: any): DraftReport {
  const shots = workflow.shots;
  const videoAssets = workflow.assets.filter((asset: any) => asset.type === "video");
  const imageAssets = workflow.assets.filter((asset: any) => asset.type === "image" && asset.referenceUrl);
  const total = Math.max(1, shots.length);
  const succeeded = videoAssets.filter((asset: any) => asset.referenceUrl && asset.status === "succeeded").length;
  const firstFrame = clamp(Math.round((imageAssets.length / total) * 20), 0, 20);
  const identity = clamp(Math.round((succeeded / total) * 20), 0, 20);
  const motion = clamp(Math.round((succeeded / total) * 20), 0, 20);
  const intent = clamp(Math.round((succeeded / total) * 20), 0, 20);
  const editable = clamp(Math.round((succeeded / total) * 20), 0, 20);
  const dimensions = { firstFrame, identity, motion, intent, editable };
  return reportFromDimensions({
    stage: "video",
    dimensions,
    passLine: 70,
    provider: workflow.videoProvider,
    model: workflow.videoModel,
    taskId: latestTaskId(workflow.tasks, "video"),
    assetId: videoAssets.find((asset: any) => asset.referenceUrl)?.id,
    problems: [
      imageAssets.length < shots.length ? "部分镜头还缺首帧图，图生视频稳定性不足。" : "",
      succeeded < shots.length ? "视频草稿没有覆盖全部镜头。" : ""
    ],
    suggestions: [
      "先确保分镜图全部通过，再进入批量视频生成。",
      "视频模型结果不稳定时，用单镜头重生和短时长策略控制成本。"
    ],
    recommendedAction: "generate_video_clips"
  });
}

function reportFromDimensions(input: {
  stage: Stage;
  dimensions: Record<string, number>;
  passLine: number;
  problems: string[];
  suggestions: string[];
  recommendedAction: string;
  provider?: string | null;
  model?: string | null;
  taskId?: string;
  assetId?: string;
}): DraftReport {
  const totalScore = Object.values(input.dimensions).reduce((sum, score) => sum + score, 0);
  return {
    stage: input.stage,
    evaluatorType: "system",
    totalScore,
    pass: totalScore >= input.passLine,
    dimensionScores: input.dimensions,
    problems: input.problems.filter(Boolean),
    suggestions: input.suggestions,
    recommendedAction: totalScore >= input.passLine ? input.recommendedAction : lowScoreAction(input.stage),
    provider: input.provider ?? undefined,
    model: input.model ?? undefined,
    taskId: input.taskId,
    assetId: input.assetId,
    promptVersion: `${input.stage}-rules-v1`
  };
}

function lowScoreAction(stage: Stage) {
  const actions: Record<Stage, string> = {
    script: "rewrite_script",
    character: "regenerate_multiview",
    storyboard: "edit_bad_shots",
    image: "regenerate_same_prompt",
    video: "regenerate_video_clip"
  };
  return actions[stage];
}

function latestTaskId(tasks: Array<{ id: string; type: string }>, type: string) {
  return tasks.find((task) => task.type === type)?.id;
}

function hasRoleRefs(workflow: any) {
  return workflow.assets.some((asset: any) => asset.type === "role" && asset.referenceUrl && asset.status === "succeeded");
}

function hasOrderedShots(shots: Array<{ episodeNo: number; sceneNo: number; shotNo: number }>) {
  return shots.every((shot) => shot.episodeNo > 0 && shot.sceneNo > 0 && shot.shotNo > 0);
}

function scoreByLength(content: string, min: number, good: number, maxScore: number) {
  if (!content.trim()) return 0;
  if (content.length >= good) return maxScore;
  if (content.length <= min) return Math.round(maxScore * 0.45);
  return clamp(Math.round((content.length / good) * maxScore), 0, maxScore);
}

function keywordScore(content: string, keywords: string[], maxScore: number) {
  const hits = keywords.filter((keyword) => content.includes(keyword)).length;
  return clamp(Math.round((hits / Math.min(5, keywords.length)) * maxScore), Math.round(maxScore * 0.45), maxScore);
}

function countTooHardScenes(content: string) {
  return ["千军万马", "大规模战争", "复杂群像", "爆炸", "灾难", "科幻城市"].filter((keyword) => content.includes(keyword)).length;
}

function latestReportsByProjectStage(reports: QualityReport[]) {
  const map = new Map<string, QualityReport>();
  reports
    .sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)))
    .forEach((report) => {
      const key = `${report.projectId}:${report.stage}`;
      if (!map.has(key)) map.set(key, report);
    });
  return [...map.values()];
}

function isEffectiveProject(reports: QualityReport[]) {
  const byStage = new Map(reports.map((report) => [report.stage, report]));
  return Boolean(
    byStage.get("script")?.pass &&
    byStage.get("character")?.pass &&
    byStage.get("image")?.pass
  );
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

function normalizeFeedbackStatus(value: string): UserFeedback["status"] {
  return ["open", "triaged", "processing", "resolved", "ignored", "converted"].includes(value)
    ? value as UserFeedback["status"]
    : "open";
}

function normalizeFeedbackPriority(value: string): UserFeedback["priority"] {
  return ["p0", "p1", "p2", "p3"].includes(value)
    ? value as UserFeedback["priority"]
    : "p2";
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

  reports.forEach((report) => {
    if (!report.provider || !report.model) return;
    const key = `${report.provider}:${report.model}:${report.stage}`;
    const group: ModelMonitorGroup = groups.get(key) ?? { provider: report.provider, model: report.model, modality: report.stage, stage: report.stage, tasks: 0, succeeded: 0, credits: 0, costCny: 0, latencies: [], scores: [], errors: new Map<string, number>() };
    group.scores.push(report.totalScore);
    groups.set(key, group);
  });

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
    const readiness = latest
      ? latest.summary.passRate >= 85 ? "pass" : latest.summary.passRate >= 70 ? "warning" : "blocked"
      : sampleType === "manual" ? "warning" : "pass";
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
      latestRunScore: latest?.summary.averageScore,
      latestRunPassRate: latest?.summary.passRate,
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
      const resolved = items.filter((event) => ["resolved", "ignored", "converted"].includes(event.status)).length;
      return {
        rootCause,
        count: items.length,
        open: items.length - resolved,
        resolved,
        averageScore: average(items.map((event) => event.score ?? 0).filter(Boolean)),
        stages: uniqueText(items.map((event) => event.stage)).slice(0, 6),
        recommendation: attributionRecommendation(rootCause),
        recentEvents: items.slice(0, 4)
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function buildReleaseGates(input: {
  latestRun?: EvaluationRun;
  openP0P1: number;
  blockedModels: number;
  costAnomalies: number;
  samples: QualityCenterOverview["samples"];
  traceCoverage: number;
}): QualityCenterOverview["releaseGates"] {
  const regressionSamples = input.samples.filter((sample) => ["golden", "badcase", "regression"].includes(sample.sampleType));
  const latestPassRate = input.latestRun?.summary.passRate ?? 0;
  const latestAverage = input.latestRun?.summary.averageScore ?? 0;
  const now = new Date().toISOString();
  return [
    {
      id: "core-samples",
      name: "核心样本覆盖",
      target: "新 prompt / 新模型 / 新流程",
      status: regressionSamples.length >= 3 ? "pass" : regressionSamples.length ? "warning" : "blocked",
      metric: "golden+badcase+regression 样本集",
      threshold: "至少 3 个",
      current: `${regressionSamples.length} 个`,
      owner: "产品 / 算法",
      action: regressionSamples.length >= 3 ? "可作为发布前回归集" : "从事件池继续沉淀代表性样本",
      updatedAt: now
    },
    {
      id: "latest-eval",
      name: "最近评测通过率",
      target: input.latestRun?.name ?? "暂无评测运行",
      status: latestPassRate >= 85 && latestAverage >= 80 ? "pass" : latestPassRate >= 70 ? "warning" : "blocked",
      metric: "passRate / averageScore",
      threshold: ">=85% / >=80分",
      current: `${latestPassRate}% / ${latestAverage || "-"}分`,
      owner: "质量运营",
      action: latestPassRate >= 85 ? "允许灰度前复核" : "先运行核心样本回归并修复低分阶段",
      updatedAt: input.latestRun?.updatedAt ?? now
    },
    {
      id: "p0-feedback",
      name: "P0/P1 未关闭事件",
      target: "用户反馈 + 模型错误 + 评测失败",
      status: input.openP0P1 === 0 ? "pass" : input.openP0P1 <= 2 ? "warning" : "blocked",
      metric: "open P0/P1",
      threshold: "0",
      current: `${input.openP0P1} 个`,
      owner: "运营 / 客服",
      action: input.openP0P1 ? "先处理或明确关闭理由" : "无阻塞用户事件",
      updatedAt: now
    },
    {
      id: "model-health",
      name: "模型健康",
      target: "文本 / 生图 / 视频 / 导出",
      status: input.blockedModels === 0 ? "pass" : input.blockedModels <= 2 ? "warning" : "blocked",
      metric: "blocked model rows",
      threshold: "0",
      current: `${input.blockedModels} 个`,
      owner: "模型运营",
      action: input.blockedModels ? "切换候选模型或降级路由" : "模型池可用",
      updatedAt: now
    },
    {
      id: "cost-anomaly",
      name: "成本异常",
      target: "积分扣费 / 供应商成本",
      status: input.costAnomalies === 0 ? "pass" : input.costAnomalies <= 3 ? "warning" : "blocked",
      metric: "finalCredits > estimatedCredits * 1.3",
      threshold: "0",
      current: `${input.costAnomalies} 个`,
      owner: "商业化 / 财务",
      action: input.costAnomalies ? "复核价格策略和任务补偿" : "未发现明显扣费异常",
      updatedAt: now
    },
    {
      id: "lineage-coverage",
      name: "资产溯源覆盖",
      target: "作品生成链路",
      status: input.traceCoverage >= 90 ? "pass" : input.traceCoverage >= 70 ? "warning" : "blocked",
      metric: "有模型或 prompt 版本记录的作品",
      threshold: ">=90%",
      current: `${input.traceCoverage}%`,
      owner: "研发",
      action: input.traceCoverage >= 90 ? "溯源覆盖达标" : "补齐任务 trace、模型、promptVersion 和参数记录",
      updatedAt: now
    }
  ];
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
      const stageReports = project.qualityReports.filter((report: any) => report.stage === reportStage);
      const stageFeedback = project.feedbacks.filter((feedback: any) => feedback.stage === reportStage);
      const stageAssets = project.assets.filter((asset: any) => assetMatchesStage(asset.type, stage));
      const score = average(stageReports.map((report: any) => report.totalScore));
      const failed = stageTasks.some((task: any) => task.status === "failed") || stageReports.some((report: any) => !report.pass);
      const warning = stageFeedback.some((feedback: any) => feedback.usability !== "usable") || (score > 0 && score < 75);
      const latestTask = stageTasks[0];
      const latestReport = stageReports[0];
      const providerModel = lineageProviderModel(project, stage, latestTask, latestReport);
      const status: QualityGateStatus = failed ? "blocked" : warning ? "warning" : "pass";
      return {
        stage,
        provider: providerModel.provider,
        model: providerModel.model,
        promptVersion: latestReport?.promptVersion ?? templateByStage.get(stage)?.version ?? "workflow-current",
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
    const latestReports = project.qualityReports.slice(0, 5).map((report: any) => ({
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

function lineageProviderModel(project: any, stage: string, task?: any, report?: any) {
  if (task?.provider || task?.model) return { provider: task.provider ?? undefined, model: task.model ?? undefined };
  if (report?.provider || report?.model) return { provider: report.provider ?? undefined, model: report.model ?? undefined };
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
  reports.forEach((report) => {
    if (!report.provider || !report.model) return;
    const key = `${report.provider}:${report.model}:${report.stage}`;
    const group = groups.get(key) ?? { provider: report.provider, model: report.model, stage: report.stage, tasks: 0, succeeded: 0, credits: 0, scores: [] };
    group.scores.push(report.totalScore);
    groups.set(key, group);
  });
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

type LlmEvaluationOutput = {
  totalScore?: number;
  pass?: boolean;
  dimensionScores?: Record<string, number>;
  mainProblems?: string[];
  suggestedFixes?: string[];
  problems?: string[];
  suggestions?: string[];
  recommendedAction?: string;
  badShots?: Array<{ shotNo?: string; problem?: string; fix?: string }>;
};

async function runLlmEvaluators(
  workflow: any,
  ruleReport: DraftReport,
  options: {
    evaluators: QualityEvaluatorModel[];
    includeFeedback: boolean;
    maxShotsPerPrompt: number;
    promptVersion?: { id: string; name: string; stage: string; version: string; content: string };
  }
): Promise<{ reports: DraftReport[]; failures: string[] }> {
  const reports: DraftReport[] = [];
  const failures: string[] = [];
  const prompt = await buildLlmEvaluationPrompt(workflow, ruleReport.stage, options);

  for (const evaluator of options.evaluators) {
    try {
      if (!hasTextModelConfig({ textProvider: evaluator.provider, textModel: evaluator.model })) {
        failures.push(`${evaluator.provider}/${evaluator.model} 未配置可用 API Key 或 Base URL。`);
        continue;
      }
      const result = await callTextModelJson<LlmEvaluationOutput>({
        textProvider: evaluator.provider,
        textModel: evaluator.model,
        system: "你是严谨的 AI 漫剧生产质检评测员。只输出合法 JSON，不输出 Markdown。",
        prompt,
        temperature: 0.12,
        maxTokens: Number(process.env.QUALITY_EVALUATOR_MAX_TOKENS ?? 1800),
        label: `${ruleReport.stage} LLM 评测`
      });
      reports.push(normalizeLlmReport(result, workflow, ruleReport, evaluator, options.promptVersion));
    } catch (error) {
      failures.push(`${evaluator.provider}/${evaluator.model} 评测失败：${formatError(error)}`);
    }
  }

  return { reports, failures };
}

function normalizeLlmReport(
  result: LlmEvaluationOutput,
  workflow: any,
  ruleReport: DraftReport,
  evaluator: QualityEvaluatorModel,
  promptVersion?: { name: string; stage: string; version: string }
): DraftReport {
  const dimensionScores = normalizeDimensionScores(result.dimensionScores, ruleReport.dimensionScores);
  const totalScore = clamp(Math.round(Number(result.totalScore) || average(Object.values(dimensionScores)) || ruleReport.totalScore), 0, 100);
  const problems = uniqueText([
    ...(result.mainProblems ?? []),
    ...(result.problems ?? []),
    ...(result.badShots ?? []).map((shot) => [shot.shotNo, shot.problem, shot.fix].filter(Boolean).join("："))
  ]).slice(0, 8);
  const suggestions = uniqueText([...(result.suggestedFixes ?? []), ...(result.suggestions ?? [])]).slice(0, 8);
  return {
    projectId: workflow.id,
    stage: ruleReport.stage,
    evaluatorType: "ai",
    totalScore,
    pass: typeof result.pass === "boolean" ? result.pass : totalScore >= passLine(ruleReport.stage),
    dimensionScores,
    problems: problems.length ? problems : ruleReport.problems,
    suggestions: suggestions.length ? suggestions : ruleReport.suggestions,
    recommendedAction: sanitizeRecommendedAction(result.recommendedAction, ruleReport.stage),
    promptVersion: promptVersion?.stage === ruleReport.stage ? `${promptVersion.name} ${promptVersion.version}` : `${ruleReport.stage}-llm-judge-v1`,
    provider: textProviderName({ textProvider: evaluator.provider }),
    model: evaluator.model || textModelName({ textProvider: evaluator.provider, textModel: evaluator.model }),
    taskId: ruleReport.taskId,
    assetId: ruleReport.assetId
  };
}

function buildEnsembleReport(ruleReport: DraftReport, llmReports: DraftReport[], failures: string[]): DraftReport {
  const llmAverage = average(llmReports.map((report) => report.totalScore));
  const totalScore = clamp(Math.round(ruleReport.totalScore * 0.35 + llmAverage * 0.65), 0, 100);
  const dimensions = mergeDimensionScores(ruleReport, llmReports, totalScore);
  return {
    projectId: ruleReport.projectId,
    stage: ruleReport.stage,
    evaluatorType: "ai",
    totalScore,
    pass: totalScore >= passLine(ruleReport.stage),
    dimensionScores: dimensions,
    problems: uniqueText(llmReports.flatMap((report) => report.problems).concat(ruleReport.problems)).slice(0, 8),
    suggestions: uniqueText([
      ...llmReports.flatMap((report) => report.suggestions),
      ...ruleReport.suggestions,
      ...failures.map((failure) => `部分 LLM 评测失败，已保留成功评测与规则分：${failure}`)
    ]).slice(0, 8),
    recommendedAction: totalScore >= passLine(ruleReport.stage) ? ruleReport.recommendedAction : lowScoreAction(ruleReport.stage),
    promptVersion: `${ruleReport.stage}-hybrid-ensemble-v1`,
    provider: "Quality Ensemble",
    model: ["rules", ...llmReports.map((report) => report.model).filter(Boolean)].join(" + "),
    taskId: ruleReport.taskId,
    assetId: ruleReport.assetId
  };
}

async function buildLlmEvaluationPrompt(
  workflow: any,
  stage: Stage,
  options: {
    includeFeedback: boolean;
    maxShotsPerPrompt: number;
    promptVersion?: { name: string; stage: string; version: string; content: string };
  }
) {
  const selectedPrompt = options.promptVersion?.stage === stage ? options.promptVersion : undefined;
  const template = selectedPrompt ? undefined : await activeEvaluationPromptTemplate(stage);
  const rubric = selectedPrompt?.content || template?.content || stageRubric(stage);
  const feedback = options.includeFeedback
    ? workflow.feedbacks?.map((item: any) => `${item.stage} ${item.rating}/5 ${item.usability} ${item.tags.join(",")} ${item.content}`).slice(0, 8).join("\n") || "暂无用户反馈"
    : "本次不纳入用户反馈";
  return [
    `评分模板版本：${selectedPrompt ? `${selectedPrompt.name} ${selectedPrompt.version}` : template ? `${template.name} ${template.version}` : `${stage}-llm-judge-v1`}`,
    rubric,
    "输出 JSON 字段：totalScore, pass, dimensionScores, mainProblems, suggestedFixes, recommendedAction。分数必须为 0-100 内整数，dimensionScores 使用 rubric 中指定维度。",
    "评测要保守：如果缺少真实图片 URL、角色参考图、关键镜头提示词或视频首帧，请明确扣分。",
    `项目：${workflow.name}`,
    `题材：${workflow.type}；画风：${workflow.artStyle}；画幅：${workflow.videoRatio}；集数：${workflow.episodes}`,
    `用户反馈：\n${feedback}`,
    stagePayload(workflow, stage, options.maxShotsPerPrompt)
  ].join("\n\n");
}

async function activeEvaluationPromptTemplate(stage: Stage) {
  return prisma.promptTemplate.findFirst({
    where: {
      enabled: true,
      type: stage,
      OR: [
        { name: { contains: "评测" } },
        { name: { contains: "评分" } },
        { summary: { contains: "LLM 评测" } },
        { content: { contains: "recommendedAction" } }
      ]
    },
    orderBy: [{ updatedAt: "desc" }]
  });
}

function stageRubric(stage: Stage) {
  const rubrics: Record<Stage, string> = {
    script: "评测剧本是否适合进入角色定稿和分镜生产。维度：structure 0-20, hook 0-20, episode 0-15, character 0-15, visual 0-15, production 0-15。recommendedAction 可选 continue/rewrite_script/clarify_characters/reduce_complexity。",
    character: "评测角色定稿是否适合进入分镜批量出图。维度：identity 0-15, appearance 0-20, multiview 0-25, storyMatch 0-15, referenceFollow 0-15, negativePrompt 0-10。recommendedAction 可选 lock_character/regenerate_multiview/edit_prompt/upload_reference。",
    storyboard: "评测分镜表是否适合进入分镜图生成。维度：order 0-10, imageability 0-20, continuity 0-20, simplicity 0-15, rhythm 0-15, prompt 0-20。recommendedAction 可选 generate_images/edit_bad_shots/regenerate_storyboard。",
    image: "评测分镜图是否可作为视频首帧继续生产。维度：promptMatch 0-20, characterConsistency 0-25, composition 0-15, artifact 0-20, videoReady 0-20。recommendedAction 可选 accept/regenerate_same_prompt/edit_prompt/regenerate_character。",
    video: "评测视频草稿是否可剪辑发布或继续合成。维度：firstFrame 0-20, identity 0-20, motion 0-20, intent 0-20, editable 0-20。recommendedAction 可选 accept/regenerate_video_clip/edit_prompt/regenerate_first_frame。"
  };
  return rubrics[stage];
}

function stagePayload(workflow: any, stage: Stage, maxShots: number) {
  if (stage === "script") {
    const script = workflow.scripts?.[0];
    return `剧本梗概：${script?.synopsis ?? "无"}\n剧本文本：${truncateText(script?.content ?? "无", 6000)}`;
  }
  if (stage === "character") {
    return [
      "角色卡：",
      JSON.stringify(workflow.characterSet?.map((item: any) => ({
        name: item.name,
        identity: item.identity,
        appearance: item.appearance,
        costume: item.costume,
        negativePrompt: item.negativePrompt,
        referenceAssetId: item.referenceAssetId
      })) ?? [], null, 2),
      "角色资产：",
      JSON.stringify(workflow.assets?.filter((asset: any) => asset.type === "role" || asset.type === "role_derivative").map(assetSummary), null, 2)
    ].join("\n");
  }
  if (stage === "storyboard") {
    return `分镜样本（最多 ${maxShots} 条）：\n${JSON.stringify(workflow.shots?.slice(0, maxShots).map(shotSummary) ?? [], null, 2)}`;
  }
  if (stage === "image") {
    const imageAssets = workflow.assets?.filter((asset: any) => asset.type === "image").map(assetSummary) ?? [];
    return `分镜样本：\n${JSON.stringify(workflow.shots?.slice(0, maxShots).map(shotSummary) ?? [], null, 2)}\n图片资产：\n${JSON.stringify(imageAssets.slice(0, maxShots), null, 2)}`;
  }
  const videoAssets = workflow.assets?.filter((asset: any) => asset.type === "video").map(assetSummary) ?? [];
  return `分镜样本：\n${JSON.stringify(workflow.shots?.slice(0, maxShots).map(shotSummary) ?? [], null, 2)}\n视频资产：\n${JSON.stringify(videoAssets.slice(0, maxShots), null, 2)}`;
}

function shotSummary(shot: any) {
  return {
    shot: `${shot.episodeNo}-${shot.sceneNo}-${shot.shotNo}`,
    duration: shot.duration,
    shotSize: shot.shotSize,
    cameraMovement: shot.cameraMovement,
    characters: shot.characters,
    scene: shot.scene,
    pictureDesc: shot.pictureDesc,
    dialogue: shot.dialogue,
    imagePrompt: shot.imagePrompt,
    videoPrompt: shot.videoPrompt,
    referenceAssetIds: shot.referenceAssetIds,
    status: shot.status
  };
}

function assetSummary(asset: any) {
  return {
    id: asset.id,
    type: asset.type,
    name: asset.name,
    status: asset.status,
    hasUrl: Boolean(asset.referenceUrl),
    prompt: truncateText(asset.prompt, 800)
  };
}

function normalizeEvaluatorModels(models: QualityEvaluatorModel[] | undefined): QualityEvaluatorModel[] {
  const raw = models?.length ? models : [];
  return raw
    .filter((item) => item.provider && item.model)
    .map((item) => ({ provider: item.provider, model: item.model, name: item.name }))
    .slice(0, 6);
}

function normalizeDimensionScores(value: unknown, fallback: Record<string, number>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clamp(Math.round(Number(item) || 0), 0, 100)] as const);
  return Object.fromEntries(entries.length ? entries : Object.entries(fallback));
}

function mergeDimensionScores(ruleReport: DraftReport, llmReports: DraftReport[], totalScore: number) {
  const keys = new Set([...Object.keys(ruleReport.dimensionScores), ...llmReports.flatMap((report) => Object.keys(report.dimensionScores))]);
  const merged: Record<string, number> = {};
  keys.forEach((key) => {
    const llmValues = llmReports.map((report) => report.dimensionScores[key]).filter((value) => Number.isFinite(value));
    const ruleValue = ruleReport.dimensionScores[key] ?? 0;
    merged[key] = llmValues.length ? clamp(Math.round(ruleValue * 0.35 + average(llmValues) * 0.65), 0, 100) : ruleValue;
  });
  merged.ruleTotal = ruleReport.totalScore;
  merged.llmTotal = average(llmReports.map((report) => report.totalScore));
  merged.finalTotal = totalScore;
  return merged;
}

function passLine(stage: Stage) {
  const map: Record<Stage, number> = { script: 75, character: 80, storyboard: 75, image: 80, video: 70 };
  return map[stage];
}

function sanitizeRecommendedAction(action: unknown, stage: Stage) {
  return typeof action === "string" && action.trim() ? action.trim().slice(0, 80) : lowScoreAction(stage);
}

function emptyEvaluationRunResult(input: {
  projectCount: number;
  stages: Stage[];
  mode: "rules" | "hybrid" | "llm";
  skipped: QualityEvaluationRunResult["skipped"];
}): QualityEvaluationRunResult {
  return {
    projects: input.projectCount,
    stages: input.stages,
    mode: input.mode,
    reports: [],
    skipped: input.skipped,
    usage: { ruleReports: 0, llmReports: 0, llmCalls: 0, llmFailures: 0, estimatedPromptItems: 0 }
  };
}

function normalizeRunName(value: string | undefined) {
  const trimmed = value?.trim();
  if (trimmed) return trimmed.slice(0, 100);
  return `评测运行 ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
}

function evaluationDatasetSnapshot(dataset: {
  id: string;
  name: string;
  description: string;
  source: string;
  projectIds: string[];
  stages: string[];
  filters: unknown;
  sampleCount: number;
  owner: string | null;
  createdAt: Date;
}) {
  return {
    id: dataset.id,
    name: dataset.name,
    description: dataset.description,
    source: dataset.source,
    projectIds: dataset.projectIds,
    stages: dataset.stages,
    filters: dataset.filters,
    sampleCount: dataset.sampleCount,
    owner: dataset.owner ?? undefined,
    createdAt: dataset.createdAt.toISOString()
  };
}

function promptVersionSnapshot(prompt: {
  id: string;
  key: string;
  name: string;
  stage: string;
  purpose: string;
  version: string;
  content: string;
  status: string;
  owner: string | null;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: prompt.id,
    key: prompt.key,
    name: prompt.name,
    stage: prompt.stage,
    purpose: prompt.purpose,
    version: prompt.version,
    content: prompt.content,
    status: prompt.status,
    owner: prompt.owner ?? undefined,
    notes: prompt.notes,
    createdAt: prompt.createdAt.toISOString(),
    updatedAt: prompt.updatedAt.toISOString()
  };
}

function pagination(pageValue?: number, pageSizeValue?: number) {
  const page = clamp(Math.floor(pageValue ?? 1), 1, 100_000);
  const pageSize = clamp(Math.floor(pageSizeValue ?? 20), 1, 100);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function paged<T>(items: T[], page: number, pageSize: number, total: number): PagedResult<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

function compareEvaluationRuns(
  baseline: EvaluationRun,
  candidate: EvaluationRun,
  selectedStage: Stage,
  baselineReports: Array<QualityReport & { projectName?: string }>,
  candidateReports: Array<QualityReport & { projectName?: string }>
): ExperimentRun["metrics"] {
  const stages = unique([...baseline.summary.stageScores.map((row) => row.stage), ...candidate.summary.stageScores.map((row) => row.stage)]);
  const stageDeltas = stages.map((stage) => {
    const baselineScore = baseline.summary.stageScores.find((row) => row.stage === stage)?.averageScore ?? 0;
    const candidateScore = candidate.summary.stageScores.find((row) => row.stage === stage)?.averageScore ?? 0;
    return { stage, baseline: baselineScore, candidate: candidateScore, delta: candidateScore - baselineScore };
  });
  const baselineStage = baseline.summary.stageScores.find((row) => row.stage === selectedStage);
  const candidateStage = candidate.summary.stageScores.find((row) => row.stage === selectedStage);
  const baselineScore = baselineStage?.averageScore ?? average(baselineReports.map((report) => report.totalScore));
  const candidateScore = candidateStage?.averageScore ?? average(candidateReports.map((report) => report.totalScore));
  const baselinePassRate = baselineStage?.passRate ?? reportPassRate(baselineReports);
  const candidatePassRate = candidateStage?.passRate ?? reportPassRate(candidateReports);
  const projectIds = unique([...baselineReports.map((report) => report.projectId), ...candidateReports.map((report) => report.projectId)]);
  const sampleDeltas = projectIds.map((projectId) => {
    const baselineRows = baselineReports.filter((report) => report.projectId === projectId);
    const candidateRows = candidateReports.filter((report) => report.projectId === projectId);
    const baselineValue = baselineRows.length ? average(baselineRows.map((report) => report.totalScore)) : undefined;
    const candidateValue = candidateRows.length ? average(candidateRows.map((report) => report.totalScore)) : undefined;
    const delta = baselineValue === undefined || candidateValue === undefined ? undefined : candidateValue - baselineValue;
    const status: ExperimentRun["metrics"]["sampleDeltas"][number]["status"] = baselineValue === undefined
      ? "new"
      : candidateValue === undefined ? "missing" : delta! > 0 ? "improved" : delta! < 0 ? "regressed" : "same";
    const projectName = candidateRows[0]?.projectName ?? baselineRows[0]?.projectName;
    return { projectId, projectName, stage: selectedStage, baseline: baselineValue, candidate: candidateValue, delta, status };
  }).sort((a, b) => (a.delta ?? -999) - (b.delta ?? -999));
  return {
    baselineScore,
    candidateScore,
    scoreDelta: candidateScore - baselineScore,
    baselinePassRate,
    candidatePassRate,
    passRateDelta: candidatePassRate - baselinePassRate,
    baselineReports: baselineReports.length,
    candidateReports: candidateReports.length,
    stageDeltas,
    sampleDeltas
  };
}

function reportPassRate(reports: QualityReport[]) {
  return reports.length ? Math.round((reports.filter((report) => report.pass).length / reports.length) * 100) : 0;
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

function experimentResultSummary(metrics: ExperimentRun["metrics"], winner: string, baseline: string, candidate: string) {
  if (winner === "tie") return `${candidate} 与 ${baseline} 综合表现持平；平均分差 ${metrics.scoreDelta}，通过率差 ${metrics.passRateDelta}%。`;
  const winnerLabel = winner === "candidate" ? candidate : baseline;
  return `${winnerLabel} 表现更好；候选相对基线平均分 ${metrics.scoreDelta >= 0 ? "+" : ""}${metrics.scoreDelta}，通过率 ${metrics.passRateDelta >= 0 ? "+" : ""}${metrics.passRateDelta}%。`;
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

function emptyUsage() {
  return { ruleReports: 0, llmReports: 0, llmCalls: 0, llmFailures: 0, estimatedPromptItems: 0 };
}

function emptyRunSummary(projectCount: number) {
  return {
    reportCount: 0,
    passCount: 0,
    passRate: 0,
    averageScore: 0,
    projectCount,
    stageScores: []
  };
}

function buildRunSummary(reports: QualityReport[], projectCount: number) {
  const passCount = reports.filter((report) => report.pass).length;
  const stages = unique(reports.map((report) => report.stage)).filter((stage): stage is Stage => isStage(stage));
  return {
    reportCount: reports.length,
    passCount,
    passRate: reports.length ? Math.round((passCount / reports.length) * 100) : 0,
    averageScore: average(reports.map((report) => report.totalScore)),
    projectCount,
    stageScores: stages.map((stage) => {
      const stageReports = reports.filter((report) => report.stage === stage);
      const stagePass = stageReports.filter((report) => report.pass).length;
      return {
        stage,
        reports: stageReports.length,
        passRate: stageReports.length ? Math.round((stagePass / stageReports.length) * 100) : 0,
        averageScore: average(stageReports.map((report) => report.totalScore))
      };
    })
  };
}

function estimatePromptItems(workflow: any, stage: Stage, maxShots: number) {
  if (stage === "script") return 1;
  if (stage === "character") return Math.max(1, workflow.characterSet?.length ?? 0);
  return Math.min(maxShots, Math.max(1, workflow.shots?.length ?? 0));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function isStage(value: string): value is Stage {
  return ["script", "character", "storyboard", "image", "video"].includes(value);
}

function uniqueText(values: string[]) {
  return unique(values.map((value) => String(value).trim()).filter(Boolean));
}

function truncateText(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
