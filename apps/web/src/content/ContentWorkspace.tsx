import { ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, CircleAlert, FileText, LoaderCircle, Plus, RefreshCw, Sparkles, UsersRound, Clapperboard, Map, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentProductionPackage, ContentProjectSummary, CreateProjectInput, ModelProvider, StyleProfile } from "@aifilm/shared";
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
  providers: ModelProvider[];
  onReload: () => Promise<ContentProjectSummary[]>;
  onEnterProduction: (draft: CreateProjectInput & { contentProjectId?: string }) => void;
}

export function ContentWorkspace({ initialProjects, providers, onReload, onEnterProduction }: ContentWorkspaceProps) {
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
  const [failedProjectId, setFailedProjectId] = useState("");
  const [savedSources, setSavedSources] = useState<Record<string, { title: string; content: string }>>({});
  const [packages, setPackages] = useState<Record<string, ContentProductionPackage>>({});
  const requestSequence = useRef(0);
  const activeRequest = useRef<RequestToken | null>(null);
  const selected = projects.find((project) => project.id === selectedId);
  const textProviders = providers.filter((provider) => provider.modality === "text" && provider.enabled);

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
    let createdId = "";
    try {
      const intent = createTitle.trim();
      const created = await contentApi.createProject({ title: intent.slice(0, 80), mode: "same_genre", styleProfile: { ...emptyStyle, ...createStyle }, textProvider: "manjiao", textModel: "gpt-5.5" });
      createdId = created.id;
      const result = await contentApi.analyze(created.id, { intentType, intent, targetWords, chapterCount, batchSize });
      setPackages((current) => ({ ...current, [created.id]: result }));
      setSelectedId(created.id); setProjects(await onReload()); setCreating(false); setTab("output"); setMessage("结构拆解已完成，请继续生成大纲");
    } catch (reason) {
      setProjects(await onReload().catch(() => projects));
      if (createdId) { setFailedProjectId(createdId); setSelectedId(createdId); }
      setError(reason instanceof Error ? reason.message : "创建失败");
    }
    finally { setBusy(""); }
  }

  async function retryDevelop() {
    if (!failedProjectId || busy) return;
    setBusy("create"); setError(""); setMessage("正在重试当前创作阶段...");
    try {
      const result = await contentApi.analyze(failedProjectId, { intentType, intent: createTitle.trim(), targetWords, chapterCount, batchSize });
      setPackages((current) => ({ ...current, [failedProjectId]: result }));
      setProjects(await onReload()); setSelectedId(failedProjectId); setFailedProjectId(""); setCreating(false); setTab("output"); setMessage("结构拆解已完成");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "重试失败"); }
    finally { setBusy(""); }
  }

  async function removeContentProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project || !window.confirm(`确认删除“${project.title}”？分析、大纲、章节和版本都会删除。`)) return;
    try {
      await contentApi.deleteProject(projectId);
      setPackages((current) => { const next = { ...current }; delete next[projectId]; return next; });
      setSavedSources((current) => { const next = { ...current }; delete next[projectId]; return next; });
      setProjects(await onReload());
      if (selectedId === projectId) setSelectedId("");
      setMessage("内容项目已删除");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); }
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

  async function generateNextChapters() {
    if (!selected || busy) return;
    const nextChapter = Math.max(0, ...(productionPackage?.chapters ?? []).map((chapter) => chapter.chapterNo)) + 1;
    setBusy("generate"); setError(""); setMessage(`正在生成第 ${nextChapter} 章起的正文`);
    try {
      const result = await contentApi.generateChapters(selected.id, { startChapter: nextChapter, batchSize });
      setPackages((current) => ({ ...current, [selected.id]: result }));
      setProjects(await onReload()); setTab("output"); setMessage("新一批章节正文已生成");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "章节生成失败"); }
    finally { setBusy(""); }
  }

  async function generateOutline() {
    if (!selected || busy) return;
    setBusy("generate"); setError(""); setMessage("正在根据结构拆解生成章节大纲...");
    try {
      const result = await contentApi.generateOutline(selected.id);
      setPackages((current) => ({ ...current, [selected.id]: result }));
      setProjects(await onReload()); setTab("output"); setMessage("大纲已生成，可以编辑后确认");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "大纲生成失败"); }
    finally { setBusy(""); }
  }

  async function confirmOutlineAndGenerate(result: Record<string, unknown>) {
    if (!selected || busy) return;
    setBusy("generate"); setError(""); setMessage(`正在确认大纲并生成第 1-${batchSize} 章...`);
    try {
      await contentApi.confirmOutline(selected.id, result);
      const generated = await contentApi.generateChapters(selected.id, { startChapter: 1, batchSize });
      setPackages((current) => ({ ...current, [selected.id]: generated }));
      setProjects(await onReload()); setTab("output"); setMessage("大纲已确认，首批正文已生成");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "大纲确认或正文生成失败"); }
    finally { setBusy(""); }
  }

  async function changeModelRoute(textProvider: string, textModel: string) {
    if (!selected || busy) return;
    setBusy("save"); setError("");
    try {
      await contentApi.updateModelRoute(selected.id, { textProvider, textModel });
      setProjects(await onReload()); setMessage(`模型已切换为 ${textModel}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "模型切换失败"); }
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
      <div className="content-project-list">{projects.map((project) => <div key={project.id} className={`content-project-row ${project.id === selectedId ? "is-active" : ""}`}><button type="button" onClick={() => setSelectedId(project.id)}><span className="content-project-icon"><BookOpen size={16} /></span><span><strong>{project.title}</strong><small>{modeLabel(project.mode)} · {statusLabel(project.status)}</small></span><ChevronRight size={15} /></button><button type="button" className="content-project-delete" title="删除内容项目" aria-label={`删除 ${project.title}`} onClick={() => void removeContentProject(project.id)}><Trash2 size={14} /></button></div>)}</div>
      {selected ? <section className="content-structure"><h2>章节与版本</h2><dl><div><dt>素材</dt><dd>{selected.sourceCount}</dd></div><div><dt>章节</dt><dd>{selected.chapterCount}</dd></div><div><dt>剧本</dt><dd>{selected.scriptCount}</dd></div></dl><p>当前 API 暂未提供章节和历史版本详情。</p></section> : null}
    </aside>

    <main className="content-editor">
      {creating ? <><ContentCreationIntent intent={createTitle} intentType={intentType} targetWords={targetWords} chapterCount={chapterCount} batchSize={batchSize} busy={busy === "create"} canCancel={Boolean(projects.length)} onIntentChange={setCreateTitle} onIntentTypeChange={setIntentType} onTargetWordsChange={setTargetWords} onChapterCountChange={setChapterCount} onBatchSizeChange={setBatchSize} onCancel={() => setCreating(false)} onSubmit={() => void createProject()} />{error ? <div className="content-creation-error" role="alert"><CircleAlert size={17} /><div><strong>创作流程中断，项目已保留</strong><p>{error}</p><small>可以重试当前阶段，或删除这个失败项目后重新开始。</small><div className="content-inline-actions"><button type="button" className="content-secondary-button" onClick={() => void retryDevelop()} disabled={!failedProjectId || Boolean(busy)}><RefreshCw size={15} />重试当前阶段</button><button type="button" className="content-secondary-button" onClick={() => failedProjectId && void removeContentProject(failedProjectId)} disabled={!failedProjectId || Boolean(busy)}><Trash2 size={15} />删除失败项目</button></div></div></div> : null}</> : selected ? <>
        <nav className="content-editor-tabs" aria-label="编辑视图">{(["input", "output", "diff"] as const).map((item) => <button type="button" key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item === "input" ? "素材原文" : item === "output" ? "步骤输出" : "版本差异"}</button>)}</nav>
        {tab === "input" ? <section className="content-document"><div className="content-document-head"><div><span>{modeLabel(selected.mode)}</span><h2>添加创作素材</h2></div><small>{wordCount.toLocaleString()} 字</small></div><label><span>素材标题</span><input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} maxLength={160} placeholder={selected.mode === "adaptation" ? "例如：原著第一卷" : "例如：故事核心设定"} /></label><label className="content-writing-field"><span>素材正文</span><textarea value={sourceContent} onChange={(event) => setSourceContent(event.target.value)} maxLength={500000} placeholder={selected.mode === "same_genre" ? "粘贴参考作品或结构素材…" : selected.mode === "adaptation" ? "粘贴需要改编的小说正文…" : "写下人物、冲突、世界观或故事灵感…"} /></label><div className="content-inline-actions"><span>{message || error}</span><button type="button" className="content-secondary-button" disabled={!handoffSource?.content || Boolean(busy)} onClick={() => void generatePackage()}>{busy === "generate" ? <LoaderCircle size={16} /> : <Sparkles size={16} />}{productionPackage?.script ? "重新生成剧本" : "生成剧本与实体"}</button><button type="button" className="content-primary-button" disabled={!sourceTitle.trim() || !sourceContent.trim() || busy === "save"} onClick={() => void saveSource()}>{busy === "save" ? <LoaderCircle size={16} /> : <FileText size={16} />}保存素材</button></div></section> : tab === "output" ? <ContentPackageOutput value={productionPackage} onGenerate={() => void generatePackage()} onGenerateOutline={() => void generateOutline()} onConfirmOutline={(result) => void confirmOutlineAndGenerate(result)} onGenerateChapters={() => void generateNextChapters()} busy={busy === "generate"} /> : <section className="content-unavailable"><FileText size={28} /><h2>暂无可比较版本</h2><p>生成第二版剧本后，这里将展示逐段差异；当前不会伪造版本内容。</p></section>}
      </> : <section className="content-unavailable"><BookOpen size={30} /><h2>创建第一个内容项目</h2><p>选择一种创作方式开始。</p><button type="button" className="content-primary-button" onClick={() => setCreating(true)}><Plus size={16} />新建项目</button></section>}
    </main>

    <aside className="content-inspector">
      {creating ? <label className="content-style-select"><span>视觉风格（用于后续分镜）</span><select value={createStyle.key} onChange={(event) => setCreateStyle(styleOptions.find((item) => item.key === event.target.value) ?? styleOptions[0])}>{styleOptions.map((style) => <option key={style.key} value={style.key}>{style.name} · {style.category}</option>)}</select><small>{createStyle.summary}</small></label> : null}
      <div className="content-panel-title"><div><strong>生成设置</strong><small>按项目保存并用于后续步骤</small></div></div>
      {selected ? <>
        <section className="content-model-route"><h2>模型路由</h2><label><span>供应商</span><select value={selected.textProvider} onChange={(event) => { const provider = textProviders.find((item) => item.id === event.target.value); if (provider) void changeModelRoute(provider.id, provider.models[0] ?? "gpt-5.5"); }}>{textProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}</select></label><label><span>文本模型</span><select value={selected.textModel} onChange={(event) => void changeModelRoute(selected.textProvider, event.target.value)}>{(textProviders.find((item) => item.id === selected.textProvider)?.models ?? [selected.textModel]).map((model) => <option value={model} key={model}>{model}</option>)}</select></label><small>默认使用 Manjiao / GPT-5.5；切换后只影响本项目后续生成。</small></section>
        <section><h2>当前任务</h2><dl className="content-meta"><div><dt>创作模式</dt><dd>{modeLabel(selected.mode)}</dd></div><div><dt>当前步骤</dt><dd>{contentSteps.find((step) => step.id === selected.activeStep)?.label}</dd></div><div><dt>模型</dt><dd>{selected.textModel}</dd></div><div><dt>内容风格</dt><dd>{selected.styleProfile?.name || "AI 自动匹配"}</dd></div></dl></section>
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
    <div className="content-inline-actions"><button type="button" className="content-secondary-button" onClick={onCancel} disabled={!canCancel || busy}>取消</button><button type="button" className="content-primary-button" disabled={intent.trim().length < 2 || busy} onClick={onSubmit}>{busy ? <LoaderCircle size={16} /> : <Sparkles size={16} />}{busy ? "正在进行结构拆解" : "开始结构拆解"}</button></div>
  </section>;
}

function ContentPackageOutput({ value, onGenerate, onGenerateOutline, onConfirmOutline, onGenerateChapters, busy }: { value?: ContentProductionPackage; onGenerate: () => void; onGenerateOutline: () => void; onConfirmOutline: (result: Record<string, unknown>) => void; onGenerateChapters: () => void; busy: boolean }) {
  const rawOutline = value?.outline?.result;
  const [outlineDraft, setOutlineDraft] = useState<Record<string, unknown>>(rawOutline ?? {});
  useEffect(() => setOutlineDraft(rawOutline ?? {}), [value?.outline?.id, rawOutline]);
  if (value?.analysis && !value.outline) {
    const dimensions = asRecord(value.analysis.result.dimensions);
    const evidence = asRecord(value.analysis.result.evidence);
    return <section className="content-plan-output"><header><div><span>STEP 2 · 结构拆解</span><h2>爆款机制已经整理完成</h2><small>{evidence.mode === "model_search" ? "已返回可核验公开来源" : "基于模型知识 · 非实时榜单"}</small></div><em>分析 v{value.analysis.version}</em></header><div className="content-analysis-grid"><article><b>爆款开头</b><p>{String(dimensions.opening || "等待完善")}</p></article><article><b>高潮</b><p>{String(dimensions.climax || "等待完善")}</p></article><article><b>反转</b><p>{String(dimensions.reversal || "等待完善")}</p></article><article><b>爽点</b><p>{String(dimensions.payoffs || "等待完善")}</p></article></div><div className="content-stage-actions"><span>下一步只生成章节大纲，不会提前生成正文。</span><button type="button" className="content-primary-button" disabled={busy} onClick={onGenerateOutline}>{busy ? <LoaderCircle size={16} /> : <ArrowRight size={16} />}生成章节大纲</button></div></section>;
  }
  if (value?.analysis && value.outline && !value.script) {
    const evidence = asRecord(value.analysis.result.evidence);
    const outline = Array.isArray(outlineDraft.chapters) ? outlineDraft.chapters.map(asRecord) : [];
    const chapters = value.chapters ?? [];
    const confirmed = value.outline.status === "confirmed";
    const updateChapter = (index: number, key: string, nextValue: string) => setOutlineDraft((current) => ({ ...current, chapters: outline.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: nextValue } : item) }));
    return <section className="content-plan-output"><header><div><span>{confirmed ? "STEP 4 · 正文创作" : "STEP 3 · 大纲确认"}</span><h2>{String(outlineDraft.title ?? "原创内容方案")}</h2><small>{evidence.mode === "model_search" ? "模型检索 · 已返回可核验来源" : "基于模型知识 · 非实时榜单"}</small></div><em>{confirmed ? `${chapters.length}/${outline.length} 章已生成` : `大纲 v${value.outline.version}`}</em></header><div className="content-chapter-workspace"><aside><h3>章节 · {outline.length} 章</h3>{outline.map((item, index) => { const chapterNo = Number(item.chapterNo ?? index + 1); const generated = chapters.find((chapter) => chapter.chapterNo === chapterNo); return <article key={chapterNo} className={generated ? "is-generated" : ""}><b>{String(chapterNo).padStart(2, "0")}</b><span><strong>{String(item.title ?? `第${chapterNo}章`)}</strong><small>{generated ? "正文已生成" : String(item.cliffhanger ?? "等待生成")}</small></span></article>; })}{confirmed ? <button type="button" className="content-secondary-button" disabled={busy || chapters.length >= outline.length} onClick={onGenerateChapters}>{busy ? <LoaderCircle size={15} /> : <Sparkles size={15} />}{chapters.length >= outline.length ? "全部章节已生成" : "继续生成下一批"}</button> : null}</aside><div>{confirmed ? (chapters.length ? chapters.map((chapter) => <article className="content-chapter-body" key={chapter.id}><header><span>第 {chapter.chapterNo} 章</span><strong>{chapter.title}</strong></header><p>{chapter.content}</p></article>) : <div className="content-unavailable"><FileText size={24} /><h2>等待首批正文</h2><p>确认大纲后按每批 2–3 章生成，失败只需重试当前批次。</p></div>) : <div className="content-outline-editor">{outline.map((item, index) => <article key={Number(item.chapterNo ?? index + 1)}><header><b>{String(Number(item.chapterNo ?? index + 1)).padStart(2, "0")}</b><input aria-label={`第${index + 1}章标题`} value={String(item.title ?? "")} onChange={(event) => updateChapter(index, "title", event.target.value)} /></header><label><span>本章目标</span><textarea value={String(item.objective ?? "")} onChange={(event) => updateChapter(index, "objective", event.target.value)} /></label><label><span>冲突</span><textarea value={String(item.conflict ?? "")} onChange={(event) => updateChapter(index, "conflict", event.target.value)} /></label><label><span>章尾钩子</span><textarea value={String(item.cliffhanger ?? "")} onChange={(event) => updateChapter(index, "cliffhanger", event.target.value)} /></label></article>)}<div className="content-stage-actions"><button type="button" className="content-secondary-button" disabled={busy} onClick={onGenerateOutline}><RefreshCw size={15} />重新生成大纲</button><button type="button" className="content-primary-button" disabled={busy || !outline.length} onClick={() => onConfirmOutline(outlineDraft)}>{busy ? <LoaderCircle size={16} /> : <Check size={16} />}确认大纲并生成首批正文</button></div></div>}</div></div></section>;
  }
  if (!value?.script) return <section className="content-unavailable"><FileText size={28} /><h2>还没有生成剧本</h2><p>保存素材后，系统会根据小说或剧本类型生成可生产剧本并提取真实实体。</p><button type="button" className="content-primary-button" disabled={!value?.source || busy} onClick={onGenerate}>{busy ? <LoaderCircle size={16} /> : <Sparkles size={16} />}生成剧本与实体</button></section>;
  return <section className="content-package-output"><header><div><span>剧本 v{value.script.version}</span><h2>可生产剧本</h2></div><em>{value.script.status === "confirmed" ? "已确认" : statusLabel(value.script.status)}</em></header><pre>{value.script.content}</pre><div className="content-entity-summary"><article><UsersRound size={18} /><strong>{value.entities?.characters.length ?? 0}</strong><span>人物</span></article><article><Map size={18} /><strong>{value.entities?.scenes.length ?? 0}</strong><span>场景</span></article><article><Sparkles size={18} /><strong>{value.entities?.props.length ?? 0}</strong><span>道具</span></article></div></section>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
