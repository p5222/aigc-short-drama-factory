import fs from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire("/app/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");
const [,, start, end, output] = process.argv;
if (!start || !end || !output || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(start) >= Date.parse(end))
  throw new Error("Usage (inside API runtime): export-billing-snapshot.mjs START_ISO END_ISO OUTPUT.json");
const db = new PrismaClient();
try {
  const data = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const range = { gte: new Date(start), lt: new Date(end) };
    const payments = await tx.paymentRecord.findMany({ where: { createdAt: range, channel: { in: ["wechat", "alipay"] }, status: "succeeded" },
      select: { orderId: true, channel: true, providerTradeNo: true, amountCny: true } });
    // Include failures/pending work: suppliers may charge even when local delivery failed.
    const tasks = await tx.generationTask.findMany({ where: { createdAt: range },
      select: { id: true, provider: true, type: true, status: true, finalCredits: true, errorReason: true } });
    const providerRequests = [], untraceableTasks = [];
    for (const task of tasks) {
      if (/mock|local|embedded|content_operation/i.test(task.provider)) continue;
      let metadata = {};
      try { const value = JSON.parse(task.errorReason ?? "{}"); if (value.kind === "media_checkpoint") metadata = value.metadata ?? {}; } catch {}
      const requestId = metadata.remoteTaskId ?? metadata.remoteRequestId;
      const entry = { taskId: task.id, providerId: task.provider, platformCredits: task.finalCredits ?? 0, status: task.status, modality: task.type };
      if (typeof requestId === "string" && requestId) providerRequests.push({ ...entry, requestId });
      else untraceableTasks.push(entry);
    }
    return { period: { start, end }, revision: process.env.APP_REVISION ?? null,
      payments: payments.map(row => ({ orderId: row.orderId, channel: row.channel, tradeNo: row.providerTradeNo,
        amountMinor: Math.round(row.amountCny * 100), currency: "CNY" })), providerRequests, untraceableTasks };
  }, { isolationLevel: "RepeatableRead" });
  await fs.writeFile(output, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ payments: data.payments.length, traceableTasks: data.providerRequests.length,
    untraceableTasks: data.untraceableTasks.length, period: data.period }));
} finally { await db.$disconnect(); }
