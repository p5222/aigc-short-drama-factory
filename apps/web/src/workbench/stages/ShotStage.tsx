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
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ModelPrice, ModelProvider, Project, ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import {
  estimateImageCredits,
  imageOutputQualityOptions,
  imageOutputSizeOptions,
  normalizeImageOutputQuality,
  normalizeImageOutputSize
} from "@aifilm/shared";
import { api } from "../../lib/api";
import { ModelRoutePicker } from "../../components/ModelRoutePicker";
import { buildModelCatalog } from "../../components/modelCatalog";
import { MediaFrame } from "../components/MediaCanvas";
import { ProductionWorkspace } from "../components/ProductionWorkspace";
import {
  buildShotAssetMap,
  buildShotImageGenerationPayload,
  buildBatchResultSummary,
  buildStoryboardShotUpdatePayload,
  collectEligibleVideoShotIds,
  createShotDraftState,
  reduceShotDraftState,
  resolveImageRoutePair,
  resolveImageUnitCredits,
  resolveShotSelection,
  resolveVideoUnitCredits,
  resolveVideoAssetStatus,
  isPersistedPlayableVideoReference,
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
// 与服务端 videoGenerateSchema 的请求上限一致。
const VIDEO_BATCH_MAX = 20;

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
  const { project, storyboards: projectStoryboards, assets: projectAssets, tasks } = workflow;
  const episodes = useMemo(() => [...new Set([
    ...Array.from({ length: Math.max(1, project.episodes) }, (_, index) => index + 1),
    ...projectStoryboards.map(shot => shot.episodeNo)
  ])].sort((a, b) => a - b), [project.episodes, projectStoryboards]);
  const activeEpisode = state.activeEpisodeNo ?? episodes[0];
  const storyboards = useMemo(() => projectStoryboards.filter(shot => shot.episodeNo === activeEpisode), [projectStoryboards, activeEpisode]);
  const assets = useMemo(() => projectAssets.filter(asset => !asset.isHistorical), [projectAssets]);
  const imageMap = useMemo(() => buildShotAssetMap(storyboards, assets, "image"), [assets, storyboards]);
  const videoMap = useMemo(() => buildShotAssetMap(storyboards, assets, "video"), [assets, storyboards]);
  const pendingShotIds = useMemo(() => storyboards.filter(shot => {
    const image = imageMap.get(shot.id);
    return !image || image.status === "failed" || (image.status === "succeeded" && !image.referenceUrl);
  }).map(shot => shot.id), [imageMap, storyboards]);
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
  const [segmentProfile, setSegmentProfile] = useState(project.segmentProfile ?? "jimeng_15s");
  const operationSequence = useRef(0);
  const activeOperationRef = useRef<{ token: string; shotId: string } | null>(null);

  useEffect(() => setSegmentProfile(project.segmentProfile ?? "jimeng_15s"), [project.segmentProfile]);

  async function changeSegmentProfile(next: "jimeng_15s") {
    if (next === segmentProfile) return;
    if (storyboards.length && !window.confirm(`切换为${next === "jimeng_15s" ? "即梦 15秒" : "豆包 10秒"}会保存新的项目生产规格；现有分镜不会删除。确认切换？`)) return;
    const previous = segmentProfile;
    setSegmentProfile(next);
    setPending("segment-profile");
    setError("");
    try {
      await api.updateProjectModelRoutes(project.id, { segmentProfile: next });
      await onRefresh(project.id);
      setMessage(`已选择${next === "jimeng_15s" ? "即梦 15秒" : "豆包 10秒"}生产方案。`);
    } catch (cause) {
      setSegmentProfile(previous);
      setError(errorText(cause, "生产方案保存失败。"));
    } finally {
      setPending("");
    }
  }

  const selectedIds = state.selectedShotIds.filter((id) => storyboards.some((shot) => shot.id === id));
  const activeImage = activeShot ? imageMap.get(activeShot.id) : undefined;
  const activeVideo = activeShot ? videoMap.get(activeShot.id) : undefined;
  const imageProviders = providers.filter((provider) => provider.enabled && provider.modality === "image" && provider.models.some((model) => !failedImageModels.has(model)));
  const videoProviders = providers.filter((provider) => provider.enabled && provider.modality === "video" && provider.models.length);
  const imageModels = imageProviders.find((provider) => provider.id === imageRoute.imageProvider)?.models.filter((model) => !failedImageModels.has(model)) ?? [];
  const videoModels = videoProviders.find((provider) => provider.id === videoRoute.videoProvider)?.models ?? [];
  const catalog = buildModelCatalog(providers, modelPrices);
  const imageModel = catalog.find(item => item.provider.id === imageRoute.imageProvider && item.model === imageRoute.imageModel);
  const videoModel = catalog.find(item => item.provider.id === videoRoute.videoProvider && item.model === videoRoute.videoModel);
  const selectedImageCount = selectedIds.length
    ? selectedIds.filter((shotId) => pendingShotIds.includes(shotId)).length
    : activeShot && pendingShotIds.includes(activeShot.id) ? 1 : 0;
  const imageUnitEstimate = imageModel?.price ? `${estimateImageCredits(imageModel.price.unitCredits, imageRoute.imageSize, imageRoute.imageQuality)} 积分` : "报价时确认";
  const eligibleVideoShotIds = useMemo(() => collectEligibleVideoShotIds(storyboards, assets).filter(id =>
    resolveVideoAssetStatus(videoMap.get(id)) !== "running"
    && /^(?:https?:\/\/|\/storage\/|data:image\/)/i.test(imageMap.get(id)?.referenceUrl ?? "")
  ), [assets, storyboards, videoMap, imageMap]);
  const videoBatchIds = eligibleVideoShotIds.slice(0, VIDEO_BATCH_MAX);
  const eligibleVideoSet = new Set(videoBatchIds);
  const videoSeconds = storyboards
    .filter((shot) => eligibleVideoSet.has(shot.id))
    .reduce((total, shot) => total + Math.max(1, shot.duration || 0), 0);
  const videoUnit = videoModel?.price ? `${videoModel.price.unitCredits} 积分/秒` : "报价时确认";
  const latestVideoTask = [...tasks].filter((task) => task.type === "video").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const hasUnsavedDraft = draftState.status === "dirty" || draftState.status === "error" || draftState.status === "saving";
  const validImageRoute = imageModels.includes(imageRoute.imageModel) && Boolean(imageModel?.selectable);
  const validVideoRoute = videoModels.includes(videoRoute.videoModel) && Boolean(videoModel?.selectable);

  useEffect(() => {
    if (draftState.shotId === (activeShot?.id ?? "")) return;
    activeOperationRef.current = null;
    updateDraft({ type: "rebuild", shotId: activeShot?.id ?? "", draft: activeShot ? shotDraft(activeShot) : {} });
  }, [activeShot?.id, draftState.shotId]);

  useEffect(() => {
    if (!activeShot || draftState.shotId !== activeShot.id) return;
    updateDraft({ type: "reconcile-canonical", shotId: activeShot.id, draft: shotDraft(activeShot) });
  }, [activeShot, draftState.shotId]);

  useEffect(() => {
    onSaveStateChange(draftState.activeOperation ? "saving" : draftState.status);
  }, [draftState.activeOperation, draftState.status, onSaveStateChange]);

  useEffect(() => () => onSaveStateChange("unchanged"), [onSaveStateChange]);

  function selectEpisode(episodeNo: number) {
    if (episodeNo === activeEpisode || pending || draftState.activeOperation) return;
    if (hasUnsavedDraft && !window.confirm("当前镜头有未保存修改。确认放弃这些修改并切换剧集？")) return;
    activeOperationRef.current = null;
    const nextShot = projectStoryboards.find(shot => shot.episodeNo === episodeNo);
    updateDraft({ type: "rebuild", shotId: nextShot?.id ?? "", draft: nextShot ? shotDraft(nextShot) : {} });
    dispatch({ type: "set-episode", episodeNo, storyboards: projectStoryboards, episodeCount: project.episodes });
    setMessage("");
    setError("");
  }

  function selectShot(shot: StoryboardShot) {
    if (pending) return;
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
    activeOperationRef.current = null;
    updateDraft({ type: "edit", patch });
  }

  async function saveShot() {
    if (!activeShot || (draftState.status !== "dirty" && draftState.status !== "error")) return;
    const submittedShotId = activeShot.id;
    const token = nextOperationToken("save", submittedShotId, operationSequence);
    activeOperationRef.current = { token, shotId: submittedShotId };
    updateDraft({ type: "save-start", token });
    setMessage("");
    setError("");
    const submittedDraft = buildStoryboardShotUpdatePayload(draftState.draft);
    let updatedShot: StoryboardShot;
    try {
      updatedShot = await api.updateStoryboardShot(project.id, submittedShotId, submittedDraft);
      if (!isCurrentOperation(activeOperationRef.current, token, submittedShotId)) return;
      updateDraft({ type: "save-committed", token, draft: shotDraft(updatedShot) });
    } catch (cause) {
      const detail = errorText(cause, "镜头保存失败，请重试。");
      if (!isCurrentOperation(activeOperationRef.current, token, submittedShotId)) return;
      updateDraft({ type: "save-failed", token, error: detail });
      activeOperationRef.current = null;
      setError(detail);
      return;
    }
    try {
      const refreshed = await onRefresh(project.id);
      const canonicalShot = refreshed.storyboards.find((shot) => shot.id === submittedShotId) ?? updatedShot;
      if (!isCurrentOperation(activeOperationRef.current, token, submittedShotId)) return;
      updateDraft({ type: "sync-succeeded", token, draft: shotDraft(canonicalShot) });
      activeOperationRef.current = null;
      setMessage("镜头已保存；相关旧首帧将按服务端规则失效。");
    } catch (cause) {
      const detail = errorText(cause, "镜头已保存，但工作台刷新失败。");
      if (!isCurrentOperation(activeOperationRef.current, token, submittedShotId)) return;
      updateDraft({ type: "save-committed", token, draft: shotDraft(updatedShot), refreshError: detail });
      activeOperationRef.current = null;
      setRefreshRequired(true);
      setError(`${detail} 重试刷新不会重复保存。`);
    }
  }

  async function retryRefresh() {
    if (draftState.status === "dirty" || draftState.status === "error" || draftState.status === "saving") return;
    const submittedShotId = draftState.shotId;
    const token = nextOperationToken("refresh", submittedShotId, operationSequence);
    activeOperationRef.current = { token, shotId: submittedShotId };
    updateDraft({ type: "sync-start", token });
    setPending("refresh");
    setError("");
    try {
      const refreshed = await onRefresh(project.id);
      const canonicalShot = refreshed.storyboards.find((shot) => shot.id === submittedShotId);
      if (!isCurrentOperation(activeOperationRef.current, token, submittedShotId)) return;
      updateDraft({ type: "sync-succeeded", token, draft: canonicalShot ? shotDraft(canonicalShot) : draftState.draft });
      activeOperationRef.current = null;
      setRefreshRequired(false);
      setMessage("工作台数据已刷新。");
    } catch (cause) {
      if (!isCurrentOperation(activeOperationRef.current, token, submittedShotId)) return;
      const detail = errorText(cause, "刷新失败，请稍后重试。");
      updateDraft({ type: "sync-failed", token, error: detail });
      activeOperationRef.current = null;
      setError(detail);
    } finally {
      setPending("");
    }
  }

  async function generateImages(scope: "current" | "selected" | "pending") {
    if (!activeShot || pending || hasUnsavedDraft || refreshRequired || !validImageRoute) return;
    const payloads = buildShotImageGenerationPayload(activeShot.id, selectedIds, pendingShotIds);
    const payload = { shotIds: payloads[scope].shotIds.filter(id => pendingShotIds.includes(id)) };
    if (!payload.shotIds.length) return;
    if (!window.confirm(`第 ${activeEpisode} 集首帧请求范围 ${payload.shotIds.length} 个待生成镜头；服务端按当前批次上限接收，最终数量和扣费以后端返回为准。\n单个接收镜头约 ${imageUnitEstimate} · ${imageRoute.imageProvider} / ${imageRoute.imageModel} / ${imageRoute.imageSize} / ${imageRoute.imageQuality}\n如修改模型，将同时更新项目默认模型。确认继续？`)) return;
    setPending(`image:${scope}`);
    setMessage("");
    setError("");
    try {
      await persistImageRoute(project, imageRoute);
      const result = await api.generateImages(project.id, payload);
      setMessage(buildBatchResultSummary("首帧", payload.shotIds.length, result));
    } catch (cause) {
      setError(errorText(cause, "首帧任务提交失败。"));
      setPending("");
      return;
    }
    try {
      await onRefresh(project.id);
    } catch (cause) {
      setRefreshRequired(true);
      setError(`${errorText(cause, "任务已提交，但工作台刷新失败。")} 重试刷新不会重复生成。`);
    } finally {
      setPending("");
    }
  }

  async function generateVideos() {
    if (pending || hasUnsavedDraft || refreshRequired || !validVideoRoute || !videoBatchIds.length || !window.confirm(`第 ${activeEpisode} 集视频请求范围 ${videoBatchIds.length} 个待完成片段，已排除生成中和已完成镜头；服务端按当前批次上限接收，最终数量和扣费以后端返回为准。\n实际接收片段单价 ${videoUnit} · ${videoRoute.videoProvider} / ${videoRoute.videoModel}\n如修改模型，将同时更新项目默认模型。确认继续？`)) return;
    setPending("video");
    setMessage("");
    setError("");
    try {
      await persistVideoRoute(project, videoRoute);
      const result = await api.generateVideos(project.id, { storyboardIds: videoBatchIds });
      setMessage(buildBatchResultSummary("视频", videoBatchIds.length, result));
    } catch (cause) {
      setError(errorText(cause, "项目视频任务提交失败。"));
      setPending("");
      return;
    }
    try {
      await onRefresh(project.id);
    } catch (cause) {
      setRefreshRequired(true);
      setError(`${errorText(cause, "任务已提交，但工作台刷新失败。")} 重试刷新不会重复生成。`);
    } finally {
      setPending("");
    }
  }

  return <ProductionWorkspace
    rail={<div className="wb-shot-rail">
      <header><h2>第 {activeEpisode} 集镜头</h2><small>{storyboards.length} 个镜头 · 已选 {selectedIds.length}</small></header>
      <div className="wb-shot-list">
        {storyboards.map((shot, index) => {
          const image = imageMap.get(shot.id);
          const video = videoMap.get(shot.id);
          return <div className={shot.id === activeShot?.id ? "is-active" : undefined} key={shot.id}>
            <button className="wb-shot-check" type="button" aria-label={`${selectedIds.includes(shot.id) ? "取消选择" : "选择"}镜头 ${shot.shotNo}`} aria-pressed={selectedIds.includes(shot.id)} onClick={() => toggleSelected(shot.id)}>{selectedIds.includes(shot.id) ? <CheckSquare2 /> : <Square />}</button>
            <button className="wb-shot-select" type="button" disabled={Boolean(draftState.activeOperation)} onClick={() => selectShot(shot)}>
              <span>{image?.referenceUrl ? <img src={image.referenceUrl} alt="" loading="lazy" /> : <ImageIcon />}</span>
              <span><strong>{formatShot(shot, index)}</strong><small>{shot.pictureDesc || "未提供画面描述"}</small><em>{shot.boundaryType === "CONTINUE" ? "续接尾帧" : shot.boundaryType === "CUT_MATCH" ? "匹配切换" : shot.boundaryType === "CUT_SCENE" ? "新场景" : "未设转场"} · {videoStatusLabel(resolveVideoAssetStatus(video), image)} · {shot.duration}s</em></span>
            </button>
          </div>;
        })}
        {!storyboards.length ? <p className="wb-empty-state">暂无镜头，请先在内容阶段生成镜头结构。</p> : null}
      </div>
    </div>}
    canvas={<div className="wb-shot-canvas">
      <header className="wb-shot-toolbar">
        <label className="wb-shot-episode"><span>制作范围</span><select aria-label="选择分镜剧集" value={activeEpisode} disabled={Boolean(pending || draftState.activeOperation)} onChange={event => selectEpisode(Number(event.target.value))}>{episodes.map(episode => <option key={episode} value={episode}>第 {episode} 集</option>)}</select></label>
        <div role="tablist" aria-label="镜头视图">
          <ModeButton mode="table" current={state.shotMode} icon={<Table2 />} onSelect={(mode) => dispatch({ type: "set-shot-mode", mode })}>镜头表</ModeButton>
          <ModeButton mode="image" current={state.shotMode} icon={<ImageIcon />} onSelect={(mode) => dispatch({ type: "set-shot-mode", mode })}>分镜图</ModeButton>
          <ModeButton mode="video" current={state.shotMode} icon={<Film />} onSelect={(mode) => dispatch({ type: "set-shot-mode", mode })}>视频</ModeButton>
        </div>
        <div className="wb-shot-profile" role="radiogroup" aria-label="视频分镜方案">
          <button type="button" role="radio" aria-checked={segmentProfile === "jimeng_15s"} className={segmentProfile === "jimeng_15s" ? "is-active" : undefined} disabled={Boolean(pending)} onClick={() => void changeSegmentProfile("jimeng_15s")}>即梦 15秒</button>
        </div>
        <small>{activeShot ? formatShot(activeShot, storyboards.indexOf(activeShot)) : "未选择镜头"}</small>
      </header>
      {state.shotMode === "table" ? storyboards.length ? <ShotTable storyboards={storyboards} activeShot={activeShot} onSelect={selectShot} /> : <p className="wb-empty-state">第 {activeEpisode} 集暂无镜头，请先在内容阶段拆解这一集。</p> : null}
      {state.shotMode === "image" ? <ShotImageCanvas shot={activeShot} imageUrl={activeImage?.referenceUrl} onPreview={() => activeImage?.referenceUrl && onPreview({ url: activeImage.referenceUrl, title: activeImage.name })} /> : null}
      {state.shotMode === "video" ? <ShotVideoCanvas shot={activeShot} videoUrl={activeVideo?.referenceUrl} status={resolveVideoAssetStatus(activeVideo)} onCaptureTailFrame={async (frameUrl, sourceVideoUrl) => { if (!activeShot) return; setPending("tail-frame"); setError(""); try { await api.captureStoryboardTailFrame(project.id, activeShot.id, frameUrl, sourceVideoUrl); await onRefresh(project.id); setMessage(activeShot.shotNo < storyboards.filter((item) => item.episodeNo === activeShot.episodeNo).length ? "尾帧已保存，并已作为下一镜头首帧。" : "尾帧已保存。" ); } catch (cause) { setError(errorText(cause, "尾帧保存失败，请重试。")); } finally { setPending(""); } }} /> : null}
      <div className="wb-action-feedback" aria-live="polite">{message ? <p className="wb-action-feedback--success">{message}</p> : null}{error ? <p className="wb-action-feedback--error">{error}</p> : null}</div>
    </div>}
    inspector={<div className="wb-shot-inspector">
      <header><h2>镜头参数</h2><small>{activeShot ? `场 ${activeShot.sceneNo} · 镜头 ${activeShot.shotNo}` : "未选择"}</small></header>
      {activeShot ? <ShotEditor state={draftState} onEdit={edit} onSave={saveShot} disabled={Boolean(pending)} /> : <p className="wb-empty-state">请选择镜头。</p>}
      {state.shotMode === "image" ? <section className="wb-shot-generation"><h3>首帧生成</h3><p>模型修改会同时更新项目默认模型。</p>
        <div className="wb-shot-route"><span>渠道 / 模型</span><ModelRoutePicker modality="image" providers={imageProviders.map((provider) => ({ ...provider, models: provider.models.filter((model) => !failedImageModels.has(model)) }))} modelPrices={modelPrices} value={{ providerId: imageRoute.imageProvider, model: imageRoute.imageModel }} onChange={(providerId, model) => { const pair = resolveImageRoutePair(providerId, model, providers, failedImageModels); setImageRoute((current) => ({ ...current, ...pair })); }} disabled={Boolean(pending)} /></div>
        <div className="wb-shot-route-grid"><RouteSelect label="尺寸" value={imageRoute.imageSize} options={imageOutputSizeOptions.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => setImageRoute((current) => ({ ...current, imageSize: normalizeImageOutputSize(value) }))} /><RouteSelect label="质量" value={imageRoute.imageQuality} options={imageOutputQualityOptions.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => setImageRoute((current) => ({ ...current, imageQuality: normalizeImageOutputQuality(value) }))} /></div>
        <small>单个实际接收镜头约 {imageUnitEstimate} · 服务端按当前批次上限结算</small>
        <button className="wb-primary-button" type="button" disabled={!activeShot || Boolean(pending) || refreshRequired || hasUnsavedDraft || !validImageRoute || selectedImageCount === 0} onClick={() => void generateImages(selectedIds.length ? "selected" : "current")}>{pending.startsWith("image:") ? <Loader2 className="wb-spin" /> : <WandSparkles />}{selectedIds.length ? `生成已选 ${selectedIds.length} 个首帧` : activeImage?.referenceUrl ? "当前首帧已生成" : "生成当前首帧"}</button>
        <button className="wb-secondary-button" type="button" disabled={!pendingShotIds.length || Boolean(pending) || refreshRequired || hasUnsavedDraft || !validImageRoute} onClick={() => void generateImages("pending")}>生成本集待生成首帧（{pendingShotIds.length}）</button>
      </section> : null}
      {state.shotMode === "video" ? <section className="wb-shot-generation"><h3>批量生成视频</h3><p>按已就绪首帧补齐待完成片段。需要重新生成单个镜头时，可在成片阶段选择对应镜头。</p>
        <div className="wb-video-input-preview"><div><span>本镜头首帧参考</span>{activeImage?.referenceUrl ? <img src={activeImage.referenceUrl} alt="本镜头首帧参考" /> : <strong>请先生成首帧图</strong>}</div><div><span>视频提示词</span><pre>{activeShot?.videoPrompt || "暂无视频提示词"}</pre></div></div>
        <div className="wb-shot-route"><span>渠道 / 模型</span><ModelRoutePicker modality="video" providers={videoProviders} modelPrices={modelPrices} value={{ providerId: videoRoute.videoProvider, model: videoRoute.videoModel }} onChange={(providerId, model) => setVideoRoute({ videoProvider: providerId, videoModel: model })} disabled={Boolean(pending)} /></div>
        <small>第 {activeEpisode} 集有 {eligibleVideoShotIds.length} 个待生成片段 · 本批 {videoBatchIds.length} 个，共 {videoSeconds}s · {videoUnit}，实际扣费以后端本批次结果为准</small>
        {!eligibleVideoShotIds.length ? <p>当前没有可生成片段。请先生成成功首帧，或等待现有视频任务完成。</p> : null}
        {latestVideoTask?.status === "failed" ? <p className="wb-action-feedback--error">项目视频任务失败：{latestVideoTask.errorReason || "未提供失败原因"}</p> : null}
        <button className="wb-primary-button" type="button" disabled={!eligibleVideoShotIds.length || Boolean(pending) || refreshRequired || hasUnsavedDraft || !validVideoRoute} onClick={() => void generateVideos()}>{pending === "video" ? <Loader2 className="wb-spin" /> : <Film />}生成当前批次视频</button>
      </section> : null}
      {refreshRequired ? <button className="wb-secondary-button wb-shot-refresh" type="button" disabled={pending === "refresh" || hasUnsavedDraft} onClick={() => void retryRefresh()}>{pending === "refresh" ? <Loader2 className="wb-spin" /> : null}重试刷新</button> : null}
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

function ShotVideoCanvas({ shot, videoUrl, status, onCaptureTailFrame }: { shot?: StoryboardShot; videoUrl?: string; status: ReturnType<typeof resolveVideoAssetStatus>; onCaptureTailFrame: (frameUrl: string, sourceVideoUrl: string) => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const playable = status === "succeeded" && isPersistedPlayableVideoReference(videoUrl);
  async function captureTailFrame() {
    const video = videoRef.current;
    const sourceVideoUrl = videoUrl;
    if (!video || !playable || !sourceVideoUrl) return;
    setCapturing(true);
    setCaptureError("");
    try {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
        throw new Error("视频尚未加载完成，请等待视频可播放后重试。");
      }
      video.pause();
      const targetTime = Math.max(0, video.duration - 0.08);
      if (Math.abs(video.currentTime - targetTime) > 0.01) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { clearTimeout(timer); video.removeEventListener("seeked", done); video.removeEventListener("error", failed); };
          const done = () => { cleanup(); resolve(); };
          const failed = () => { cleanup(); reject(new Error("无法读取视频尾帧，请刷新视频后重试。")); };
          const timer = setTimeout(failed, 10000);
          video.addEventListener("seeked", done, { once: true });
          video.addEventListener("error", failed, { once: true });
          video.currentTime = targetTime;
        });
      }
      if (videoRef.current !== video || video.getAttribute("src") !== sourceVideoUrl) throw new Error("镜头视频已更新，请使用最新视频重新截取。");
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器不支持视频截图");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      await onCaptureTailFrame(canvas.toDataURL("image/png"), sourceVideoUrl);
    } catch (cause) {
      setCaptureError(errorText(cause, "尾帧截取失败，请刷新视频后重试。"));
    } finally { setCapturing(false); }
  }
  return <div className="wb-shot-video"><MediaFrame aspectRatio="16:9" label="当前镜头视频">{playable ? <><video key={videoUrl} ref={videoRef} src={videoUrl} controls preload="metadata" /><button type="button" className="wb-tail-frame-button" disabled={capturing} onClick={() => void captureTailFrame()}>{capturing ? "正在截取尾帧…" : "截取尾帧并承接下一镜头"}</button></> : <div className="wb-shot-video-empty"><Film /><strong>{status === "failed" ? "当前片段生成失败" : status === "running" ? "当前片段生成中" : "视频待生成"}</strong><span>{shot?.videoPrompt || "当前镜头尚无可播放片段"}</span></div>}</MediaFrame>{captureError ? <p className="wb-inline-error" role="alert">{captureError}</p> : null}</div>;
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

function videoStatusLabel(status: ReturnType<typeof resolveVideoAssetStatus>, image?: { status: string; referenceUrl?: string }) {
  if (status === "succeeded") return "视频已生成";
  if (status === "running") return "视频生成中";
  if (status === "failed") return "视频生成失败";
  return image?.status === "succeeded" && image.referenceUrl ? "首帧已生成" : "待生成";
}

function nextOperationToken(kind: "save" | "refresh", shotId: string, sequence: { current: number }) {
  sequence.current += 1;
  return `${kind}:${shotId}:${sequence.current}`;
}

function isCurrentOperation(operation: { token: string; shotId: string } | null, token: string, shotId: string) {
  return operation?.token === token && operation.shotId === shotId;
}
