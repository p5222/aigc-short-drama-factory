import type { PrismaClient } from "@prisma/client";
import type { AdminActivityDay } from "@aifilm/shared";

const dayMs = 86_400_000;
const chinaOffset = 8 * 60 * 60 * 1000;

/** Bounded daily aggregates; Prisma DateTime columns store UTC timestamps. */
export async function getAdminActivity(db: PrismaClient, now = new Date()): Promise<AdminActivityDay[]> {
  const today = Math.floor((now.getTime() + chinaOffset) / dayMs) * dayMs - chinaOffset;
  const since = new Date(today - 29 * dayMs), until = new Date(today + dayMs);
  type Row = { date: string; value: number };
  const [tasks, users, credits, redemptions] = await Promise.all([
    db.$queryRaw<Row[]>`SELECT to_char("createdAt" + interval '8 hours', 'YYYY-MM-DD') AS date, count(*)::int AS value
      FROM "GenerationTask" WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
      AND left(id, 18) <> 'content_operation_' GROUP BY 1`,
    db.$queryRaw<Row[]>`SELECT to_char("createdAt" + interval '8 hours', 'YYYY-MM-DD') AS date, count(*)::int AS value
      FROM "User" WHERE "createdAt" >= ${since} AND "createdAt" < ${until} GROUP BY 1`,
    db.$queryRaw<Row[]>`SELECT to_char("createdAt" + interval '8 hours', 'YYYY-MM-DD') AS date, (-sum(amount))::float8 AS value
      FROM "CreditTransaction" WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
      AND type = 'consume' AND amount < 0 GROUP BY 1`,
    db.$queryRaw<(Row & { credits: number })[]>`SELECT to_char("createdAt" + interval '8 hours', 'YYYY-MM-DD') AS date,
      count(*)::int AS value, sum(credits)::float8 AS credits FROM "RedeemRedemption"
      WHERE "createdAt" >= ${since} AND "createdAt" < ${until} GROUP BY 1`
  ]);
  const byDate = <T extends Row>(rows: T[]) => new Map(rows.map(row => [row.date, row]));
  const taskMap = byDate(tasks), userMap = byDate(users), creditMap = byDate(credits), redeemMap = byDate(redemptions);
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(since.getTime() + index * dayMs + chinaOffset).toISOString().slice(0, 10);
    return { date, tasks: taskMap.get(date)?.value ?? 0, newUsers: userMap.get(date)?.value ?? 0,
      creditsConsumed: creditMap.get(date)?.value ?? 0, redemptions: redeemMap.get(date)?.value ?? 0,
      redeemedCredits: redeemMap.get(date)?.credits ?? 0 };
  });
}
