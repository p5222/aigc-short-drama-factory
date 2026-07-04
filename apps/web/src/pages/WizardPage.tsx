import { ChevronRight, FileUp, Loader2, Save, Sparkles, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { CreateProjectInput, CreationEstimate, ModelProvider } from "@aifilm/shared";
import { imageOutputQualityOptions, imageOutputSizeOptions, imageParameterMultiplier, normalizeImageOutputQuality, normalizeImageOutputSize } from "@aifilm/shared";
import { api } from "../lib/api";

interface WizardPageProps {
  providers: ModelProvider[];
  onCreated: (projectId: string) => void;
}

type WizardStep = "story" | "settings" | "script" | "assets";
type RouteTestState = { loading: boolean; ok?: boolean; message?: string };

const stepOrder: WizardStep[] = ["story", "settings", "script", "assets"];
const preferredTextProviderIds = ["dashscope-text", "deepseek", "zml-text"];
const preferredImageProviderIds = ["dashscope-image", "zml-image", "doubao-seedream"];

const defaultForm: CreateProjectInput = {
  title: "",
  sourceType: "short_story",
  content: "",
  mode: "nine_grid",
  genre: "",
  videoRatio: "9:16",
  artStyle: "",
  targetEpisodes: 1,
  textProvider: "dashscope-text",
  textModel: "qwen3.7-plus",
  imageProvider: "dashscope-image",
  imageModel: "qwen-image-2.0-pro-2026-04-22",
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
  "真人古武",
  "真实光晕",
  "第一人称 POV",
  "纪录片",
  "广告宣传片",
  "科技产品短片",
  "都市电影氛围",
  "雨夜黑色电影"
];

export function WizardPage({ providers, onCreated }: WizardPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<CreateProjectInput>(() => normalizeDraft(loadDraft() ?? defaultForm));
  const [step, setStep] = useState<WizardStep>("story");
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
  const selectedTextProvider = textProviders.find((provider) => provider.id === form.textProvider) ?? textProviders[0];
  const selectedImageProvider = imageProviders.find((provider) => provider.id === form.imageProvider) ?? imageProviders[0];
  const currentTextModels = selectedTextProvider?.models.length ? selectedTextProvider.models : ["deepseek-v4-pro"];
  const currentImageModels = selectedImageProvider?.models.length ? selectedImageProvider.models : ["qwen-image"];
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
      setForm((draft) => ({ ...draft, imageProvider: selectedImageProvider.id, imageModel: selectedImageProvider.models[0] ?? draft.imageModel }));
    }
  }, [selectedTextProvider, selectedImageProvider, form.textProvider, form.imageProvider]);

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

  async function importTextFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setForm({ ...form, title: form.title || file.name.replace(/\.[^.]+$/, ""), content: text, sourceType: inferSourceType(text) });
    setEstimate(null);
    event.currentTarget.value = "";
  }

  function saveDraft() {
    localStorage.setItem("aifilm_creation_draft", JSON.stringify(form));
    setMessage("草稿已保存在当前浏览器。");
    setError("");
  }

  return (
    <div className="page-stack creation-workbench u-wizard">
      <div className="u-wizard-heading">
        <div>
          <span className="section-kicker">AI 漫剧 / 创作向导</span>
          <h1>新建漫剧</h1>
          <p>跟着步骤走，10 分钟生成第一集。不知道怎么选时，直接选推荐。</p>
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
            <span>{index + 1}</span>
            {stepLabel(item)}
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
          estimate={estimate}
          form={form}
          imageModelMessage={imageModelMessage}
          imageProviders={imageProviders}
          isTestingImageModel={isTestingImageModel}
          isTestingModel={isTestingModel}
          modelMessage={modelMessage}
          textRouteTest={textRouteTest}
          imageRouteTest={imageRouteTest}
          selectedImageProvider={selectedImageProvider}
          selectedTextProvider={selectedTextProvider}
          textProviders={textProviders}
          onChange={setForm}
          onEstimate={estimateCost}
          onImageProvider={selectImageProvider}
          onNext={nextStep}
          onTextProvider={selectTextProvider}
          onTestImageModel={testImageModel}
          onTestModel={testModel}
        />
      ) : null}

      {step === "assets" ? (
        <AssetsStep
          error={error}
          form={form}
          generationElapsed={generationElapsed}
          isGenerating={isGenerating}
          message={message}
          onBack={() => setStep("script")}
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
    <div className="u-wizard-grid">
      <section className="u-card story-input-card" data-tour-id="story-input">
        <div className="u-card-head">
          <div>
            <h2>导入你的小说或故事</h2>
            <p>粘贴正文、章节片段或故事大纲，AI 会自动拆成剧本内容。</p>
          </div>
          <span>第 1 步</span>
        </div>

        <label className="field">
          <span>作品名称</span>
          <input value={form.title} onChange={(event) => onChange({ ...form, title: event.target.value })} placeholder="可不填，生成时会自动命名" />
        </label>

        <label className="field story-input-field">
          <span>故事正文</span>
          <textarea
            value={form.content}
            onChange={(event) => onChange({ ...form, content: event.target.value, sourceType: inferSourceType(event.target.value) })}
            placeholder="在这里粘贴小说原文 / 故事大纲 / 已有剧本。建议至少 2,000 字，系统会按 2,000 字拆分集数。"
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

        <div className="mode-picker" data-tour-id="generation-mode">
          <span>选择生成模式</span>
          <ModeOption active={form.mode === "nine_grid"} title="9宫格模式" desc="一集一张 3x3 总图，裁切后每格自动匹配 1-5 秒。" badge="推荐" onClick={() => onChange({ ...form, mode: "nine_grid" })} />
          <ModeOption active={form.mode === "twenty_five_grid"} title="25宫格模式" desc="一集一张 5x5 总图，适合更细的镜头拆分。" onClick={() => onChange({ ...form, mode: "twenty_five_grid" })} />
          <ModeOption active={form.mode === "director"} title="导演模式（维护中）" desc="强化运镜、动作承接和视频提示词。" disabled onClick={() => undefined} />
        </div>
      </section>

      <aside className="u-side-stack">
        <section className="u-card import-stats-card">
          <h3>当前导入</h3>
          <div className="mini-metrics import-metrics">
            <div><strong>{words.toLocaleString()}</strong><span>字数（自动统计）</span></div>
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
          <small>每 2,000 字约等于 1 集，选项会按当前字数自动限制。</small>
          {form.mode === "nine_grid" && words < 2000 ? <p className="warning-text">9宫格模式建议每集至少 2,000 字，否则剧情节点会偏少。</p> : null}
        </section>

        <section className="u-card ai-plan-card">
          <div className="u-card-head compact">
            <h3>接下来 AI 会为你做什么</h3>
            <small>全程可编辑，每一步都可单独重生。</small>
          </div>
          {["提炼核心剧情", "按你选定的集数写脚本", "生成每集分镜剧本", "拆出场景 / 角色 / 道具", "一键生成画面与视频"].map((item, index) => (
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
    <section className="u-card u-settings-card">
      <div className="u-card-head">
        <div>
          <h2>按步骤完成基础设置</h2>
          <p>不知道怎么选时，直接使用带“推荐”的选项，后续仍可修改。</p>
        </div>
      </div>

      <div className="setting-block" data-tour-id="style-picker">
        <div className="setting-title"><span>1</span><div><h3>视频发布在哪个平台？</h3><p>选择画面比例，影响最终视频尺寸。</p></div></div>
        <div className="choice-grid two">
          <ChoiceCard active={form.videoRatio === "9:16"} title="竖屏 9:16" desc="抖音、视频号、小红书常用" badge="推荐" onClick={() => onChange({ ...form, videoRatio: "9:16" })} />
          <ChoiceCard active={form.videoRatio === "16:9"} title="横屏 16:9" desc="B 站、横版视频、网页播放" onClick={() => onChange({ ...form, videoRatio: "16:9" })} />
        </div>
      </div>

      <div className="setting-block">
        <div className="setting-title"><span>2</span><div><h3>想要什么画面风格？</h3><p>风格会影响角色、场景、分镜图和视频画面。</p></div></div>
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
  estimate,
  modelMessage,
  textRouteTest,
  imageRouteTest,
  imageModelMessage,
  isTestingModel,
  isTestingImageModel,
  onChange,
  onTextProvider,
  onImageProvider,
  onTestModel,
  onTestImageModel,
  onEstimate,
  onNext
}: {
  form: CreateProjectInput;
  textProviders: ModelProvider[];
  imageProviders: ModelProvider[];
  selectedTextProvider?: ModelProvider;
  selectedImageProvider?: ModelProvider;
  currentTextModels: string[];
  currentImageModels: string[];
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
  onTestModel: () => void;
  onTestImageModel: () => void;
  onEstimate: () => void;
  onNext: () => void;
}) {
  return (
    <div className="u-wizard-grid wizard-balance-grid">
      <section className="u-card script-plan-card wizard-script-card">
        <div className="u-card-head">
          <div>
            <h2>核心剧情·剧本生成</h2>
          </div>
        </div>

        <div className="script-preview-list">
          <PreviewLine title="全局设定" text="世界观、题材、主角动机、人物关系、投流钩子。" />
          <PreviewLine title="核心剧情" text="按集数拆出关键事件、情绪弧光和每集结尾钩子。" />
          <PreviewLine title="剧本文本" text="生成可继续拆镜的场景、动作、台词、旁白和节奏。" />
          <PreviewLine title="角色卡" text="固定外貌、服装、性格、声线和角色一致性提示词。" />
        </div>

        <div className="inline-actions stretch wizard-script-actions">
          <button className="ghost-button" onClick={onEstimate} type="button">按当前模型估算积分</button>
          <button className="primary-button" onClick={onNext} type="button">
            下一步：分镜/资产生成 <ChevronRight size={18} />
          </button>
        </div>

        <EstimatePanel estimate={estimate} form={form} onEstimate={onEstimate} />
      </section>

      <aside className="u-side-stack">
        <section className="u-card route-card-clean">
          <div className="u-card-head compact">
            <h3>模型路由</h3>
            <small>选择文本和生图模型后，左侧积分会按后台价格策略重新估算。</small>
          </div>

          <div className="route-clean-block">
            <strong>1. 文本生成</strong>
            <label className="field"><span>供应商</span><select value={form.textProvider} onChange={(event) => onTextProvider(event.target.value)}>{textProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
            <label className="field"><span>模型</span><select value={form.textModel} onChange={(event) => onChange({ ...form, textModel: event.target.value })}>{currentTextModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
            <p>{selectedTextProvider?.costHint ?? "用于剧本解析、角色卡和分镜拆解。"}</p>
            <button className="ghost-button full-button" onClick={onTestModel} disabled={isTestingModel} type="button">{isTestingModel ? "测试中..." : "测试文本模型"}</button>
            <RouteTestMessage state={textRouteTest} />
          </div>

          <div className="route-clean-block">
            <strong>2. 分镜生图</strong>
            <label className="field"><span>供应商</span><select value={form.imageProvider} onChange={(event) => onImageProvider(event.target.value)}>{imageProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
            <label className="field"><span>模型</span><select value={form.imageModel} onChange={(event) => onChange({ ...form, imageModel: event.target.value })}>{currentImageModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
            <label className="field"><span>分辨率</span><select value={normalizeImageOutputSize(form.imageSize)} onChange={(event) => onChange({ ...form, imageSize: event.target.value })}>{imageOutputSizeOptions.map((item) => <option key={item.value} value={item.value}>{item.label} · x{item.multiplier}</option>)}</select></label>
            <label className="field"><span>质量</span><select value={normalizeImageOutputQuality(form.imageQuality)} onChange={(event) => onChange({ ...form, imageQuality: event.target.value })}>{imageOutputQualityOptions.map((item) => <option key={item.value} value={item.value}>{item.label} · x{item.multiplier}</option>)}</select></label>
            <small className="route-param-hint">当前参数倍率 x{imageParameterMultiplier(form.imageSize, form.imageQuality).toFixed(2)}，最终单价 = 模型基准价 × 参数倍率。</small>
            <p>{selectedImageProvider?.costHint ?? "用于角色多视图和分镜图首帧。"}</p>
            <button className="ghost-button full-button" onClick={onTestImageModel} disabled={isTestingImageModel} type="button">{isTestingImageModel ? "测试中..." : "测试生图模型"}</button>
            <RouteTestMessage state={imageRouteTest} />
          </div>
        </section>
      </aside>
    </div>
  );
}

function AssetsStep({
  form,
  isGenerating,
  generationElapsed,
  message,
  error,
  onBack,
  onStart
}: {
  form: CreateProjectInput;
  isGenerating: boolean;
  generationElapsed: number;
  message: string;
  error: string;
  onBack: () => void;
  onStart: () => void;
}) {
  return (
    <section className="u-card asset-launch-card">
      <div className="u-card-head">
        <div>
          <h2>分镜 / 资产生成</h2>
          <p>点击后先生成全局设定、剧情剧本和角色卡；进入项目工作台后再按顺序生成分镜表、角色参考图、分镜图和视频草稿。</p>
        </div>
      </div>

      <div className="asset-flow-grid">
        {[
          ["全局设定", form.videoRatio + " · " + (form.artStyle || "AI 自动匹配")],
          ["核心剧情·剧本", form.textProvider + " / " + form.textModel],
          ["分镜表", form.mode === "nine_grid" ? "9 宫格模式" : "25 宫格模式"],
          ["分镜图", form.imageProvider + " / " + form.imageModel],
          ["视频资产", "项目工作台继续生成"]
        ].map(([title, desc], index) => (
          <article key={title}>
            <span>{index + 1}</span>
            <strong>{title}</strong>
            <p>{desc}</p>
          </article>
        ))}
      </div>

      <div className="inline-actions stretch">
        <button className="ghost-button" onClick={onBack} type="button">返回模型设置</button>
        <button className="primary-button large" onClick={onStart} disabled={isGenerating} type="button">
          {isGenerating ? <Loader2 size={18} className="spin-icon" /> : <WandSparkles size={18} />}{isGenerating ? "正在生成..." : "生成剧情剧本"}
        </button>
      </div>
      {isGenerating ? <OperationProgress title="剧本生成中" elapsed={generationElapsed} detail="正在调用文本模型生成全局设定、角色卡和剧本文本。任务已写入后端队列，请不要重复点击。" /> : null}
      {message ? <p className="success-text">{message}</p> : null}
      {error ? <p className="danger-text">{error}</p> : null}
    </section>
  );
}

function EstimatePanel({ estimate, form, onEstimate }: { estimate: CreationEstimate | null; form: CreateProjectInput; onEstimate: () => void }) {
  if (!estimate) {
    return (
      <div className="estimate u-estimate wizard-estimate-dock">
        <div className="wizard-estimate-total">
          <span>预估积分</span>
          <strong>待计算</strong>
        </div>
        <p>点击后会按右侧当前文本、生图、视频模型和后台价格策略估算，不会产生真实扣费。</p>
        <button className="ghost-button" onClick={onEstimate} type="button">立即估算</button>
      </div>
    );
  }

  return (
    <div className="estimate u-estimate wizard-estimate-dock">
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
      {estimate.notes.slice(1).map((note) => <p key={note}>{note}</p>)}
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
    </div>
  );
}

function ModeOption({ active, title, desc, badge, disabled, onClick }: { active: boolean; title: string; desc: string; badge?: string; disabled?: boolean; onClick: () => void }) {
  return <button className={active ? "mode-option active" : "mode-option"} disabled={disabled} onClick={onClick} type="button"><strong>{title}{badge ? <em>{badge}</em> : null}</strong><span>{desc}</span></button>;
}

function ChoiceCard({ active, title, desc, badge, onClick }: { active: boolean; title: string; desc: string; badge?: string; onClick: () => void }) {
  return <button className={active ? "choice-card active" : "choice-card"} onClick={onClick} type="button"><strong>{title}</strong><span>{desc}</span>{badge ? <em>{badge}</em> : null}</button>;
}

function PreviewLine({ title, text }: { title: string; text: string }) {
  return <div className="preview-line"><strong>{title}</strong><span>{text}</span></div>;
}

function RouteTestMessage({ state }: { state: RouteTestState }) {
  if (state.loading) return <small className="route-test-message loading">测试中，请等待模型返回...</small>;
  if (!state.message) return null;
  return <small className={state.ok ? "route-test-message success" : "route-test-message failed"}>{state.message}</small>;
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
  const imageProvider = form.imageProvider || "zml-image";
  return {
    ...defaultForm,
    ...form,
    targetEpisodes: Math.max(1, form.targetEpisodes ?? 1),
    textProvider: form.textProvider || "deepseek",
    textModel: form.textModel || "deepseek-v4-pro",
    imageProvider,
    imageModel: form.imageModel || "gpt-image-2",
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
    sourceType: inferSourceType(form.content),
    genre: form.genre.trim() || "AI 自动识别题材",
    artStyle: form.artStyle.trim() || "AI 自动匹配画风",
    targetEpisodes: Math.max(1, Math.min(maxEpisodes, form.targetEpisodes ?? 1))
  };
}

function inferSourceType(content: string): CreateProjectInput["sourceType"] {
  const text = content.trim();
  if (/[第][一二三四五六七八九十0-9]+[场幕]|旁白|台词|INT\.|EXT\./i.test(text)) return "script";
  if (text.length > 8000) return "novel";
  if (text.length < 80) return "idea";
  return "short_story";
}

function autoTitle(content: string) {
  const firstLine = content.trim().split(/\r?\n/).find((line) => line.trim());
  return firstLine ? firstLine.slice(0, 12) : "未命名漫剧";
}

function stepLabel(step: WizardStep) {
  const map: Record<WizardStep, string> = {
    story: "故事输入",
    settings: "全局设定",
    script: "核心剧情·剧本",
    assets: "分镜 / 资产生成"
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
