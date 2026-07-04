import { BookOpenCheck, Download, Film, Images, Loader2, Play, RefreshCw, Save, Sparkles, Trash2, Upload, UserRound, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssetItem, CharacterProfile, CreateProjectInput, DirectorStoryboardRow, EvaluationStage, ExportJob, ImageOutputQuality, ImageOutputSize, ModelPrice, ModelProvider, ProjectWorkflow, QualityReport, ScriptDraft, StoryboardShot, TaskStatus } from "@aifilm/shared";
import { imageOutputQualityOptions, imageOutputSizeOptions, imageParameterMultiplier, normalizeImageOutputQuality, normalizeImageOutputSize } from "@aifilm/shared";
import { MetricCard } from "../components/MetricCard";
import { api } from "../lib/api";

interface ProjectWorkbenchPageProps {
  workflow?: ProjectWorkflow;
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  onBack: () => void;
  onRefresh: (projectId: string) => void | Promise<void>;
}

type WorkbenchTab = "script" | "characters" | "director" | "images" | "video";

const statusText: Record<TaskStatus, string> = {
  pending: "待生成",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
  refunded: "已退款"
};

type NextAction = {
  id: "script" | "storyboard" | "character" | "image" | "video" | "done";
  icon: "script" | "storyboard" | "character" | "image" | "video";
  title: string;
  description: string;
  disabled: boolean;
};

type ShotDraft = {
  duration: string;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  characters: string;
  scene: string;
  pictureDesc: string;
  action: string;
  orientation: string;
  spatialRelation: string;
  emotion: string;
  dialogue: string;
  voiceOver: string;
  environmentSound: string;
  soundEffect: string;
  imagePrompt: string;
  videoPrompt: string;
};

type OperationKey = "storyboard" | "character" | "images" | "video" | "export" | "shot-image" | null;
type WorkbenchOperation = { key: OperationKey; title: string; startedAt: number; detail: string; targetShotIds?: string[] };
type StageEstimate = {
  stage: NextAction["id"];
  title: string;
  provider: string;
  model: string;
  parameters: string;
  quantity: number;
  estimatedCredits: number;
  estimatedSeconds: number;
  refundPolicy: string;
  fallbackPolicy: string;
  notes: string[];
};

export function ProjectWorkbenchPage({ workflow, providers, modelPrices, onBack, onRefresh }: ProjectWorkbenchPageProps) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("script");
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [operation, setOperation] = useState<WorkbenchOperation | null>(null);
  const [operationElapsed, setOperationElapsed] = useState(0);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string; prompt?: string } | null>(null);
  const [qualityReports, setQualityReports] = useState<QualityReport[]>(workflow?.qualityReports ?? []);
  const [qualityBusy, setQualityBusy] = useState(false);
  const [pendingRun, setPendingRun] = useState<NextAction["id"] | null>(null);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);

  useEffect(() => {
    if (!workflow?.project.id) return;
    setQualityReports(workflow.qualityReports ?? []);
  }, [workflow?.project.id, workflow?.qualityReports]);

  useEffect(() => {
    if (!workflow?.project.id) return;
    let active = true;
    api.exportJobs(workflow.project.id)
      .then((jobs) => {
        if (active) setExportJobs(jobs);
      })
      .catch(() => {
        if (active) setExportJobs([]);
      });
    return () => {
      active = false;
    };
  }, [workflow?.project.id]);

  useEffect(() => {
    if (!operation) return;
    const timer = window.setInterval(() => setOperationElapsed(Math.round((Date.now() - operation.startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [operation]);

  function beginOperation(key: OperationKey, title: string, detail: string, targetShotIds?: string[]) {
    setOperation({ key, title, detail, startedAt: Date.now(), targetShotIds });
    setOperationElapsed(0);
  }

  function endOperation() {
    setOperation(null);
    setOperationElapsed(0);
  }

  if (!workflow) {
    return <div className="page-stack"><section className="panel centered-panel">正在加载项目生产数据...</section></div>;
  }

  const { project, script, characters, assets, storyboards, tasks } = workflow;
  const imageAssets = assets.filter((asset) => asset.type === "image");
  const videoAssets = assets.filter((asset) => asset.type === "video");
  const roleAssets = assets.filter((asset) => asset.type === "role" || asset.type === "role_derivative");
  const primaryRoleAssets = roleAssets.filter((asset) => asset.type === "role");
  const imageAssetByShotId = new Map(imageAssets.map((asset) => [asset.id.replace(/^image_/, ""), asset]));
  const videoAssetByShotId = new Map(videoAssets.map((asset) => [asset.id.replace(/^video_/, ""), asset]));
  const latestTask = tasks[0];
  const totalDuration = storyboards.reduce((sum, shot) => sum + shot.duration, 0);
  const completedRoleRefs = countCompletedCharacterSheets(characters, roleAssets);
  const completedImages = storyboards.filter((shot) => imageAssetByShotId.has(shot.id)).length;
  const completedVideos = storyboards.filter((shot) => videoAssetByShotId.has(shot.id)).length;
  const ratioClass = `ratio-${project.videoRatio.replace(":", "-")}`;
  const selectedShot = storyboards.find((shot) => shot.id === selectedShotId) ?? storyboards[0];
  const nextAction = resolveNextAction({
    hasScript: Boolean(script),
    storyboards: storyboards.length,
    roleAssets: primaryRoleAssets.length,
    completedRoleRefs,
    completedImages,
    completedVideos
  });
  const stageEstimate = buildStageEstimate(nextAction.id, {
    project,
    providers,
    modelPrices,
    storyboards,
    characters,
    primaryRoleAssets,
    completedRoleRefs,
    completedImages,
    imageAssetByShotId,
    videoAssetByShotId
  });

  const pipelineSteps = [
    { label: "剧本确认", done: Boolean(script) },
    { label: "角色定稿", done: completedRoleRefs >= Math.max(1, primaryRoleAssets.length || characters.length) },
    { label: "分镜拆解", done: storyboards.length > 0 },
    { label: "分镜图评估", done: storyboards.length > 0 && completedImages >= storyboards.length },
    { label: "视频与配音", done: completedVideos > 0 || assets.some((asset) => asset.type === "audio" || asset.type === "subtitle") },
    { label: "合成导出", done: assets.some((asset) => asset.type === "video" && asset.name.includes("合成")) || project.status === "completed" }
  ];

  async function generateImages(options: { shotIds?: string[]; forceRegenerate?: boolean; navigateToImages?: boolean } = {}) {
    setIsBusy(true);
    const countText = options.shotIds?.length ? `${options.shotIds.length} 个已选镜头` : "未完成镜头";
    beginOperation("images", "分镜图生成中", `正在生成 ${countText}。图片生成需 1-2 分钟，请耐心等待；任务会在后端继续执行，切换页面不会中断。`, options.shotIds);
    setMessage("");
    setError("");
    try {
      const result = await api.generateImages(project.id, options);
      trackProjectEvent(project.id, "generate_image_success", { assetsCreated: result.assetsCreated, taskId: result.task.id });
      setMessage(result.assetsCreated ? `已新增 ${result.assetsCreated} 个分镜图资产，扣费 ${result.task.finalCredits ?? result.task.estimatedCredits} 积分。` : "当前分镜图资产已经生成过，本次没有重复创建。");
      await onRefresh(project.id);
      const shouldNavigate = options.navigateToImages ?? (!options.shotIds || options.shotIds.length > 1);
      if (shouldNavigate) setActiveTab("images");
      return true;
    } catch (err) {
      trackProjectEvent(project.id, "generate_image_fail", { message: err instanceof Error ? err.message : "分镜图生成失败" });
      setError(err instanceof Error ? err.message : "分镜图生成失败");
      return false;
    } finally {
      setIsBusy(false);
      endOperation();
    }
  }

  async function generateStoryboards() {
    setIsBusy(true);
    beginOperation("storyboard", "分镜表生成中", "正在读取已确认剧本和角色卡，拆解镜头编号、画面描述、首帧提示词和视频提示词。切换页面不会中断本次请求。");
    setMessage("");
    setError("");
    try {
      const result = await api.generateStoryboards(project.id, { artStyle: project.artStyle, videoRatio: project.videoRatio });
      trackProjectEvent(project.id, "generate_storyboard_success", { assetsCreated: result.assetsCreated, taskId: result.task.id });
      setMessage(result.assetsCreated ? `已生成 ${result.assetsCreated} 条镜头级分镜，并写入数据库。` : "分镜已处理，本次没有新增镜头。");
      await onRefresh(project.id);
      setActiveTab("director");
    } catch (err) {
      trackProjectEvent(project.id, "generate_storyboard_fail", { message: err instanceof Error ? err.message : "分镜生成失败" });
      setError(err instanceof Error ? err.message : "分镜生成失败");
    } finally {
      setIsBusy(false);
      endOperation();
    }
  }

  async function generateCharacterImages(input?: { characterIds?: string[]; forceRegenerate?: boolean }) {
    setIsBusy(true);
    beginOperation("character", "角色三视图生成中", "正在根据当前角色卡和上传参考图生成一张三视图总图，作为后续分镜图的身份锚点。");
    setMessage("");
    setError("");
    try {
      const result = await api.generateCharacterImages(project.id, input);
      trackProjectEvent(project.id, "generate_character_success", { assetsCreated: result.assetsCreated, taskId: result.task.id });
      setMessage(result.assetsCreated ? `已生成 ${result.assetsCreated} 张角色三视图总图，角色一致性资产已更新。` : "角色三视图总图已经生成过，本次没有重复创建。");
      await onRefresh(project.id);
    } catch (err) {
      trackProjectEvent(project.id, "generate_character_fail", { message: err instanceof Error ? err.message : "角色参考图生成失败" });
      setError(err instanceof Error ? err.message : "角色参考图生成失败");
    } finally {
      setIsBusy(false);
      endOperation();
    }
  }

  async function generateVideos() {
    setIsBusy(true);
    beginOperation("video", "视频片段生成中", "正在把已确认的分镜图和镜头视频提示词提交给视频模型。只有已出图的镜头会进入本次视频任务。");
    setMessage("");
    setError("");
    try {
      const result = await api.generateVideos(project.id);
      trackProjectEvent(project.id, "generate_video_success", { assetsCreated: result.assetsCreated, taskId: result.task.id });
      setMessage(result.task.status === "running"
        ? `已向上游提交 ${result.assetsCreated} 个视频任务，当前仍在生成中；稍后刷新或重新点击生成会继续更新未完成镜头。`
        : result.assetsCreated
          ? `已生成 ${result.assetsCreated} 个可查看的视频片段。`
          : "视频片段已经生成过，本次没有重复创建。"
      );
      await onRefresh(project.id);
      setActiveTab("video");
    } catch (err) {
      trackProjectEvent(project.id, "generate_video_fail", { message: err instanceof Error ? err.message : "视频草稿生成失败" });
      setError(err instanceof Error ? err.message : "视频草稿生成失败");
    } finally {
      setIsBusy(false);
      endOperation();
    }
  }

  async function exportStoryboard() {
    const rows = await api.exportStoryboard(project.id);
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.name}-storyboard.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function createExport(type: "tts" | "subtitle" | "video_export"): Promise<ExportJob | undefined> {
    setIsBusy(true);
    beginOperation("export", type === "video_export" ? "MP4 合成中" : type === "tts" ? "配音生成中" : "字幕生成中", "正在按镜头顺序整理片段、台词和时长，生成可被最终成片复用的音视频资产。");
    setMessage("");
    setError("");
    try {
      const job = await api.createExportJob(project.id, { type });
      setExportJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      const label = type === "tts" ? "配音音轨" : type === "subtitle" ? "字幕文件" : job.outputUrl?.endsWith(".mp4") ? "MP4 成片" : "合成诊断清单";
      setMessage(job.outputUrl ? `${label}已生成：${job.outputUrl}` : `${label}任务状态：${job.status}`);
      await onRefresh(project.id);
      return job;
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出任务失败");
      return undefined;
    } finally {
      setIsBusy(false);
      endOperation();
    }
  }

  async function saveProjectRoutes(input: Partial<Pick<CreateProjectInput, "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">>) {
    setMessage("");
    setError("");
    try {
      await api.updateProjectModelRoutes(project.id, input);
      setMessage("本项目模型路由已更新。可以在当前阶段直接重新生成，不需要新建项目。");
      await onRefresh(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "模型路由保存失败");
    }
  }

  async function refreshQualityReports() {
    setQualityBusy(true);
    setMessage("");
    setError("");
    try {
      const reports = await api.generateQualityReports(project.id);
      trackProjectEvent(project.id, "quality_report_refresh", { reports: reports.length });
      setQualityReports(reports);
      setMessage("质量评测已刷新，后台评测闭环同步可见。");
      await onRefresh(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "质量评测生成失败");
    } finally {
      setQualityBusy(false);
    }
  }

  function latestReport(stage: EvaluationStage) {
    return qualityReports
      .filter((report) => report.stage === stage)
      .sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)))[0];
  }

  function runPlannedAction(id: NextAction["id"]) {
    setPendingRun(null);
    runNextAction(id, { generateStoryboards, generateCharacterImages, generateImages, generateVideos });
  }

  return (
    <div className="page-stack project-workbench">
      <div className="page-title row-title workbench-hero-title">
        <div>
          <span className="section-kicker">PROJECT PRODUCTION</span>
          <h1>{project.name}</h1>
          <p>{project.intro}</p>
        </div>
        <div className="workbench-hero-tools">
          <ProjectRouteSwitcher project={project} providers={providers} onSave={saveProjectRoutes} compact />
          <div className="inline-actions workbench-hero-actions">
            <button className="ghost-button" onClick={onBack}>返回作品列表</button>
            <button className="ghost-button" onClick={() => onRefresh(project.id)}><RefreshCw size={18} />刷新</button>
          </div>
        </div>
      </div>

      <div className="workflow-rail">
        {pipelineSteps.map((step, index) => <div className={`stage-pill ${step.done ? "done" : ""}`} key={step.label}><span>{index + 1}</span>{step.label}</div>)}
      </div>

      <div className="metric-grid four">
        <MetricCard label="剧集" value={project.episodes} />
        <MetricCard label="角色" value={characters.length} tone="purple" />
        <MetricCard label="镜头" value={storyboards.length} tone="success" />
        <MetricCard label="已用积分" value={project.creditsSpent} tone="danger" />
      </div>

      <section className="panel production-console">
        <div className="panel-head">
          <div><h2>生成控制台</h2><small>图片和视频任务会写入数据库，并同步刷新页面。</small></div>
          <div className="console-meta"><span>{project.videoRatio}</span><span>{project.artStyle}</span><span>{totalDuration}s</span></div>
        </div>
        <div className="production-grid">
          <button className="production-action next-step-action" onClick={() => setPendingRun(nextAction.id)} disabled={isBusy || nextAction.disabled}>
            {nextAction.icon === "script" ? <BookOpenCheck size={22} /> : nextAction.icon === "storyboard" ? <WandSparkles size={22} /> : nextAction.icon === "character" ? <UserRound size={22} /> : nextAction.icon === "image" ? <Images size={22} /> : <Play size={22} />}
            <strong>{nextAction.title}</strong>
            <span>{nextAction.description}</span>
          </button>
          <GenerationCostPreview estimate={stageEstimate} onConfirm={() => setPendingRun(nextAction.id)} disabled={isBusy || nextAction.disabled} />
          <div className="production-action secondary production-stage-list">
            <StageLine label="剧本确认" value={script ? "已确认" : "待生成"} done={Boolean(script)} />
            <StageLine label="角色定稿" value={`${completedRoleRefs}/${primaryRoleAssets.length || characters.length}`} done={primaryRoleAssets.length > 0 && completedRoleRefs >= primaryRoleAssets.length} />
            <StageLine label="分镜图" value={`${completedImages}/${storyboards.length || 0}`} done={storyboards.length > 0 && completedImages >= storyboards.length} />
            <StageLine label="视频合成" value={`${completedVideos}/${storyboards.length || 0}`} done={storyboards.length > 0 && completedVideos >= storyboards.length} />
            <StageLine label="导出" value={videoAssets.some((asset) => asset.name.includes("导出") || asset.referenceUrl?.endsWith(".mp4")) ? "已生成" : "待导出"} done={videoAssets.some((asset) => asset.name.includes("导出") || asset.referenceUrl?.endsWith(".mp4"))} />
          </div>
          <div className="task-monitor"><div><strong>{latestTask ? latestTask.title : "暂无最近任务"}</strong><span>{latestTask ? `${latestTask.provider} / ${latestTask.model}` : "开始生成后会显示模型、进度和积分"}</span></div>{latestTask ? <><div className="task-progress-track"><span style={{ width: `${latestTask.progress}%` }} /></div><small className={`status ${latestTask.status}`}>{statusText[latestTask.status]} · {latestTask.progress}% · {latestTask.finalCredits ?? latestTask.estimatedCredits} 积分</small></> : null}</div>
        </div>
        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="danger-text">{error}</p> : null}
        {operation ? <WorkbenchOperationProgress operation={operation} elapsed={operationElapsed} /> : null}
      </section>

      <div className="tabs workbench-tabs" data-tour-id="project-flow-tabs">
        <button className={activeTab === "script" ? "active" : ""} onClick={() => setActiveTab("script")}><BookOpenCheck size={18} />剧本确认</button>
        <button className={activeTab === "characters" ? "active" : ""} onClick={() => setActiveTab("characters")}><UserRound size={18} />角色定稿</button>
        <button className={activeTab === "images" || activeTab === "director" ? "active" : ""} onClick={() => setActiveTab("images")}><Images size={18} />分镜图</button>
        <button className={activeTab === "video" ? "active" : ""} onClick={() => setActiveTab("video")}><Film size={18} />视频合成</button>
        <button className={activeTab === "video" ? "active export-tab" : "export-tab"} onClick={() => setActiveTab("video")}><Download size={18} />导出</button>
      </div>

      {activeTab === "script" ? <ScriptReviewBoard projectId={project.id} report={latestReport("script")} onRefreshQuality={refreshQualityReports} qualityBusy={qualityBusy} script={script} characters={characters} storyboards={storyboards} tasks={tasks} roleAssetCount={primaryRoleAssets.length} completedRoleRefs={completedRoleRefs} onGenerateStoryboards={generateStoryboards} onOpenCharacters={() => setActiveTab("characters")} onOpenDirector={() => setActiveTab("director")} isBusy={isBusy} /> : null}
      {activeTab === "characters" ? <CharacterLockBoard report={latestReport("character")} projectId={project.id} characters={characters} roleAssets={roleAssets} projectArtStyle={project.artStyle} onGenerate={generateCharacterImages} onRefresh={onRefresh} onRefreshQuality={refreshQualityReports} qualityBusy={qualityBusy} isBusy={isBusy} onPreviewImage={setPreviewImage} /> : null}
      {activeTab === "director" ? <StoryboardDirectorBoard report={latestReport("storyboard")} projectId={project.id} storyboards={storyboards} selectedShot={selectedShot} setSelectedShotId={setSelectedShotId} imageAssetByShotId={imageAssetByShotId} videoAssetByShotId={videoAssetByShotId} ratioClass={ratioClass} videoRatio={project.videoRatio} onGenerateStoryboards={generateStoryboards} onGenerateImages={generateImages} onRefresh={onRefresh} onRefreshQuality={refreshQualityReports} qualityBusy={qualityBusy} isBusy={isBusy} operation={operation} operationElapsed={operationElapsed} onPreviewImage={setPreviewImage} /> : null}
      {activeTab === "images" ? <ShotImageGallery report={latestReport("image")} imageAssetByShotId={imageAssetByShotId} onGenerate={generateImages} onOpenDirector={() => setActiveTab("director")} onRefresh={onRefresh} onRefreshQuality={refreshQualityReports} qualityBusy={qualityBusy} projectId={project.id} ratioClass={ratioClass} storyboards={storyboards} videoRatio={project.videoRatio} isBusy={isBusy} operation={operation} operationElapsed={operationElapsed} onPreviewImage={setPreviewImage} /> : null}
      {activeTab === "video" ? <VideoTimeline latestExport={exportJobs[0] ?? null} report={latestReport("video")} projectId={project.id} imageAssetByShotId={imageAssetByShotId} onGenerate={generateVideos} onRefreshQuality={refreshQualityReports} qualityBusy={qualityBusy} ratioClass={ratioClass} storyboards={storyboards} videoAssetByShotId={videoAssetByShotId} isBusy={isBusy} operation={operation} operationElapsed={operationElapsed} onExportStoryboard={exportStoryboard} onCreateExport={createExport} /> : null}
      {previewImage ? <ImagePreviewModal preview={previewImage} onClose={() => setPreviewImage(null)} /> : null}
      {pendingRun && pendingRun !== "script" && pendingRun !== "done" ? (
        <GenerationConfirmDialog estimate={stageEstimate} onCancel={() => setPendingRun(null)} onConfirm={() => runPlannedAction(pendingRun)} />
      ) : null}
    </div>
  );
}

function ScriptReviewBoard({
  projectId,
  report,
  onRefreshQuality,
  qualityBusy,
  script,
  characters,
  storyboards,
  tasks,
  roleAssetCount,
  completedRoleRefs,
  onGenerateStoryboards,
  onOpenCharacters,
  onOpenDirector,
  isBusy
}: {
  projectId: string;
  report?: QualityReport;
  onRefreshQuality: () => void;
  qualityBusy: boolean;
  script?: ScriptDraft;
  characters: CharacterProfile[];
  storyboards: StoryboardShot[];
  tasks: ProjectWorkflow["tasks"];
  roleAssetCount: number;
  completedRoleRefs: number;
  onGenerateStoryboards: () => void;
  onOpenCharacters: () => void;
  onOpenDirector: () => void;
  isBusy: boolean;
}) {
  const sceneCount = extractSceneCount(script?.content ?? "");
  const dialogueCount = extractDialogueCount(script?.content ?? "");
  const scriptTask = tasks.find((task) => task.type === "text");
  const isLocalFallback = scriptTask?.provider.includes("Local") || scriptTask?.model.includes("local");
  const charactersLocked = roleAssetCount > 0 ? completedRoleRefs >= roleAssetCount : characters.length === 0;
  const readyForStoryboard = Boolean(script?.content && characters.length > 0 && charactersLocked);

  return (
    <section className="panel script-review-board">
      <div className="script-review-main">
        <div className="panel-head">
          <div>
            <h2>剧本确认工作台</h2>
            <small>先确认故事梗概、场次、角色和台词，再进入分镜拆解；这里是后续角色一致性和镜头生成的源头。</small>
          </div>
        </div>
        {isLocalFallback ? <p className="script-source-note">当前内容根据原始输入做结构化兜底，建议先在模型路由测试成功后重新生成。</p> : null}
        <div className="script-review-summary">
          <div><strong>{sceneCount || "-"}</strong><span>识别场次</span></div>
          <div><strong>{characters.length}</strong><span>角色卡</span></div>
          <div><strong>{dialogueCount || "-"}</strong><span>台词段</span></div>
          <div><strong>{storyboards.length}</strong><span>已拆镜头</span></div>
        </div>
        <div className="script-box script-review-copy">
          <strong>剧情梗概</strong>
          <p>{script?.synopsis ?? "暂无梗概。请先在创作向导或任务中心生成剧本。"}</p>
          <strong>剧本文本预览</strong>
          <pre>{script?.content ?? "暂无剧本内容。"}</pre>
        </div>
      </div>
      <aside className="script-review-side">
        <h3>确认顺序</h3>
        <FlowCheck done={Boolean(script)} title="1. 剧本可读" text="检查全局设定、剧情节拍、场景和台词是否成立。" />
        <FlowCheck done={charactersLocked} title="2. 角色可锁定" text="角色卡要能转成正面、侧面、背面和表情参考图。" />
        <FlowCheck done={storyboards.length > 0} title="3. 分镜可预览" text="确认后进入镜头调整和分镜图评估，清单只在视频合成阶段用于导出核对。" />
        <div className="script-review-actions">
          <button className="ghost-button" onClick={onOpenCharacters} disabled={!script}>查看角色资产</button>
          <button className="primary-button" onClick={storyboards.length > 0 ? onOpenDirector : charactersLocked ? onGenerateStoryboards : onOpenCharacters} disabled={!script || isBusy}>
            <BookOpenCheck size={18} />{storyboards.length > 0 ? "查看分镜拆解" : readyForStoryboard ? "确认剧本并拆分镜" : "先完成角色定稿"}
          </button>
        </div>
      </aside>
      <StageFeedbackPanel projectId={projectId} stage="script" report={report} onRefreshQuality={onRefreshQuality} qualityBusy={qualityBusy} />
    </section>
  );
}

function FlowCheck({ done, title, text }: { done: boolean; title: string; text: string }) {
  return (
    <div className={done ? "flow-check done" : "flow-check"}>
      <span>{done ? "已完成" : "待确认"}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function GenerationCostPreview({ estimate, onConfirm, disabled }: { estimate: StageEstimate; onConfirm: () => void; disabled: boolean }) {
  return (
    <div className="production-action secondary generation-cost-preview">
      <div className="generation-cost-head">
        <span>生成前确认</span>
        <strong>{estimate.estimatedCredits} 积分</strong>
      </div>
      <div className="generation-cost-grid">
        <span>模型</span><strong>{estimate.provider} / {estimate.model}</strong>
        <span>参数</span><strong>{estimate.parameters}</strong>
        <span>耗时</span><strong>约 {formatDuration(estimate.estimatedSeconds)}</strong>
        <span>退费</span><strong>{estimate.refundPolicy}</strong>
      </div>
      <p>{estimate.fallbackPolicy}</p>
      <button className="primary-button compact" onClick={onConfirm} disabled={disabled} type="button">确认生成</button>
    </div>
  );
}

function GenerationConfirmDialog({ estimate, onCancel, onConfirm }: { estimate: StageEstimate; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="generation-confirm-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="generation-confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="generation-confirm-head">
          <span>确认生成</span>
          <h2>{estimate.title}</h2>
          <p>{estimate.notes[0]}</p>
        </div>
        <div className="generation-confirm-grid">
          <div><span>模型</span><strong>{estimate.provider} / {estimate.model}</strong></div>
          <div><span>参数</span><strong>{estimate.parameters}</strong></div>
          <div><span>预计积分</span><strong>{estimate.estimatedCredits}</strong></div>
          <div><span>预计耗时</span><strong>{formatDuration(estimate.estimatedSeconds)}</strong></div>
          <div><span>处理数量</span><strong>{estimate.quantity}</strong></div>
          <div><span>失败退费</span><strong>{estimate.refundPolicy}</strong></div>
        </div>
        <div className="generation-confirm-note">
          <strong>失败兜底</strong>
          <span>{estimate.fallbackPolicy}</span>
        </div>
        <div className="generation-confirm-actions">
          <button className="ghost-button" onClick={onCancel} type="button">取消</button>
          <button className="primary-button" onClick={onConfirm} type="button"><Sparkles size={18} />确认提交</button>
        </div>
      </div>
    </div>
  );
}

function ProjectRouteSwitcher({
  project,
  providers,
  onSave,
  compact = false
}: {
  project: ProjectWorkflow["project"];
  providers: ModelProvider[];
  onSave: (input: Partial<Pick<CreateProjectInput, "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">>) => Promise<void>;
  compact?: boolean;
}) {
  const textProviders = providers.filter((provider) => provider.modality === "text" && provider.enabled);
  const imageProviders = providers.filter((provider) => provider.modality === "image" && provider.enabled);
  const videoProviders = providers.filter((provider) => provider.modality === "video" && provider.enabled);
  const [draft, setDraft] = useState({
    textProvider: project.textProvider ?? textProviders[0]?.id ?? "",
    textModel: project.textModel ?? textProviders[0]?.models[0] ?? "",
    imageProvider: project.imageProvider ?? imageProviders[0]?.id ?? "",
    imageModel: project.imageModel ?? imageProviders[0]?.models[0] ?? "",
    imageSize: normalizeImageOutputSize(project.imageSize),
    imageQuality: normalizeImageOutputQuality(project.imageQuality),
    videoProvider: project.videoProvider ?? videoProviders[0]?.id ?? "",
    videoModel: project.videoModel ?? videoProviders[0]?.models[0] ?? ""
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({
      textProvider: project.textProvider ?? textProviders[0]?.id ?? "",
      textModel: project.textModel ?? textProviders.find((item) => item.id === project.textProvider)?.models[0] ?? textProviders[0]?.models[0] ?? "",
      imageProvider: project.imageProvider ?? imageProviders[0]?.id ?? "",
      imageModel: project.imageModel ?? imageProviders.find((item) => item.id === project.imageProvider)?.models[0] ?? imageProviders[0]?.models[0] ?? "",
      imageSize: normalizeImageOutputSize(project.imageSize),
      imageQuality: normalizeImageOutputQuality(project.imageQuality),
      videoProvider: project.videoProvider ?? videoProviders[0]?.id ?? "",
      videoModel: project.videoModel ?? videoProviders.find((item) => item.id === project.videoProvider)?.models[0] ?? videoProviders[0]?.models[0] ?? ""
    });
  }, [project.id, project.textProvider, project.textModel, project.imageProvider, project.imageModel, project.imageSize, project.imageQuality, project.videoProvider, project.videoModel, providers.length]);

  function selectProvider(modality: "text" | "image" | "video", providerId: string) {
    const source = modality === "text" ? textProviders : modality === "image" ? imageProviders : videoProviders;
    const provider = source.find((item) => item.id === providerId);
    const firstModel = provider?.models[0] ?? "";
    if (modality === "text") setDraft((current) => ({ ...current, textProvider: providerId, textModel: firstModel }));
    if (modality === "image") setDraft((current) => ({ ...current, imageProvider: providerId, imageModel: firstModel }));
    if (modality === "video") setDraft((current) => ({ ...current, videoProvider: providerId, videoModel: firstModel }));
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={compact ? "project-route-switcher compact" : "panel project-route-switcher"}>
      <div className="project-route-head">
        <div>
          <h2>本项目模型路由</h2>
          <small>生成失败时先切模型，再重试当前阶段。</small>
        </div>
        <button className="primary-button" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
          保存路由
        </button>
      </div>
      <div className="project-route-grid">
        <RouteSelectBlock
          title="剧本/分镜拆解"
          intent="文本理解、镜头拆解、提示词生成"
          providers={textProviders}
          providerId={draft.textProvider}
          model={draft.textModel}
          onProvider={(providerId) => selectProvider("text", providerId)}
          onModel={(model) => setDraft((current) => ({ ...current, textModel: model }))}
        />
        <RouteSelectBlock
          title="角色图/分镜图"
          intent="参考图一致性、生图质量、成本"
          providers={imageProviders}
          providerId={draft.imageProvider}
          model={draft.imageModel}
          onProvider={(providerId) => selectProvider("image", providerId)}
          onModel={(model) => setDraft((current) => ({ ...current, imageModel: model }))}
          imageSize={draft.imageSize}
          imageQuality={draft.imageQuality}
          onImageSize={(imageSize) => setDraft((current) => ({ ...current, imageSize: normalizeImageOutputSize(imageSize) }))}
          onImageQuality={(imageQuality) => setDraft((current) => ({ ...current, imageQuality: normalizeImageOutputQuality(imageQuality) }))}
        />
        <RouteSelectBlock
          title="图生视频"
          intent="首帧继承、异步任务、失败可续跑"
          providers={videoProviders}
          providerId={draft.videoProvider}
          model={draft.videoModel}
          onProvider={(providerId) => selectProvider("video", providerId)}
          onModel={(model) => setDraft((current) => ({ ...current, videoModel: model }))}
        />
      </div>
    </section>
  );
}

function RouteSelectBlock({
  title,
  intent,
  providers,
  providerId,
  model,
  onProvider,
  onModel,
  imageSize,
  imageQuality,
  onImageSize,
  onImageQuality
}: {
  title: string;
  intent: string;
  providers: ModelProvider[];
  providerId: string;
  model: string;
  onProvider: (providerId: string) => void;
  onModel: (model: string) => void;
  imageSize?: string;
  imageQuality?: string;
  onImageSize?: (value: ImageOutputSize) => void;
  onImageQuality?: (value: ImageOutputQuality) => void;
}) {
  const provider = providers.find((item) => item.id === providerId) ?? providers[0];
  const models = provider?.models ?? [];
  const badges = provider ? providerBadges(provider) : [];
  return (
    <div className="route-select-block">
      <div className="route-select-top">
        <ProviderAvatar provider={provider} />
        <div>
          <strong>{title}</strong>
          <span>{intent}</span>
        </div>
      </div>
      <div className="route-current-model">
        <b>{provider?.name ?? "暂无可用渠道"}</b>
        <small>{model || "未选择模型"}</small>
      </div>
      <select value={providerId} onChange={(event) => onProvider(event.target.value)} aria-label={`${title}渠道`}>
        {!providers.length ? <option value="">暂无可用渠道</option> : null}
        {providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>
      <div className="route-model-chip-row">
        {models.length ? models.map((item) => (
          <button className={model === item ? "active" : ""} key={item} type="button" onClick={() => onModel(item)}>
            {item}
          </button>
        )) : <span>暂无模型</span>}
      </div>
      {badges.length ? <div className="route-capability-row">{badges.map((badge) => <span key={badge}>{badge}</span>)}</div> : null}
      {onImageSize && onImageQuality ? (
        <>
          <div className="route-image-param-row">
            <select value={normalizeImageOutputSize(imageSize)} onChange={(event) => onImageSize(normalizeImageOutputSize(event.target.value))} aria-label="图片尺寸">
              {imageOutputSizeOptions.map((item) => <option key={item.value} value={item.value}>{item.label} · x{item.multiplier}</option>)}
            </select>
            <select value={normalizeImageOutputQuality(imageQuality)} onChange={(event) => onImageQuality(normalizeImageOutputQuality(event.target.value))} aria-label="图片质量">
              {imageOutputQualityOptions.map((item) => <option key={item.value} value={item.value}>{item.label} · x{item.multiplier}</option>)}
            </select>
          </div>
          <small className="route-param-hint">生图参数倍率 x{imageParameterMultiplier(imageSize, imageQuality).toFixed(2)}，生成时按当前项目参数扣费。</small>
        </>
      ) : null}
    </div>
  );
}

function ProviderAvatar({ provider }: { provider?: ModelProvider }) {
  const label = provider?.name?.slice(0, 1).toUpperCase() || "M";
  return (
    <span className={`provider-avatar ${provider?.modality ?? "text"}`}>
      {provider?.iconUrl ? <img src={provider.iconUrl} alt={provider.name} /> : label}
    </span>
  );
}

function providerBadges(provider: ModelProvider) {
  const badges = [
    provider.capability.supportsReferenceImage ? "参考图" : "",
    provider.capability.supportsSeed ? "Seed" : "",
    provider.capability.supportsAsyncTask ? "异步任务" : "",
    provider.capability.supportsImageToVideo ? "图生视频" : "",
    provider.capability.maxDuration ? `最长 ${provider.capability.maxDuration}s` : ""
  ].filter(Boolean);
  return badges.length ? badges : [modalityLabel(provider.modality), provider.enabled ? "可用" : "停用"];
}

function modalityLabel(modality: ModelProvider["modality"]) {
  const labels: Record<ModelProvider["modality"], string> = {
    text: "文本",
    image: "生图",
    video: "视频",
    tts: "配音",
    embedding: "向量"
  };
  return labels[modality] ?? modality;
}

function WorkbenchOperationProgress({ operation, elapsed }: { operation: WorkbenchOperation; elapsed: number }) {
  const progress = estimatedProgress(operation.key, elapsed);
  return (
    <div className="workbench-operation-progress">
      <div className="workbench-operation-head">
        <span><Loader2 size={17} className="spin-icon" />{operation.title}</span>
        <strong>{progress.label}</strong>
      </div>
      <div className="operation-progress-track"><span style={{ width: `${progress.percent}%` }} /></div>
      <p>{operation.detail}</p>
    </div>
  );
}

function InlineProgress({ label, elapsed, operationKey }: { label: string; elapsed: number; operationKey?: OperationKey }) {
  const progress = estimatedProgress(operationKey ?? "images", elapsed);
  return (
    <div className="inline-progress-bar">
      <div><Loader2 size={16} className="spin-icon" /><strong>{label}</strong><span>{progress.label}</span></div>
      <div className="operation-progress-track"><span style={{ width: `${progress.percent}%` }} /></div>
    </div>
  );
}

function estimatedProgress(key: OperationKey, elapsed: number) {
  const expectedSeconds: Record<Exclude<OperationKey, null>, number> = {
    storyboard: 60,
    character: 90,
    images: 120,
    video: 300,
    export: 90,
    "shot-image": 100
  };
  const expected = expectedSeconds[key || "images"] ?? 90;
  const ratio = elapsed / expected;
  const percent = ratio <= 1
    ? Math.min(92, Math.round(10 + ratio * 82))
    : Math.min(99, Math.round(92 + Math.log2(1 + (elapsed - expected) / Math.max(10, expected / 4)) * 5));
  const remaining = Math.max(0, expected - elapsed);
  const label = remaining > 0 ? `${elapsed}s · 约剩 ${remaining}s` : `${elapsed}s · 上游仍在处理`;
  return { percent, label };
}

function operationElapsedFrom(operation: WorkbenchOperation | null) {
  if (!operation) return 0;
  return Math.max(0, Math.round((Date.now() - operation.startedAt) / 1000));
}

function CharacterLockBoard({
  report,
  projectId,
  characters,
  roleAssets,
  projectArtStyle,
  onGenerate,
  onRefresh,
  onRefreshQuality,
  qualityBusy,
  isBusy,
  onPreviewImage
}: {
  report?: QualityReport;
  projectId: string;
  characters: CharacterProfile[];
  roleAssets: AssetItem[];
  projectArtStyle: string;
  onGenerate: (input?: { characterIds?: string[]; forceRegenerate?: boolean }) => void;
  onRefresh: (projectId: string) => void | Promise<void>;
  onRefreshQuality: () => void;
  qualityBusy: boolean;
  isBusy: boolean;
  onPreviewImage: (preview: { url: string; title: string; prompt?: string }) => void;
}) {
  const [referenceInputs, setReferenceInputs] = useState<Record<string, string>>({});
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(characters[0]?.id ?? null);
  const [savingReferenceId, setSavingReferenceId] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState("");
  const [uploadResetKey, setUploadResetKey] = useState(0);
  const roleAssetByCharacterId = new Map(roleAssets.filter((asset) => asset.type === "role").map((asset) => [asset.relatedCharacterId, asset]));
  const roleDerivativesByCharacterId = groupRoleDerivatives(roleAssets);
  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? characters[0];
  const lockedCount = countCompletedCharacterSheets(characters, roleAssets);

  async function saveReferenceUrl(character: CharacterProfile) {
    const referenceUrl = referenceInputs[character.id]?.trim();
    if (!referenceUrl) return;
    setSavingReferenceId(character.id);
    setReferenceError("");
    try {
      await api.setCharacterReferenceImage(projectId, character.id, {
        referenceUrl,
        description: `${character.name} 用户提供的正面参考图`
      });
      setReferenceInputs((current) => ({ ...current, [character.id]: "" }));
      await onRefresh(projectId);
    } catch (err) {
      setReferenceError(err instanceof Error ? err.message : "角色参考图保存失败");
    } finally {
      setSavingReferenceId(null);
    }
  }

  async function uploadReferenceFile(character: CharacterProfile, file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setReferenceError("请上传 JPG、PNG、WebP 等图片文件。");
      return;
    }
    setSavingReferenceId(character.id);
    setReferenceError("");
    try {
      const referenceUrl = await fileToDataUrl(file);
      await api.setCharacterReferenceImage(projectId, character.id, {
        referenceUrl,
        description: `${character.name} 用户上传的正面参考图：${file.name}`
      });
      setUploadResetKey((value) => value + 1);
      await onRefresh(projectId);
    } catch (err) {
      setReferenceError(err instanceof Error ? err.message : "角色参考图上传失败");
    } finally {
      setSavingReferenceId(null);
    }
  }

  useEffect(() => {
    if (!selectedCharacterId && characters[0]) setSelectedCharacterId(characters[0].id);
  }, [characters, selectedCharacterId]);

  async function deleteReference(character: CharacterProfile) {
    if (!window.confirm(`确认删除「${character.name}」的上传锚定图和旧三视图？删除后可重新上传。`)) return;
    setSavingReferenceId(character.id);
    setReferenceError("");
    try {
      await api.deleteCharacterReferenceImage(projectId, character.id);
      setReferenceInputs((current) => ({ ...current, [character.id]: "" }));
      setUploadResetKey((value) => value + 1);
      await onRefresh(projectId);
    } catch (err) {
      setReferenceError(err instanceof Error ? err.message : "角色参考图删除失败");
    } finally {
      setSavingReferenceId(null);
    }
  }

  const selectedTurnaroundAsset = selectedCharacter ? findCharacterTurnaroundAsset(roleAssets, selectedCharacter.id) : undefined;
  const selectedPrimaryAsset = selectedCharacter
    ? roleAssetByCharacterId.get(selectedCharacter.id)
    : undefined;
  const selectedAsset = selectedTurnaroundAsset ?? selectedPrimaryAsset;
  const selectedDerivatives = selectedCharacter ? roleDerivativesByCharacterId.get(selectedCharacter.id) ?? [] : [];
  const selectedSlots = buildCharacterViewSlots(selectedAsset, selectedDerivatives);
  const selectedLocked = Boolean(selectedTurnaroundAsset?.referenceUrl && selectedTurnaroundAsset.status === "succeeded");

  return (
    <section className="panel character-lock-board character-turnaround-board">
      <div className="panel-head">
        <div>
          <h2>角色定稿工作台</h2>
          <small>上传参考图或直接生成三视图，先锁定角色正面、侧面、背面，再进入分镜图生产。</small>
        </div>
        <button className="primary-button" onClick={() => onGenerate()} disabled={isBusy || characters.length === 0}>
          <UserRound size={18} />补齐全部未定稿
        </button>
      </div>
      {referenceError ? <p className="danger-text">{referenceError}</p> : null}
      <div className="character-turnaround-layout">
        <aside className="character-roster">
          <div className="character-lock-summary compact">
            <strong>{lockedCount}/{characters.length}</strong>
            <span>已定稿</span>
          </div>
          {characters.map((character) => {
            const asset = findCharacterTurnaroundAsset(roleAssets, character.id) ?? roleAssetByCharacterId.get(character.id);
            const locked = Boolean(asset?.referenceUrl && asset.status === "succeeded");
            return (
              <button className={character.id === selectedCharacter?.id ? "character-roster-item active" : "character-roster-item"} key={character.id} onClick={() => setSelectedCharacterId(character.id)} type="button">
                <span className="character-roster-thumb">{asset?.referenceUrl ? <img src={asset.referenceUrl} alt={character.name} /> : <UserRound size={24} />}</span>
                <span><strong>{character.name}</strong><small>{character.identity}</small></span>
                <em>{locked ? "已定稿" : "待生成"}</em>
              </button>
            );
          })}
        </aside>

        <div className="turnaround-canvas-panel">
          <div className="turnaround-upload-row">
            {selectedCharacter ? (
              <>
                <label className="turnaround-dropzone">
                  <Upload size={24} />
                  <strong>上传角色参考图</strong>
                  <span>支持正面照或三视图总图，上传后作为角色身份锚点。</span>
                  <input key={`${selectedCharacter.id}-${uploadResetKey}`} type="file" accept="image/*" onChange={(event) => void uploadReferenceFile(selectedCharacter, event.target.files?.[0])} disabled={savingReferenceId === selectedCharacter.id} />
                </label>
                <div className="reference-url-row compact">
                  <input
                    value={referenceInputs[selectedCharacter.id] ?? ""}
                    onChange={(event) => setReferenceInputs((current) => ({ ...current, [selectedCharacter.id]: event.target.value }))}
                    placeholder="或粘贴角色图片 URL / data-url"
                  />
                  <button className="ghost-button" onClick={() => void saveReferenceUrl(selectedCharacter)} disabled={savingReferenceId === selectedCharacter.id || !referenceInputs[selectedCharacter.id]?.trim()} type="button">
                    {savingReferenceId === selectedCharacter.id ? "保存中" : "设为主参考"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
          <div className="turnaround-view-grid single">
            {selectedSlots.map((slot) => (
              <div className={slot.url ? "turnaround-view-card-wrap ready" : "turnaround-view-card-wrap"} key={slot.label}>
                <button className={slot.url ? "turnaround-view-card ready" : "turnaround-view-card"} type="button" onClick={() => slot.url && onPreviewImage({ url: slot.url, title: `${selectedCharacter?.name ?? "角色"} · ${slot.label}`, prompt: slot.prompt })}>
                  <strong>{slot.label}</strong>
                  {slot.url ? <img src={slot.url} alt={`${selectedCharacter?.name ?? "角色"}${slot.label}`} /> : <div><UserRound size={28} /><span>待生成</span></div>}
                </button>
                {slot.kind === "anchor" && slot.url && selectedCharacter ? (
                  <button className="turnaround-delete-anchor" type="button" title="删除锚定图并重新上传" onClick={() => void deleteReference(selectedCharacter)} disabled={savingReferenceId === selectedCharacter.id}>
                    {savingReferenceId === selectedCharacter.id ? <Loader2 size={14} className="spin-icon" /> : <Trash2 size={14} />}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <aside className="character-inspector">
          {selectedCharacter ? (
            <>
              <div className="character-inspector-head">
                <span className={selectedLocked ? "status succeeded" : "status pending"}>{selectedLocked ? "已定稿" : "待生成"}</span>
                <h3>{selectedCharacter.name}</h3>
                <p>{selectedCharacter.identity}</p>
              </div>
              <dl>
                <div><dt>外貌锚点</dt><dd>{selectedCharacter.appearance}</dd></div>
                <div><dt>服装锚点</dt><dd>{selectedCharacter.costume}</dd></div>
                <div><dt>性格</dt><dd>{selectedCharacter.personality}</dd></div>
                <div><dt>Seed</dt><dd>{selectedCharacter.seed ?? "未固定"} · {selectedCharacter.consistencyLevel}</dd></div>
                <div><dt>负面词</dt><dd>{selectedCharacter.negativePrompt}</dd></div>
              </dl>
              <div className="character-generation-note">
                <strong>生成规则</strong>
                <span>每个角色只生成一张三视图总图，画面内包含正面、侧面、背面三栏；有上传参考图时会作为身份锚点，避免串到其他角色。</span>
                <small>{projectArtStyle || "AI 自动匹配画风"}</small>
              </div>
              <button className="primary-button full-button" onClick={() => onGenerate({ characterIds: [selectedCharacter.id], forceRegenerate: true })} disabled={isBusy}>
                {isBusy ? <Loader2 size={16} className="spin-icon" /> : <Sparkles size={16} />}用当前主参考生成三视图
              </button>
            </>
          ) : <p className="muted">暂无角色卡，请先生成剧本。</p>}
        </aside>
      </div>
      <StageFeedbackPanel projectId={projectId} stage="character" report={report} onRefreshQuality={onRefreshQuality} qualityBusy={qualityBusy} />
    </section>
  );
}

function StoryboardDirectorBoard({
  report,
  projectId,
  storyboards,
  selectedShot,
  setSelectedShotId,
  imageAssetByShotId,
  videoAssetByShotId,
  ratioClass,
  videoRatio,
  onGenerateStoryboards,
  onGenerateImages,
  onRefresh,
  onRefreshQuality,
  qualityBusy,
  isBusy,
  operation,
  operationElapsed,
  onPreviewImage
}: {
  report?: QualityReport;
  projectId: string;
  storyboards: StoryboardShot[];
  selectedShot?: StoryboardShot;
  setSelectedShotId: (id: string) => void;
  imageAssetByShotId: Map<string, AssetItem>;
  videoAssetByShotId: Map<string, AssetItem>;
  ratioClass: string;
  videoRatio: string;
  onGenerateStoryboards: () => void;
  onGenerateImages: (options?: { shotIds?: string[]; forceRegenerate?: boolean; navigateToImages?: boolean }) => Promise<boolean>;
  onRefresh: (projectId: string) => void | Promise<void>;
  onRefreshQuality: () => void;
  qualityBusy: boolean;
  isBusy: boolean;
  operation: WorkbenchOperation | null;
  operationElapsed: number;
  onPreviewImage: (preview: { url: string; title: string; prompt?: string }) => void;
}) {
  const [draft, setDraft] = useState<ShotDraft>(() => selectedShot ? shotToDraft(selectedShot) : emptyShotDraft());
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [selectedForBatch, setSelectedForBatch] = useState<string[]>([]);
  const [localMessage, setLocalMessage] = useState("");
  const [localError, setLocalError] = useState("");
  const [directorRows, setDirectorRows] = useState<DirectorStoryboardRow[]>([]);
  const [directorLoading, setDirectorLoading] = useState(false);
  const [directorExportUrl, setDirectorExportUrl] = useState("");

  useEffect(() => {
    if (selectedShot) setDraft(shotToDraft(selectedShot));
    setLocalMessage("");
    setLocalError("");
  }, [selectedShot?.id]);

  useEffect(() => {
    if (!storyboards.length) return;
    let canceled = false;
    setDirectorLoading(true);
    api.directorStoryboard(projectId)
      .then((rows) => { if (!canceled) setDirectorRows(rows); })
      .catch((error) => { if (!canceled) setLocalError(error instanceof Error ? error.message : "导演分镜表加载失败"); })
      .finally(() => { if (!canceled) setDirectorLoading(false); });
    return () => { canceled = true; };
  }, [projectId, storyboards.length]);

  if (!selectedShot) {
    return (
      <section className="panel empty-state workflow-empty">
        <Sparkles size={28} />
        <strong>剧本和角色已就绪，下一步生成镜头级分镜表</strong>
        <span>生成后这里会出现镜头编排、画面预览、图片提示词、视频提示词和资产引用。</span>
        <button className="primary-button" onClick={onGenerateStoryboards} disabled={isBusy}>生成分镜表</button>
      </section>
    );
  }
  const imageAsset = imageAssetByShotId.get(selectedShot.id);
  const videoAsset = videoAssetByShotId.get(selectedShot.id);
  const isCurrentShotGenerating = operation?.key === "images" && Boolean(operation.targetShotIds?.includes(selectedShot.id));
  const selectedBatchCount = selectedForBatch.length;

  async function saveShot() {
    if (!selectedShot) return;
    setSaving(true);
    setLocalMessage("");
    setLocalError("");
    try {
      await api.updateStoryboardShot(projectId, selectedShot.id, {
        duration: Math.max(1, Math.min(30, Number(draft.duration) || selectedShot.duration)),
        shotSize: draft.shotSize,
        cameraAngle: draft.cameraAngle,
        cameraMovement: draft.cameraMovement,
        characters: splitNames(draft.characters),
        scene: draft.scene,
        pictureDesc: draft.pictureDesc,
        action: draft.action,
        orientation: draft.orientation,
        spatialRelation: draft.spatialRelation,
        emotion: draft.emotion,
        dialogue: draft.dialogue,
        voiceOver: draft.voiceOver,
        environmentSound: draft.environmentSound,
        soundEffect: draft.soundEffect,
        imagePrompt: draft.imagePrompt,
        videoPrompt: draft.videoPrompt
      });
      setLocalMessage("镜头已保存，旧分镜图/视频资产已标记为需要重新生成。");
      await onRefresh(projectId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "镜头保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function regenerateShotImage() {
    if (!selectedShot) return;
    setRegenerating(true);
    setLocalMessage("");
    setLocalError("");
    try {
      const ok = await onGenerateImages({ shotIds: [selectedShot.id], forceRegenerate: Boolean(imageAsset), navigateToImages: false });
      if (!ok) return;
      setLocalMessage(imageAsset ? "当前镜头分镜图已重新生成。" : "当前镜头分镜图已生成。");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "单镜头生图失败");
    } finally {
      setRegenerating(false);
    }
  }

  function toggleBatchShot(shotId: string) {
    setSelectedForBatch((current) => current.includes(shotId) ? current.filter((id) => id !== shotId) : [...current, shotId]);
  }

  async function generateSelectedShots() {
    const shotIds = selectedBatchCount ? selectedForBatch : storyboards.filter((shot) => !imageAssetByShotId.has(shot.id)).map((shot) => shot.id);
    if (!shotIds.length) {
      setLocalMessage("当前没有待生成的镜头图。");
      return;
    }
    if (!window.confirm(`确认生成 ${shotIds.length} 个镜头图？图片生成需 1-2 分钟，请耐心等待。`)) return;
    await onGenerateImages({ shotIds, navigateToImages: true });
    setSelectedForBatch([]);
  }

  async function exportDirectorBoard() {
    setDirectorLoading(true);
    setLocalMessage("");
    setLocalError("");
    try {
      const pack = await api.exportDirectorStoryboard(projectId);
      setDirectorRows(pack.rows);
      setDirectorExportUrl(pack.htmlUrl);
      setLocalMessage(`导演分镜长表已生成：${pack.htmlUrl}`);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "导演分镜表导出失败");
    } finally {
      setDirectorLoading(false);
    }
  }

  const selectedDirectorRow = directorRows.find((row) => row.shotId === selectedShot.id);

  return (
    <section className="panel director-board director-studio-layout">
      <div className="director-shot-planning-console">
        <div>
          <span className="section-kicker">DIRECTOR BOARD</span>
          <h2>导演分镜草图 + 站位 + CAM/FOV</h2>
          <p>左侧看镜头草图/首帧，中间看导演执行说明，右侧看人物站位、机位方向和 FOV。草图文字不交给图像模型，说明和机位图由 SVG/HTML 精确生成。</p>
        </div>
        <div className="inline-actions">
          {directorExportUrl ? <a className="ghost-button" href={directorExportUrl} target="_blank" rel="noreferrer">打开导演长表</a> : null}
          <button className="primary-button" onClick={() => void exportDirectorBoard()} disabled={directorLoading || storyboards.length === 0} type="button">{directorLoading ? <Loader2 size={18} className="spin-icon" /> : <Download size={18} />}导出导演长表</button>
        </div>
      </div>
      <div className="shot-list-panel compact-shot-list-panel">
        <div className="panel-head"><h2>镜头列表</h2><small>{storyboards.length} 镜</small></div>
        <div className="shot-batch-toolbar">
          <button className="ghost-button" onClick={() => setSelectedForBatch(storyboards.filter((shot) => !imageAssetByShotId.has(shot.id)).map((shot) => shot.id))} type="button">选择待生成</button>
          <button className="primary-button" onClick={() => void generateSelectedShots()} disabled={isBusy || operation?.key === "images"} type="button">{selectedBatchCount ? `生成已选 ${selectedBatchCount}` : "生成待生成"}</button>
        </div>
        <div className="shot-list">{storyboards.map((shot, index) => {
          const hasImage = imageAssetByShotId.has(shot.id);
          return (
            <button key={shot.id} className={shot.id === selectedShot.id ? "shot-list-item active" : "shot-list-item"} onClick={() => setSelectedShotId(shot.id)} type="button">
              <input type="checkbox" checked={selectedForBatch.includes(shot.id)} onChange={() => toggleBatchShot(shot.id)} onClick={(event) => event.stopPropagation()} />
              <span><strong>{formatShotNo(shot, index)}</strong><small>{shot.shotSize} · {shot.cameraMovement} · {shot.duration}s</small></span>
              <em>{hasImage ? "已出图" : "待出图"}</em>
            </button>
          );
        })}</div>
      </div>
      <div className="shot-main-preview">
        <button className={`shot-canvas shot-canvas-button ${ratioClass}`} type="button" onClick={() => imageAsset?.referenceUrl && onPreviewImage({ url: imageAsset.referenceUrl, title: formatShotNo(selectedShot, storyboards.findIndex((shot) => shot.id === selectedShot.id)), prompt: selectedShot.imagePrompt })}>
          {imageAsset?.referenceUrl ? <img src={imageAsset.referenceUrl} alt={imageAsset.name} /> : <div className="shot-placeholder"><Sparkles size={28} /><strong>待生成画面</strong><span>{videoRatio}</span></div>}
          <small className={`status ${imageAsset?.status ?? selectedShot.status}`}>{isCurrentShotGenerating || regenerating ? "生成中" : statusText[imageAsset?.status ?? selectedShot.status]}</small>
        </button>
        {(isCurrentShotGenerating || regenerating) ? <InlineProgress label="正在生成本镜头图" elapsed={operationElapsed} operationKey="shot-image" /> : null}
        <p className="image-wait-hint">图片生成需 1-2 分钟，请耐心等待~</p>
        <details className="prompt-preview shot-prompt-details">
          <summary>查看图片提示词</summary>
          <p>{selectedShot.imagePrompt}</p>
        </details>
        {selectedDirectorRow ? <DirectorShotPreview row={selectedDirectorRow} /> : null}
      </div>
      <div className="shot-inspector editable-shot-inspector">
        <div className="panel-head shot-editor-head"><div><h2>{formatShotNo(selectedShot, storyboards.findIndex((shot) => shot.id === selectedShot.id))}</h2><small>只编辑会影响分镜图和视频首帧的核心信息</small></div><small>{selectedShot.duration}s</small></div>
        <div className="shot-edit-grid compact essentials">
          <label><span>时长</span><input value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: event.target.value })} /></label>
          <label><span>出场角色</span><input value={draft.characters} onChange={(event) => setDraft({ ...draft, characters: event.target.value })} placeholder="用顿号或逗号分隔" /></label>
          <label><span>场景</span><input value={draft.scene} onChange={(event) => setDraft({ ...draft, scene: event.target.value })} /></label>
        </div>
        <label className="shot-edit-field"><span>画面描述</span><textarea value={draft.pictureDesc} onChange={(event) => setDraft({ ...draft, pictureDesc: event.target.value })} /></label>
        <div className="shot-edit-grid compact">
          <label><span>景别</span><input value={draft.shotSize} onChange={(event) => setDraft({ ...draft, shotSize: event.target.value })} /></label>
          <label><span>运镜</span><input value={draft.cameraMovement} onChange={(event) => setDraft({ ...draft, cameraMovement: event.target.value })} /></label>
          <label><span>动作/情绪</span><input value={draft.action || draft.emotion} onChange={(event) => setDraft({ ...draft, action: event.target.value, emotion: event.target.value })} /></label>
        </div>
        <label className="shot-edit-field"><span>图片提示词</span><textarea value={draft.imagePrompt} onChange={(event) => setDraft({ ...draft, imagePrompt: event.target.value })} /></label>
        <label className="shot-edit-field"><span>视频提示词</span><textarea value={draft.videoPrompt} onChange={(event) => setDraft({ ...draft, videoPrompt: event.target.value })} /></label>
        {selectedDirectorRow ? (
          <details className="director-seedance-details" open>
            <summary>增强 Seedance 提示词 / 连续性锚点</summary>
            <p>{selectedDirectorRow.seedancePrompt}</p>
          </details>
        ) : null}
        <details className="advanced-shot-settings">
          <summary>台词 / 旁白 / 声音草稿</summary>
          <p className="advanced-shot-note">台词、旁白、环境声和音效先作为视频/字幕素材草稿保留；TTS、声音克隆和 SRT Agent 后续单独接入后再启用生成。</p>
          <div className="shot-edit-grid compact">
            <label><span>视角</span><input value={draft.cameraAngle} onChange={(event) => setDraft({ ...draft, cameraAngle: event.target.value })} /></label>
            <label><span>站位</span><input value={draft.spatialRelation} onChange={(event) => setDraft({ ...draft, spatialRelation: event.target.value })} /></label>
            <label><span>台词</span><input value={draft.dialogue} onChange={(event) => setDraft({ ...draft, dialogue: event.target.value })} /></label>
            <label><span>旁白</span><input value={draft.voiceOver} onChange={(event) => setDraft({ ...draft, voiceOver: event.target.value })} /></label>
            <label><span>环境声</span><input value={draft.environmentSound} onChange={(event) => setDraft({ ...draft, environmentSound: event.target.value })} /></label>
            <label><span>音效</span><input value={draft.soundEffect} onChange={(event) => setDraft({ ...draft, soundEffect: event.target.value })} /></label>
          </div>
        </details>
        <div className="shot-state-line"><span>图像：{imageAsset ? "已生成" : "待生成"}</span><span>视频：{videoAsset ? "已生成草稿" : "待生成"}</span></div>
        <div className="inline-actions stretch shot-edit-actions">
          <button className="ghost-button" onClick={() => setDraft(shotToDraft(selectedShot))} disabled={saving || regenerating} type="button">还原</button>
          <button className="primary-button" onClick={() => void saveShot()} disabled={saving || regenerating} type="button"><Save size={18} />{saving ? "保存中..." : "保存镜头"}</button>
          <button className="ghost-button" onClick={() => void regenerateShotImage()} disabled={saving || regenerating || operation?.key === "images"} type="button"><Images size={18} />{regenerating || isCurrentShotGenerating ? "生成中..." : imageAsset ? "重新生成本镜头图" : "生成本镜头图"}</button>
        </div>
        {localMessage ? <p className="success-text">{localMessage}</p> : null}
        {localError ? <p className="danger-text">{localError}</p> : null}
      </div>
      <StoryboardTable storyboards={storyboards} />
      <StageFeedbackPanel projectId={projectId} stage="storyboard" report={report} onRefreshQuality={onRefreshQuality} qualityBusy={qualityBusy} />
    </section>
  );
}

function DirectorShotPreview({ row }: { row: DirectorStoryboardRow }) {
  return (
    <div className="director-shot-preview-card">
      <div className="director-shot-preview-head">
        <strong>{row.shotNo} · {row.lens} · FOV {row.fov}°</strong>
        <span>{row.cameraMovement}</span>
      </div>
      <div className="director-shot-preview-grid">
        <div>
          <h3>导演执行说明</h3>
          {row.directorNotes.map((note) => <p key={note}>{note}</p>)}
        </div>
        <div className="director-blocking-svg" dangerouslySetInnerHTML={{ __html: row.blockingSvg }} />
      </div>
    </div>
  );
}

function ShotImageGallery({
  report,
  storyboards,
  imageAssetByShotId,
  ratioClass,
  videoRatio,
  onGenerate,
  onOpenDirector,
  onRefresh,
  onRefreshQuality,
  qualityBusy,
  projectId,
  isBusy,
  operation,
  operationElapsed,
  onPreviewImage
}: {
  report?: QualityReport;
  storyboards: StoryboardShot[];
  imageAssetByShotId: Map<string, AssetItem>;
  ratioClass: string;
  videoRatio: string;
  onGenerate: (options?: { shotIds?: string[]; forceRegenerate?: boolean; navigateToImages?: boolean }) => Promise<boolean>;
  onOpenDirector: () => void;
  onRefresh: (projectId: string) => void | Promise<void>;
  onRefreshQuality: () => void;
  qualityBusy: boolean;
  projectId: string;
  isBusy: boolean;
  operation: WorkbenchOperation | null;
  operationElapsed: number;
  onPreviewImage: (preview: { url: string; title: string; prompt?: string }) => void;
}) {
  const hasImages = storyboards.some((shot) => imageAssetByShotId.has(shot.id));
  const [busyShotId, setBusyShotId] = useState<string | null>(null);
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [editingShotId, setEditingShotId] = useState<string | null>(storyboards[0]?.id ?? null);
  const [shotDrafts, setShotDrafts] = useState<Record<string, Pick<ShotDraft, "pictureDesc" | "imagePrompt" | "videoPrompt">>>({});
  const [savingShotId, setSavingShotId] = useState<string | null>(null);

  useEffect(() => {
    if (!editingShotId && storyboards[0]) setEditingShotId(storyboards[0].id);
  }, [editingShotId, storyboards]);

  useEffect(() => {
    if (!busyShotId) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busyShotId]);

  async function regenerate(shotId: string) {
    setBusyShotId(shotId);
    setElapsed(0);
    setError("");
    setMessage("");
    try {
      const ok = await onGenerate({ shotIds: [shotId], forceRegenerate: imageAssetByShotId.has(shotId), navigateToImages: false });
      if (!ok) return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "单镜头生图失败");
    } finally {
      setBusyShotId(null);
    }
  }

  function draftFor(shot: StoryboardShot) {
    return shotDrafts[shot.id] ?? { pictureDesc: shot.pictureDesc, imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt };
  }

  function updateDraft(shotId: string, patch: Partial<Pick<ShotDraft, "pictureDesc" | "imagePrompt" | "videoPrompt">>) {
    const shot = storyboards.find((item) => item.id === shotId);
    if (!shot) return;
    setShotDrafts((current) => ({ ...current, [shotId]: { ...draftFor(shot), ...patch } }));
  }

  async function saveShotPrompt(shot: StoryboardShot, regenerateAfterSave = false) {
    const draft = draftFor(shot);
    setSavingShotId(shot.id);
    setError("");
    setMessage("");
    try {
      await api.updateStoryboardShot(projectId, shot.id, {
        pictureDesc: draft.pictureDesc,
        imagePrompt: draft.imagePrompt,
        videoPrompt: draft.videoPrompt
      });
      setMessage(regenerateAfterSave ? "镜头提示词已保存，正在重新生成本镜头图。" : "镜头提示词已保存。");
      await onRefresh(projectId);
      if (regenerateAfterSave) await regenerate(shot.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "镜头提示词保存失败");
    } finally {
      setSavingShotId(null);
    }
  }

  function toggleSelected(shotId: string) {
    setSelectedShotIds((current) => current.includes(shotId) ? current.filter((id) => id !== shotId) : [...current, shotId]);
  }

  async function generateSelected() {
    const shotIds = selectedShotIds.length ? selectedShotIds : storyboards.filter((shot) => !imageAssetByShotId.has(shot.id)).map((shot) => shot.id);
    if (!shotIds.length) return;
    if (!window.confirm(`确认生成 ${shotIds.length} 个镜头图？图片生成需 1-2 分钟，请耐心等待。`)) return;
    await onGenerate({ shotIds, navigateToImages: true });
    setSelectedShotIds([]);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>分镜图工作台</h2>
          <small>按已定稿角色生成首帧图；导演机位、FOV 和提示词细节收在高级分镜里。</small>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={onOpenDirector} type="button"><WandSparkles size={18} />高级分镜</button>
          <button className="ghost-button" onClick={() => setSelectedShotIds(storyboards.filter((shot) => !imageAssetByShotId.has(shot.id)).map((shot) => shot.id))} type="button">选择待生成</button>
          <button className="primary-button" onClick={() => void generateSelected()} disabled={isBusy || storyboards.length === 0 || operation?.key === "images"}>
            <Images size={18} />{selectedShotIds.length ? `生成已选 ${selectedShotIds.length}` : "生成待生成分镜图"}
          </button>
        </div>
      </div>
      <p className="image-wait-hint">图片生成需 1-2 分钟，请耐心等待~ 推荐先勾选 1-3 张测试风格，再批量补齐。</p>
      {error ? <p className="danger-text">{error}</p> : null}
      {message ? <p className="success-text">{message}</p> : null}
      {busyShotId ? <div className="shot-inline-progress"><Loader2 className="spin-icon" size={16} />正在生成本镜头图 · {elapsed}s<div className="operation-progress-track"><span style={{ width: `${Math.min(92, 18 + elapsed * 2.5)}%` }} /></div></div> : null}
      {operation?.key === "images" ? <InlineProgress label={operation.title} elapsed={operationElapsed} operationKey="images" /> : null}
      {!hasImages ? <div className="empty-state gallery-empty"><Sparkles size={28} /><strong>还没有分镜图</strong><span>先确认剧本和角色；需要调整机位/FOV 时进入高级分镜，再批量生成视频首帧。</span></div> : null}
      <div className="storyboard-contact-sheet">
        <div className="storyboard-contact-head">
          <div><strong>整片分镜预览</strong><span>{imageAssetByShotId.size}/{storyboards.length} 张首帧已就绪</span></div>
          <small>横向检查角色、画风、场景连续性；发现不对再编辑单镜头提示词重生。</small>
        </div>
        <div className="storyboard-contact-strip">
          {storyboards.map((shot, index) => {
            const imageAsset = imageAssetByShotId.get(shot.id);
            return (
              <button className={imageAsset?.referenceUrl ? "contact-frame ready" : "contact-frame"} key={shot.id} type="button" onClick={() => setEditingShotId(shot.id)}>
                {imageAsset?.referenceUrl ? <img src={imageAsset.referenceUrl} alt={imageAsset.name} /> : <span>{String(index + 1).padStart(2, "0")}</span>}
                <em>{formatShotNo(shot, index)}</em>
              </button>
            );
          })}
        </div>
      </div>
      <div className="shot-gallery-grid">
        {storyboards.map((shot, index) => {
          const imageAsset = imageAssetByShotId.get(shot.id);
          const draft = draftFor(shot);
          return (
            <article className="shot-card" key={shot.id}>
              <button className={`shot-preview shot-preview-button ${ratioClass}`} type="button" onClick={() => imageAsset?.referenceUrl && onPreviewImage({ url: imageAsset.referenceUrl, title: formatShotNo(shot, index), prompt: shot.imagePrompt })}>
                {imageAsset?.referenceUrl ? <img src={imageAsset.referenceUrl} alt={imageAsset.name} /> : <div className="shot-preview-empty"><strong>{formatShotNo(shot, index)}</strong><small>{videoRatio} · 待生产</small></div>}
                <span className={`status ${imageAsset?.status ?? "pending"}`}>{statusText[imageAsset?.status ?? "pending"]}</span>
              </button>
              <div className="shot-card-body">
                <label className="shot-select-line"><input type="checkbox" checked={selectedShotIds.includes(shot.id)} onChange={() => toggleSelected(shot.id)} /><strong>{formatShotNo(shot, index)}</strong></label>
                <span>{shot.shotSize} · {shot.cameraMovement} · {shot.duration}s</span>
                <p>{shot.pictureDesc}</p>
                <div className="quality-check-row"><span>角色一致</span><span>画幅正确</span><span>可做首帧</span></div>
                <div className="shot-card-action-row">
                  <button className="ghost-button shot-card-action" onClick={() => setEditingShotId(editingShotId === shot.id ? null : shot.id)} type="button">编辑提示词</button>
                  <button className="ghost-button shot-card-action" onClick={() => void regenerate(shot.id)} disabled={Boolean(busyShotId) || isBusy || savingShotId === shot.id} type="button">{busyShotId === shot.id ? "生成中..." : imageAsset ? "重生本图" : "生成本图"}</button>
                </div>
                {editingShotId === shot.id ? (
                  <div className="shot-prompt-editor">
                    <label><span>画面描述</span><textarea value={draft.pictureDesc} onChange={(event) => updateDraft(shot.id, { pictureDesc: event.target.value })} /></label>
                    <label><span>图片提示词</span><textarea value={draft.imagePrompt} onChange={(event) => updateDraft(shot.id, { imagePrompt: event.target.value })} /></label>
                    <label><span>视频提示词</span><textarea value={draft.videoPrompt} onChange={(event) => updateDraft(shot.id, { videoPrompt: event.target.value })} /></label>
                    <div className="inline-actions stretch">
                      <button className="ghost-button" onClick={() => setShotDrafts((current) => ({ ...current, [shot.id]: { pictureDesc: shot.pictureDesc, imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt } }))} disabled={savingShotId === shot.id} type="button">还原</button>
                      <button className="primary-button" onClick={() => void saveShotPrompt(shot)} disabled={savingShotId === shot.id} type="button"><Save size={16} />保存</button>
                      <button className="ghost-button" onClick={() => void saveShotPrompt(shot, true)} disabled={Boolean(busyShotId) || isBusy || savingShotId === shot.id} type="button"><Images size={16} />保存并重生</button>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      <StageFeedbackPanel projectId={projectId} stage="image" report={report} onRefreshQuality={onRefreshQuality} qualityBusy={qualityBusy} />
    </section>
  );
}

function VideoTimeline({
  latestExport,
  report,
  projectId,
  storyboards,
  imageAssetByShotId,
  videoAssetByShotId,
  ratioClass,
  onGenerate,
  isBusy,
  operation,
  operationElapsed,
  onExportStoryboard,
  onCreateExport,
  onRefreshQuality,
  qualityBusy
}: {
  latestExport?: ExportJob | null;
  report?: QualityReport;
  projectId: string;
  storyboards: StoryboardShot[];
  imageAssetByShotId: Map<string, AssetItem>;
  videoAssetByShotId: Map<string, AssetItem>;
  ratioClass: string;
  onGenerate: () => void;
  isBusy: boolean;
  operation: WorkbenchOperation | null;
  operationElapsed: number;
  onExportStoryboard: () => void;
  onCreateExport: (type: "tts" | "subtitle" | "video_export") => Promise<ExportJob | undefined>;
  onRefreshQuality: () => void;
  qualityBusy: boolean;
}) {
  const readyImageCount = storyboards.filter((shot) => imageAssetByShotId.has(shot.id)).length;
  const playableVideoCount = storyboards.filter((shot) => isPlayableVideoUrl(videoAssetByShotId.get(shot.id)?.referenceUrl)).length;
  const queuedVideoCount = storyboards.filter((shot) => {
    const asset = videoAssetByShotId.get(shot.id);
    return asset && !isPlayableVideoUrl(asset.referenceUrl);
  }).length;
  const latestOutput = latestExport?.outputUrl;
  const latestOutputIsMp4 = latestExport?.outputKind === "mp4" || Boolean(latestOutput?.endsWith(".mp4"));
  const latestOutputIsDiagnostic = latestExport?.outputKind === "diagnostic_bundle";

  async function runExport(type: "tts" | "subtitle" | "video_export") {
    await onCreateExport(type);
  }

  return (
    <section className="panel video-timeline-panel">
      <div className="panel-head">
        <div>
          <h2>视频合成工作台</h2>
          <small>先用已确认的分镜图生成镜头视频片段，再进入配音、字幕和最终合成。当前首帧 {readyImageCount}/{storyboards.length}，可播放视频 {playableVideoCount}/{storyboards.length}。</small>
        </div>
        <button className="primary-button" onClick={onGenerate} disabled={isBusy || readyImageCount === 0}>
          {operation?.key === "video" ? <Loader2 size={18} className="spin-icon" /> : <Play size={18} />}
          {queuedVideoCount ? "继续/回写视频片段" : "生成镜头视频片段"}
        </button>
      </div>
      {operation?.key === "video" ? <InlineProgress label={operation.title} elapsed={operationElapsed} operationKey="video" /> : null}
      <div className="video-action-guide">
        <article className={readyImageCount ? "ready" : ""}><strong>1</strong><span>生成片段</span><small>只提交已有首帧的镜头到视频模型</small></article>
        <article className={playableVideoCount ? "ready" : ""}><strong>2</strong><span>配音字幕</span><small>按镜头台词生成音轨和 SRT</small></article>
        <article className={latestOutputIsMp4 ? "ready" : ""}><strong>3</strong><span>合成 MP4</span><small>FFmpeg 封装片段、配音、字幕</small></article>
        <article className={latestOutputIsMp4 ? "ready" : ""}><strong>4</strong><span>预览下载</span><small>生成记录带下载权限</small></article>
      </div>
      <div className="video-flow-note">
        <strong>视频闭环</strong>
        <span>按“生成片段、配音字幕、合成 MP4、下载”执行；已有可播放片段会优先进入合成，缺片段时会用首帧补位，FFmpeg 不可用时保留可复盘诊断清单。</span>
      </div>
      <StoryboardTable storyboards={storyboards} imageAssetByShotId={imageAssetByShotId} videoAssetByShotId={videoAssetByShotId} />
      <div className="export-action-grid">
        <button className="ghost-button" onClick={onExportStoryboard}><Download size={18} />下载分镜清单</button>
        <button className="ghost-button" onClick={() => void runExport("tts")} disabled={isBusy}><Download size={18} />2. 生成配音</button>
        <button className="ghost-button" onClick={() => void runExport("subtitle")} disabled={isBusy}><Download size={18} />2. 生成字幕</button>
        <button className="primary-button" onClick={() => void runExport("video_export")} disabled={isBusy || storyboards.length === 0}><Film size={18} />3. 合成 MP4 成片</button>
      </div>
      {latestExport ? (
        <div className={`export-result-card ${latestOutputIsMp4 ? "ready" : "diagnostic"}`}>
          <div>
            <strong>{latestOutputIsMp4 ? "MP4 成片已生成" : latestOutputIsDiagnostic ? "已生成诊断包" : "导出资产已生成"}</strong>
            <span>{latestExport.errorReason || (latestOutputIsMp4 ? "可以预览和下载最终成片；字幕和配音已随导出任务写入资产库。" : latestOutputIsDiagnostic ? "当前环境未完成 MP4 封装，已输出片段、配音、字幕、FFmpeg 状态和复盘清单。" : "该资产会在最终合成 MP4 时自动复用。")}</span>
            <div className="export-result-meta">
              <span>FFmpeg：{latestExport.ffmpegReady === false ? "未就绪" : latestExport.ffmpegReady ? "已就绪" : "不适用"}</span>
              <span>片段：{latestExport.clipCount ?? playableVideoCount}</span>
              <span>下载：权限校验</span>
            </div>
            {latestExport.warnings?.length ? <p className="export-warning">{latestExport.warnings.slice(0, 2).join("；")}</p> : null}
            <div className="export-asset-links">
              {latestExport.manifestUrl ? <a href={latestExport.manifestUrl} target="_blank" rel="noreferrer">诊断清单</a> : null}
              {latestExport.audioUrl ? <a href={latestExport.audioUrl} target="_blank" rel="noreferrer">配音</a> : null}
              {latestExport.subtitleUrl ? <a href={latestExport.subtitleUrl} target="_blank" rel="noreferrer">字幕</a> : null}
            </div>
          </div>
          {latestOutputIsMp4 && (latestExport.previewUrl || latestOutput) ? <video className="export-preview-video" src={latestExport.previewUrl || latestOutput} controls preload="metadata" /> : null}
          {latestOutput ? <a className="ghost-button" href={latestExport.downloadUrl || latestOutput} download>{latestOutputIsMp4 ? "下载 MP4" : latestOutputIsDiagnostic ? "下载诊断包" : "下载文件"}</a> : null}
        </div>
      ) : null}
      <div className="video-timeline">
        {storyboards.map((shot, index) => {
          const imageAsset = imageAssetByShotId.get(shot.id);
          const videoAsset = videoAssetByShotId.get(shot.id);
          const playable = isPlayableVideoUrl(videoAsset?.referenceUrl);
          const videoStatus = videoTimelineStatus(videoAsset, Boolean(imageAsset));
          return (
            <article className="video-timeline-row" key={shot.id}>
              <div className="timeline-index"><span>{index + 1}</span></div>
              <div className={`timeline-frame ${ratioClass}`}>
                {playable ? <video src={videoAsset!.referenceUrl} controls preload="metadata" /> : imageAsset?.referenceUrl ? <img src={imageAsset.referenceUrl} alt={imageAsset.name} /> : <span>首帧待生成</span>}
              </div>
              <div className="timeline-content">
                <div className="shot-title-row"><strong>{formatShotNo(shot, index)}</strong><span>{shot.duration}s</span></div>
                <p>{shot.videoPrompt}</p>
                <div className="shot-pills"><span>{shot.cameraMovement}</span><span>{shot.emotion || "情绪推进"}</span><span>{videoStatus.hint}</span></div>
              </div>
              <small className={`status ${videoStatus.status}`}>{videoStatus.label}</small>
            </article>
          );
        })}
      </div>
      <StageFeedbackPanel projectId={projectId} stage="video" report={report} onRefreshQuality={onRefreshQuality} qualityBusy={qualityBusy} />
    </section>
  );
}

function StoryboardTable({
  storyboards,
  imageAssetByShotId,
  videoAssetByShotId
}: {
  storyboards: StoryboardShot[];
  imageAssetByShotId?: Map<string, AssetItem>;
  videoAssetByShotId?: Map<string, AssetItem>;
}) {
  return (
    <section className="panel storyboard-execution-table">
      <div className="panel-head">
        <div>
          <h2>镜头级分镜表</h2>
          <small>用于核对镜头顺序、画面、台词、首帧和视频片段状态；视频合成按这张表从上到下执行。</small>
        </div>
      </div>
      <div className="storyboard-table director-table">
        <div className="storyboard-row header"><span>镜头</span><span>时长</span><span>状态</span><span>景别/运镜</span><span>角色</span><span>画面</span><span>台词/VO</span></div>
        {storyboards.map((shot) => (
          <div className="storyboard-row" key={shot.id}>
            <strong>{shot.episodeNo}-{shot.sceneNo}-{shot.shotNo}</strong>
            <span>{shot.duration}s</span>
            <span className="storyboard-status-stack">
              <em>{imageAssetByShotId?.has(shot.id) ? "首帧已就绪" : "缺首帧"}</em>
              <em>{isPlayableVideoUrl(videoAssetByShotId?.get(shot.id)?.referenceUrl) ? "视频可合成" : videoAssetByShotId?.has(shot.id) ? "视频生成中" : "待视频"}</em>
            </span>
            <span>{shot.shotSize} / {shot.cameraMovement}</span>
            <span>{shot.characters.join("、") || "空镜"}</span>
            <span>{shot.pictureDesc}</span>
            <span>{shot.dialogue || shot.voiceOver || "无"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ImagePreviewModal({
  preview,
  onClose
}: {
  preview: { url: string; title: string; prompt?: string };
  onClose: () => void;
}) {
  return (
    <div className="image-preview-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="image-preview-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="image-preview-head">
          <strong>{preview.title}</strong>
          <button className="ghost-button" onClick={onClose} type="button">关闭</button>
        </div>
        <img src={preview.url} alt={preview.title} />
        {preview.prompt ? <p>{preview.prompt}</p> : null}
      </div>
    </div>
  );
}

function StageFeedbackPanel({
  projectId,
  stage,
  report,
  onRefreshQuality,
  qualityBusy
}: {
  projectId: string;
  stage: EvaluationStage;
  report?: QualityReport;
  onRefreshQuality: () => void;
  qualityBusy: boolean;
}) {
  const [usability, setUsability] = useState<"usable" | "barely_usable" | "unusable">("usable");
  const [rating, setRating] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const tags = feedbackTags(stage);

  async function submit() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api.submitFeedback({
        projectId,
        stage,
        rating,
        usability,
        tags: selectedTags,
        content
      });
      setMessage("反馈已进入后台评测闭环；同项目同阶段首次有效反馈奖励 10 积分。");
      setContent("");
      setSelectedTags([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "反馈提交失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stage-feedback-panel">
      <div className="stage-feedback-reward">
        <strong>反馈给平台，首次有效 +10 积分</strong>
      </div>
      <div className="feedback-quick-row">
        <div className="feedback-segmented">
          {[
            ["usable", "可用"],
            ["barely_usable", "勉强可用"],
            ["unusable", "不可用"]
          ].map(([value, label]) => (
            <button className={usability === value ? "active" : ""} onClick={() => setUsability(value as typeof usability)} type="button" key={value}>{label}</button>
          ))}
        </div>
        <label className="feedback-rating">
          <span>评分</span>
          <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
            {[5, 4, 3, 2, 1].map((score) => <option key={score} value={score}>{score} 分</option>)}
          </select>
        </label>
      </div>
      <div className="feedback-tag-row">
        <span>选择问题标签</span>
        {tags.map((tag) => (
          <button
            className={selectedTags.includes(tag) ? "active" : ""}
            key={tag}
            onClick={() => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
            type="button"
          >
            {tag}
          </button>
        ))}
      </div>
      <div className="feedback-input-row">
        <input value={content} onChange={(event) => setContent(event.target.value)} placeholder="可选：补充哪里不满意，用来优化后续模型和工作流" />
        <button className="primary-button" onClick={() => void submit()} disabled={saving} type="button">{saving ? "提交中..." : "提交反馈"}</button>
      </div>
      {message ? <p className="success-text">{message}</p> : null}
      {error ? <p className="danger-text">{error}</p> : null}
    </div>
  );
}

function stageDecision(stage: EvaluationStage, report?: QualityReport) {
  if (!report) {
    return {
      eyebrow: `阶段检查 · ${stageText(stage)}`,
      status: "还没有生成本阶段检查",
      title: "先刷新检查，确认能否进入下一步",
      body: "系统会检查这一步是否缺少素材、提示词、角色一致性或真实生成结果，并把问题同步到后台评测记录。"
    };
  }
  if (report.pass) {
    const nextMap: Record<EvaluationStage, string> = {
      script: "可以继续进入角色定稿或分镜拆解。",
      character: "角色资产已具备基础一致性，可以继续生成或调整分镜。",
      storyboard: "分镜结构可用，可以进入分镜图生成。",
      image: "分镜图可作为视频首帧，下一步进入视频草稿。",
      video: "视频草稿可进入人工筛选、字幕配音和合成导出。"
    };
    return {
      eyebrow: `阶段检查 · ${stageText(stage)}`,
      status: "可继续生产",
      title: "当前阶段通过",
      body: nextMap[stage]
    };
  }
  return {
    eyebrow: `阶段检查 · ${stageText(stage)}`,
    status: "建议先修复",
    title: "先处理阻塞点，再进入下一步",
    body: report.problems[0] ?? report.suggestions[0] ?? "当前阶段存在影响后续生成质量的问题，建议按下方问题逐项修复。"
  };
}

function StageLine({ label, value, done }: { label: string; value: string; done: boolean }) {
  return <div className={done ? "stage-line done" : "stage-line"}><span>{label}</span><strong>{value}</strong></div>;
}

function stageText(stage: EvaluationStage) {
  const labels: Record<EvaluationStage, string> = {
    script: "剧本",
    character: "角色",
    storyboard: "分镜",
    image: "图片",
    video: "视频"
  };
  return labels[stage];
}

function feedbackTags(stage: EvaluationStage) {
  const common = ["流程不清楚", "生成太慢", "成本偏高"];
  const stageTags: Record<EvaluationStage, string[]> = {
    script: ["剧情不够爽", "角色不清楚", "集数不合理", "不可视化"],
    character: ["角色不像", "服装漂移", "多视图不一致", "参考图没跟住"],
    storyboard: ["镜头太复杂", "编号混乱", "提示词不完整", "承接不连贯"],
    image: ["没有真实图片", "角色漂移", "画幅错误", "图崩/水印"],
    video: ["首帧不稳", "动作不自然", "人物变形", "不可剪辑"]
  };
  return [...stageTags[stage], ...common];
}

function trackProjectEvent(projectId: string, eventName: string, properties: Record<string, unknown> = {}) {
  void api.trackEvent({
    eventName,
    projectId,
    entityType: "project",
    entityId: projectId,
    properties
  }).catch(() => undefined);
}

function groupRoleDerivatives(roleAssets: AssetItem[]) {
  const grouped = new Map<string, AssetItem[]>();
  roleAssets
    .filter((asset) => asset.type === "role_derivative" && asset.relatedCharacterId)
    .forEach((asset) => {
      const key = asset.relatedCharacterId!;
      grouped.set(key, [...(grouped.get(key) ?? []), asset]);
    });
  return grouped;
}

function buildCharacterViewSlots(primary: AssetItem | undefined, derivatives: AssetItem[]) {
  const turnaround = derivatives.find((asset) => isTurnaroundAsset(asset)) ?? (primary && isTurnaroundAsset(primary) ? primary : undefined);
  const anchor = primary && !isTurnaroundAsset(primary) ? primary : undefined;
  return [
    { kind: "turnaround" as const, label: "三视图总图", url: turnaround?.referenceUrl, prompt: turnaround?.prompt },
    { kind: "anchor" as const, label: "上传身份锚点", url: anchor?.referenceUrl, prompt: anchor?.prompt }
  ];
}

function findCharacterTurnaroundAsset(roleAssets: AssetItem[], characterId: string) {
  return roleAssets.find((asset) =>
    asset.relatedCharacterId === characterId &&
    asset.referenceUrl &&
    asset.status === "succeeded" &&
    isTurnaroundAsset(asset)
  );
}

function countCompletedCharacterSheets(characters: CharacterProfile[], roleAssets: AssetItem[]) {
  return characters.filter((character) => Boolean(findCharacterTurnaroundAsset(roleAssets, character.id))).length;
}

function isTurnaroundAsset(asset: AssetItem) {
  const text = `${asset.id} ${asset.name}`.toLowerCase();
  return asset.type === "role_derivative" && (text.includes("turnaround") || text.includes("三视图") || text.includes("多视图") || text.includes("总图"));
}

function extractSceneCount(content: string) {
  if (!content.trim()) return 0;
  const matches = content.match(/第[一二三四五六七八九十\d]+场|场景[一二三四五六七八九十\d]+|Scene\s*\d+/gi);
  return matches?.length ?? Math.min(12, Math.max(1, content.split(/\n\s*\n/).filter(Boolean).length));
}

function extractDialogueCount(content: string) {
  if (!content.trim()) return 0;
  const matches = content.match(/[：:][^\n]{2,}/g);
  return matches?.length ?? 0;
}

function resolveNextAction({
  hasScript,
  storyboards,
  roleAssets,
  completedRoleRefs,
  completedImages,
  completedVideos
}: {
  hasScript: boolean;
  storyboards: number;
  roleAssets: number;
  completedRoleRefs: number;
  completedImages: number;
  completedVideos: number;
}): NextAction {
  if (!hasScript) {
    return { id: "script", icon: "script", title: "等待剧本生成完成", description: "先回到任务中心确认剧本与角色卡任务状态。", disabled: true };
  }
  if (roleAssets > 0 && completedRoleRefs < roleAssets) {
    return { id: "character", icon: "character", title: "下一步：生成角色三视图总图", description: `${completedRoleRefs}/${roleAssets} 个角色三视图已完成，先把每个角色锁成一张正/侧/背总图。`, disabled: false };
  }
  if (storyboards === 0) {
    return { id: "storyboard", icon: "storyboard", title: "下一步：确认剧本并拆分镜", description: "先核对剧本预览，再拆成镜头级清单；专业镜头参数会收在高级区。", disabled: false };
  }
  if (completedImages < storyboards) {
    return { id: "image", icon: "image", title: "下一步：生成分镜图", description: `${completedImages}/${storyboards} 张分镜图已完成，按未生成镜头继续补齐。`, disabled: false };
  }
  if (completedVideos < storyboards) {
    return { id: "video", icon: "video", title: "下一步：生成视频片段", description: `${completedVideos}/${storyboards} 条视频片段已有记录，继续生成或刷新上游排队结果。`, disabled: false };
  }
  return { id: "done", icon: "video", title: "生产链路已闭环", description: "分镜、角色参考图、分镜图和视频草稿都已生成，可以导出分镜或进入后续合成。", disabled: true };
}

function buildStageEstimate(
  stage: NextAction["id"],
  context: {
    project: ProjectWorkflow["project"];
    providers: ModelProvider[];
    modelPrices: ModelPrice[];
    storyboards: StoryboardShot[];
    characters: CharacterProfile[];
    primaryRoleAssets: AssetItem[];
    completedRoleRefs: number;
    completedImages: number;
    imageAssetByShotId: Map<string, AssetItem>;
    videoAssetByShotId: Map<string, AssetItem>;
  }
): StageEstimate {
  const imageProvider = findProvider(context.providers, "image", context.project.imageProvider);
  const videoProvider = findProvider(context.providers, "video", context.project.videoProvider);
  const textProvider = findProvider(context.providers, "text", context.project.textProvider);
  const imageModel = context.project.imageModel || imageProvider?.models[0] || "mock-image-v1";
  const videoModel = context.project.videoModel || videoProvider?.models[0] || "wan2.7-i2v-2026-04-25";
  const textModel = context.project.textModel || textProvider?.models[0] || "qwen3.7-plus";
  const imageSize = normalizeImageOutputSize(context.project.imageSize);
  const imageQuality = normalizeImageOutputQuality(context.project.imageQuality);
  const imageUnit = estimateImageUnitCredits(context.modelPrices, imageProvider?.id, imageModel, imageSize, imageQuality);
  const textUnit = resolvePriceUnit(context.modelPrices, "text", textProvider?.id, textModel, 50);
  const videoUnit = resolvePriceUnit(context.modelPrices, "video", videoProvider?.id, videoModel, 0);
  const pendingImageShots = context.storyboards.filter((shot) => !context.imageAssetByShotId.has(shot.id)).length;
  const readyVideoShots = context.storyboards.filter((shot) => context.imageAssetByShotId.has(shot.id) && !isPlayableVideoUrl(context.videoAssetByShotId.get(shot.id)?.referenceUrl));
  const roleAssetCount = Math.max(context.primaryRoleAssets.length, context.characters.length);
  const pendingCharacterSheets = Math.max(0, roleAssetCount - context.completedRoleRefs);

  if (stage === "storyboard") {
    return {
      stage,
      title: "确认剧本并拆分镜",
      provider: textProvider?.name || "Local Generator",
      model: textModel,
      parameters: `${context.project.videoRatio} / ${context.project.artStyle}`,
      quantity: Math.max(1, context.project.episodes),
      estimatedCredits: textUnit * Math.max(1, context.project.episodes),
      estimatedSeconds: 45 + context.project.episodes * 18,
      refundPolicy: "失败不扣费，已冻结积分自动退回。",
      fallbackPolicy: "文本模型失败后，可在本项目模型路由切换文本模型，再从任务中心或本页重新生成分镜。",
      notes: ["将按已确认剧本和角色卡拆成镜头级分镜，只保留创作者需要确认的画面、角色和提示词。"]
    };
  }

  if (stage === "character") {
    const quantity = Math.max(1, pendingCharacterSheets || roleAssetCount || 1);
    return {
      stage,
      title: "生成角色三视图总图",
      provider: imageProvider?.name || "Mock Image Adapter",
      model: imageModel,
      parameters: `${imageSize} / ${imageQuality} / 一图三视图`,
      quantity,
      estimatedCredits: quantity * imageUnit,
      estimatedSeconds: quantity * 75,
      refundPolicy: "阶段失败不扣费；成功图片按张扣费。",
      fallbackPolicy: "若生图模型失败，可保留已上传主参考图，切换生图模型后继续生成同一张三视图总图。",
      notes: ["每个角色只消耗 1 次生图，画面内同时包含正面、侧面、背面，后续分镜只引用资产，不重新发明角色外貌。"]
    };
  }

  if (stage === "image") {
    const quantity = Math.max(1, pendingImageShots || context.storyboards.length || 1);
    return {
      stage,
      title: "生成分镜图首帧",
      provider: imageProvider?.name || "Mock Image Adapter",
      model: imageModel,
      parameters: `${imageSize} / ${imageQuality} / ${context.project.videoRatio}`,
      quantity,
      estimatedCredits: quantity * imageUnit,
      estimatedSeconds: quantity * 70,
      refundPolicy: "失败不扣费；成功分镜图按张扣费。",
      fallbackPolicy: "某个生图模型失败后，可切换模型继续生成未完成镜头；已生成图片和角色参考图会保留。",
      notes: [`当前待补齐 ${pendingImageShots}/${context.storyboards.length} 张分镜图，建议先少量测试风格后批量生成。`]
    };
  }

  if (stage === "video") {
    const seconds = readyVideoShots.reduce((sum, shot) => sum + Math.max(1, shot.duration || 4), 0) || Math.max(4, context.storyboards.length * 4);
    return {
      stage,
      title: "生成视频片段",
      provider: videoProvider?.name || "Mock Video Adapter",
      model: videoModel,
      parameters: `${context.project.videoRatio} / 图生视频 / 首帧继承`,
      quantity: readyVideoShots.length || context.storyboards.length,
      estimatedCredits: seconds * videoUnit,
      estimatedSeconds: Math.max(120, seconds * 20),
      refundPolicy: videoUnit > 0 ? "上游未返回可播放视频前保持任务状态；失败/取消退回未消耗积分。" : "当前视频模型未配置价格，预计 0 积分。",
      fallbackPolicy: "视频模型失败后，可切换视频模型，沿用已生成分镜图首帧和视频提示词继续生成。",
      notes: [`当前可提交 ${readyVideoShots.length} 个已有首帧镜头；没有首帧的镜头不会进入视频任务。`]
    };
  }

  return {
    stage,
    title: "暂无可执行生成阶段",
    provider: "-",
    model: "-",
    parameters: "-",
    quantity: 0,
    estimatedCredits: 0,
    estimatedSeconds: 0,
    refundPolicy: "无扣费。",
    fallbackPolicy: "当前生产链路已完成或仍需等待上一阶段。",
    notes: ["暂无需要提交的生成任务。"]
  };
}

function findProvider(providers: ModelProvider[], modality: ModelProvider["modality"], providerId?: string) {
  return providers.find((provider) => provider.modality === modality && provider.id === providerId)
    ?? providers.find((provider) => provider.modality === modality && provider.enabled);
}

function resolvePriceUnit(prices: ModelPrice[], modality: ModelPrice["modality"], providerId: string | undefined, model: string | undefined, fallback: number) {
  const enabled = prices.filter((price) => price.enabled && price.modality === modality);
  const exact = enabled.find((price) => price.providerId === providerId && price.model === model);
  const byModel = enabled.find((price) => price.model === model);
  const byProvider = enabled.find((price) => price.providerId === providerId);
  return Math.max(0, Math.floor(exact?.unitCredits ?? byModel?.unitCredits ?? byProvider?.unitCredits ?? fallback));
}

function estimateImageUnitCredits(prices: ModelPrice[], providerId: string | undefined, model: string, size: string, quality: string) {
  const base = resolvePriceUnit(prices, "image", providerId, model, 8);
  return Math.ceil(base * imageParameterMultiplier(size, quality));
}

function formatDuration(seconds: number) {
  if (!seconds) return "0 秒";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
}

function runNextAction(
  id: NextAction["id"],
  actions: {
    generateStoryboards: () => void;
    generateCharacterImages: () => void;
    generateImages: () => void;
    generateVideos: () => void;
  }
) {
  if (id === "storyboard") actions.generateStoryboards();
  if (id === "character") actions.generateCharacterImages();
  if (id === "image") actions.generateImages();
  if (id === "video") actions.generateVideos();
}

function emptyShotDraft(): ShotDraft {
  return {
    duration: "",
    shotSize: "",
    cameraAngle: "",
    cameraMovement: "",
    characters: "",
    scene: "",
    pictureDesc: "",
    action: "",
    orientation: "",
    spatialRelation: "",
    emotion: "",
    dialogue: "",
    voiceOver: "",
    environmentSound: "",
    soundEffect: "",
    imagePrompt: "",
    videoPrompt: ""
  };
}

function shotToDraft(shot: StoryboardShot): ShotDraft {
  return {
    duration: String(shot.duration),
    shotSize: shot.shotSize,
    cameraAngle: shot.cameraAngle,
    cameraMovement: shot.cameraMovement,
    characters: shot.characters.join("、"),
    scene: shot.scene,
    pictureDesc: shot.pictureDesc,
    action: shot.action ?? "",
    orientation: shot.orientation ?? "",
    spatialRelation: shot.spatialRelation ?? "",
    emotion: shot.emotion ?? "",
    dialogue: shot.dialogue,
    voiceOver: shot.voiceOver,
    environmentSound: shot.environmentSound,
    soundEffect: shot.soundEffect,
    imagePrompt: shot.imagePrompt,
    videoPrompt: shot.videoPrompt
  };
}

function splitNames(value: string) {
  return value
    .split(/[、,，/|;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isPlayableVideoUrl(url?: string) {
  if (!url) return false;
  return url.startsWith("/storage/") || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:video");
}

function videoTimelineStatus(videoAsset: AssetItem | undefined, hasImage: boolean) {
  if (isPlayableVideoUrl(videoAsset?.referenceUrl)) {
    return { status: "succeeded", label: "可播放", hint: "视频片段已返回" };
  }
  if (videoAsset?.status === "failed") {
    return { status: "failed", label: "失败", hint: "可切换模型后重试" };
  }
  if (videoAsset) {
    return { status: "running", label: "上游生成中", hint: "任务已提交，等待返回视频" };
  }
  if (hasImage) {
    return { status: "pending", label: "可生成", hint: "已有首帧，可提交视频模型" };
  }
  return { status: "pending", label: "缺首帧", hint: "先生成本镜头图片" };
}

function formatShotNo(shot: StoryboardShot, index = 0) {
  const shotNo = String(shot.shotNo || index + 1).padStart(2, "0");
  return `第${shot.sceneNo || 1}场 · 镜头${shotNo}`;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
