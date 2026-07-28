import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, CircleAlert, Clapperboard, FileText, LoaderCircle, Map, Plus, RefreshCw, Sparkles, Trash2, UsersRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { analyzeProductionEpisodes, episodeGenerationOptions, type ContentProductionPackage, type ContentProjectSummary, type CreateProjectInput, type ModelProvider, type StyleProfile } from "@aifilm/shared";
import { contentApi, type ContentVersionHistory, type SourceDocumentInput } from "../lib/contentApi";
import { ModelRoutePicker } from "../components/ModelRoutePicker";
import { buildProductionDraft, chapterGenerationPlan, chapterNavigationStage, cleanModelText, isCurrentRequest, modeLabel, reconcileProjectId, sourceKindForMode, statusLabel, type RequestToken } from "./model";

const emptyStyle: StyleProfile = { key: "", name: "", category: "", summary: "", characterRules: [], sceneRules: [], lightingRules: [], cameraRules: [], materialRules: [], negativeRules: [] };
const styleOptions: Array<Pick<StyleProfile, "key" | "name" | "category" | "summary">> = [
  { key: "donghua_3d", name: "3D古风玄幻国漫", category: "国漫 · 3D", summary: "角色建模精致，东方美学，柔和光影" },
  { key: "anime_jp", name: "日系动漫（标准）", category: "动漫 · 2D", summary: "赛璐珞上色，线条清晰，五官精致" },
  { key: "cinematic_real", name: "电影质感写实", category: "写实 · 影视", summary: "电影级调色，光影氛围浓厚" },
  { key: "semi_real", name: "拟真人/半写实风", category: "写实 · 漫画", summary: "保留真人辨识度与动漫美化" },
  { key: "dark_paint", name: "暗黑厚涂风", category: "实验 · 氛围", summary: "强烈明暗对比，适合悬疑与暗黑题材" }
];

type StageId = "intent" | "analysis" | "outline" | "chapter" | "handoff";
const stageFlow: Array<{ id: StageId; label: string }> = [
  { id: "intent", label: "创作意图" },
  { id: "analysis", label: "结构拆解" },
  { id: "outline", label: "大纲确认" },
  { id: "chapter", label: "正文创作" },
  { id: "handoff", label: "制作交接" }
];

function deriveStage(pkg?: ContentProductionPackage): StageId {
  if (!pkg?.analysis) return "intent";
  if (!pkg.outline) return "analysis";
  if (pkg.outline.status !== "confirmed") return "outline";
  if (pkg.script) return "handoff";
  return "chapter";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function activeEpisodeScript(episode: NonNullable<ContentProductionPackage["episodes"]>[number]) {
  const active = episode.scripts?.find((script) => script.version === episode.activeScriptVersion) ?? episode.scripts?.[episode.scripts.length - 1];
  return active?.content?.trim() || `第${episode.episodeNo}集尚未生成剧本`;
}

function outlineChapters(pkg?: ContentProductionPackage): Array<Record<string, unknown>> {
  const raw = pkg?.outline?.result;
  return Array.isArray(raw?.chapters) ? raw.chapters.map(asRecord) : [];
}

interface ContentWorkspaceProps {
  initialProjects: ContentProjectSummary[];
  initialSelectedId?: string;
  startBlank?: boolean;
  providers: ModelProvider[];
  onReload: () => Promise<ContentProjectSummary[]>;
  onBack?: () => void;
  onEnterProduction: (draft: CreateProjectInput & { contentProjectId?: string }) => void;
}

export function ContentWorkspace({ initialProjects, initialSelectedId, startBlank = false, providers, onReload, onBack, onEnterProduction }: ContentWorkspaceProps) {
  const [projects, setProjects] = useState(initialProjects);
  const [selectedId, setSelectedId] = useState(() => startBlank ? "" : reconcileProjectId(initialProjects, initialSelectedId));
  const [creating, setCreating] = useState(startBlank || initialProjects.length === 0);
  const [createTitle, setCreateTitle] = useState("");
  const [createStyle, setCreateStyle] = useState(styleOptions[0]);
  const [intentType, setIntentType] = useState<"title" | "genre" | "references">("title");
  const [targetWords, setTargetWords] = useState(20000);
  const [chapterCount, setChapterCount] = useState(10);
  const [batchSize, setBatchSize] = useState(2);
  const [episodeScope, setEpisodeScope] = useState<number | "all">("all");
  const [handoffEpisodeNo, setHandoffEpisodeNo] = useState(1);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [focusStage, setFocusStage] = useState<StageId | "">("");
  const [selectedChapterNo, setSelectedChapterNo] = useState(1);
  const [busy, setBusy] = useState<"create" | "save" | "generate" | "refresh" | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [failedProjectId, setFailedProjectId] = useState("");
  const [savedSources, setSavedSources] = useState<Record<string, { title: string; content: string }>>({});
  const [packages, setPackages] = useState<Record<string, ContentProductionPackage>>({});
  const [versions, setVersions] = useState<Record<string, ContentVersionHistory>>({});
  const requestSequence = useRef(0);
  const activeRequest = useRef<RequestToken | null>(null);
  const selected = projects.find((project) => project.id === selectedId);

  useEffect(() => { if (!startBlank) setSelectedId((current) => reconcileProjectId(projects, current || initialSelectedId)); }, [projects, initialSelectedId, startBlank]);
  useEffect(() => {
    activeRequest.current = null;
    setBusy((current) => current === "save" ? "" : current);
    setMessage(""); setError(""); setSourceTitle(""); setSourceContent(""); setSourceOpen(false); setFocusStage("");
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

  const selectedPackage = selectedId ? packages[selectedId] : undefined;
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void contentApi.versions(selectedId)
      .then((result) => { if (active) setVersions((current) => ({ ...current, [selectedId]: result })); })
      .catch(() => { /* 版本详情为增强信息，失败不阻断 */ });
    return () => { active = false; };
  }, [selectedId, selectedPackage?.analysis?.version, selectedPackage?.outline?.version, selectedPackage?.chapters?.length, selectedPackage?.script?.version]);

  const productionPackage = selectedPackage;
  const currentStage = deriveStage(productionPackage);
  const viewStage: StageId = focusStage || currentStage;
  const chapters = productionPackage?.chapters ?? [];
  const outline = outlineChapters(productionPackage);
  const generationPlan = chapterGenerationPlan(outline.map((item, index) => ({ chapterNo: Number(item.chapterNo ?? index + 1) })), chapters, batchSize);
  const serverBusy = !busy && selected?.status === "running";
  const working = Boolean(busy) || serverBusy;
  const [editingChapter, setEditingChapter] = useState<{ chapterNo: number; title: string; content: string } | null>(null);
  const handoffSource = selected ? savedSources[selected.id] : undefined;
  const handoffContent = productionPackage?.script?.content.trim() || "";
  const handoffEpisode = productionPackage?.episodes?.find((episode) => episode.episodeNo === handoffEpisodeNo) ?? productionPackage?.episodes?.[0];
  const handoffEpisodeContent = handoffEpisode ? activeEpisodeScript(handoffEpisode) : handoffContent;
  const wordCount = useMemo(() => sourceContent.replace(/\s/g, "").length, [sourceContent]);
  const episodeSourceContent = useMemo(() => chapters.map((chapter) => `第${chapter.chapterNo}章 ${chapter.title}\n${chapter.content}`).join("\n\n") || handoffSource?.content || "", [chapters, handoffSource?.content]);
  const episodeAnalysis = useMemo(() => analyzeProductionEpisodes(episodeSourceContent, "novel"), [episodeSourceContent]);
  const completedEpisodeNos = productionPackage?.episodes?.filter((episode) => episode.activeScriptVersion > 0 && episode.status !== "stale").map((episode) => episode.episodeNo) ?? [];
  const episodeOptions = episodeGenerationOptions(episodeAnalysis.maxEpisodes, completedEpisodeNos);
  const stageIndex = stageFlow.findIndex((item) => item.id === currentStage);

  useEffect(() => {
    if (!episodeOptions.some((option) => option.value === episodeScope)) setEpisodeScope(episodeOptions.at(-1)?.value ?? "all");
  }, [episodeOptions.map((option) => option.value).join(","), episodeScope]);

  useEffect(() => {
    const numbers = outline.map((item, index) => Number(item.chapterNo ?? index + 1));
    const latestGenerated = chapters.at(-1)?.chapterNo;
    setSelectedChapterNo((current) => numbers.includes(current) ? current : latestGenerated ?? numbers[0] ?? 1);
  }, [productionPackage?.outline?.id, chapters.length]);

  useEffect(() => {
    if (!selectedId || !serverBusy) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void contentApi.productionPackage(selectedId).then((result) => setPackages((current) => ({ ...current, [selectedId]: result }))).catch(() => undefined);
      void onReload().then(setProjects).catch(() => undefined);
    }, 6000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, serverBusy]);

  async function saveChapterEdit() {
    if (!selected || !editingChapter || busy) return;
    setBusy("save"); setError("");
    try {
      const result = await contentApi.updateChapter(selected.id, editingChapter.chapterNo, { title: editingChapter.title, content: editingChapter.content });
      setPackages((current) => ({ ...current, [selected.id]: result }));
      setEditingChapter(null); setMessage(`第 ${editingChapter.chapterNo} 章已保存`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setBusy(""); }
  }

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
      setSelectedId(created.id); setProjects(await onReload()); setCreating(false); setFocusStage(""); setMessage("结构拆解已完成，请继续生成大纲");
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
      setProjects(await onReload()); setSelectedId(failedProjectId); setFailedProjectId(""); setCreating(false); setFocusStage(""); setMessage("结构拆解已完成");
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
      setProjects(next); setMessage("素材已保存，可以生成剧本与实体");
    } catch (reason) { if (isCurrentRequest(activeRequest.current, token)) setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { if (isCurrentRequest(activeRequest.current, token)) { activeRequest.current = null; setBusy(""); } }
  }

  async function generatePackage() {
    if (!selected || busy) return;
    setBusy("generate"); setError(""); setMessage("正在按素材生成剧本并提取人物、场景实体…");
    try {
      const result = await contentApi.generatePackage(selected.id);
      setPackages((current) => ({ ...current, [selected.id]: result }));
      setProjects(await onReload());
      setSourceOpen(false); setFocusStage("handoff");
      setMessage("剧本与实体已生成，可以进入漫剧创作");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "内容生成失败"); }
    finally { setBusy(""); }
  }

  // 正文完成后一键把已生成章节转成剧本与实体（打通到制作交接的缺口）。
  async function generateScriptFromChapters(scope: number | "all" = episodeScope) {
    if (!selected || busy || !chapters.length) return;
    setBusy("generate"); setError(""); setMessage("正在把已生成正文转为可生产剧本…");
    try {
      const content = chapters.map((chapter) => `第${chapter.chapterNo}章 ${chapter.title}\n${chapter.content}`).join("\n\n");
      await contentApi.addSource(selected.id, { kind: "novel", title: selected.title, content });
      setSavedSources((current) => ({ ...current, [selected.id]: { title: selected.title, content } }));
      const result = await contentApi.generatePackage(selected.id, scope);
      setPackages((current) => ({ ...current, [selected.id]: result }));
      setProjects(await onReload());
      setFocusStage("handoff");
      setMessage("剧本与实体已生成，可以进入漫剧创作");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "剧本生成失败"); }
    finally { setBusy(""); }
  }

  async function generateNextChapters() {
    if (!selected || busy) return;
    const plan = chapterGenerationPlan(outline.map((item, index) => ({ chapterNo: Number(item.chapterNo ?? index + 1) })), chapters, batchSize);
    if (!plan.remainingCount) return;
    setBusy("generate"); setError(""); setMessage(`正在生成第 ${plan.nextChapter} 章起的正文`);
    try {
      const result = await contentApi.generateChapters(selected.id, { startChapter: plan.nextChapter, batchSize: Math.max(2, plan.nextBatchSize) });
      setPackages((current) => ({ ...current, [selected.id]: result }));
      setProjects(await onReload()); setMessage("新一批章节正文已生成");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "章节生成失败"); }
    finally { setBusy(""); }
  }

  async function regenerateChapter(chapterNo: number) {
    if (!selected || busy) return;
    if (!window.confirm(`重新生成第 ${chapterNo} 章？旧内容会保留为历史版本。`)) return;
    setBusy("generate"); setError(""); setMessage(`正在重新生成第 ${chapterNo} 章`);
    try {
      const result = await contentApi.generateChapters(selected.id, { startChapter: chapterNo, batchSize: 2, regenerate: true });
      setPackages((current) => ({ ...current, [selected.id]: result }));
      setProjects(await onReload()); setMessage(`第 ${chapterNo} 章已重新生成`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "重新生成失败"); }
    finally { setBusy(""); }
  }

  async function generateAllChapters() {
    if (!selected || busy || !productionPackage?.outline) return;
    const outlineNumbers = outline.map((item, index) => ({ chapterNo: Number(item.chapterNo ?? index + 1) }));
    let current = productionPackage;
    let plan = chapterGenerationPlan(outlineNumbers, current.chapters ?? [], batchSize);
    if (!plan.remainingCount) return;
    setBusy("generate"); setError("");
    try {
      while (plan.remainingCount > 0) {
        const completed = outlineNumbers.length - plan.remainingCount;
        setMessage(`正在生成全部正文 · ${completed}/${outlineNumbers.length} 章已保存`);
        current = await contentApi.generateChapters(selected.id, { startChapter: plan.nextChapter, batchSize: Math.max(2, plan.nextBatchSize) });
        setPackages((packagesState) => ({ ...packagesState, [selected.id]: current }));
        plan = chapterGenerationPlan(outlineNumbers, current.chapters ?? [], batchSize);
      }
      setProjects(await onReload()); setMessage(`全部 ${outlineNumbers.length} 章正文已生成`);
    } catch (reason) { setError(reason instanceof Error ? `${reason.message}；已完成章节已保存，可继续重试剩余章节。` : "全部章节生成中断"); }
    finally { setBusy(""); }
  }

  async function retryAnalyzeSelected() {
    if (!selected || busy) return;
    setBusy("generate"); setError(""); setMessage("正在重新进行结构拆解...");
    try {
      const result = await contentApi.analyze(selected.id, { intentType: "title", intent: selected.title, targetWords, chapterCount, batchSize });
      setPackages((current) => ({ ...current, [selected.id]: result }));
      setProjects(await onReload()); setFocusStage(""); setMessage("结构拆解已完成，请继续生成大纲");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "结构拆解失败"); }
    finally { setBusy(""); }
  }

  async function generateOutline() {
    if (!selected || busy) return;
    setBusy("generate"); setError(""); setMessage("正在根据结构拆解生成章节大纲...");
    try {
      const result = await contentApi.generateOutline(selected.id);
      setPackages((current) => ({ ...current, [selected.id]: result }));
      setProjects(await onReload()); setFocusStage(""); setMessage("大纲已生成，可以编辑后确认");
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
      setProjects(await onReload()); setFocusStage(""); setMessage("大纲已确认，首批正文已生成");
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
    onEnterProduction(buildProductionDraft(
      selected,
      handoffContent,
      (productionPackage?.episodes ?? []).map((episode) => ({ episodeNo: episode.episodeNo, title: episode.title, content: activeEpisodeScript(episode) })),
      productionPackage?.entities ? { characters: productionPackage.entities.characters.map((item) => item.name), scenes: productionPackage.entities.scenes.map((item) => item.name), props: productionPackage.entities.props.map((item) => item.name) } : {}
    ));
  }

  const history = selected ? versions[selected.id] : undefined;
  const showRail = Boolean(selected) && !creating && (viewStage === "outline" || viewStage === "chapter" || viewStage === "handoff") && outline.length > 0;

  // ---------- 顶栏 ----------
  const topbar = <header className="cw2-topbar">
    <button type="button" className="cw2-back" onClick={() => onBack?.()} aria-label="返回我的作品" title="返回我的作品"><ArrowLeft size={17} /></button>
    <div className="cw2-title">
      <h1>{creating ? "新建内容创作" : selected?.title || "内容创作"}</h1>
      <small>{creating ? "同类创作 · 从一个想法开始" : selected ? `${modeLabel(selected.mode)} · ${statusLabel(selected.status)} · ${new Date(selected.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 更新` : ""}</small>
    </div>
    <nav className="cw2-steps" aria-label="创作流程">
      {stageFlow.map((step, index) => {
        const done = index < stageIndex || (currentStage === "handoff" && step.id !== "handoff");
        const isCurrent = step.id === viewStage;
        const clickable = !creating && (index <= stageIndex);
        return <span key={step.id} className="cw2-step-wrap">
          <button type="button" disabled={!clickable} className={`cw2-step ${isCurrent ? "is-current" : done ? "is-done" : ""}`} onClick={() => setFocusStage(step.id === currentStage ? "" : step.id)}>
            <i>{done && !isCurrent ? <Check size={11} /> : index + 1}</i>{step.label}
          </button>
          {index < stageFlow.length - 1 ? <em /> : null}
        </span>;
      })}
    </nav>
    <div className="cw2-top-actions">
      {selected && !creating ? <ModelRoutePicker modality="text" compact providers={providers} value={{ providerId: selected.textProvider, model: selected.textModel }} onChange={(providerId, model) => { void changeModelRoute(providerId, model); }} /> : null}
      <button type="button" className="cw2-icon-button" onClick={() => setCreating(true)} title="新建内容创作" aria-label="新建内容创作"><Plus size={16} /></button>
      <button type="button" className="cw2-icon-button" onClick={() => void refresh()} title="刷新" aria-label="刷新"><RefreshCw size={15} /></button>
      {selected && !creating ? <button type="button" className="cw2-icon-button danger" onClick={() => void removeContentProject(selected.id)} title="删除作品" aria-label="删除作品"><Trash2 size={15} /></button> : null}
    </div>
  </header>;

  // ---------- 中央区 ----------
  let stageView: ReactElement;
  if (creating) {
    stageView = <div className="cw2-stage-scroll"><ContentCreationIntent intent={createTitle} intentType={intentType} targetWords={targetWords} chapterCount={chapterCount} batchSize={batchSize} busy={busy === "create"} canCancel={Boolean(projects.length)} onIntentChange={setCreateTitle} onIntentTypeChange={setIntentType} onTargetWordsChange={setTargetWords} onChapterCountChange={setChapterCount} onBatchSizeChange={setBatchSize} onCancel={() => setCreating(false)} onSubmit={() => void createProject()} styleKey={createStyle.key} onStyleChange={(key) => setCreateStyle(styleOptions.find((item) => item.key === key) ?? styleOptions[0])} />
      {error ? <div className="content-creation-error" role="alert"><CircleAlert size={17} /><div><strong>创作流程中断，项目已保留</strong><p>{error}</p><div className="content-inline-actions"><button type="button" className="content-secondary-button" onClick={() => void retryDevelop()} disabled={!failedProjectId || Boolean(busy)}><RefreshCw size={15} />重试当前阶段</button><button type="button" className="content-secondary-button" onClick={() => failedProjectId && void removeContentProject(failedProjectId)} disabled={!failedProjectId || Boolean(busy)}><Trash2 size={15} />删除失败项目</button></div></div></div> : null}
    </div>;
  } else if (!selected) {
    stageView = <section className="content-unavailable"><BookOpen size={30} /><h2>创建第一个内容项目</h2><p>从一个标题、题材方向或参考作品开始。</p><button type="button" className="content-primary-button" onClick={() => setCreating(true)}><Plus size={16} />新建内容创作</button></section>;
  } else if (sourceOpen) {
    stageView = <section className="cw2-source-panel">
      <header><div><span>{modeLabel(selected.mode)}</span><h2>创作素材</h2><small>{selected.mode === "adaptation" ? "导入需要改编的小说正文" : "可选：给生成提供参考素材或世界观设定"}</small></div><button type="button" className="content-secondary-button" onClick={() => setSourceOpen(false)}><ArrowLeft size={14} />返回创作进度</button></header>
      <label><span>素材标题</span><input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} maxLength={160} placeholder={selected.mode === "adaptation" ? "例如：原著第一卷" : "例如：故事核心设定"} /></label>
      <label className="content-writing-field"><span>素材正文 <em>{wordCount.toLocaleString()} 字</em></span><textarea value={sourceContent} onChange={(event) => setSourceContent(event.target.value)} maxLength={500000} placeholder={selected.mode === "same_genre" ? "粘贴参考作品或结构素材…" : selected.mode === "adaptation" ? "粘贴需要改编的小说正文…" : "写下人物、冲突、世界观或故事灵感…"} /></label>
      <div className="content-inline-actions"><span>{message || error}</span>
        <button type="button" className="content-secondary-button" disabled={!handoffSource?.content || Boolean(busy)} onClick={() => void generatePackage()}>{busy === "generate" ? <LoaderCircle size={16} /> : <Sparkles size={16} />}{productionPackage?.script ? "重新生成剧本" : "生成剧本与实体"}</button>
        <button type="button" className="content-primary-button" disabled={!sourceTitle.trim() || !sourceContent.trim() || busy === "save"} onClick={() => void saveSource()}>{busy === "save" ? <LoaderCircle size={16} /> : <FileText size={16} />}保存素材</button>
      </div>
    </section>;
  } else if (viewStage === "intent") {
    const intentRecord = asRecord(productionPackage?.analysis?.result);
    stageView = productionPackage?.analysis ? <section className="cw2-stage-scroll">
      <div className="cw2-stage-head"><h2>创作意图 <span className="cw2-tag">已完成</span></h2><small>本次创作的输入与生成参数（回看）</small></div>
      <div className="cw2-intent-review">
        <article><b>意图类型</b><p>{({ title: "已有标题", genre: "题材方向", references: "参考作品" } as Record<string, string>)[String(intentRecord.intentType)] ?? "已有标题"}</p></article>
        <article style={{ gridColumn: "1 / -1" }}><b>意图内容</b><p>{String(intentRecord.intent ?? selected.title)}</p></article>
        <article><b>目标字数</b><p>{Number(intentRecord.targetWords ?? 20000).toLocaleString()} 字</p></article>
        <article><b>章节数量</b><p>{Number(intentRecord.chapterCount ?? 10)} 章</p></article>
        <article><b>每批生成</b><p>{Number(intentRecord.batchSize ?? 2)} 章</p></article>
        <article><b>视觉风格</b><p>{selected.styleProfile?.name || "AI 自动匹配"}</p></article>
      </div>
      <div className="cw2-actionbar"><span className="cw2-hint">意图决定爆款拆解与大纲的方向；要换方向请新建作品，避免覆盖已生成内容。</span></div>
    </section> : <section className="cw2-stage-scroll">
      <div className="cw2-stage-head"><h2>结构拆解未完成 <span className="cw2-tag is-wait">待拆解</span></h2></div>
      <div className="cw2-paper cw2-paper-empty"><CircleAlert size={24} /><p>「{selected.title}」还没有完成爆款结构拆解。可以用作品标题重新发起，或删除后重新创建。</p>
        <button type="button" className="content-primary-button" disabled={working} onClick={() => void retryAnalyzeSelected()}>{busy === "generate" ? <LoaderCircle size={16} /> : <Sparkles size={16} />}用标题重新拆解</button>
      </div>
    </section>;
  } else if (viewStage === "analysis" && productionPackage?.analysis) {
    const dimensions = asRecord(productionPackage.analysis.result.dimensions);
    const evidence = asRecord(productionPackage.analysis.result.evidence);
    stageView = <section className="cw2-stage-scroll">
      <div className="cw2-stage-head"><h2>爆款机制拆解 <span className="cw2-tag">分析 v{productionPackage.analysis.version}</span></h2><small>{evidence.mode === "model_search" ? "模型检索 · 已返回可核验来源" : "基于模型知识 · 非实时榜单"}</small></div>
      <div className="content-analysis-grid">
        <article><b>爆款开头</b><p>{cleanModelText(dimensions.opening) || "等待完善"}</p></article>
        <article><b>高潮</b><p>{cleanModelText(dimensions.climax) || "等待完善"}</p></article>
        <article><b>反转</b><p>{cleanModelText(dimensions.reversal) || "等待完善"}</p></article>
        <article><b>爽点</b><p>{cleanModelText(dimensions.payoffs) || "等待完善"}</p></article>
      </div>
      <div className="cw2-actionbar"><span className="cw2-hint">{currentStage === "analysis" ? "下一步只生成章节大纲，不会提前生成正文。" : "这是已完成步骤的回看。"}</span>
        {currentStage === "analysis" ? <button type="button" className="content-primary-button" disabled={working} onClick={() => void generateOutline()}>{busy === "generate" ? <LoaderCircle size={16} /> : <ArrowRight size={16} />}生成章节大纲</button> : <button type="button" className="content-secondary-button" disabled={working} onClick={() => void generateOutline()}><RefreshCw size={14} />重新拆解并生成大纲</button>}
      </div>
    </section>;
  } else if (viewStage === "outline" && productionPackage?.outline) {
    stageView = <OutlineStage pkg={productionPackage} busy={Boolean(busy)} selectedChapterNo={selectedChapterNo} confirmed={productionPackage.outline.status === "confirmed"} onRegenerateOutline={() => void generateOutline()} onConfirm={(result) => void confirmOutlineAndGenerate(result)} />;
  } else if (viewStage === "chapter" || (viewStage === "handoff" && !productionPackage?.script)) {
    const selectedGenerated = chapters.find((chapter) => chapter.chapterNo === selectedChapterNo);
    const selectedOutline = outline.find((item, index) => Number(item.chapterNo ?? index + 1) === selectedChapterNo);
    stageView = <section className="cw2-stage-scroll">
      {selectedGenerated && editingChapter?.chapterNo === selectedGenerated.chapterNo ? <>
        <div className="cw2-stage-head"><h2>编辑第 {editingChapter.chapterNo} 章 <span className="cw2-tag is-wait">编辑中</span></h2><small>{editingChapter.content.replace(/\s/g, "").length.toLocaleString()} 字</small></div>
        <article className="cw2-paper"><div className="cw2-paper-editor">
          <input aria-label="章节标题" value={editingChapter.title} onChange={(event) => setEditingChapter((current) => current ? { ...current, title: event.target.value } : current)} maxLength={160} />
          <textarea value={editingChapter.content} onChange={(event) => setEditingChapter((current) => current ? { ...current, content: event.target.value } : current)} />
        </div></article>
        <div className="cw2-actionbar"><span className="cw2-hint">修改会保存到当前版本并标记为已确认。</span>
          <button type="button" className="content-secondary-button" disabled={busy === "save"} onClick={() => setEditingChapter(null)}>取消</button>
          <button type="button" className="content-primary-button" disabled={busy === "save" || editingChapter.content.trim().length < 20} onClick={() => void saveChapterEdit()}>{busy === "save" ? <LoaderCircle size={15} /> : <Check size={15} />}保存修改</button>
        </div>
      </> : selectedGenerated ? <>
        <div className="cw2-stage-head"><h2>第 {selectedGenerated.chapterNo} 章 · {selectedGenerated.title} <span className="cw2-tag">正文已生成</span></h2><small>约 {selectedGenerated.content.replace(/\s/g, "").length.toLocaleString()} 字</small></div>
        <article className="cw2-paper"><div className="cw2-paper-scroll"><p>{selectedGenerated.content}</p></div></article>
      </> : <>
        <div className="cw2-stage-head"><h2>第 {selectedChapterNo} 章 · {String(selectedOutline?.title ?? "等待生成")} <span className="cw2-tag is-wait">等待生成</span></h2></div>
        <div className="cw2-paper cw2-paper-empty"><FileText size={24} /><p>{String(selectedOutline?.cliffhanger ?? "本章还未生成，可以继续生成下一批或一次生成全部剩余章节。")}</p></div>
      </>}
      {editingChapter ? null : <div className="cw2-actionbar">
        <span className="cw2-hint">{serverBusy ? "服务器正在生成中，离开此页也会继续，完成后自动刷新…" : generationPlan.remainingCount ? `每批完成后自动保存 · 还剩 ${generationPlan.remainingCount} 章 · 中断可随时续生成` : "全部章节已生成，可在右侧进入制作交接"}</span>
        {selectedGenerated ? <button type="button" className="content-secondary-button" disabled={working} onClick={() => setEditingChapter({ chapterNo: selectedGenerated.chapterNo, title: selectedGenerated.title, content: selectedGenerated.content })}><FileText size={14} />编辑本章</button> : null}
        {selectedGenerated ? <button type="button" className="content-secondary-button" disabled={working} onClick={() => void regenerateChapter(selectedChapterNo)}><RefreshCw size={14} />重新生成本章</button> : null}
        <button type="button" className="content-secondary-button" disabled={working || !generationPlan.remainingCount} onClick={() => void generateNextChapters()}>{working ? <LoaderCircle size={15} /> : <Sparkles size={15} />}继续生成下一批（{Math.max(2, generationPlan.nextBatchSize) || 2} 章）</button>
        <button type="button" className="content-primary-button" disabled={working || !generationPlan.remainingCount} onClick={() => void generateAllChapters()}><ArrowRight size={15} />一键生成全部剩余 {generationPlan.remainingCount} 章</button>
      </div>}
    </section>;
  } else {
    // handoff（含 script 已生成）
    stageView = <section className="cw2-stage-scroll">
      {productionPackage?.script ? <>
        <div className="cw2-stage-head"><h2>可生产剧本 <span className="cw2-tag">剧本 v{productionPackage.script.version}</span></h2><small>{statusLabel(productionPackage.script.status)}</small></div>
        <div className="cw2-episode-picker"><label htmlFor="handoff-episode">查看剧集</label><select id="handoff-episode" value={handoffEpisode?.episodeNo ?? 1} onChange={(event) => setHandoffEpisodeNo(Number(event.target.value))}>{(productionPackage.episodes ?? []).map((episode) => <option key={episode.episodeNo} value={episode.episodeNo}>第{episode.episodeNo}集 · {episode.title}</option>)}</select><span>{handoffEpisode ? `${handoffEpisode.sourceCharacterCount.toLocaleString()} 字 · ${handoffEpisode.status}` : "完整剧本"}</span></div>
        <article className="cw2-paper"><div className="cw2-paper-scroll"><pre>{handoffEpisodeContent}</pre></div></article>
        <div className="content-entity-summary">
          <article><UsersRound size={18} /><strong>{productionPackage.entities?.characters.length ?? 0}</strong><span>人物</span></article>
          <article><Map size={18} /><strong>{productionPackage.entities?.scenes.length ?? 0}</strong><span>场景</span></article>
          <article><Sparkles size={18} /><strong>{productionPackage.entities?.props.length ?? 0}</strong><span>道具</span></article>
        </div>
        <div className="cw2-actionbar"><span className="cw2-hint">交接后仍可编辑任意章节；修改完成后重新生成剧本即可同步。</span>
          <button type="button" className="content-secondary-button" disabled={working} onClick={() => setFocusStage("chapter")}><FileText size={14} />返回编辑正文</button>
          {episodeOptions.length ? <select className="cw2-mini-select" aria-label="选择生成集数" value={episodeScope} onChange={(event) => setEpisodeScope(event.target.value === "all" ? "all" : Number(event.target.value))}>{episodeOptions.map((option) => <option key={String(option.value)} value={option.value}>{option.label}</option>)}</select> : null}
          <button type="button" className="content-secondary-button" disabled={working || !episodeOptions.length} onClick={() => void generateScriptFromChapters()}><RefreshCw size={14} />继续生成分集剧本</button>
          <button type="button" className="content-primary-button" disabled={!handoffContent} onClick={enterProduction}>进入漫剧创作<ArrowRight size={16} /></button>
        </div>
      </> : <>
        <div className="cw2-stage-head"><h2>制作交接</h2><small>把正文转成可生产剧本，并提取人物 / 场景实体</small></div>
        <div className="cw2-paper cw2-paper-empty"><Clapperboard size={26} /><p>{chapters.length ? `已生成 ${chapters.length} 章正文。生成剧本与实体后即可进入漫剧创作。` : "先在「正文创作」生成章节，再回到这里生成剧本。"}</p>
          <select className="cw2-mini-select" aria-label="选择生成集数" value={episodeScope} onChange={(event) => setEpisodeScope(event.target.value === "all" ? "all" : Number(event.target.value))}>{episodeOptions.map((option) => <option key={String(option.value)} value={option.value}>{option.label}</option>)}</select>
          <button type="button" className="content-primary-button" disabled={!chapters.length || working || !episodeOptions.length} onClick={() => void generateScriptFromChapters()}>{busy === "generate" ? <LoaderCircle size={16} /> : <Sparkles size={16} />}生成所选分集剧本</button>
        </div>
      </>}
    </section>;
  }

  // ---------- 右栏 ----------
  const sidePanel = selected && !creating ? <aside className="cw2-side">
    <div className="cw2-card">
      <h4>当前步骤 · {stageFlow.find((item) => item.id === currentStage)?.label}</h4>
      <div className="cw2-kv"><span>生成进度</span><b>{chapters.length} / {outline.length || "-"} 章</b></div>
      <div className="cw2-kv"><span>每批章数</span><b><select className="cw2-mini-select" value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))}><option value={2}>2 章</option><option value={3}>3 章</option></select></b></div>
      <div className="cw2-kv"><span>内容风格</span><b>{selected.styleProfile?.name || "AI 自动匹配"}</b></div>
      <div className="cw2-kv"><span>创作素材</span><b><button type="button" className="cw2-link-button" onClick={() => setSourceOpen(true)}>{handoffSource?.content ? "已保存 · 查看" : selected.mode === "adaptation" ? "去导入小说" : "补充素材（可选）"}</button></b></div>
    </div>
    <div className="cw2-card cw2-handoff">
      <h4>下一步 · 制作交接</h4>
      <div className="cw2-todo"><span>正文完成</span><em className={outline.length && chapters.length >= outline.length ? "is-ok" : "is-wait"}>{chapters.length}/{outline.length || "-"} 章</em></div>
      <div className="cw2-todo"><span>生成剧本</span><em className={productionPackage?.script ? "is-ok" : "is-wait"}>{productionPackage?.script ? "已就绪" : "待生成"}</em></div>
      <div className="cw2-todo"><span>角色 / 场景实体</span><em className={productionPackage?.entities?.characters.length ? "is-ok" : "is-wait"}>{productionPackage?.entities?.characters.length ? `${productionPackage.entities.characters.length} 角色 · ${productionPackage.entities.scenes.length} 场景` : "待提取"}</em></div>
      <div className="cw2-todo"><span>视觉风格</span><em className="is-ok">{selected.styleProfile?.name || "自动匹配"}</em></div>
      {handoffContent
        ? <button type="button" className="content-primary-button cw2-full" onClick={enterProduction}>进入漫剧创作<ArrowRight size={15} /></button>
        : <button type="button" className="content-secondary-button cw2-full" disabled={!chapters.length || working} onClick={() => void generateScriptFromChapters()}>{busy === "generate" ? <LoaderCircle size={15} /> : <Clapperboard size={15} />}生成剧本后交接</button>}
      {handoffContent ? <small className="cw2-ok-note"><CheckCircle2 size={12} />交接会自动带入剧本、作品名与视觉风格</small> : null}
    </div>
    <div className="cw2-card">
      <h4>版本</h4>
      {history && (history.outlines.length || history.analyses.length || history.chapters.length || history.scripts.length) ? <div className="cw2-vers">
        {history.outlines.slice(0, 2).map((item) => <div className="cw2-ver" key={item.id}><b>大纲 v{item.version}</b><span>{item.title || "章节大纲"}</span><em>{statusLabel(item.status as never)}</em></div>)}
        {history.analyses.slice(0, 1).map((item) => <div className="cw2-ver" key={item.id}><b>拆解 v{item.version}</b><span>爆款机制分析</span><em>{statusLabel(item.status as never)}</em></div>)}
        {history.scripts.slice(0, 2).map((item) => <div className="cw2-ver" key={item.id}><b>剧本 v{item.version}</b><span>可生产剧本</span><em>{statusLabel(item.status as never)}</em></div>)}
        {history.chapters.map((chapter) => <div className="cw2-ver" key={chapter.chapterNo}><b>第{chapter.chapterNo}章 v{chapter.versions[0]?.version ?? 1}</b><span>{chapter.title || `第${chapter.chapterNo}章`}</span><em>{chapter.versions.length > 1 ? `${chapter.versions.length} 个版本` : statusLabel(chapter.latestStatus as never)}</em></div>)}
      </div> : <p className="cw2-muted">完成各步骤后，这里会列出历史版本。</p>}
    </div>
  </aside> : null;

  return <div className={`cw2-frame ${showRail ? "" : "no-rail"} ${selected && !creating ? "" : "no-side"}`}>
    {topbar}
    <div className="cw2-main">
      {showRail ? <aside className="cw2-rail">
        <h3>章节目录 <span>{chapters.length}/{outline.length} 已生成</span></h3>
        <div className="cw2-progress"><i style={{ width: `${outline.length ? Math.round((chapters.length / outline.length) * 100) : 0}%` }} /></div>
        <div className="cw2-chapters">
          {outline.map((item, index) => {
            const chapterNo = Number(item.chapterNo ?? index + 1);
            const generated = chapters.find((chapter) => chapter.chapterNo === chapterNo);
            return <button type="button" key={chapterNo} className={`cw2-chap ${generated ? "is-gen" : ""} ${chapterNo === selectedChapterNo ? "is-active" : ""}`} onClick={() => { setSelectedChapterNo(chapterNo); if (viewStage === "handoff") setFocusStage(chapterNavigationStage(viewStage)); }}>
              <b>{String(chapterNo).padStart(2, "0")}</b>
              <span>{String(item.title ?? `第${chapterNo}章`)}</span>
              <i className="cw2-dot" />
              {!generated ? <small>{String(item.cliffhanger ?? "等待生成")}</small> : null}
            </button>;
          })}
        </div>
        <p className="cw2-rail-meta">素材 {selected?.sourceCount ?? 0} · 大纲 v{productionPackage?.outline?.version ?? "-"} · 剧本 {selected?.scriptCount ?? 0}</p>
      </aside> : null}
      <main className="cw2-stage">
         {(message || error || serverBusy) && !creating ? <div className={`cw2-notice ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{busy ? <LoaderCircle size={14} className="cw2-spin" /> : error ? <CircleAlert size={14} /> : <Check size={14} />}<span>{error || (serverBusy ? "服务器正在生成中，可自由切换页面，完成后自动刷新。" : message)}</span></div> : null}
        {stageView}
      </main>
      {sidePanel}
    </div>
  </div>;
}

function OutlineStage({ pkg, busy, selectedChapterNo, confirmed, onRegenerateOutline, onConfirm }: { pkg: ContentProductionPackage; busy: boolean; selectedChapterNo: number; confirmed: boolean; onRegenerateOutline: () => void; onConfirm: (result: Record<string, unknown>) => void }) {
  const rawOutline = pkg.outline?.result;
  const [outlineDraft, setOutlineDraft] = useState<Record<string, unknown>>(rawOutline ?? {});
  useEffect(() => setOutlineDraft(rawOutline ?? {}), [pkg.outline?.id, rawOutline]);
  const outline = Array.isArray(outlineDraft.chapters) ? outlineDraft.chapters.map(asRecord) : [];
  const selectedIndex = Math.max(0, outline.findIndex((item, index) => Number(item.chapterNo ?? index + 1) === selectedChapterNo));
  const selectedOutline = outline[selectedIndex];
  const updateChapter = (index: number, key: string, nextValue: string) => setOutlineDraft((current) => ({ ...current, chapters: outline.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: nextValue } : item) }));
  return <section className="cw2-stage-scroll">
    <div className="cw2-stage-head"><h2>{String(outlineDraft.title ?? "章节大纲")} <span className="cw2-tag">大纲 v{pkg.outline?.version}</span></h2><small>{confirmed ? "已确认 · 可回看编辑意图" : "只显示当前章节，左侧目录切换逐章检查"}</small></div>
    {selectedOutline ? <div className="cw2-outline-editor">
      <header><b>{String(selectedChapterNo).padStart(2, "0")}</b><input aria-label={`第${selectedChapterNo}章标题`} value={String(selectedOutline.title ?? "")} onChange={(event) => updateChapter(selectedIndex, "title", event.target.value)} disabled={confirmed} /></header>
      <label><span>本章目标</span><textarea value={String(selectedOutline.objective ?? "")} onChange={(event) => updateChapter(selectedIndex, "objective", event.target.value)} disabled={confirmed} /></label>
      <label><span>核心冲突</span><textarea value={String(selectedOutline.conflict ?? "")} onChange={(event) => updateChapter(selectedIndex, "conflict", event.target.value)} disabled={confirmed} /></label>
      <label><span>章尾钩子</span><textarea value={String(selectedOutline.cliffhanger ?? "")} onChange={(event) => updateChapter(selectedIndex, "cliffhanger", event.target.value)} disabled={confirmed} /></label>
    </div> : null}
    <div className="cw2-actionbar">
      <span className="cw2-hint">{confirmed ? "大纲已确认。要调整结构可重新生成（会开新版本）。" : "确认后开始生成首批正文。"}</span>
      <button type="button" className="content-secondary-button" disabled={busy} onClick={onRegenerateOutline}><RefreshCw size={14} />重新生成大纲</button>
      {!confirmed ? <button type="button" className="content-primary-button" disabled={busy || !outline.length} onClick={() => onConfirm(outlineDraft)}>{busy ? <LoaderCircle size={16} /> : <Check size={16} />}确认大纲并生成首批正文</button> : null}
    </div>
  </section>;
}

function ContentCreationIntent({ intent, intentType, targetWords, chapterCount, batchSize, busy, canCancel, styleKey, onIntentChange, onIntentTypeChange, onTargetWordsChange, onChapterCountChange, onBatchSizeChange, onStyleChange, onCancel, onSubmit }: {
  intent: string;
  intentType: "title" | "genre" | "references";
  targetWords: number;
  chapterCount: number;
  batchSize: number;
  busy: boolean;
  canCancel: boolean;
  styleKey: string;
  onIntentChange: (value: string) => void;
  onIntentTypeChange: (value: "title" | "genre" | "references") => void;
  onTargetWordsChange: (value: number) => void;
  onChapterCountChange: (value: number) => void;
  onBatchSizeChange: (value: number) => void;
  onStyleChange: (key: string) => void;
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
    <header><span className="content-eyebrow">STEP 1 · 创作意图</span><h2>你想创作什么内容？</h2><p>选择一种输入方式。系统会识别方向、提炼同类爆款结构，再进入四维拆解。</p></header>
    <div className="content-intent-modes">{options.map((option) => <button type="button" key={option.id} className={intentType === option.id ? "is-active" : ""} onClick={() => onIntentTypeChange(option.id)}><strong>{option.label}</strong><span>{option.hint}</span></button>)}</div>
    <label className="content-intent-input"><span>{options.find((item) => item.id === intentType)?.label}</span><textarea value={intent} onChange={(event) => onIntentChange(event.target.value)} maxLength={2000} placeholder={placeholder} autoFocus /><small>{intent.length}/2000</small></label>
    <div className="content-plan-controls">
      <label><span>目标字数</span><select value={targetWords} onChange={(event) => onTargetWordsChange(Number(event.target.value))}><option value={10000}>10000 字</option><option value={20000}>20000 字</option><option value={30000}>30000 字</option><option value={50000}>50000 字</option></select></label>
      <label><span>章节数量</span><select value={chapterCount} onChange={(event) => onChapterCountChange(Number(event.target.value))}><option value={5}>5 章</option><option value={10}>10 章</option><option value={15}>15 章</option><option value={20}>20 章</option></select></label>
      <label><span>每批生成</span><select value={batchSize} onChange={(event) => onBatchSizeChange(Number(event.target.value))}><option value={2}>2 章</option><option value={3}>3 章</option></select></label>
      <label><span>视觉风格</span><select value={styleKey} onChange={(event) => onStyleChange(event.target.value)}>{styleOptions.map((style) => <option key={style.key} value={style.key}>{style.name}</option>)}</select></label>
    </div>
    <div className="content-flow-preview"><b>接下来</b><span>爆款结构拆解</span><ChevronRight14 /><span>{chapterCount} 章大纲</span><ChevronRight14 /><span>每批 {batchSize} 章正文</span><ChevronRight14 /><span>制作交接</span></div>
    <div className="content-inline-actions"><button type="button" className="content-secondary-button" onClick={onCancel} disabled={!canCancel || busy}>取消</button><button type="button" className="content-primary-button" disabled={intent.trim().length < 2 || busy} onClick={onSubmit}>{busy ? <LoaderCircle size={16} /> : <Sparkles size={16} />}{busy ? "正在进行结构拆解" : "开始结构拆解"}</button></div>
  </section>;
}

function ChevronRight14() { return <span className="cw2-flow-arrow">›</span>; }
