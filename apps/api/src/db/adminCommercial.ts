import type { Prisma } from "@prisma/client";
import type { AdminUserRow } from "@aifilm/shared";
import { paidMembershipTermWhere } from "../billing/membership.js";

/** Three batched queries for the visible page; no cache or credit gifts imply payment. */
export async function adminCommercialSummary(db: Pick<Prisma.TransactionClient, "rechargeOrder">, ids: string[], now: Date) {
  const result = new Map<string, NonNullable<AdminUserRow["commercial"]>>();
  if (!ids.length) return result;
  const where = { ...paidMembershipTermWhere, userId: { in: ids } };
  const [terms, current, paid] = await Promise.all([
    db.rechargeOrder.groupBy({ by: ["userId"], where, _max: { membershipEndsAt: true } }),
    db.rechargeOrder.findMany({ where: { ...where, membershipStartsAt: { lte: now }, membershipEndsAt: { gt: now } },
      select: { userId: true, planName: true, membershipEndsAt: true }, orderBy: { membershipStartsAt: "asc" } }),
    db.rechargeOrder.groupBy({ by: ["userId"], where: { userId: { in: ids }, status: "paid", channel: "wechat", amountFen: { gt: 0 } },
      _sum: { amountFen: true }, _count: { _all: true } })
  ]);
  for (const id of ids) result.set(id, { membership: "none", onlinePaidOrders: 0, onlinePaidCny: 0 });
  for (const term of terms) {
    const item = result.get(term.userId)!;
    item.paidThrough = term._max.membershipEndsAt!.toISOString();
    item.membership = term._max.membershipEndsAt! > now ? "scheduled" : "expired";
  }
  for (const term of current) Object.assign(result.get(term.userId)!, {
    membership: "active", planName: term.planName, currentEndsAt: term.membershipEndsAt!.toISOString()
  });
  for (const row of paid) Object.assign(result.get(row.userId)!, {
    onlinePaidOrders: row._count._all, onlinePaidCny: (row._sum.amountFen ?? 0) / 100
  });
  return result;
}
