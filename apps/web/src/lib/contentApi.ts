import type { ContentProductionPackage, ContentProjectMode, ContentProjectSummary, StyleProfile } from "@aifilm/shared";
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

export const contentApi = {
  projects: () => requestJson<ContentProjectSummary[]>("/content/projects"),
  createProject: (input: { title: string; mode: ContentProjectMode; styleProfile?: StyleProfile }) =>
    requestJson<ContentProjectSummary>("/content/projects", { method: "POST", body: JSON.stringify(input) }),
  addSource: (projectId: string, input: SourceDocumentInput) =>
    requestJson<SourceDocumentResult>(`/content/projects/${encodeURIComponent(projectId)}/sources`, { method: "POST", body: JSON.stringify(input) }),
  productionPackage: (projectId: string) => requestJson<ContentProductionPackage>(`/content/projects/${encodeURIComponent(projectId)}/package`),
  generatePackage: (projectId: string) => requestJson<ContentProductionPackage>(`/content/projects/${encodeURIComponent(projectId)}/generate`, { method: "POST" }),
  develop: (projectId: string, input: { intentType: "title" | "genre" | "references"; intent: string; targetWords: number; chapterCount: number; batchSize: number }) =>
    requestJson<ContentProductionPackage>(`/content/projects/${encodeURIComponent(projectId)}/develop`, { method: "POST", body: JSON.stringify(input) }),
  deleteProject: (projectId: string) => requestJson<void>(`/content/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" })
};
