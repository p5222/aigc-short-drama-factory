import {
  CheckSquare2,
  Film,
  Image as ImageIcon,
  Loader2,
  Save,
  Square,
  Table2,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useReducer, useState } from "react";
import type { ModelPrice, ModelProvider, Project, ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import {
  estimateImageCredits,
  imageOutputQualityOptions,
  imageOutputSizeOptions,
  normalizeImageOutputQuality,
  normalizeImageOutputSize
} from "@aifilm/shared";
import { api } from "../../lib/api";
import { MediaFrame } from "../components/MediaCanvas";
import { ProductionWorkspace } from "../components/ProductionWorkspace";
import {
  buildShotAssetMap,
  buildShotImageGenerationPayload,
  buildProjectVideoGenerationArgs,
  buildStoryboardShotUpdatePayload,
  collectPendingShotIds,
  createShotDraftState,
  reduceShotDraftState,
  resolveImageRoutePair,
  resolveImageUnitCredits,
  resolveShotSelection,
  resolveVideoUnitCredits,
  type ShotDraftState,
  type ShotMode
} from "../model";
import { useWorkbench, type WorkbenchSaveState } from "../WorkbenchContext";

interface ShotStageProps {
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  railOpen: boolean;
  inspectorOpen: boolean;
  onCloseRail: () => void;
  onCloseInspector: () => void;
  onRefresh: (projectId: string) => Promise<ProjectWorkflow>;
  onPreview: (preview: { url: string; title: string }) => void;
  onSaveStateChange: (state: WorkbenchSaveState) => void;
}

const editableFields = [
  "pictureDesc", "action", "shotSize", "cameraAngle", "cameraMovement", "duration",
  "characters", "scene", "emotion", "dialogue", "imagePrompt", "videoPrompt"
] as const;
const failedImageModels = new Set(["wanx-v1", "wan2.5-t2i-preview"]);

export function ShotStage(props: ShotStageProps) {
  const { workflow } = useWorkbench();
  if (!workflow) return null;
  return <LoadedShotStage {...props} workflow={workflow} />;
}

function LoadedShotStage({
  workflow,
  providers,
  modelPrices,
  railOpen,
  inspectorOpen,
  onCloseRail,
  onCloseInspector,
  onRefresh,
  onPreview,
  onSaveStateChange
}: ShotStageProps & { workflow: ProjectWorkflow }) {
  const { state, dispatch } = useWorkbench();
  const { project, storyboards, assets, tasks } = workflow;
  const imageMap = useMemo(() => buildShotAssetMap(storyboards, assets, "image"), [assets, storyboards]);
  const videoMap = useMemo(() => buildShotAssetMap(storyboards, assets, "video"), [assets, storyboards]);
  const pendingShotIds = useMemo(() => collectPendingShotIds(storyboards, assets), [assets, storyboards]);
  const activeShot = storyboards.find((shot) => shot.id === state.activeShotId) ?? storyboards[0];
  const [draftState, updateDraft] = useReducer(
    reduceShotDraftState,
    activeShot ? createShotDraftState(activeShot.id, shotDraft(activeShot)) : createShotDraftState("", {})
  );
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [imageRoute, setImageRoute] = useState(() => initialImageRoute(project, providers));
  const [videoRoute, setVideoRoute] = useState(() => initialVideoRoute(project, providers));

  const selectedIds = state.selectedShotIds.filter((id) => storyboards.some((shot) => shot.id === id));
  const activeImage = activeShot ? imageMap.get(activeShot.id) : undefined;
  const activeVideo = activeShot ? videoMap.get(activeShot.id) : undefined;
  const imageProviders = providers.filter((provider) => provider.enabled && provider.modality === "image" && provider.models.some((model) => !failedImageModels.has(model)));
  const videoProviders = providers.filter((provider) => provider.enabled && provider.modality === "video" && provider.models.length);
  const imageModels = imageProviders.find((provider) => provider.id === imageRoute.imageProvider)?.models.filter((model) => !failedImageModels.has(model)) ?? [];
  const videoModels = videoProviders.find((provider) => provider.id === videoRoute.videoProvider)?.models ?? [];
  const imageUnit = resolveImageUnitCredits(modelPrices, imageRoute.imageProvider, imageRoute.imageModel);
  const selectedImageCount = selectedIds.length
    ? selectedIds.filter((shotId) => !imageMap.get(shotId)?.referenceUrl).length
    : activeShot && !activeImage?.referenceUrl ? 1 : 0;
  const imageEstimate = estimateImageCredits(imageUnit, imageRoute.imageSize, imageRoute.imageQuality) * selectedImageCount;
  const videoSeconds = storyboards
    .filter((shot) => imageMap.get(shot.id)?.referenceUrl && !isPlayableVideoUrl(videoMap.get(shot.id)?.referenceUrl))
    .reduce((total, shot) => total + Math.max(1, shot.duration || 0), 0);
  const videoUnit = resolveVideoUnitCredits(modelPrices, videoRoute.videoProvider, videoRoute.videoModel);
  const latestVideoTask = [...tasks].filter((task) => task.type === "video").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const hasUnsavedDraft = draftState.status === "dirty" || draftState.status === "error" || draftState.status === "saving";
  const validImageRoute = imageModels.includes(imageRoute.imageModel);

  useEffect(() => {
    if (!activeShot) return;
    if (draftState.shotId === activeShot.id) return;
    updateDraft({ type: "rebuild", shotId: activeShot.id, draft: shotDraft(activeShot) });
  }, [activeShot?.id, draftState.shotId]);

  useEffect(() => {
    if (!activeShot || draftState.shotId !== activeShot.id) return;
    updateDraft({ type: "reconcile-canonical", shotId: activeShot.id, draft: shotDraft(activeShot) });
  }, [activeShot, draftState.shotId]);

  useEffect(() => {
    onSaveStateChange(draftState.status);
  }, [draftState.status, onSaveStateChange]);

  useEffect(() => () => onSaveStateChange("unchanged"), [onSaveStateChange]);

  function selectShot(shot: StoryboardShot) {
    const selection = resolveShotSelection(activeShot?.id ?? "", shot.id, draftState, () => (
      window.confirm("当前镜头有未保存修改。确认放弃这些修改并继续？")
    ));
    if (!selection.accepted) return;
    updateDraft({ type: "rebuild", shotId: shot.id, draft: shotDraft(shot) });
    dispatch({ type: "set-shot", shotId: shot.id });
  }

  function toggleSelected(shotId: string) {
    dispatch({
      type: "set-selected-shots",
      shotIds: selectedIds.includes(shotId) ? selectedIds.filter((id) => id !== shotId) : [...selectedIds, shotId]
    });
  }

  function edit(patch: Partial<StoryboardShot>) {
    updateDraft({ type: "edit", patch });
    dispatch({ type: "set-dirty-entity", entityKey: activeShot ? `shot:${activeShot.id}` : null });
  }

  async function saveShot() {
    if (!activeShot || (draftState.status !== "dirty" && draftState.status !== "error")) return;
    updateDraft({ type: "save-start" });
    setMessage("");
    setError("");
    const submittedDraft = buildStoryboardShotUpdatePayload(draftState.draft);
    let updatedShot: StoryboardShot;
    try {
      updatedShot = await api.updateStoryboardShot(project.id, activeShot.id, submittedDraft);
      updateDraft({ type: "save-committed", draft: shotDraft(updatedShot) });
    } catch (cause) {
      const detail = errorText(cause, "镜头保存失败，请重试。");
      updateDraft({ type: "save-failed", error: detail });
      setError(detail);
      return;
    }
    try {
      const refreshed = await onRefresh(project.id);
      const canonicalShot = refreshed.storyboards.find((shot) => shot.id === activeShot.id) ?? updatedShot;
      updateDraft({ type: "sync-succeeded", draft: shotDraft(canonicalShot) });
      setMessage("镜头已保存；相关旧首帧将按服务端规则失效。");
      dispatch({ type: "set-dirty-entity", entityKey: null });
    } catch (cause) {
      const detail = errorText(cause, "镜头已保存，但工作台刷新失败。");
      updateDraft({ type: "save-committed", draft: shotDraft(updatedShot), refreshError: detail });
      setRefreshRequired(true);
      setError(`${detail} 重试刷新不会重复保存。`);
    }
  }

  async function retryRefresh() {
    setPending("refresh");
    setError("");
    try {
      const refreshed = await onRefresh(project.id);
      const canonicalShot = refreshed.storyboards.find((shot) => shot.id === draftState.shotId);
      setRefreshRequired(false);
      updateDraft({ type: "sync-succeeded", draft: canonicalShot ? shotDraft(canonicalShot) : draftState.draft });
      dispatch({ type: "set-dirty-entity", entityKey: null });
      setMessage("工作台数据已刷新。");
    } catch (cause) {
      setError(errorText(cause, "刷新失败，请稍后重试。"));
    } finally {
      setPending("");
    }
  }

  async function generateImages(scope: "current" | "selected" | "pending") {
    if (!activeShot) return;
    const payloads = buildShotImageGenerationPayload(activeShot.id, selectedIds, pendingShotIds);
    const payload = payloads[scope];
    if (!payload.shotIds.length) return;
    const billableCount = payload.shotIds.filter((shotId) => !imageMap.get(shotId)?.referenceUrl).length;
    const estimate = estimateImageCredits(imageUnit, imageRoute.imageSize, imageRoute.imageQuality) * billableCount;
    if (!window.confirm(`将生成 ${payload.shotIds.length} 个镜头首帧，预计 ${estimate} 积分。\n${imageRoute.imageProvider} / ${imageRoute.imageModel} / ${imageRoute.imageSize} / ${imageRoute.imageQuality}\n如修改模型，将同时更新项目默认模型。确认继续？`)) return;
    setPending(`image:${scope}`);
    setMessage("");
    setError("");
    try {
      await persistImageRoute(project, imageRoute);
      await api.generateImages(project.id, payload);
    } catch (cause) {
      setError(errorText(cause, "首帧任务提交失败。"));
      setPending("");
      return;
    }
    try {
      await onRefresh(project.id);
      setMessage(`已提交 ${payload.shotIds.length} 个镜头首帧。`);
    } catch (cause) {
      setRefreshRequired(true);
      setError(`${errorText(cause, "任务已提交，但工作台刷新失败。")} 重试刷新不会重复生成。`);
    } finally {
      setPending("");
    }
  }

  async function generateVideos() {
    const estimate = Math.ceil(videoSeconds * videoUnit);
    if (!storyboards.length || !window.confirm(`将按项目级接口生成全部待完成视频片段，预计 ${estimate} 积分。\n${videoRoute.videoProvider} / ${videoRoute.videoModel}\n如修改模型，将同时更新项目默认模型。确认继续？`)) return;
    setPending("video");
    setMessage("");
    setError("");
    try {
      await persistVideoRoute(project, videoRoute);
      await api.generateVideos(project.id, ...buildProjectVideoGenerationArgs());
    } catch (cause) {
      setError(errorText(cause, "项目视频任务提交失败。"));
      setPending("");
      return;
    }
    try {
      await onRefresh(project.id);
      setMessage("项目级视频任务已提交。");
    } catch (cause) {
      setRefreshRequired(true);
      setError(`${errorText(cause, "任务已提交，但工作台刷新失败。")} 重试刷新不会重复生成。`);
    } finally {
      setPending("");
    }
  }

  return <ProductionWorkspace
    rail={<div className="wb-shot-rail">
      <header><h2>镜头清单</h2><small>{storyboards.length} 个镜头 · 已选 {selectedIds.length}</small></header>
      <div className="wb-shot-list">
        {storyboards.map((shot, index) => {
          const image = imageMap.get(shot.id);
          const video = videoMap.get(shot.id);
          return <div className={shot.id === activeShot?.id ? "is-active" : undefined} key={shot.id}>
            <button className="wb-shot-check" type="button" aria-label={`${selectedIds.includes(shot.id) ? "取消选择" : "选择"}镜头 ${shot.shotNo}`} aria-pressed={selectedIds.includes(shot.id)} onClick={() => toggleSelected(shot.id)}>{selectedIds.includes(shot.id) ? <CheckSquare2 /> : <Square />}</button>
            <button className="wb-shot-select" type="button" onClick={() => selectShot(shot)}>
              <span>{image?.referenceUrl ? <img src={image.referenceUrl} alt="" loading="lazy" /> : <ImageIcon />}</span>
              <span><strong>{formatShot(shot, index)}</strong><small>{shot.pictureDesc || "未提供画面描述"}</small><em>{video?.referenceUrl ? "视频已生成" : image?.referenceUrl ? "首帧已生成" : "待生成"} · {shot.duration}s</em></span>
            </button>
          </div>;
        })}
        {!storyboards.length ? <p className="wb-empty-state">暂无镜头，请先在内容阶段生成镜头结构。</p> : null}
      </div>
    </div>}
    canvas={<div className="wb-shot-canvas">
      <header className="wb-shot-toolbar">
        <div role="tablist" aria-label="镜头视图">
          <ModeButton mode="table" current={state.shotMode} icon={<Table2 />} onSelect={(mode) => dispatch({ type: "set-shot-mode", mode })}>镜头表</ModeButton>
          <ModeButton mode="image" current={state.shotMode} icon={<ImageIcon />} onSelect={(mode) => dispatch({ type: "set-shot-mode", mode })}>分镜图</ModeButton>
          <ModeButton mode="video" current={state.shotMode} icon={<Film />} onSelect={(mode) => dispatch({ type: "set-shot-mode", mode })}>视频</ModeButton>
        </div>
        <small>{activeShot ? formatShot(activeShot, storyboards.indexOf(activeShot)) : "未选择镜头"}</small>
      </header>
      {state.shotMode === "table" ? <ShotTable storyboards={storyboards} activeShot={activeShot} onSelect={selectShot} /> : null}
      {state.shotMode === "image" ? <ShotImageCanvas shot={activeShot} imageUrl={activeImage?.referenceUrl} onPreview={() => activeImage?.referenceUrl && onPreview({ url: activeImage.referenceUrl, title: activeImage.name })} /> : null}
      {state.shotMode === "video" ? <ShotVideoCanvas shot={activeShot} videoUrl={activeVideo?.referenceUrl} status={activeVideo?.status} /> : null}
      <div className="wb-action-feedback" aria-live="polite">{message ? <p className="wb-action-feedback--success">{message}</p> : null}{error ? <p className="wb-action-feedback--error">{error}</p> : null}</div>
    </div>}
    inspector={<div className="wb-shot-inspector">
      <header><h2>镜头参数</h2><small>{activeShot ? `场 ${activeShot.sceneNo} · 镜头 ${activeShot.shotNo}` : "未选择"}</small></header>
      {activeShot ? <ShotEditor state={draftState} onEdit={edit} onSave={saveShot} disabled={Boolean(pending)} /> : <p className="wb-empty-state">请选择镜头。</p>}
      {state.shotMode === "image" ? <section className="wb-shot-generation"><h3>首帧生成</h3><p>模型修改会同时更新项目默认模型。</p>
        <RouteSelect label="渠道" value={imageRoute.imageProvider} options={imageProviders.map((provider) => ({ value: provider.id, label: provider.name }))} onChange={(value) => { const pair = resolveImageRoutePair(value, undefined, providers, failedImageModels); setImageRoute((current) => ({ ...current, ...pair })); }} />
        <RouteSelect label="模型" value={imageRoute.imageModel} options={imageModels.map((model) => ({ value: model, label: model }))} onChange={(value) => setImageRoute((current) => ({ ...current, imageModel: value }))} />
        <div className="wb-shot-route-grid"><RouteSelect label="尺寸" value={imageRoute.imageSize} options={imageOutputSizeOptions.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => setImageRoute((current) => ({ ...current, imageSize: normalizeImageOutputSize(value) }))} /><RouteSelect label="质量" value={imageRoute.imageQuality} options={imageOutputQualityOptions.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => setImageRoute((current) => ({ ...current, imageQuality: normalizeImageOutputQuality(value) }))} /></div>
        <small>当前范围预计 {imageEstimate} 积分</small>
        <button className="wb-primary-button" type="button" disabled={!activeShot || Boolean(pending) || hasUnsavedDraft || !validImageRoute || selectedImageCount === 0} onClick={() => void generateImages(selectedIds.length ? "selected" : "current")}>{pending.startsWith("image:") ? <Loader2 className="wb-spin" /> : <WandSparkles />}{selectedIds.length ? `生成已选 ${selectedIds.length} 个首帧` : activeImage?.referenceUrl ? "当前首帧已生成" : "生成当前首帧"}</button>
        <button className="wb-secondary-button" type="button" disabled={!pendingShotIds.length || Boolean(pending) || hasUnsavedDraft || !validImageRoute} onClick={() => void generateImages("pending")}>生成全部待生成（{pendingShotIds.length}）</button>
      </section> : null}
      {state.shotMode === "video" ? <section className="wb-shot-generation"><h3>项目视频生成</h3><p>Release A 仅支持项目级全部待完成片段，不提供单镜头生成或重生成。</p>
        <RouteSelect label="渠道" value={videoRoute.videoProvider} options={videoProviders.map((provider) => ({ value: provider.id, label: provider.name }))} onChange={(value) => { const provider = videoProviders.find((item) => item.id === value); setVideoRoute({ videoProvider: value, videoModel: provider?.models[0] ?? "" }); }} />
        <RouteSelect label="模型" value={videoRoute.videoModel} options={videoModels.map((model) => ({ value: model, label: model }))} onChange={(value) => setVideoRoute((current) => ({ ...current, videoModel: value }))} />
        <small>{videoSeconds}s · 预计 {Math.ceil(videoSeconds * videoUnit)} 积分</small>
        {latestVideoTask?.status === "failed" ? <p className="wb-action-feedback--error">项目视频任务失败：{latestVideoTask.errorReason || "未提供失败原因"}</p> : null}
        <button className="wb-primary-button" type="button" disabled={!storyboards.length || Boolean(pending) || hasUnsavedDraft || !videoModels.includes(videoRoute.videoModel)} onClick={() => void generateVideos()}>{pending === "video" ? <Loader2 className="wb-spin" /> : <Film />}生成全部待完成视频</button>
      </section> : null}
      {refreshRequired ? <button className="wb-secondary-button wb-shot-refresh" type="button" disabled={pending === "refresh"} onClick={() => void retryRefresh()}>{pending === "refresh" ? <Loader2 className="wb-spin" /> : null}重试刷新</button> : null}
    </div>}
    railOpen={railOpen}
    inspectorOpen={inspectorOpen}
    onCloseRail={onCloseRail}
    onCloseInspector={onCloseInspector}
  />;
}

function ModeButton({ mode, current, icon, children, onSelect }: { mode: ShotMode; current: ShotMode; icon: React.ReactNode; children: React.ReactNode; onSelect: (mode: ShotMode) => void }) {
  return <button type="button" role="tab" aria-selected={mode === current} className={mode === current ? "is-active" : undefined} onClick={() => onSelect(mode)}>{icon}{children}</button>;
}

function ShotTable({ storyboards, activeShot, onSelect }: { storyboards: StoryboardShot[]; activeShot?: StoryboardShot; onSelect: (shot: StoryboardShot) => void }) {
  return <div className="wb-shot-table-wrap"><table className="wb-shot-table"><thead><tr><th>镜头</th><th>画面</th><th>景别</th><th>机位</th><th>运镜</th><th>时长</th></tr></thead><tbody>{storyboards.map((shot, index) => <tr className={shot.id === activeShot?.id ? "is-active" : undefined} key={shot.id}><td><button type="button" onClick={() => onSelect(shot)}>{formatShot(shot, index)}</button></td><td>{shot.pictureDesc || "未提供"}</td><td>{shot.shotSize || "未提供"}</td><td>{shot.cameraAngle || "未提供"}</td><td>{shot.cameraMovement || "未提供"}</td><td>{shot.duration}s</td></tr>)}</tbody></table></div>;
}

function ShotImageCanvas({ shot, imageUrl, onPreview }: { shot?: StoryboardShot; imageUrl?: string; onPreview: () => void }) {
  return <button className="wb-shot-media" type="button" disabled={!imageUrl} onClick={onPreview}><MediaFrame aspectRatio="16:9" label="当前镜头首帧">{imageUrl ? <img src={imageUrl} alt={shot?.pictureDesc || "镜头首帧"} /> : <div><ImageIcon /><strong>首帧待生成</strong><span>{shot?.pictureDesc || "选择镜头后查看"}</span></div>}</MediaFrame></button>;
}

function ShotVideoCanvas({ shot, videoUrl, status }: { shot?: StoryboardShot; videoUrl?: string; status?: string }) {
  const playable = Boolean(videoUrl && /^(https?:|data:video|blob:)/.test(videoUrl));
  return <div className="wb-shot-video"><MediaFrame aspectRatio="16:9" label="当前镜头视频">{playable ? <video src={videoUrl} controls preload="metadata" /> : <div className="wb-shot-video-empty"><Film /><strong>{status === "failed" ? "当前片段生成失败" : status === "running" ? "当前片段生成中" : "视频待生成"}</strong><span>{shot?.videoPrompt || "当前镜头尚无可播放片段"}</span></div>}</MediaFrame></div>;
}

function ShotEditor({ state, onEdit, onSave, disabled }: { state: ShotDraftState; onEdit: (patch: Partial<StoryboardShot>) => void; onSave: () => Promise<void>; disabled: boolean }) {
  const draft = state.draft;
  return <section className="wb-shot-editor">
    <label><span>画面描述</span><textarea value={String(draft.pictureDesc ?? "")} onChange={(event) => onEdit({ pictureDesc: event.target.value })} /></label>
    <div><label><span>景别</span><input value={String(draft.shotSize ?? "")} onChange={(event) => onEdit({ shotSize: event.target.value })} /></label><label><span>机位</span><input value={String(draft.cameraAngle ?? "")} onChange={(event) => onEdit({ cameraAngle: event.target.value })} /></label></div>
    <div><label><span>运镜</span><input value={String(draft.cameraMovement ?? "")} onChange={(event) => onEdit({ cameraMovement: event.target.value })} /></label><label><span>时长（秒）</span><input type="number" min="1" max="30" step="1" value={String(draft.duration ?? "")} onChange={(event) => onEdit({ duration: Number(event.target.value) })} /></label></div>
    <label><span>角色绑定</span><input value={(draft.characters ?? []).join(" / ")} onChange={(event) => onEdit({ characters: event.target.value.split(/[、,/]/).map((item) => item.trim()).filter(Boolean) })} /></label>
    <label><span>场景绑定</span><input value={String(draft.scene ?? "")} onChange={(event) => onEdit({ scene: event.target.value })} /></label>
    <label><span>动作</span><textarea value={String(draft.action ?? "")} onChange={(event) => onEdit({ action: event.target.value })} /></label>
    <label><span>图片提示词</span><textarea value={String(draft.imagePrompt ?? "")} onChange={(event) => onEdit({ imagePrompt: event.target.value })} /></label>
    <label><span>视频提示词</span><textarea value={String(draft.videoPrompt ?? "")} onChange={(event) => onEdit({ videoPrompt: event.target.value })} /></label>
    <button className="wb-primary-button" type="button" disabled={disabled || (state.status !== "dirty" && state.status !== "error")} onClick={() => void onSave()}>{state.status === "saving" ? <Loader2 className="wb-spin" /> : <Save />}保存镜头</button>
  </section>;
}

function RouteSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="wb-shot-route"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function shotDraft(shot: StoryboardShot): Partial<StoryboardShot> {
  return Object.fromEntries(editableFields.map((field) => [field, Array.isArray(shot[field]) ? [...shot[field]] : shot[field]])) as Partial<StoryboardShot>;
}

function initialImageRoute(project: Project, providers: ModelProvider[]) {
  const pair = resolveImageRoutePair(project.imageProvider, project.imageModel, providers, failedImageModels);
  return { ...pair, imageSize: normalizeImageOutputSize(project.imageSize), imageQuality: normalizeImageOutputQuality(project.imageQuality) };
}

function initialVideoRoute(project: Project, providers: ModelProvider[]) {
  const candidates = providers.filter((provider) => provider.enabled && provider.modality === "video" && provider.models.length);
  const provider = candidates.find((item) => item.id === project.videoProvider) ?? candidates[0];
  return { videoProvider: provider?.id ?? "", videoModel: provider?.models.includes(project.videoModel ?? "") ? project.videoModel! : provider?.models[0] ?? "" };
}

async function persistImageRoute(project: Project, route: ReturnType<typeof initialImageRoute>) {
  if (project.imageProvider === route.imageProvider && project.imageModel === route.imageModel && normalizeImageOutputSize(project.imageSize) === route.imageSize && normalizeImageOutputQuality(project.imageQuality) === route.imageQuality) return;
  await api.updateProjectModelRoutes(project.id, route);
}

async function persistVideoRoute(project: Project, route: ReturnType<typeof initialVideoRoute>) {
  if (project.videoProvider === route.videoProvider && project.videoModel === route.videoModel) return;
  await api.updateProjectModelRoutes(project.id, route);
}

function formatShot(shot: StoryboardShot, index: number) {
  return `场 ${shot.sceneNo || 1} · 镜头 ${shot.shotNo || index + 1}`;
}

function errorText(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function isPlayableVideoUrl(url?: string) {
  return Boolean(url && (/^data:video\//.test(url) || /^blob:/.test(url) || /\.(mp4|webm|mov)(\?|#|$)/i.test(url)));
}
