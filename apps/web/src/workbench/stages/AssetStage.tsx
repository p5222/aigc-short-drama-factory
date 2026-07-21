import {
  BookOpenCheck,
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
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import type { AssetItem, ModelPrice, ModelProvider, Project, ProjectWorkflow, QualityReport, UserFeedback } from "@aifilm/shared";
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
  buildAssetFeedbackTarget,
  buildCharacterGenerationPayload,
  deriveSceneAssetList,
  listCharacterReferenceAssets,
  reconcileActiveAsset,
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
    () => workflow.assets.filter((asset) => asset.type === "role" || asset.type === "role_derivative" || asset.type === "role_reference"),
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
  const latestReport = latestScopedReport(workflow.qualityReports ?? [], feedbackTarget.stage, feedbackTarget.assetId);
  const recentFeedback = (workflow.feedbacks ?? []).filter((item) => (
    item.stage === feedbackTarget.stage
    && (!feedbackTarget.assetId || item.assetId === feedbackTarget.assetId)
  )).length;

  const [referenceUrl, setReferenceUrl] = useState("");
  const [pendingKey, setPendingKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (sameActiveAsset(state.activeAsset, activeAsset)) return;
    dispatch({ type: "set-asset", asset: activeAsset });
  }, [activeAsset?.id, activeAsset?.type, dispatch, state.activeAsset?.id, state.activeAsset?.type]);

  function selectAsset(asset: ActiveAsset) {
    setMessage("");
    setError("");
    dispatch({ type: "set-asset", asset });
  }

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setPendingKey(key);
    setMessage("");
    setError("");
    try {
      await action();
      await onRefresh(project.id);
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请稍后重试。");
    } finally {
      setPendingKey("");
    }
  }

  async function saveReference(url: string) {
    if (!activeCharacter || !url.trim()) return;
    await run(
      `reference:${activeCharacter.id}`,
      () => api.setCharacterReferenceImage(project.id, activeCharacter.id, {
        referenceUrl: url.trim(),
        description: `${activeCharacter.name} 创作者上传参考设定图`
      }),
      "创作者参考图已保存，不会覆盖生成身份板。"
    );
    setReferenceUrl("");
  }

  async function uploadReference(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await saveReference(await fileToDataUrl(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "参考图读取失败。");
    }
  }

  function deleteReferences() {
    if (!activeCharacter || !window.confirm(`确认清空「${activeCharacter.name}」的创作者参考图？生成身份板不会被删除。`)) return;
    void run(
      `reference:${activeCharacter.id}`,
      () => api.deleteCharacterReferenceImage(project.id, activeCharacter.id),
      "创作者参考图已清空，生成身份板保持不变。"
    );
  }

  function generateCurrent() {
    if (activeCharacter) {
      void run(
        `generate:${activeCharacter.id}`,
        () => api.generateCharacterImages(project.id, buildCharacterGenerationPayload(activeCharacter.id, Boolean(identityAsset?.referenceUrl))),
        `${activeCharacter.name} 的身份板生成任务已完成。`
      );
    } else if (activeScene) {
      void run(
        `generate:${activeScene.id}`,
        () => api.generateSceneImage(project.id, activeScene.id),
        `${activeScene.name} 的场景图已生成并进入后续分镜参考。`
      );
    }
  }

  function evaluateCurrent() {
    void run(
      `evaluate:${feedbackTarget.stage}`,
      () => api.generateQualityReports(project.id, { stages: [feedbackTarget.stage] }),
      `${feedbackTarget.label}评测已更新，结果会用于后续优化。`
    );
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
            <button type="button" className={mode === "character" ? "is-active" : undefined} aria-pressed={mode === "character"} onClick={() => characters[0] && selectAsset({ type: "character", id: characters[0].id })} disabled={!characters.length}>
              <UserRound aria-hidden="true" />角色 <span>{characters.length}</span>
            </button>
            <button type="button" className={mode === "scene" ? "is-active" : undefined} aria-pressed={mode === "scene"} onClick={() => sceneAssets[0] && selectAsset({ type: "scene", id: sceneAssets[0].id })} disabled={!sceneAssets.length}>
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
            <small>{mediaUrl ? "真实生成结果" : "等待生成"}</small>
          </header>
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
            pending={pendingKey.startsWith("generate:")}
            actionLabel={activeCharacter ? (identityAsset?.referenceUrl ? "重新生成身份板" : "生成身份板") : activeScene?.referenceUrl ? "重新生成场景图" : "生成场景图"}
            onGenerate={generateCurrent}
            onRefresh={onRefresh}
          />
          {activeCharacter ? (
            <section className="wb-inspector-section">
              <header><strong>创作者参考</strong><small>{referenceAssets.length} 张</small></header>
              <p>仅作为生成参考，不会替代或删除身份板。</p>
              <div className="wb-reference-list">
                {referenceAssets.map((asset) => <button key={asset.id} type="button" onClick={() => asset.referenceUrl && onPreview({ url: asset.referenceUrl, title: `${activeCharacter.name} 参考图` })}><img src={asset.referenceUrl} alt={`${activeCharacter.name} 参考图`} loading="lazy" /></button>)}
                {!referenceAssets.length ? <span>尚未上传参考图</span> : null}
              </div>
              <label className="wb-reference-url"><span>图片 URL</span><span><input value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} placeholder="粘贴图片 URL" /><button className="wb-icon-button" type="button" aria-label="保存参考图" disabled={!referenceUrl.trim() || pendingKey.startsWith("reference:")} onClick={() => void saveReference(referenceUrl)}><Save aria-hidden="true" /></button></span></label>
              <div className="wb-reference-actions">
                <label className="wb-secondary-button"><Upload aria-hidden="true" />上传参考图<input type="file" accept="image/*" disabled={pendingKey.startsWith("reference:")} onChange={(event) => void uploadReference(event)} /></label>
                <button className="wb-icon-button wb-icon-button--danger" type="button" aria-label="清空创作者参考图" disabled={!referenceAssets.length || pendingKey.startsWith("reference:")} onClick={deleteReferences}><Trash2 aria-hidden="true" /></button>
              </div>
            </section>
          ) : null}
          <section className="wb-inspector-section">
            <header><strong>{feedbackTarget.label}</strong><button className="wb-text-button" type="button" disabled={pendingKey.startsWith("evaluate:") || (!identityAsset && !activeScene?.referenceUrl)} onClick={evaluateCurrent}>{pendingKey.startsWith("evaluate:") ? <Loader2 className="wb-spin" aria-hidden="true" /> : <BookOpenCheck aria-hidden="true" />}运行评测</button></header>
            <QualitySummary report={latestReport} />
            <FeedbackForm projectId={project.id} target={feedbackTarget} recentCount={recentFeedback} disabled={!feedbackTarget.assetId} onRefresh={onRefresh} />
          </section>
          <div className="wb-action-feedback" aria-live="polite">
            {message ? <p className="wb-action-feedback--success">{message}</p> : null}
            {error ? <p className="wb-action-feedback--error">{error}</p> : null}
          </div>
        </div>
      )}
    />
  );
}

function AssetListButton({ selected, name, detail, status, imageUrl, fallback, onClick }: { selected: boolean; name: string; detail: string; status: string; imageUrl?: string; fallback: ReactNode; onClick: () => void }) {
  return <button type="button" className={selected ? "is-selected" : undefined} aria-pressed={selected} onClick={onClick}><span className="wb-asset-list__thumb">{imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : fallback}</span><span className="wb-asset-list__copy"><strong>{name}</strong><small>{detail}</small></span><em>{status}</em></button>;
}

function AssetDetail({ label, value }: { label: string; value: string }) {
  return <section><h2>{label}</h2><p>{value || "未提供"}</p></section>;
}

function AssetImageRoute({ project, providers, modelPrices, disabled, pending, actionLabel, onGenerate, onRefresh }: { project: Project; providers: ModelProvider[]; modelPrices: ModelPrice[]; disabled: boolean; pending: boolean; actionLabel: string; onGenerate: () => void; onRefresh: (projectId: string) => Promise<ProjectWorkflow> }) {
  const imageProviders = providers.filter((provider) => provider.modality === "image" && provider.enabled);
  const [draft, setDraft] = useState(() => routeDraft(project, imageProviders));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const models = (imageProviders.find((provider) => provider.id === draft.imageProvider)?.models ?? [draft.imageModel]).filter((model) => !failedImageModels.has(model));
  const unitCredits = modelPrices.find((price) => price.enabled && price.modality === "image" && price.providerId === draft.imageProvider && price.model === draft.imageModel)?.unitCredits
    ?? modelPrices.find((price) => price.enabled && price.modality === "image" && price.model === draft.imageModel)?.unitCredits
    ?? 8;
  const estimate = estimateImageCredits(unitCredits, draft.imageSize, draft.imageQuality);

  useEffect(() => setDraft(routeDraft(project, imageProviders)), [project.id, project.imageProvider, project.imageModel, project.imageSize, project.imageQuality]);

  function selectProvider(providerId: string) {
    const nextModel = imageProviders.find((provider) => provider.id === providerId)?.models.find((model) => !failedImageModels.has(model));
    setDraft((current) => ({ ...current, imageProvider: providerId, imageModel: nextModel ?? current.imageModel }));
  }

  async function applyAndGenerate() {
    setSaving(true);
    setError("");
    try {
      await api.updateProjectModelRoutes(project.id, draft);
      await onRefresh(project.id);
      onGenerate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型路由保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return <section className="wb-route-panel"><header><strong><SlidersHorizontal aria-hidden="true" />图片模型</strong><small>预计 {estimate} 积分</small></header><label><span>渠道</span><select value={draft.imageProvider} onChange={(event) => selectProvider(event.target.value)}>{imageProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label><label><span>模型</span><select value={draft.imageModel} onChange={(event) => setDraft((current) => ({ ...current, imageModel: event.target.value }))}>{models.map((model) => <option key={model} value={model}>{model}</option>)}</select></label><div className="wb-route-grid"><label><span>尺寸</span><select value={draft.imageSize} onChange={(event) => setDraft((current) => ({ ...current, imageSize: normalizeImageOutputSize(event.target.value) }))}>{imageOutputSizeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>质量</span><select value={draft.imageQuality} onChange={(event) => setDraft((current) => ({ ...current, imageQuality: normalizeImageOutputQuality(event.target.value) }))}>{imageOutputQualityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div><button className="wb-primary-button" type="button" disabled={disabled || pending || saving || !draft.imageProvider || !draft.imageModel} onClick={() => void applyAndGenerate()}>{pending || saving ? <Loader2 className="wb-spin" aria-hidden="true" /> : <WandSparkles aria-hidden="true" />}{actionLabel}</button>{error ? <p className="wb-action-feedback--error">{error}</p> : null}</section>;
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
    try {
      await api.submitFeedback({ projectId, assetId: target.assetId, stage: target.stage, rating, usability, tags: [], content, source: "creator_workbench" });
      setContent("");
      setMessage("反馈已回流质量中心。");
      await onRefresh(projectId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "反馈提交失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="wb-feedback-form"><small>已回流 {recentCount} 条反馈</small><div><label><span>评分</span><select value={rating} onChange={(event) => setRating(Number(event.target.value))}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} 分</option>)}</select></label><label><span>可用性</span><select value={usability} onChange={(event) => setUsability(event.target.value as UserFeedback["usability"])}><option value="usable">可用</option><option value="barely_usable">勉强可用</option><option value="unusable">不可用</option></select></label></div><label><span>说明</span><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="记录需要继续优化的具体问题" /></label><button className="wb-secondary-button" type="button" disabled={disabled || submitting} onClick={() => void submit()}>{submitting ? "提交中" : "提交反馈"}</button>{message ? <p className="wb-action-feedback--success">{message}</p> : null}{error ? <p className="wb-action-feedback--error">{error}</p> : null}</div>;
}

function QualitySummary({ report }: { report?: QualityReport }) {
  if (!report) return <p className="wb-quality-empty">当前资产尚未评测。</p>;
  return <div className="wb-quality-summary"><strong>{report.totalScore} 分</strong><span>{report.pass ? "可继续优化生产" : "建议先处理问题"}</span><p>{report.problems[0] || report.suggestions[0] || report.recommendedAction}</p></div>;
}

function latestScopedReport(reports: QualityReport[], stage: QualityReport["stage"], assetId?: string) {
  return [...reports].filter((report) => report.stage === stage && (!assetId || !report.assetId || report.assetId === assetId)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

function routeDraft(project: Project, providers: ModelProvider[]) {
  return {
    imageProvider: project.imageProvider ?? providers[0]?.id ?? "",
    imageModel: project.imageModel && !failedImageModels.has(project.imageModel) ? project.imageModel : "wan2.6-t2i",
    imageSize: normalizeImageOutputSize(project.imageSize),
    imageQuality: normalizeImageOutputQuality(project.imageQuality)
  };
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
