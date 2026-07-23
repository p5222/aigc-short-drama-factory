import { ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, CircleAlert, FileText, LoaderCircle, Plus, RefreshCw, Sparkles, UsersRound, Clapperboard, Map } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentProductionPackage, ContentProjectMode, ContentProjectSummary, CreateProjectInput, StyleProfile } from "@aifilm/shared";
import { contentApi, type SourceDocumentInput } from "../lib/contentApi";
import { buildProductionDraft, contentSteps, creationModes, isCurrentRequest, modeLabel, reconcileProjectId, sourceKindForMode, statusLabel, type RequestToken } from "./model";

const emptyStyle: StyleProfile = { key: "", name: "", category: "", summary: "", characterRules: [], sceneRules: [], lightingRules: [], cameraRules: [], materialRules: [], negativeRules: [] };
const styleOptions: Array<Pick<StyleProfile, "key" | "name" | "category" | "summary">> = [
  { key: "donghua_3d", name: "3D古风玄幻国漫", category: "国漫 · 3D", summary: "角色建模精致，东方美学，柔和光影" },
  { key: "anime_jp", name: "日系动漫（标准）", category: "动漫 · 2D", summary: "赛璐珞上色，线条清晰，五官精致" },
  { key: "cinematic_real", name: "电影质感写实", category: "写实 · 影视", summary: "电影级调色，光影氛围浓厚" },
  { key: "semi_real", name: "拟真人/半写实风", category: "写实 · 漫画", summary: "保留真人辨识度与动漫美化" },
  { key: "dark_paint", name: "暗黑厚涂风", category: "实验 · 氛围", summary: "强烈明暗对比，适合悬疑与暗黑题材" }
];

function chapterize(content: string) {
  const matches = [...content.matchAll(/(^|\n)\s*(第[一二三四五六七八九十百0-9]+章[^\n]*|Chapter\s+\d+[^\n]*)/gi)];
  if (!matches.length) return [{ title: "正文", content }];
  return matches.map((match, index) => ({ title: match[2].trim(), content: content.slice(match.index! + match[0].length, matches[index + 1]?.index ?? content.length).trim() }));
}

interface ContentWorkspaceProps {
  initialProjects: ContentProjectSummary[];
  onReload: () => Promise<ContentProjectSummary[]>;
  onEnterProduction: (draft: CreateProjectInput & { contentProjectId?: string }) => void;
}

export function ContentWorkspace({ initialProjects, onReload, onEnterProduction }: ContentWorkspaceProps) {
  const [projects, setProjects] = useState(initialProjects);
  const [selectedId, setSelectedId] = useState(() => reconcileProjectId(initialProjects));
  const [creating, setCreating] = useState(initialProjects.length === 0);
  const [createMode, setCreateMode] = useState<ContentProjectMode>("original");
  const [createTitle, setCreateTitle] = useState("");
  const [createStyle, setCreateStyle] = useState(styleOptions[0]);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [tab, setTab] = useState<"input" | "output" | "diff">("input");
  const [busy, setBusy] = useState<"create" | "save" | "generate" | "refresh" | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savedSources, setSavedSources] = useState<Record<string, { title: string; content: string }>>({});
  const [packages, setPackages] = useState<Record<string, ContentProductionPackage>>({});
  const requestSequence = useRef(0);
  const activeRequest = useRef<RequestToken | null>(null);
  const selected = projects.find((project) => project.id === selectedId);

  useEffect(() => setSelectedId((current) => reconcileProjectId(projects, current)), [projects]);
  useEffect(() => {
    activeRequest.current = null;
    setBusy((current) => current === "save" ? "" : current);
    setMessage(""); setError(""); setSourceTitle(""); setSourceContent(""); setTab("input");
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void contentApi.productionPackage(selectedId).then((result) => {
      if (!active) return;
      setPackages((current) => ({ ...current, [selectedId]: result }));
      if (result.source) {
        setSavedSources((current) => ({ ...current, [selectedId]: { title: result.source!.title, content: result.source!.content } }));
        setSourceTitle(result.source.title);
        setSourceContent(result.source.content);
      }
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : "内容详情加载失败"));
    return () => { active = false; };
  }, [selectedId]);

  async function refresh() {
    setBusy("refresh"); setError("");
    try { setProjects(await onReload()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "刷新失败"); }
    finally { setBusy(""); }
  }

  async function createProject() {
    if (!createTitle.trim()) return;
    setBusy("create"); setError("");
    try {
      const created = await contentApi.createProject({ title: createTitle.trim(), mode: createMode, styleProfile: { ...emptyStyle, ...createStyle } });
      setProjects((current) => [created, ...current]); setSelectedId(created.id); setCreating(false); setCreateTitle(""); setMessage("内容项目已创建");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建失败"); }
    finally { setBusy(""); }
  }

  async function saveSource() {
    if (!selected || !sourceTitle.trim() || !sourceContent.trim()) return;
    const token = { projectId: selected.id, sequence: ++requestSequence.current };
    activeRequest.current = token; setBusy("save"); setError(""); setMessage("");
    const input: SourceDocumentInput = { kind: sourceKindForMode(selected.mode), title: sourceTitle.trim(), content: sourceContent };
    try {
      await contentApi.addSource(selected.id, input);
      if (!isCurrentRequest(activeRequest.current, token)) return;
      const next = await onReload();
      if (!isCurrentRequest(activeRequest.current, token)) return;
      setSavedSources((current) => ({ ...current, [selected.id]: { title: sourceTitle.trim(), content: sourceContent } }));
      setPackages((current) => ({ ...current, [selected.id]: { projectId: selected.id, source: { id: "pending-refresh", kind: input.kind, title: input.title, content: input.content, updatedAt: new Date().toISOString() } } }));
      setProjects(next); setMessage("素材已保存，可以生成剧本与实体");
    } catch (reason) { if (isCurrentRequest(activeRequest.current, token)) setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { if (isCurrentRequest(activeRequest.current, token)) { activeRequest.current = null; setBusy(""); } }
  }

  const completedStepIndex = selected ? contentSteps.findIndex((step) => step.id === selected.activeStep) : 0;
  const wordCount = useMemo(() => sourceContent.replace(/\s/g, "").length, [sourceContent]);
  const handoffSource = selected ? savedSources[selected.id] : undefined;
  const productionPackage = selected ? packages[selected.id] : undefined;
  const handoffContent = productionPackage?.script?.content.trim() || "";

  async function generatePackage() {
    if (!selected || busy) return;
    setBusy("generate"); setError(""); setMessage("正在按素材生成剧本并提取人物、场景实体…");
    try {
      const result = await contentApi.generatePackage(selected.id);
      setPackages((current) => ({ ...current, [selected.id]: result }));
      setProjects(await onReload());
      setTab("output");
      setMessage("剧本与实体已生成，可以进入漫剧创作");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "内容生成失败"); }
    finally { setBusy(""); }
  }

  function enterProduction() {
    if (!selected || !handoffContent) return;
    onEnterProduction(buildProductionDraft(selected, handoffContent));
  }

  return <div className="content-workspace">
    <header className="content-header">
      <div><span className="content-eyebrow">CONTENT STUDIO</span><h1>{selected?.title || "内容创作"}</h1></div>
      <div className="content-flow" aria-label="创作流程">{contentSteps.map((step, index) => <span key={step.id} className={index === completedStepIndex ? "is-current" : index < completedStepIndex ? "is-done" : ""}>{index < completedStepIndex ? <Check size={13} /> : null}{step.label}</span>)}</div>
      <div className="content-header-actions"><span className={`content-save-state ${busy || selected?.status === "running" ? "is-running" : error ? "is-failed" : ""}`}>{busy ? <LoaderCircle size={14} /> : error ? <CircleAlert size={14} /> : <Check size={14} />}{busy ? "处理中" : error ? "操作失败" : message ? "已保存" : statusLabel(selected?.status ?? "draft")}</span><button type="button" className="content-icon-button" onClick={() => void refresh()} aria-label="刷新" title="刷新"><RefreshCw size={17} /></button></div>
    </header>

    <aside className="content-rail">
      <div className="content-panel-title"><div><strong>作品与版本</strong><small>{projects.length} 个内容项目</small></div><button type="button" className="content-icon-button" onClick={() => setCreating(true)} aria-label="新建内容项目" title="新建"><Plus size={17} /></button></div>
      <div className="content-project-list">{projects.map((project) => <button key={project.id} type="button" className={project.id === selectedId ? "is-active" : ""} onClick={() => setSelectedId(project.id)}><span className="content-project-icon"><BookOpen size={16} /></span><span><strong>{project.title}</strong><small>{modeLabel(project.mode)} · {statusLabel(project.status)}</small></span><ChevronRight size={15} /></button>)}</div>
      {selected ? <section className="content-structure"><h2>章节与版本</h2><dl><div><dt>素材</dt><dd>{selected.sourceCount}</dd></div><div><dt>章节</dt><dd>{selected.chapterCount}</dd></div><div><dt>剧本</dt><dd>{selected.scriptCount}</dd></div></dl><p>当前 API 暂未提供章节和历史版本详情。</p></section> : null}
    </aside>

    <main className="content-editor">
      {creating ? <section className="content-create"><div><span className="content-eyebrow">NEW STORY</span><h2>选择创作方式</h2><p>创建后先录入真实素材，再逐步推进分析、策略、大纲和剧本。</p></div><div className="content-mode-grid">{creationModes.map((mode) => <button type="button" key={mode.id} className={createMode === mode.id ? "is-active" : ""} onClick={() => setCreateMode(mode.id)}><Sparkles size={18} /><strong>{mode.label}</strong><span>{mode.description}</span></button>)}</div><label><span>作品名称</span><input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} maxLength={160} placeholder="输入作品名称" autoFocus /></label><div className="content-inline-actions"><button type="button" className="content-secondary-button" onClick={() => setCreating(false)} disabled={!projects.length}>取消</button><button type="button" className="content-primary-button" disabled={!createTitle.trim() || busy === "create"} onClick={() => void createProject()}>{busy === "create" ? <LoaderCircle size={16} /> : <Plus size={16} />}创建项目</button></div></section> : selected ? <>
        <nav className="content-editor-tabs" aria-label="编辑视图">{(["input", "output", "diff"] as const).map((item) => <button type="button" key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item === "input" ? "素材原文" : item === "output" ? "步骤输出" : "版本差异"}</button>)}</nav>
        {tab === "input" ? <section className="content-document"><div className="content-document-head"><div><span>{modeLabel(selected.mode)}</span><h2>添加创作素材</h2></div><small>{wordCount.toLocaleString()} 字</small></div><label><span>素材标题</span><input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} maxLength={160} placeholder={selected.mode === "adaptation" ? "例如：原著第一卷" : "例如：故事核心设定"} /></label><label className="content-writing-field"><span>素材正文</span><textarea value={sourceContent} onChange={(event) => setSourceContent(event.target.value)} maxLength={500000} placeholder={selected.mode === "same_genre" ? "粘贴参考作品或结构素材…" : selected.mode === "adaptation" ? "粘贴需要改编的小说正文…" : "写下人物、冲突、世界观或故事灵感…"} /></label><div className="content-inline-actions"><span>{message || error}</span><button type="button" className="content-secondary-button" disabled={!handoffSource?.content || Boolean(busy)} onClick={() => void generatePackage()}>{busy === "generate" ? <LoaderCircle size={16} /> : <Sparkles size={16} />}{productionPackage?.script ? "重新生成剧本" : "生成剧本与实体"}</button><button type="button" className="content-primary-button" disabled={!sourceTitle.trim() || !sourceContent.trim() || busy === "save"} onClick={() => void saveSource()}>{busy === "save" ? <LoaderCircle size={16} /> : <FileText size={16} />}保存素材</button></div></section> : tab === "output" ? <ContentPackageOutput value={productionPackage} onGenerate={() => void generatePackage()} busy={busy === "generate"} /> : <section className="content-unavailable"><FileText size={28} /><h2>暂无可比较版本</h2><p>生成第二版剧本后，这里将展示逐段差异；当前不会伪造版本内容。</p></section>}
      </> : <section className="content-unavailable"><BookOpen size={30} /><h2>创建第一个内容项目</h2><p>选择一种创作方式开始。</p><button type="button" className="content-primary-button" onClick={() => setCreating(true)}><Plus size={16} />新建项目</button></section>}
    </main>

    <aside className="content-inspector">
      {creating ? <label className="content-style-select"><span>视觉风格（用于后续分镜）</span><select value={createStyle.key} onChange={(event) => setCreateStyle(styleOptions.find((item) => item.key === event.target.value) ?? styleOptions[0])}>{styleOptions.map((style) => <option key={style.key} value={style.key}>{style.name} · {style.category}</option>)}</select><small>{createStyle.summary}</small></label> : null}
      <div className="content-panel-title"><div><strong>配置与评测</strong><small>跟随当前内容步骤</small></div></div>
      {selected ? <>
        <section><h2>当前配置</h2><dl className="content-meta"><div><dt>创作模式</dt><dd>{modeLabel(selected.mode)}</dd></div><div><dt>当前步骤</dt><dd>{contentSteps.find((step) => step.id === selected.activeStep)?.label}</dd></div><div><dt>内容风格</dt><dd>{selected.styleProfile?.name || "AI 自动匹配"}</dd></div></dl></section>
        <section><h2>质量建议</h2><div className="content-evaluation-empty"><CircleAlert size={18} /><p>评测用于提示后续优化方向，不会阻止当前内容进入制作。</p></div></section>
        <section className="content-handoff"><div className="content-handoff-title"><div><span>制作交接</span><h2>进入漫剧创作</h2></div><Clapperboard size={20} /></div><p>自动带入已生成剧本、作品名称与视觉风格，不需要再次粘贴。</p><div className="content-handoff-list"><span><FileText size={15} /><b>剧本内容</b><em>{handoffContent ? "已就绪" : "待生成"}</em></span><span><UsersRound size={15} /><b>角色实体</b><em>{productionPackage?.entities?.characters.length ? `${productionPackage.entities.characters.length} 个` : "待提取"}</em></span><span><Map size={15} /><b>场景信息</b><em>{productionPackage?.entities?.scenes.length ? `${productionPackage.entities.scenes.length} 个` : "待提取"}</em></span><span><Sparkles size={15} /><b>视觉风格</b><em>{selected.styleProfile?.name || "自动匹配"}</em></span></div><button type="button" className="content-primary-button content-handoff-button" disabled={!handoffContent} onClick={enterProduction}><span>进入漫剧创作</span><ArrowRight size={17} /></button>{!handoffContent ? <small>先生成剧本与实体后即可交接。</small> : <small><CheckCircle2 size={13} />交接后仍可返回这里继续修改内容。</small>}</section>
      </> : <p className="content-muted">选择项目后查看配置。</p>}
    </aside>
  </div>;
}

function ContentPackageOutput({ value, onGenerate, busy }: { value?: ContentProductionPackage; onGenerate: () => void; busy: boolean }) {
  if (!value?.script) return <section className="content-unavailable"><FileText size={28} /><h2>还没有生成剧本</h2><p>保存素材后，系统会根据小说或剧本类型生成可生产剧本并提取真实实体。</p><button type="button" className="content-primary-button" disabled={!value?.source || busy} onClick={onGenerate}>{busy ? <LoaderCircle size={16} /> : <Sparkles size={16} />}生成剧本与实体</button></section>;
  return <section className="content-package-output"><header><div><span>剧本 v{value.script.version}</span><h2>可生产剧本</h2></div><em>{value.script.status === "confirmed" ? "已确认" : statusLabel(value.script.status)}</em></header><pre>{value.script.content}</pre><div className="content-entity-summary"><article><UsersRound size={18} /><strong>{value.entities?.characters.length ?? 0}</strong><span>人物</span></article><article><Map size={18} /><strong>{value.entities?.scenes.length ?? 0}</strong><span>场景</span></article><article><Sparkles size={18} /><strong>{value.entities?.props.length ?? 0}</strong><span>道具</span></article></div></section>;
}
