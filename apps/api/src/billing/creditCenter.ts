import type { Prisma } from "@prisma/client";
import { calculateOfficialCredits, defaultCreditPolicy, officialSampleUsage, validateCostRule, validateCreditPolicy, verifiedOfficialCosts, type CreditPolicy, type OfficialCostRule } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { mapCreditTransaction, mapTask } from "../db/mappers.js";
import { creditPolicy, readCostRule } from "./pricing.js";

export class CreditQueryError extends Error { readonly status = 400; }
export function pageQuery(query: Record<string, unknown>) {
  const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new CreditQueryError("分页参数无效");
  return { page, pageSize, skip: (page - 1) * pageSize };
}
function text(value: unknown) { return typeof value === "string" ? value.trim().slice(0, 100) : ""; }
export async function ledgerPage(userId: string, query: Record<string, unknown>) {
  if (!userId) throw new CreditQueryError("请选择账户");
  const { page, pageSize, skip } = pageQuery(query);
  const type = text(query.type), keyword = text(query.keyword);
  if (type && !["recharge", "freeze", "consume", "refund", "adjust"].includes(type)) throw new CreditQueryError("流水类型无效");
  const date = (value: unknown) => {
    if (!value) return undefined;
    const d = new Date(String(value)); if (!Number.isFinite(d.getTime())) throw new CreditQueryError("日期格式无效"); return d;
  };
  const from = date(query.from), to = date(query.to);
  if (from && to && from > to) throw new CreditQueryError("开始时间不能晚于结束时间");
  const where: Prisma.CreditTransactionWhereInput = { userId, ...(type ? { type } : {}),
    ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
    ...(keyword ? { OR: [{ description: { contains: keyword, mode: "insensitive" } }, { taskId: { contains: keyword } }, { projectId: { contains: keyword } }] } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.creditTransaction.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: pageSize }),
    prisma.creditTransaction.count({ where })
  ]);
  return { items: items.map(mapCreditTransaction), total, page, pageSize };
}
export function ledgerCsv(items: ReturnType<typeof mapCreditTransaction>[]) {
  const cell = (value: unknown) => {
    const s = String(value ?? ""); return `"${(/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [["流水ID", "类型", "积分", "总余额", "说明", "任务", "时间"], ...items.map(t => [t.id, t.type, t.amount, t.balanceAfter, t.description, t.taskId, t.createdAt])]
    .map(row => row.map(cell).join(",")).join("\r\n");
}
export async function pricingOverview() {
  const row = await prisma.creditPricingPolicy.findUnique({ where: { id: "global" } });
  const [effective, prices, plans, memberships] = await Promise.all([
    creditPolicy(), prisma.modelPrice.findMany({ include: { provider: true }, orderBy: { model: "asc" } }),
    prisma.plan.findMany({ orderBy: { price: "asc" } }), prisma.membershipPlan.findMany()
  ]);
  return { policy: row?.policy ?? defaultCreditPolicy, effectivePolicy: effective, version: row?.version ?? 1,
    prices: prices.map(p => ({ id: p.id, providerId: p.providerId, providerName: p.providerName, model: p.model,
      modality: p.modality, unitCredits: p.billing ? calculateOfficialCredits(readCostRule(p.billing)!, officialSampleUsage(readCostRule(p.billing)!), effective).payableCredits : p.unitCredits, enabled: p.enabled, billing: p.billing,
      updatedAt: p.updatedAt.toISOString(), officialCandidate: /^dashscope/.test(p.providerId ?? "") ? verifiedOfficialCosts.find(c => c.model === p.model) ?? null : null })),
    plans: plans.map(p => ({ id: p.id, name: p.name, price: p.price, credits: p.credits, bonusCredits: p.bonusCredits, enabled: p.enabled,
      cashValueMicros: p.credits + p.bonusCredits > 0 ? Math.floor(p.price * 1000000 / (p.credits + p.bonusCredits)) : null })),
    memberships: memberships.map(p => ({ id: p.id, name: p.name, monthlyPrice: p.monthlyPrice, monthlyCredits: p.monthlyCredits, discountPercent: p.discountPercent, enabled: p.enabled })),
    catalog: verifiedOfficialCosts, warnings: ["40%指API成本口径毛利；运营费用需另行配置。", "DeepSeek官方中英文页面冲突，未加入自动同步；美元规则必须填写结算汇率。", "成本来源于2026-10-26的人工核验目录；应用前需确认当前官方价格、地域和Key账单。"] };
}
export async function savePricingPolicy(input: { expectedVersion: number; policy: CreditPolicy }) {
  validateCreditPolicy(input.policy);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('credit-policy'))`;
    const row = await tx.creditPricingPolicy.findUnique({ where: { id: "global" } });
    if (input.expectedVersion !== (row?.version ?? 1)) throw new Error("政策已被其他管理员修改，请刷新");
    const version = (row?.version ?? 1) + 1, policy = { ...input.policy, version };
    await tx.creditPricingPolicy.upsert({ where: { id: "global" }, create: { id: "global", version, policy: JSON.parse(JSON.stringify(policy)) }, update: { version, policy: JSON.parse(JSON.stringify(policy)) } });
    const effective = await creditPolicy(tx);
    const prices = await tx.modelPrice.findMany();
    for (const price of prices.filter(p => p.billing)) {
      const rule = price.billing as unknown as OfficialCostRule;
      await tx.modelPrice.update({ where: { id: price.id }, data: { unitCredits: calculateOfficialCredits(rule, officialSampleUsage(rule), effective).listCredits } });
    }
    return { policy, version };
  });
}
export async function saveCostRule(input: { priceId: string; expectedUpdatedAt: string; rule: OfficialCostRule | null; expectedPolicyVersion: number }) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('credit-policy'))`;
    await tx.$queryRaw`SELECT "id" FROM "ModelPrice" WHERE "id" = ${input.priceId} FOR UPDATE`;
    const price = await tx.modelPrice.findUniqueOrThrow({ where: { id: input.priceId } });
    const policy = await creditPolicy(tx);
    if (policy.version !== input.expectedPolicyVersion || price.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new Error("价格或政策已变化，请重新预览");
    if (!input.rule) {
      const { Prisma } = await import("@prisma/client");
      return tx.modelPrice.update({ where: { id: price.id }, data: { billing: Prisma.DbNull } }).then(() => ({ saved: true }));
    }
    validateCostRule(input.rule, policy);
    const kinds: Record<string, string> = { text: "tokens", image: "image", video: "second", tts: "character" };
    if (input.rule.model !== price.model || input.rule.kind !== kinds[price.modality]) throw new Error("成本规则与当前模型类型不匹配");
    const preview = calculateOfficialCredits(input.rule, officialSampleUsage(input.rule), policy);
    await tx.modelPrice.update({ where: { id: price.id }, data: { billing: JSON.parse(JSON.stringify(input.rule)), unitCredits: preview.listCredits } });
    return { saved: true, preview };
  });
}
export async function accountPage(query: Record<string, unknown>) {
  const { page, pageSize, skip } = pageQuery(query), keyword = text(query.keyword);
  const where: Prisma.CreditAccountWhereInput = keyword ? { OR: [{ userId: { contains: keyword } }, { user: { name: { contains: keyword, mode: "insensitive" } } }, { user: { email: { contains: keyword, mode: "insensitive" } } }] } : {};
  const [rows, total, sums] = await prisma.$transaction([
    prisma.creditAccount.findMany({ where, include: { user: { select: { name: true, email: true } } }, orderBy: { updatedAt: "desc" }, skip, take: pageSize }),
    prisma.creditAccount.count({ where }), prisma.creditAccount.aggregate({ _sum: { balance: true, frozenBalance: true, totalConsume: true } })
  ]);
  const ids = rows.map(r => r.userId);
  const [consumption, freezes, funding] = await Promise.all([
    prisma.creditTransaction.groupBy({ by: ["userId"], where: { userId: { in: ids }, type: "consume" }, _sum: { amount: true } }),
    prisma.creditTransaction.groupBy({ by: ["userId"], where: { userId: { in: ids }, type: { in: ["freeze", "refund", "consume"] } }, _sum: { amount: true } }),
    prisma.creditFundingLot.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _sum: { remainingCredits: true } })
  ]);
  return { page, pageSize, total, totals: sums._sum, items: rows.map(r => {
    const consumeLedger = -(consumption.find(t => t.userId === r.userId)?._sum.amount ?? 0);
    const frozenLedger = -(freezes.find(t => t.userId === r.userId)?._sum.amount ?? 0);
    const fundedBalance = funding.find(t => t.userId === r.userId)?._sum.remainingCredits ?? 0;
    return { userId: r.userId, name: r.user.name, email: r.user.email,
    balance: r.balance, frozenBalance: r.frozenBalance, available: r.balance - r.frozenBalance, totalRecharge: r.totalRecharge, totalConsume: r.totalConsume,
    consumeLedger, frozenLedger, fundedBalance, unclassifiedBalance: Math.max(0, r.balance - fundedBalance),
    anomaly: r.frozenBalance < 0 || r.frozenBalance > r.balance || r.totalConsume !== consumeLedger || r.frozenBalance !== frozenLedger || fundedBalance > r.balance };
  }) };
}
export async function fundingLots(userId: string) {
  if (!userId) throw new Error("请选择账户");
  const lots = await prisma.creditFundingLot.findMany({ where: { userId }, orderBy: { sequence: "desc" }, take: 100 });
  return { items: lots.map(l => ({ ...l, cashMicros: l.cashMicros === null ? null : Number(l.cashMicros) })), limit: 100 };
}
export async function billingTasks(query: Record<string, unknown>) {
  const { page, pageSize, skip } = pageQuery(query), keyword = text(query.keyword), status = text(query.status);
  const where: Prisma.GenerationTaskWhereInput = { NOT: { id: { startsWith: "content_operation_" } },
    ...(text(query.userId) ? { userId: text(query.userId) } : {}), ...(status ? { status } : {}),
    ...(keyword ? { OR: [{ id: { contains: keyword } }, { model: { contains: keyword } }, { title: { contains: keyword } }] } : {}) };
  const [rows, total] = await prisma.$transaction([
    prisma.generationTask.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: pageSize }),
    prisma.generationTask.count({ where })
  ]);
  return { page, pageSize, total, items: rows.map(row => ({ ...mapTask(row), userId: row.userId, settlement: row.billingSettlement,
    metering: row.billingUsage, updatedAt: row.updatedAt.toISOString() })) };
}
export async function verifyTaskCost(input: { taskId: string; expectedUpdatedAt: string; costMicros: number; invoiceReference: string }) {
  if (!Number.isSafeInteger(input.costMicros) || input.costMicros < 0 || input.costMicros > Number.MAX_SAFE_INTEGER || !input.invoiceReference.trim()) throw new Error("请填写有效的账单成本和核验凭据");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "GenerationTask" WHERE "id" = ${input.taskId} FOR UPDATE`;
    const task = await tx.generationTask.findUniqueOrThrow({ where: { id: input.taskId } });
    if (["running", "pending"].includes(task.status)) throw new Error("任务执行中，请结束后核对账单");
    if (task.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new Error("任务已变化，请刷新后核对");
    const old = task.billingSettlement as Record<string, unknown> | null;
    await tx.generationTask.update({ where: { id: task.id }, data: { billingSettlement: {
      ...(old ?? {}), costMicros: input.costMicros, costStatus: "invoice_verified", invoiceReference: input.invoiceReference.trim().slice(0, 200), verifiedAt: new Date().toISOString()
    } as Prisma.InputJsonValue } });
    return { verified: true };
  });
}
