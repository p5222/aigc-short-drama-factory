import { BookOpenCheck, BrainCircuit, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, FileText, FileUp, Image, Layers3, Loader2, Route, Save, Sparkles, UsersRound, Video, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { CreateProjectInput, CreationEstimate, ModelProvider } from "@aifilm/shared";
import { imageOutputQualityOptions, imageOutputSizeOptions, imageParameterMultiplier, normalizeImageOutputQuality, normalizeImageOutputSize } from "@aifilm/shared";
import { api } from "../lib/api";

interface WizardPageProps {
  providers: ModelProvider[];
  onCreated: (projectId: string) => void;
  onCreateContent: () => void;
}

type WizardStep = "story" | "settings" | "script";
type RouteTestState = { loading: boolean; ok?: boolean; message?: string };

const stepOrder: WizardStep[] = ["story", "settings", "script"];
const preferredTextProviderIds = ["dashscope-text", "deepseek", "zml-text"];
const preferredImageProviderIds = ["dashscope-image", "zml-image", "doubao-seedream"];
const preferredVideoProviderIds = ["dashscope-video", "zml-video", "doubao-video"];
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

export function WizardPage({ providers, onCreated, onCreateContent }: WizardPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<CreateProjectInput>(() => normalizeDraft(loadDraft() ?? defaultForm));
  const [step, setStep] = useState<WizardStep>("story");
  const [entrySelected, setEntrySelected] = useState(Boolean(loadDraft()?.content));
  const [estimate, setEstimate] = useState<CreationEstimate | null>(null);
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

  const words = useMemo(() => form.content.trim().length, [form.content]);
  const suggestedEpisodes = Math.max(1, Math.min(20, Math.ceil(Math.max(words, 800) / 2000)));
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
    if (current > suggestedEpisodes) {
      setForm((draft) => ({ ...draft, targetEpisodes: suggestedEpisodes }));
    }
  }, [form.targetEpisodes, suggestedEpisodes]);

  function goTo(nextStep: WizardStep) {
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
    setError("");
    try {
      const result = await api.estimate({
        content: form.content,
        mode: form.mode,
        targetEpisodes: form.targetEpisodes,
        textProvider: form.textProvider,
        textModel: form.textModel,
        imageProvider: form.imageProvider,
        imageModel: form.imageModel,
        imageSize: form.imageSize,
        imageQuality: form.imageQuality,
        videoProvider: form.videoProvider,
        videoModel: form.videoModel
      });
      setEstimate(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "积分估算失败");
    }
  }

  async function start() {
    const input = buildGenerationInput(form);
    if (!input.content.trim()) {
      setError("请先粘贴小说、故事大纲或已有剧本。");
      setStep("story");
      return;
    }

    setIsGenerating(true);
    setGenerationStartedAt(Date.now());
    setGenerationElapsed(0);
    setMessage("正在生成全局设定、核心剧情和剧本。完成后会进入项目工作台继续生成分镜/视频资产。");
    setError("");
    void api.trackEvent({ eventName: "create_project_start", properties: { mode: input.mode, sourceType: input.sourceType, targetEpisodes: input.targetEpisodes } }).catch(() => undefined);
    try {
      const result = await api.startCreation(input);
      void api.trackEvent({ eventName: "create_project_success", projectId: result.project.id, entityType: "project", entityId: result.project.id, taskId: result.task.id, properties: { mode: result.mode } }).catch(() => undefined);
      localStorage.removeItem("aifilm_creation_draft");
      setMessage(`已生成项目，模式：${result.mode === "real" ? "真实模型" : result.mode === "queued" ? "队列处理中" : "本地结构化"}`);
      onCreated(result.project.id);
    } catch (err) {
      void api.trackEvent({ eventName: "create_project_fail", properties: { message: err instanceof Error ? err.message : "生成失败" } }).catch(() => undefined);
      setError(err instanceof Error ? err.message : "生成失败，请检查模型配置、数据库或积分余额。");
    } finally {
      setIsGenerating(false);
      setGenerationStartedAt(null);
    }
  }

  async function testModel() {
    setIsTestingModel(true);
    setModelMessage("");
    setTextRouteTest({ loading: true });
    setError("");
    try {
      const result = await api.modelTest({ textProvider: form.textProvider, textModel: form.textModel });
      setModelMessage(`${result.provider} / ${result.model}: ${result.message}`);
      setTextRouteTest({ loading: false, ok: result.ok, message: `${result.provider} / ${result.model}: ${result.message}` });
    } catch (err) {
      setTextRouteTest({ loading: false, ok: false, message: err instanceof Error ? err.message : "文本模型测试失败" });
    } finally {
      setIsTestingModel(false);
    }
  }

  async function testImageModel() {
    setIsTestingImageModel(true);
    setImageModelMessage("");
    setImageRouteTest({ loading: true });
    setError("");
    try {
      const result = await api.imageModelTest({ imageProvider: form.imageProvider, imageModel: form.imageModel });
      setImageModelMessage(`${result.provider} / ${result.model}: ${result.message}`);
      setImageRouteTest({ loading: false, ok: result.ok, message: `${result.provider} / ${result.model}: ${result.message}` });
    } catch (err) {
      setImageRouteTest({ loading: false, ok: false, message: err instanceof Error ? err.message : "生图模型测试失败" });
    } finally {
      setIsTestingImageModel(false);
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

  function selectVideoProvider(providerId: string) {
    const provider = videoProviders.find((item) => item.id === providerId);
    setForm({ ...form, videoProvider: providerId, videoModel: provider?.models[0] ?? form.videoModel });
  }

  async function importTextFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setForm({ ...form, title: form.title || file.name.replace(/\.[^.]+$/, ""), content: text });
    setEstimate(null);
    event.currentTarget.value = "";
  }

  function saveDraft() {
    localStorage.setItem("aifilm_creation_draft", JSON.stringify(form));
    setMessage("草稿已保存在当前浏览器。");
    setError("");
  }

  if (!entrySelected) {
    return <div className="page-stack creation-entry-page"><header><span>NEW MANJIAO</span><h1>新建漫剧</h1><p>选择内容从哪里开始，后续只展示对应流程。</p></header><div className="creation-entry-grid"><button type="button" onClick={onCreateContent}><Sparkles size={22} /><strong>创作新内容</strong><span>爆款拆解、章节大纲、每批 2-3 章创作，再衔接漫剧制作</span><ChevronRight size={18} /></button><button type="button" onClick={() => { setForm((current) => ({ ...current, sourceType: "novel", content: "" })); setEntrySelected(true); }}><BookOpenCheck size={22} /><strong>导入已有小说</strong><span>小说转剧本，再提取人物、场景并生成分镜</span><ChevronRight size={18} /></button><button type="button" onClick={() => { setForm((current) => ({ ...current, sourceType: "script", content: "" })); setEntrySelected(true); }}><FileText size={22} /><strong>导入已有剧本</strong><span>跳过小说改编，直接拆解场次、资产和镜头</span><ChevronRight size={18} /></button></div></div>;
  }

  return (
    <div className="page-stack creation-workbench u-wizard">
      <div className="u-wizard-heading">
        <div>
          <h1>新建漫剧</h1>
          <p>导入内容，确认创作设定，系统自动规划镜头并建立可继续编辑的项目。</p>
        </div>
        <button className="ghost-button" onClick={saveDraft}>
          <Save size={18} />保存草稿
        </button>
      </div>

      <nav className="u-step-tabs" aria-label="创作步骤">
        {stepOrder.map((item, index) => (
          <button
            className={item === step ? "active" : index < activeStepIndex ? "done" : ""}
            key={item}
            onClick={() => goTo(item)}
            type="button"
          >
            <span>{index < activeStepIndex ? "✓" : index + 1}</span>
            <i>{stepLabel(item)}</i>
            <small>{stepHint(item, form.sourceType)}</small>
          </button>
        ))}
      </nav>

      {step === "story" ? (
        <StoryStep
          fileInputRef={fileInputRef}
          form={form}
          imageMessage={imageModelMessage}
          message={message}
          modelMessage={modelMessage}
          words={words}
          suggestedEpisodes={suggestedEpisodes}
          onChange={setForm}
          onImport={importTextFile}
          onSample={() => setForm({ ...form, content: demoStory, title: form.title || "云上花店", sourceType: "short_story" })}
          onSave={saveDraft}
          onNext={nextStep}
        />
      ) : null}

      {step === "settings" ? (
        <SettingsStep
          form={form}
          onChange={setForm}
          onNext={nextStep}
        />
      ) : null}

      {step === "script" ? (
        <ScriptStep
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
          textRouteTest={textRouteTest}
          imageRouteTest={imageRouteTest}
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
          message={message}
          onStart={start}
        />
      ) : null}
    </div>
  );
}

function StoryStep({
  fileInputRef,
  form,
  words,
  suggestedEpisodes,
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
            <h2>选择原稿类型并导入内容</h2>
            <p>小说会先转换为标准剧本；已有剧本跳过改编，直接拆解场次、角色和资产。</p>
          </div>
        </div>

        <div className="source-type-switch" role="radiogroup" aria-label="原稿类型">
          <button className={form.sourceType !== "script" ? "active" : ""} onClick={() => onChange({ ...form, sourceType: "novel" })} role="radio" aria-checked={form.sourceType !== "script"} type="button">
            <BookOpenCheck size={19} />
            <span><strong>小说 / 故事</strong><small>先按内置提示词转成可拍摄剧本</small></span>
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
            value={form.content}
            onChange={(event) => onChange({ ...form, content: event.target.value })}
            placeholder={form.sourceType === "script" ? "粘贴已有剧本，建议包含场次、地点、角色、动作和对白。" : "粘贴小说正文或故事大纲，系统会先改编为标准剧本，再进入资产生产。"}
          />
        </label>

        <div className="inline-actions input-toolbar">
          <input ref={fileInputRef} type="file" accept=".txt,.md" hidden onChange={onImport} />
          <button className="ghost-button" onClick={() => fileInputRef.current?.click()} type="button">
            <FileUp size={18} />导入 .txt
          </button>
          <button className="ghost-button" onClick={onSample} type="button">
            <Sparkles size={18} />样例故事
          </button>
          <button className="ghost-button" onClick={onSave} type="button">
            <Save size={18} />保存草稿
          </button>
        </div>

      </section>

      <aside className="u-side-stack">
        <section className="u-card import-stats-card">
          <div className="import-summary-head"><h3>导入摘要</h3><span>{form.sourceType === "script" ? "剧本直拆" : "小说转剧本"}</span></div>
          <div className="mini-metrics import-metrics">
            <div><strong>{words.toLocaleString()}</strong><span>字数</span></div>
            <div><strong>{suggestedEpisodes}</strong><span>最多可生成集数</span></div>
          </div>
          <label className="field episode-select-field">
            <span>想生成多少集？</span>
            <select
              value={form.targetEpisodes ?? 1}
              onChange={(event) => onChange({ ...form, targetEpisodes: Number(event.target.value) })}
            >
              {Array.from({ length: suggestedEpisodes }).map((_, index) => {
                const episode = index + 1;
                return <option key={episode} value={episode}>{episode} 集</option>;
              })}
            </select>
          </label>
          <small>{form.sourceType === "script" ? "将按剧本中的场次结构拆分；集数用于控制本次生产范围。" : "约每 2,000 字估算为 1 集，选项会按当前字数自动限制。"}</small>
          {words < 2000 ? <p className="warning-text">内容较短，系统会自动减少场次与镜头，避免剧情被过度拆分。</p> : null}
        </section>

        <section className="u-card ai-plan-card">
          <div className="u-card-head compact">
            <h3>接下来会生成什么</h3>
            <small>每一步都可以在项目工作台继续编辑、重生和质检。</small>
          </div>
          {(form.sourceType === "script"
            ? ["识别集与场次", "提取角色 / 场景 / 道具", "生成分镜拆解", "建立一致性资产", "进入图片与视频生产"]
            : ["分析小说结构", "转换为标准剧本", "识别集与场次", "提取角色 / 场景 / 道具", "进入分镜与资产生产"]
          ).map((item, index) => (
            <div className="ai-step-line" key={item}>
              <span>{index + 1}</span>
              <strong>{item}</strong>
            </div>
          ))}
          <button className="primary-button full-button" onClick={onNext} type="button">
            下一步：全局设定 <ChevronRight size={18} />
          </button>
        </section>
      </aside>
    </div>
  );
}
function SettingsStep({
  form,
  onChange,
  onNext
}: {
  form: CreateProjectInput;
  onChange: (form: CreateProjectInput) => void;
  onNext: () => void;
}) {
  return (
    <section className="u-card settings-card settings-step-redesign">
      <div className="u-card-head">
        <div>
          <span className="section-kicker">STEP 2</span>
          <h2>完成基础生产设置</h2>
          <p>先确认画面比例、视觉风格和题材倾向，后续角色、分镜图和视频会沿用这组设定。</p>
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
            <button className={form.artStyle === style ? "active" : ""} key={style} onClick={() => onChange({ ...form, artStyle: style })} type="button">
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

      <div className="u-card-actions">
        <button className="primary-button" onClick={onNext} type="button">
          下一步：核心剧情·剧本 <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}
function ScriptStep({
  form,
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
  message,
  onStart
}: {
  form: CreateProjectInput;
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
  message: string;
  onStart: () => void;
}) {
  const imageMultiplier = imageParameterMultiplier(form.imageSize, form.imageQuality).toFixed(2);
  const [routeMode, setRouteMode] = useState<"auto" | "custom">("auto");
  const [activeRoute, setActiveRoute] = useState<"text" | "image" | "video">("text");
  const scriptAssets = [
    { title: "全局设定", text: "世界观、题材、人设关系、主角动机和内容边界。", icon: <BrainCircuit size={18} />, meta: form.genre || "AI 自动识别" },
    { title: form.sourceType === "script" ? "场次结构" : "核心剧情", text: form.sourceType === "script" ? "识别集、场次、时空、出场角色和剧情作用。" : "按集数梳理事件、情绪弧光、反转点和结尾钩子。", icon: <BookOpenCheck size={18} />, meta: `${form.targetEpisodes ?? 1} 集` },
    { title: form.sourceType === "script" ? "剧本拆解" : "剧本改编", text: form.sourceType === "script" ? "保留原剧情，规范动作、台词、旁白和节奏。" : "把小说叙事转换为可拍摄的场景、动作、台词和旁白。", icon: <FileText size={18} />, meta: form.textModel || "待选择" },
    { title: "角色卡", text: "固定外貌、服装、性格、声线和一致性提示词。", icon: <UsersRound size={18} />, meta: form.videoRatio }
  ];
  const routeReady = Boolean(form.textProvider && form.textModel && form.imageProvider && form.imageModel && form.videoProvider && form.videoModel);

  return (
    <div className="u-wizard-grid wizard-balance-grid wizard-script-redesign shot-plan-workspace">
      <section className="u-card script-plan-card wizard-script-card shot-plan-main">
        <div className="u-card-head wizard-script-title">
          <div>
            <span className="section-kicker">制作设置</span>
            <h2>确认内容如何进入漫剧制作</h2>
            <p>先完成剧本结构化和实体提取；镜头数量将在剧本解析后按每个真实场次自动建议。</p>
          </div>
          <span className="plan-ready"><CheckCircle2 size={16} />制作配置已就绪</span>
        </div>

        <div className="production-runway">
          <article><span><BookOpenCheck size={19} /></span><div><strong>{form.sourceType === "script" ? "剧本结构化" : "小说转剧本"}</strong><small>{form.sourceType === "script" ? "识别场次、对白与动作" : "改编为可拍摄标准剧本"}</small></div></article>
          <ChevronRight size={18} />
          <article><span><UsersRound size={19} /></span><div><strong>角色与场景提取</strong><small>建立可复用的一致性资产</small></div></article>
          <ChevronRight size={18} />
          <article><span><Layers3 size={19} /></span><div><strong>创建项目工作区</strong><small>解析后再生成逐场镜头建议</small></div></article>
        </div>

        <div className="script-output-heading"><div><strong>将自动完成</strong><span>创建后进入项目工作台继续调整</span></div><span>{form.sourceType === "script" ? "剧本直接拆解" : "小说先转为剧本"}</span></div>
        <div className="script-preview-list script-output-map compact-output-map">
          {scriptAssets.map((asset) => (
            <PreviewLine key={asset.title} title={asset.title} text={asset.text} icon={asset.icon} meta={asset.meta} />
          ))}
        </div>

        <EstimatePanel estimate={estimate} form={form} onEstimate={onEstimate} />

        <div className="inline-actions stretch wizard-script-actions">
          <button className="ghost-button" onClick={onEstimate} type="button">按当前模型估算积分</button>
          <button className="primary-button large" onClick={onStart} disabled={isGenerating || !routeReady} type="button">
            {isGenerating ? <Loader2 size={18} className="spin-icon" /> : <WandSparkles size={18} />}
            {isGenerating ? "正在建立项目..." : form.sourceType === "script" ? "解析剧本并创建项目" : "转换剧本并创建项目"}
          </button>
        </div>
        {isGenerating ? <OperationProgress title={form.sourceType === "script" ? "剧本拆解中" : "小说改编中"} elapsed={generationElapsed} detail="系统正在建立剧本、场次、角色、场景和镜头计划，请不要重复提交。" /> : null}
        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="danger-text">{error}</p> : null}
      </section>

      <aside className="u-side-stack">
        <section className="u-card route-card-clean route-card-polished recommended-route-card">
          <div className="recommended-route-head model-route-head">
            <div><span>模型路由</span><strong><i />自动路由正常</strong></div>
            <Route size={20} />
          </div>
          <div className="route-mode-switch"><button className={routeMode === "auto" ? "is-active" : ""} onClick={() => setRouteMode("auto")} type="button">自动推荐</button><button className={routeMode === "custom" ? "is-active" : ""} onClick={() => setRouteMode("custom")} type="button">自定义</button></div>

          <div className="model-route-channels">
            <RouteChannel icon={<FileText size={17} />} title="文本推理" purpose="剧本解析、角色与场景提取" model={form.textModel || "自动选择"} active={activeRoute === "text"} onClick={() => setActiveRoute(activeRoute === "text" ? "image" : "text")} />
            {activeRoute === "text" ? <div className="route-channel-detail">
              <label className="field"><span>供应商</span><select value={form.textProvider} onChange={(event) => onTextProvider(event.target.value)}>{textProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
              <label className="field"><span>模型</span><select value={form.textModel} onChange={(event) => onChange({ ...form, textModel: event.target.value })}>{currentTextModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
              <p>{cleanProviderHint(selectedTextProvider?.costHint, "用于剧本解析、角色卡和分镜拆解。")}</p>
              <button className="ghost-button full-button" onClick={onTestModel} disabled={isTestingModel} type="button">{isTestingModel ? "测试中..." : "测试文本模型"}</button>
              <RouteTestMessage state={textRouteTest} />
            </div> : null}

            <RouteChannel icon={<Image size={17} />} title="图像生成" purpose="角色、场景与分镜首帧" model={form.imageModel || "自动选择"} active={activeRoute === "image"} onClick={() => setActiveRoute("image")} />
            {activeRoute === "image" ? <div className="route-channel-detail">
              <label className="field"><span>供应商</span><select value={form.imageProvider} onChange={(event) => onImageProvider(event.target.value)}>{imageProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
              <label className="field"><span>模型</span><select value={form.imageModel} onChange={(event) => onChange({ ...form, imageModel: event.target.value })}>{currentImageModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
              <div className="route-param-grid">
                <label className="field"><span>分辨率</span><select value={normalizeImageOutputSize(form.imageSize)} onChange={(event) => onChange({ ...form, imageSize: event.target.value })}>{imageOutputSizeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <label className="field"><span>质量</span><select value={normalizeImageOutputQuality(form.imageQuality)} onChange={(event) => onChange({ ...form, imageQuality: event.target.value })}>{imageOutputQualityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              </div>
              <p>{cleanProviderHint(selectedImageProvider?.costHint, "用于角色参考图、场景图和分镜首帧。")}</p>
              <button className="ghost-button full-button" onClick={onTestImageModel} disabled={isTestingImageModel} type="button">{isTestingImageModel ? "测试中..." : "测试生图模型"}</button>
              <RouteTestMessage state={imageRouteTest} />
            </div> : null}

            <RouteChannel icon={<Video size={17} />} title="视频生成" purpose="后续分镜视频与片段生成" model={form.videoModel || "自动选择"} active={activeRoute === "video"} warning={!selectedVideoProvider?.enabled} onClick={() => setActiveRoute("video")} />
            {activeRoute === "video" ? <div className="route-channel-detail">
              <label className="field"><span>供应商</span><select value={form.videoProvider} onChange={(event) => onVideoProvider(event.target.value)}>{videoProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
              <label className="field"><span>模型</span><select value={form.videoModel} onChange={(event) => onChange({ ...form, videoModel: event.target.value })}>{currentVideoModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
              <p>{cleanProviderHint(selectedVideoProvider?.costHint, "用于项目创建后的镜头视频生成。")}</p>
            </div> : null}
          </div>
          <div className="route-cost-note"><CircleDollarSign size={15} /><span>创建前仅锁定路由，不产生扣费；实际按任务和后台价格结算。</span><strong>x{imageMultiplier}</strong></div>
        </section>
      </aside>
    </div>
  );
}
function EstimatePanel({ estimate, form, onEstimate }: { estimate: CreationEstimate | null; form: CreateProjectInput; onEstimate: () => void }) {
  if (!estimate) {
    return (
      <div className="estimate u-estimate wizard-estimate-dock estimate-panel-polished">
        <div className="wizard-estimate-total">
          <span>预估积分</span>
          <strong>待计算</strong>
        </div>
        <p>点击后会按当前文本、生图、视频模型和后台价格策略估算，不会产生真实扣费。</p>
        <button className="ghost-button" onClick={onEstimate} type="button">立即估算</button>
      </div>
    );
  }

  return (
    <div className="estimate u-estimate wizard-estimate-dock estimate-panel-polished ready">
      <div className="wizard-estimate-total">
        <span>预估积分</span>
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
      <p>当前模型：{form.textProvider}/{form.textModel}，{form.imageProvider}/{form.imageModel}，生图参数 {normalizeImageOutputSize(form.imageSize)} / {normalizeImageOutputQuality(form.imageQuality)}。{estimate.assumptions ? `预计 ${estimate.assumptions.totalShots} 个镜头。` : ""}</p>
      {estimate.notes.slice(1).filter((note) => !note.includes("最终单价") && !note.includes("模型基准价")).map((note) => <p key={note}>{note}</p>)}
    </div>
  );
}
function OperationProgress({ title, elapsed, detail }: { title: string; elapsed: number; detail: string }) {
  const percent = Math.min(92, 16 + elapsed * 3);
  return (
    <div className="operation-progress">
      <div>
        <Loader2 size={17} className="spin-icon" />
        <strong>{title}</strong>
        <span>{elapsed}s</span>
      </div>
      <div className="operation-progress-track"><span style={{ width: `${percent}%` }} /></div>
      <p>{detail}</p>
      <div className="operation-queue" aria-label="生成任务队列">
        <span className="active"><i />文本模型处理中<strong>{elapsed}s</strong></span>
        <span><i />保存剧本与场次<strong>等待中</strong></span>
        <span><i />提取角色、场景和道具<strong>等待中</strong></span>
      </div>
    </div>
  );
}

function RouteChannel({ icon, title, purpose, model, active, warning, onClick }: { icon: ReactNode; title: string; purpose: string; model: string; active: boolean; warning?: boolean; onClick: () => void }) {
  return <button className={active ? "route-channel is-active" : "route-channel"} onClick={onClick} type="button"><i>{icon}</i><span><strong>{title}<em className={warning ? "is-warning" : ""} /></strong><small>{purpose}</small></span><b>{model}</b><ChevronDown size={16} className={active ? "is-open" : ""} /></button>;
}

function ChoiceCard({ active, title, desc, badge, onClick }: { active: boolean; title: string; desc: string; badge?: string; onClick: () => void }) {
  return <button className={active ? "choice-card active" : "choice-card"} onClick={onClick} type="button"><strong>{title}</strong><span>{desc}</span>{badge ? <em>{badge}</em> : null}</button>;
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
  const enabled = providers.filter((provider) => provider.modality === modality && provider.enabled);
  const source = enabled.length ? enabled : providers.filter((provider) => provider.modality === modality);
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
    targetEpisodes: Math.max(1, form.targetEpisodes ?? 1),
    textProvider: form.textProvider || defaultForm.textProvider,
    textModel: form.textModel || defaultForm.textModel,
    imageProvider,
    imageModel,
    imageSize: normalizeImageOutputSize(form.imageSize),
    imageQuality: normalizeImageOutputQuality(form.imageQuality)
  };
}

function buildGenerationInput(form: CreateProjectInput): CreateProjectInput {
  const words = form.content.trim().length;
  const maxEpisodes = Math.max(1, Math.min(20, Math.ceil(Math.max(words, 800) / 2000)));
  return {
    ...normalizeDraft(form),
    title: form.title.trim() || autoTitle(form.content),
    sourceType: form.sourceType === "script" ? "script" : "novel",
    genre: form.genre.trim() || "AI 自动识别题材",
    artStyle: form.artStyle.trim() || "AI 自动匹配画风",
    targetEpisodes: Math.max(1, Math.min(maxEpisodes, form.targetEpisodes ?? 1))
  };
}

function autoTitle(content: string) {
  const firstLine = content.trim().split(/\r?\n/).find((line) => line.trim());
  return firstLine ? firstLine.slice(0, 12) : "未命名漫剧";
}

function stepLabel(step: WizardStep) {
  const map: Record<WizardStep, string> = {
    story: "内容输入",
    settings: "创作设定",
    script: "镜头计划"
  };
  return map[step];
}

function stepHint(step: WizardStep, sourceType: CreateProjectInput["sourceType"]) {
  const map: Record<WizardStep, string> = {
    story: sourceType === "script" ? "导入已有剧本" : "导入小说原文",
    settings: "风格、画幅与目标集数",
    script: sourceType === "script" ? "拆解场次并自动规划" : "改编剧本并自动规划"
  };
  return map[step];
}

function loadDraft(): CreateProjectInput | null {
  try {
    const raw = localStorage.getItem("aifilm_creation_draft");
    return raw ? (JSON.parse(raw) as CreateProjectInput) : null;
  } catch {
    return null;
  }
}

const demoStory = "林小朵继承了一家开在云上的花店。店里的花会在夜里发光，也能读出客人没有说出口的遗憾。第一位客人陈暮带着一枚旧戒指来到店里，他想买一束不会凋谢的花，却不肯说要送给谁。林小朵触碰花瓣时，看见了陈暮二十年前错过的爱情，也看见他即将在今晚做出最后的告别。她必须决定，是遵守花店不干预命运的规矩，还是帮他找回那个被时间藏起来的人。";
