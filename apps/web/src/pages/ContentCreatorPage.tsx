import { useEffect, useRef, useState } from "react";
import type { ContentProjectSummary, ModelPrice, ModelProvider } from "@aifilm/shared";
import { ContentWorkspace } from "../content/ContentWorkspace";
import { contentApi } from "../lib/contentApi";
import { StatePanel } from "../design-system/ui";
import { ShortCreatorStudio } from "../content/ShortCreatorStudio";
import "../content/content.css";

export function ContentCreatorPage({ userId, onSelect, providers, modelPrices, initialSelectedId, onProjectsChange, onBack, onEnterProduction }: { userId: string; onSelect: (id: string) => void; providers: ModelProvider[]; modelPrices: ModelPrice[]; initialSelectedId?: string; onProjectsChange?: (projects: ContentProjectSummary[]) => void; onBack?: () => void; onEnterProduction: (projectId: string) => void | Promise<void> }) {
  const [projects, setProjects] = useState<ContentProjectSummary[] | null>(null);
  const [error, setError] = useState("");
  const initialSelectionFound = useRef(false);

  async function load() {
    const next = await contentApi.projects();
    if (!initialSelectedId || initialSelectedId === "__new__" || initialSelectedId.startsWith("__short") || next.some(project => project.id === initialSelectedId)) initialSelectionFound.current = true;
    setProjects(next);
    return next;
  }

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "内容项目加载失败")); }, []);

  if (error && !projects) return <main className="content-page-state"><StatePanel kind="error" title="内容创作暂时无法加载" description={error} action={<button type="button" className="primary-button" onClick={() => { setError(""); void load().catch((reason) => setError(reason instanceof Error ? reason.message : "加载失败")); }}>重新加载</button>} /></main>;
  if (!projects) return <main className="content-page-state"><StatePanel kind="loading" title="正在加载内容项目" description="正在读取已保存的内容和版本。" /></main>;
  if (!initialSelectionFound.current) return <main className="content-page-state"><StatePanel kind="error" title="找不到这个内容项目" description="项目可能已被删除，或当前账号没有访问权限。" action={<button type="button" className="ghost-button" onClick={onBack}>返回作品列表</button>} /></main>;
  const selected = projects.find(project => project.id === initialSelectedId);
  if (initialSelectedId?.startsWith("__short") || selected?.brief) return <ShortCreatorStudio userId={userId} project={selected} entry={initialSelectedId === "__short_sample__" ? "sample" : initialSelectedId === "__short_story__" ? "story" : "idea"} providers={providers} modelPrices={modelPrices} onBack={onBack} onSelect={onSelect} onEnterProduction={onEnterProduction} onReload={async () => { onProjectsChange?.(await load()); }} />;
  return <ContentWorkspace initialProjects={projects} initialSelectedId={initialSelectedId === "__new__" ? undefined : initialSelectedId} startBlank={initialSelectedId === "__new__"} providers={providers} modelPrices={modelPrices} onReload={load} onProjectsChange={onProjectsChange} onBack={onBack} onEnterProduction={onEnterProduction} />;
}

export default ContentCreatorPage;
