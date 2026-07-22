import { useEffect, useState } from "react";
import type { ContentProjectSummary, CreateProjectInput } from "@aifilm/shared";
import { ContentWorkspace } from "../content/ContentWorkspace";
import { contentApi } from "../lib/contentApi";
import "../content/content.css";

export function ContentCreatorPage({ onEnterProduction }: { onEnterProduction: (draft: CreateProjectInput & { contentProjectId?: string }) => void }) {
  const [projects, setProjects] = useState<ContentProjectSummary[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const next = await contentApi.projects();
    setProjects(next);
    return next;
  }

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "内容项目加载失败")); }, []);

  if (error && !projects) return <main className="content-page-state"><h1>内容创作暂时无法加载</h1><p>{error}</p><button type="button" onClick={() => { setError(""); void load().catch((reason) => setError(reason instanceof Error ? reason.message : "加载失败")); }}>重新加载</button></main>;
  if (!projects) return <main className="content-page-state" aria-busy="true"><p>正在加载内容项目…</p></main>;
  return <ContentWorkspace initialProjects={projects} onReload={load} onEnterProduction={onEnterProduction} />;
}

export default ContentCreatorPage;
