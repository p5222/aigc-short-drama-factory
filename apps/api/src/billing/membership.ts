import type { Prisma, RechargeOrder } from "@prisma/client";
import type { MembershipTerm } from "@aifilm/shared";

/** Paid order snapshots, never the mutable membership cache, define displayed rights. */
export const paidMembershipTermWhere = {
  kind: "membership", status: "paid", membershipPlanId: { not: null },
  membershipStartsAt: { not: null }, membershipEndsAt: { not: null }
} satisfies Prisma.RechargeOrderWhereInput;
function mapTerm(term: RechargeOrder): MembershipTerm {
  return { planId: term.membershipPlanId!, planName: term.planName,
    startsAt: term.membershipStartsAt!.toISOString(), endsAt: term.membershipEndsAt!.toISOString(),
    discountPercent: term.membershipDiscountPercent, priorityLevel: term.membershipPriorityLevel };
}

/** Calendar month in UTC, clamped for Jan 31 / leap years. */
export function nextMembershipMonth(date: Date) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}

export function discountedCredits(credits: number, discount: number) {
  if (!Number.isSafeInteger(credits) || credits < 0 || !Number.isInteger(discount) || discount < 0 || discount > 100)
    throw new Error("会员结算参数无效");
  return Math.ceil(credits * (100 - discount) / 100);
}
export const membershipQueuePriority = (level: number) => Math.max(1, 100 - Math.min(99, Math.max(0, Math.floor(level))));

/** Call with the user's credit-account lock held, before marking the order paid. */
export async function grantMembership(tx: Prisma.TransactionClient, order: RechargeOrder, now = new Date()) {
  if (order.kind !== "membership") return {};
  if (!order.membershipPlanId) throw new Error("会员订单缺少套餐快照");
  const existing = await tx.userMembership.findUnique({ where: { userId: order.userId } });
  const active = existing && existing.endsAt > now;
  if (active && existing.planId !== order.membershipPlanId) throw new Error("会员档位冲突，请联系平台核对已付订单");
  const start = active ? existing.endsAt : now;
  const end = nextMembershipMonth(start);
  await tx.userMembership.upsert({
    where: { userId: order.userId },
    create: { userId: order.userId, planId: order.membershipPlanId, planName: order.planName, startsAt: start, endsAt: end,
      discountPercent: order.membershipDiscountPercent, priorityLevel: order.membershipPriorityLevel },
    // Existing terms keep their snapshotted benefits until the renewal starts.
    update: { endsAt: end, ...(active ? {} : { planId: order.membershipPlanId, planName: order.planName, startsAt: start,
      discountPercent: order.membershipDiscountPercent, priorityLevel: order.membershipPriorityLevel }) }
  });
  return { membershipStartsAt: start, membershipEndsAt: end };
}

/** Order terms are the entitlement source, including changed benefits on future renewals. */
export async function activeMembership(db: Pick<Prisma.TransactionClient, "rechargeOrder">, userId: string, now = new Date()) {
  const term = await db.rechargeOrder.findFirst({
    where: { ...paidMembershipTermWhere, userId, membershipStartsAt: { lte: now }, membershipEndsAt: { gt: now } },
    orderBy: { membershipStartsAt: "desc" }
  });
  return term ? mapTerm(term) : null;
}

export async function membershipOverview(db: Pick<Prisma.TransactionClient, "rechargeOrder">, userId: string, now = new Date()) {
  const where = { ...paidMembershipTermWhere, userId };
  const future = { ...where, membershipStartsAt: { gt: now }, membershipEndsAt: { gt: now } };
  const [active, scheduled, scheduledCount, lastExpired, total] = await Promise.all([
    activeMembership(db, userId, now),
    db.rechargeOrder.findMany({ where: future, orderBy: [{ membershipStartsAt: "asc" }, { id: "asc" }], take: 12 }),
    db.rechargeOrder.count({ where: future }),
    db.rechargeOrder.findFirst({ where: { ...where, membershipEndsAt: { lte: now } }, orderBy: [{ membershipEndsAt: "desc" }, { id: "asc" }] }),
    db.rechargeOrder.aggregate({ where, _max: { membershipEndsAt: true } })
  ]);
  return { active, scheduled: scheduled.map(mapTerm), scheduledCount,
    lastExpired: lastExpired ? mapTerm(lastExpired) : null,
    paidThrough: total._max.membershipEndsAt?.toISOString() ?? null, autoRenew: false as const };
}
