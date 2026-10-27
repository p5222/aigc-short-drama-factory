import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { paidMembershipTermWhere } from "../billing/membership.js";

export const adminUserPageQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  keyword: z.string().max(120).optional(),
  role: z.enum(["all", "creator", "admin"]).optional(),
  status: z.enum(["all", "active", "disabled", "deleted"]).optional(),
  membership: z.enum(["all", "active", "scheduled", "expired", "none"]).optional(),
  commercial: z.enum(["all", "online_paid", "no_online_record"]).optional(),
  sort: z.enum(["created_desc", "created_asc", "login_desc", "credits_desc", "name_asc"]).default("created_desc"),
  registeredFrom: z.iso.datetime({ offset: true }).optional(),
  registeredTo: z.iso.datetime({ offset: true }).optional()
}).refine(input => !input.registeredFrom || !input.registeredTo || Date.parse(input.registeredFrom) <= Date.parse(input.registeredTo), {
  message: "注册开始时间不能晚于结束时间", path: ["registeredTo"]
});

export type AdminUserPageOptions = Partial<z.infer<typeof adminUserPageQuery>>;

export function adminUserQuery(options: AdminUserPageOptions, now = new Date()) {
  const keyword = options.keyword?.trim();
  const current = { ...paidMembershipTermWhere, membershipStartsAt: { lte: now }, membershipEndsAt: { gt: now } };
  const future = { ...paidMembershipTermWhere, membershipStartsAt: { gt: now }, membershipEndsAt: { gt: now } };
  const membership: Prisma.UserWhereInput = options.membership === "active" ? { orders: { some: current } }
    : options.membership === "scheduled" ? { AND: [{ orders: { some: future } }, { orders: { none: current } }] }
    : options.membership === "expired" ? { AND: [
      { orders: { some: { ...paidMembershipTermWhere, membershipEndsAt: { lte: now } } } },
      { orders: { none: { ...paidMembershipTermWhere, membershipEndsAt: { gt: now } } } }
    ] }
    : options.membership === "none" ? { orders: { none: paidMembershipTermWhere } } : {};
  const onlinePaid = { status: "paid", channel: "wechat", amountFen: { gt: 0 } };
  const where: Prisma.UserWhereInput = {
    AND: [
      membership,
      options.commercial === "online_paid" ? { orders: { some: onlinePaid } }
        : options.commercial === "no_online_record" ? { orders: { none: onlinePaid } } : {}
    ],
    ...(options.role && options.role !== "all" ? { role: options.role } : {}),
    status: options.status && options.status !== "all" ? options.status : { not: "deleted" },
    ...(keyword ? { OR: [{ name: { contains: keyword, mode: "insensitive" } }, { email: { contains: keyword, mode: "insensitive" } }, { phone: { contains: keyword } }, { id: keyword }] } : {}),
    ...(options.registeredFrom || options.registeredTo ? { createdAt: {
      ...(options.registeredFrom ? { gte: new Date(options.registeredFrom) } : {}),
      ...(options.registeredTo ? { lte: new Date(options.registeredTo) } : {})
    } } : {})
  };
  const primary: Prisma.UserOrderByWithRelationInput = options.sort === "created_asc" ? { createdAt: "asc" }
    : options.sort === "login_desc" ? { lastLoginAt: { sort: "desc", nulls: "last" } }
    : options.sort === "credits_desc" ? { credit: { balance: "desc" } }
    : options.sort === "name_asc" ? { name: "asc" } : { createdAt: "desc" };
  return { where, orderBy: [primary, { id: "asc" }] satisfies Prisma.UserOrderByWithRelationInput[] };
}
