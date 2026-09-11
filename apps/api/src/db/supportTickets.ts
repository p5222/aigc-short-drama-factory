import crypto from "node:crypto";
import type { Prisma, PrismaClient, SupportTicket, SupportTicketMessage as MessageRow } from "@prisma/client";
import type { CreateSupportTicketInput, ReplySupportTicketInput, CloseSupportTicketInput, SupportTicketDetail, SupportTicketList, SupportTicketMutationResult, SupportTicketSummary, SupportTicketStatus } from "@aifilm/shared";
import { prisma } from "./client.js";

export class SupportTicketError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = "SupportTicketError";
  }
}

/** staff is supplied only by routes which have passed support:read/manage checks. */
export type SupportActor = { id: string; staff?: boolean };
type TicketRow = SupportTicket & { user: { name: string } };
const categoryValues = ["account", "billing", "generation", "export", "other"];
const statusValues = ["open", "answered", "closed"];

function cleanText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || value.includes("\0")) throw new SupportTicketError(400, `${label}须为1至${max}字的纯文本。`);
  return value.trim();
}

function requestKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) throw new SupportTicketError(400, "请提供有效的提交标识，刷新页面后重试。");
  return value;
}

function expectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 2_147_483_646) throw new SupportTicketError(400, "工单版本无效，请刷新后重试。");
  return value as number;
}

const fingerprint = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ticketWhere = (actor: SupportActor, id?: string) => ({ ...(id === undefined ? {} : { id }), ...(!actor.staff ? { userId: actor.id } : {}) });

function mapTicket(row: TicketRow): SupportTicketSummary {
  return { id: row.id, userId: row.userId, userName: row.user.name, subject: row.subject,
    category: row.category as SupportTicketSummary["category"], status: row.status as SupportTicketStatus,
    version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), closedAt: row.closedAt?.toISOString() };
}

function mapMessage(row: MessageRow) {
  return { id: row.id, ticketId: row.ticketId, authorId: row.authorId, authorName: row.authorName,
    authorRole: row.authorRole as "user" | "staff", body: row.body, createdAt: row.createdAt.toISOString() };
}

async function loadTicket(tx: Prisma.TransactionClient, actor: SupportActor, id: string, lock = false): Promise<TicketRow> {
  if (lock) {
    if (actor.staff) await tx.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${id} AND "userId" = ${actor.id} FOR UPDATE`;
  }
  const ticket = await tx.supportTicket.findFirst({ where: ticketWhere(actor, id), include: { user: { select: { name: true } } } });
  if (!ticket) throw new SupportTicketError(404, "工单不存在或无权查看。");
  return ticket;
}

async function detail(tx: Prisma.TransactionClient, ticket: TicketRow): Promise<SupportTicketDetail> {
  const messages = await tx.supportTicketMessage.findMany({ where: { ticketId: ticket.id }, orderBy: { sequence: "asc" } });
  return { ticket: mapTicket(ticket), messages: messages.map(mapMessage) };
}

async function lockRequest(tx: Prisma.TransactionClient, actorId: string, kind: string, requestId: string) {
  await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${`support:${actorId}:${kind}:${requestId}`}))`;
}

async function replayRequest(tx: Prisma.TransactionClient, actor: SupportActor, kind: string, requestId: string, requestHash: string, ticketId?: string) {
  const existing = await tx.supportTicketRequest.findUnique({ where: { actorId_kind_requestId: { actorId: actor.id, kind, requestId } } });
  if (!existing) return null;
  if (existing.requestHash !== requestHash || (ticketId && existing.ticketId !== ticketId)) throw new SupportTicketError(409, "该提交标识已用于不同内容，请保留当前输入并重新提交。");
  const ticket = await loadTicket(tx, actor, existing.ticketId, true);
  return { ...await detail(tx, ticket), replayed: true };
}

export async function listSupportTickets(actor: SupportActor, query: { page?: number; pageSize?: number; status?: SupportTicketStatus } = {}, db: PrismaClient = prisma): Promise<SupportTicketList> {
  const page = Math.max(1, Math.min(100_000, Math.floor(query.page || 1)));
  const pageSize = Math.max(1, Math.min(50, Math.floor(query.pageSize || 20)));
  if (query.status && !statusValues.includes(query.status)) throw new SupportTicketError(400, "工单状态无效。");
  const where = { ...ticketWhere(actor), ...(query.status ? { status: query.status } : {}) };
  return db.$transaction(async tx => {
    const [rows, total] = await Promise.all([
      tx.supportTicket.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { name: true } } } }),
      tx.supportTicket.count({ where })
    ]);
    return { items: rows.map(mapTicket), total, page, pageSize };
  }, { isolationLevel: "RepeatableRead" });
}

export async function getSupportTicket(actor: SupportActor, ticketId: string, db: PrismaClient = prisma): Promise<SupportTicketDetail> {
  return db.$transaction(async tx => detail(tx, await loadTicket(tx, actor, ticketId)), { isolationLevel: "RepeatableRead" });
}

export async function createSupportTicket(userId: string, input: CreateSupportTicketInput, db: PrismaClient = prisma): Promise<SupportTicketMutationResult> {
  const key = requestKey(input.requestId), subject = cleanText(input.subject, 120, "问题标题"), body = cleanText(input.body, 5000, "问题正文");
  if (!categoryValues.includes(input.category)) throw new SupportTicketError(400, "问题分类无效。");
  const hash = fingerprint({ subject, category: input.category, body });
  const actor = { id: userId };
  return db.$transaction(async tx => {
    await lockRequest(tx, userId, "create", key);
    const replay = await replayRequest(tx, actor, "create", key, hash);
    if (replay) return replay;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (!user) throw new SupportTicketError(404, "账号不存在，请重新登录。");
    const ticket = await tx.supportTicket.create({ data: { id: `support_${crypto.randomUUID()}`, userId, subject, category: input.category }, include: { user: { select: { name: true } } } });
    const message = await tx.supportTicketMessage.create({ data: { id: `support_msg_${crypto.randomUUID()}`, ticketId: ticket.id, sequence: 1, authorId: userId, authorName: user.name, authorRole: "user", body } });
    await tx.supportTicketRequest.create({ data: { id: `support_req_${crypto.randomUUID()}`, actorId: userId, kind: "create", requestId: key, requestHash: hash, ticketId: ticket.id, messageId: message.id } });
    return { ticket: mapTicket(ticket), messages: [mapMessage(message)], replayed: false };
  });
}

export async function replySupportTicket(actor: SupportActor, ticketId: string, input: ReplySupportTicketInput, db: PrismaClient = prisma): Promise<SupportTicketMutationResult> {
  const key = requestKey(input.requestId), body = cleanText(input.body, 5000, "回复正文"), version = expectedVersion(input.expectedVersion);
  const authorRole = actor.staff ? "staff" : "user";
  const hash = fingerprint({ ticketId, body, authorRole });
  return db.$transaction(async tx => {
    await lockRequest(tx, actor.id, "reply", key);
    const current = await loadTicket(tx, actor, ticketId, true);
    const replay = await replayRequest(tx, actor, "reply", key, hash, ticketId);
    if (replay) return replay;
    if (current.status === "closed") throw new SupportTicketError(409, "工单已关闭，不能继续回复；如有新问题请新建工单。");
    if (current.version !== version) throw new SupportTicketError(409, "工单已有新消息，请刷新并阅读最新内容后再提交。");
    const author = await tx.user.findUnique({ where: { id: actor.id }, select: { name: true } });
    if (!author) throw new SupportTicketError(404, "账号不存在，请重新登录。");
    const message = await tx.supportTicketMessage.create({ data: { id: `support_msg_${crypto.randomUUID()}`, ticketId, sequence: current.version + 1, authorId: actor.id, authorName: author.name, authorRole, body } });
    const updated = await tx.supportTicket.update({ where: { id: ticketId }, data: { status: actor.staff ? "answered" : "open", version: { increment: 1 } }, include: { user: { select: { name: true } } } });
    await tx.supportTicketRequest.create({ data: { id: `support_req_${crypto.randomUUID()}`, actorId: actor.id, kind: "reply", requestId: key, requestHash: hash, ticketId, messageId: message.id } });
    return { ...await detail(tx, updated), replayed: false };
  });
}

export async function closeSupportTicket(actor: SupportActor, ticketId: string, input: CloseSupportTicketInput, db: PrismaClient = prisma): Promise<SupportTicketMutationResult> {
  const version = expectedVersion(input.expectedVersion);
  return db.$transaction(async tx => {
    const current = await loadTicket(tx, actor, ticketId, true);
    if (current.version !== version) throw new SupportTicketError(409, "工单已有更新，请刷新并阅读最新内容后再关闭。");
    if (current.status === "closed") return { ...await detail(tx, current), replayed: true };
    const updated = await tx.supportTicket.update({ where: { id: ticketId }, data: { status: "closed", version: { increment: 1 }, closedAt: new Date() }, include: { user: { select: { name: true } } } });
    return { ...await detail(tx, updated), replayed: false };
  });
}
