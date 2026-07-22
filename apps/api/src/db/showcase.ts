import crypto from "node:crypto";
import { isPlayableVideoUrl, type ShowcaseWork, type ShowcaseWorkInput, type ShowcaseWorkStatus } from "@aifilm/shared";
import { prisma } from "./client.js";

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
    creatorName: row.creator?.name || row.authorName || "漫角创作者",
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

export async function listCreatorShowcaseWorks(userId: string) {
  const rows = await prisma.showcaseWork.findMany({
    where: { creatorId: userId },
    include: { creator: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  return rows.map(mapShowcaseWork);
}

async function resolveCreatorMedia(userId: string, input: ShowcaseWorkInput) {
  const project = await prisma.project.findFirst({ where: { id: input.projectId, userId }, select: { id: true, intro: true } });
  if (!project) throw new Error("项目不存在或不属于当前账号。");

  let sourceAssetId = input.sourceAssetId?.trim() || undefined;
  let videoUrl = input.videoUrl?.trim() || "";
  if (sourceAssetId) {
    const asset = await prisma.asset.findFirst({
      where: { id: sourceAssetId, projectId: project.id, type: "video", status: "succeeded" },
      select: { referenceUrl: true }
    });
    if (!asset?.referenceUrl || !isPlayableVideoUrl(asset.referenceUrl)) throw new Error("请选择当前项目中可播放的 MP4、WebM 或 MOV 视频资产。");
    videoUrl = asset.referenceUrl;
  } else {
    const exportJob = videoUrl
      ? await prisma.exportJob.findFirst({ where: { projectId: project.id, userId, outputUrl: videoUrl, status: "succeeded" }, select: { id: true } })
      : null;
    if (!exportJob || !isPlayableVideoUrl(videoUrl)) throw new Error("请选择当前项目中已完成的 MP4、WebM 或 MOV 导出文件。");
  }

  let coverUrl = input.coverUrl?.trim() || "";
  if (!coverUrl) {
    const cover = await prisma.asset.findFirst({
      where: { projectId: project.id, type: "image", status: "succeeded", referenceUrl: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { referenceUrl: true }
    });
    coverUrl = cover?.referenceUrl || "";
  }
  if (!coverUrl) throw new Error("作品需要一张封面图，请先生成分镜图或填写封面地址。");

  return { project, sourceAssetId, videoUrl, coverUrl };
}

export async function createCreatorShowcaseWork(userId: string, input: ShowcaseWorkInput) {
  const media = await resolveCreatorMedia(userId, input);
  const now = new Date();
  const row = await prisma.showcaseWork.create({
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
}

export async function resubmitCreatorShowcaseWork(userId: string, id: string) {
  const current = await prisma.showcaseWork.findFirst({ where: { id, creatorId: userId } });
  if (!current) throw new Error("作品不存在。");
  if (current.status === "approved") throw new Error("已发布作品无需重复提交。");
  const row = await prisma.showcaseWork.update({
    where: { id },
    data: { status: "pending", reviewNote: "", submittedAt: new Date(), publishedAt: null },
    include: { creator: { select: { name: true } } }
  });
  return mapShowcaseWork(row);
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

export async function updateAdminShowcaseWork(id: string, input: AdminShowcaseUpdate) {
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
  if (data.videoUrl && !isPlayableVideoUrl(data.videoUrl)) throw new Error("视频地址必须是可播放的 MP4、WebM 或 MOV 文件。");
  const row = await prisma.showcaseWork.update({
    where: { id },
    data,
    include: { creator: { select: { name: true } } }
  });
  return mapShowcaseWork(row);
}

export async function reviewAdminShowcaseWork(id: string, decision: "approve" | "reject", note = "") {
  const now = new Date();
  const row = await prisma.showcaseWork.update({
    where: { id },
    data: {
      status: decision === "approve" ? "approved" : "rejected",
      reviewNote: note.trim(),
      publishedAt: decision === "approve" ? now : null
    },
    include: { creator: { select: { name: true } } }
  });
  return mapShowcaseWork(row);
}
