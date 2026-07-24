import { z } from "zod";
import type { StyleProfile } from "@aifilm/shared";
import { addSourceDocument, createContentProject, deleteContentProject, developContentProject, generateContentProductionPackage, getContentProductionPackage, listContentProjects } from "./service.js";

export const contentProjectInput = z.object({ title: z.string().trim().min(1).max(160), mode: z.enum(["same_genre", "original", "adaptation"]), styleProfile: z.record(z.string(), z.unknown()).optional() });
export const sourceInput = z.object({ kind: z.enum(["novel", "short_story", "idea", "script"]), title: z.string().trim().min(1).max(160), content: z.string().min(1).max(500000) });
export const developInput = z.object({ intentType: z.enum(["title", "genre", "references"]), intent: z.string().trim().min(2).max(2000), targetWords: z.number().int().min(1000).max(200000).default(20000), chapterCount: z.number().int().min(1).max(100).default(10), batchSize: z.number().int().min(2).max(3).default(2) });
export async function handleListContentProjects(userId: string) { return listContentProjects(userId); }
export async function handleCreateContentProject(userId: string, input: unknown) {
  const parsed = contentProjectInput.parse(input);
  return createContentProject(userId, { ...parsed, styleProfile: parsed.styleProfile as StyleProfile | undefined });
}
export async function handleAddSource(userId: string, projectId: string, input: unknown) { return addSourceDocument(userId, projectId, sourceInput.parse(input)); }
export async function handleGetContentPackage(userId: string, projectId: string) { return getContentProductionPackage(userId, projectId); }
export async function handleGenerateContentPackage(userId: string, projectId: string) { return generateContentProductionPackage(userId, projectId); }
export async function handleDevelopContentProject(userId: string, projectId: string, input: unknown) { return developContentProject(userId, projectId, developInput.parse(input)); }
export async function handleDeleteContentProject(userId: string, projectId: string) { return deleteContentProject(userId, projectId); }
