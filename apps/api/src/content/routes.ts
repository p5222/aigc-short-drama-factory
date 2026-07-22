import { z } from "zod";
import type { StyleProfile } from "@aifilm/shared";
import { addSourceDocument, createContentProject, listContentProjects } from "./service.js";

export const contentProjectInput = z.object({ title: z.string().trim().min(1).max(160), mode: z.enum(["same_genre", "original", "adaptation"]), styleProfile: z.record(z.string(), z.unknown()).optional() });
export const sourceInput = z.object({ kind: z.enum(["novel", "short_story", "idea", "script"]), title: z.string().trim().min(1).max(160), content: z.string().min(1).max(500000) });
export async function handleListContentProjects(userId: string) { return listContentProjects(userId); }
export async function handleCreateContentProject(userId: string, input: unknown) {
  const parsed = contentProjectInput.parse(input);
  return createContentProject(userId, { ...parsed, styleProfile: parsed.styleProfile as StyleProfile | undefined });
}
export async function handleAddSource(userId: string, projectId: string, input: unknown) { return addSourceDocument(userId, projectId, sourceInput.parse(input)); }
