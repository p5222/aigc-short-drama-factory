import type { ContentProductionPackage, ContentProjectMode, ContentProjectSummary, EpisodeScriptVersion, ProductionEpisode, StyleProfile } from "@aifilm/shared";
import { requestJson } from "./httpClient";

export interface SourceDocumentInput {
  kind: "novel" | "short_story" | "idea" | "script";
  title: string;
  content: string;
}

export interface SourceDocumentResult extends SourceDocumentInput {
  id: string;
  contentProjectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentVersionHistory {
  projectId: string;
  analyses: Array<{ id: string; version: number; status: string; createdAt: string }>;
  outlines: Array<{ id: string; version: number; status: string; title: string; createdAt: string }>;
  chapters: Array<{ chapterNo: number; title: string; latestStatus: string; versions: Array<{ id: string; version: number; status: string; updatedAt: string }> }>;
  scripts: Array<{ id: string; version: number; status: string; createdAt: string }>;
}

export const contentApi = {
  projects: () => requestJson<ContentProjectSummary[]>("/content/projects"),
  versions: (projectId: string) => requestJson<ContentVersionHistory>(`/content/projects/${encodeURIComponent(projectId)}/versions`),
  createProject: (input: { title: string; mode: ContentProjectMode; styleProfile?: StyleProfile; textProvider?: string; textModel?: string }) =>
    requestJson<ContentProjectSummary>("/content/projects", { method: "POST", body: JSON.stringify(input) }),
  addSource: (projectId: string, input: SourceDocumentInput) =>
    requestJson<SourceDocumentResult>(`/content/projects/${encodeURIComponent(projectId)}/sources`, { method: "POST", body: JSON.stringify(input) }),
  productionPackage: (projectId: string) => requestJson<ContentProductionPackage>(`/content/projects/${encodeURIComponent(projectId)}/package`),
  syncProduction: (projectId: string) => requestJson<{ productionProjectId: string }>(`/content/projects/${encodeURIComponent(projectId)}/production/sync`, { method: "POST" }),
  generatePackage: (projectId: string, scope: number | "all" = "all") => requestJson<ContentProductionPackage>(`/content/projects/${encodeURIComponent(projectId)}/generate`, { method: "POST", body: JSON.stringify({ scope }) }),
  episodes: (projectId: string) => requestJson<ProductionEpisode[]>(`/content/projects/${encodeURIComponent(projectId)}/episodes`),
  generateEpisodes: (projectId: string, scope: number | "all") => requestJson<{ maxEpisodes: number; generatedEpisodeNos: number[]; episodes: ProductionEpisode[] }>(`/content/projects/${encodeURIComponent(projectId)}/episodes/generate`, { method: "POST", body: JSON.stringify({ scope }) }),
  regenerateEpisode: (projectId: string, episodeNo: number) => requestJson<ProductionEpisode>(`/content/projects/${encodeURIComponent(projectId)}/episodes/${episodeNo}/regenerate`, { method: "POST" }),
  episodeVersions: (projectId: string, episodeNo: number) => requestJson<EpisodeScriptVersion[]>(`/content/projects/${encodeURIComponent(projectId)}/episodes/${episodeNo}/versions`),
  activateEpisodeVersion: (projectId: string, episodeNo: number, version: number) => requestJson<ProductionEpisode>(`/content/projects/${encodeURIComponent(projectId)}/episodes/${episodeNo}/versions/${version}/activate`, { method: "POST" }),
  develop: (projectId: string, input: { intentType: "title" | "genre" | "references"; intent: string; targetWords: number; chapterCount: number; batchSize: number }) =>
    requestJson<ContentProductionPackage>(`/content/projects/${encodeURIComponent(projectId)}/develop`, { method: "POST", body: JSON.stringify(input) }),
  analyze: (projectId: string, input: { intentType: "title" | "genre" | "references"; intent: string; targetWords: number; chapterCount: number; batchSize: number }) =>
    requestJson<ContentProductionPackage>(`/content/projects/${encodeURIComponent(projectId)}/analyze`, { method: "POST", body: JSON.stringify(input) }),
  generateOutline: (projectId: string) => requestJson<ContentProductionPackage>(`/content/projects/${encodeURIComponent(projectId)}/outline/generate`, { method: "POST" }),
  confirmOutline: (projectId: string, result: Record<string, unknown>) => requestJson<ContentProductionPackage>(`/content/projects/${encodeURIComponent(projectId)}/outline/confirm`, { method: "POST", body: JSON.stringify({ result }) }),
  updateModelRoute: (projectId: string, input: { textProvider: string; textModel: string }) => requestJson<{ textProvider: string; textModel: string }>(`/content/projects/${encodeURIComponent(projectId)}/model-route`, { method: "PATCH", body: JSON.stringify(input) }),
  updateChapter: (projectId: string, chapterNo: number, input: { title?: string; content: string }) =>
    requestJson<ContentProductionPackage>(`/content/projects/${encodeURIComponent(projectId)}/chapters/${chapterNo}`, { method: "PATCH", body: JSON.stringify(input) }),
  generateChapters: (projectId: string, input: { startChapter: number; batchSize: number; regenerate?: boolean }) =>
    requestJson<ContentProductionPackage>(`/content/projects/${encodeURIComponent(projectId)}/chapters/generate`, { method: "POST", body: JSON.stringify(input) }),
  deleteProject: (projectId: string) => requestJson<void>(`/content/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" })
};
