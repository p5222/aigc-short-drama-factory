import { Prisma, type PrismaClient, type RedeemCode as CodeRow } from "@prisma/client";
import { normalizeRedeemCode, type RedeemBatchPage, type RedeemCodePage, type RedeemReceipt, type RedeemSummary } from "@aifilm/shared";
import { z } from "zod";
import { prisma } from "./client.js";
import { mapRedeemCode } from "./mappers.js";

export class RedeemOperationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const pageFields = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).default("")
};
const queryBoolean = z.enum(["true", "false"]).transform(value => value === "true").optional();
export const redeemCodePageSchema = z.object({
  ...pageFields,
  status: z.enum(["all", "active", "disabled", "used_up", "expired", "scheduled"]).default("all"),
  codeId: z.string().trim().min(1).max(128).optional(),
  batchId: z.string().trim().min(1).max(128).optional(),
  legacy: queryBoolean,
  distributable: queryBoolean
});
export const redeemBatchPageSchema = z.object({
  ...pageFields, status: z.enum(["all", "enabled", "disabled"]).default("all")
});
export const redeemHistoryQuerySchema = z.object({
  ...pageFields,
  codeId: z.string().trim().max(128).optional(),
  batchId: z.string().trim().max(128).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional()
}).refine(value => !value.from || !value.to || new Date(value.from) < new Date(value.to), "结束时间必须晚于开始时间");
export const redeemBulkStatusSchema = z.object({
  enabled: z.boolean(),
  codes: z.array(z.object({ id: z.string().min(1).max(128), updatedAt: z.iso.datetime() })).min(1).max(1000)
}).refine(value => new Set(value.codes.map(code => code.id)).size === value.codes.length, "请勿重复选择兑换码");
export const redeemBatchStatusSchema = z.object({ enabled: z.boolean(), expectedUpdatedAt: z.iso.datetime() });
type CodeQuery = z.infer<typeof redeemCodePageSchema>;
type BatchQuery = z.infer<typeof redeemBatchPageSchema>;
type DbCode = CodeRow & { batchEnabled: boolean | null; status: string };

function like(value: string) { return `%${value.replace(/[\\%_]/g, "\\$&")}%`; }

// One snapshot and one clock for status, page, total and liability. No code list is
// loaded into application memory to compute aggregates.
function codeScope(query: CodeQuery, now: Date, batchIds?: string[]) {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (query.codeId) conditions.push(Prisma.sql`c.id = ${query.codeId}`);
  if (batchIds) conditions.push(Prisma.sql`c."batchId" IN (${Prisma.join(batchIds)})`);
  if (query.batchId) conditions.push(Prisma.sql`c."batchId" = ${query.batchId}`);
  if (query.legacy) conditions.push(Prisma.sql`c."batchId" IS NULL`);
  if (query.search) {
    const text = like(query.search);
    conditions.push(Prisma.sql`(c."name" ILIKE ${text} OR c."code" ILIKE ${text} OR b."name" ILIKE ${text})`);
  }
  return Prisma.sql`WITH classified AS (
    SELECT c.*, b."enabled" AS "batchEnabled", CASE
      WHEN NOT c."enabled" OR b."enabled" = false THEN 'disabled'
      WHEN c."endsAt" <= ${now} THEN 'expired'
      WHEN c."startsAt" > ${now} THEN 'scheduled'
      WHEN c."usedCount" >= c."maxRedemptions" THEN 'used_up'
      ELSE 'active' END AS status
    FROM "RedeemCode" c LEFT JOIN "RedeemBatch" b ON c."batchId" = b.id
    WHERE ${Prisma.join(conditions, " AND ")}
  ), scoped AS (SELECT * FROM classified WHERE
    ${query.status === "all" ? Prisma.sql`TRUE` : Prisma.sql`status = ${query.status}`}
    ${query.distributable ? Prisma.sql`AND status = 'active' AND "usedCount" = 0` : Prisma.empty}
  )`;
}

const totalsSql = Prisma.sql`COUNT(*)::int AS codes,
  COUNT(*) FILTER (WHERE status = 'active')::int AS active,
  COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
  COUNT(*) FILTER (WHERE status = 'disabled')::int AS disabled,
  COUNT(*) FILTER (WHERE status = 'expired')::int AS expired,
  COUNT(*) FILTER (WHERE status = 'used_up')::int AS used_up,
  COALESCE(SUM(GREATEST(0, "maxRedemptions"::bigint - "usedCount") * credits) FILTER (WHERE status IN ('active', 'scheduled')), 0)::float8 AS "remainingCredits"`;

async function codeSummary(tx: Prisma.TransactionClient, scope: Prisma.Sql): Promise<RedeemSummary> {
  const [row] = await tx.$queryRaw<RedeemSummary[]>(Prisma.sql`${scope}
    SELECT ${totalsSql},
      (SELECT COALESCE(SUM(r.credits), 0)::float8 FROM "RedeemRedemption" r JOIN scoped s ON s.id = r."redeemCodeId") AS "redeemedCredits",
      (SELECT COUNT(*)::int FROM "RedeemRedemption" r JOIN scoped s ON s.id = r."redeemCodeId") AS redemptions
    FROM scoped`);
  return row!;
}

function mapCode(row: DbCode) {
  return { ...mapRedeemCode({ ...row, batch: row.batchEnabled === null ? null : { enabled: row.batchEnabled } }), status: row.status as NonNullable<RedeemCodePage["items"][number]["status"]> };
}

export async function listRedeemCodePage(query: CodeQuery, db: PrismaClient = prisma): Promise<RedeemCodePage> {
  return db.$transaction(async tx => {
    const scope = codeScope(query, new Date());
    const summary = await codeSummary(tx, scope);
    const page = Math.min(query.page, Math.max(1, Math.ceil(summary.codes / query.pageSize)));
    const rows = await tx.$queryRaw<DbCode[]>(Prisma.sql`${scope} SELECT * FROM scoped ORDER BY "createdAt" DESC, id DESC LIMIT ${query.pageSize} OFFSET ${(page - 1) * query.pageSize}`);
    return { items: rows.map(mapCode), total: summary.codes, page, pageSize: query.pageSize, summary };
  }, { isolationLevel: "RepeatableRead" });
}

export async function exportRedeemCodes(query: CodeQuery, db: PrismaClient = prisma) {
  return db.$transaction(async tx => {
    const now = new Date();
    const scope = codeScope(query, now);
    const rows = await tx.$queryRaw<DbCode[]>(Prisma.sql`${scope} SELECT * FROM scoped ORDER BY "createdAt" DESC, id DESC LIMIT 1001`);
    if (rows.length > 1000) throw new RedeemOperationError(400, "单次最多导出 1000 个码，请缩小筛选范围或进入单个批次");
    return { items: rows.map(mapCode), total: rows.length, exportedAt: now.toISOString() };
  }, { isolationLevel: "RepeatableRead" });
}

export async function listRedeemBatchPage(query: BatchQuery, db: PrismaClient = prisma): Promise<RedeemBatchPage> {
  return db.$transaction(async tx => {
    const where: Prisma.RedeemBatchWhereInput = {
      ...(query.status !== "all" ? { enabled: query.status === "enabled" } : {}),
      ...(query.search ? { OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { prefix: { contains: query.search, mode: "insensitive" } },
        { id: { contains: query.search, mode: "insensitive" } }
      ] } : {})
    };
    const total = await tx.redeemBatch.count({ where });
    const legacyCodes = await tx.redeemCode.count({ where: { batchId: null } });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.redeemBatch.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.pageSize, skip: (page - 1) * query.pageSize });
    const now = new Date();
    const summaries = rows.length ? await tx.$queryRaw<(RedeemSummary & { batchId: string })[]>(Prisma.sql`
      ${codeScope({ page: 1, pageSize: 20, search: "", status: "all" }, now, rows.map(row => row.id))},
      code_totals AS (SELECT "batchId", ${totalsSql} FROM scoped GROUP BY "batchId"),
      receipts AS (SELECT s."batchId", SUM(r.credits)::float8 AS "redeemedCredits", COUNT(*)::int AS redemptions
        FROM "RedeemRedemption" r JOIN scoped s ON s.id = r."redeemCodeId" GROUP BY s."batchId")
      SELECT c.*, COALESCE(r."redeemedCredits", 0) AS "redeemedCredits", COALESCE(r.redemptions, 0)::int AS redemptions
        FROM code_totals c LEFT JOIN receipts r ON r."batchId" = c."batchId"`) : [];
    const byBatch = new Map(summaries.map(({ batchId, ...summary }) => [batchId, summary]));
    const empty: RedeemSummary = { codes: 0, active: 0, disabled: 0, expired: 0, scheduled: 0, used_up: 0, remainingCredits: 0, redeemedCredits: 0, redemptions: 0 };
    const items = rows.map(row => ({
      id: row.id, name: row.name, prefix: row.prefix, enabled: row.enabled,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      summary: byBatch.get(row.id) ?? empty
    }));
    return { items, total, page, pageSize: query.pageSize, legacyCodes };
  }, { isolationLevel: "RepeatableRead", timeout: 15000 });
}

export async function setRedeemCodeStatuses(input: z.infer<typeof redeemBulkStatusSchema>, db: PrismaClient = prisma) {
  // Validate in the service as well as the route: no implicit whole-table scope.
  const parsed = redeemBulkStatusSchema.safeParse(input);
  if (!parsed.success) throw new RedeemOperationError(400, "请选择 1–1000 个不同的兑换码，并携带原版本");
  const ids = input.codes.map(code => code.id).sort();
  const versions = new Map(input.codes.map(code => [code.id, code.updatedAt]));
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "RedeemCode" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    const rows = await tx.redeemCode.findMany({ where: { id: { in: ids } } });
    if (rows.length !== ids.length) throw new RedeemOperationError(409, "选择的兑换码已发生变化，请刷新后核对；本次未修改任何码");
    const changed = rows.filter(row => row.enabled !== input.enabled);
    if (changed.some(row => row.updatedAt.toISOString() !== versions.get(row.id))) throw new RedeemOperationError(409, "部分兑换码已更新，请刷新后重新选择；本次未修改任何码");
    await tx.redeemCode.updateMany({ where: { id: { in: changed.map(row => row.id) } }, data: { enabled: input.enabled } });
    return { requested: ids.length, changed: changed.length, unchanged: ids.length - changed.length };
  }, { timeout: 15000 });
}

export async function setRedeemBatchStatus(id: string, input: z.infer<typeof redeemBatchStatusSchema>, db: PrismaClient = prisma) {
  if (!redeemBatchStatusSchema.safeParse(input).success) throw new RedeemOperationError(400, "缺少有效的批次版本");
  return db.$transaction(async tx => {
    // Redemption locks a code before reading its batch. Lock the same rows in
    // stable order before changing the batch gate, preserving individual flags.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "RedeemCode" WHERE "batchId" = ${id} ORDER BY id LIMIT 1001 FOR UPDATE`;
    if (locked.length > 1000) throw new RedeemOperationError(400, "批次超过 1000 个码，请通过码明细按选择范围操作");
    await tx.$queryRaw`SELECT id FROM "RedeemBatch" WHERE id = ${id} FOR UPDATE`;
    const batch = await tx.redeemBatch.findUnique({ where: { id } });
    if (!batch) throw new RedeemOperationError(404, "批次不存在");
    if (batch.enabled !== input.enabled && batch.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new RedeemOperationError(409, "批次已被其他操作更新，请刷新后核对");
    const changed = batch.enabled !== input.enabled;
    if (changed) await tx.redeemBatch.update({ where: { id }, data: { enabled: input.enabled } });
    const requested = await tx.redeemCode.count({ where: { batchId: id } });
    return { requested, changed: changed ? requested : 0, unchanged: changed ? 0 : requested };
  }, { timeout: 15000 });
}

export async function lookupRedeemReceipt(userId: string, rawCode: string, db: PrismaClient = prisma): Promise<RedeemReceipt> {
  const legacy = rawCode.trim().toUpperCase();
  const normalized = normalizeRedeemCode(rawCode);
  const code = legacy !== normalized && await db.redeemCode.findUnique({ where: { code: legacy }, select: { id: true } }) ? legacy : normalized;
  const row = await db.redeemRedemption.findFirst({
    where: { userId, redeemCode: { code } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { redeemCode: { select: { name: true, code: true } } }
  });
  return row ? { found: true, receipt: { id: row.id, name: row.redeemCode.name, maskedCode: `•••• ${row.redeemCode.code.slice(-4)}`, credits: row.credits, createdAt: row.createdAt.toISOString() } } : { found: false };
}
