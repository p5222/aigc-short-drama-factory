import {
  Image as ImageIcon,
  Loader2,
  MapPin,
  Save,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserRound,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { AssetItem, ModelPrice, ModelProvider, Project, ProjectWorkflow, UserFeedback } from "@aifilm/shared";
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
import { InlineNotice } from "../../design-system/ui";
import { MediaFrame } from "../components/MediaCanvas";
import { ProductionWorkspace } from "../components/ProductionWorkspace";
import {
  buildAssetFeedbackTarget,
  buildCharacterGenerationPayload,
  commitMutationThenSync,
  deriveSceneAssetList,
  listCharacterReferenceAssets,
  reconcileActiveAsset,
  resolveImageRoutePair,
  resolveImageUnitCredits,
  updateCharacterReferenceDraft,
  resolveCharacterIdentityAsset,
  type ActiveAsset
} from "../model";
import { useWorkbench } from "../WorkbenchContext";

interface AssetStageProps {
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  railOpen: boolean;
  inspectorOpen: boolean;
  onCloseRail: () => void;
  onCloseInspector: () => void;
  onRefresh: (projectId: string) => Promise<ProjectWorkflow>;
  onPreview: (preview: { url: string; title: string }) => void;
}

const failedImageModels = new Set(["wanx-v1", "wan2.5-t2i-preview"]);

export function AssetStage(props: AssetStageProps) {
  const { workflow } = useWorkbench();
  if (!workflow) return null;
  return <LoadedAssetStage {...props} workflow={workflow} />;
}

function LoadedAssetStage({
  workflow,
  providers,
  modelPrices,
  railOpen,
  inspectorOpen,
  onCloseRail,
  onCloseInspector,
  onRefresh,
  onPreview
}: AssetStageProps & { workflow: ProjectWorkflow }) {
  const { state, dispatch } = useWorkbench();
  const { project, characters } = workflow;
  const roleAssets = useMemo(
    () => workflow.assets.filter((asset) => !asset.isHistorical && (asset.type === "role" || asset.type === "role_derivative" || asset.type === "role_reference")),
    [workflow.assets]
  );
  const sceneAssets = useMemo(() => deriveSceneAssetList(workflow.assets), [workflow.assets]);
  const activeAsset = reconcileActiveAsset(state.activeAsset, characters, sceneAssets);
  const activeCharacter = activeAsset?.type === "character"
    ? characters.find((character) => character.id === activeAsset.id)
    : undefined;
  const activeScene = activeAsset?.type === "scene"
    ? sceneAssets.find((asset) => asset.id === activeAsset.id)
    : undefined;
  const identityAsset = activeCharacter ? resolveCharacterIdentityAsset(activeCharacter, roleAssets) : undefined;
  const referenceAssets = activeCharacter ? listCharacterReferenceAssets(activeCharacter.id, roleAssets) : [];
  const feedbackTarget = buildAssetFeedbackTarget({
    type: activeAsset?.type ?? "character",
    asset: activeAsset?.type === "scene" ? activeScene : identityAsset
  });
  const recentFeedback = (workflow.feedbacks ?? []).filter((item) => (
    item.stage === feedbackTarget.stage
    && (!feedbackTarget.assetId || item.assetId === feedbackTarget.assetId)
  )).length;

  const [referenceDrafts, setReferenceDrafts] = useState<Record<string, string>>({});
  const [pendingKey, setPendingKey] = useState("");
  const mutationPending = useRef(false);
  const [routeSaving, setRouteSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refreshRequired, setRefreshRequired] = useState<{ success: string } | null>(null);
  const assetBusy = Boolean(pendingKey) || routeSaving;
  const actionsBlocked = assetBusy || Boolean(refreshRequired);

  useEffect(() => {
    if (sameActiveAsset(state.activeAsset, activeAsset)) return;
    dispatch({ type: "set-asset", asset: activeAsset });
  }, [activeAsset?.id, activeAsset?.type, dispatch, state.activeAsset?.id, state.activeAsset?.type]);

  function selectAsset(asset: ActiveAsset) {
    if (assetBusy) return;
    setMessage("");
    setError("");
    dispatch({ type: "set-asset", asset });
  }

  async function runMutation(key: string, action: () => Promise<unknown>, success: string): Promise<boolean> {
    if (mutationPending.current || refreshRequired) return false;
    mutationPending.current = true;
    setPendingKey(key);
    setMessage("");
    setError("");
    const result = await commitMutationThenSync(action, () => onRefresh(project.id));
    if (result.status === "mutation-failed") {
      setError(errorMessage(result.error, "操作失败，请稍后重试。"));
      setPendingKey("");
      mutationPending.current = false;
      return false;
    }
    if (result.status === "sync-required") {
      setRefreshRequired({ success });
      setMessage(`${success} 项目数据暂未刷新，请重试刷新；不会重复提交生成或保存。`);
    } else {
      setRefreshRequired(null);
      setMessage(success);
    }
    setPendingKey("");
    mutationPending.current = false;
    return true;
  }

  async function retryRefresh() {
    if (!refreshRequired || mutationPending.current) return;
    mutationPending.current = true;
    setPendingKey("refresh");
    setError("");
    try {
      await onRefresh(project.id);
      setMessage(`${refreshRequired.success} 项目数据已刷新。`);
      setRefreshRequired(null);
    } catch (cause) {
      setMessage(`${refreshRequired.success} 项目数据仍未刷新，但操作不会重复提交。`);
      setError(errorMessage(cause, "刷新失败，请稍后重试。"));
    } finally {
      setPendingKey("");
      mutationPending.current = false;
    }
  }

  async function saveReference(character: typeof activeCharacter, url: string) {
    if (!character || !url.trim()) return;
    const persisted = await runMutation(
      `reference:${character.id}`,
      () => api.setCharacterReferenceImage(project.id, character.id, {
        referenceUrl: url.trim(),
        description: `${character.name} 创作者上传参考设定图`
      }),
      "创作者参考图已保存，不会覆盖生成身份板。"
    );
    if (persisted) setReferenceDrafts((current) => updateCharacterReferenceDraft(current, character.id, ""));
  }

  async function uploadReference(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || actionsBlocked || mutationPending.current) return;
    const character = activeCharacter;
    if (!character) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setError("请上传 8 MB 以内的 PNG、JPEG、WebP 或 GIF 图片。");
      return;
    }
    const persisted = await runMutation(`reference:${character.id}`, async () => {
      const referenceUrl = await fileToDataUrl(file);
      await api.setCharacterReferenceImage(project.id, character.id, { referenceUrl, description: `${character.name} 创作者上传参考设定图` });
    }, "创作者参考图已保存，不会覆盖生成身份板。");
    if (persisted) setReferenceDrafts(current => updateCharacterReferenceDraft(current, character.id, ""));
  }

  function deleteReferences() {
    if (actionsBlocked || !activeCharacter || !window.confirm(`确认清空「${activeCharacter.name}」的创作者参考图？生成身份板不会被删除。`)) return;
    void runMutation(
      `reference:${activeCharacter.id}`,
      () => api.deleteCharacterReferenceImage(project.id, activeCharacter.id),
      "创作者参考图已清空，生成身份板保持不变。"
    );
  }

  async function generateCurrent() {
    if (activeCharacter) {
      await runMutation(
        `generate:${activeCharacter.id}`,
        () => api.generateCharacterImages(project.id, buildCharacterGenerationPayload(activeCharacter.id, Boolean(identityAsset?.referenceUrl))),
        `${activeCharacter.name} 的身份板生成任务已完成。`
      );
    } else if (activeScene) {
      await runMutation(
        `generate:${activeScene.id}`,
        () => api.generateSceneImage(project.id, activeScene.id),
        `${activeScene.name} 的场景图已生成并进入后续分镜参考。`
      );
    }
  }

  const mediaUrl = activeCharacter ? identityAsset?.referenceUrl : activeScene?.referenceUrl;
  const mediaTitle = activeCharacter?.name ?? activeScene?.name ?? "资产";
  const mode: ActiveAsset["type"] = activeAsset?.type ?? (characters.length ? "character" : "scene");

  return (
    <ProductionWorkspace
      railOpen={railOpen}
      inspectorOpen={inspectorOpen}
      onCloseRail={onCloseRail}
      onCloseInspector={onCloseInspector}
      rail={(
        <div className="wb-asset-rail">
          <div className="wb-region-section">
            <h2 className="wb-region-heading">角色与场景</h2>
            <p className="wb-region-copy">选择真实资产，集中检查生成结果与参考资料。</p>
          </div>
          <div className="wb-asset-mode" role="group" aria-label="资产类型">
            <button type="button" className={mode === "character" ? "is-active" : undefined} aria-pressed={mode === "character"} onClick={() => characters[0] && selectAsset({ type: "character", id: characters[0].id })} disabled={assetBusy || !characters.length}>
              <UserRound aria-hidden="true" />角色 <span>{characters.length}</span>
            </button>
            <button type="button" className={mode === "scene" ? "is-active" : undefined} aria-pressed={mode === "scene"} onClick={() => sceneAssets[0] && selectAsset({ type: "scene", id: sceneAssets[0].id })} disabled={assetBusy || !sceneAssets.length}>
              <MapPin aria-hidden="true" />场景 <span>{sceneAssets.length}</span>
            </button>
          </div>
          <div className="wb-asset-list" aria-label={mode === "character" ? "角色列表" : "场景列表"}>
            {mode === "character" ? characters.map((character) => {
              const identity = resolveCharacterIdentityAsset(character, roleAssets);
              return (
                <AssetListButton
                  key={character.id}
                  selected={activeCharacter?.id === character.id}
                  disabled={assetBusy}
                  name={character.name}
                  detail={character.identity || "未提供身份描述"}
                  status={identity?.referenceUrl ? "身份板已生成" : "待生成"}
                  imageUrl={identity?.referenceUrl}
                  fallback={<UserRound aria-hidden="true" />}
                  onClick={() => selectAsset({ type: "character", id: character.id })}
                />
              );
            }) : sceneAssets.map((asset) => (
              <AssetListButton
                key={asset.id}
                selected={activeScene?.id === asset.id}
                disabled={assetBusy}
                name={asset.name}
                detail={asset.type === "prop" ? "关键道具" : "环境场景"}
                status={asset.referenceUrl ? "场景图已生成" : "待生成"}
                imageUrl={asset.referenceUrl}
                fallback={asset.type === "prop" ? <ImageIcon aria-hidden="true" /> : <MapPin aria-hidden="true" />}
                onClick={() => selectAsset({ type: "scene", id: asset.id })}
              />
            ))}
            {mode === "character" && !characters.length ? <p className="wb-empty-state">暂无角色，请先完成内容阶段。</p> : null}
            {mode === "scene" && !sceneAssets.length ? <p className="wb-empty-state">暂无场景资产，请先生成镜头结构。</p> : null}
          </div>
        </div>
      )}
      canvas={(
        <div className="wb-asset-canvas">
          <header className="wb-asset-canvas__heading">
            <div><span>{mode === "character" ? "生成身份板" : activeScene?.type === "prop" ? "关键道具" : "环境场景"}</span><h1>{mediaTitle}</h1></div>
            <small>{mediaUrl ? "当前版本 · 点击查看大图" : "等待生成"}</small>
          </header>
          {message ? <InlineNotice tone="success" onDismiss={() => setMessage("")}>{message}</InlineNotice> : null}
          {error ? <InlineNotice tone="error" onDismiss={() => setError("")}>{error}</InlineNotice> : null}
          <button className="wb-asset-media-button" type="button" disabled={!mediaUrl} onClick={() => mediaUrl && onPreview({ url: mediaUrl, title: mediaTitle })} aria-label={mediaUrl ? `预览${mediaTitle}` : `${mediaTitle}尚未生成`}>
            <MediaFrame aspectRatio={activeCharacter ? "16:9" : project.videoRatio} label={`${mediaTitle}媒体预览`}>
              {mediaUrl ? <img src={mediaUrl} alt={mediaTitle} loading="eager" decoding="async" /> : <div className="wb-asset-media-empty">{mode === "character" ? <UserRound aria-hidden="true" /> : <MapPin aria-hidden="true" />}<strong>{mode === "character" ? "身份板待生成" : "场景概念图待生成"}</strong></div>}
            </MediaFrame>
          </button>
          {activeCharacter ? (
            <div className="wb-asset-details">
              <AssetDetail label="身份" value={activeCharacter.identity} />
              <AssetDetail label="外观" value={activeCharacter.appearance} />
              <AssetDetail label="服装" value={activeCharacter.costume} />
              <AssetDetail label="性格" value={activeCharacter.personality} />
            </div>
          ) : activeScene ? (
            <div className="wb-asset-details wb-asset-details--scene">
              <AssetDetail label="场景描述" value={activeScene.description || "未提供场景描述"} />
              <AssetDetail label="生成提示" value={activeScene.prompt || "未提供生成提示"} />
            </div>
          ) : <p className="wb-empty-state wb-empty-state--canvas">当前没有可用资产。</p>}
        </div>
      )}
      inspector={(
        <div className="wb-asset-inspector">
          <div className="wb-region-section">
            <h2 className="wb-region-heading">生成与反馈</h2>
            <p className="wb-region-copy">生成前选择模型会更新项目默认图片路由。</p>
          </div>
          <AssetImageRoute
            project={project}
            providers={providers}
            modelPrices={modelPrices}
            disabled={!activeCharacter && !activeScene}
            pending={Boolean(pendingKey)}
            refreshRequired={Boolean(refreshRequired)}
            actionLabel={activeCharacter ? (identityAsset?.referenceUrl ? "重新生成身份板" : "生成身份板") : activeScene?.referenceUrl ? "重新生成场景图" : "生成场景图"}
            onGenerate={generateCurrent}
            onRetryRefresh={retryRefresh}
            onRefresh={onRefresh}
            onBusyChange={setRouteSaving}
          />
          {activeCharacter ? (
            <section className="wb-inspector-section">
              <header><strong>创作者参考</strong><small>{referenceAssets.length} 张</small></header>
              <p>仅作为生成参考，不会替代或删除身份板。</p>
              <div className="wb-reference-list">
                {referenceAssets.map((asset) => <button key={asset.id} type="button" onClick={() => asset.referenceUrl && onPreview({ url: asset.referenceUrl, title: `${activeCharacter.name} 参考图` })}><img src={asset.referenceUrl} alt={`${activeCharacter.name} 参考图`} loading="lazy" /></button>)}
                {!referenceAssets.length ? <span>尚未上传参考图</span> : null}
              </div>
              <label className="wb-reference-url"><span>图片 URL</span><span><input disabled={actionsBlocked} value={referenceDrafts[activeCharacter.id] ?? ""} onChange={(event) => setReferenceDrafts((current) => updateCharacterReferenceDraft(current, activeCharacter.id, event.target.value))} placeholder="粘贴图片 URL" /><button className="wb-icon-button wb-labelled-action" type="button" aria-label="保存参考图" disabled={!referenceDrafts[activeCharacter.id]?.trim() || actionsBlocked} onClick={() => void saveReference(activeCharacter, referenceDrafts[activeCharacter.id] ?? "")}><Save aria-hidden="true" /><span>保存</span></button></span></label>
              <div className="wb-reference-actions">
                <label className="wb-secondary-button"><Upload aria-hidden="true" />{pendingKey.startsWith("reference:") ? "正在保存参考图…" : "上传参考图"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={actionsBlocked} onChange={(event) => void uploadReference(event)} /></label>
                <button className="wb-icon-button wb-labelled-action wb-icon-button--danger" type="button" aria-label="清空创作者参考图" disabled={!referenceAssets.length || actionsBlocked} onClick={deleteReferences}><Trash2 aria-hidden="true" /><span>清空参考图</span></button>
              </div>
              <p className="wb-task-hint">支持 PNG、JPEG、WebP、GIF，单张不超过 8 MB。{assetBusy ? "当前操作处理中，完成后可修改参考图。" : ""}</p>
            </section>
          ) : null}
          <section className="wb-inspector-section">
            <header><strong>{feedbackTarget.label}</strong><small>反馈仅归属当前选中资产</small></header>
            <FeedbackForm projectId={project.id} target={feedbackTarget} recentCount={recentFeedback} disabled={!feedbackTarget.assetId} onRefresh={onRefresh} />
          </section>
        </div>
      )}
    />
  );
}

function AssetListButton({ selected, disabled, name, detail, status, imageUrl, fallback, onClick }: { selected: boolean; disabled?: boolean; name: string; detail: string; status: string; imageUrl?: string; fallback: ReactNode; onClick: () => void }) {
  return <button type="button" disabled={disabled} className={selected ? "is-selected" : undefined} aria-pressed={selected} onClick={onClick}><span className="wb-asset-list__thumb">{imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : fallback}</span><span className="wb-asset-list__copy"><strong>{name}</strong><small>{detail}</small></span><em>{status}</em></button>;
}

function AssetDetail({ label, value }: { label: string; value: string }) {
  return <section><h2>{label}</h2><p>{value || "未提供"}</p></section>;
}

function AssetImageRoute({
  project,
  providers,
  modelPrices,
  disabled,
  pending,
  refreshRequired,
  actionLabel,
  onGenerate,
  onRetryRefresh,
  onRefresh,
  onBusyChange
}: {
  project: Project;
  providers: ModelProvider[];
  modelPrices: ModelPrice[];
  disabled: boolean;
  pending: boolean;
  refreshRequired: boolean;
  actionLabel: string;
  onGenerate: () => Promise<void>;
  onRetryRefresh: () => Promise<void>;
  onRefresh: (projectId: string) => Promise<ProjectWorkflow>;
  onBusyChange: (busy: boolean) => void;
}) {
  const imageProviders = providers.filter((provider) => provider.modality === "image" && provider.enabled);
  const pickerProviders = imageProviders
    .map((provider) => ({ ...provider, models: provider.models.filter((model) => !failedImageModels.has(model)) }))
    .filter((provider) => provider.models.length > 0);
  const [draft, setDraft] = useState(() => routeDraft(project, providers));
  const [saving, setSaving] = useState(false);
  const generationPending = useRef(false);
  const [error, setError] = useState("");
  const selectedProvider = imageProviders.find((provider) => provider.id === draft.imageProvider);
  const models = selectedProvider?.models.filter((model) => !failedImageModels.has(model)) ?? [];
  const route = buildModelCatalog(pickerProviders, modelPrices).find(item => item.provider.id === draft.imageProvider && item.model === draft.imageModel);
  const validPair = models.includes(draft.imageModel) && Boolean(route?.selectable);
  const estimate = route?.price ? `${estimateImageCredits(route.price.unitCredits, draft.imageSize, draft.imageQuality)} 积分` : "报价时确认";

  // 注意：providers 每次轮询都是新数组引用，放进依赖会导致用户改到一半的渠道/模型
  // 每 4 秒被重置回项目默认值（表现为"切换模型自动跳回通义万相"）。
  // 只在项目路由字段真正变化时重建草稿。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(routeDraft(project, providers)), [project.id, project.imageProvider, project.imageModel, project.imageSize, project.imageQuality]);

  async function applyAndGenerate() {
    if (!validPair || disabled || pending || generationPending.current || refreshRequired) return;
    generationPending.current = true;
    setSaving(true);
    onBusyChange(true);
    setError("");
    try {
      const routeResult = await commitMutationThenSync(
        () => api.updateProjectModelRoutes(project.id, draft),
        () => onRefresh(project.id)
      );
      if (routeResult.status === "mutation-failed") {
        setError(errorMessage(routeResult.error, "模型路由保存失败。"));
        return;
      }
      await onGenerate();
    } catch (cause) {
      setError(errorMessage(cause, "生成请求未能完成，请核对任务记录。"));
    } finally {
      generationPending.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }

  const blocked = disabled || pending || saving || refreshRequired;
  return <section className="wb-route-panel"><header><strong><SlidersHorizontal aria-hidden="true" />图片模型</strong><small>预计：{estimate}</small></header><div className="mrp-field"><span>渠道 / 模型</span><ModelRoutePicker modality="image" providers={pickerProviders} modelPrices={modelPrices} value={{ providerId: draft.imageProvider, model: draft.imageModel }} onChange={(providerId, model) => setDraft((current) => ({ ...current, ...resolveImageRoutePair(providerId, model, providers, failedImageModels) }))} disabled={blocked} /></div><div className="wb-route-grid"><label><span>尺寸</span><select disabled={blocked} value={draft.imageSize} onChange={(event) => setDraft((current) => ({ ...current, imageSize: normalizeImageOutputSize(event.target.value) }))}>{imageOutputSizeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>质量</span><select disabled={blocked} value={draft.imageQuality} onChange={(event) => setDraft((current) => ({ ...current, imageQuality: normalizeImageOutputQuality(event.target.value) }))}>{imageOutputQualityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div><button className="wb-primary-button" type="button" disabled={disabled || pending || saving || (!refreshRequired && !validPair)} onClick={() => void (refreshRequired ? onRetryRefresh() : applyAndGenerate())}>{pending || saving ? <Loader2 className="wb-spin" aria-hidden="true" /> : refreshRequired ? <Save aria-hidden="true" /> : <WandSparkles aria-hidden="true" />}{pending || saving ? "正在处理…" : refreshRequired ? "重试刷新" : actionLabel}</button>{error ? <p className="wb-action-feedback--error" role="alert">{error}</p> : null}</section>;
}
function FeedbackForm({ projectId, target, recentCount, disabled, onRefresh }: { projectId: string; target: ReturnType<typeof buildAssetFeedbackTarget>; recentCount: number; disabled: boolean; onRefresh: (projectId: string) => Promise<ProjectWorkflow> }) {
  const [rating, setRating] = useState(4);
  const [usability, setUsability] = useState<UserFeedback["usability"]>("usable");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    if (!target.assetId) return;
    setSubmitting(true);
    setMessage("");
    setError("");
    const result = await commitMutationThenSync(
      () => api.submitFeedback({ projectId, assetId: target.assetId, stage: target.stage, rating, usability, tags: [], content, source: "creator_workbench" }),
      () => onRefresh(projectId)
    );
    if (result.status === "mutation-failed") {
      setError(errorMessage(result.error, "反馈提交失败。"));
    } else {
      setContent("");
      setMessage(result.status === "synced"
        ? "反馈已回流质量中心。"
        : "反馈已回流质量中心；当前列表暂未刷新。"
      );
    }
    setSubmitting(false);
  }

  return <div className="wb-feedback-form"><small>已回流 {recentCount} 条反馈</small><div><label><span>评分</span><select value={rating} onChange={(event) => setRating(Number(event.target.value))}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} 分</option>)}</select></label><label><span>可用性</span><select value={usability} onChange={(event) => setUsability(event.target.value as UserFeedback["usability"])}><option value="usable">可用</option><option value="barely_usable">勉强可用</option><option value="unusable">不可用</option></select></label></div><label><span>说明</span><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="记录需要继续优化的具体问题" /></label><button className="wb-secondary-button" type="button" disabled={disabled || submitting} onClick={() => void submit()}>{submitting ? "提交中" : "提交反馈"}</button>{message ? <p className="wb-action-feedback--success">{message}</p> : null}{error ? <p className="wb-action-feedback--error">{error}</p> : null}</div>;
}

function routeDraft(project: Project, providers: ModelProvider[]) {
  const pair = resolveImageRoutePair(project.imageProvider, project.imageModel, providers, failedImageModels);
  return {
    ...pair,
    imageSize: normalizeImageOutputSize(project.imageSize),
    imageQuality: normalizeImageOutputQuality(project.imageQuality)
  };
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function sameActiveAsset(left: ActiveAsset | null, right: ActiveAsset | null) {
  return left?.type === right?.type && left?.id === right?.id;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("参考图读取失败。"));
    reader.onerror = () => reject(reader.error ?? new Error("参考图读取失败。"));
    reader.readAsDataURL(file);
  });
}
