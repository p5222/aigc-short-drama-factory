import type { ContentProjectMode, ContentProjectSummary, StyleProfile } from "@aifilm/shared";

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("aifilm_auth_token");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) localStorage.removeItem("aifilm_auth_token");
    try { throw new Error((JSON.parse(body) as { message?: string }).message || `请求失败（${response.status}）`); }
    catch (error) { if (error instanceof SyntaxError) throw new Error(body || `请求失败（${response.status}）`); throw error; }
  }
  return response.json() as Promise<T>;
}

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
  projects: () => request<ContentProjectSummary[]>("/content/projects"),
  createProject: (input: { title: string; mode: ContentProjectMode; styleProfile?: StyleProfile }) =>
    request<ContentProjectSummary>("/content/projects", { method: "POST", body: JSON.stringify(input) }),
  addSource: (projectId: string, input: SourceDocumentInput) =>
    request<SourceDocumentResult>(`/content/projects/${encodeURIComponent(projectId)}/sources`, { method: "POST", body: JSON.stringify(input) })
};
