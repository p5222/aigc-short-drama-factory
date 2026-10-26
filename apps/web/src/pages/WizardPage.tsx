import { BookOpenCheck, BrainCircuit, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, FileText, FileUp, Image, Layers3, Loader2, Route, Save, Sparkles, UsersRound, Video, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { CreateProjectInput, CreationEstimate, ModelProvider } from "@aifilm/shared";
import { imageOutputQualityOptions, imageOutputSizeOptions, imageParameterMultiplier, normalizeImageOutputQuality, normalizeImageOutputSize } from "@aifilm/shared";
import { api } from "../lib/api";
import { ModelRoutePicker } from "../components/ModelRoutePicker";
import { analyzeSourceEpisodes, episodeScopeOptions, parseSampleManifest, type SourceEpisodeAnalysis } from "./wizardSourceModel";
import { clearWizardDraft, readWizardDraft, saveWizardDraft } from "./wizardDraftStorage";
import { buildEstimateInput, buildGenerationInput, creationBillingSignature, createCreationQuoteGate, isConfiguredModelRoute, normalizeWizardSourceType } from "./wizardRequestModel";
import { CREATION_ATTEMPT_KEY, getCreationRequestId } from "./creationAttemptStorage";
import { BEFORE_CREATOR_NAVIGATION } from "../lib/creatorNavigation";
import { InlineNotice, PageHeader } from "../design-system/ui";
import { StudioIcon, studioStages } from "../design-system/StudioIcon";
import "./creator-pages.css";

interface WizardPageProps {
  providers: ModelProvider[];
  canManageModels?: boolean;
  onCreated: (projectId: string) => void;
  onCreateContent: () => void;
}

type WizardStep = "story" | "settings" | "script";
type RouteTestState = { loading: boolean; ok?: boolean; message?: string; routeKey?: string };

const stepOrder: WizardStep[] = ["story", "settings", "script"];
const preferredTextProviderIds = ["dashscope-text", "deepseek", "manjiao"];
const preferredImageProviderIds = ["ripp-image", "manjiao-image", "dashscope-image", "doubao-seedream"];
const preferredVideoProviderIds = ["dashscope-video", "doubao-video"];
const failedImageModels = new Set(["wanx-v1", "wan2.5-t2i-preview"]);

const defaultForm: CreateProjectInput = {
  title: "",
  sourceType: "novel",
  content: "",
  mode: "director",
  genre: "",
  videoRatio: "9:16",
  artStyle: "",
  targetEpisodes: 1,
  textProvider: "dashscope-text",
  textModel: "qwen3.7-plus",
  imageProvider: "dashscope-image",
  imageModel: "wan2.6-t2i",
  imageSize: "2048x1152",
  imageQuality: "medium",
  videoProvider: "dashscope-video",
  videoModel: "wan2.7-i2v-2026-04-25"
};

const stylePresets = [
  "真实漫画",
  "真人电影感",
  "真人古装",
  "真人复古港片",
  "真人国风武侠",
  "真实光影",
  "第一人称 POV",
  "纪录片",
  "广告宣传片",
  "科技产品短片",
  "都市电影氛围",
  "雨夜黑色电影"
];

export function WizardPage({ providers, canManageModels = false, onCreated, onCreateContent }: WizardPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingModelTests = useRef(new Set<string>());
  const [recoverableDraft] = useState(() => loadDraft());
  const [form, setForm] = useState<CreateProjectInput>(() => normalizeDraft(defaultForm));
  const [step, setStep] = useState<WizardStep>("story");
  const [entrySelected, setEntrySelected] = useState(false);
  const [estimateSnapshot, setEstimateSnapshot] = useState<{ signature: string; sequence: number; value: CreationEstimate } | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const quoteGate = useRef(createCreationQuoteGate());
  const pendingQuote = useRef(false);
  const startInFlight = useRef(false);
  const billingSignature = useMemo(() => creationBillingSignature(normalizeDraft(form)), [form]);
  quoteGate.current.select(billingSignature);
  const estimate = estimateSnapshot && quoteGate.current.current(estimateSnapshot) ? estimateSnapshot.value : null;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [modelMessage, setModelMessage] = useState("");
  const [imageModelMessage, setImageModelMessage] = useState("");
  const [textRouteTest, setTextRouteTest] = useState<RouteTestState>({ loading: false });
  const [imageRouteTest, setImageRouteTest] = useState<RouteTestState>({ loading: false });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTestingModel, setIsTestingModel] = useState(false);
  const [isTestingImageModel, setIsTestingImageModel] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsed, setGenerationElapsed] = useState(0);

  // A fresh entry stays blank. Only an explicitly opened editor may replace the saved draft.
  useEffect(() => { if (entrySelected) saveWizardDraft(form); }, [form, entrySelected]);
  useEffect(() => {
    const guard = (event: Event) => {
      if (!startInFlight.current) return;
      event.preventDefault();
      if (event.type === "beforeunload") (event as BeforeUnloadEvent).returnValue = "";
      else setError("创建请求正在确认，请等待结果后再离开。无需重复点击创建。");
    };
    window.addEventListener(BEFORE_CREATOR_NAVIGATION, guard);
    window.addEventListener("beforeunload", guard);
    return () => { window.removeEventListener(BEFORE_CREATOR_NAVIGATION, guard); window.removeEventListener("beforeunload", guard); };
  }, []);
  useEffect(() => {
    setEstimateSnapshot(null);
    setMessage(current => current.startsWith("本次文本解析将冻结") ? "" : current);
  }, [billingSignature]);

  const words = useMemo(() => form.content.trim().length, [form.content]);
  const episodeAnalysis = useMemo(() => analyzeSourceEpisodes(form.content, form.sourceType), [form.content, form.sourceType]);
  const suggestedEpisodes = episodeAnalysis.maxEpisodes;
  const textProviders = useMemo(() => filterProviders(providers, "text", preferredTextProviderIds), [providers]);
  const imageProviders = useMemo(() => filterProviders(providers, "image", preferredImageProviderIds), [providers]);
  const videoProviders = useMemo(() => filterProviders(providers, "video", preferredVideoProviderIds), [providers]);
  const selectedTextProvider = textProviders.find((provider) => provider.id === form.textProvider) ?? textProviders[0];
  const selectedImageProvider = imageProviders.find((provider) => provider.id === form.imageProvider) ?? imageProviders[0];
  const selectedVideoProvider = videoProviders.find((provider) => provider.id === form.videoProvider) ?? videoProviders[0];
  const currentTextModels = selectedTextProvider?.models.length ? selectedTextProvider.models : ["deepseek-v4-pro"];
  const currentImageModels = useMemo(() => {
    const models = (selectedImageProvider?.models.length ? selectedImageProvider.models : ["wan2.6-t2i"]).filter((model) => !failedImageModels.has(model));
    return models.length ? models : ["wan2.6-t2i"];
  }, [selectedImageProvider]);
  const currentVideoModels = selectedVideoProvider?.models.length ? selectedVideoProvider.models : [form.videoModel || "wan2.7-i2v-2026-04-25"];
  const activeStepIndex = stepOrder.indexOf(step);

  useEffect(() => {
    if (!generationStartedAt) return;
    const timer = window.setInterval(() => setGenerationElapsed(Math.round((Date.now() - generationStartedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [generationStartedAt]);

  useEffect(() => {
    if (selectedTextProvider && form.textProvider !== selectedTextProvider.id) {
      setForm((draft) => ({ ...draft, textProvider: selectedTextProvider.id, textModel: selectedTextProvider.models[0] ?? draft.textModel }));
    }
    if (selectedImageProvider && form.imageProvider !== selectedImageProvider.id) {
      setForm((draft) => ({ ...draft, imageProvider: selectedImageProvider.id, imageModel: selectedImageProvider.models.find((model) => !failedImageModels.has(model)) ?? "wan2.6-t2i" }));
    }
  }, [selectedTextProvider, selectedImageProvider, form.textProvider, form.imageProvider]);

  useEffect(() => {
    if (!currentImageModels.includes(form.imageModel || "")) {
      setForm((draft) => ({ ...draft, imageModel: currentImageModels[0] }));
    }
  }, [currentImageModels, form.imageModel]);

  useEffect(() => {
    const current = form.targetEpisodes ?? 1;
    const allowed = episodeScopeOptions(episodeAnalysis).map((option) => option.value);
    if (!allowed.includes(current)) {
      setForm((draft) => ({ ...draft, targetEpisodes: allowed.at(-1) ?? 1 }));
    }
  }, [episodeAnalysis, form.targetEpisodes]);

  function goTo(nextStep: WizardStep) {
    if (startInFlight.current) return;
    if (stepOrder.indexOf(nextStep) > 0 && !form.content.trim()) {
      setError("请先粘贴故事正文或导入文本。");
      return;
    }
    setError("");
    setStep(nextStep);
  }

  function nextStep() {
    const next = stepOrder[Math.min(stepOrder.length - 1, activeStepIndex + 1)];
    goTo(next);
  }

  async function estimateCost() {
    if (pendingQuote.current || isGenerating) return null;
    const signature = creationBillingSignature(normalizeDraft(form));
    const ticket = quoteGate.current.begin(signature);
    pendingQuote.current = true;
    setIsEstimating(true);
    setEstimateSnapshot(null);
    setMessage("");
    setError("");
    try {
      const result = await api.estimate(buildEstimateInput(normalizeDraft(form)));
      if (!quoteGate.current.current(ticket)) return null;
      setEstimateSnapshot({ ...ticket, value: result });
      setMessage(`本次文本解析将冻结 ${result.estimatedCredits} 积分。请核对报价后再次点击确认创建；图片、视频和配音另行报价。`);
      return result;
    } catch (err) {
      if (quoteGate.current.current(ticket)) setError(err instanceof Error ? err.message : "积分估算失败");
      return null;
    } finally {
      pendingQuote.current = false;
      setIsEstimating(false);
    }
  }

  async function start() {
    if (startInFlight.current || pendingQuote.current) return;
    const input = buildGenerationInput(normalizeDraft(form));
    if (!input.content.trim()) {
      setError("请先粘贴小说、故事大纲或已有剧本。");
      setStep("story");
      return;
    }

    if (!estimate) {
      startInFlight.current = true;
      try { await estimateCost(); } finally { startInFlight.current = false; }
      return;
    }

    startInFlight.current = true;
    setIsGenerating(true);
    setGenerationStartedAt(Date.now());
    setGenerationElapsed(0);
    setMessage("正在生成全局设定、核心剧情和剧本。完成后会进入项目工作台继续生成分镜/视频资产。");
    setError("");
    void api.trackEvent({ eventName: "create_project_start", properties: { mode: input.mode, sourceType: input.sourceType, targetEpisodes: input.targetEpisodes } }).catch(() => undefined);
    try {
      let requestId: string;
      try {
        if (!saveWizardDraft(form)) throw new Error("draft storage unavailable");
        requestId = getCreationRequestId(window.sessionStorage, { ...input }, () => crypto.randomUUID());
      } catch { throw new Error("当前浏览器无法保存创建请求编号，请允许此站点使用浏览器存储后重试。尚未提交生成任务。"); }
      const result = await api.startCreation({ ...input, requestId, maxCredits: estimate.estimatedCredits });
      void api.trackEvent({ eventName: "create_project_success", projectId: result.project.id, entityType: "project", entityId: result.project.id, taskId: result.task.id, properties: { mode: result.mode } }).catch(() => undefined);
      clearWizardDraft();
      startInFlight.current = false;
      setMessage("项目已创建，正在打开制作工作区。");
      onCreated(result.project.id);
    } catch (err) {
      setEstimateSnapshot(null);
      setMessage("");
      void api.trackEvent({ eventName: "create_project_fail", properties: { message: err instanceof Error ? err.message : "生成失败" } }).catch(() => undefined);
      setError(err instanceof Error ? err.message : "未能确认创建结果，原稿已保留。请稍后重试，或向支持人员提交问题。");
    } finally {
      startInFlight.current = false;
      setIsGenerating(false);
      setGenerationStartedAt(null);
    }
  }

  async function testModel() {
    if (!canManageModels || pendingModelTests.current.has("text")) return;
    pendingModelTests.current.add("text");
    const routeKey = JSON.stringify([form.textProvider, form.textModel]);
    setIsTestingModel(true);
    setModelMessage("");
    setTextRouteTest({ loading: true, routeKey });
    setError("");
    try {
      const result = await api.modelTest({ textProvider: form.textProvider, textModel: form.textModel });
      setModelMessage(`${result.provider} / ${result.model}: ${result.message}`);
      setTextRouteTest({ loading: false, routeKey, ok: result.ok, message: `${result.provider} / ${result.model}: ${result.message}` });
    } catch (err) {
      setTextRouteTest({ loading: false, routeKey, ok: false, message: err instanceof Error ? err.message : "文本模型测试失败" });
    } finally {
      setIsTestingModel(false);
      pendingModelTests.current.delete("text");
    }
  }

  async function testImageModel() {
    if (!canManageModels || pendingModelTests.current.has("image")) return;
    pendingModelTests.current.add("image");
    const routeKey = JSON.stringify([form.imageProvider, form.imageModel]);
    setIsTestingImageModel(true);
    setImageModelMessage("");
    setImageRouteTest({ loading: true, routeKey });
    setError("");
    try {
      const result = await api.imageModelTest({ imageProvider: form.imageProvider, imageModel: form.imageModel });
      setImageModelMessage(`${result.provider} / ${result.model}: ${result.message}`);
      setImageRouteTest({ loading: false, routeKey, ok: result.ok, message: `${result.provider} / ${result.model}: ${result.message}` });
    } catch (err) {
      setImageRouteTest({ loading: false, routeKey, ok: false, message: err instanceof Error ? err.message : "生图模型测试失败" });
    } finally {
      setIsTestingImageModel(false);
      pendingModelTests.current.delete("image");
    }
  }

  function selectTextProvider(providerId: string) {
    const provider = textProviders.find((item) => item.id === providerId);
    setForm({ ...form, textProvider: providerId, textModel: provider?.models[0] ?? form.textModel });
    setModelMessage("");
    setTextRouteTest({ loading: false });
  }

  function selectImageProvider(providerId: string) {
    const provider = imageProviders.find((item) => item.id === providerId);
    setForm({ ...form, imageProvider: providerId, imageModel: provider?.models[0] ?? form.imageModel });
    setImageModelMessage("");
    setImageRouteTest({ loading: false });
  }

  async function loadBeijingMarriageSample() {
    setError("");
    setMessage("正在加载《北境婚书》示例...");
    try {
      const response = await fetch("/samples/beijing-marriage/manifest.json");
      if (!response.ok) throw new Error(`示例加载失败（HTTP ${response.status}）`);
      const sample = parseSampleManifest(await response.json());
      setForm((current) => ({
        ...current,
        title: sample.title,
        sourceType: sample.sourceType,
        content: sample.content,
        targetEpisodes: sample.targetEpisodes,
        artStyle: "新三维国风、3D半写实商业CG",
        videoRatio: "16:9"
      }));
      setMessage(`已导入《北境婚书》：${sample.targetEpisodes} 集，含 ${sample.assets.characters ?? 0} 个角色、${sample.assets.scenes ?? 0} 个场景、${sample.assets.props ?? 0} 个道具。`);
    } catch (reason) {
      setMessage("");
      setError(reason instanceof Error ? reason.message : "示例加载失败");
    }
  }

  function selectVideoProvider(providerId: string) {
    const provider = videoProviders.find((item) => item.id === providerId);
    setForm({ ...form, videoProvider: providerId, videoModel: provider?.models[0] ?? form.videoModel });
  }

  async function importTextFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setForm((current) => ({ ...current, title: current.title || file.name.replace(/\.[^.]+$/, ""), content: text }));
      setEstimateSnapshot(null);
    } catch {
      setError("读取文件失败，请重试或直接粘贴正文。");
    } finally { input.value = ""; }
  }

  function saveDraft() {
    if (!saveWizardDraft(form, true)) {
      setError("当前浏览器无法保存草稿，请复制正文到本地文档后再离开。");
      return;
    }
    setMessage("草稿已保存在当前浏览器。");
    setError("");
  }

  function openBlankEditor() {
    try { window.sessionStorage.removeItem(CREATION_ATTEMPT_KEY); } catch { /* start() reports unavailable storage before submitting. */ }
    setEntrySelected(true);
  }

  if (!entrySelected) {
    return <div className="page-stack creation-entry-page creator-page" data-tour-id="creation-entry">
      <PageHeader title="让一个新故事，从这里开始" description="选择你的创作起点，逐步完成从文字到画面的制作。" />
      <div className="creation-entry-grid">
        <button type="button" onClick={onCreateContent}><span className="creation-entry-icon"><StudioIcon stage="content" size={24} /></span><small>01 / 从灵感出发</small><strong>先写一个故事</strong><span>把一句灵感发展为大纲、章节和剧本，再进入漫剧制作。</span><b>开始内容创作 <ChevronRight size={18} /></b></button>
        <button type="button" onClick={openBlankEditor}><span className="creation-entry-icon"><FileUp size={24} /></span><small>02 / 从原稿出发</small><strong>导入小说或剧本</strong><span>导入你准备好的文本，确认视觉风格与制作范围，建立新项目。</span><b>导入我的原稿 <ChevronRight size={18} /></b></button>
      </div>
      {recoverableDraft?.content.trim() ? <section className="creation-draft-recovery" aria-label="可恢复的草稿">
        <FileText size={22} /><div><strong>{recoverableDraft.title || "未命名草稿"}</strong><span>此浏览器有一份未完成草稿 · {recoverableDraft.content.trim().length.toLocaleString()} 字</span></div>
        <button type="button" className="ghost-button" onClick={() => { setForm(normalizeDraft(recoverableDraft)); setEntrySelected(true); }}>恢复草稿</button>
      </section> : null}
      <section className="creation-journey" aria-label="漫剧制作流程">
        <div><span className="section-kicker">你的制作路线</span><h2>每一步，都有自己的工作空间</h2></div>
        <ol>{studioStages.map(stage => <li key={stage.id}><span><StudioIcon stage={stage.id} size={20} /></span><strong>{stage.label}</strong><small>{stage.detail}</small></li>)}</ol>
      </section>
      <p className="creator-page-footnote">新项目从空白开始。已有作品可在“我的作品”继续编辑；每次生成前都会单独确认费用。</p>
    </div>;
  }

  return (
    <div className="page-stack creation-workbench u-wizard creator-page" data-tour-id="creation-entry">
      <PageHeader title="新建漫剧" description="把故事、画面和制作范围准备好，开启你的新作品。" actions={<button className="ghost-button" disabled={isGenerating} onClick={saveDraft}>
          <Save size={18} />保存草稿
        </button>} />

      <nav className="u-step-tabs" aria-label="创作步骤">
        {stepOrder.map((item, index) => (
          <button
            className={item === step ? "active" : index < activeStepIndex ? "done" : ""}
            key={item}
            aria-current={item === step ? "step" : undefined}
            disabled={isGenerating}
            onClick={() => goTo(item)}
            type="button"
          >
            <span>{index < activeStepIndex ? "✓" : index + 1}</span>
            <i>{stepLabel(item)}</i>
            <small>{stepHint(item, form.sourceType)}</small>
          </button>
        ))}
      </nav>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {message && !isGenerating ? <InlineNotice tone="info" onDismiss={() => setMessage("")}>{message}</InlineNotice> : null}
      <fieldset className="creator-wizard-fields" disabled={isGenerating}><legend className="creator-sr-only">当前创作步骤</legend>
      {step !== "story" ? <div className="creation-context-strip"><span><FileText size={17} /><strong>{form.title || "未命名作品"}</strong></span><span>{words.toLocaleString()} 字</span><span>本次 {form.targetEpisodes ?? 1} 集</span><button type="button" onClick={() => goTo("story")}>修改原稿</button></div> : null}
      {step === "story" ? (
        <StoryStep
          fileInputRef={fileInputRef}
          form={form}
          imageMessage={imageModelMessage}
          message={message}
          modelMessage={modelMessage}
          words={words}
          suggestedEpisodes={suggestedEpisodes}
          episodeAnalysis={episodeAnalysis}
          onChange={setForm}
          onImport={importTextFile}
          onSample={() => void loadBeijingMarriageSample()}
          onSave={saveDraft}
          onNext={nextStep}
        />
      ) : null}

      {step === "settings" ? (
        <SettingsStep
          form={form}
          onChange={setForm}
          onBack={() => goTo("story")}
          onNext={nextStep}
        />
      ) : null}

      {step === "script" ? (
        <ScriptStep
          canManageModels={canManageModels}
          currentImageModels={currentImageModels}
          currentTextModels={currentTextModels}
          currentVideoModels={currentVideoModels}
          estimate={estimate}
          form={form}
          imageModelMessage={imageModelMessage}
          imageProviders={imageProviders}
          videoProviders={videoProviders}
          isTestingImageModel={isTestingImageModel}
          isTestingModel={isTestingModel}
          modelMessage={modelMessage}
          textRouteTest={textRouteTest.routeKey === JSON.stringify([form.textProvider, form.textModel]) ? textRouteTest : { loading: false }}
          imageRouteTest={imageRouteTest.routeKey === JSON.stringify([form.imageProvider, form.imageModel]) ? imageRouteTest : { loading: false }}
          selectedImageProvider={selectedImageProvider}
          selectedTextProvider={selectedTextProvider}
          selectedVideoProvider={selectedVideoProvider}
          textProviders={textProviders}
          onChange={setForm}
          onEstimate={estimateCost}
          onImageProvider={selectImageProvider}
          onTextProvider={selectTextProvider}
          onVideoProvider={selectVideoProvider}
          onTestImageModel={testImageModel}
          onTestModel={testModel}
          error={error}
          generationElapsed={generationElapsed}
          isGenerating={isGenerating}
          isEstimating={isEstimating}
          message={message}
          onStart={start}
          onBack={() => goTo("settings")}
        />
      ) : null}
      </fieldset>
    </div>
  );
}

function StoryStep({
  fileInputRef,
  form,
  words,
  suggestedEpisodes,
  episodeAnalysis,
  onChange,
  onImport,
  onSample,
  onSave,
  onNext
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  form: CreateProjectInput;
  imageMessage: string;
  message: string;
  modelMessage: string;
  words: number;
  suggestedEpisodes: number;
  episodeAnalysis: SourceEpisodeAnalysis;
  onChange: (form: CreateProjectInput) => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onSample: () => void;
  onSave: () => void;
  onNext: () => void;
}) {
  return (
    <div className="u-wizard-grid story-step-redesign">
      <section className="u-card story-input-card" data-tour-id="story-input">
        <div className="u-card-head">
          <div>
            <span className="section-kicker">STEP 1</span>
            <h2>先把故事放进来</h2>
            <p>支持小说、大纲和已有剧本。原稿会保留在项目中，方便随时对照。</p>
          </div>
        </div>

        <div className="source-type-switch" role="radiogroup" aria-label="原稿类型">
          <button className={form.sourceType !== "script" ? "active" : ""} onClick={() => onChange({ ...form, sourceType: "novel" })} role="radio" aria-checked={form.sourceType !== "script"} type="button">
            <BookOpenCheck size={19} />
            <span><strong>小说 / 故事</strong><small>改编为可拍摄的剧本</small></span>
          </button>
          <button className={form.sourceType === "script" ? "active" : ""} onClick={() => onChange({ ...form, sourceType: "script" })} role="radio" aria-checked={form.sourceType === "script"} type="button">
            <FileText size={19} />
            <span><strong>已有剧本</strong><small>保留剧情，直接识别场次与生产资产</small></span>
          </button>
        </div>

        <label className="field">
          <span>作品名称</span>
          <input value={form.title} onChange={(event) => onChange({ ...form, title: event.target.value })} placeholder="可不填，生成时会自动命名" />
        </label>

        <label className="field story-input-field">
          <span>{form.sourceType === "script" ? "剧本文本" : "小说正文"}</span>
          <textarea
            aria-label={form.sourceType === "script" ? "剧本文本" : "小说正文"}
            value={form.content}
            onChange={(event) => onChange({ ...form, content: event.target.value })}
            placeholder={form.sourceType === "script" ? "粘贴已有剧本，建议包含场次、地点、角色、动作和对白。" : "粘贴小说正文或故事大纲，系统会先改编为标准剧本，再进入资产生产。"}
          />
        </label>

        <div className="inline-actions input-toolbar">
          <input ref={fileInputRef} type="file" accept=".txt,.md" hidden onChange={onImport} />
          <button className="ghost-button" onClick={() => fileInputRef.current?.click()} type="button">
            <FileUp size={18} />导入文本文件
          </button>
          <button className="ghost-button" onClick={onSample} type="button">
            <Sparkles size={18} />导入示例：北境婚书
          </button>
          <span className="creation-word-count">{words.toLocaleString()} 字 · 支持 TXT / Markdown</span>
        </div>

      </section>

      <aside className="u-side-stack">
        <section className="u-card import-stats-card">
          <div className="import-summary-head"><h3>本次制作范围</h3><span>{form.sourceType === "script" ? "剧本直拆" : "小说改编"}</span></div>
          <div className="mini-metrics import-metrics">
            <div><strong>{words.toLocaleString()}</strong><span>字数</span></div>
            <div><strong>{suggestedEpisodes}</strong><span>结构支持集数</span></div>
          </div>
          <label className="field episode-select-field">
            <span>本次生成范围</span>
            <select
              value={form.targetEpisodes ?? 1}
              onChange={(event) => onChange({ ...form, targetEpisodes: Number(event.target.value) })}
            >
              {episodeScopeOptions(episodeAnalysis).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <small>{episodeAnalysis.summary}。选择范围只控制本次先生产多少集，不会把全部内容强行重切。</small>
          {words > 0 && words < 2000 ? <p className="warning-text">短篇内容会自动减少场次与镜头，保留故事节奏。</p> : null}
          <button className="primary-button full-button" onClick={onNext} disabled={!form.content.trim()} type="button">
            下一步：全局设定 <ChevronRight size={18} />
          </button>
        </section>

        <details className="u-card ai-plan-card creation-process-detail">
          <summary>原稿将如何变成漫剧</summary>
          {(form.sourceType === "script"
            ? ["识别集与场次", "提取角色 / 场景 / 道具", "生成分镜拆解", "建立一致性资产", "进入图片与视频生产"]
            : ["分析小说结构", "转换为标准剧本", "识别集与场次", "提取角色 / 场景 / 道具", "进入分镜与资产生产"]
          ).map((item, index) => (
            <div className="ai-step-line" key={item}>
              <span>{index + 1}</span>
              <strong>{item}</strong>
            </div>
          ))}
        </details>
      </aside>
    </div>
  );
}
function SettingsStep({
  form,
  onChange,
  onBack,
  onNext
}: {
  form: CreateProjectInput;
  onChange: (form: CreateProjectInput) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="u-wizard-grid creation-settings-grid">
    <section className="u-card settings-card settings-step-redesign">
      <div className="u-card-head">
        <div>
          <span className="section-kicker">STEP 2</span>
          <h2>定下作品的视觉方向</h2>
          <p>统一画幅与风格，让角色、场景和镜头保持一致。</p>
        </div>
      </div>

      <div className="setting-block" data-tour-id="style-picker">
        <div className="setting-title"><span>1</span><div><h3>视频发布在哪个平台？</h3><p>画面比例会影响分镜构图、首帧图和后续视频裁切。</p></div></div>
        <div className="choice-grid two">
          <ChoiceCard active={form.videoRatio === "9:16"} title="竖屏 9:16" desc="适合抖音、视频号、小红书等短视频平台" badge="推荐" onClick={() => onChange({ ...form, videoRatio: "9:16" })} />
          <ChoiceCard active={form.videoRatio === "16:9"} title="横屏 16:9" desc="适合 B 站、横版视频和网页播放" onClick={() => onChange({ ...form, videoRatio: "16:9" })} />
        </div>
      </div>

      <div className="setting-block">
        <div className="setting-title"><span>2</span><div><h3>想要什么画面风格？</h3><p>风格会贯穿角色、场景、分镜图和视频画面。</p></div></div>
        <div className="style-chip-grid">
          {stylePresets.map((style) => (
            <button className={form.artStyle === style ? "active" : ""} aria-pressed={form.artStyle === style} key={style} onClick={() => onChange({ ...form, artStyle: style })} type="button">
              {style}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-block">
        <div className="setting-title"><span>3</span><div><h3>补充题材倾向</h3><p>不填时由 AI 根据正文自动判断。</p></div></div>
        <div className="form-grid two">
          <label className="field"><span>题材</span><input value={form.genre} onChange={(event) => onChange({ ...form, genre: event.target.value })} placeholder="甜宠 / 悬疑 / 复仇 / 古风" /></label>
          <label className="field"><span>画风补充</span><input value={form.artStyle} onChange={(event) => onChange({ ...form, artStyle: event.target.value })} placeholder="例如：浅蓝柔和国漫写实" /></label>
        </div>
      </div>

    </section>
    <aside className="u-side-stack">
      <section className="u-card creation-setting-preview">
        <span className="section-kicker">画幅预览</span>
        <div className="creation-ratio-stage" aria-label={`${form.videoRatio} 画幅预览`}><div className={form.videoRatio === "16:9" ? "is-landscape" : ""}><span>{form.videoRatio}</span><i /><i /></div></div>
        <h3>{form.artStyle || "由故事决定画面风格"}</h3>
        <dl><div><dt>题材</dt><dd>{form.genre || "根据原稿识别"}</dd></div><div><dt>本次范围</dt><dd>{form.targetEpisodes ?? 1} 集</dd></div><div><dt>画面方向</dt><dd>{form.videoRatio === "16:9" ? "横屏 · 叙事画幅" : "竖屏 · 移动端"}</dd></div></dl>
        <p>画幅示意用于查看比例，实际画面将在资产和分镜阶段生成。</p>
        <div className="creation-step-actions">
        <button className="primary-button" onClick={onNext} type="button">
          下一步：确认创建 <ChevronRight size={18} />
        </button>
        <button className="ghost-button" onClick={onBack} type="button">返回原稿</button>
        </div>
      </section>
    </aside>
    </div>
  );
}
function ScriptStep({
  form,
  canManageModels,
  textProviders,
  imageProviders,
  selectedTextProvider,
  selectedImageProvider,
  currentTextModels,
  currentImageModels,
  currentVideoModels,
  videoProviders,
  selectedVideoProvider,
  estimate,
  textRouteTest,
  imageRouteTest,
  isTestingModel,
  isTestingImageModel,
  onChange,
  onTextProvider,
  onImageProvider,
  onVideoProvider,
  onTestModel,
  onTestImageModel,
  onEstimate,
  error,
  generationElapsed,
  isGenerating,
  isEstimating,
  message,
  onStart,
  onBack
}: {
  form: CreateProjectInput;
  canManageModels: boolean;
  textProviders: ModelProvider[];
  imageProviders: ModelProvider[];
  videoProviders: ModelProvider[];
  selectedTextProvider?: ModelProvider;
  selectedImageProvider?: ModelProvider;
  selectedVideoProvider?: ModelProvider;
  currentTextModels: string[];
  currentImageModels: string[];
  currentVideoModels: string[];
  estimate: CreationEstimate | null;
  modelMessage: string;
  textRouteTest: RouteTestState;
  imageRouteTest: RouteTestState;
  imageModelMessage: string;
  isTestingModel: boolean;
  isTestingImageModel: boolean;
  onChange: (form: CreateProjectInput) => void;
  onTextProvider: (providerId: string) => void;
  onImageProvider: (providerId: string) => void;
  onVideoProvider: (providerId: string) => void;
  onTestModel: () => void;
  onTestImageModel: () => void;
  onEstimate: () => void;
  error: string;
  generationElapsed: number;
  isGenerating: boolean;
  isEstimating: boolean;
  message: string;
  onStart: () => void;
  onBack: () => void;
}) {
  const imageMultiplier = imageParameterMultiplier(form.imageSize, form.imageQuality).toFixed(2);
  const [activeRoute, setActiveRoute] = useState<"text" | "image" | "video">("text");
  const scriptAssets = [
    { title: "全局设定", text: "世界观、题材、人设关系、主角动机和内容边界。", icon: <BrainCircuit size={18} />, meta: form.genre || "AI 自动识别" },
    { title: form.sourceType === "script" ? "场次结构" : "核心剧情", text: form.sourceType === "script" ? "识别集、场次、时空、出场角色和剧情作用。" : "按集数梳理事件、情绪弧光、反转点和结尾钩子。", icon: <BookOpenCheck size={18} />, meta: `${form.targetEpisodes ?? 1} 集` },
    { title: form.sourceType === "script" ? "剧本拆解" : "剧本改编", text: form.sourceType === "script" ? "保留原剧情，规范动作、台词、旁白和节奏。" : "把小说叙事转换为可拍摄的场景、动作、台词和旁白。", icon: <FileText size={18} />, meta: form.textModel || "待选择" },
    { title: "角色卡", text: "固定外貌、服装、性格、声线和一致性提示词。", icon: <UsersRound size={18} />, meta: form.videoRatio }
  ];
  const textRouteConfigured = isConfiguredModelRoute(textProviders, "text", form.textProvider, form.textModel);
  const imageRouteConfigured = isConfiguredModelRoute(imageProviders, "image", form.imageProvider, form.imageModel);
  const videoRouteConfigured = isConfiguredModelRoute(videoProviders, "video", form.videoProvider, form.videoModel);
  const routeReady = textRouteConfigured && imageRouteConfigured && videoRouteConfigured;

  return (
    <div className="u-wizard-grid wizard-balance-grid wizard-script-redesign shot-plan-workspace">
      <section className="u-card script-plan-card wizard-script-card shot-plan-main">
        <div className="u-card-head wizard-script-title">
          <div>
            <span className="section-kicker">STEP 3</span>
            <h2>核对设置，开始制作</h2>
            <p>本次创建只解析文本。图片、视频与配音在后续步骤单独报价。</p>
          </div>
          <span className="plan-ready"><Route size={16} />{routeReady ? "当前制作配置" : "模型配置待完善"}</span>
        </div>

        <dl className="creation-review-grid">
          <div><dt>原稿类型</dt><dd>{form.sourceType === "script" ? "已有剧本" : "小说 / 故事"}</dd></div>
          <div><dt>制作范围</dt><dd>{form.targetEpisodes ?? 1} 集</dd></div>
          <div><dt>画面比例</dt><dd>{form.videoRatio}</dd></div>
          <div><dt>视觉风格</dt><dd>{form.artStyle || "根据故事识别"}</dd></div>
        </dl>
        <details className="creation-source-review"><summary>查看原稿 · {form.content.trim().length.toLocaleString()} 字</summary><p>{form.content}</p></details>

        <div className="script-output-heading"><div><strong>将自动完成</strong><span>创建后进入项目工作台继续调整</span></div><span>{form.sourceType === "script" ? "剧本直接拆解" : "小说先转为剧本"}</span></div>
        <div className="script-preview-list script-output-map compact-output-map">
          {scriptAssets.map((asset) => (
            <PreviewLine key={asset.title} title={asset.title} text={asset.text} icon={asset.icon} meta={asset.meta} />
          ))}
        </div>
        <button className="ghost-button" onClick={onBack} disabled={isGenerating} type="button">返回设定</button>
      </section>

      <aside className="u-side-stack">
        <section className="u-card creation-checkout">
          <EstimatePanel estimate={estimate} form={form} onEstimate={onEstimate} isEstimating={isEstimating} />
          <button className="primary-button full-button" onClick={onStart} disabled={isGenerating || isEstimating || !routeReady} type="button">
            {isGenerating ? <Loader2 size={18} className="spin-icon" /> : <WandSparkles size={18} />}
            {isGenerating ? "正在建立项目..." : isEstimating ? "正在获取报价..." : estimate ? `确认冻结 ${estimate.estimatedCredits} 积分并创建` : "获取文本报价并确认"}
          </button>
          {estimate ? <button className="ui-text-button" type="button" onClick={onEstimate} disabled={isGenerating || isEstimating}>重新获取报价</button> : null}
          {isGenerating ? <OperationProgress title={form.sourceType === "script" ? "剧本拆解中" : "小说改编中"} elapsed={generationElapsed} detail="系统正在建立剧本、场次、角色和场景，请不要重复提交。" /> : null}
        </section>
        <details className="u-card route-card-clean route-card-polished recommended-route-card creation-model-settings" open={!routeReady || undefined}>
          <summary><Route size={18} /><span>生成模型与参数<small>{routeReady ? "已选择可配置模型，按需调整" : "请完善模型配置后继续"}</small></span><ChevronDown size={16} /></summary>
          <div className="recommended-route-head model-route-head">
            <div><span>模型路由</span><strong>{routeReady ? "已选择平台配置" : "请检查模型选择"}</strong></div>
            <Route size={20} />
          </div>
          <div className="model-route-channels">
            <RouteChannel icon={<FileText size={17} />} title="文本推理" purpose="剧本解析、角色与场景提取" model={form.textModel || "自动选择"} active={activeRoute === "text"} onClick={() => setActiveRoute(activeRoute === "text" ? "image" : "text")} />
            {activeRoute === "text" ? <div className="route-channel-detail">
              <label className="field"><span>文本渠道与模型</span><ModelRoutePicker modality="text" providers={textProviders} value={{ providerId: form.textProvider || "", model: form.textModel || "" }} onChange={(providerId, model) => onChange({ ...form, textProvider: providerId, textModel: model })} /></label>
              <p>{cleanProviderHint(selectedTextProvider?.costHint, "用于剧本解析、角色卡和分镜拆解。")}</p>
              {canManageModels ? <><button className="ghost-button full-button" onClick={onTestModel} disabled={isTestingModel || !textRouteConfigured} type="button">{isTestingModel ? "测试中..." : "测试文本模型"}</button><RouteTestMessage state={textRouteTest} /></> : null}
            </div> : null}

            <RouteChannel icon={<Image size={17} />} title="图像生成" purpose="角色、场景与分镜首帧" model={form.imageModel || "自动选择"} active={activeRoute === "image"} onClick={() => setActiveRoute("image")} />
            {activeRoute === "image" ? <div className="route-channel-detail">
              <label className="field"><span>生图渠道与模型</span><ModelRoutePicker modality="image" providers={imageProviders} value={{ providerId: form.imageProvider || "", model: form.imageModel || "" }} onChange={(providerId, model) => onChange({ ...form, imageProvider: providerId, imageModel: model })} /></label>
              <div className="route-param-grid">
                <label className="field"><span>分辨率</span><select value={normalizeImageOutputSize(form.imageSize)} onChange={(event) => onChange({ ...form, imageSize: event.target.value })}>{imageOutputSizeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <label className="field"><span>质量</span><select value={normalizeImageOutputQuality(form.imageQuality)} onChange={(event) => onChange({ ...form, imageQuality: event.target.value })}>{imageOutputQualityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              </div>
              <p>{cleanProviderHint(selectedImageProvider?.costHint, "用于角色参考图、场景图和分镜首帧。")}</p>
              {canManageModels ? <><button className="ghost-button full-button" onClick={onTestImageModel} disabled={isTestingImageModel || !imageRouteConfigured} type="button">{isTestingImageModel ? "测试中..." : "测试生图模型"}</button><RouteTestMessage state={imageRouteTest} /></> : null}
            </div> : null}

            <RouteChannel icon={<Video size={17} />} title="视频生成" purpose="后续分镜视频与片段生成" model={form.videoModel || "自动选择"} active={activeRoute === "video"} warning={!selectedVideoProvider?.enabled} onClick={() => setActiveRoute("video")} />
            {activeRoute === "video" ? <div className="route-channel-detail">
              <label className="field"><span>视频渠道与模型</span><ModelRoutePicker modality="video" providers={videoProviders} value={{ providerId: form.videoProvider || "", model: form.videoModel || "" }} onChange={(providerId, model) => onChange({ ...form, videoProvider: providerId, videoModel: model })} /></label>
              <p>{cleanProviderHint(selectedVideoProvider?.costHint, "用于项目创建后的镜头视频生成。")}</p>
            </div> : null}
          </div>
          <p className="route-cost-note">这里只确认模型已列入平台配置，不代表连接已验证。{canManageModels ? "可测试文本与图像连接；视频会在生成时校验。" : "连接问题请联系管理员；实际可用性会在生成时校验。"}</p>
          <div className="route-cost-note"><CircleDollarSign size={15} /><span>创建前仅锁定路由，不产生扣费；实际按任务和后台价格结算。</span><strong>x{imageMultiplier}</strong></div>
        </details>
      </aside>
    </div>
  );
}
function EstimatePanel({ estimate, form, onEstimate, isEstimating }: { estimate: CreationEstimate | null; form: CreateProjectInput; onEstimate: () => void; isEstimating: boolean }) {
  if (!estimate) {
    return (
      <div className="estimate u-estimate wizard-estimate-dock estimate-panel-polished">
        <div className="wizard-estimate-total">
          <span>本次文本解析冻结积分</span>
          <strong>{isEstimating ? "报价中" : "待确认"}</strong>
        </div>
        <p>按文本渠道、模型和本次集数获取报价。查看报价不扣积分，确认创建后才冻结；图片、视频和配音在对应步骤另行报价。</p>
      </div>
    );
  }

  return (
    <div className="estimate u-estimate wizard-estimate-dock estimate-panel-polished ready">
      <div className="wizard-estimate-total">
        <span>本次文本解析冻结积分</span>
        <strong>{estimate.estimatedCredits}</strong>
      </div>
      <div className="wizard-estimate-breakdown">
        {(estimate.breakdown ?? []).map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.totalCredits} 积分</strong>
            <small>{item.quantity} × {item.unitCredits} · {item.model || item.providerId || "未指定模型"}</small>
          </div>
        ))}
      </div>
      <p>文本模型：{estimate.breakdown?.[0]?.providerId || form.textProvider}/{estimate.breakdown?.[0]?.model || form.textModel}。本次处理 {estimate.suggestedEpisodes} 集。</p>
      {estimate.notes.slice(1).filter((note) => !note.includes("最终单价") && !note.includes("模型基准价")).map((note) => <p key={note}>{note}</p>)}
    </div>
  );
}
function OperationProgress({ title, elapsed, detail }: { title: string; elapsed: number; detail: string }) {
  return (
    <div className="operation-progress" role="status" aria-live="polite" aria-busy="true">
      <div>
        <Loader2 size={17} className="spin-icon" />
        <strong>{title}</strong>
        <span>{elapsed}s</span>
      </div>
      <div className="operation-progress-track creator-progress-indeterminate" aria-hidden="true"><span /></div>
      <p>{detail}</p>
      <small>正在等待处理结果；耗时取决于原稿长度和模型。尚未收到结果前请勿重复创建。</small>
    </div>
  );
}

function RouteChannel({ icon, title, purpose, model, active, warning, onClick }: { icon: ReactNode; title: string; purpose: string; model: string; active: boolean; warning?: boolean; onClick: () => void }) {
  return <button className={active ? "route-channel is-active" : "route-channel"} onClick={onClick} type="button"><i>{icon}</i><span><strong>{title}<em className={warning ? "is-warning" : ""} /></strong><small>{purpose}</small></span><b>{model}</b><ChevronDown size={16} className={active ? "is-open" : ""} /></button>;
}

function ChoiceCard({ active, title, desc, badge, onClick }: { active: boolean; title: string; desc: string; badge?: string; onClick: () => void }) {
  return <button className={active ? "choice-card active" : "choice-card"} aria-pressed={active} onClick={onClick} type="button"><strong>{title}</strong><span>{desc}</span>{badge ? <em>{badge}</em> : null}</button>;
}

function PreviewLine({ title, text, icon, meta }: { title: string; text: string; icon?: ReactNode; meta?: string }) {
  return (
    <div className="preview-line">
      {icon ? <i>{icon}</i> : null}
      <strong>{title}</strong>
      <span>{text}</span>
      {meta ? <em>{meta}</em> : null}
    </div>
  );
}

function RouteTestMessage({ state }: { state: RouteTestState }) {
  if (state.loading) return <small className="route-test-message loading">测试中，请等待模型返回...</small>;
  if (!state.message) return null;
  return <small className={state.ok ? "route-test-message success" : "route-test-message failed"}>{state.message}</small>;
}

function cleanProviderHint(hint: string | undefined, fallback: string) {
  if (!hint) return fallback;
  const blocked = ["MVP 优先", "优先接百炼免费额度", "最终单价", "模型基准价 × 参数倍率"];
  return blocked.some((item) => hint.includes(item)) ? fallback : hint;
}

function filterProviders(providers: ModelProvider[], modality: ModelProvider["modality"], preferredIds: string[]) {
  const eligible = providers.filter((provider) => provider.modality === modality && !provider.id.toLowerCase().startsWith("zml"));
  const enabled = eligible.filter((provider) => provider.enabled);
  const source = enabled.length ? enabled : eligible;
  return [...source].sort((a, b) => {
    const aIndex = preferredIds.indexOf(a.id);
    const bIndex = preferredIds.indexOf(b.id);
    const safeA = aIndex === -1 ? 999 : aIndex;
    const safeB = bIndex === -1 ? 999 : bIndex;
    return safeA - safeB || a.name.localeCompare(b.name);
  });
}

function normalizeDraft(form: CreateProjectInput): CreateProjectInput {
  const imageProvider = form.imageProvider || "dashscope-image";
  const imageModel = !form.imageModel || failedImageModels.has(form.imageModel) ? "wan2.6-t2i" : form.imageModel;
  return {
    ...defaultForm,
    ...form,
    sourceType: normalizeWizardSourceType(form.sourceType),
    targetEpisodes: Math.max(1, form.targetEpisodes ?? 1),
    textProvider: form.textProvider || defaultForm.textProvider,
    textModel: form.textModel || defaultForm.textModel,
    imageProvider,
    imageModel,
    imageSize: normalizeImageOutputSize(form.imageSize),
    imageQuality: normalizeImageOutputQuality(form.imageQuality)
  };
}

function stepLabel(step: WizardStep) {
  const map: Record<WizardStep, string> = {
    story: "导入原稿",
    settings: "全局设定",
    script: "确认创建"
  };
  return map[step];
}

function stepHint(step: WizardStep, sourceType: CreateProjectInput["sourceType"]) {
  const map: Record<WizardStep, string> = {
    story: sourceType === "script" ? "导入已有剧本" : "导入小说原文",
    settings: "选择画幅与视觉风格",
    script: "核对内容与本次费用"
  };
  return map[step];
}

function loadDraft(): CreateProjectInput | null {
  return readWizardDraft();
}
