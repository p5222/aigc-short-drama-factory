import type { UserFeedback } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { mapEvaluationDataset, mapUserFeedback } from "../db/mappers.js";
import { createFrozenDataset, withEvaluationSnapshot } from "./runner.js";

export type FeedbackUpdate = Partial<Pick<UserFeedback, "status" | "priority">> & Partial<Record<"rootCause" | "assignee" | "resolution" | "convertedDatasetId" | "resolutionAttemptId" | "resolutionReviewId", string | null>> & { expectedVersion?: number };

export async function convertFeedback(id: string) {
  return withEvaluationSnapshot(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "UserFeedback" WHERE "id" = ${id} FOR UPDATE`;
    const feedback = await tx.userFeedback.findUniqueOrThrow({ where: { id } });
    if (feedback.convertedDatasetId) {
      const dataset = await tx.evaluationDataset.findUniqueOrThrow({ where: { id: feedback.convertedDatasetId } });
      return { feedback: mapUserFeedback(feedback), dataset: mapEvaluationDataset(dataset) };
    }
    if (!feedback.projectId) throw new Error("反馈未关联项目，不能捕获质量样本。");
    const dataset = await createFrozenDataset({ name: `反馈回归 · ${feedback.stage}`, description: "由反馈原子沉淀；保存样本不代表问题已解决。", source: "feedback", projectIds: [feedback.projectId],
      stages: [feedback.stage as UserFeedback["stage"]], filters: { feedbackId: id } }, tx);
    const updated = await tx.userFeedback.update({ where: { id }, data: { convertedDatasetId: dataset.id, status: ["resolved", "ignored"].includes(feedback.status) ? feedback.status : "processing", version: { increment: 1 } } });
    return { feedback: mapUserFeedback(updated), dataset: mapEvaluationDataset(dataset) };
  });
}

export async function updateFeedback(id: string, input: FeedbackUpdate) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "UserFeedback" WHERE "id" = ${id} FOR UPDATE`;
    const prior = await tx.userFeedback.findUniqueOrThrow({ where: { id } });
    if (input.expectedVersion === undefined || input.expectedVersion !== prior.version) throw new Error("反馈已更新或缺少版本，请刷新后提交。");
    if (input.convertedDatasetId !== undefined || input.status === "converted") throw new Error("请通过“沉淀固定样本”操作关联反馈。");
    const status = input.status ?? prior.status;
    const resolution = input.resolution === undefined ? prior.resolution : input.resolution?.trim();
    if (["resolved", "ignored"].includes(status) && !resolution) throw new Error("解决或关闭反馈需要填写处理理由。");
    let resolutionAttemptId = input.resolutionAttemptId === undefined ? prior.resolutionAttemptId : input.resolutionAttemptId;
    let resolutionReviewId = input.resolutionReviewId === undefined ? prior.resolutionReviewId : input.resolutionReviewId;
    if (status === "resolved") {
      if (!resolutionAttemptId || !resolutionReviewId) throw new Error("完成修复需关联复测尝试和可用的人工复核。");
      await tx.$queryRaw`SELECT "id" FROM "EvaluationAttempt" WHERE "id" = ${resolutionAttemptId} FOR SHARE`;
      const attempt = await tx.evaluationAttempt.findUnique({ where: { id: resolutionAttemptId }, include: { sample: true, reviews: { orderBy: { version: "desc" }, take: 1 } } });
      const review = attempt?.reviews[0];
      const scope = ["image", "video", "character"].includes(prior.stage) ? "media" : "text";
      const contract = attempt?.contract as { includeFeedback?: boolean; coverage?: { items?: number; totalItems?: number } } | undefined;
      if (!attempt || attempt.status !== "succeeded" || attempt.sample.projectId !== prior.projectId || attempt.sample.stage !== prior.stage ||
          attempt.sample.createdAt < prior.createdAt || attempt.createdAt < prior.createdAt || !review || review.id !== resolutionReviewId ||
          review.verdict !== "usable" || review.scope !== scope || review.fingerprint !== attempt.sample.fingerprint ||
          (scope === "text" && (contract?.includeFeedback || contract?.coverage?.items !== contract?.coverage?.totalItems))) throw new Error("证据不匹配：需使用反馈之后捕获的同项目、同阶段完整样本，以及对应范围的最新可用复核。");
    } else { resolutionAttemptId = null; resolutionReviewId = null; }
    const nullable = (value: string | null | undefined, max: number) => value?.trim().slice(0, max) || null;
    return mapUserFeedback(await tx.userFeedback.update({ where: { id }, data: {
      status, version: { increment: 1 }, priority: input.priority,
      ...(input.rootCause !== undefined ? { rootCause: nullable(input.rootCause, 80) } : {}),
      ...(input.assignee !== undefined ? { assignee: nullable(input.assignee, 80) } : {}),
      ...(input.resolution !== undefined ? { resolution: nullable(input.resolution, 800) } : {}),
      resolutionAttemptId, resolutionReviewId, processedAt: ["resolved", "ignored"].includes(status) ? new Date() : null
    } }));
  });
}
