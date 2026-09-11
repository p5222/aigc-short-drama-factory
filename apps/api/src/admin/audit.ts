import crypto from "node:crypto";
import { prisma } from "../db/client.js";

const auditValueFields = new Set(["role", "status", "enabled", "amount", "type", "userId", "providerId", "model", "unitCredits", "requestId", "reason", "description"]);
export function auditPayload(body: unknown): { fields: string[]; values: Record<string, string | number | boolean> } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { fields: [], values: {} };
  const entries = Object.entries(body as Record<string, unknown>);
  return {
    fields: entries.map(([key]) => key).filter(key => !/password|secret|key|token|credential/i.test(key)).slice(0, 80),
    values: Object.fromEntries(entries.filter(([key, value]) => auditValueFields.has(key) && ["string", "number", "boolean"].includes(typeof value))
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 500) : value as number | boolean]))
  };
}

export async function beginAdminAudit(input: { actorId: string; actorRole: string; method: string; path: string; body: unknown; ip?: string }) {
  return prisma.adminAuditLog.create({ data: {
    id: `audit_${crypto.randomUUID()}`, actorId: input.actorId, actorRole: input.actorRole,
    action: input.method, target: input.path.slice(0, 500), ipAddress: input.ip?.slice(0, 80),
    details: auditPayload(input.body), status: "started"
  } });
}

export async function finishAdminAudit(id: string, statusCode: number) {
  await prisma.adminAuditLog.update({ where: { id }, data: {
    status: statusCode < 400 ? "succeeded" : "failed", statusCode, completedAt: new Date()
  } });
}

export async function listAdminAuditLogs(input: { page?: number; pageSize?: number; actorId?: string; status?: string; keyword?: string }) {
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.max(1, Math.min(100, input.pageSize || 30));
  const where = {
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.keyword ? { target: { contains: input.keyword.slice(0, 100), mode: "insensitive" as const } } : {})
  };
  const [items, total] = await prisma.$transaction([
    prisma.adminAuditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.adminAuditLog.count({ where })
  ]);
  return { items, total, page, pageSize };
}
