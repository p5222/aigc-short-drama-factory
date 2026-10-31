import { Router } from "express";
import { z } from "zod";
import { acknowledgeUnknownRun, cancelCreatorRun, continueCreatorProject, createCreatorRun, createShortProject, creatorEvent, creatorPreference, executeCreatorRun, getCreatorState, quoteCreatorRun, reviewCreatorScript, updateCreatorBrief, updateCreatorPreference } from "./creatorAgent.js";
import { saveFact } from "./storyMemory.js";
import { prisma } from "../db/client.js";

export const creatorRouter = Router();
const route = (method: "get" | "post" | "patch", path: string, handler: (userId: string, projectId: string, runId: string, body: unknown) => Promise<unknown>) => {
  creatorRouter[method](path, async (req, res, next) => {
    try {
      const userId = (req as typeof req & { userId?: string }).userId;
      if (!userId) { res.status(401).json({ message: "请先登录。" }); return; }
      const scalar = (value: string | string[] | undefined) => typeof value === "string" ? value : "";
      res.json(await handler(userId, scalar(req.params.id), scalar(req.params.runId), req.body));
    } catch (error) {
      if (error instanceof z.ZodError) { res.status(400).json({ message: error.issues[0]?.message ?? "输入不完整" }); return; }
      if (error instanceof Error) { res.status("status" in error ? Number(error.status) : 422).json({ message: error.message }); return; }
      next(error);
    }
  });
};
route("get", "/preference", userId => creatorPreference(userId));
route("patch", "/preference", (userId, _id, _runId, body) => updateCreatorPreference(userId, body));
route("post", "/projects", (userId, _id, _runId, body) => createShortProject(userId, body));
route("get", "/projects/:id", (userId, id) => getCreatorState(userId, id));
route("patch", "/projects/:id/brief", (userId, id, _runId, body) => updateCreatorBrief(userId, id, body));
route("post", "/projects/:id/continue", (userId, id, _runId, body) => continueCreatorProject(userId, id, body));
route("post", "/projects/:id/quote", (userId, id, _runId, body) => quoteCreatorRun(userId, id, body));
route("post", "/projects/:id/runs", (userId, id, _runId, body) => createCreatorRun(userId, id, body));
route("post", "/projects/:id/runs/:runId/execute", (userId, id, runId) => executeCreatorRun(userId, id, runId));
route("post", "/projects/:id/runs/:runId/cancel", (userId, id, runId) => cancelCreatorRun(userId, id, runId));
route("post", "/projects/:id/runs/:runId/acknowledge", (userId, id, runId, body) => acknowledgeUnknownRun(userId, id, runId, body));
route("post", "/projects/:id/review", (userId, id, _runId, body) => reviewCreatorScript(userId, id, body));
route("post", "/projects/:id/facts", (userId, id, _runId, body) => saveFact(userId, id, body));
route("patch", "/projects/:id/facts/:runId", (userId, id, factId, body) => saveFact(userId, id, body, factId));
route("post", "/projects/:id/events", async (userId, id, _runId, body) => {
  const { event } = z.object({ event: z.enum(["creator_script_viewed", "creator_preview_viewed", "creator_export_viewed"]) }).strict().parse(body);
  if (!await prisma.contentProject.findFirst({ where: { id, userId } })) throw new Error("内容项目不存在");
  await prisma.$transaction(tx => creatorEvent(tx, userId, id, event));
  return { ok: true };
});
