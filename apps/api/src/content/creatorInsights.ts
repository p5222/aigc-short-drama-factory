import type { CreatorInsights } from "@aifilm/shared";
import { prisma } from "../db/client.js";

export async function creatorInsights(): Promise<CreatorInsights> {
  const until = new Date(), since = new Date(until.getTime() - 30 * 86400000);
  const [stages, runs, timing, feedback] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ event: string; users: bigint; events: bigint }>>`
      SELECT "eventName" AS event, COUNT(DISTINCT "userId") AS users, COUNT(*) AS events
      FROM "AnalyticsEvent" WHERE "createdAt" >= ${since} AND "createdAt" <= ${until} AND "eventName" LIKE 'creator_%'
      GROUP BY "eventName" ORDER BY "eventName"`,
    prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT status, COUNT(*) AS count FROM "CreatorRun" WHERE "createdAt" >= ${since} AND "createdAt" <= ${until} GROUP BY status`,
    prisma.$queryRaw<Array<{ projects: bigint; median: number | null }>>`
      WITH started AS (
        SELECT "entityId", MIN("createdAt") AS at FROM "AnalyticsEvent"
        WHERE "eventName" = 'creator_brief_saved' AND "createdAt" >= ${since} AND "createdAt" <= ${until} GROUP BY "entityId"
      ), accepted AS (
        SELECT s."entityId", EXTRACT(EPOCH FROM (MIN(e."createdAt") - s.at)) AS seconds
        FROM started s JOIN "AnalyticsEvent" e ON e."entityId" = s."entityId"
        WHERE e."eventName" = 'creator_script_accepted' AND e."createdAt" >= s.at AND e."createdAt" <= ${until}
        GROUP BY s."entityId", s.at
      ) SELECT COUNT(*) AS projects, percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS median FROM accepted`,
    prisma.$queryRaw<Array<{ changed: boolean; count: bigint }>>`
      SELECT COALESCE(("properties"->>'changed')::boolean, false) AS changed, COUNT(*) AS count
      FROM "AnalyticsEvent" WHERE "eventName" = 'creator_script_accepted' AND "createdAt" >= ${since} AND "createdAt" <= ${until}
      GROUP BY COALESCE(("properties"->>'changed')::boolean, false)`
  ], { isolationLevel: "RepeatableRead" });
  return { since: since.toISOString(), until: until.toISOString(),
    stages: stages.map(row => ({ event: row.event, users: Number(row.users), events: Number(row.events) })),
    runs: runs.map(row => ({ status: row.status, count: Number(row.count) })),
    firstAccepted: { projects: Number(timing[0]?.projects ?? 0), medianSeconds: timing[0]?.median ?? null },
    feedback: { acceptedEdits: Number(feedback.find(row => row.changed)?.count ?? 0), acceptedUnchanged: Number(feedback.find(row => !row.changed)?.count ?? 0) } };
}
