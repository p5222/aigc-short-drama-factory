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
  WandSparkles,
  X
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
  ShowcaseWork,
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
import { api } from "../lib/api";
import { ProductionWorkspace } from "../workbench/components/ProductionWorkspace";
import { WorkbenchHeader } from "../workbench/components/WorkbenchHeader";
import type { WorkbenchStage, WorkbenchTheme } from "../workbench/model";
import {
  buildTimelineClipLayout,
  collectEpisodeNumbers,
  filterSceneRows,
  resolveSceneSelection,
  type SceneListFilter
} from "./projectWorkbenchModel";
import "./ProjectStudioV4.css";

interface ProjectWorkbenchPageProps {
  workflow?: ProjectWorkflow;
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  theme: WorkbenchTheme;
  onThemeChange: (theme: WorkbenchTheme) => void;
  onBack: () => void;
  onRefresh: (projectId: string) => void | Promise<void>;
}

type ShotWorkspaceView = "director" | "matrix";
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

export function ProjectWorkbenchPage({ workflow, providers, modelPrices, theme, onThemeChange, onBack, onRefresh }: ProjectWorkbenchPageProps) {
  const [activeTab, setActiveTab] = useState<WorkbenchStage>("content");
  const [shotWorkspaceView, setShotWorkspaceView] = useState<ShotWorkspaceView>("director");
  const [railOpen, setRailOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [operation, setOperation] = useState<OperationState>(null);
  const [operationElapsed, setOperationElapsed] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
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

  const { project, script, characters, storyboards } = workflow;
  const assets = workflow.assets ?? [];
  const roleAssets = assets.filter((asset) => asset.type === "role" || asset.type === "role_derivative" || asset.type === "role_reference");
  const sceneAssets = assets.filter((asset) => asset.type === "scene" || asset.type === "prop");
  const qualityReports = workflow.qualityReports ?? [];
  const feedbacks = workflow.feedbacks ?? [];
  const primaryRoleAssets = assets.filter((asset) => asset.type === "role" && asset.referenceUrl);
  const imageAssets = assets.filter((asset) => asset.type === "image");
  const videoAssets = assets.filter((asset) => asset.type === "video");
  const completedImages = imageAssets.filter((asset) => asset.referenceUrl && asset.status === "succeeded").length;
  const completedVideos = videoAssets.filter((asset) => isPlayableVideoUrl(asset.referenceUrl)).length;
  const completedRoleRefs = countCompletedCharacterSheets(characters, roleAssets);
  const pipelineSteps = [
    { id: "content" as const, label: "内容", detail: "大纲 / 分集 / 剧本", done: Boolean(script) },
    { id: "assets" as const, label: "资产", detail: "角色 / 场景 / 道具", done: characters.length === 0 || completedRoleRefs >= characters.length },
    { id: "shots" as const, label: "分镜", detail: "脚本 / 首帧 / 视频", done: storyboards.length > 0 && completedImages >= storyboards.length },
    { id: "delivery" as const, label: "成片", detail: "配音 / 字幕 / 导出", done: storyboards.length > 0 && completedVideos > 0 }
  ];

  function beginOperation(key: OperationKey, title: string, detail: string) {
    setOperation({ key, title, detail, startedAt: Date.now() });
    setOperationElapsed(0);
    setMessage("");
    setError("");
  }

  async function runWorkflowAction(actionId: NextAction["id"]) {
    if (actionId === "script" || actionId === "done") return;
    if (`${actionId}` === "image") {
      setActiveTab("shots");
      setShotWorkspaceView("director");
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
        setActiveTab("assets");
      }
      if (actionId === "storyboard") {
        beginOperation("storyboard", "分镜拆解中", "正在把剧本拆成镜头级清单。");
        const result = await api.generateStoryboards(project.id, { artStyle: project.artStyle, videoRatio: project.videoRatio });
        setMessage(`分镜拆解已提交，新增 ${result.assetsCreated ?? 0} 条记录。`);
        setActiveTab("shots");
        setShotWorkspaceView("matrix");
      }
      if (actionId === "image") {
        beginOperation("images", "分镜图生成中", "正在按未出图镜头补齐首帧图。");
        const result = await api.generateImages(project.id);
        setMessage(`分镜图任务已提交，新增 ${result.assetsCreated ?? 0} 个资产。`);
        setActiveTab("shots");
        setShotWorkspaceView("director");
      }
      if (actionId === "video") {
        beginOperation("video", "视频片段生成中", "正在把已确认分镜图提交给视频模型。");
        const result = await api.generateVideos(project.id);
        setMessage(`视频任务已提交，新增 ${result.assetsCreated ?? 0} 个资产。`);
        setActiveTab("delivery");
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
      throw err;
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
    <div className="wb-shell project-workbench" data-theme={theme}>
      <WorkbenchHeader
        projectName={project.name}
        projectMeta={`第 1 集 · ${project.videoRatio}`}
        stages={pipelineSteps}
        activeStage={activeTab}
        saveState="unchanged"
        theme={theme}
        onBack={onBack}
        onStageChange={setActiveTab}
        onThemeChange={onThemeChange}
        onRefresh={() => void refreshProject()}
        onOpenRail={() => {
          setInspectorOpen(false);
          setRailOpen(true);
        }}
        onOpenInspector={() => {
          setRailOpen(false);
          setInspectorOpen(true);
        }}
      />
      <ProductionWorkspace
        rail={(
          <div className="wb-rail-summary">
            <h2 className="wb-region-heading">{pipelineSteps.find((step) => step.id === activeTab)?.label}</h2>
            <p className="wb-region-copy">{pipelineSteps.find((step) => step.id === activeTab)?.detail}</p>
            <dl className="wb-summary-list">
              <div><dt>剧集</dt><dd>{project.episodes}</dd></div>
              <div><dt>角色</dt><dd>{characters.length}</dd></div>
              <div><dt>镜头</dt><dd>{storyboards.length}</dd></div>
              <div><dt>画幅</dt><dd>{project.videoRatio}</dd></div>
            </dl>
          </div>
        )}
        canvas={(
          <div className="wb-canvas__legacy">
            {operation ? <InlineProgress operation={operation} elapsed={operationElapsed} /> : null}
            {message ? <p className="success-text studio-v4-message">{message}</p> : null}
            {error ? <p className="danger-text studio-v4-message">{error}</p> : null}
            {activeTab === "content" ? <ScriptBoard script={script} characters={characters} storyboards={storyboards} episodeCount={project.episodes} isBusy={isBusy} onOpenCharacters={() => setActiveTab("assets")} onGenerateStoryboards={() => void runWorkflowAction("storyboard")} /> : null}
            {activeTab === "assets" ? <CreatorCharacterBoard project={project} providers={providers} modelPrices={modelPrices} characters={characters} roleAssets={roleAssets} sceneAssets={sceneAssets} qualityReports={qualityReports} feedbacks={feedbacks} isBusy={isBusy} onRefresh={refreshProject} onSaveModelRoutes={saveModelRoutes} onPreview={setPreviewImage} /> : null}
            {activeTab === "shots" ? (
              <div className="studio-v4-shots-stage">
                <div className="studio-v4-view-switch" role="tablist" aria-label="分镜视图">
                  <button className={shotWorkspaceView === "director" ? "active" : ""} type="button" onClick={() => setShotWorkspaceView("director")}><Film size={16} />单镜头</button>
                  <button className={shotWorkspaceView === "matrix" ? "active" : ""} type="button" onClick={() => setShotWorkspaceView("matrix")}><Images size={16} />故事板矩阵</button>
                  <span>在同一阶段完成脚本、首帧、候选版本与视频检查</span>
                </div>
                {shotWorkspaceView === "director"
                  ? <CreatorImagesBoard project={project} providers={providers} modelPrices={modelPrices} storyboards={storyboards} characters={characters} roleAssets={roleAssets} sceneAssets={sceneAssets} imageAssets={imageAssets} qualityReports={qualityReports} feedbacks={feedbacks} isBusy={isBusy} onRefresh={refreshProject} onSaveModelRoutes={saveModelRoutes} onPreview={setPreviewImage} />
                  : <DesignDeskBoard storyboards={storyboards} characters={characters} roleAssets={roleAssets} sceneAssets={sceneAssets} imageAssets={imageAssets} videoAssets={videoAssets} productionPackage={productionPackage} isBusy={isBusy} onGenerate={() => void runWorkflowAction("storyboard")} onOpenDirector={() => setShotWorkspaceView("director")} onOpenVideo={() => setActiveTab("delivery")} onPreview={setPreviewImage} />}
              </div>
            ) : null}
            {activeTab === "delivery" ? <VideoBoard project={project} providers={providers} modelPrices={modelPrices} storyboards={storyboards} characters={characters} roleAssets={roleAssets} imageAssets={imageAssets} videoAssets={videoAssets} exportJobs={exportJobs} isBusy={isBusy} onGenerate={() => void runWorkflowAction("video")} onCreateExport={createExport} onRefresh={refreshProject} onSaveModelRoutes={saveModelRoutes} onPublish={() => setPublishOpen(true)} /> : null}
          </div>
        )}
        inspector={(
          <div className="wb-inspector-content">
            <h2 className="wb-region-heading">项目设置</h2>
            <p className="wb-region-copy">生成前修改会同时更新项目默认模型。</p>
            <details className="project-route-drawer workbench-route-popover">
              <summary>
                <span><SlidersHorizontal size={16} />项目默认模型</span>
                <small>{project.imageModel || project.textModel || "按项目默认"}</small>
              </summary>
              <ProjectRouteSwitcher project={project} providers={providers} onSave={saveModelRoutes} />
            </details>
          </div>
        )}
        railOpen={railOpen}
        inspectorOpen={inspectorOpen}
        onCloseRail={() => setRailOpen(false)}
        onCloseInspector={() => setInspectorOpen(false)}
      />
      {publishOpen ? <ShowcasePublishModal project={project} storyboards={storyboards} imageAssets={imageAssets} videoAssets={videoAssets} exportJobs={exportJobs} onClose={() => setPublishOpen(false)} /> : null}
      {previewImage ? <ImagePreviewModal preview={previewImage} onClose={() => setPreviewImage(null)} /> : null}
    </div>
  );
}

function ScriptBoard({ script, characters, storyboards, episodeCount, isBusy, onOpenCharacters, onGenerateStoryboards }: { script?: ScriptDraft; characters: CharacterProfile[]; storyboards: StoryboardShot[]; episodeCount: number; isBusy: boolean; onOpenCharacters: () => void; onGenerateStoryboards: () => void }) {
  const [sceneFilter, setSceneFilter] = useState<SceneListFilter>("all");
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const sceneRows = useMemo(() => buildScriptSceneRows(script, storyboards), [script, storyboards]);
  const episodeNumbers = useMemo(() => collectEpisodeNumbers(storyboards, episodeCount), [episodeCount, storyboards]);
  const [activeEpisode, setActiveEpisode] = useState(episodeNumbers[0] ?? 1);
  const episodeScenes = sceneRows.filter((scene) => scene.episodeNo === activeEpisode);
  const { visibleRows: filteredScenes, selectedId: resolvedSceneId } = resolveSceneSelection(sceneRows, activeEpisode, sceneFilter, selectedSceneId);
  const selectedScene = sceneRows.find((scene) => scene.id === resolvedSceneId);
  const longDialogueCount = episodeScenes.filter((scene) => scene.risk?.includes("台词")).length;
  const readySceneCount = episodeScenes.filter((scene) => scene.status === "ready" || scene.status === "locked").length;
  const totalDuration = episodeScenes.reduce((sum, scene) => sum + scene.duration, 0);
  const riskSceneCount = episodeScenes.filter((scene) => scene.risk).length;
  const preflightItems = [
    { label: "剧本可读", done: Boolean(script), detail: script ? "正文与梗概已生成" : "等待剧本生成" },
    { label: "场次清晰", done: episodeScenes.length > 0, detail: episodeScenes.length ? `本集 ${episodeScenes.length} 个场次` : "尚未拆出场次" },
    { label: "角色已抽取", done: characters.length > 0, detail: `${characters.length} 个角色候选` },
    { label: "台词可拆镜", done: longDialogueCount === 0, detail: longDialogueCount ? `${longDialogueCount} 场疑似长台词` : "无明显长台词风险" }
  ];

  useEffect(() => {
    if (!episodeNumbers.includes(activeEpisode)) setActiveEpisode(episodeNumbers[0] ?? 1);
  }, [activeEpisode, episodeNumbers]);

  useEffect(() => {
    if (selectedSceneId !== resolvedSceneId) setSelectedSceneId(resolvedSceneId);
  }, [resolvedSceneId, selectedSceneId]);

  function requestStoryboardGeneration() {
    if (storyboards.length > 0 && !window.confirm("重建分镜表会覆盖现有分镜、分镜图和视频草稿，确认继续？")) return;
    onGenerateStoryboards();
  }

  return (
    <section className="panel script-review-board preworkbench-board script-scene-workbench">
      <div className="panel-head script-scene-head">
        <div>
          <h2>内容策划工作台</h2>
          <small>在一个阶段完成大纲、分集和剧本分场，确认当前集后再进入资产准备。</small>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={onOpenCharacters} disabled={!script}><UserRound size={16} />角色场景</button>
          <button className="primary-button" onClick={requestStoryboardGeneration} disabled={!script || isBusy}>
            <BookOpenCheck size={18} />{storyboards.length > 0 ? "重建分镜表" : "生成分镜表"}
          </button>
        </div>
      </div>

      <div className="script-episode-bar" aria-label="剧集选择">
        <div><strong>剧集</strong><span>先选集，再处理该集场次</span></div>
        <div>
          {episodeNumbers.map((episodeNo) => {
            const count = sceneRows.filter((scene) => scene.episodeNo === episodeNo).length;
            return <button className={activeEpisode === episodeNo ? "active" : ""} key={episodeNo} onClick={() => { setActiveEpisode(episodeNo); setSelectedSceneId(""); }} type="button"><strong>第 {episodeNo} 集</strong><small>{count} 场</small></button>;
          })}
        </div>
      </div>

      <div className="script-scene-layout">
        <aside className="script-scene-nav">
          <div className="script-scene-section-head">
            <div>
              <h3>剧集与场次</h3>
              <small>第 {activeEpisode} 集 · {episodeScenes.length} 场 · 预计 {Math.max(totalDuration, 1)} 秒</small>
            </div>
            <ListChecks size={17} />
          </div>
          <div className="script-scene-filter-row">
            {[
              ["all", "全部", episodeScenes.length],
              ["draft", "未确认", filterSceneRows(sceneRows, activeEpisode, "draft").length],
              ["risk", "有风险", riskSceneCount],
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
          <div className="script-editor-heading">
            <div><FileText size={16} /><strong>第 {activeEpisode} 集剧本</strong></div>
            <span>{selectedScene ? `场 ${selectedScene.sceneNo}` : "未选择场次"}</span>
          </div>
          <section className="script-synopsis-panel">
            <div>
              <span>剧情梗概</span>
              <p>{script?.synopsis || "暂无梗概，请先等待剧本生成任务完成。"}</p>
            </div>
            <dl>
              <div><dt>当前集</dt><dd>第 {activeEpisode} 集</dd></div>
              <div><dt>场次</dt><dd>{episodeScenes.length || "-"}</dd></div>
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
            </section>
          ) : (
            <div className="empty-state">暂无剧本内容，请先完成剧本生成。</div>
          )}
        </main>

        <aside className="script-preflight-panel script-context-panel">
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
          <section className="script-episode-summary">
            <h3>本集概览</h3>
            <dl>
              <div><dt>角色</dt><dd>{characters.length}</dd></div>
              <div><dt>场次</dt><dd>{episodeScenes.length}</dd></div>
              <div><dt>风险</dt><dd>{riskSceneCount}</dd></div>
              <div><dt>镜头</dt><dd>{episodeScenes.reduce((sum, scene) => sum + scene.shots, 0) || "待拆"}</dd></div>
            </dl>
            {episodeScenes.find((scene) => scene.risk) ? <p><AlertTriangle size={14} />{episodeScenes.find((scene) => scene.risk)?.title}：{episodeScenes.find((scene) => scene.risk)?.risk}</p> : <p><CheckCircle2 size={14} />当前集暂无明显连续性风险。</p>}
          </section>
          <button className="primary-button full-button" onClick={requestStoryboardGeneration} disabled={!script || isBusy} type="button">
            <WandSparkles size={18} />{storyboards.length > 0 ? "重建分镜表" : "生成分镜表"}
          </button>
        </aside>
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

function CreatorCharacterBoard({
  project,
  providers,
  modelPrices,
  characters,
  roleAssets,
  sceneAssets,
  qualityReports,
  feedbacks,
  isBusy,
  onRefresh,
  onSaveModelRoutes,
  onPreview
}: {
  project: Project;
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  characters: CharacterProfile[];
  roleAssets: AssetItem[];
  sceneAssets: AssetItem[];
  qualityReports: QualityReport[];
  feedbacks: UserFeedback[];
  isBusy: boolean;
  onRefresh: () => void | Promise<void>;
  onSaveModelRoutes: (routes: Partial<Pick<Project, "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">>) => void | Promise<void>;
  onPreview: (preview: { url: string; title: string }) => void;
}) {
  const projectId = project.id;
  const [referenceInputs, setReferenceInputs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [localMessage, setLocalMessage] = useState("");
  const [assetMode, setAssetMode] = useState<"character" | "scene">(characters.length ? "character" : "scene");
  const [activeCharacterId, setActiveCharacterId] = useState(characters[0]?.id ?? "");
  const [activeSceneId, setActiveSceneId] = useState(sceneAssets[0]?.id ?? "");
  const [generatingId, setGeneratingId] = useState("");
  const latestReport = latestStageReport(qualityReports, "character");
  const characterFeedback = feedbacks.filter((item) => item.stage === "character");
  const lockedRoleCount = countCompletedCharacterSheets(characters, roleAssets);
  const lockedSceneCount = sceneAssets.filter((asset) => Boolean(asset.referenceUrl)).length;
  const activeCharacter = characters.find((character) => character.id === activeCharacterId) ?? characters[0];
  const activeIdentityAsset = activeCharacter ? resolveCharacterIdentityAsset(activeCharacter, roleAssets) : undefined;
  const activeReferenceAssets = activeCharacter ? roleAssets.filter((asset) => asset.type === "role_reference" && asset.relatedCharacterId === activeCharacter.id && asset.referenceUrl) : [];
  const activeSceneAsset = sceneAssets.find((asset) => asset.id === activeSceneId) ?? sceneAssets[0];

  useEffect(() => {
    setActiveCharacterId((current) => current && characters.some((character) => character.id === current) ? current : characters[0]?.id ?? "");
    setActiveSceneId((current) => current && sceneAssets.some((asset) => asset.id === current) ? current : sceneAssets[0]?.id ?? "");
    if (!characters.length && sceneAssets.length) setAssetMode("scene");
  }, [characters, sceneAssets]);

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

  async function generateCharacter(character: CharacterProfile) {
    setGeneratingId(character.id);
    setLocalMessage("");
    try {
      const result = await api.generateCharacterImages(projectId, { characterIds: [character.id], forceRegenerate: Boolean(resolveCharacterIdentityAsset(character, roleAssets)?.referenceUrl) });
      setLocalMessage(result.assetsCreated ? `${character.name} 身份板已生成。` : `${character.name} 已有可用身份板。`);
      await onRefresh();
    } finally {
      setGeneratingId("");
    }
  }

  async function generateScene(asset: AssetItem) {
    setGeneratingId(asset.id);
    setLocalMessage("");
    try {
      await api.generateSceneImage(projectId, asset.id);
      setLocalMessage(`${asset.name} 场景图已生成，并会自动进入分镜参考。`);
      await onRefresh();
    } finally {
      setGeneratingId("");
    }
  }

  return (
    <section className="panel creator-character-workbench asset-lock-workbench preworkbench-board">
      <div className="panel-head">
        <div>
          <h2>角色与场景资产</h2>
          <small>左侧选择资产，中间检查定稿，右侧完成模型选择、参考图与生成。</small>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={() => void runEvaluation()} disabled={evaluating || !characters.length}>{evaluating ? <Loader2 size={16} className="spin-icon" /> : <BookOpenCheck size={16} />}离线评测</button>
          <span className="asset-ready-count">角色 {lockedRoleCount}/{characters.length} · 场景 {lockedSceneCount}/{sceneAssets.length}</span>
        </div>
      </div>

      {localMessage ? <p className="success-text">{localMessage}</p> : null}

      <div className="asset-library-layout">
        <aside className="asset-library-rail">
          <div className="asset-library-tabs">
            <button className={assetMode === "character" ? "active" : ""} onClick={() => setAssetMode("character")} type="button"><UserRound size={15} />角色 <span>{characters.length}</span></button>
            <button className={assetMode === "scene" ? "active" : ""} onClick={() => setAssetMode("scene")} type="button"><MapPin size={15} />场景 <span>{sceneAssets.length}</span></button>
          </div>
          <div className="asset-library-list">
            {assetMode === "character" ? characters.map((character) => {
              const identity = resolveCharacterIdentityAsset(character, roleAssets);
              return <button className={activeCharacter?.id === character.id ? "active" : ""} key={character.id} onClick={() => setActiveCharacterId(character.id)} type="button"><span>{identity?.referenceUrl ? <StableImage src={identity.referenceUrl} alt={character.name} /> : <UserRound size={18} />}</span><div><strong>{character.name}</strong><small>{character.identity}</small></div><em>{identity?.referenceUrl ? "已定稿" : "待生成"}</em></button>;
            }) : sceneAssets.map((asset) => <button className={activeSceneAsset?.id === asset.id ? "active" : ""} key={asset.id} onClick={() => setActiveSceneId(asset.id)} type="button"><span>{asset.referenceUrl ? <StableImage src={asset.referenceUrl} alt={asset.name} /> : <Images size={18} />}</span><div><strong>{asset.name}</strong><small>{asset.type === "prop" ? "道具" : "环境场景"}</small></div><em>{asset.referenceUrl ? "已出图" : "待生成"}</em></button>)}
            {assetMode === "character" && !characters.length ? <div className="empty-state">暂无角色，请先生成剧本。</div> : null}
            {assetMode === "scene" && !sceneAssets.length ? <div className="empty-state">暂无场景，先生成分镜表。</div> : null}
          </div>
        </aside>

        <main className="asset-detail-canvas">
          {assetMode === "character" && activeCharacter ? <>
            <button className={activeIdentityAsset?.referenceUrl ? "asset-detail-preview ready" : "asset-detail-preview"} type="button" onClick={() => activeIdentityAsset?.referenceUrl && onPreview({ url: activeIdentityAsset.referenceUrl, title: activeCharacter.name })}>
              {activeIdentityAsset?.referenceUrl ? <StableImage src={activeIdentityAsset.referenceUrl} alt={activeCharacter.name} /> : <><UserRound size={42} /><strong>角色身份板待生成</strong></>}
            </button>
            <div className="asset-detail-copy"><span>{activeIdentityAsset?.referenceUrl ? "身份板已锁定" : "待生成身份板"}</span><h3>{activeCharacter.name}</h3><p>{activeCharacter.identity}</p><dl><div><dt>外观</dt><dd>{activeCharacter.appearance}</dd></div><div><dt>服装</dt><dd>{activeCharacter.costume}</dd></div><div><dt>性格</dt><dd>{activeCharacter.personality}</dd></div></dl></div>
          </> : null}
          {assetMode === "scene" && activeSceneAsset ? <>
            <button className={activeSceneAsset.referenceUrl ? "asset-detail-preview ready" : "asset-detail-preview"} type="button" onClick={() => activeSceneAsset.referenceUrl && onPreview({ url: activeSceneAsset.referenceUrl, title: activeSceneAsset.name })}>
              {activeSceneAsset.referenceUrl ? <StableImage src={activeSceneAsset.referenceUrl} alt={activeSceneAsset.name} /> : <><MapPin size={42} /><strong>场景概念图待生成</strong></>}
            </button>
            <div className="asset-detail-copy"><span>{activeSceneAsset.referenceUrl ? "场景图已锁定" : "文本场景已就绪"}</span><h3>{activeSceneAsset.name}</h3><p>{activeSceneAsset.description || "等待场景描述"}</p><dl><div><dt>资产类型</dt><dd>{activeSceneAsset.type === "prop" ? "关键道具" : "环境场景"}</dd></div><div><dt>用途</dt><dd>分镜首帧与视频空间一致性参考</dd></div></dl></div>
          </> : null}
          {!activeCharacter && !activeSceneAsset ? <div className="empty-state">暂无可编辑资产。</div> : null}
        </main>

        <aside className="asset-action-panel">
          <ImageRoutePicker
            project={project}
            providers={providers}
            modelPrices={modelPrices}
            onSave={onSaveModelRoutes}
            actionLabel={assetMode === "character" ? (activeIdentityAsset?.referenceUrl ? "应用模型并重新生成身份板" : "应用模型并生成身份板") : (activeSceneAsset?.referenceUrl ? "应用模型并重新生成场景图" : "应用模型并生成场景图")}
            onAction={assetMode === "character" && activeCharacter ? () => generateCharacter(activeCharacter) : assetMode === "scene" && activeSceneAsset ? () => generateScene(activeSceneAsset) : undefined}
            actionDisabled={isBusy || Boolean(generatingId)}
          />
          {assetMode === "character" && activeCharacter ? <section>
            <div className="asset-action-title"><strong>参考与生成</strong><small>{activeReferenceAssets.length} 张参考图</small></div>
            <div className="reference-thumb-row">{activeReferenceAssets.map((asset) => <button key={asset.id} type="button" onClick={() => asset.referenceUrl && onPreview({ url: asset.referenceUrl, title: asset.name })}><StableImage src={asset.referenceUrl!} alt={asset.name} /></button>)}{!activeReferenceAssets.length ? <span className="reference-empty">上传脸型、服装或风格参考</span> : null}</div>
            <div className="reference-url-row compact"><input value={referenceInputs[activeCharacter.id] ?? ""} onChange={(event) => setReferenceInputs((current) => ({ ...current, [activeCharacter.id]: event.target.value }))} placeholder="粘贴图片 URL" /><button className="icon-button" title="保存参考" type="button" onClick={() => void saveReference(activeCharacter, referenceInputs[activeCharacter.id] ?? "")} disabled={savingId === activeCharacter.id || !referenceInputs[activeCharacter.id]?.trim()}><Save size={16} /></button></div>
            <div className="inline-actions"><label className="ghost-button avatar-upload-button"><Upload size={16} />上传参考<input type="file" accept="image/*" onChange={(event) => void uploadReference(activeCharacter, event)} disabled={savingId === activeCharacter.id} /></label><button className="icon-button danger-ghost" title="清空参考" onClick={() => void clearReferences(activeCharacter)} disabled={savingId === activeCharacter.id || !activeReferenceAssets.length}><Trash2 size={16} /></button></div>
          </section> : null}
          {assetMode === "scene" && activeSceneAsset ? <section>
            <div className="asset-action-title"><strong>生成场景环境</strong><small>16:9 · 无人物</small></div>
            <p className="asset-action-note">使用当前项目模型生成环境概念图，成功后按一张图片计费，并自动提供给后续分镜。</p>
          </section> : null}
          <QualityReportCard report={latestReport} emptyTitle="尚未评测" emptyText="生成资产后可运行离线评测。" />
        </aside>
      </div>

      <FeedbackComposer projectId={projectId} stage="character" recentCount={characterFeedback.length} onSubmitted={onRefresh} />
    </section>
  );
}

function CreatorImagesBoard({
  project,
  providers,
  modelPrices,
  storyboards,
  characters,
  roleAssets,
  sceneAssets,
  imageAssets,
  qualityReports,
  feedbacks,
  isBusy,
  onRefresh,
  onSaveModelRoutes,
  onPreview
}: {
  project: Project;
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  storyboards: StoryboardShot[];
  characters: CharacterProfile[];
  roleAssets: AssetItem[];
  sceneAssets: AssetItem[];
  imageAssets: AssetItem[];
  qualityReports: QualityReport[];
  feedbacks: UserFeedback[];
  isBusy: boolean;
  onRefresh: () => void | Promise<void>;
  onSaveModelRoutes: (routes: Partial<Pick<Project, "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">>) => void | Promise<void>;
  onPreview: (preview: { url: string; title: string }) => void;
}) {
  const projectId = project.id;
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
        </div>
      </div>

      <div className="director-generation-setup">
        <ImageRoutePicker
          project={project}
          providers={providers}
          modelPrices={modelPrices}
          quantity={Math.max(1, selectedIds.length || (activeShot ? 1 : 0))}
          onSave={onSaveModelRoutes}
          actionLabel={selectedIds.length ? `应用模型并生成 ${selectedIds.length} 个镜头` : "应用模型并生成当前镜头"}
          onAction={generateSelected}
          actionDisabled={isBusy || Boolean(working) || (!selectedIds.length && !activeShot)}
          secondaryLabel={`应用模型并生成全部待生成（${pendingShotIds.length}）`}
          onSecondaryAction={generatePending}
          secondaryDisabled={isBusy || Boolean(working) || !pendingShotIds.length}
        />
        <div>
          <span>{selectedIds.length ? `已选 ${selectedIds.length} 个镜头` : activeShot ? `当前 ${formatShotNo(activeShot, Math.max(0, activeShotIndex))}` : "未选择镜头"}</span>
        </div>
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

        </main>

        <aside className="director-settings-panel">
          <div className="director-settings-heading"><strong>镜头参数</strong><small>修改后保存并重新生成</small></div>
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
          <h2>故事板矩阵</h2>
          <small>按场次批量检查镜头、首帧与视频状态；精修时切回同一阶段的单镜头视图。</small>
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

function VideoBoard({ project, providers, modelPrices, storyboards, characters, roleAssets, imageAssets, videoAssets, exportJobs, isBusy, onGenerate, onCreateExport, onRefresh, onSaveModelRoutes, onPublish }: { project: Project; providers: ModelProvider[]; modelPrices: ModelPrice[]; storyboards: StoryboardShot[]; characters: CharacterProfile[]; roleAssets: AssetItem[]; imageAssets: AssetItem[]; videoAssets: AssetItem[]; exportJobs: ExportJob[]; isBusy: boolean; onGenerate: () => void; onCreateExport: (type: "tts" | "subtitle" | "video_export") => void; onRefresh: () => void | Promise<void>; onSaveModelRoutes: (routes: Partial<Pick<Project, "textProvider" | "textModel" | "imageProvider" | "imageModel" | "imageSize" | "imageQuality" | "videoProvider" | "videoModel">>) => void | Promise<void>; onPublish: () => void }) {
  const projectId = project.id;
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
  const publishableExport = exportJobs.find((job) => job.status === "succeeded" && isPlayableVideoUrl(job.outputUrl));
  const audioJob = exportJobs.find((job) => job.audioUrl || job.outputKind === "audio" || job.type === "tts");
  const subtitleJob = exportJobs.find((job) => job.subtitleUrl || job.outputKind === "subtitle" || job.type === "subtitle");
  const activeShot = storyboards.find((shot) => shot.id === activeShotId) ?? storyboards[0];
  const activeIndex = activeShot ? storyboards.findIndex((shot) => shot.id === activeShot.id) : -1;
  const activeImage = activeShot ? imageAssetByShotId.get(activeShot.id) : undefined;
  const activeVideo = activeShot ? videoAssetByShotId.get(activeShot.id) : undefined;
  const activeVideoUrl = isPlayableVideoUrl(activeVideo?.referenceUrl) ? activeVideo!.referenceUrl! : "";
  const activeSeedancePrompt = activeShot ? buildCanvasSeedanceVideoPrompt(activeShot, storyboards, characters, roleAssets) : "";
  const totalDuration = Math.max(1, storyboards.reduce((sum, shot) => sum + (shot.duration || 0), 0));
  const pendingVideoSeconds = storyboards
    .filter((shot) => !isPlayableVideoUrl(videoAssetByShotId.get(shot.id)?.referenceUrl))
    .reduce((sum, shot) => sum + Math.max(1, shot.duration || 1), 0);
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
          <h2>成片组装与导出</h2>
          <small>补齐镜头片段后集中处理配音、字幕、封面与 MP4。当前首帧 {imageAssets.length}/{storyboards.length}，可播放视频 {playableVideoCount}/{storyboards.length}。</small>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={() => void onRefresh()}><RefreshCw size={18} />刷新状态</button>
          <button className="ghost-button" onClick={onPublish} disabled={!playableVideoCount && !publishableExport}><Upload size={18} />发布到创作现场</button>
          <button className="primary-button export-primary-button" onClick={() => void onCreateExport("video_export")} disabled={isBusy || !playableVideoCount}><Download size={18} />导出 MP4</button>
        </div>
      </div>

      <div className="video-assembly-summary">
        <span><strong>{playableVideoCount}/{storyboards.length}</strong> 视频片段</span>
        <span><strong>{audioJob?.status === "succeeded" || audioJob?.audioUrl ? "已完成" : "待生成"}</strong> 配音</span>
        <span><strong>{subtitleJob?.status === "succeeded" || subtitleJob?.subtitleUrl ? "已完成" : "待生成"}</strong> 字幕</span>
        <span><strong>{formatClock(totalDuration)}</strong> 总时长</span>
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
          <CanvasPromptCard title="Seedance 2.0 当前视频提示词" hint="输入角色身份板、场景和首帧，自动组织动作与机位。" prompt={activeSeedancePrompt} compact />
        </main>

        <aside className="video-export-inspector">
          <VideoRoutePicker project={project} providers={providers} modelPrices={modelPrices} totalSeconds={pendingVideoSeconds} onSave={onSaveModelRoutes} onGenerate={onGenerate} disabled={isBusy || !imageAssets.length || pendingVideoSeconds <= 0} />
          <section className={hasWarnings ? "export-check-card warn compact" : "export-check-card ready compact"}><div><AlertTriangle size={17} /><strong>{hasWarnings ? "存在待处理问题" : "导出检查通过"}</strong></div></section>
          <section className="export-settings-card">
            <h3>输出设置</h3>
            <label><span>输出比例</span><select defaultValue="9:16"><option>9:16</option><option>16:9</option><option>1:1</option></select></label>
            <label><span>帧率</span><select defaultValue="24"><option value="24">24 fps</option><option value="30">30 fps</option></select></label>
            <label><span>文件名</span><input defaultValue="manjiao_final_v1.mp4" /></label>
          </section>
          <section className="cover-frame-card">
            <h3>封面</h3>
            <button type="button">
              {activeImage?.referenceUrl ? <StableImage src={activeImage.referenceUrl} alt={activeImage.name} /> : <Images size={20} />}
            </button>
          </section>
          <section className="export-task-stack">
            <h3>配音与字幕</h3>
            <button className="ghost-button" onClick={() => void onCreateExport("tts")} disabled={isBusy}><Download size={16} />生成配音</button>
            <button className="ghost-button" onClick={() => void onCreateExport("subtitle")} disabled={isBusy}><Download size={16} />生成字幕</button>
            <button className="primary-button" onClick={() => void onCreateExport("video_export")} disabled={isBusy || !playableVideoCount}><Download size={16} />合成并导出 MP4</button>
            {latestMp4?.status === "succeeded" ? <button className="ghost-button" onClick={() => void downloadJob(latestMp4)}><Download size={16} />下载最新成片</button> : null}
          </section>
        </aside>
      </div>

      <VideoTimelineTracks storyboards={storyboards} imageAssetByShotId={imageAssetByShotId} videoAssetByShotId={videoAssetByShotId} activeShotId={activeShot?.id} onSelect={setActiveShotId} />

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

function ShowcasePublishModal({
  project,
  storyboards,
  imageAssets,
  videoAssets,
  exportJobs,
  onClose
}: {
  project: Project;
  storyboards: StoryboardShot[];
  imageAssets: AssetItem[];
  videoAssets: AssetItem[];
  exportJobs: ExportJob[];
  onClose: () => void;
}) {
  const imageByShotId = useMemo(() => buildShotAssetMap(imageAssets, "image"), [imageAssets]);
  const videoByShotId = useMemo(() => buildShotAssetMap(videoAssets, "video"), [videoAssets]);
  const candidates = useMemo<Array<{ id: string; label: string; sourceAssetId?: string; videoUrl: string; coverUrl: string; durationLabel: string }>>(() => {
    const clipCandidates = storyboards.flatMap((shot, index) => {
      const asset = videoByShotId.get(shot.id);
      if (!asset?.referenceUrl || !isPlayableVideoUrl(asset.referenceUrl)) return [];
      return [{
        id: `asset:${asset.id}`,
        label: `${formatShotNo(shot, index)} · ${shot.pictureDesc.slice(0, 24)}`,
        sourceAssetId: asset.id,
        videoUrl: asset.referenceUrl,
        coverUrl: imageByShotId.get(shot.id)?.referenceUrl || imageAssets[0]?.referenceUrl || "",
        durationLabel: formatClock(shot.duration || 0)
      }];
    });
    const totalDuration = storyboards.reduce((sum, shot) => sum + (shot.duration || 0), 0);
    const exportCandidates = exportJobs.flatMap((job) => {
      if (job.status !== "succeeded" || !isPlayableVideoUrl(job.outputUrl) || (job.type !== "video_export" && job.outputKind !== "mp4")) return [];
      return [{
        id: `export:${job.id}`,
        label: `合成 MP4 · ${new Date(job.updatedAt).toLocaleString()}`,
        videoUrl: job.outputUrl,
        coverUrl: imageAssets[0]?.referenceUrl || "",
        durationLabel: formatClock(totalDuration)
      }];
    });
    return [...exportCandidates, ...clipCandidates];
  }, [exportJobs, imageAssets, imageByShotId, storyboards, videoByShotId]);
  const [candidateId, setCandidateId] = useState(candidates[0]?.id ?? "");
  const selectedCandidate = candidates.find((item) => item.id === candidateId) ?? candidates[0];
  const [title, setTitle] = useState(project.name);
  const [description, setDescription] = useState(project.intro || "分享这次创作的成片与镜头方法。");
  const [category, setCategory] = useState("AI短剧");
  const [coverUrl, setCoverUrl] = useState(candidates[0]?.coverUrl || imageAssets[0]?.referenceUrl || "");
  const [works, setWorks] = useState<ShowcaseWork[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void api.myShowcaseWorks().then(setWorks).catch(() => setWorks([]));
  }, []);

  function changeCandidate(nextId: string) {
    setCandidateId(nextId);
    const next = candidates.find((item) => item.id === nextId);
    if (next?.coverUrl) setCoverUrl(next.coverUrl);
  }

  async function publish() {
    if (!selectedCandidate) {
      setError("当前项目还没有可提交的视频或 MP4 导出文件。");
      return;
    }
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const created = await api.createShowcaseWork({
        projectId: project.id,
        sourceAssetId: selectedCandidate.sourceAssetId,
        videoUrl: selectedCandidate.videoUrl,
        title,
        description,
        category,
        coverUrl,
        durationLabel: selectedCandidate.durationLabel
      });
      setWorks((current) => [created, ...current]);
      setMessage("作品已提交审核。后台通过后会自动出现在前台创作现场。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "作品提交失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div id="showcase-publish-modal" className="showcase-publish-modal" role="dialog" aria-modal="true" aria-label="发布到创作现场">
      <button className="showcase-publish-backdrop" type="button" aria-label="关闭" onClick={onClose} />
      <section>
        <header><div><span>CREATOR SHOWCASE</span><h2>发布到创作现场</h2><p>选择当前项目已完成的视频，提交后进入后台审核。</p></div><button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
        <div className="showcase-publish-body">
          <div className="showcase-publish-preview">
            {selectedCandidate ? <video src={selectedCandidate.videoUrl} poster={coverUrl || selectedCandidate.coverUrl} controls playsInline preload="metadata" /> : <div><Film size={36} /><strong>暂无可发布视频</strong><span>先生成镜头视频或合成 MP4。</span></div>}
            <label><span>选择作品视频</span><select value={candidateId} onChange={(event) => changeCandidate(event.target.value)} disabled={!candidates.length}>{candidates.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          </div>
          <div className="showcase-publish-form">
            <label><span>作品标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></label>
            <label><span>作品分类</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>AI短剧</option><option>动画短片</option><option>电商广告</option><option>品牌广告</option><option>概念片</option><option>电影感</option><option>科幻风</option></select></label>
            <label className="wide"><span>作品说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1200} /></label>
            <label className="wide"><span>封面地址</span><input value={coverUrl} onChange={(event) => setCoverUrl(event.target.value)} placeholder="默认使用当前镜头首帧" /></label>
            {message ? <p className="success-text wide">{message}</p> : null}
            {error ? <p className="danger-text wide">{error}</p> : null}
            <button className="primary-button wide" type="button" disabled={loading || !selectedCandidate || !title.trim() || !coverUrl.trim()} onClick={() => void publish()}><Upload size={17} />{loading ? "提交中..." : "提交后台审核"}</button>
          </div>
        </div>
        <footer>
          <strong>我的发布记录</strong>
          <div>{works.slice(0, 4).map((work) => <span className={`showcase-publish-status ${work.status}`} key={work.id}>{work.title} · {showcaseCreatorStatus(work.status)}</span>)}{!works.length ? <small>暂无提交记录</small> : null}</div>
        </footer>
      </section>
    </div>
  );
}

function showcaseCreatorStatus(status: ShowcaseWork["status"]) {
  return status === "approved" ? "已发布" : status === "rejected" ? "需修改" : status === "draft" ? "草稿" : "审核中";
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
  const layout = buildTimelineClipLayout(storyboards);
  const totalWidth = Math.max(720, layout.reduce((sum, clip) => sum + clip.width, 0));
  const activeIndex = storyboards.findIndex((shot) => shot.id === activeShotId);
  const playheadOffset = layout.slice(0, Math.max(0, activeIndex)).reduce((sum, clip) => sum + clip.width, 0);
  const tracks = [
    { key: "video", label: "视频", icon: <Film size={15} />, ready: (shot: StoryboardShot) => isPlayableVideoUrl(videoAssetByShotId.get(shot.id)?.referenceUrl), text: (shot: StoryboardShot) => videoAssetByShotId.get(shot.id) ? "片段" : "待片段" },
    { key: "audio", label: "配音", icon: <MessageSquareText size={15} />, ready: (shot: StoryboardShot) => Boolean(shot.dialogue || shot.voiceOver), text: (shot: StoryboardShot) => shot.dialogue || shot.voiceOver || "待配音" },
    { key: "caption", label: "字幕", icon: <FileText size={15} />, ready: (shot: StoryboardShot) => Boolean(shot.dialogue), text: (shot: StoryboardShot) => shot.dialogue || "待字幕" },
    { key: "sfx", label: "音效", icon: <Sparkles size={15} />, ready: (shot: StoryboardShot) => Boolean(shot.environmentSound || shot.soundEffect), text: (shot: StoryboardShot) => shot.environmentSound || shot.soundEffect || "环境声" }
  ];

  return (
    <section className="video-track-timeline">
      <header><div><strong>轨道编辑</strong><span>按镜头时长自动排列 · 单击片段定位预览</span></div><small>{formatClock(totalDuration)}</small></header>
      <div className="timeline-editor-scroll">
        <div className="video-time-ruler-row">
          <span />
          <div style={{ width: totalWidth }}>
            {layout.map((clip) => <i key={clip.id} style={{ width: clip.width }}><b>{formatClock(clip.start)}</b></i>)}
            <i className="timeline-end-marker"><b>{formatClock(totalDuration)}</b></i>
          </div>
        </div>
        {tracks.map((track) => (
          <div className="video-track-row" key={track.key}>
            <strong>{track.icon}<span>{track.label}</span></strong>
            <div className="video-track-canvas" style={{ width: totalWidth }}>
              {track.key === "video" && activeIndex >= 0 ? <span className="timeline-playhead" style={{ left: playheadOffset }} /> : null}
              {storyboards.map((shot, index) => {
                const image = imageAssetByShotId.get(shot.id);
                const clip = layout[index];
                return (
                  <button className={`${track.ready(shot) ? "ready" : ""} ${activeShotId === shot.id ? "active" : ""}`} key={`${track.key}-${shot.id}`} onClick={() => onSelect(shot.id)} style={{ width: clip?.width ?? 96 }} type="button">
                    {track.key === "video" && image?.referenceUrl ? <StableImage src={image.referenceUrl} alt={image.name} /> : null}
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <em>{track.text(shot)}</em>
                    <small>{shot.duration || 1}s</small>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
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

function ImageRoutePicker({
  project,
  providers,
  modelPrices,
  quantity = 1,
  onSave,
  actionLabel = "应用到本项目",
  onAction,
  actionDisabled = false,
  secondaryLabel,
  onSecondaryAction,
  secondaryDisabled = false
}: {
  project: Project;
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  quantity?: number;
  onSave: (routes: Partial<Pick<Project, "imageProvider" | "imageModel" | "imageSize" | "imageQuality">>) => void | Promise<void>;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  actionDisabled?: boolean;
  secondaryLabel?: string;
  onSecondaryAction?: () => void | Promise<void>;
  secondaryDisabled?: boolean;
}) {
  const imageProviders = providers.filter((provider) => provider.modality === "image" && provider.enabled);
  const [draft, setDraft] = useState({
    imageProvider: project.imageProvider ?? imageProviders[0]?.id ?? "",
    imageModel: project.imageModel && !failedImageModels.has(project.imageModel) ? project.imageModel : "wan2.6-t2i",
    imageSize: normalizeImageOutputSize(project.imageSize),
    imageQuality: normalizeImageOutputQuality(project.imageQuality)
  });
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const models = (imageProviders.find((provider) => provider.id === draft.imageProvider)?.models ?? [draft.imageModel]).filter((model) => !failedImageModels.has(model));
  const unitPrice = modelPrices.find((price) => price.enabled && price.modality === "image" && price.providerId === draft.imageProvider && price.model === draft.imageModel)?.unitCredits
    ?? modelPrices.find((price) => price.enabled && price.modality === "image" && price.model === draft.imageModel)?.unitCredits
    ?? 8;
  const estimatedCredits = Math.max(0, quantity) * estimateImageCredits(unitPrice, draft.imageSize, draft.imageQuality);

  useEffect(() => {
    setDraft({
      imageProvider: project.imageProvider ?? imageProviders[0]?.id ?? "",
      imageModel: project.imageModel && !failedImageModels.has(project.imageModel) ? project.imageModel : "wan2.6-t2i",
      imageSize: normalizeImageOutputSize(project.imageSize),
      imageQuality: normalizeImageOutputQuality(project.imageQuality)
    });
  }, [project.id, project.imageProvider, project.imageModel, project.imageSize, project.imageQuality]);

  function selectProvider(providerId: string) {
    const nextModels = (imageProviders.find((provider) => provider.id === providerId)?.models ?? []).filter((model) => !failedImageModels.has(model));
    setDraft((current) => ({ ...current, imageProvider: providerId, imageModel: nextModels[0] ?? current.imageModel }));
  }

  async function applyRoute(action?: () => void | Promise<void>) {
    setSaving(true);
    setActionError("");
    try {
      await onSave(draft);
      await action?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "模型应用或生成失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="image-route-picker">
      <div className="asset-action-title"><strong><SlidersHorizontal size={15} />生成模型</strong><small>预计 {estimatedCredits} 积分</small></div>
      <label><span>渠道</span><select value={draft.imageProvider} onChange={(event) => selectProvider(event.target.value)}>{imageProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
      <label><span>模型</span><select value={draft.imageModel} onChange={(event) => setDraft((current) => ({ ...current, imageModel: event.target.value }))}>{models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
      <div className="image-route-params">
        <label><span>尺寸</span><select value={draft.imageSize} onChange={(event) => setDraft((current) => ({ ...current, imageSize: normalizeImageOutputSize(event.target.value) }))}>{imageOutputSizeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label><span>质量</span><select value={draft.imageQuality} onChange={(event) => setDraft((current) => ({ ...current, imageQuality: normalizeImageOutputQuality(event.target.value) }))}>{imageOutputQualityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>
      <button className="primary-button full-button" onClick={() => void applyRoute(onAction)} disabled={saving || actionDisabled || !draft.imageProvider || !draft.imageModel} type="button">{saving ? <Loader2 size={15} className="spin-icon" /> : onAction ? <WandSparkles size={15} /> : <Save size={15} />}{actionLabel}</button>
      {secondaryLabel && onSecondaryAction ? <button className="ghost-button full-button" onClick={() => void applyRoute(onSecondaryAction)} disabled={saving || secondaryDisabled || !draft.imageProvider || !draft.imageModel} type="button">{saving ? <Loader2 size={15} className="spin-icon" /> : <Sparkles size={15} />}{secondaryLabel}</button> : null}
      {actionError ? <p className="error-text">{actionError}</p> : null}
    </section>
  );
}

function VideoRoutePicker({ project, providers, modelPrices, totalSeconds, onSave, onGenerate, disabled = false }: { project: Project; providers: ModelProvider[]; modelPrices: ModelPrice[]; totalSeconds: number; onSave: (routes: Partial<Pick<Project, "videoProvider" | "videoModel">>) => void | Promise<void>; onGenerate: () => void | Promise<void>; disabled?: boolean }) {
  const videoProviders = providers.filter((provider) => provider.modality === "video" && provider.enabled);
  const [providerId, setProviderId] = useState(project.videoProvider ?? videoProviders[0]?.id ?? "");
  const [model, setModel] = useState(project.videoModel ?? videoProviders.find((provider) => provider.id === (project.videoProvider ?? videoProviders[0]?.id))?.models[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const models = videoProviders.find((provider) => provider.id === providerId)?.models ?? [];
  const unitCredits = modelPrices.find((price) => price.enabled && price.modality === "video" && price.providerId === providerId && price.model === model && price.unit === "video_second")?.unitCredits
    ?? modelPrices.find((price) => price.enabled && price.modality === "video" && price.model === model && price.unit === "video_second")?.unitCredits
    ?? 2;

  useEffect(() => {
    const nextProvider = project.videoProvider ?? videoProviders[0]?.id ?? "";
    setProviderId(nextProvider);
    setModel(project.videoModel ?? videoProviders.find((provider) => provider.id === nextProvider)?.models[0] ?? "");
  }, [project.id, project.videoProvider, project.videoModel]);

  function updateProvider(nextProvider: string) {
    setProviderId(nextProvider);
    setModel(videoProviders.find((provider) => provider.id === nextProvider)?.models[0] ?? "");
  }

  async function applyRouteAndGenerate() {
    setSaving(true);
    setActionError("");
    try {
      await onSave({ videoProvider: providerId, videoModel: model });
      await onGenerate();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "模型应用或视频生成失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="video-route-picker">
      <div className="asset-action-title"><strong><SlidersHorizontal size={15} />视频模型</strong><small>约 {Math.ceil(totalSeconds * unitCredits)} 积分</small></div>
      <label><span>渠道</span><select value={providerId} onChange={(event) => updateProvider(event.target.value)}>{videoProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
      <label><span>模型</span><select value={model} onChange={(event) => setModel(event.target.value)}>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <button className="primary-button full-button" onClick={() => void applyRouteAndGenerate()} disabled={saving || disabled || !providerId || !model} type="button">{saving ? <Loader2 size={15} className="spin-icon" /> : <WandSparkles size={15} />}应用模型并生成待完成片段</button>
      {actionError ? <p className="error-text">{actionError}</p> : null}
    </section>
  );
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

function isPlayableVideoUrl(url?: string): url is string {
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
  episodeNo: number;
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
          id: `scene-${first.episodeNo}-${first.sceneNo}-${index}`,
          episodeNo: first.episodeNo || 1,
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
      episodeNo: 1,
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
