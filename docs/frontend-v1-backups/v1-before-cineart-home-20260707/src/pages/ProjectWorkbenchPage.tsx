import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Film,
  FileText,
  Images,
  ListChecks,
  Loader2,
  MapPin,
  MessageSquareText,
  Pause,
  Play,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type {
  AssetItem,
  CharacterProfile,
  ExportJob,
  ModelPrice,
  ModelProvider,
  Project,
  ProjectWorkflow,
  QualityReport,
  ScriptDraft,
  StoryboardProductionPackage,
  StoryboardShot,
  TaskStatus,
  UserFeedback
} from "@aifilm/shared";
import {
  estimateImageCredits,
  imageOutputQualityOptions,
  imageOutputSizeOptions,
  imageParameterMultiplier,
  normalizeImageOutputQuality,
  normalizeImageOutputSize
} from "@aifilm/shared";
import { MetricCard } from "../components/MetricCard";
import { api } from "../lib/api";

interface ProjectWorkbenchPageProps {
  workflow?: ProjectWorkflow;
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  onBack: () => void;
  onRefresh: (projectId: string) => void | Promise<void>;
}

type WorkbenchTab = "script" | "characters" | "storyboard" | "images" | "video";
type OperationKey = "storyboard" | "character" | "images" | "video" | "export" | null;
type OperationState = { key: OperationKey; title: string; startedAt: number; detail: string } | null;

const statusText: Record<TaskStatus, string> = {
  pending: "待生成",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
  refunded: "已退款"
};

const failedImageModels = new Set(["wanx-v1", "wan2.5-t2i-preview"]);

export function ProjectWorkbenchPage({ workflow, providers, modelPrices, onBack, onRefresh }: ProjectWorkbenchPageProps) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("script");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [operation, setOperation] = useState<OperationState>(null);
  const [operationElapsed, setOperationElapsed] = useState(0);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [productionPackage, setProductionPackage] = useState<StoryboardProductionPackage | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

  useEffect(() => {
    if (!operation) return;
    const timer = window.setInterval(() => setOperationElapsed(Math.round((Date.now() - operation.startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [operation]);

  useEffect(() => {
    if (!workflow?.project.id) return;
    void api.exportJobs(workflow.project.id).then(setExportJobs).catch(() => setExportJobs([]));
    void api.storyboardProductionPackage(workflow.project.id).then(setProductionPackage).catch(() => setProductionPackage(null));
  }, [workflow?.project.id, workflow?.assets.length, workflow?.storyboards.length]);

  if (!workflow) {
    return <div className="page-stack"><section className="panel centered-panel">正在加载项目生产数据...</section></div>;
  }

  const { project, script, characters, storyboards, tasks } = workflow;
  const assets = workflow.assets ?? [];
  const roleAssets = assets.filter((asset) => asset.type === "role" || asset.type === "role_derivative" || asset.type === "role_reference");
  const sceneAssets = assets.filter((asset) => asset.type === "scene" || asset.type === "prop");
  const qualityReports = workflow.qualityReports ?? [];
  const feedbacks = workflow.feedbacks ?? [];
  const primaryRoleAssets = assets.filter((asset) => asset.type === "role" && asset.referenceUrl);
  const imageAssets = assets.filter((asset) => asset.type === "image");
  const videoAssets = assets.filter((asset) => asset.type === "video");
  const latestTask = [...tasks].sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)))[0];
  const completedImages = imageAssets.filter((asset) => asset.referenceUrl && asset.status === "succeeded").length;
  const completedVideos = videoAssets.filter((asset) => isPlayableVideoUrl(asset.referenceUrl)).length;
  const completedRoleRefs = countCompletedCharacterSheets(characters, roleAssets);
  const totalDuration = storyboards.reduce((sum, shot) => sum + (shot.duration || 0), 0);
  const pipelineSteps = [
    { label: "剧本确认", done: Boolean(script) },
    { label: "角色定稿", done: characters.length === 0 || completedRoleRefs >= characters.length },
    { label: "分镜拆解", done: storyboards.length > 0 },
    { label: "分镜图评估", done: storyboards.length > 0 && completedImages >= storyboards.length },
    { label: "视频合成导出", done: storyboards.length > 0 && completedVideos > 0 }
  ];
  const nextAction = resolveNextAction({
    script,
    characters,
    storyboards,
    completedRoleRefs,
    completedImages,
    completedVideos
  });
  const stageEstimate = estimateStage(project, modelPrices, nextAction.id, {
    characters: characters.length,
    storyboards: storyboards.length,
    pendingImages: Math.max(0, storyboards.length - completedImages),
    pendingVideos: Math.max(0, storyboards.length - completedVideos)
  });

  function beginOperation(key: OperationKey, title: string, detail: string) {
    setOperation({ key, title, detail, startedAt: Date.now() });
    setOperationElapsed(0);
    setMessage("");
    setError("");
  }

  async function runWorkflowAction(actionId: NextAction["id"] = nextAction.id) {
    if (actionId === "script" || actionId === "done") return;
    if (`${actionId}` === "image") {
      setActiveTab("images");
      setMessage("已进入分镜图工作台。建议先生成单张测试图或多选 3-5 个关键镜头，再决定是否全部补齐。");
      setError("");
      return;
    }
    setIsBusy(true);
    try {
      if (actionId === "character") {
        beginOperation("character", "角色三视图生成中", "正在根据角色卡和已上传参考图生成角色身份锚点。");
        const result = await api.generateCharacterImages(project.id);
        setMessage(`角色定稿任务已提交，新增 ${result.assetsCreated ?? 0} 个资产。`);
        setActiveTab("characters");
      }
      if (actionId === "storyboard") {
        beginOperation("storyboard", "分镜拆解中", "正在把剧本拆成镜头级清单。");
        const result = await api.generateStoryboards(project.id, { artStyle: project.artStyle, videoRatio: project.videoRatio });
        setMessage(`分镜拆解已提交，新增 ${result.assetsCreated ?? 0} 条记录。`);
        setActiveTab("storyboard");
      }
      if (actionId === "image") {
        beginOperation("images", "分镜图生成中", "正在按未出图镜头补齐首帧图。");
        const result = await api.generateImages(project.id);
        setMessage(`分镜图任务已提交，新增 ${result.assetsCreated ?? 0} 个资产。`);
        setActiveTab("images");
      }
      if (actionId === "video") {
        beginOperation("video", "视频片段生成中", "正在把已确认分镜图提交给视频模型。");
        const result = await api.generateVideos(project.id);
        setMessage(`视频任务已提交，新增 ${result.assetsCreated ?? 0} 个资产。`);
        setActiveTab("video");
      }
      await onRefresh(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成任务提交失败");
    } finally {
      setIsBusy(false);
      setOperation(null);
    }
  }

  async function saveModelRoutes(routes: Partial<Pick<Project, "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">>) {
    setIsBusy(true);
    setError("");
    try {
      await api.updateProjectModelRoutes(project.id, routes);
      setMessage("本项目模型路由已更新。");
      await refreshProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : "模型路由保存失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshProject() {
    await onRefresh(project.id);
    void api.exportJobs(project.id).then(setExportJobs).catch(() => setExportJobs([]));
    void api.storyboardProductionPackage(project.id).then(setProductionPackage).catch(() => setProductionPackage(null));
  }

  async function createExport(type: "tts" | "subtitle" | "video_export") {
    setIsBusy(true);
    beginOperation("export", type === "video_export" ? "MP4 合成中" : type === "tts" ? "配音生成中" : "字幕生成中", "正在整理镜头、台词、时长和素材。");
    try {
      const job = await api.createExportJob(project.id, { type });
      setExportJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setMessage(job.outputUrl ? "导出资产已生成。" : `导出任务状态：${job.status}`);
      await refreshProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出任务失败");
    } finally {
      setIsBusy(false);
      setOperation(null);
    }
  }

  return (
    <div className="page-stack project-workbench">
      <div className="page-title row-title workbench-hero-title">
        <div>
          <span className="section-kicker">PROJECT PRODUCTION</span>
          <h1>{project.name}</h1>
          <p>{project.intro}</p>
        </div>
        <div className="workbench-command-side">
          <div className="inline-actions workbench-hero-actions">
            <button className="ghost-button" onClick={onBack}>返回作品列表</button>
            <button className="ghost-button" onClick={() => void refreshProject()}><RefreshCw size={18} />刷新</button>
          </div>
          <details className="project-route-drawer workbench-route-popover">
            <summary>
              <span><SlidersHorizontal size={16} />模型路由</span>
              <small>{project.imageModel || project.textModel || "按项目默认"}</small>
            </summary>
            <ProjectRouteSwitcher project={project} providers={providers} onSave={saveModelRoutes} />
          </details>
        </div>
      </div>

      <div className="workflow-rail workflow-rail-polished">
        {pipelineSteps.map((step, index) => <div className={`stage-pill ${step.done ? "done" : ""}`} key={step.label}><span>{index + 1}</span>{step.label}</div>)}
      </div>

      <div className="metric-grid four">
        <MetricCard label="剧集" value={project.episodes} />
        <MetricCard label="角色" value={characters.length} tone="purple" />
        <MetricCard label="镜头" value={storyboards.length} tone="success" />
        <MetricCard label="已用积分" value={project.creditsSpent} tone="danger" />
      </div>

      <section className="panel production-console production-console-polished">
        <div className="production-console-heading">
          <div><strong>生成控制台</strong><span>失败时展开右上角模型路由切换供应商后重试</span></div>
          <div className="console-meta"><span>{project.videoRatio}</span><span>{project.artStyle}</span><span>{totalDuration}s</span></div>
        </div>
        <div className="production-grid">
          <button className="production-action next-step-action" onClick={() => void runWorkflowAction()} disabled={isBusy || nextAction.disabled}>
            {nextAction.icon === "storyboard" ? <WandSparkles size={22} /> : nextAction.icon === "character" ? <UserRound size={22} /> : nextAction.icon === "image" ? <Images size={22} /> : nextAction.icon === "video" ? <Play size={22} /> : <BookOpenCheck size={22} />}
            <strong>{nextAction.title}</strong>
            <span>{nextAction.description}</span>
          </button>
          <GenerationCostPreview estimate={stageEstimate} disabled={isBusy || nextAction.disabled} onConfirm={() => void runWorkflowAction()} />
          <div className="production-action secondary production-stage-list">
            <StageLine label="剧本确认" value={script ? "已确认" : "待生成"} done={Boolean(script)} />
            <StageLine label="角色定稿" value={`${completedRoleRefs}/${characters.length}`} done={characters.length === 0 || completedRoleRefs >= characters.length} />
            <StageLine label="分镜拆解" value={`${storyboards.length}`} done={storyboards.length > 0} />
            <StageLine label="分镜图" value={`${completedImages}/${storyboards.length}`} done={storyboards.length > 0 && completedImages >= storyboards.length} />
            <StageLine label="视频合成" value={`${completedVideos}/${storyboards.length}`} done={storyboards.length > 0 && completedVideos > 0} />
          </div>
          <div className="task-monitor">
            <div><strong>{latestTask ? latestTask.title : "暂无最近任务"}</strong><span>{latestTask ? `${latestTask.provider} / ${latestTask.model}` : "开始生成后会显示模型、进度和积分"}</span></div>
            {latestTask ? <><div className="task-progress-track"><span style={{ width: `${latestTask.progress}%` }} /></div><small className={`status ${latestTask.status}`}>{statusText[latestTask.status]} · {latestTask.progress}% · {latestTask.finalCredits ?? latestTask.estimatedCredits} 积分</small></> : null}
          </div>
        </div>
        {operation ? <InlineProgress operation={operation} elapsed={operationElapsed} /> : null}
        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="danger-text">{error}</p> : null}
      </section>

      <div className="tabs workbench-tabs" data-tour-id="project-flow-tabs">
        <button className={activeTab === "script" ? "active" : ""} onClick={() => setActiveTab("script")}><BookOpenCheck size={18} />剧本解析</button>
        <button className={activeTab === "characters" ? "active" : ""} onClick={() => setActiveTab("characters")}><UserRound size={18} />角色场景</button>
        <button className={activeTab === "storyboard" ? "active" : ""} onClick={() => setActiveTab("storyboard")}><WandSparkles size={18} />设计总台</button>
        <button className={activeTab === "images" ? "active" : ""} onClick={() => setActiveTab("images")}><Images size={18} />单镜头导演台</button>
        <button className={activeTab === "video" ? "active export-tab" : "export-tab"} onClick={() => setActiveTab("video")}><Film size={18} />视频闭环</button>
      </div>

      {activeTab === "script" ? <ScriptBoard script={script} characters={characters} storyboards={storyboards} isBusy={isBusy} onOpenCharacters={() => setActiveTab("characters")} onGenerateStoryboards={() => void runWorkflowAction("storyboard")} /> : null}
      {activeTab === "characters" ? <CreatorCharacterBoard projectId={project.id} characters={characters} roleAssets={roleAssets} sceneAssets={sceneAssets} qualityReports={qualityReports} feedbacks={feedbacks} isBusy={isBusy} onRefresh={refreshProject} onGenerate={() => void runWorkflowAction("character")} onPreview={setPreviewImage} /> : null}
      {activeTab === "storyboard" ? <DesignDeskBoard storyboards={storyboards} characters={characters} roleAssets={roleAssets} sceneAssets={sceneAssets} imageAssets={imageAssets} videoAssets={videoAssets} productionPackage={productionPackage} isBusy={isBusy} onGenerate={() => void runWorkflowAction("storyboard")} onOpenDirector={() => setActiveTab("images")} onOpenVideo={() => setActiveTab("video")} onPreview={setPreviewImage} /> : null}
      {activeTab === "images" ? <CreatorImagesBoard projectId={project.id} storyboards={storyboards} characters={characters} roleAssets={roleAssets} sceneAssets={sceneAssets} imageAssets={imageAssets} qualityReports={qualityReports} feedbacks={feedbacks} isBusy={isBusy} onRefresh={refreshProject} onPreview={setPreviewImage} /> : null}
      {activeTab === "video" ? <VideoBoard projectId={project.id} storyboards={storyboards} characters={characters} roleAssets={roleAssets} imageAssets={imageAssets} videoAssets={videoAssets} exportJobs={exportJobs} isBusy={isBusy} onGenerate={() => void runWorkflowAction("video")} onCreateExport={createExport} onRefresh={refreshProject} /> : null}
      {previewImage ? <ImagePreviewModal preview={previewImage} onClose={() => setPreviewImage(null)} /> : null}
    </div>
  );
}

function ScriptBoard({ script, characters, storyboards, isBusy, onOpenCharacters, onGenerateStoryboards }: { script?: ScriptDraft; characters: CharacterProfile[]; storyboards: StoryboardShot[]; isBusy: boolean; onOpenCharacters: () => void; onGenerateStoryboards: () => void }) {
  const [sceneFilter, setSceneFilter] = useState<"all" | "risk" | "ready" | "draft">("all");
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const sceneRows = useMemo(() => buildScriptSceneRows(script, storyboards), [script, storyboards]);
  const structureBeats = useMemo(() => buildSixPartStoryBeats(script, sceneRows), [script, sceneRows]);
  const sceneNames = uniqueSceneNames(storyboards);
  const selectedScene = sceneRows.find((scene) => scene.id === selectedSceneId) ?? sceneRows[0];
  const filteredScenes = sceneRows.filter((scene) => {
    if (sceneFilter === "risk") return Boolean(scene.risk);
    if (sceneFilter === "ready") return scene.status === "ready" || scene.status === "locked";
    if (sceneFilter === "draft") return scene.status === "draft" || scene.status === "blocked";
    return true;
  });
  const longDialogueCount = sceneRows.filter((scene) => scene.risk?.includes("台词")).length;
  const readySceneCount = sceneRows.filter((scene) => scene.status === "ready" || scene.status === "locked").length;
  const totalDuration = sceneRows.reduce((sum, scene) => sum + scene.duration, 0);
  const preflightItems = [
    { label: "剧本可读", done: Boolean(script), detail: script ? "正文与梗概已生成" : "等待剧本生成" },
    { label: "场次清晰", done: sceneRows.length > 0, detail: sceneRows.length ? `${sceneRows.length} 个场次候选` : "尚未拆出场次" },
    { label: "角色已抽取", done: characters.length > 0, detail: `${characters.length} 个角色候选` },
    { label: "台词可拆镜", done: longDialogueCount === 0, detail: longDialogueCount ? `${longDialogueCount} 场疑似长台词` : "无明显长台词风险" }
  ];

  function requestStoryboardGeneration() {
    if (storyboards.length > 0 && !window.confirm("重建分镜表会覆盖现有分镜、分镜图和视频草稿，确认继续？")) return;
    onGenerateStoryboards();
  }

  return (
    <section className="panel script-review-board preworkbench-board script-scene-workbench">
      <div className="panel-head script-scene-head">
        <div>
          <h2>剧本分场工作台</h2>
          <small>先把剧本拆成可生产的场次、角色、节拍和风险清单，再进入角色场景资产锁定与分镜表编辑。</small>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={onOpenCharacters} disabled={!script}><UserRound size={16} />角色场景</button>
          <button className="primary-button" onClick={requestStoryboardGeneration} disabled={!script || isBusy}>
            <BookOpenCheck size={18} />{storyboards.length > 0 ? "重建分镜表" : "生成分镜表"}
          </button>
        </div>
      </div>

      <div className="script-scene-status-strip">
        <article className={script ? "ready" : ""}><strong>{script ? "已就绪" : "待生成"}</strong><span>剧本正文</span></article>
        <article className={sceneRows.length ? "ready" : ""}><strong>{sceneRows.length || "-"}</strong><span>场次候选</span></article>
        <article className={characters.length ? "ready" : ""}><strong>{characters.length}</strong><span>角色候选</span></article>
        <article className={readySceneCount ? "ready" : ""}><strong>{readySceneCount}/{Math.max(sceneRows.length, 1)}</strong><span>可拆镜场次</span></article>
        <article className={storyboards.length ? "ready" : ""}><strong>{storyboards.length}</strong><span>镜头草案</span></article>
      </div>

      <div className="script-story-structure-strip">
        {structureBeats.map((beat, index) => (
          <article className={beat.ready ? "ready" : ""} key={beat.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{beat.title}</strong>
            <p>{beat.summary}</p>
            <small>{beat.source}</small>
          </article>
        ))}
      </div>

      <div className="script-scene-layout">
        <aside className="script-scene-nav">
          <div className="script-scene-section-head">
            <div>
              <h3>剧集与场次</h3>
              <small>{sceneRows.length ? `预计 ${Math.max(totalDuration, 1)} 秒 · ${storyboards.length || "待生成"} 镜头` : "等待剧本生成后拆场"}</small>
            </div>
            <ListChecks size={17} />
          </div>
          <div className="script-scene-filter-row">
            {[
              ["all", "全部", sceneRows.length],
              ["draft", "未确认", sceneRows.filter((scene) => scene.status === "draft" || scene.status === "blocked").length],
              ["risk", "有风险", sceneRows.filter((scene) => scene.risk).length],
              ["ready", "可拆镜", readySceneCount]
            ].map(([key, label, count]) => (
              <button className={sceneFilter === key ? "active" : ""} key={key} onClick={() => setSceneFilter(key as typeof sceneFilter)} type="button">{label}<span>{count}</span></button>
            ))}
          </div>
          <div className="script-scene-list">
            {filteredScenes.map((scene) => (
              <button className={selectedScene?.id === scene.id ? "active" : ""} key={scene.id} onClick={() => setSelectedSceneId(scene.id)} type="button">
                <span className={`script-scene-state ${scene.status}`}>{sceneStatusText(scene.status)}</span>
                <strong>{scene.sceneNo}. {scene.title}</strong>
                <small><MapPin size={12} />{scene.location}<em>{scene.timeOfDay}</em></small>
                <small><Clock3 size={12} />{scene.duration || "-"}s · {scene.shots || "待拆"} 镜头</small>
                {scene.risk ? <b><AlertTriangle size={12} />{scene.risk}</b> : null}
              </button>
            ))}
            {!filteredScenes.length ? <div className="empty-state">当前筛选下没有场次。</div> : null}
          </div>
        </aside>

        <main className="script-scene-editor">
          <div className="script-editor-tabs">
            <button className="active" type="button"><FileText size={15} />剧本编辑</button>
            <button type="button">大纲视图</button>
            <button type="button">卡片视图</button>
            <span>已自动保存 · 生产草稿</span>
          </div>
          <section className="script-synopsis-panel">
            <div>
              <span>剧情梗概</span>
              <p>{script?.synopsis || "暂无梗概，请先等待剧本生成任务完成。"}</p>
            </div>
            <dl>
              <div><dt>集数</dt><dd>第 1 集</dd></div>
              <div><dt>场次</dt><dd>{sceneRows.length || "-"}</dd></div>
              <div><dt>预计时长</dt><dd>{totalDuration || "-"}s</dd></div>
            </dl>
          </section>
          {selectedScene ? (
            <section className="script-scene-detail">
              <div className="script-scene-detail-title">
                <div>
                  <span>场 {selectedScene.sceneNo}</span>
                  <h3>{selectedScene.title}</h3>
                  <small>{selectedScene.location} · {selectedScene.timeOfDay} · {selectedScene.duration || "-"} 秒</small>
                </div>
                <span className={`script-scene-state ${selectedScene.status}`}>{sceneStatusText(selectedScene.status)}</span>
              </div>
              <div className="script-scene-field-grid">
                <ScriptSceneField label="场景描述" value={selectedScene.lines[0] || "等待场景描述。"} />
                <ScriptSceneField label="人物出场" value={selectedScene.characters.length ? selectedScene.characters.join(" / ") : "待从剧本或分镜中抽取角色。"} />
                <ScriptSceneField label="动作/调度" value={selectedScene.action || "待补充关键动作、走位和镜头承接。"} />
                <ScriptSceneField label="情绪/钩子" value={selectedScene.hook || "待补充本场情绪转折与结尾钩子。"} />
              </div>
              <div className="script-dialogue-panel">
                <div><MessageSquareText size={16} /><strong>台词 / 旁白</strong><span>{selectedScene.dialogue.length || 0} 条</span></div>
                {selectedScene.dialogue.length ? selectedScene.dialogue.map((line, index) => <p key={`${line}-${index}`}>{line}</p>) : <p>本场暂无明确台词，后续分镜会以动作和旁白承接。</p>}
              </div>
              <div className="script-breakdown-elements">
                <strong>生产元素标注</strong>
                <div>
                  <span>角色 {selectedScene.characters.length}</span>
                  <span>地点 {selectedScene.location}</span>
                  <span>镜头 {selectedScene.shots || "待拆"}</span>
                  <span>{selectedScene.risk ? "需复核" : "可继续"}</span>
                </div>
              </div>
            </section>
          ) : (
            <div className="empty-state">暂无剧本内容，请先完成剧本生成。</div>
          )}
        </main>

        <aside className="script-preflight-panel">
          <section className="script-quality-gates">
            <div className="script-scene-section-head">
              <div>
                <h3>预检与生成</h3>
                <small>{preflightItems.every((item) => item.done) ? "已满足分镜前置条件" : "还有项目需要确认"}</small>
              </div>
              <CheckCircle2 size={17} />
            </div>
            {preflightItems.map((item) => (
              <div className={item.done ? "ready" : ""} key={item.label}>
                <CheckCircle2 size={15} />
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
            ))}
          </section>
          <section>
            <h3>角色候选</h3>
            <div className="script-candidate-list">
              {characters.slice(0, 5).map((character) => (
                <article key={character.id}>
                  <strong>{character.name}</strong>
                  <span>{character.identity}</span>
                  <small>{character.consistencyLevel === "high" ? "高一致性" : character.consistencyLevel === "medium" ? "中一致性" : "待定稿"}</small>
                </article>
              ))}
              {!characters.length ? <em>等待剧本生成角色卡</em> : null}
            </div>
          </section>
          <section>
            <h3>场景候选</h3>
            <div className="script-scene-chip-list">
              {(sceneNames.length ? sceneNames : sceneRows.map((scene) => scene.location)).slice(0, 8).map((scene) => <span key={scene}>{scene}</span>)}
              {!sceneRows.length ? <em>等待分场生成</em> : null}
            </div>
          </section>
          <section className="script-risk-panel">
            <h3><AlertTriangle size={15} />风险与提示</h3>
            {sceneRows.filter((scene) => scene.risk).slice(0, 3).map((scene) => <p key={scene.id}>{scene.title}：{scene.risk}</p>)}
            {!sceneRows.some((scene) => scene.risk) ? <p>暂无明显台词、场次或角色连续性风险。</p> : null}
          </section>
          <button className="primary-button full-button" onClick={requestStoryboardGeneration} disabled={!script || isBusy} type="button">
            <WandSparkles size={18} />{storyboards.length > 0 ? "重建分镜表" : "生成分镜表"}
          </button>
        </aside>
      </div>

      <div className="script-production-runway">
        {["剧本可读", "角色已抽取", "场次就绪", "分镜表生成", "进入导演台"].map((item, index) => {
          const done = index === 0 ? Boolean(script)
            : index === 1 ? characters.length > 0
            : index === 2 ? sceneRows.length > 0
            : index === 3 ? storyboards.length > 0
            : storyboards.length > 0;
          return (
            <div className={done ? "ready" : ""} key={item}>
              <span>{index + 1}</span>
              <strong>{item}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ScriptSceneField({ label, value }: { label: string; value: string }) {
  return (
    <div className="script-scene-field">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function buildSixPartStoryBeats(script: ScriptDraft | undefined, sceneRows: ScriptSceneRow[]) {
  const labels = [
    { title: "开局钩子", source: "吸引用户停留" },
    { title: "主角困境", source: "建立目标和阻力" },
    { title: "转折升级", source: "推动冲突升级" },
    { title: "中段爆点", source: "制造核心爽点" },
    { title: "高潮反杀", source: "承接最强动作" },
    { title: "结局收束", source: "保留续集钩子" }
  ];
  const synopsisParts = splitReadableParts(script?.synopsis || script?.content || "");
  return labels.map((item, index) => {
    const scene = sceneRows.length ? sceneRows[Math.min(sceneRows.length - 1, Math.floor((index / labels.length) * sceneRows.length))] : undefined;
    const summary = scene
      ? `${scene.title}: ${scene.hook || scene.action || scene.lines[0] || "待补充关键戏剧动作"}`
      : synopsisParts[index] || "待剧本生成后自动抽取对应段落。";
    return {
      ...item,
      summary: compactPreviewText(summary, 58),
      ready: Boolean(scene || synopsisParts[index])
    };
  });
}

function splitReadableParts(value: string) {
  return value
    .replace(/\r/g, "\n")
    .split(/[\n。！？!?；;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function compactPreviewText(value: string, maxLength = 64) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function CharacterBoard({ projectId, characters, roleAssets, isBusy, onGenerate, onRefresh, onPreview }: { projectId: string; characters: CharacterProfile[]; roleAssets: AssetItem[]; isBusy: boolean; onGenerate: () => void; onRefresh: () => void | Promise<void>; onPreview: (preview: { url: string; title: string }) => void }) {
  const [referenceInputs, setReferenceInputs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const roleAssetByCharacterId = useMemo(
    () => new Map(characters.map((character) => [character.id, resolveCharacterDisplayAsset(character, roleAssets)])),
    [characters, roleAssets]
  );
  const lockedCount = countCompletedCharacterSheets(characters, roleAssets);

  async function saveReference(character: CharacterProfile, referenceUrl: string) {
    if (!referenceUrl.trim()) return;
    setSavingId(character.id);
    try {
      await api.setCharacterReferenceImage(projectId, character.id, { referenceUrl: referenceUrl.trim(), description: `${character.name} 用户提供的角色参考图` });
      setReferenceInputs((current) => ({ ...current, [character.id]: "" }));
      await onRefresh();
    } finally {
      setSavingId(null);
    }
  }

  async function uploadReference(character: CharacterProfile, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const referenceUrl = await fileToDataUrl(file);
    await saveReference(character, referenceUrl);
  }

  async function deleteReference(character: CharacterProfile) {
    if (!window.confirm(`确认删除「${character.name}」的上传参考图？`)) return;
    setSavingId(character.id);
    try {
      await api.deleteCharacterReferenceImage(projectId, character.id);
      await onRefresh();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="panel character-lock-board character-turnaround-board">
      <div className="panel-head">
        <div><h2>角色定稿工作台</h2><small>每个角色先锁定一张浅色占位或三视图参考，再进入分镜图生产。</small></div>
        <button className="primary-button" onClick={onGenerate} disabled={isBusy || characters.length === 0}><UserRound size={18} />补齐未定稿角色</button>
      </div>
      <div className="character-lock-summary compact"><strong>{lockedCount}/{characters.length}</strong><span>已定稿</span></div>
      <div className="character-card-grid">
        {characters.map((character) => {
          const asset = roleAssetByCharacterId.get(character.id);
          const locked = Boolean(asset?.referenceUrl && asset.status === "succeeded");
          return (
            <article className={locked ? "character-lock-card locked" : "character-lock-card"} key={character.id}>
              <button className={asset?.referenceUrl ? "character-light-placeholder ready" : "character-light-placeholder"} type="button" onClick={() => asset?.referenceUrl && onPreview({ url: asset.referenceUrl, title: character.name })}>
                {asset?.referenceUrl ? <img src={asset.referenceUrl} alt={character.name} /> : <><UserRound size={32} /><span>待生成</span></>}
              </button>
              <div className="character-lock-copy">
                <span className={locked ? "status succeeded" : "status pending"}>{locked ? "已定稿" : "待生成"}</span>
                <h3>{character.name}</h3>
                <p>{character.identity}</p>
                <small>{character.appearance}</small>
              </div>
              <div className="reference-url-row compact">
                <input value={referenceInputs[character.id] ?? ""} onChange={(event) => setReferenceInputs((current) => ({ ...current, [character.id]: event.target.value }))} placeholder="粘贴角色图片 URL / data-url" />
                <button className="ghost-button" type="button" onClick={() => void saveReference(character, referenceInputs[character.id] ?? "")} disabled={savingId === character.id || !referenceInputs[character.id]?.trim()}>{savingId === character.id ? "保存中" : "设为参考"}</button>
              </div>
              <div className="inline-actions">
                <label className="ghost-button avatar-upload-button"><Upload size={16} />上传<input type="file" accept="image/*" onChange={(event) => void uploadReference(character, event)} disabled={savingId === character.id} /></label>
                <button className="ghost-button danger-ghost" onClick={() => void deleteReference(character)} disabled={savingId === character.id || !asset?.referenceUrl}><Trash2 size={16} />删除</button>
              </div>
            </article>
          );
        })}
        {!characters.length ? <div className="empty-state">暂无角色卡，请先生成剧本。</div> : null}
      </div>
    </section>
  );
}

function CreatorCharacterBoard({
  projectId,
  characters,
  roleAssets,
  sceneAssets,
  qualityReports,
  feedbacks,
  isBusy,
  onGenerate,
  onRefresh,
  onPreview
}: {
  projectId: string;
  characters: CharacterProfile[];
  roleAssets: AssetItem[];
  sceneAssets: AssetItem[];
  qualityReports: QualityReport[];
  feedbacks: UserFeedback[];
  isBusy: boolean;
  onGenerate: () => void;
  onRefresh: () => void | Promise<void>;
  onPreview: (preview: { url: string; title: string }) => void;
}) {
  const [referenceInputs, setReferenceInputs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [localMessage, setLocalMessage] = useState("");
  const latestReport = latestStageReport(qualityReports, "character");
  const characterFeedback = feedbacks.filter((item) => item.stage === "character");
  const lockedRoleCount = countCompletedCharacterSheets(characters, roleAssets);
  const lockedSceneCount = sceneAssets.filter((asset) => asset.referenceUrl || asset.status === "succeeded").length;
  const [canvasCharacterId, setCanvasCharacterId] = useState(characters[0]?.id ?? "");
  const canvasCharacter = characters.find((character) => character.id === canvasCharacterId) ?? characters[0];
  const canvasIdentityAsset = canvasCharacter ? resolveCharacterIdentityAsset(canvasCharacter, roleAssets) : undefined;
  const canvasReferenceAssets = canvasCharacter ? roleAssets.filter((asset) => asset.type === "role_reference" && asset.relatedCharacterId === canvasCharacter.id && asset.referenceUrl) : [];
  const characterBoardPrompt = canvasCharacter ? buildCanvasCharacterBoardPrompt(canvasCharacter, canvasIdentityAsset, canvasReferenceAssets) : "";
  const characterCanvasSteps = [
    { label: "输入参考图", value: `${canvasReferenceAssets.length + (canvasIdentityAsset?.referenceUrl ? 1 : 0)} 张`, ready: Boolean(canvasReferenceAssets.length || canvasIdentityAsset?.referenceUrl) },
    { label: "生成角色身份板", value: "16:9", ready: Boolean(canvasIdentityAsset?.referenceUrl) },
    { label: "锁定一致性", value: `${lockedRoleCount}/${characters.length}`, ready: characters.length > 0 && lockedRoleCount >= characters.length },
    { label: "进入故事板", value: `${lockedSceneCount} 场景`, ready: lockedRoleCount > 0 }
  ];

  useEffect(() => {
    if (!characters.length) return;
    setCanvasCharacterId((current) => current && characters.some((character) => character.id === current) ? current : characters[0].id);
  }, [characters]);

  async function runEvaluation() {
    setEvaluating(true);
    setLocalMessage("");
    try {
      await api.generateQualityReports(projectId, { stages: ["character"] });
      setLocalMessage("角色离线评测已完成，评分和问题已回流后台。");
      await onRefresh();
    } finally {
      setEvaluating(false);
    }
  }

  async function saveReference(character: CharacterProfile, referenceUrl: string) {
    if (!referenceUrl.trim()) return;
    setSavingId(character.id);
    setLocalMessage("");
    try {
      await api.setCharacterReferenceImage(projectId, character.id, {
        referenceUrl: referenceUrl.trim(),
        description: `${character.name} 创作者上传参考设定图`
      });
      setReferenceInputs((current) => ({ ...current, [character.id]: "" }));
      setLocalMessage("参考设定图已保存，不会覆盖 AI 三视图。");
      await onRefresh();
    } finally {
      setSavingId(null);
    }
  }

  async function uploadReference(character: CharacterProfile, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const referenceUrl = await fileToDataUrl(file);
    await saveReference(character, referenceUrl);
  }

  async function clearReferences(character: CharacterProfile) {
    if (!window.confirm(`确认清空「${character.name}」的创作者上传参考图？AI 三视图不会被删除。`)) return;
    setSavingId(character.id);
    try {
      await api.deleteCharacterReferenceImage(projectId, character.id);
      await onRefresh();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="panel creator-character-workbench asset-lock-workbench preworkbench-board">
      <div className="panel-head">
        <div>
          <h2>角色与场景资产工作台</h2>
          <small>先锁定角色三视图、创作者参考图和场景卡；这些资产会被最终分镜总台自动继承。</small>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={() => void runEvaluation()} disabled={evaluating || !characters.length}>{evaluating ? <Loader2 size={16} className="spin-icon" /> : <BookOpenCheck size={16} />}离线评测</button>
          <button className="primary-button" onClick={onGenerate} disabled={isBusy || characters.length === 0}><UserRound size={18} />生成角色三视图</button>
        </div>
      </div>

      <div className="asset-lock-summary-strip">
        <article className={lockedRoleCount >= characters.length && characters.length ? "ready" : ""}><strong>{lockedRoleCount}/{characters.length}</strong><span>角色定稿</span></article>
        <article className={lockedSceneCount >= sceneAssets.length && sceneAssets.length ? "ready" : ""}><strong>{lockedSceneCount}/{sceneAssets.length}</strong><span>场景卡</span></article>
        <article><strong>{roleAssets.filter((asset) => asset.type === "role_reference").length}</strong><span>创作者参考</span></article>
        <article><strong>{latestReport?.totalScore ?? "-"}</strong><span>离线评分</span></article>
      </div>

      <CanvasWorkflowPanel
        tone="character"
        eyebrow="CANVAS WORKFLOW 01"
        title="角色身份板生成协议"
        description="用参考图和角色卡生成 16:9 角色身份板，先锁脸、服装、姿态语言和表情范围，再交给故事板与视频节点复用。"
        steps={characterCanvasSteps}
        promptTitle={canvasCharacter ? `${canvasCharacter.name} 角色板提示词` : "角色板提示词"}
        promptHint="输入：参考图 + 角色卡。输出：白底电影身份板，不生成环境、道具、Logo、水印。"
        prompt={characterBoardPrompt}
      >
        <div className="canvas-character-selector">
          {characters.map((character) => {
            const identityAsset = resolveCharacterIdentityAsset(character, roleAssets);
            return (
              <button className={canvasCharacter?.id === character.id ? "active" : ""} key={character.id} onClick={() => setCanvasCharacterId(character.id)} type="button">
                <span>{identityAsset?.referenceUrl ? <StableImage src={identityAsset.referenceUrl} alt={character.name} /> : <UserRound size={16} />}</span>
                <strong>{character.name}</strong>
                <small>{identityAsset?.referenceUrl ? "身份板已锁定" : "待生成身份板"}</small>
              </button>
            );
          })}
        </div>
      </CanvasWorkflowPanel>

      <QualityReportCard report={latestReport} emptyTitle="角色尚未离线评测" emptyText="生成或上传参考图后，可手动点击离线评测，结果会回流后台质量中心。" />
      {localMessage ? <p className="success-text">{localMessage}</p> : null}

      <div className="asset-lock-layout">
        <div className="creator-character-grid">
          {characters.map((character) => {
            const identityAsset = resolveCharacterIdentityAsset(character, roleAssets);
            const referenceAssets = roleAssets.filter((asset) => asset.type === "role_reference" && asset.relatedCharacterId === character.id && asset.referenceUrl);
            return (
              <article className="creator-character-card" key={character.id}>
                <div className="creator-character-media">
                  <button className={identityAsset?.referenceUrl ? "identity-preview ready" : "identity-preview"} type="button" onClick={() => identityAsset?.referenceUrl && onPreview({ url: identityAsset.referenceUrl, title: `${character.name} AI 身份板` })}>
                    {identityAsset?.referenceUrl ? <StableImage src={identityAsset.referenceUrl} alt={character.name} /> : <><UserRound size={30} /><span>AI 身份板待生成</span></>}
                  </button>
                  <div className="creator-character-meta">
                    <span className={identityAsset?.referenceUrl ? "status succeeded" : "status pending"}>{identityAsset?.referenceUrl ? "身份板已锁定" : "待生成身份板"}</span>
                    <h3>{character.name}</h3>
                    <p>{character.identity}</p>
                    <small>{character.appearance}</small>
                  </div>
                </div>

                <div className="creator-reference-panel">
                  <strong>创作者参考设定</strong>
                  <div className="reference-thumb-row">
                    {referenceAssets.map((asset) => (
                      <button key={asset.id} type="button" onClick={() => asset.referenceUrl && onPreview({ url: asset.referenceUrl, title: asset.name })}>
                        <StableImage src={asset.referenceUrl!} alt={asset.name} />
                      </button>
                    ))}
                    {!referenceAssets.length ? <span className="reference-empty">可上传脸型、服装、风格、道具参考</span> : null}
                  </div>
                  <div className="reference-url-row compact">
                    <input value={referenceInputs[character.id] ?? ""} onChange={(event) => setReferenceInputs((current) => ({ ...current, [character.id]: event.target.value }))} placeholder="粘贴图片 URL / data-url" />
                    <button className="ghost-button" type="button" onClick={() => void saveReference(character, referenceInputs[character.id] ?? "")} disabled={savingId === character.id || !referenceInputs[character.id]?.trim()}>保存参考</button>
                  </div>
                  <div className="inline-actions">
                    <label className="ghost-button avatar-upload-button"><Upload size={16} />上传参考<input type="file" accept="image/*" onChange={(event) => void uploadReference(character, event)} disabled={savingId === character.id} /></label>
                    <button className="ghost-button danger-ghost" onClick={() => void clearReferences(character)} disabled={savingId === character.id || !referenceAssets.length}><Trash2 size={16} />清空参考</button>
                  </div>
                </div>
              </article>
            );
          })}
          {!characters.length ? <div className="empty-state">暂无角色卡，请先生成剧本。</div> : null}
        </div>

        <aside className="scene-asset-board">
          <div>
            <h3>场景环境资产</h3>
            <small>分镜表拆解后会沉淀场景卡，后续可扩展为独立场景概念图生成。</small>
          </div>
          <div className="scene-asset-list">
            {sceneAssets.map((asset) => (
              <article key={asset.id} className={asset.referenceUrl ? "ready" : ""}>
                <button type="button" onClick={() => asset.referenceUrl && onPreview({ url: asset.referenceUrl, title: asset.name })} disabled={!asset.referenceUrl}>
                  {asset.referenceUrl ? <StableImage src={asset.referenceUrl} alt={asset.name} /> : <Images size={20} />}
                </button>
                <div>
                  <span>{asset.referenceUrl ? "场景图已锁定" : asset.status === "succeeded" ? "文本场景已锁定" : "待锁定"}</span>
                  <strong>{asset.name}</strong>
                  <p>{asset.description || asset.prompt}</p>
                </div>
              </article>
            ))}
            {!sceneAssets.length ? <div className="empty-state">暂无场景卡。先拆分镜表后，系统会自动沉淀场景资产。</div> : null}
          </div>
        </aside>
      </div>

      <FeedbackComposer projectId={projectId} stage="character" recentCount={characterFeedback.length} onSubmitted={onRefresh} />
    </section>
  );
}

function CreatorImagesBoard({
  projectId,
  storyboards,
  characters,
  roleAssets,
  sceneAssets,
  imageAssets,
  qualityReports,
  feedbacks,
  isBusy,
  onRefresh,
  onPreview
}: {
  projectId: string;
  storyboards: StoryboardShot[];
  characters: CharacterProfile[];
  roleAssets: AssetItem[];
  sceneAssets: AssetItem[];
  imageAssets: AssetItem[];
  qualityReports: QualityReport[];
  feedbacks: UserFeedback[];
  isBusy: boolean;
  onRefresh: () => void | Promise<void>;
  onPreview: (preview: { url: string; title: string }) => void;
}) {
  const imageAssetByShotId = useMemo(() => new Map(imageAssets.map((asset) => [asset.id.replace(/^image_/, ""), asset])), [imageAssets]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeShotId, setActiveShotId] = useState(storyboards[0]?.id ?? "");
  const [draft, setDraft] = useState<Partial<StoryboardShot>>({});
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const latestReport = latestStageReport(qualityReports, "image");
  const imageFeedback = feedbacks.filter((item) => item.stage === "image");
  const activeShot = storyboards.find((shot) => shot.id === activeShotId) ?? storyboards[0];
  const activeShotIndex = activeShot ? storyboards.findIndex((shot) => shot.id === activeShot.id) : -1;
  const activeAsset = activeShot ? imageAssetByShotId.get(activeShot.id) : undefined;
  const activeSceneAsset = activeShot ? findSceneAsset(activeShot.scene, sceneAssets) : undefined;
  const activeShotCanvasPrompt = activeShot ? buildCanvasSingleShotPrompt(activeShot, characters, activeSceneAsset) : "";
  const pendingShotIds = storyboards.filter((shot) => !imageAssetByShotId.get(shot.id)?.referenceUrl).map((shot) => shot.id);
  const activeReferenceIds = new Set(activeShot?.referenceAssetIds ?? []);
  const sceneGroups = useMemo(() => buildProductionSceneGroups(storyboards), [storyboards]);
  const lockedRoleAssets = characters
    .map((character) => ({ character, asset: resolveCharacterIdentityAsset(character, roleAssets) }))
    .filter((item) => item.asset?.referenceUrl);

  useEffect(() => {
    if (!storyboards.length) return;
    setActiveShotId((current) => current && storyboards.some((shot) => shot.id === current) ? current : storyboards[0].id);
  }, [storyboards]);

  useEffect(() => {
    if (!activeShot) return;
    setDraft({
      pictureDesc: activeShot.pictureDesc,
      action: activeShot.action ?? "",
      shotSize: activeShot.shotSize,
      cameraAngle: activeShot.cameraAngle,
      cameraMovement: activeShot.cameraMovement,
      emotion: activeShot.emotion ?? "",
      dialogue: activeShot.dialogue,
      imagePrompt: activeShot.imagePrompt,
      videoPrompt: activeShot.videoPrompt
    });
  }, [activeShot?.id]);

  function toggleShot(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function runImageEvaluation() {
    setWorking("evaluate");
    setMessage("");
    try {
      await api.generateQualityReports(projectId, { stages: ["image"] });
      setMessage("分镜图离线评测已完成，评分、问题和建议已回流后台。");
      await onRefresh();
    } finally {
      setWorking("");
    }
  }

  async function generateOne(shot: StoryboardShot) {
    setWorking(`one:${shot.id}`);
    setMessage("");
    try {
      await api.regenerateShotImage(projectId, shot.id);
      setMessage(`已生成 ${formatShotNo(shot, storyboards.indexOf(shot))}。`);
      await onRefresh();
    } finally {
      setWorking("");
    }
  }

  async function generateSelected() {
    const ids = selectedIds.length ? selectedIds : activeShot ? [activeShot.id] : [];
    if (!ids.length) return;
    setWorking("selected");
    setMessage("");
    try {
      await api.generateImages(projectId, { shotIds: ids });
      setMessage(`已提交 ${ids.length} 个镜头生成。`);
      await onRefresh();
    } finally {
      setWorking("");
    }
  }

  async function generatePending() {
    if (!pendingShotIds.length) return;
    if (!window.confirm(`将提交 ${pendingShotIds.length} 个待生成镜头。建议已完成单张测试后再继续，确认生成？`)) return;
    setWorking("pending");
    setMessage("");
    try {
      await api.generateImages(projectId, { shotIds: pendingShotIds });
      setMessage(`已提交 ${pendingShotIds.length} 个待生成镜头。`);
      await onRefresh();
    } finally {
      setWorking("");
    }
  }

  async function saveActiveShot() {
    if (!activeShot) return;
    setWorking("save");
    setMessage("");
    try {
      await api.updateStoryboardShot(projectId, activeShot.id, draft);
      setMessage("镜头信息已保存，旧首帧会回到待生成状态。");
      await onRefresh();
    } finally {
      setWorking("");
    }
  }

  return (
    <section className="panel creator-shot-workbench director-desk-workbench">
      <div className="panel-head director-desk-head">
        <div>
          <h2>单镜头导演台</h2>
          <small>单个镜头做精修：首帧、角色、场景、镜头参数和视频提示词都在这里精细调整。</small>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={() => void runImageEvaluation()} disabled={working === "evaluate" || !imageAssets.length}>{working === "evaluate" ? <Loader2 size={16} className="spin-icon" /> : <BookOpenCheck size={16} />}离线评测</button>
          <button className="ghost-button" onClick={() => void generateSelected()} disabled={isBusy || Boolean(working) || (!selectedIds.length && !activeShot)}>生成选中</button>
          <button className="primary-button" onClick={() => void generatePending()} disabled={isBusy || Boolean(working) || !pendingShotIds.length}><Images size={18} />全部待生成</button>
        </div>
      </div>

      <div className="director-status-strip">
        <article><span>当前模型</span><strong>Qwen Image / wan2.6-t2i</strong></article>
        <article><span>图像尺寸</span><strong>按项目路由</strong></article>
        <article><span>参考图</span><strong>{lockedRoleAssets.length + sceneAssets.length} 个</strong></article>
        <article><span>预计消耗</span><strong>{activeShot ? "单镜头计费" : "-"}</strong></article>
        <article className={working ? "running" : ""}><span>当前任务</span><strong>{working ? "生成中" : "空闲"}</strong></article>
      </div>

      <QualityReportCard report={latestReport} emptyTitle="分镜图尚未离线评测" emptyText="生成首帧后可手动评测，创作者评分和系统评分都会进入后台 badcase 池。" />
      {message ? <p className="success-text">{message}</p> : null}

      <div className="director-desk-layout">
        <aside className="director-shot-tree">
          <div className="design-section-title">
            <h3>镜头列表</h3>
            <small>第 1 集 · {storyboards.length} 镜头</small>
          </div>
          <div className="director-shot-tree-scroll">
            {sceneGroups.map((group) => (
              <section key={group.id}>
                <button className="director-scene-toggle" type="button">
                  <span>场 {group.sceneNo}</span>
                  <strong>{group.scene}</strong>
                  <small>{group.shots.length} 镜头 · {group.duration}s</small>
                </button>
                {group.shots.map((shot) => {
                  const index = storyboards.findIndex((item) => item.id === shot.id);
                  const asset = imageAssetByShotId.get(shot.id);
                  const selected = selectedIds.includes(shot.id);
                  const active = activeShot?.id === shot.id;
                  return (
                    <article className={active ? "active" : ""} key={shot.id}>
                      <input type="checkbox" checked={selected} onChange={() => toggleShot(shot.id)} aria-label={`选择 ${formatShotNo(shot, index)}`} />
                      <button type="button" className={asset?.referenceUrl ? "director-shot-thumb ready" : "director-shot-thumb"} onClick={() => setActiveShotId(shot.id)}>
                        {asset?.referenceUrl ? <StableImage src={asset.referenceUrl} alt={asset.name} /> : <Sparkles size={16} />}
                      </button>
                      <button type="button" onClick={() => setActiveShotId(shot.id)}>
                        <strong>{formatShotNo(shot, index)}</strong>
                        <span>{shot.pictureDesc}</span>
                        <small>{asset?.referenceUrl ? "已完成" : "未生成"} · {shot.duration}s</small>
                      </button>
                    </article>
                  );
                })}
              </section>
            ))}
            {!storyboards.length ? <div className="empty-state">暂无分镜，请先完成分镜拆解。</div> : null}
          </div>
        </aside>

        <main className="director-canvas-column">
          <div className="director-canvas-head">
            <div>
              <h3>{activeShot ? formatShotNo(activeShot, Math.max(activeShotIndex, 0)) : "选择镜头"}</h3>
              <small>{activeShot?.pictureDesc || "选择一个镜头后编辑画面。"}</small>
            </div>
            <div className="segmented-control">
              <button className="active" type="button">原图</button>
              <button type="button">对比</button>
            </div>
          </div>
          <button className={shotFrameClass(activeAsset?.referenceUrl ? "director-preview-frame ready" : "director-preview-frame", activeShot)} type="button" onClick={() => activeAsset?.referenceUrl && onPreview({ url: activeAsset.referenceUrl, title: activeAsset.name })}>
            {activeAsset?.referenceUrl ? <StableImage src={activeAsset.referenceUrl} alt={activeAsset.name} /> : <div><Sparkles size={32} /><strong>{activeShot ? "首帧待生成" : "选择镜头"}</strong><small>先生成单张测试图</small></div>}
          </button>
          {activeShot ? (
            <div className="inline-actions director-canvas-actions">
              <button className="primary-button" onClick={() => void generateOne(activeShot)} disabled={Boolean(working) || isBusy}>{working === `one:${activeShot.id}` ? <Loader2 size={16} className="spin-icon" /> : <Sparkles size={16} />}单镜头生成</button>
              <button className="ghost-button" onClick={() => toggleShot(activeShot.id)}>{selectedIds.includes(activeShot.id) ? "取消多选" : "加入多选"}</button>
              <button className="ghost-button" onClick={() => void saveActiveShot()} disabled={working === "save"}><Save size={16} />保存镜头</button>
            </div>
          ) : null}

          <div className="director-version-strip">
            <div className="design-section-title">
              <h3>图片版本</h3>
              <small>后续可接入强制重绘和版本对比</small>
            </div>
            <div>
              {[0, 1, 2, 3].map((slot) => {
                const current = slot === 0 ? activeAsset : undefined;
                return (
                  <button className={current?.referenceUrl ? "ready" : ""} key={slot} type="button" onClick={() => current?.referenceUrl && onPreview({ url: current.referenceUrl, title: current.name })}>
                    {current?.referenceUrl ? <StableImage src={current.referenceUrl} alt={current.name} /> : <Sparkles size={18} />}
                    <span>v{slot + 1} {slot === 0 ? "当前" : slot === 1 ? "重绘" : slot === 2 ? "参考优化" : "空位"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </main>

        <aside className="director-settings-panel">
          <div className="director-settings-tabs">
            <button className="active" type="button">镜头设置</button>
            <button type="button">角色</button>
            <button type="button">场景</button>
            <button type="button">高级参数</button>
          </div>
          <CanvasPromptCard
            title="单镜头画布输入"
            hint="输入：角色身份板 + 场景卡 + 当前镜头。用于单镜头重绘、局部精修和后续图生视频。"
            prompt={activeShotCanvasPrompt}
            compact
          />
          {activeShot ? (
            <>
              <div className="shot-edit-form director-edit-form">
                <div className="shot-edit-grid">
                  <label><span>时长</span><input value={String(activeShot.duration ?? "")} readOnly /></label>
                  <label><span>景别</span><input value={String(draft.shotSize ?? "")} onChange={(event) => setDraft((current) => ({ ...current, shotSize: event.target.value }))} /></label>
                  <label><span>机位</span><input value={String(draft.cameraAngle ?? "")} onChange={(event) => setDraft((current) => ({ ...current, cameraAngle: event.target.value }))} /></label>
                  <label><span>运镜</span><input value={String(draft.cameraMovement ?? "")} onChange={(event) => setDraft((current) => ({ ...current, cameraMovement: event.target.value }))} /></label>
                  <label><span>角色</span><input value={activeShot.characters.join(" / ") || "待绑定"} readOnly /></label>
                  <label><span>场景</span><input value={activeShot.scene || activeSceneAsset?.name || "待绑定"} readOnly /></label>
                </div>
                <label><span>动作</span><textarea value={String(draft.action ?? "")} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))} /></label>
                <label><span>情绪</span><input value={String(draft.emotion ?? "")} onChange={(event) => setDraft((current) => ({ ...current, emotion: event.target.value }))} /></label>
                <label><span>图片提示词</span><textarea value={String(draft.imagePrompt ?? "")} onChange={(event) => setDraft((current) => ({ ...current, imagePrompt: event.target.value }))} /></label>
                <label><span>视频提示词</span><textarea value={String(draft.videoPrompt ?? "")} onChange={(event) => setDraft((current) => ({ ...current, videoPrompt: event.target.value }))} /></label>
              </div>
              <div className="director-reference-stack">
                <section>
                  <h3>角色参考</h3>
                  {lockedRoleAssets.slice(0, 4).map(({ character, asset }) => (
                    <button className={asset && activeReferenceIds.has(asset.id) ? "active" : ""} key={character.id} type="button" onClick={() => asset?.referenceUrl && onPreview({ url: asset.referenceUrl, title: character.name })}>
                      {asset?.referenceUrl ? <StableImage src={asset.referenceUrl} alt={character.name} /> : <UserRound size={15} />}
                      <span>{character.name}</span>
                    </button>
                  ))}
                </section>
                <section>
                  <h3>场景参考</h3>
                  <button className={activeSceneAsset?.referenceUrl ? "active" : ""} type="button" onClick={() => activeSceneAsset?.referenceUrl && onPreview({ url: activeSceneAsset.referenceUrl, title: activeSceneAsset.name })}>
                    {activeSceneAsset?.referenceUrl ? <StableImage src={activeSceneAsset.referenceUrl} alt={activeSceneAsset.name} /> : <Images size={15} />}
                    <span>{activeSceneAsset?.name || activeShot.scene || "待场景"}</span>
                  </button>
                </section>
              </div>
            </>
          ) : <div className="empty-state">请选择一个镜头。</div>}
        </aside>
      </div>

      <div className="director-matrix-panel">
        <div className="design-section-title">
          <h3>故事板矩阵</h3>
          <small>概览模式：由单镜头资产自动组成</small>
        </div>
        <div className="director-matrix-grid">
          {storyboards.map((shot, index) => {
            const asset = imageAssetByShotId.get(shot.id);
            return (
              <button className={activeShot?.id === shot.id ? "active" : ""} key={shot.id} onClick={() => setActiveShotId(shot.id)} type="button">
                <span>{asset?.referenceUrl ? <StableImage src={asset.referenceUrl} alt={asset.name} /> : <Sparkles size={18} />}</span>
                <strong>{formatShotNo(shot, index)}</strong>
                <small>{asset?.referenceUrl ? "已生成" : "待生成"} · {shot.duration}s</small>
              </button>
            );
          })}
        </div>
      </div>

      <FeedbackComposer projectId={projectId} stage="image" assetId={activeAsset?.id} recentCount={imageFeedback.length} onSubmitted={onRefresh} />
    </section>
  );
}

function QualityReportCard({ report, emptyTitle, emptyText }: { report?: QualityReport; emptyTitle: string; emptyText: string }) {
  if (!report) {
    return <div className="creator-quality-card empty"><strong>{emptyTitle}</strong><span>{emptyText}</span></div>;
  }
  const dimensions = Object.entries(report.dimensionScores ?? {});
  return (
    <div className={report.pass ? "creator-quality-card pass" : "creator-quality-card warn"}>
      <div>
        <span>{stageLabelLocal(report.stage)}离线评测</span>
        <strong>{report.totalScore}分</strong>
        <small>{report.pass ? "建议可继续生产" : "建议先单张测试或补充参考"}</small>
      </div>
      <div className="quality-dimension-list">
        {dimensions.slice(0, 6).map(([name, value]) => <span key={name}>{dimensionLabel(name)} {value}</span>)}
      </div>
      <p>{report.problems[0] || report.suggestions[0] || report.recommendedAction}</p>
    </div>
  );
}

function FeedbackComposer({ projectId, stage, assetId, recentCount, onSubmitted }: { projectId: string; stage: "character" | "image"; assetId?: string; recentCount: number; onSubmitted: () => void | Promise<void> }) {
  const [rating, setRating] = useState(4);
  const [usability, setUsability] = useState<UserFeedback["usability"]>("usable");
  const [tags, setTags] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const tagOptions = stage === "character"
    ? ["角色不像", "脸型漂移", "服装不一致", "参考图不足", "可继续"]
    : ["角色不像", "构图问题", "提示词不符", "画面崩坏", "可用于视频"];

  function toggleTag(tag: string) {
    setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  }

  async function submit() {
    setSubmitting(true);
    setMessage("");
    try {
      await api.submitFeedback({
        projectId,
        assetId,
        stage,
        rating,
        usability,
        tags,
        content,
        source: "creator_workbench"
      });
      setContent("");
      setTags([]);
      setMessage("反馈已提交，会进入后台质量中心和 badcase 池。");
      await onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="creator-feedback-panel">
      <div>
        <strong>创作者效果反馈</strong>
        <span>已有 {recentCount} 条反馈回流后台</span>
      </div>
      <div className="feedback-quick-row">
        <label>评分<select value={rating} onChange={(event) => setRating(Number(event.target.value))}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} 分</option>)}</select></label>
        <label>可用性<select value={usability} onChange={(event) => setUsability(event.target.value as UserFeedback["usability"])}><option value="usable">可用</option><option value="barely_usable">勉强可用</option><option value="unusable">不可用</option></select></label>
        <div className="feedback-tag-row">{tagOptions.map((tag) => <button key={tag} type="button" className={tags.includes(tag) ? "active" : ""} onClick={() => toggleTag(tag)}>{tag}</button>)}</div>
      </div>
      <div className="feedback-input-row">
        <input value={content} onChange={(event) => setContent(event.target.value)} placeholder="补充说明：哪里不像、哪里崩、希望怎么改..." />
        <button className="primary-button" onClick={() => void submit()} disabled={submitting}>{submitting ? "提交中" : "提交反馈"}</button>
      </div>
      {message ? <small className="success-text">{message}</small> : null}
    </div>
  );
}

function StableImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [src]);
  return (
    <span className={loaded ? "stable-image loaded" : "stable-image"}>
      <span />
      <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} />
    </span>
  );
}

function latestStageReport(reports: QualityReport[], stage: QualityReport["stage"]) {
  return [...reports]
    .filter((report) => report.stage === stage)
    .sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)))[0];
}

function resolveCharacterIdentityAsset(character: CharacterProfile, assets: AssetItem[]) {
  const byReference = character.referenceAssetId ? assets.find((asset) => asset.id === character.referenceAssetId && asset.referenceUrl) : undefined;
  const derivative = assets.find((asset) => asset.type === "role_derivative" && asset.relatedCharacterId === character.id && asset.referenceUrl);
  const primary = assets.find((asset) => asset.type === "role" && asset.relatedCharacterId === character.id && asset.referenceUrl);
  return byReference ?? derivative ?? primary;
}

function stageLabelLocal(stage: string) {
  const labels: Record<string, string> = { script: "剧本", character: "角色", storyboard: "分镜", image: "分镜图", video: "视频" };
  return labels[stage] ?? stage;
}

function dimensionLabel(name: string) {
  const labels: Record<string, string> = {
    identity: "身份",
    appearance: "外观",
    multiview: "多视图",
    storyMatch: "剧情匹配",
    referenceFollow: "参考完整",
    negativePrompt: "负面词",
    promptMatch: "提示匹配",
    characterConsistency: "角色一致",
    composition: "构图",
    artifact: "瑕疵",
    videoReady: "视频可用"
  };
  return labels[name] ?? name;
}

function DesignDeskBoard({
  storyboards,
  characters,
  roleAssets,
  sceneAssets,
  imageAssets,
  videoAssets,
  productionPackage,
  isBusy,
  onGenerate,
  onOpenDirector,
  onOpenVideo,
  onPreview
}: {
  storyboards: StoryboardShot[];
  characters: CharacterProfile[];
  roleAssets: AssetItem[];
  sceneAssets: AssetItem[];
  imageAssets: AssetItem[];
  videoAssets: AssetItem[];
  productionPackage: StoryboardProductionPackage | null;
  isBusy: boolean;
  onGenerate: () => void;
  onOpenDirector: () => void;
  onOpenVideo: () => void;
  onPreview: (preview: { url: string; title: string }) => void;
}) {
  const sceneGroups = useMemo(() => buildProductionSceneGroups(storyboards), [storyboards]);
  const imageAssetByShotId = useMemo(() => buildShotAssetMap(imageAssets, "image"), [imageAssets]);
  const videoAssetByShotId = useMemo(() => buildShotAssetMap(videoAssets, "video"), [videoAssets]);
  const [activeShotId, setActiveShotId] = useState(storyboards[0]?.id ?? "");
  const activeShot = storyboards.find((shot) => shot.id === activeShotId) ?? storyboards[0];
  const activeIndex = activeShot ? storyboards.findIndex((shot) => shot.id === activeShot.id) : -1;
  const activeImage = activeShot ? imageAssetByShotId.get(activeShot.id) : undefined;
  const activeVideo = activeShot ? videoAssetByShotId.get(activeShot.id) : undefined;
  const activeSceneAsset = activeShot ? findSceneAsset(activeShot.scene, sceneAssets) : undefined;
  const snapshot = productionPackage?.projectSnapshot;
  const lockedRoleCount = countCompletedCharacterSheets(characters, roleAssets);
  const readySceneCount = sceneAssets.filter((asset) => asset.referenceUrl || asset.status === "succeeded").length;
  const readyImages = storyboards.filter((shot) => imageAssetByShotId.get(shot.id)?.referenceUrl).length;
  const hasStoryboardVisuals = readyImages > 0 || Boolean(snapshot?.storyboardImages);
  const playableVideos = storyboards.filter((shot) => isPlayableVideoUrl(videoAssetByShotId.get(shot.id)?.referenceUrl)).length;
  const storyboardCanvasPrompt = buildCanvasStoryboardBoardPrompt(storyboards, characters, sceneAssets);
  const storyboardCanvasSteps = [
    { label: "角色身份板", value: `${lockedRoleCount}/${characters.length}`, ready: !characters.length || lockedRoleCount >= characters.length },
    { label: "场景参考", value: `${readySceneCount}`, ready: readySceneCount > 0 },
    { label: "12格故事板", value: `${Math.min(12, storyboards.length)}/12`, ready: storyboards.length >= 6 },
    { label: "视频提示词", value: playableVideos ? "已联动" : "待推导", ready: playableVideos > 0 }
  ];

  useEffect(() => {
    if (!storyboards.length) return;
    setActiveShotId((current) => current && storyboards.some((shot) => shot.id === current) ? current : storyboards[0].id);
  }, [storyboards]);

  const deskSteps = [
    { no: 1, label: "剧本解析", value: `${sceneGroups.length || 0} 场`, ready: sceneGroups.length > 0 },
    { no: 2, label: "角色锁定", value: `${lockedRoleCount}/${characters.length}`, ready: !characters.length || lockedRoleCount >= characters.length },
    { no: 3, label: "场景资产", value: `${readySceneCount}/${Math.max(sceneGroups.length, sceneAssets.length)}`, ready: readySceneCount > 0 },
    { no: 4, label: "分镜图", value: `${readyImages}/${storyboards.length}`, ready: storyboards.length > 0 && readyImages >= storyboards.length },
    { no: 5, label: "视频片段", value: `${playableVideos}/${storyboards.length}`, ready: playableVideos > 0 },
    { no: 6, label: "导出处理", value: snapshot?.videoClips ? "可合成" : "待处理", ready: Boolean(snapshot?.videoClips) }
  ];

  return (
    <section className="panel design-desk-workbench">
      <div className="panel-head design-desk-head">
        <div>
          <h2>设计总台</h2>
          <small>把剧本解析结果转成视觉生产矩阵：角色、场景、分镜图、视频片段在同一张总台里推进。</small>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={onGenerate} disabled={isBusy}><WandSparkles size={18} />刷新分镜表</button>
          <button className="primary-button" onClick={onOpenDirector} disabled={!storyboards.length}><Images size={18} />进入单镜头导演台</button>
        </div>
      </div>

      <div className="design-stage-strip">
        {deskSteps.map((step) => (
          <article className={step.ready ? "ready" : ""} key={step.label}>
            <strong>{step.no}</strong>
            <span>{step.label}</span>
            <small>{step.value}</small>
          </article>
        ))}
      </div>

      <CanvasWorkflowPanel
        tone="storyboard"
        eyebrow="CANVAS WORKFLOW 02"
        title="12宫格故事板画布"
        description="把分镜表、角色身份板和场景参考合成一张黑白手绘电影故事板，用彩色箭头标注动作、机位、构图、灯光和情绪，降低视频抽卡概率。"
        steps={storyboardCanvasSteps}
        promptTitle="故事板矩阵生成提示词"
        promptHint="输入：分镜表 + 角色身份板 + 场景参考。输出：16:9、12格、黑白草图、有彩色导演标注的故事板。"
        prompt={storyboardCanvasPrompt}
      >
      </CanvasWorkflowPanel>

      <div className="design-desk-layout">
        <aside className="design-scene-rail">
          <div className="design-section-title">
            <h3>场景组</h3>
            <small>按场次查看生产完整度</small>
          </div>
          <div className="design-scene-list">
            {sceneGroups.map((group) => {
              const imageReady = group.shots.filter((shot) => imageAssetByShotId.get(shot.id)?.referenceUrl).length;
              const videoReady = group.shots.filter((shot) => isPlayableVideoUrl(videoAssetByShotId.get(shot.id)?.referenceUrl)).length;
              const progress = group.shots.length ? Math.round(((imageReady + videoReady) / (group.shots.length * 2)) * 100) : 0;
              return (
                <button className={activeShot && group.shots.some((shot) => shot.id === activeShot.id) ? "active" : ""} key={group.id} onClick={() => setActiveShotId(group.shots[0]?.id ?? "")} type="button">
                  <strong>场 {group.sceneNo} · {group.scene}</strong>
                  <span>{group.characters.join(" / ") || "待绑定角色"} · {group.duration}s</span>
                  <small>{imageReady}/{group.shots.length} 首帧 · {videoReady}/{group.shots.length} 视频</small>
                  <i><b style={{ width: `${progress}%` }} /></i>
                </button>
              );
            })}
            {!sceneGroups.length ? <div className="empty-state">暂无场景组，请先生成分镜表。</div> : null}
          </div>
        </aside>

        <main className="design-matrix-panel">
          <div className="design-matrix-head">
            <div>
              <h3>故事板矩阵</h3>
              <small>按场景组批量查看分镜图、视频、字幕和声音状态</small>
            </div>
            <div className="segmented-control">
              <button className="active" type="button">镜头卡</button>
              <button type="button">场景卡</button>
              <button type="button">风险</button>
            </div>
          </div>

          <div className="design-story-grid">
            {sceneGroups.map((group) => (
              <section className="design-scene-section" key={group.id}>
                <div className="design-scene-section-head">
                  <strong>场 {group.sceneNo} · {group.scene}</strong>
                  <span>{group.shots.length} 镜头 · {group.duration}s · {group.characters.length ? "已绑定角色" : "待绑定角色"}</span>
                </div>
                <div className="design-shot-card-grid">
                  {group.shots.map((shot) => {
                    const index = storyboards.findIndex((item) => item.id === shot.id);
                    const image = imageAssetByShotId.get(shot.id);
                    const video = videoAssetByShotId.get(shot.id);
                    const active = activeShot?.id === shot.id;
                    return (
                      <button className={active ? "design-shot-card active" : "design-shot-card"} key={shot.id} onClick={() => setActiveShotId(shot.id)} type="button">
                        <span className={shotFrameClass(image?.referenceUrl ? "design-shot-thumb ready" : "design-shot-thumb", shot)}>
                          {image?.referenceUrl ? <StableImage src={image.referenceUrl} alt={image.name} /> : <><i /><b /></>}
                        </span>
                        <strong>{formatShotNo(shot, index)}</strong>
                        <p>{shot.pictureDesc}</p>
                        <span className="design-shot-statuses">
                          <em className={image?.referenceUrl ? "ready" : ""}>图</em>
                          <em className={isPlayableVideoUrl(video?.referenceUrl) ? "ready" : ""}>视</em>
                          <em className={shot.dialogue || shot.voiceOver ? "ready" : ""}>字</em>
                          <em className={shot.environmentSound || shot.soundEffect ? "ready" : ""}>音</em>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {!sceneGroups.length ? <div className="empty-state">暂无分镜。完成剧本解析后，点击刷新分镜表。</div> : null}
          </div>

          <section className={`storyboard-global-preview-panel ${hasStoryboardVisuals ? "is-ready" : "is-empty"}`}>
            <div className="design-section-title">
              <h3>12 格故事板全局预览</h3>
              <small>用于核对动作节拍、角色连续性和视频生成参考图，不显示内部提示词。</small>
            </div>
            {hasStoryboardVisuals ? (
              <CanvasBeatGrid storyboards={storyboards} imageAssetByShotId={imageAssetByShotId} activeShotId={activeShot?.id} onSelect={setActiveShotId} />
            ) : (
              <div className="storyboard-global-empty">
                <div>
                  <strong>先生成总图，再进入 12 格校对</strong>
                  <p>这里用于展示故事板总图裁切后的镜头矩阵。还没有首帧或总图时，不铺空格子，先确认分镜表、角色身份板和场景参考是否齐全。</p>
                </div>
                <button className="primary-button" onClick={onOpenDirector} disabled={!storyboards.length} type="button">
                  <Images size={18} />进入单镜头导演台
                </button>
              </div>
            )}
          </section>

          <ProductionTimeline storyboards={storyboards} imageAssetByShotId={imageAssetByShotId} videoAssetByShotId={videoAssetByShotId} />
        </main>

        <aside className="design-inspector">
          <div className="design-section-title">
            <h3>镜头 Inspector</h3>
            <small>{activeShot ? `${formatShotNo(activeShot, Math.max(activeIndex, 0))} · ${activeShot.pictureDesc.slice(0, 18)}` : "选择镜头查看"}</small>
          </div>
          <button className={shotFrameClass(activeImage?.referenceUrl ? "design-inspector-preview ready" : "design-inspector-preview", activeShot)} type="button" onClick={() => activeImage?.referenceUrl && onPreview({ url: activeImage.referenceUrl, title: activeImage.name })}>
            {activeImage?.referenceUrl ? <StableImage src={activeImage.referenceUrl} alt={activeImage.name} /> : <Sparkles size={30} />}
          </button>
          {activeShot ? (
            <>
              <div className="design-asset-checks">
                <AssetCheck label="角色资产" value={activeShot.characters.length ? activeShot.characters.join(" / ") : "待绑定"} ready={activeShot.characters.length > 0} />
                <AssetCheck label="场景资产" value={activeSceneAsset?.referenceUrl ? "已锁定场景图" : activeSceneAsset ? "文本场景已锁定" : "缺少场景参考"} ready={Boolean(activeSceneAsset)} />
                <AssetCheck label="首帧图" value={activeImage?.referenceUrl ? "已生成" : "待生成"} ready={Boolean(activeImage?.referenceUrl)} />
                <AssetCheck label="视频片段" value={isPlayableVideoUrl(activeVideo?.referenceUrl) ? "可播放" : activeVideo ? statusText[activeVideo.status] : "待生成"} ready={isPlayableVideoUrl(activeVideo?.referenceUrl)} />
                <AssetCheck label="字幕/配音" value={activeShot.dialogue || activeShot.voiceOver ? "有台词可生成" : "暂无台词"} ready={Boolean(activeShot.dialogue || activeShot.voiceOver)} />
              </div>
              <div className="design-guidance-note">
                <strong>导演提示</strong>
                <p>{activeShot.videoPrompt || activeShot.imagePrompt || activeShot.pictureDesc}</p>
              </div>
              <button className="primary-button full-button" onClick={onOpenDirector} type="button"><Images size={18} />进入单镜头导演台</button>
              <button className="ghost-button full-button" onClick={onOpenVideo} type="button"><Film size={18} />查看视频闭环</button>
              <button className="ghost-button full-button" onClick={onGenerate} disabled={isBusy} type="button"><WandSparkles size={18} />重生成分镜表</button>
            </>
          ) : <div className="empty-state">请选择一个镜头。</div>}
        </aside>
      </div>
    </section>
  );
}

function AssetCheck({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className={ready ? "ready" : ""}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProductionTimeline({
  storyboards,
  imageAssetByShotId,
  videoAssetByShotId
}: {
  storyboards: StoryboardShot[];
  imageAssetByShotId: Map<string, AssetItem>;
  videoAssetByShotId: Map<string, AssetItem>;
}) {
  const tracks = [
    { key: "image", label: "首帧轨道", status: (shot: StoryboardShot) => imageAssetByShotId.get(shot.id)?.referenceUrl ? "ready" : "pending" },
    { key: "video", label: "视频轨道", status: (shot: StoryboardShot) => isPlayableVideoUrl(videoAssetByShotId.get(shot.id)?.referenceUrl) ? "ready" : videoAssetByShotId.get(shot.id) ? "running" : "pending" },
    { key: "caption", label: "字幕/配音", status: (shot: StoryboardShot) => shot.dialogue || shot.voiceOver ? "ready" : "pending" },
    { key: "sound", label: "音效/BGM", status: (shot: StoryboardShot) => shot.environmentSound || shot.soundEffect ? "ready" : "pending" }
  ];
  const totalDuration = Math.max(1, storyboards.reduce((sum, shot) => sum + (shot.duration || 0), 0));

  return (
    <section className="production-timeline">
      <div className="production-timeline-head">
        <strong>生产时间线</strong>
        <span>{storyboards.length} 镜头 · {totalDuration}s · 可接入视频闭环</span>
      </div>
      <div className="production-timeline-scroll">
        {tracks.map((track) => (
          <div className="production-track-row" key={track.key}>
            <strong>{track.label}</strong>
            <div>
              {storyboards.map((shot, index) => {
                const width = `${Math.max(72, Math.round(((shot.duration || 1) / totalDuration) * 840))}px`;
                return (
                  <span className={`production-segment ${track.status(shot)}`} key={`${track.key}-${shot.id}`} style={{ width }}>
                    <b>{index + 1}</b>
                    <em>{shot.duration || 1}s</em>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ImagesBoard({ storyboards, imageAssets, isBusy, onGenerate, onPreview }: { storyboards: StoryboardShot[]; imageAssets: AssetItem[]; isBusy: boolean; onGenerate: () => void; onPreview: (preview: { url: string; title: string }) => void }) {
  return (
    <section className="panel shot-image-gallery">
      <div className="panel-head">
        <div><h2>分镜图工作台</h2><small>按已定稿角色生成首帧图。建议先少量测试风格，再批量补齐。</small></div>
        <button className="primary-button" onClick={onGenerate} disabled={isBusy || !storyboards.length}><Images size={18} />生成待生成分镜图</button>
      </div>
      <div className="shot-card-grid">
        {(storyboards.length ? storyboards : imageAssets).map((item, index) => {
          const shot = "pictureDesc" in item ? item : undefined;
          const asset = imageAssets[index];
          const url = asset?.referenceUrl;
          return (
            <article className="shot-image-card" key={item.id}>
              <button className={url ? "shot-preview ready" : "shot-preview"} onClick={() => url && onPreview({ url, title: asset?.name ?? formatShotNo(shot, index) })} type="button">
                {url ? <img src={url} alt={asset?.name ?? "分镜图"} /> : <div className="shot-preview-empty"><Sparkles size={26} /><strong>{formatShotNo(shot, index)}</strong><small>待生成</small></div>}
              </button>
              <strong>{formatShotNo(shot, index)}</strong>
              <p>{shot?.pictureDesc ?? asset?.description}</p>
              <span>{url ? "已出图" : "待出图"}</span>
            </article>
          );
        })}
        {!storyboards.length && !imageAssets.length ? <div className="empty-state">暂无分镜图。</div> : null}
      </div>
    </section>
  );
}

function VideoBoard({ projectId, storyboards, characters, roleAssets, imageAssets, videoAssets, exportJobs, isBusy, onGenerate, onCreateExport, onRefresh }: { projectId: string; storyboards: StoryboardShot[]; characters: CharacterProfile[]; roleAssets: AssetItem[]; imageAssets: AssetItem[]; videoAssets: AssetItem[]; exportJobs: ExportJob[]; isBusy: boolean; onGenerate: () => void; onCreateExport: (type: "tts" | "subtitle" | "video_export") => void; onRefresh: () => void | Promise<void> }) {
  const imageAssetByShotId = useMemo(() => buildShotAssetMap(imageAssets, "image"), [imageAssets]);
  const videoAssetByShotId = useMemo(() => buildShotAssetMap(videoAssets, "video"), [videoAssets]);
  const [activeShotId, setActiveShotId] = useState(storyboards[0]?.id ?? "");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playableVideoCount = storyboards.filter((shot) => isPlayableVideoUrl(videoAssetByShotId.get(shot.id)?.referenceUrl)).length;
  const latestJob = exportJobs[0];
  const latestMp4 = exportJobs.find((job) => job.outputKind === "mp4" || job.type === "video_export");
  const audioJob = exportJobs.find((job) => job.audioUrl || job.outputKind === "audio" || job.type === "tts");
  const subtitleJob = exportJobs.find((job) => job.subtitleUrl || job.outputKind === "subtitle" || job.type === "subtitle");
  const activeShot = storyboards.find((shot) => shot.id === activeShotId) ?? storyboards[0];
  const activeIndex = activeShot ? storyboards.findIndex((shot) => shot.id === activeShot.id) : -1;
  const activeImage = activeShot ? imageAssetByShotId.get(activeShot.id) : undefined;
  const activeVideo = activeShot ? videoAssetByShotId.get(activeShot.id) : undefined;
  const activeVideoUrl = isPlayableVideoUrl(activeVideo?.referenceUrl) ? activeVideo!.referenceUrl! : "";
  const activeSeedancePrompt = activeShot ? buildCanvasSeedanceVideoPrompt(activeShot, storyboards, characters, roleAssets) : "";
  const totalDuration = Math.max(1, storyboards.reduce((sum, shot) => sum + (shot.duration || 0), 0));
  const hasWarnings = exportJobs.some((job) => job.warnings?.length || job.errorReason);

  useEffect(() => {
    if (!storyboards.length) return;
    setActiveShotId((current) => current && storyboards.some((shot) => shot.id === current) ? current : storyboards[0].id);
  }, [storyboards]);

  useEffect(() => {
    setPlaybackProgress(0);
    setPlaybackDuration(activeShot?.duration ?? 0);
    setIsPlaying(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [activeShot?.id, activeVideoUrl]);

  function syncVideoMetadata() {
    const video = videoRef.current;
    if (!video) return;
    setPlaybackDuration(Number.isFinite(video.duration) ? video.duration : activeShot?.duration ?? 0);
  }

  function syncVideoTime() {
    const video = videoRef.current;
    if (!video) return;
    setPlaybackProgress(video.currentTime || 0);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video || !activeVideoUrl) return;
    if (video.paused) {
      void video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }

  function seekPlayback(event: ChangeEvent<HTMLInputElement>) {
    const value = Number(event.target.value);
    setPlaybackProgress(value);
    if (videoRef.current) videoRef.current.currentTime = value;
  }

  async function downloadJob(job: ExportJob) {
    const blob = await api.downloadExportJob(projectId, job.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${job.type}-${job.id}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel video-loop-desk">
      <div className="panel-head video-loop-head">
        <div>
          <h2>视频闭环导演总控台</h2>
          <small>从镜头视频、配音、字幕、封面到 MP4 导出做最后闭环。当前首帧 {imageAssets.length}/{storyboards.length}，可播放视频 {playableVideoCount}/{storyboards.length}。</small>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={() => void onRefresh()}><RefreshCw size={18} />刷新状态</button>
          <button className="primary-button" onClick={onGenerate} disabled={isBusy || !imageAssets.length}><Film size={18} />生成镜头视频</button>
        </div>
      </div>

      <div className="video-loop-progress-strip">
        <article className={playableVideoCount ? "ready" : ""}><span>片段完成</span><strong>{playableVideoCount}/{storyboards.length}</strong><i><b style={{ width: `${storyboards.length ? Math.round((playableVideoCount / storyboards.length) * 100) : 0}%` }} /></i></article>
        <article className={audioJob?.status === "succeeded" || Boolean(audioJob?.audioUrl) ? "ready" : ""}><span>TTS 配音</span><strong>{audioJob?.status === "succeeded" || audioJob?.audioUrl ? "正常" : "待生成"}</strong></article>
        <article className={subtitleJob?.status === "succeeded" || Boolean(subtitleJob?.subtitleUrl) ? "ready" : ""}><span>字幕状态</span><strong>{subtitleJob?.status === "succeeded" || subtitleJob?.subtitleUrl ? "正常" : "待生成"}</strong></article>
        <article className={latestMp4?.status === "succeeded" ? "ready" : ""}><span>导出就绪</span><strong>{latestMp4?.status === "succeeded" ? "可下载" : "待合成"}</strong></article>
        <article><span>预计时长</span><strong>{formatClock(totalDuration)}</strong></article>
      </div>

      <div className="video-loop-layout">
        <aside className="video-clip-manifest">
          <div className="design-section-title">
            <h3>片段清单</h3>
            <small>{storyboards.length} 个镜头 · 单击切换预览</small>
          </div>
          <div className="video-clip-list">
            {storyboards.map((shot, index) => {
              const video = videoAssetByShotId.get(shot.id);
              const image = imageAssetByShotId.get(shot.id);
              const ready = isPlayableVideoUrl(video?.referenceUrl);
              return (
                <button className={activeShot?.id === shot.id ? "active" : ""} key={shot.id} onClick={() => setActiveShotId(shot.id)} type="button">
                  <span className={ready || image?.referenceUrl ? "video-clip-mini ready" : "video-clip-mini"}>{ready ? <video src={video!.referenceUrl} muted preload="metadata" /> : image?.referenceUrl ? <StableImage src={image.referenceUrl} alt={image.name} /> : <Film size={16} />}</span>
                  <strong>{String(index + 1).padStart(2, "0")}</strong>
                  <span>{shot.pictureDesc}</span>
                  <small>{shot.duration}s · {ready ? "完成" : video ? statusText[video.status] : "待视频"}</small>
                </button>
              );
            })}
            {!storyboards.length ? <div className="empty-state">暂无片段，请先生成分镜。</div> : null}
          </div>
        </aside>

        <main className="video-preview-console">
          <div className="video-preview-head">
            <div>
              <h3>当前预览：{activeShot ? formatShotNo(activeShot, Math.max(activeIndex, 0)) : "待选择镜头"}</h3>
              <small>{activeShot?.scene || "暂无场景"} · {activeShot?.shotSize || "-"} · {activeShot?.cameraMovement || "-"}</small>
            </div>
            <span>{activeVideo?.status ? statusText[activeVideo.status] : "待生成"}</span>
          </div>
          <div className={shotFrameClass("video-player-frame", activeShot)}>
            {activeVideoUrl ? (
              <video
                ref={videoRef}
                src={activeVideoUrl}
                preload="metadata"
                onLoadedMetadata={syncVideoMetadata}
                onTimeUpdate={syncVideoTime}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              />
            ) : activeImage?.referenceUrl ? (
              <StableImage src={activeImage.referenceUrl} alt={activeImage.name} />
            ) : (
              <div><Film size={34} /><strong>待生成视频片段</strong><small>先在单镜头导演台生成首帧，再提交图生视频。</small></div>
            )}
          </div>
          <div className="video-transport-bar">
            <button className="icon-button" type="button" aria-label={isPlaying ? "暂停" : "播放"} onClick={togglePlayback} disabled={!activeVideoUrl}>
              {isPlaying ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(1, playbackDuration || activeShot?.duration || 1)}
              step={0.1}
              value={Math.min(playbackProgress, Math.max(1, playbackDuration || activeShot?.duration || 1))}
              onChange={seekPlayback}
              disabled={!activeVideoUrl}
              aria-label="视频进度"
            />
            <span>{formatClock(playbackProgress)} / {formatClock(playbackDuration || activeShot?.duration || totalDuration)}</span>
            <small>{activeShot?.dialogue || activeShot?.voiceOver || "暂无台词"}</small>
          </div>
          <CanvasPromptCard
            title="Seedance 2.0 当前视频提示词"
            hint="输入：@[CHARACTER REF] 角色身份板 + @[STORYBOARD REF] 故事板/首帧参考。按故事板节拍推导动作、机位、灯光和尾帧。"
            prompt={activeSeedancePrompt}
            compact
          />
          <VideoTimelineTracks storyboards={storyboards} imageAssetByShotId={imageAssetByShotId} videoAssetByShotId={videoAssetByShotId} activeShotId={activeShot?.id} onSelect={setActiveShotId} />
        </main>

        <aside className="video-export-inspector">
          <section className={hasWarnings ? "export-check-card warn" : "export-check-card ready"}>
            <div>
              <AlertTriangle size={17} />
              <strong>{hasWarnings ? "发现导出问题" : "导出检查通过"}</strong>
            </div>
            <p>{hasWarnings ? "仍有失败任务、警告或缺失素材，建议查看底部错误与警告。" : "片段、字幕和配音状态可继续合成。"}</p>
          </section>
          <section className="export-settings-card">
            <h3>输出设置</h3>
            <label><span>输出比例</span><select defaultValue="9:16"><option>9:16</option><option>16:9</option><option>1:1</option></select></label>
            <label><span>帧率</span><select defaultValue="24"><option value="24">24 fps</option><option value="30">30 fps</option></select></label>
            <label><span>文件名</span><input defaultValue="manjiao_final_v1.mp4" /></label>
          </section>
          <section className="cover-frame-card">
            <h3>封面帧</h3>
            <button type="button">
              {activeImage?.referenceUrl ? <StableImage src={activeImage.referenceUrl} alt={activeImage.name} /> : <Images size={20} />}
            </button>
          </section>
          <section className="export-task-stack">
            <h3>生成任务</h3>
            <button className="ghost-button" onClick={() => void onCreateExport("tts")} disabled={isBusy}><Download size={16} />生成配音</button>
            <button className="ghost-button" onClick={() => void onCreateExport("subtitle")} disabled={isBusy}><Download size={16} />生成字幕</button>
            <button className="primary-button" onClick={() => void onCreateExport("video_export")} disabled={isBusy}><Download size={16} />合成 MP4</button>
          </section>
        </aside>
      </div>

      <div className="video-output-dashboard">
        <section>
          <h3>导出任务历史</h3>
          {exportJobs.slice(0, 4).map((job) => (
            <article key={job.id}>
              <strong>{exportJobLabel(job)}</strong>
              <span className={`status ${job.status}`}>{job.status}</span>
              <small>{new Date(job.updatedAt).toLocaleString()}</small>
              <button className="ghost-button" onClick={() => void downloadJob(job)} disabled={job.status !== "succeeded"}>下载</button>
            </article>
          ))}
          {!exportJobs.length ? <div className="empty-state">暂无导出任务。</div> : null}
        </section>
        <section>
          <h3>最新输出</h3>
          {latestJob ? (
            <div className="latest-output-card">
              <strong>{exportJobLabel(latestJob)}</strong>
              <span>{latestJob.errorReason || `状态：${latestJob.status}`}</span>
              <button className="ghost-button" onClick={() => void downloadJob(latestJob)} disabled={latestJob.status !== "succeeded"}><Download size={16} />下载文件</button>
            </div>
          ) : <div className="empty-state">合成后这里会展示最新输出。</div>}
        </section>
        <section>
          <h3>错误与警告</h3>
          {exportJobs.flatMap((job) => [...(job.warnings ?? []), job.errorReason].filter(Boolean).map((item) => ({ id: `${job.id}-${item}`, text: item! }))).slice(0, 5).map((item) => <p key={item.id}>{item.text}</p>)}
          {!hasWarnings ? <p>暂无错误和警告。</p> : null}
        </section>
      </div>
    </section>
  );
}

function VideoTimelineTracks({
  storyboards,
  imageAssetByShotId,
  videoAssetByShotId,
  activeShotId,
  onSelect
}: {
  storyboards: StoryboardShot[];
  imageAssetByShotId: Map<string, AssetItem>;
  videoAssetByShotId: Map<string, AssetItem>;
  activeShotId?: string;
  onSelect: (shotId: string) => void;
}) {
  const totalDuration = Math.max(1, storyboards.reduce((sum, shot) => sum + (shot.duration || 0), 0));
  const tracks = [
    { key: "video", label: "视频轨道", ready: (shot: StoryboardShot) => isPlayableVideoUrl(videoAssetByShotId.get(shot.id)?.referenceUrl), text: (shot: StoryboardShot) => videoAssetByShotId.get(shot.id) ? "片段" : "待片段" },
    { key: "audio", label: "配音轨道", ready: (shot: StoryboardShot) => Boolean(shot.dialogue || shot.voiceOver), text: (shot: StoryboardShot) => shot.dialogue || shot.voiceOver || "待配音" },
    { key: "caption", label: "字幕轨道", ready: (shot: StoryboardShot) => Boolean(shot.dialogue), text: (shot: StoryboardShot) => shot.dialogue || "待字幕" },
    { key: "sfx", label: "音效轨道", ready: (shot: StoryboardShot) => Boolean(shot.environmentSound || shot.soundEffect), text: (shot: StoryboardShot) => shot.environmentSound || shot.soundEffect || "环境声" }
  ];

  return (
    <section className="video-track-timeline">
      <div className="video-time-ruler">
        <span>00:00</span>
        <span>{formatClock(Math.round(totalDuration / 2))}</span>
        <span>{formatClock(totalDuration)}</span>
      </div>
      {tracks.map((track) => (
        <div className="video-track-row" key={track.key}>
          <strong>{track.label}</strong>
          <div>
            {storyboards.map((shot, index) => {
              const width = `${Math.max(82, Math.round(((shot.duration || 1) / totalDuration) * 980))}px`;
              const image = imageAssetByShotId.get(shot.id);
              return (
                <button className={`${track.ready(shot) ? "ready" : ""} ${activeShotId === shot.id ? "active" : ""}`} key={`${track.key}-${shot.id}`} onClick={() => onSelect(shot.id)} style={{ width }} type="button">
                  {track.key === "video" && image?.referenceUrl ? <StableImage src={image.referenceUrl} alt={image.name} /> : null}
                  <span>{index + 1}</span>
                  <em>{track.text(shot)}</em>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

type CanvasWorkflowStep = { label: string; value: string; ready: boolean };

function CanvasWorkflowPanel({
  tone,
  eyebrow,
  title,
  description,
  steps,
  promptTitle,
  promptHint,
  prompt,
  children
}: {
  tone: "character" | "storyboard" | "video";
  eyebrow: string;
  title: string;
  description: string;
  steps: CanvasWorkflowStep[];
  promptTitle: string;
  promptHint: string;
  prompt: string;
  children?: ReactNode;
}) {
  return (
    <section className={`canvas-workflow-panel ${tone}`}>
      <div className="canvas-workflow-head">
        <div>
          <span>{eyebrow}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="canvas-workflow-steps">
          {steps.map((step, index) => (
            <article className={step.ready ? "ready" : ""} key={step.label}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              <strong>{step.label}</strong>
              <span>{step.value}</span>
            </article>
          ))}
        </div>
      </div>
      {children}
      <CanvasPromptCard title={promptTitle} hint={promptHint} prompt={prompt} />
    </section>
  );
}

function CanvasPromptCard({ title, hint, prompt, compact = false, visible = false }: { title: string; hint: string; prompt: string; compact?: boolean; visible?: boolean }) {
  const [copied, setCopied] = useState(false);

  if (!visible) return null;

  async function copyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = prompt;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  }

  return (
    <div className={compact ? "canvas-prompt-card compact" : "canvas-prompt-card"}>
      <div className="canvas-prompt-head">
        <div>
          <strong>{title}</strong>
          <span>{hint}</span>
        </div>
        <button className="ghost-button" type="button" onClick={() => void copyPrompt()} disabled={!prompt}>
          {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>{prompt || "等待分镜、角色或参考素材生成后，系统会自动拼出可复制的提示词。"}</pre>
    </div>
  );
}

function CanvasBeatGrid({ storyboards, imageAssetByShotId, activeShotId, onSelect }: { storyboards: StoryboardShot[]; imageAssetByShotId: Map<string, AssetItem>; activeShotId?: string; onSelect: (shotId: string) => void }) {
  const slots = Array.from({ length: 12 }, (_, index) => storyboards[index]);
  return (
    <div className="canvas-beat-grid">
      {slots.map((shot, index) => {
        const image = shot ? imageAssetByShotId.get(shot.id) : undefined;
        return (
          <button className={`${shot?.id === activeShotId ? "active" : ""} ${image?.referenceUrl ? "ready" : ""}`} key={shot?.id ?? `empty-${index}`} type="button" onClick={() => shot && onSelect(shot.id)} disabled={!shot}>
            <span className="canvas-beat-thumb">
              {image?.referenceUrl ? <StableImage src={image.referenceUrl} alt={image.name} /> : <WandSparkles size={18} />}
            </span>
            <strong>{String(index + 1).padStart(2, "0")}</strong>
            <small>{shot ? shot.action || shot.pictureDesc : "待补节拍"}</small>
          </button>
        );
      })}
    </div>
  );
}

function ProjectRouteSwitcher({ project, providers, onSave }: { project: Project; providers: ModelProvider[]; onSave: (routes: Partial<Pick<Project, "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">>) => void | Promise<void> }) {
  const [draft, setDraft] = useState({
    textProvider: project.textProvider ?? "",
    textModel: project.textModel ?? "",
    imageProvider: project.imageProvider ?? "",
    imageModel: project.imageModel && !failedImageModels.has(project.imageModel) ? project.imageModel : "wan2.6-t2i",
    imageSize: normalizeImageOutputSize(project.imageSize),
    imageQuality: normalizeImageOutputQuality(project.imageQuality),
    videoProvider: project.videoProvider ?? "",
    videoModel: project.videoModel ?? ""
  });
  const textProviders = providers.filter((provider) => provider.modality === "text" && provider.enabled);
  const imageProviders = providers.filter((provider) => provider.modality === "image" && provider.enabled);
  const videoProviders = providers.filter((provider) => provider.modality === "video" && provider.enabled);

  function modelsFor(providerId: string, modality: "text" | "image" | "video") {
    const models = providers.find((provider) => provider.id === providerId && provider.modality === modality)?.models ?? [];
    const filtered = modality === "image" ? models.filter((model) => !failedImageModels.has(model)) : models;
    return filtered.length ? filtered : modality === "image" ? ["wan2.6-t2i"] : [];
  }

  function updateProvider(modality: "text" | "image" | "video", providerId: string) {
    const models = modelsFor(providerId, modality);
    setDraft((current) => ({
      ...current,
      [`${modality}Provider`]: providerId,
      [`${modality}Model`]: models[0] ?? ""
    }));
  }

  return (
    <div className="project-route-switcher compact">
      <RouteSelect title="剧本/分镜拆解" provider={draft.textProvider} model={draft.textModel} providers={textProviders} models={modelsFor(draft.textProvider, "text")} onProvider={(value) => updateProvider("text", value)} onModel={(value) => setDraft((current) => ({ ...current, textModel: value }))} />
      <RouteSelect title="角色图/分镜图" provider={draft.imageProvider} model={draft.imageModel} providers={imageProviders} models={modelsFor(draft.imageProvider, "image")} onProvider={(value) => updateProvider("image", value)} onModel={(value) => setDraft((current) => ({ ...current, imageModel: value }))} />
      <RouteSelect title="图生视频" provider={draft.videoProvider} model={draft.videoModel} providers={videoProviders} models={modelsFor(draft.videoProvider, "video")} onProvider={(value) => updateProvider("video", value)} onModel={(value) => setDraft((current) => ({ ...current, videoModel: value }))} />
      <div className="route-param-row">
        <label><span>分辨率</span><select value={draft.imageSize} onChange={(event) => setDraft((current) => ({ ...current, imageSize: normalizeImageOutputSize(event.target.value) }))}>{imageOutputSizeOptions.map((item) => <option key={item.value} value={item.value}>{item.label} · x{item.multiplier}</option>)}</select></label>
        <label><span>质量</span><select value={draft.imageQuality} onChange={(event) => setDraft((current) => ({ ...current, imageQuality: normalizeImageOutputQuality(event.target.value) }))}>{imageOutputQualityOptions.map((item) => <option key={item.value} value={item.value}>{item.label} · x{item.multiplier}</option>)}</select></label>
        <small>当前参数倍率 x{imageParameterMultiplier(draft.imageSize, draft.imageQuality).toFixed(2)}，生成时按项目参数扣费。</small>
      </div>
      <button className="ghost-button" onClick={() => void onSave(draft)} type="button"><Save size={16} />保存路由</button>
    </div>
  );
}

function RouteSelect({ title, provider, model, providers, models, onProvider, onModel }: { title: string; provider: string; model: string; providers: ModelProvider[]; models: string[]; onProvider: (value: string) => void; onModel: (value: string) => void }) {
  return (
    <div className="route-step-card">
      <strong>{title}</strong>
      <select value={provider} onChange={(event) => onProvider(event.target.value)}>{providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select value={model} onChange={(event) => onModel(event.target.value)}>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select>
    </div>
  );
}

function GenerationCostPreview({ estimate, disabled, onConfirm }: { estimate: StageEstimate; disabled: boolean; onConfirm: () => void }) {
  return (
    <div className="production-action secondary generation-cost-preview">
      <div><span>生成前确认</span><strong>{estimate.estimatedCredits} 积分</strong></div>
      <dl>
        <div><span>模型</span><strong>{estimate.provider} / {estimate.model}</strong></div>
        <div><span>参数</span><strong>{estimate.parameters}</strong></div>
        <div><span>数量</span><strong>{estimate.quantity}</strong></div>
      </dl>
      <small>{estimate.refundPolicy}</small>
      <button className="primary-button compact" onClick={onConfirm} disabled={disabled} type="button">确认生成</button>
    </div>
  );
}

function StageLine({ label, value, done }: { label: string; value: string; done: boolean }) {
  return <div className={done ? "stage-line done" : "stage-line"}><span>{label}</span><strong>{value}</strong></div>;
}

function FlowCheck({ done, title, text }: { done: boolean; title: string; text: string }) {
  return <div className={done ? "flow-check done" : "flow-check"}><span>{done ? "已完成" : "待确认"}</span><strong>{title}</strong><p>{text}</p></div>;
}

function InlineProgress({ operation, elapsed }: { operation: NonNullable<OperationState>; elapsed: number }) {
  const percent = Math.min(96, 14 + elapsed * 3);
  return (
    <div className="operation-progress">
      <div><Loader2 size={17} className="spin-icon" /><strong>{operation.title}</strong><span>{elapsed}s</span></div>
      <div className="operation-progress-track"><span style={{ width: `${percent}%` }} /></div>
      <p>{operation.detail}</p>
    </div>
  );
}

function ImagePreviewModal({ preview, onClose }: { preview: { url: string; title: string }; onClose: () => void }) {
  return (
    <div className="image-preview-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()}>
        <button className="icon-button" onClick={onClose} aria-label="关闭预览">×</button>
        <strong>{preview.title}</strong>
        <img src={preview.url} alt={preview.title} />
      </div>
    </div>
  );
}

type NextAction = {
  id: "script" | "storyboard" | "character" | "image" | "video" | "done";
  icon: "script" | "storyboard" | "character" | "image" | "video";
  title: string;
  description: string;
  disabled: boolean;
};

type StageEstimate = {
  provider: string;
  model: string;
  parameters: string;
  quantity: number;
  estimatedCredits: number;
  refundPolicy: string;
};

function resolveNextAction(context: { script?: ScriptDraft; characters: CharacterProfile[]; storyboards: StoryboardShot[]; completedRoleRefs: number; completedImages: number; completedVideos: number }): NextAction {
  if (!context.script) return { id: "script", icon: "script", title: "等待剧本生成完成", description: "剧本和角色卡生成后再进入项目生产。", disabled: true };
  if (context.characters.length && context.completedRoleRefs < context.characters.length) return { id: "character", icon: "character", title: "下一步：生成角色三视图", description: `${context.completedRoleRefs}/${context.characters.length} 个角色已定稿，先锁定角色身份。`, disabled: false };
  if (!context.storyboards.length) return { id: "storyboard", icon: "storyboard", title: "下一步：确认剧本并拆分镜", description: "把剧本拆成镜头级清单，再进入首帧图生产。", disabled: false };
  if (context.completedImages < context.storyboards.length) return { id: "image", icon: "image", title: "下一步：生成分镜图", description: `${context.completedImages}/${context.storyboards.length} 张首帧已完成，继续补齐。`, disabled: false };
  if (context.completedVideos < context.storyboards.length) return { id: "video", icon: "video", title: "下一步：生成视频片段", description: `${context.completedVideos}/${context.storyboards.length} 条视频片段已有记录。`, disabled: false };
  return { id: "done", icon: "video", title: "生产链路已闭环", description: "可以进入视频合成、配音、字幕和导出。", disabled: true };
}

function estimateStage(project: Project, prices: ModelPrice[], stage: NextAction["id"], counts: { characters: number; storyboards: number; pendingImages: number; pendingVideos: number }): StageEstimate {
  const textUnit = resolveUnitCredits(prices, "text", project.textProvider, project.textModel, 8);
  const imageBase = resolveUnitCredits(prices, "image", project.imageProvider, project.imageModel, 10);
  const imageUnit = estimateImageCredits(imageBase, project.imageSize, project.imageQuality);
  const videoUnit = resolveUnitCredits(prices, "video", project.videoProvider, project.videoModel, 12);
  if (stage === "storyboard") return { provider: project.textProvider ?? "-", model: project.textModel ?? "-", parameters: "剧本拆分", quantity: Math.max(1, project.episodes), estimatedCredits: Math.max(1, project.episodes) * textUnit, refundPolicy: "失败不扣费，已冻结积分自动退回。" };
  if (stage === "character") return { provider: project.imageProvider ?? "-", model: project.imageModel ?? "-", parameters: `${normalizeImageOutputSize(project.imageSize)} / ${normalizeImageOutputQuality(project.imageQuality)} / 一图三视图`, quantity: counts.characters, estimatedCredits: counts.characters * imageUnit, refundPolicy: "阶段失败不扣费，成功图片按张扣费。" };
  if (stage === "image") return { provider: project.imageProvider ?? "-", model: project.imageModel ?? "-", parameters: `${normalizeImageOutputSize(project.imageSize)} / ${normalizeImageOutputQuality(project.imageQuality)}`, quantity: counts.pendingImages, estimatedCredits: counts.pendingImages * imageUnit, refundPolicy: "失败不扣费，成功分镜图按张扣费。" };
  if (stage === "video") return { provider: project.videoProvider ?? "-", model: project.videoModel ?? "-", parameters: `${project.videoRatio} / 图生视频`, quantity: counts.pendingVideos * 4, estimatedCredits: counts.pendingVideos * 4 * videoUnit, refundPolicy: "上游未返回可播放视频前保持任务状态，失败或取消退回未消耗积分。" };
  return { provider: "-", model: "-", parameters: "-", quantity: 0, estimatedCredits: 0, refundPolicy: "暂无需要提交的生成任务。" };
}

function resolveUnitCredits(prices: ModelPrice[], modality: string, providerId: string | undefined, model: string | undefined, fallback: number) {
  const rows = prices.filter((item) => item.modality === modality && item.enabled !== false);
  return rows.find((item) => item.providerId === providerId && item.model === model)?.unitCredits
    ?? rows.find((item) => item.model === model)?.unitCredits
    ?? rows.find((item) => item.providerId === providerId)?.unitCredits
    ?? fallback;
}

function countCompletedCharacterSheets(characters: CharacterProfile[], assets: AssetItem[]) {
  return characters.filter((character) => assets.some((asset) => asset.relatedCharacterId === character.id && asset.referenceUrl && asset.status === "succeeded")).length;
}

function resolveCharacterDisplayAsset(character: CharacterProfile, assets: AssetItem[]) {
  const byReferenceId = character.referenceAssetId
    ? assets.find((asset) => asset.id === character.referenceAssetId && asset.referenceUrl)
    : undefined;
  const identityBoard = assets.find((asset) =>
    asset.relatedCharacterId === character.id &&
    asset.type === "role_derivative" &&
    asset.referenceUrl &&
    asset.status === "succeeded"
  );
  const primaryRole = assets.find((asset) =>
    asset.relatedCharacterId === character.id &&
    asset.type === "role"
  );
  return byReferenceId ?? identityBoard ?? primaryRole;
}

function buildCanvasCharacterBoardPrompt(character: CharacterProfile, identityAsset?: AssetItem, referenceAssets: AssetItem[] = []) {
  const refs = [identityAsset, ...referenceAssets]
    .filter((asset): asset is AssetItem => Boolean(asset?.referenceUrl))
    .map((asset) => `@${asset.name}`)
    .join("、") || "@[CHARACTER REF]";
  return [
    "创建一张艺术性的 16:9 角色身份板。",
    `[主体]：使用参考图 ${refs}，角色名：${character.name}，身份：${compactPromptText(character.identity)}。`,
    `外貌：${compactPromptText(character.appearance)}。服装：${compactPromptText(character.costume)}。性格/表演气质：${compactPromptText(character.personality)}。`,
    "纯白色 / 柔和米白色背景；无环境、无道具、无标志、无水印。",
    "设计方向：不要创建标准角色参考表，创建一张电影感身份板，像高端动画工作室的角色研究与艺术节布局结合。",
    "布局不对称、优雅且视觉上令人难忘，使用大留白、整体化图像比例和有意的不平衡；避免网格、蓝图设计、目录布局和重复转场展示。",
    "主要构图：放置一个大型英雄全身视角，略微偏离中心作为视觉锚点。",
    "辅助研究：中性全身视角、背面视角、侧面视角、坐姿、倾斜姿势、蹲姿、俯视身体角度、仰视身体角度、富有表现力的肖像研究。",
    "身份锁定：所有视角保持同一张脸、相同面部比例、相同发型、相同服装、相同身体比例、相同姿势语言和相同视觉个性。",
    "有用参考细节：清晰的面部形状、发型轮廓、服装轮廓、身体形状、手部、姿势和表情范围，便于未来图像和视频生成。",
    "艺术性部分：加入小轮廓研究区、表情研究区和面部/头发/服装细节研究区；只在有帮助的位置使用小型手写风格标签：名称、角色、核心情绪、视觉标志。",
    "风格：简约、电影感、高端、艺术书般、干净、富有表现力、适合制作。"
  ].join("\n");
}

function buildCanvasStoryboardBoardPrompt(storyboards: StoryboardShot[], characters: CharacterProfile[], sceneAssets: AssetItem[]) {
  if (!storyboards.length) return "";
  const beats = storyboards.slice(0, 12).map((shot, index) => {
    return `${index + 1}. ${shot.scene || "未命名场景"}｜${shot.characters.join("、") || "无角色"}｜${shot.action || shot.pictureDesc}｜${shot.shotSize} / ${shot.cameraAngle} / ${shot.cameraMovement}｜情绪：${shot.emotion || "推进"}`;
  }).join("\n");
  const characterBrief = describeCharactersForPrompt(uniqueCharacterNames(storyboards, characters), characters);
  const sceneBrief = sceneAssets.slice(0, 4).map((asset) => `${asset.name}：${compactPromptText(asset.description || asset.prompt)}`).join("；") || uniqueSceneNames(storyboards).join("、");
  return [
    "为故事板创建一个原始的电影分镜板，专注于激烈的身体动作、明确的场面调度和可生成视频的镜头逻辑。",
    "输入参考：@[CHARACTER REF] 角色身份板 + @[SCENE REF] 场景参考 + 当前分镜表。不要要求用户逐格手动改提示词；请根据主题、角色、场景和分镜节拍自动改写为一整张故事板生成提示词。",
    "16:9 故事板表格，12 个电影风格面板。实际故事板绘图必须仅为黑白：粗糙铅笔线条、最少细节、快速手势绘图能量、简单解剖结构构建、强烈且可读的轮廓。保持艺术作品轻量、动态且未完成，像早期编舞预览。",
    `角色设定：${characterBrief || "沿用角色身份板，保持同一脸型、服装和姿态语言。"}`,
    `场景设定：${sceneBrief || "保持环境最小化，只保留对运动和构图有帮助的空间线索。"}`,
    "每个面板必须包含可见运动和强烈身体动量，避免静态站立姿势。使用电影摄影技巧：手持能量、快速平移、环绕运动、头顶镜头、侧面剪影、长焦压缩、极端负空间。",
    "保持环境最小化但有意义：空旷空间、烟雾、织物运动、硬光束、湿地板反射，只在需要时出现。",
    "标注颜色系统：红色箭头=身体运动；蓝色箭头=摄影机运动；绿色标记=取景/构图笔记；橙色标记=灯光方向；紫色标记=声音/情感强调；黑色文本=简短镜头标签和面板笔记。",
    "不要生成九宫格视频感，不要彩色成片，不要精修插画，不要长段中文正文，不要水印，不要 Logo。",
    "12 个节拍，从左到右、从上到下：",
    beats,
    "最终画面应该像一张可用于视频模型的导演故事板：主题、场景、摄像机、灯光、动作过程清楚标注，能显著降低抽卡概率。"
  ].join("\n");
}

function buildCanvasSingleShotPrompt(shot: StoryboardShot, characters: CharacterProfile[], sceneAsset?: AssetItem) {
  const characterBrief = describeCharactersForPrompt(shot.characters, characters);
  return [
    "根据角色身份板、场景参考和当前镜头，生成单镜头可精修首帧。",
    "输入参考：@[CHARACTER REF] 角色身份板 + @[SCENE REF] 场景卡 + 当前分镜文字。",
    `镜头：${shot.pictureDesc}`,
    `角色：${characterBrief || shot.characters.join("、") || "无角色"}`,
    `场景：${shot.scene}${sceneAsset ? `；场景卡：${compactPromptText(sceneAsset.description || sceneAsset.prompt)}` : ""}`,
    `动作：${shot.action || "轻微动作推进"}；情绪：${shot.emotion || "情绪推进"}`,
    `机位：${shot.shotSize}，${shot.cameraAngle}，${shot.cameraMovement}`,
    `站位/轴线：${shot.spatialRelation || "保持 screen-left / center / screen-right 清晰"}；连续性：${shot.orientation || "保持首尾帧方向稳定"}`,
    "输出单张首帧图，不要分格，不要字幕，不要说明字，不要水印；角色脸型、服装、发型和身体比例必须匹配角色身份板。"
  ].join("\n");
}

function buildCanvasSeedanceVideoPrompt(shot: StoryboardShot, storyboards: StoryboardShot[], characters: CharacterProfile[], roleAssets: AssetItem[]) {
  const storyboardBeats = storyboards.slice(0, 12).map((item, index) => `${index + 1}.${item.action || item.pictureDesc}`).join(" / ");
  const characterBrief = describeCharactersForPrompt(shot.characters, characters);
  const lockedRefs = roleAssets.filter((asset) => asset.referenceUrl && (asset.type === "role" || asset.type === "role_derivative" || asset.type === "role_reference")).length;
  return [
    "使用故事板参考 @[STORYBOARD REF] 作为视频的完整视觉和情感叙事来源。",
    "按照故事板从左到右、从上到下的节拍关系理解动作，不要重新解释动作、构图、镜头角度或情绪递进。",
    `当前片段：${formatShotNo(shot, Math.max(0, storyboards.findIndex((item) => item.id === shot.id)))}，时长 ${Math.min(15, Math.max(2, shot.duration || 4))} 秒。`,
    `角色参考：@[CHARACTER REF]，已锁定参考 ${lockedRefs} 张。保持与角色身份板相同的绝对核心主体身份：${characterBrief || shot.characters.join("、") || "场景主体"}。不要改变外貌、服装、神态特征和身体比例。`,
    `环境：${shot.scene}。画面：${shot.pictureDesc}`,
    `镜头语言：${shot.shotSize}，${shot.cameraAngle}，${shot.cameraMovement}。保持 ${shot.spatialRelation || "明确前中后景与左右站位"}。`,
    `动作流：${shot.action || "根据当前分镜执行连续自然动作"}。情绪/声音：${shot.emotion || "紧张推进"}；${shot.dialogue || shot.voiceOver || shot.environmentSound || shot.soundEffect || "无对白时保留环境声和动作节奏"}。`,
    `全局 12 节拍压缩参考：${storyboardBeats || "沿用故事板节拍"}`,
    "首帧锚点必须匹配当前首帧/故事板面板；尾帧锚点为动作完成后的清晰姿态，保留 0.5-1 秒稳定停顿，方便下一镜衔接。",
    "使用有冲击力但清晰的剪辑感、动作匹配、轻微推进或跟拍；不要让同一段里完成太多同步变化。",
    "避免项：不要字幕、不要标题字、不要解释字、不要水印、不要 Logo、不要站位互换、不要越轴、不要换脸、不要换装、不要生成九宫格视频。"
  ].join("\n");
}

function uniqueCharacterNames(storyboards: StoryboardShot[], characters: CharacterProfile[]) {
  const names = Array.from(new Set(storyboards.flatMap((shot) => shot.characters).filter(Boolean)));
  return names.length ? names : characters.slice(0, 4).map((character) => character.name);
}

function describeCharactersForPrompt(names: string[], characters: CharacterProfile[]) {
  return names
    .slice(0, 5)
    .map((name) => {
      const profile = characters.find((character) => character.name === name);
      if (!profile) return name;
      return `${profile.name}：${compactPromptText(profile.identity)}，${compactPromptText(profile.appearance)}，${compactPromptText(profile.costume)}`;
    })
    .join("；");
}

function compactPromptText(value?: string) {
  return (value || "待补充").replace(/\s+/g, " ").trim();
}

function isPlayableVideoUrl(url?: string) {
  return Boolean(url && /\.(mp4|webm|mov)(?:$|\?)/i.test(url));
}

function shotAspectClass(shot?: StoryboardShot) {
  const text = `${shot?.orientation ?? ""} ${shot?.pictureDesc ?? ""} ${shot?.imagePrompt ?? ""} ${shot?.videoPrompt ?? ""}`.toLowerCase();
  if (/9\s*:\s*16|portrait|vertical|竖屏|竖版|竖图/.test(text)) return "portrait";
  if (/1\s*:\s*1|square|方图|方形/.test(text)) return "square";
  if (/16\s*:\s*9|landscape|horizontal|横屏|横版|横图/.test(text)) return "landscape";
  return "landscape";
}

function shotFrameClass(base: string, shot?: StoryboardShot) {
  return `${base} shot-aspect-${shotAspectClass(shot)}`;
}

function formatShotNo(shot: StoryboardShot | undefined, index: number) {
  if (!shot) return `镜头 ${index + 1}`;
  return `第 ${shot.sceneNo || 1} 场 · 镜头 ${shot.shotNo || index + 1}`;
}

function uniqueSceneNames(storyboards: StoryboardShot[]) {
  return [...new Set(storyboards.map((shot) => shot.scene.trim()).filter(Boolean))];
}

function buildShotAssetMap(assets: AssetItem[], prefix: "image" | "video") {
  const map = new Map<string, AssetItem>();
  assets.forEach((asset) => {
    const normalized = asset.id.replace(new RegExp(`^${prefix}_`), "");
    map.set(normalized, asset);
  });
  return map;
}

function buildProductionSceneGroups(storyboards: StoryboardShot[]) {
  const groups = new Map<string, StoryboardShot[]>();
  storyboards.forEach((shot) => {
    const key = `${shot.episodeNo}-${shot.sceneNo}-${shot.scene || "未命名场景"}`;
    groups.set(key, [...(groups.get(key) ?? []), shot]);
  });
  return Array.from(groups.entries())
    .map(([id, shots]) => {
      const ordered = [...shots].sort((a, b) => a.shotNo - b.shotNo);
      const first = ordered[0];
      return {
        id,
        sceneNo: first?.sceneNo ?? 1,
        scene: first?.scene || "未命名场景",
        shots: ordered,
        duration: ordered.reduce((sum, shot) => sum + (shot.duration || 0), 0),
        characters: [...new Set(ordered.flatMap((shot) => shot.characters).filter(Boolean))]
      };
    })
    .sort((a, b) => a.sceneNo - b.sceneNo);
}

function findSceneAsset(scene: string | undefined, sceneAssets: AssetItem[]) {
  if (!scene) return undefined;
  const clean = scene.trim();
  return sceneAssets.find((asset) => asset.name === clean)
    ?? sceneAssets.find((asset) => clean.includes(asset.name) || asset.name.includes(clean));
}

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remain = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
}

function exportJobLabel(job: ExportJob) {
  if (job.outputKind === "mp4" || job.type === "video_export") return "MP4 成片";
  if (job.outputKind === "audio" || job.type === "tts") return "TTS 配音";
  if (job.outputKind === "subtitle" || job.type === "subtitle") return "字幕文件";
  if (job.outputKind === "diagnostic_bundle") return "诊断包";
  return "导出任务";
}

type ScriptSceneStatus = "locked" | "ready" | "risk" | "draft" | "blocked";

type ScriptSceneRow = {
  id: string;
  sceneNo: number;
  title: string;
  location: string;
  timeOfDay: string;
  duration: number;
  shots: number;
  characters: string[];
  status: ScriptSceneStatus;
  risk?: string;
  lines: string[];
  dialogue: string[];
  action: string;
  hook: string;
};

function buildScriptSceneRows(script: ScriptDraft | undefined, storyboards: StoryboardShot[]): ScriptSceneRow[] {
  if (storyboards.length) {
    const groups = new Map<string, StoryboardShot[]>();
    storyboards.forEach((shot) => {
      const key = `${shot.episodeNo}-${shot.sceneNo}-${shot.scene || "未命名场景"}`;
      groups.set(key, [...(groups.get(key) ?? []), shot]);
    });

    return Array.from(groups.values())
      .map((shots, index) => {
        const ordered = [...shots].sort((a, b) => a.shotNo - b.shotNo);
        const first = ordered[0];
        const dialogue = ordered.flatMap((shot) => [shot.dialogue, shot.voiceOver].filter(Boolean)).slice(0, 5);
        const characters = [...new Set(ordered.flatMap((shot) => shot.characters).filter(Boolean))];
        const duration = ordered.reduce((sum, shot) => sum + (shot.duration || 0), 0);
        const longDialogue = dialogue.find((line) => line.length > 42);
        const risk = !characters.length
          ? "角色未绑定"
          : longDialogue
            ? "台词偏长，建议拆镜"
            : duration > 48
              ? "场次偏长，建议加节拍"
              : undefined;
        return {
          id: `scene-${first.episodeNo}-${first.sceneNo}`,
          sceneNo: first.sceneNo || index + 1,
          title: first.scene || `场次 ${index + 1}`,
          location: inferLocation(first.scene),
          timeOfDay: inferSceneTime(first.scene, index),
          duration,
          shots: ordered.length,
          characters,
          status: risk ? "risk" : "ready",
          risk,
          lines: ordered.map((shot) => shot.pictureDesc).filter(Boolean).slice(0, 6),
          dialogue,
          action: ordered.map((shot) => shot.action || shot.cameraMovement || shot.pictureDesc).filter(Boolean).slice(0, 3).join(" / "),
          hook: [...ordered].reverse().find((shot) => shot.voiceOver || shot.dialogue || shot.emotion)?.voiceOver
            || [...ordered].reverse().find((shot) => shot.dialogue || shot.emotion)?.dialogue
            || ordered[ordered.length - 1]?.emotion
            || ""
        } satisfies ScriptSceneRow;
      })
      .sort((a, b) => a.sceneNo - b.sceneNo);
  }

  if (!script?.content?.trim()) return [];

  const chunks = splitScriptIntoSceneCandidates(script.content).slice(0, 12);
  return chunks.map((chunk, index) => {
    const title = inferScriptSceneTitle(chunk, index);
    const longLine = chunk.lines.find((line) => line.length > 58);
    return {
      id: `script-scene-${index + 1}`,
      sceneNo: index + 1,
      title,
      location: inferLocation(title),
      timeOfDay: inferSceneTime(title, index),
      duration: Math.max(35, Math.min(90, chunk.lines.join("").length)),
      shots: 0,
      characters: [],
      status: longLine ? "risk" : "draft",
      risk: longLine ? "段落偏长，生成分镜前建议拆场" : undefined,
      lines: chunk.lines.slice(0, 5),
      dialogue: chunk.lines.filter((line) => /[:：]|“|”|「|」/.test(line)).slice(0, 4),
      action: chunk.lines.find((line) => !/[:：]|“|”|「|」/.test(line)) ?? "",
      hook: chunk.lines[chunk.lines.length - 1] ?? ""
    } satisfies ScriptSceneRow;
  });
}

function splitScriptIntoSceneCandidates(content: string) {
  const rawBlocks = content
    .split(/\n{2,}|(?=第[一二三四五六七八九十0-9]+[场幕])|(?=【[^】]+】)/)
    .map((block) => block.trim())
    .filter(Boolean);
  const source = rawBlocks.length > 1 ? rawBlocks : content.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const chunks: Array<{ lines: string[] }> = [];
  for (let index = 0; index < source.length; index += rawBlocks.length > 1 ? 1 : 3) {
    chunks.push({ lines: source.slice(index, index + (rawBlocks.length > 1 ? 1 : 3)) });
  }
  return chunks;
}

function inferScriptSceneTitle(chunk: { lines: string[] }, index: number) {
  const first = chunk.lines[0] ?? "";
  const bracket = first.match(/【([^】]+)】/);
  if (bracket?.[1]) return bracket[1].slice(0, 18);
  const sceneMarker = first.match(/第[一二三四五六七八九十0-9]+[场幕][：:\s]*(.{0,18})/);
  if (sceneMarker?.[1]) return sceneMarker[1].trim() || `场次 ${index + 1}`;
  return first.slice(0, 14) || `场次 ${index + 1}`;
}

function inferLocation(scene: string) {
  const clean = scene.replace(/[【】]/g, "").trim();
  const parts = clean.split(/[·｜|、,， -]/).map((part) => part.trim()).filter(Boolean);
  return parts[0] || clean || "待定场景";
}

function inferSceneTime(scene: string, index: number) {
  if (/夜|晚|凌晨|黑/.test(scene)) return "夜晚";
  if (/雨|阴|雾/.test(scene)) return "雨天";
  if (/午|白天|日/.test(scene)) return "白天";
  return index % 3 === 0 ? "白天" : index % 3 === 1 ? "下午" : "夜晚";
}

function sceneStatusText(status: ScriptSceneStatus) {
  const labels: Record<ScriptSceneStatus, string> = {
    locked: "锁定",
    ready: "可拆镜",
    risk: "需复核",
    draft: "草稿",
    blocked: "阻塞"
  };
  return labels[status];
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}
