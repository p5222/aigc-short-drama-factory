import { ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, CircleAlert, FileText, LoaderCircle, Plus, RefreshCw, Sparkles, UsersRound, Clapperboard, Map } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentProductionPackage, ContentProjectSummary, CreateProjectInput, StyleProfile } from "@aifilm/shared";
import { contentApi, type SourceDocumentInput } from "../lib/contentApi";
import { buildProductionDraft, contentSteps, isCurrentRequest, modeLabel, reconcileProjectId, sourceKindForMode, statusLabel, type RequestToken } from "./model";

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
  const [createTitle, setCreateTitle] = useState("");
  const [createStyle, setCreateStyle] = useState(styleOptions[0]);
  const [intentType, setIntentType] = useState<"title" | "genre" | "references">("title");
  const [targetWords, setTargetWords] = useState(20000);
  const [chapterCount, setChapterCount] = useState(10);
  const [batchSize, setBatchSize] = useState(2);
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
      const intent = createTitle.trim();
      const created = await contentApi.createProject({ title: intent.slice(0, 80), mode: "same_genre", styleProfile: { ...emptyStyle, ...createStyle } });
      setProjects((current) => [created, ...current]); setSelectedId(created.id);
      const result = await contentApi.develop(created.id, { intentType, intent, targetWords, chapterCount, batchSize });
      setPackages((current) => ({ ...current, [created.id]: result }));
      setProjects(await onReload()); setCreating(false); setTab("output"); setCreateTitle(""); setMessage("爆款分析与章节大纲已生成");
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
      {creating ? <ContentCreationIntent intent={createTitle} intentType={intentType} targetWords={targetWords} chapterCount={chapterCount} batchSize={batchSize} busy={busy === "create"} canCancel={Boolean(projects.length)} onIntentChange={setCreateTitle} onIntentTypeChange={setIntentType} onTargetWordsChange={setTargetWords} onChapterCountChange={setChapterCount} onBatchSizeChange={setBatchSize} onCancel={() => setCreating(false)} onSubmit={() => void createProject()} /> : selected ? <>
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

function ContentCreationIntent({ intent, intentType, targetWords, chapterCount, batchSize, busy, canCancel, onIntentChange, onIntentTypeChange, onTargetWordsChange, onChapterCountChange, onBatchSizeChange, onCancel, onSubmit }: {
  intent: string;
  intentType: "title" | "genre" | "references";
  targetWords: number;
  chapterCount: number;
  batchSize: number;
  busy: boolean;
  canCancel: boolean;
  onIntentChange: (value: string) => void;
  onIntentTypeChange: (value: "title" | "genre" | "references") => void;
  onTargetWordsChange: (value: number) => void;
  onChapterCountChange: (value: number) => void;
  onBatchSizeChange: (value: number) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const options = [
    { id: "title" as const, label: "已有标题", hint: "输入已定好的小说名或剧本名" },
    { id: "genre" as const, label: "题材方向", hint: "输入都市重生、古风玄幻等方向" },
    { id: "references" as const, label: "参考作品", hint: "输入 1-3 个想参考的作品名" }
  ];
  const placeholder = intentType === "title" ? "例如：替嫁后我成了首辅白月光" : intentType === "genre" ? "例如：都市重生、女频复仇、强爽点短篇" : "例如：《作品A》《作品B》《作品C》";
  return <section className="content-intent-workspace">
    <header><span className="content-eyebrow">STEP 1 · 创作意图</span><h2>你想创作什么内容？</h2><p>选择一种输入方式。系统会识别方向、推荐或确认三部同类爆款，再进入四维拆解。</p></header>
    <div className="content-intent-modes">{options.map((option) => <button type="button" key={option.id} className={intentType === option.id ? "is-active" : ""} onClick={() => onIntentTypeChange(option.id)}><strong>{option.label}</strong><span>{option.hint}</span></button>)}</div>
    <label className="content-intent-input"><span>{options.find((item) => item.id === intentType)?.label}</span><textarea value={intent} onChange={(event) => onIntentChange(event.target.value)} maxLength={2000} placeholder={placeholder} autoFocus /><small>{intent.length}/2000</small></label>
    <div className="content-plan-controls"><label><span>目标字数</span><select value={targetWords} onChange={(event) => onTargetWordsChange(Number(event.target.value))}><option value={10000}>10000 字</option><option value={20000}>20000 字</option><option value={30000}>30000 字</option><option value={50000}>50000 字</option></select></label><label><span>章节数量</span><select value={chapterCount} onChange={(event) => onChapterCountChange(Number(event.target.value))}><option value={5}>5 章</option><option value={10}>10 章</option><option value={15}>15 章</option><option value={20}>20 章</option></select></label><label><span>每批生成</span><select value={batchSize} onChange={(event) => onBatchSizeChange(Number(event.target.value))}><option value={2}>2 章</option><option value={3}>3 章</option></select></label></div>
    <div className="content-flow-preview"><b>接下来</b><span>3 个爆款候选</span><ChevronRight size={14} /><span>开头 / 高潮 / 反转 / 爽点</span><ChevronRight size={14} /><span>{chapterCount} 章大纲</span><ChevronRight size={14} /><span>每批 {batchSize} 章正文</span></div>
    <div className="content-inline-actions"><button type="button" className="content-secondary-button" onClick={onCancel} disabled={!canCancel || busy}>取消</button><button type="button" className="content-primary-button" disabled={intent.trim().length < 2 || busy} onClick={onSubmit}>{busy ? <LoaderCircle size={16} /> : <Sparkles size={16} />}{busy ? "正在分析并生成大纲" : "识别并推荐爆款"}</button></div>
  </section>;
}

function ContentPackageOutput({ value, onGenerate, busy }: { value?: ContentProductionPackage; onGenerate: () => void; busy: boolean }) {
  if (value?.analysis && value.outline && !value.script) {
    const mechanisms = Array.isArray(value.analysis.result.commonMechanisms) ? value.analysis.result.commonMechanisms : [];
    const outline = Array.isArray(value.outline.result.outline) ? value.outline.result.outline : [];
    return <section className="content-plan-output"><header><div><span>爆款拆解 v{value.analysis.version}</span><h2>分析完成，等待确认章节大纲</h2></div><em>已同步后台</em></header><div className="content-analysis-grid"><article><b>爆款开头</b><p>{String(mechanisms[0] ?? "模型已完成开头机制分析")}</p></article><article><b>高潮</b><p>{String(mechanisms[1] ?? "模型已完成高潮机制分析")}</p></article><article><b>反转</b><p>{String(mechanisms[2] ?? "模型已完成反转机制分析")}</p></article><article><b>爽点</b><p>{String(mechanisms[3] ?? "模型已完成爽点机制分析")}</p></article></div><div className="content-outline-list"><h3>章节大纲 · {outline.length || Number(value.outline.result.chapterCount ?? 0)} 章</h3>{outline.map((item, index) => <article key={index}><b>{String(index + 1).padStart(2, "0")}</b><span>{typeof item === "string" ? item : JSON.stringify(item)}</span></article>)}</div></section>;
  }
  if (!value?.script) return <section className="content-unavailable"><FileText size={28} /><h2>还没有生成剧本</h2><p>保存素材后，系统会根据小说或剧本类型生成可生产剧本并提取真实实体。</p><button type="button" className="content-primary-button" disabled={!value?.source || busy} onClick={onGenerate}>{busy ? <LoaderCircle size={16} /> : <Sparkles size={16} />}生成剧本与实体</button></section>;
  return <section className="content-package-output"><header><div><span>剧本 v{value.script.version}</span><h2>可生产剧本</h2></div><em>{value.script.status === "confirmed" ? "已确认" : statusLabel(value.script.status)}</em></header><pre>{value.script.content}</pre><div className="content-entity-summary"><article><UsersRound size={18} /><strong>{value.entities?.characters.length ?? 0}</strong><span>人物</span></article><article><Map size={18} /><strong>{value.entities?.scenes.length ?? 0}</strong><span>场景</span></article><article><Sparkles size={18} /><strong>{value.entities?.props.length ?? 0}</strong><span>道具</span></article></div></section>;
}
