import { z } from "zod";
import type { StyleProfile } from "@aifilm/shared";
import { addSourceDocument, analyzeContentProject, confirmContentOutline, createContentProject, deleteContentProject, developContentProject, generateContentChapterBatch, generateContentOutline, generateContentProductionPackage, getContentProductionPackage, getContentProjectVersions, listContentProjects, updateContentModelRoute } from "./service.js";

export const contentProjectInput = z.object({ title: z.string().trim().min(1).max(160), mode: z.enum(["same_genre", "original", "adaptation"]), styleProfile: z.record(z.string(), z.unknown()).optional(), textProvider: z.string().default("manjiao"), textModel: z.string().default("gpt-5.5") });
export const sourceInput = z.object({ kind: z.enum(["novel", "short_story", "idea", "script"]), title: z.string().trim().min(1).max(160), content: z.string().min(1).max(500000) });
export const developInput = z.object({ intentType: z.enum(["title", "genre", "references"]), intent: z.string().trim().min(2).max(2000), targetWords: z.number().int().min(1000).max(200000).default(20000), chapterCount: z.number().int().min(1).max(100).default(10), batchSize: z.number().int().min(2).max(3).default(2) });
export const chapterBatchInput = z.object({ startChapter: z.number().int().positive(), batchSize: z.number().int().min(2).max(3).default(2), regenerate: z.boolean().optional() });
export const contentRouteInput = z.object({ textProvider: z.string().min(1), textModel: z.string().min(1) });
export const outlineConfirmInput = z.object({ result: z.record(z.string(), z.unknown()).optional() });
export async function handleListContentProjects(userId: string) { return listContentProjects(userId); }
export async function handleCreateContentProject(userId: string, input: unknown) {
  const parsed = contentProjectInput.parse(input);
  return createContentProject(userId, { ...parsed, styleProfile: parsed.styleProfile as StyleProfile | undefined });
}
export async function handleAddSource(userId: string, projectId: string, input: unknown) { return addSourceDocument(userId, projectId, sourceInput.parse(input)); }
export async function handleGetContentPackage(userId: string, projectId: string) { return getContentProductionPackage(userId, projectId); }
export async function handleGetContentVersions(userId: string, projectId: string) { return getContentProjectVersions(userId, projectId); }
export async function handleGenerateContentPackage(userId: string, projectId: string) { return generateContentProductionPackage(userId, projectId); }
export async function handleDevelopContentProject(userId: string, projectId: string, input: unknown) { return developContentProject(userId, projectId, developInput.parse(input)); }
export async function handleAnalyzeContentProject(userId: string, projectId: string, input: unknown) { return analyzeContentProject(userId, projectId, developInput.parse(input)); }
export async function handleGenerateContentOutline(userId: string, projectId: string) { return generateContentOutline(userId, projectId); }
export async function handleConfirmContentOutline(userId: string, projectId: string, input: unknown) { return confirmContentOutline(userId, projectId, outlineConfirmInput.parse(input)); }
export async function handleUpdateContentModelRoute(userId: string, projectId: string, input: unknown) { return updateContentModelRoute(userId, projectId, contentRouteInput.parse(input)); }
export async function handleGenerateContentChapterBatch(userId: string, projectId: string, input: unknown) { return generateContentChapterBatch(userId, projectId, chapterBatchInput.parse(input)); }
export async function handleDeleteContentProject(userId: string, projectId: string) { return deleteContentProject(userId, projectId); }
