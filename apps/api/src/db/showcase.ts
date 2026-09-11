import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isPublishableVideoUrl, type ShowcaseWork, type ShowcaseWorkInput, type ShowcaseWorkStatus } from "@aifilm/shared";
import { prisma } from "./client.js";
import { lockMediaProject, MediaSourceConflict } from "./mediaSource.js";

type PageQuery = {
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  status?: string;
};

type AdminShowcaseUpdate = Partial<{
  title: string;
  description: string;
  category: string;
  authorName: string;
  coverUrl: string;
  videoUrl: string;
  durationLabel: string;
  featured: boolean;
  sortOrder: number;
}>;

function normalizedPage(query: PageQuery) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const pageSize = Math.min(60, Math.max(1, Math.floor(Number(query.pageSize) || 20)));
  return { page, pageSize };
}

function mapShowcaseWork(row: {
  id: string;
  creatorId: string | null;
  projectId: string | null;
  sourceAssetId: string | null;
  title: string;
  description: string;
  category: string;
  authorName: string;
  coverUrl: string;
  videoUrl: string;
  durationLabel: string;
  status: string;
  featured: boolean;
  sortOrder: number;
  reviewNote: string;
  submittedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  creator?: { name: string } | null;
}): ShowcaseWork {
  return {
    id: row.id,
    creatorId: row.creatorId ?? undefined,
    projectId: row.projectId ?? undefined,
    sourceAssetId: row.sourceAssetId ?? undefined,
    title: row.title,
    description: row.description,
    category: row.category,
    creatorName: row.authorName || row.creator?.name || "漫角创作者",
    coverUrl: row.coverUrl,
    videoUrl: row.videoUrl,
    durationLabel: row.durationLabel,
    status: row.status as ShowcaseWorkStatus,
    featured: row.featured,
    sortOrder: row.sortOrder,
    reviewNote: row.reviewNote || undefined,
    submittedAt: row.submittedAt?.toISOString(),
    publishedAt: row.publishedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function listPublicShowcaseWorks(query: PageQuery) {
  const { page, pageSize } = normalizedPage(query);
  const keyword = query.keyword?.trim();
  const category = query.category?.trim();
  const where = {
    status: "approved",
    ...(category && category !== "全部" && category !== "官方精选" ? { category } : {}),
    ...(category === "官方精选" ? { featured: true } : {}),
    ...(keyword
      ? {
          OR: [
            { title: { contains: keyword, mode: "insensitive" as const } },
            { description: { contains: keyword, mode: "insensitive" as const } },
            { category: { contains: keyword, mode: "insensitive" as const } },
            { authorName: { contains: keyword, mode: "insensitive" as const } },
            { creator: { is: { name: { contains: keyword, mode: "insensitive" as const } } } }
          ]
        }
      : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.showcaseWork.findMany({
      where,
      include: { creator: { select: { name: true } } },
      orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.showcaseWork.count({ where })
  ]);
  return { items: items.map(mapShowcaseWork), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listCreatorShowcaseWorks(userId: string, projectId?: string, db: PrismaClient = prisma) {
  const rows = await db.showcaseWork.findMany({
    where: { creatorId: userId, ...(projectId?.trim() ? { projectId: projectId.trim() } : {}) },
    include: { creator: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  return rows.map(mapShowcaseWork);
}

async function resolveCreatorMedia(tx: Prisma.TransactionClient, userId: string, input: ShowcaseWorkInput) {
  const project = await tx.project.findFirst({ where: { id: input.projectId, userId }, select: { id: true, intro: true } });
  if (!project) throw new Error("项目不存在或不属于当前账号。");

  let sourceAssetId = input.sourceAssetId?.trim() || undefined;
  let videoUrl = input.videoUrl?.trim() || "";
  if (sourceAssetId) {
    const asset = await tx.asset.findFirst({
      where: { id: sourceAssetId, projectId: project.id, type: "video", status: "succeeded" },
      select: { referenceUrl: true }
    });
    if (!asset?.referenceUrl || !isPublishableVideoUrl(asset.referenceUrl) || videoUrl !== asset.referenceUrl) {
      throw new MediaSourceConflict("所选视频已更新或不可用，请刷新项目，重新选择并确认视频预览后提交。");
    }
    videoUrl = asset.referenceUrl;
  } else {
    const exportJob = videoUrl
      ? await tx.exportJob.findFirst({ where: { projectId: project.id, userId, type: "video_export", outputUrl: videoUrl, status: "succeeded" }, select: { id: true } })
      : null;
    if (!exportJob || !isPublishableVideoUrl(videoUrl)) throw new Error("请选择当前项目中已完成的 MP4、WebM 或 MOV 导出文件。");
  }

  let coverUrl = input.coverUrl?.trim() || "";
  if (!coverUrl) {
    const cover = await tx.asset.findFirst({
      where: { projectId: project.id, type: "image", status: "succeeded", referenceUrl: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { referenceUrl: true }
    });
    coverUrl = cover?.referenceUrl || "";
  }
  if (!coverUrl) throw new Error("作品需要一张封面图，请先生成分镜图或填写封面地址。");

  return { project, sourceAssetId, videoUrl, coverUrl };
}

export async function createCreatorShowcaseWork(userId: string, input: ShowcaseWorkInput, db: PrismaClient = prisma) {
  return db.$transaction(async tx => {
    await lockMediaProject(tx, input.projectId, userId);
    const media = await resolveCreatorMedia(tx, userId, input);
    const now = new Date();
    const row = await tx.showcaseWork.create({
      data: {
        id: `showcase_${crypto.randomUUID()}`,
        creatorId: userId,
        projectId: media.project.id,
        sourceAssetId: media.sourceAssetId,
        title: input.title.trim(),
        description: input.description?.trim() || media.project.intro || "",
        category: input.category?.trim() || "AI短剧",
        coverUrl: media.coverUrl,
        videoUrl: media.videoUrl,
        durationLabel: input.durationLabel?.trim() || "00:00",
        status: "pending",
        submittedAt: now
      },
      include: { creator: { select: { name: true } } }
    });
    return mapShowcaseWork(row);
  });
}

export async function resubmitCreatorShowcaseWork(userId: string, id: string, input?: ShowcaseWorkInput, db: PrismaClient = prisma) {
  const source = await db.showcaseWork.findFirst({ where: { id, creatorId: userId }, select: { projectId: true } });
  if (!source?.projectId) throw new MediaSourceConflict("作品或原项目不存在，请返回项目列表刷新。");
  if (input && input.projectId !== source.projectId) throw new MediaSourceConflict("不能将审核记录转移到其他项目。");
  return db.$transaction(async tx => {
    await lockMediaProject(tx, source.projectId!, userId);
    await tx.$queryRaw`SELECT "id" FROM "ShowcaseWork" WHERE "id" = ${id} AND "creatorId" = ${userId} FOR UPDATE`;
    const current = await tx.showcaseWork.findFirst({ where: { id, creatorId: userId } });
    if (!current || !["rejected", "draft"].includes(current.status)) throw new MediaSourceConflict("作品已在审核中或已发布，请刷新发布记录，不要重复提交。");
    const revised = input ?? { projectId: source.projectId!, sourceAssetId: current.sourceAssetId ?? undefined, videoUrl: current.videoUrl, title: current.title, description: current.description, category: current.category, coverUrl: current.coverUrl, durationLabel: current.durationLabel };
    const media = await resolveCreatorMedia(tx, userId, revised);
    const row = await tx.showcaseWork.update({
      where: { id },
      data: {
        title: revised.title.trim(), description: revised.description?.trim() ?? current.description,
        category: revised.category?.trim() || current.category, coverUrl: media.coverUrl, videoUrl: media.videoUrl,
        sourceAssetId: media.sourceAssetId ?? null, durationLabel: revised.durationLabel?.trim() || current.durationLabel,
        // Retain the original record and last review feedback while the revision is pending.
        status: "pending", submittedAt: new Date(), publishedAt: null
      },
      include: { creator: { select: { name: true } } }
    });
    return mapShowcaseWork(row);
  });
}

export async function listAdminShowcaseWorks(query: PageQuery) {
  const { page, pageSize } = normalizedPage(query);
  const keyword = query.keyword?.trim();
  const status = query.status?.trim();
  const where = {
    ...(status && status !== "all" ? { status } : {}),
    ...(keyword
      ? {
          OR: [
            { title: { contains: keyword, mode: "insensitive" as const } },
            { category: { contains: keyword, mode: "insensitive" as const } },
            { authorName: { contains: keyword, mode: "insensitive" as const } },
            { creator: { is: { name: { contains: keyword, mode: "insensitive" as const } } } }
          ]
        }
      : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.showcaseWork.findMany({
      where,
      include: { creator: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { submittedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.showcaseWork.count({ where })
  ]);
  return { items: items.map(mapShowcaseWork), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function updateReviewedVersion(id: string, expectedUpdatedAt: string, data: Prisma.ShowcaseWorkUpdateManyMutationInput, db: PrismaClient) {
  const expected = new Date(expectedUpdatedAt);
  if (!Number.isFinite(expected.getTime())) throw new MediaSourceConflict("作品版本信息无效，请刷新审核队列后重新审阅。");
  return db.$transaction(async tx => {
    const result = await tx.showcaseWork.updateMany({
      where: { id, updatedAt: expected },
      data: { ...data, updatedAt: new Date(Math.max(Date.now(), expected.getTime() + 1)) }
    });
    if (result.count !== 1) throw new MediaSourceConflict("作品已被创作者或其他管理员更新，当前草稿未覆盖新内容。请刷新审核队列，重新打开作品审阅后再操作。");
    return mapShowcaseWork(await tx.showcaseWork.findUniqueOrThrow({ where: { id }, include: { creator: { select: { name: true } } } }));
  });
}

export async function updateAdminShowcaseWork(id: string, input: AdminShowcaseUpdate & { expectedUpdatedAt: string }, db: PrismaClient = prisma) {
  const data: AdminShowcaseUpdate = {};
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.description !== undefined) data.description = input.description.trim();
  if (input.category !== undefined) data.category = input.category.trim();
  if (input.authorName !== undefined) data.authorName = input.authorName.trim();
  if (input.coverUrl !== undefined) data.coverUrl = input.coverUrl.trim();
  if (input.videoUrl !== undefined) data.videoUrl = input.videoUrl.trim();
  if (input.durationLabel !== undefined) data.durationLabel = input.durationLabel.trim();
  if (input.featured !== undefined) data.featured = input.featured;
  if (input.sortOrder !== undefined) data.sortOrder = Math.max(0, Math.floor(input.sortOrder));
  if (data.title === "" || data.coverUrl === "" || data.videoUrl === "") throw new Error("标题、封面和视频地址不能为空。");
  if (data.videoUrl && !isPublishableVideoUrl(data.videoUrl)) throw new Error("视频地址必须是可播放的 MP4、WebM 或 MOV 文件。");
  return updateReviewedVersion(id, input.expectedUpdatedAt, data, db);
}

export async function reviewAdminShowcaseWork(id: string, decision: "approve" | "reject", note: string, expectedUpdatedAt: string, db: PrismaClient = prisma) {
  const now = new Date();
  return updateReviewedVersion(id, expectedUpdatedAt, {
    status: decision === "approve" ? "approved" : "rejected",
    reviewNote: note.trim(),
    publishedAt: decision === "approve" ? now : null
  }, db);
}
