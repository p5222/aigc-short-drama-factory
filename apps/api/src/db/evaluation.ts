import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  AnalyticsEventInput,
  EvaluationDataset,
  EvaluationDatasetInput,
  EvaluationRun,
  EvaluationRunDetail,
  EvaluationOverview,
  FeedbackInput,
  QualityEvaluationRunInput,
  QualityEvaluationRunResult,
  QualityEvaluatorModel,
  QualityProjectRow,
  QualityReport,
  UserFeedback
} from "@aifilm/shared";
import { callTextModelJson, hasTextModelConfig, textModelName, textProviderName } from "../agents/generator.js";
import { prisma } from "./client.js";
import { mapEvaluationDataset, mapEvaluationRun, mapProject, mapQualityReport, mapUserFeedback } from "./mappers.js";

type Stage = "script" | "character" | "storyboard" | "image" | "video";

const stageLabels: Record<Stage, string> = {
  script: "剧本确认",
  character: "角色定稿",
  storyboard: "分镜拆解",
  image: "分镜图",
  video: "视频草稿"
};

export async function recordAnalyticsEvent(userId: string | undefined, input: AnalyticsEventInput) {
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
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, userId }, select: { id: true } });
    if (!project) throw new Error("反馈关联的项目不存在或不属于当前用户。");
  }
  if (input.taskId) {
    const task = await prisma.generationTask.findFirst({ where: { id: input.taskId, userId }, select: { id: true } });
    if (!task) throw new Error("反馈关联的任务不存在或不属于当前用户。");
  }
  if (input.assetId && input.projectId) {
    const asset = await prisma.asset.findFirst({ where: { id: input.assetId, projectId: input.projectId }, select: { id: true } });
    if (!asset) throw new Error("反馈关联的资产不存在。");
  }

  const feedback = await prisma.$transaction(async (tx) => {
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
      const account = await tx.creditAccount.upsert({
        where: { userId },
        update: {},
        create: {
          id: `credit_${userId}`,
          userId,
          balance: 0,
          frozenBalance: 0,
          totalRecharge: 0,
          totalConsume: 0
        }
      });
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
  });

  return mapUserFeedback(feedback);
}

export async function generateProjectQualityReports(projectId: string, userId?: string): Promise<QualityReport[]> {
  const result = await runQualityEvaluation({
    projectIds: [projectId],
    stages: ["script", "character", "storyboard", "image", "video"],
    mode: "rules",
    maxLlmCalls: 0
  }, userId);
  return result.reports;
}

export async function runQualityEvaluation(input: QualityEvaluationRunInput, userId?: string): Promise<QualityEvaluationRunResult> {
  const dataset = input.datasetId ? await prisma.evaluationDataset.findUnique({ where: { id: input.datasetId } }) : null;
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
      maxLlmCalls,
      maxShotsPerPrompt,
      includeFeedback,
      status: "running",
      usage: emptyUsage(),
      skipped: [],
      summary: emptyRunSummary(selectedProjectIds.length),
      primaryProjectId: selectedProjectIds[0]
    },
    include: { dataset: true }
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
    include: { dataset: true },
    orderBy: { startedAt: "desc" },
    take: 100
  });
  return rows.map(mapEvaluationRun);
}

export async function getEvaluationRun(id: string): Promise<EvaluationRunDetail | null> {
  const run = await prisma.evaluationRun.findUnique({
    where: { id },
    include: {
      dataset: true,
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
    include: { dataset: true }
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
      maxShotsPerPrompt: options.maxShotsPerPrompt
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
  const roleAssets = workflow.assets.filter((asset: any) => asset.type === "role" || asset.type === "role_derivative");
  const primaryRefs = roleAssets.filter((asset: any) => asset.type === "role" && asset.referenceUrl && asset.status === "succeeded").length;
  const derivatives = roleAssets.filter((asset: any) => asset.type === "role_derivative" && asset.referenceUrl).length;
  const characterCount = Math.max(1, workflow.characterSet.length);
  const identity = clamp(Math.round((workflow.characterSet.filter((item: any) => item.identity).length / characterCount) * 15), 0, 15);
  const appearance = clamp(Math.round((workflow.characterSet.filter((item: any) => item.appearance && item.costume).length / characterCount) * 20), 0, 20);
  const multiview = clamp(Math.round(((primaryRefs + derivatives * 0.5) / characterCount) * 18), 0, 25);
  const storyMatch = workflow.characterSet.length ? 13 : 6;
  const referenceFollow = clamp(Math.round((primaryRefs / characterCount) * 15), 0, 15);
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
      reports.push(normalizeLlmReport(result, workflow, ruleReport, evaluator));
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
  evaluator: QualityEvaluatorModel
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
    promptVersion: `${ruleReport.stage}-llm-judge-v1`,
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
  options: { includeFeedback: boolean; maxShotsPerPrompt: number }
) {
  const template = await activeEvaluationPromptTemplate(stage);
  const rubric = template?.content || stageRubric(stage);
  const feedback = options.includeFeedback
    ? workflow.feedbacks?.map((item: any) => `${item.stage} ${item.rating}/5 ${item.usability} ${item.tags.join(",")} ${item.content}`).slice(0, 8).join("\n") || "暂无用户反馈"
    : "本次不纳入用户反馈";
  return [
    `评分模板版本：${template ? `${template.name} ${template.version}` : `${stage}-llm-judge-v1`}`,
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
