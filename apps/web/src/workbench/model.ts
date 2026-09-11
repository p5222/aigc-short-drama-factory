import type { AssetItem, CharacterProfile, EvaluationStage, ModelPrice, ModelProvider, Project, ProjectWorkflow, ScriptDraft, StoryboardShot, TaskStatus, TaskType } from "@aifilm/shared";
import { isPersistedPlayableVideoReference } from "@aifilm/shared";

export { resolveImageUnitCredits } from "@aifilm/shared";
export { isPersistedPlayableVideoReference } from "@aifilm/shared";

export {
  buildTimelineClipLayout,
  collectEpisodeNumbers,
  filterSceneRows,
  resolveSceneSelection
} from "../pages/projectWorkbenchModel.ts";
export type {
  SceneListFilter,
  TimelineClipLayout,
  WorkbenchSceneRowLike
} from "../pages/projectWorkbenchModel.ts";

export type WorkbenchStage = "content" | "assets" | "shots" | "delivery";
export type ShotMode = "table" | "image" | "video";
export type SceneKey = { source: "derived" | "storyboard"; value: string };
export type ActiveAsset = { type: "character" | "scene"; id: string };

export interface WorkbenchCapabilities {
  autosave: boolean;
  singleShotVideo: boolean;
  timelineEdit: boolean;
  shotCrud: boolean;
  perRunModelOverride: boolean;
}

export type ContentSceneStatus = "ready" | "risk" | "draft";

export interface ContentSceneRow {
  id: string;
  key: SceneKey;
  source: SceneKey["source"];
  sourceLabel: "从剧本识别" | "已生成镜头";
  episodeNo: number;
  sceneNo: number;
  title: string;
  location: string;
  timeOfDay: string;
  weather: string;
  duration: number;
  shots: number;
  characters: string[];
  status: ContentSceneStatus;
  risk?: string;
  lines: string[];
  dialogue: string[];
  action: string;
  emotion: string;
  shotId?: string;
}

export const RELEASE_A_CAPABILITIES: Readonly<WorkbenchCapabilities> = Object.freeze({
  autosave: false,
  singleShotVideo: false,
  timelineEdit: false,
  shotCrud: false,
  perRunModelOverride: false
});

export interface WorkbenchState {
  activeStage: WorkbenchStage;
  activeEpisodeNo: number | null;
  activeSceneKey: SceneKey | null;
  activeAsset: ActiveAsset | null;
  activeShotId: string | null;
  selectedShotIds: string[];
  shotMode: ShotMode;
  dirtyEntityKey: string | null;
  inspectorOpen: boolean;
}

export interface WorkbenchStateInitializers extends Partial<WorkbenchState> {
  episodeNo?: number | null;
  sceneKey?: SceneKey | null;
  shotId?: string | null;
}

export type WorkbenchAction =
  | { type: "set-stage"; stage: WorkbenchStage }
  | { type: "set-content-selection"; episodeNo: number | null; sceneKey: SceneKey | null; storyboards: StoryboardShot[] }
  | { type: "set-episode"; episodeNo: number | null; storyboards: StoryboardShot[] }
  | { type: "set-scene"; sceneKey: SceneKey | null; storyboards: StoryboardShot[] }
  | { type: "set-asset"; asset: ActiveAsset | null }
  | { type: "set-shot"; shotId: string | null }
  | { type: "set-selected-shots"; shotIds: string[] }
  | { type: "set-shot-mode"; mode: ShotMode }
  | { type: "set-dirty-entity"; entityKey: string | null }
  | { type: "set-inspector-open"; open: boolean }
  | { type: "reconcile-workflow"; storyboards: StoryboardShot[] };

export interface TaskTypeSummary {
  type: TaskType;
  total: number;
  byStatus: Partial<Record<TaskStatus, number>>;
}

export interface AssetFeedbackTarget {
  stage: EvaluationStage;
  assetId?: string;
  label: "角色身份板反馈" | "场景资产反馈";
}

export type MutationSyncResult<T> =
  | { status: "synced"; value: T }
  | { status: "sync-required"; value: T; error: unknown }
  | { status: "mutation-failed"; error: unknown };

export type ShotDraftStatus = "unchanged" | "dirty" | "saving" | "error" | "saved" | "sync-required";

export interface ShotDraftState {
  shotId: string;
  draft: Partial<StoryboardShot>;
  status: ShotDraftStatus;
  committed: boolean;
  revision: number;
  activeOperation?: { token: string; shotId: string; revision: number; kind: "save" | "refresh" };
  error?: string;
}

export type ShotDraftAction =
  | { type: "edit"; patch: Partial<StoryboardShot> }
  | { type: "save-start"; token?: string }
  | { type: "sync-start"; token: string }
  | { type: "sync-failed"; token: string; error: string }
  | { type: "save-failed"; token?: string; error: string }
  | { type: "save-committed"; token?: string; draft?: Partial<StoryboardShot>; refreshError?: string }
  | { type: "sync-succeeded"; token?: string; draft?: Partial<StoryboardShot> }
  | { type: "reconcile-canonical"; shotId: string; draft: Partial<StoryboardShot> }
  | { type: "rebuild"; shotId: string; draft: Partial<StoryboardShot> };

export function createShotDraftState(shotId: string, draft: Partial<StoryboardShot>): ShotDraftState {
  return { shotId, draft: { ...draft }, status: "unchanged", committed: false, revision: 0 };
}

export function reduceShotDraftState(state: ShotDraftState, action: ShotDraftAction): ShotDraftState {
  switch (action.type) {
    case "edit":
      return { ...state, draft: { ...state.draft, ...action.patch }, status: "dirty", committed: false, revision: state.revision + 1, activeOperation: undefined, error: undefined };
    case "save-start":
      return { ...state, status: "saving", error: undefined, activeOperation: action.token ? { token: action.token, shotId: state.shotId, revision: state.revision, kind: "save" } : state.activeOperation };
    case "sync-start":
      return { ...state, activeOperation: { token: action.token, shotId: state.shotId, revision: state.revision, kind: "refresh" } };
    case "sync-failed":
      if (isStaleShotCompletion(state, action.token)) return state;
      return { ...state, status: "sync-required", committed: true, activeOperation: undefined, error: action.error };
    case "save-failed":
      if (isStaleShotCompletion(state, action.token)) return state;
      return { ...state, status: "error", committed: false, activeOperation: undefined, error: action.error };
    case "save-committed":
      if (isStaleShotCompletion(state, action.token)) return state;
      return action.refreshError
        ? { ...state, draft: action.draft ? { ...action.draft } : state.draft, status: "sync-required", committed: true, activeOperation: undefined, error: action.refreshError }
        : { ...state, draft: action.draft ? { ...action.draft } : state.draft, status: "saved", committed: true, activeOperation: action.token ? state.activeOperation : undefined, error: undefined };
    case "sync-succeeded":
      if (isStaleShotCompletion(state, action.token)) return state;
      return { ...state, draft: action.draft ? { ...action.draft } : state.draft, status: "saved", committed: true, activeOperation: undefined, error: undefined };
    case "reconcile-canonical":
      return reconcileShotDraft(state, action.shotId, action.draft);
    case "rebuild":
      return { ...createShotDraftState(action.shotId, action.draft), revision: state.revision + 1 };
  }
}

function isStaleShotCompletion(state: ShotDraftState, token?: string): boolean {
  if (!token) return false;
  return !state.activeOperation
    || state.activeOperation.token !== token
    || state.activeOperation.shotId !== state.shotId
    || state.activeOperation.revision !== state.revision;
}

export function reconcileShotDraft(
  state: ShotDraftState,
  shotId: string,
  canonicalDraft: Partial<StoryboardShot>
): ShotDraftState {
  if (state.shotId !== shotId) return state;
  const hasUncommittedChanges = !state.committed && (state.status === "dirty" || state.status === "error" || state.status === "saving");
  if (hasUncommittedChanges) return state;
  return { ...state, draft: { ...canonicalDraft } };
}

export function buildShotAssetMap(
  storyboards: Pick<StoryboardShot, "id">[],
  assets: AssetItem[],
  type: "image" | "video"
): Map<string, AssetItem> {
  const assetsById = new Map(assets.filter((asset) => asset.type === type).map((asset) => [asset.id, asset]));
  return new Map(storyboards.flatMap((shot) => {
    const matched = assetsById.get(`${type}_${shot.id}`);
    return matched ? [[shot.id, matched] as const] : [];
  }));
}

export function collectPendingShotIds(storyboards: StoryboardShot[], assets: AssetItem[]): string[] {
  const images = buildShotAssetMap(storyboards, assets, "image");
  return storyboards.filter((shot) => !images.get(shot.id)?.referenceUrl).map((shot) => shot.id);
}

export function buildShotImageGenerationPayload(
  activeShotId: string,
  selectedShotIds: string[],
  pendingShotIds: string[]
) {
  return {
    current: { shotIds: [activeShotId] },
    selected: { shotIds: [...selectedShotIds] },
    pending: { shotIds: [...pendingShotIds] }
  };
}

export function buildProjectVideoGenerationArgs(): [] {
  return [];
}

export function resolveShotSelection(
  currentShotId: string,
  requestedShotId: string,
  draftState: ShotDraftState,
  confirmDiscard: () => boolean
): { accepted: boolean; shotId: string } {
  if (requestedShotId === currentShotId) return { accepted: false, shotId: currentShotId };
  if (draftState.activeOperation) return { accepted: false, shotId: currentShotId };
  const needsConfirmation = !draftState.committed && (draftState.status === "dirty" || draftState.status === "error");
  if (needsConfirmation && !confirmDiscard()) return { accepted: false, shotId: currentShotId };
  return { accepted: true, shotId: requestedShotId };
}

export function buildStoryboardShotUpdatePayload(draft: Partial<StoryboardShot>): Partial<StoryboardShot> {
  if (draft.duration === undefined) return { ...draft };
  const parsed = Number(draft.duration);
  const duration = Number.isFinite(parsed) ? Math.min(30, Math.max(1, Math.round(parsed))) : 1;
  return { ...draft, duration };
}

export function defaultVideoUnitCredits(providerId: string): number {
  if (["dashscope", "dashscope-video", "wanxiang", "wanx"].includes(providerId)) return 16;
  if (["doubao", "doubao-seedance", "seedance"].includes(providerId)) return 18;
  return 0;
}

export function resolveVideoUnitCredits(
  prices: ModelPrice[],
  providerId: string,
  model: string
): number {
  return prices.find((price) => (
    price.enabled
    && price.modality === "video"
    && price.unit === "video_second"
    && price.providerId === providerId
    && price.model === model
  ))?.unitCredits ?? defaultVideoUnitCredits(providerId);
}

export function resolveVideoAssetStatus(asset?: AssetItem): "missing" | "running" | "failed" | "succeeded" {
  if (!asset) return "missing";
  if (asset.status === "succeeded" && isPersistedPlayableVideoReference(asset.referenceUrl)) return "succeeded";
  if (asset.status === "failed") return "failed";
  return "running";
}

export function collectEligibleVideoShotIds(storyboards: StoryboardShot[], assets: AssetItem[]): string[] {
  const images = buildShotAssetMap(storyboards, assets, "image");
  const videos = buildShotAssetMap(storyboards, assets, "video");
  return storyboards.filter((shot) => {
    const image = images.get(shot.id);
    return image?.status === "succeeded" && Boolean(image.referenceUrl) && resolveVideoAssetStatus(videos.get(shot.id)) !== "succeeded";
  }).map((shot) => shot.id);
}

export function buildBatchResultSummary(
  label: string,
  requestedCount: number,
  result: { assetsCreated: number; task: { finalCredits?: number; estimatedCredits?: number } }
): string {
  const charged = result.task.finalCredits !== undefined
    ? `实际扣费 ${result.task.finalCredits} 积分`
    : result.task.estimatedCredits !== undefined
      ? `当前任务预计 ${result.task.estimatedCredits} 积分，实际扣费以后端结算为准`
      : "实际扣费以后端任务结算为准";
  return `${label}请求范围 ${requestedCount} 个；服务端本批次实际接收/创建 ${result.assetsCreated} 个，${charged}。`;
}

export async function commitMutationThenSync<T>(
  mutation: () => Promise<T>,
  sync: () => Promise<unknown>
): Promise<MutationSyncResult<T>> {
  let value: T;
  try {
    value = await mutation();
  } catch (error) {
    return { status: "mutation-failed", error };
  }
  try {
    await sync();
    return { status: "synced", value };
  } catch (error) {
    return { status: "sync-required", value, error };
  }
}

export function resolveImageRoutePair(
  requestedProviderId: string | undefined,
  requestedModel: string | undefined,
  providers: ModelProvider[],
  blockedModels: ReadonlySet<string> = new Set()
): { imageProvider: string; imageModel: string } {
  const candidates = providers
    .filter((provider) => provider.enabled && provider.modality === "image")
    .map((provider) => ({ provider, models: provider.models.filter((model) => !blockedModels.has(model)) }))
    .filter((candidate) => candidate.models.length > 0);
  const selected = candidates.find(({ provider }) => provider.id === requestedProviderId) ?? candidates[0];
  if (!selected) return { imageProvider: "", imageModel: "" };
  const imageModel = requestedModel && selected.models.includes(requestedModel)
    ? requestedModel
    : selected.models[0] ?? "";
  return { imageProvider: selected.provider.id, imageModel };
}

export function resolveCharacterIdentityAsset(
  character: Pick<CharacterProfile, "id" | "referenceAssetId">,
  assets: AssetItem[]
): AssetItem | undefined {
  const generatedAssets = assets.filter((asset) => (
    !asset.isHistorical && asset.relatedCharacterId === character.id
    && asset.type !== "role_reference"
    && Boolean(asset.referenceUrl)
  ));
  return generatedAssets.find((asset) => asset.id === character.referenceAssetId)
    ?? generatedAssets.find((asset) => asset.type === "role_derivative")
    ?? generatedAssets.find((asset) => asset.type === "role");
}

export function listCharacterReferenceAssets(characterId: string, assets: AssetItem[]): AssetItem[] {
  return assets.filter((asset) => (
    !asset.isHistorical && asset.type === "role_reference"
    && asset.relatedCharacterId === characterId
    && Boolean(asset.referenceUrl)
  ));
}

export function updateCharacterReferenceDraft(
  drafts: Readonly<Record<string, string>>,
  characterId: string,
  value: string
): Record<string, string> {
  return { ...drafts, [characterId]: value };
}

export function deriveSceneAssetList(assets: AssetItem[]): AssetItem[] {
  return assets.filter((asset) => !asset.isHistorical && (asset.type === "scene" || asset.type === "prop"));
}

export function reconcileActiveAsset(
  requested: ActiveAsset | null,
  characters: Pick<CharacterProfile, "id">[],
  sceneAssets: Pick<AssetItem, "id">[]
): ActiveAsset | null {
  if (requested?.type === "character") {
    const id = characters.some((character) => character.id === requested.id)
      ? requested.id
      : characters[0]?.id;
    if (id) return { type: "character", id };
  }
  if (requested?.type === "scene") {
    const id = sceneAssets.some((asset) => asset.id === requested.id)
      ? requested.id
      : sceneAssets[0]?.id;
    if (id) return { type: "scene", id };
  }
  if (characters[0]) return { type: "character", id: characters[0].id };
  if (sceneAssets[0]) return { type: "scene", id: sceneAssets[0].id };
  return null;
}

export function buildCharacterGenerationPayload(characterId: string, forceRegenerate: boolean) {
  return { characterIds: [characterId], forceRegenerate };
}

export function buildAssetFeedbackTarget(input: { type: ActiveAsset["type"]; asset?: Pick<AssetItem, "id"> }): AssetFeedbackTarget {
  if (input.type === "scene") {
    return { stage: "image", assetId: input.asset?.id, label: "场景资产反馈" };
  }
  return { stage: "character", assetId: input.asset?.id, label: "角色身份板反馈" };
}

export function derivedScene(value: string): SceneKey {
  return { source: "derived", value };
}

export function storyboardScene(value: string): SceneKey {
  return { source: "storyboard", value };
}

export function collectContentEpisodeNumbers(rows: ContentSceneRow[], configuredEpisodes = 1): number[] {
  const episodes = new Set<number>();
  for (let episodeNo = 1; episodeNo <= Math.max(1, configuredEpisodes); episodeNo += 1) {
    episodes.add(episodeNo);
  }
  rows.forEach((row) => episodes.add(Math.max(1, row.episodeNo)));
  return [...episodes].sort((a, b) => a - b);
}

export function reconcileContentSelection(
  requestedEpisodeNo: number | null,
  requestedSceneKey: SceneKey | null,
  episodeNumbers: number[],
  rows: ContentSceneRow[]
): { activeEpisodeNo: number | null; activeSceneKey: SceneKey | null } {
  const activeEpisodeNo = requestedEpisodeNo !== null && episodeNumbers.includes(requestedEpisodeNo)
    ? requestedEpisodeNo
    : episodeNumbers[0] ?? null;
  const episodeRows = activeEpisodeNo === null ? [] : rows.filter((row) => row.episodeNo === activeEpisodeNo);
  const activeScene = episodeRows.find((row) => sceneKeysEqual(row.key, requestedSceneKey)) ?? episodeRows[0];
  return { activeEpisodeNo, activeSceneKey: activeScene?.key ?? null };
}

export function buildStoryboardGenerationPayload(project: Pick<Project, "artStyle" | "videoRatio">) {
  return { artStyle: project.artStyle, videoRatio: project.videoRatio };
}

export function shouldReconcileStoryboardSelection(stage: WorkbenchStage): boolean {
  return stage !== "content";
}

export function buildContentSceneRows(script: ScriptDraft | undefined, storyboards: StoryboardShot[]): ContentSceneRow[] {
  if (storyboards.length) {
    return storyboards
      .map((shot) => buildStoryboardShotRow(shot))
      .sort((a, b) => a.episodeNo - b.episodeNo || a.sceneNo - b.sceneNo);
  }

  if (!script?.content.trim()) return [];
  const candidates = splitScriptIntoEpisodes(script.content).flatMap((episode) => (
    splitScriptIntoSceneCandidates(episode.content, episode.sourceTitle).slice(0, 12).map((scene, sceneIndex) => ({
      episodeNo: episode.episodeNo,
      sceneNo: sceneIndex + 1,
      lines: scene.lines,
      sourceTitle: scene.sourceTitle
    }))
  ));
  return candidates.map(({ episodeNo, sceneNo, lines, sourceTitle }) => {
    const title = sourceTitle || inferScriptSceneTitle(lines, sceneNo - 1);
    const id = `script-scene-${episodeNo}-${sceneNo}`;
    return {
      id,
      key: derivedScene(id),
      source: "derived",
      sourceLabel: "从剧本识别",
      episodeNo,
      sceneNo,
      title,
      location: inferLocation(title),
      timeOfDay: inferSceneTime(title),
      weather: inferSceneWeather(title),
      duration: 0,
      shots: 0,
      characters: [],
      status: "draft",
      lines: lines.slice(0, 5),
      dialogue: lines.filter((line) => /[:：]|“|”|「|」/.test(line)).slice(0, 4),
      action: lines.find((line) => !/[:：]|“|”|「|」/.test(line)) ?? "",
      emotion: ""
    } satisfies ContentSceneRow;
  });
}

interface ScriptEpisodeChunk {
  episodeNo: number;
  sourceTitle: string;
  content: string;
}

function splitScriptIntoEpisodes(content: string): ScriptEpisodeChunk[] {
  const chunks: ScriptEpisodeChunk[] = [];
  let activeEpisodeNo = 1;
  let activeSourceTitle = "";
  let activeLines: string[] = [];

  const flush = () => {
    const episodeContent = activeLines.join("\n").trim();
    if (episodeContent) chunks.push({ episodeNo: activeEpisodeNo, sourceTitle: activeSourceTitle, content: episodeContent });
  };

  for (const line of content.split(/\r?\n/)) {
    const heading = matchEpisodeHeading(line);
    if (heading) {
      flush();
      activeEpisodeNo = heading.episodeNo;
      activeSourceTitle = heading.title;
      activeLines = [];
    } else {
      activeLines.push(line);
    }
  }
  flush();
  return chunks;
}

function matchEpisodeHeading(line: string): { episodeNo: number; title: string } | null {
  const match = line.match(/^\s*(?:#{1,6}\s*)?第\s*([0-9]+|[零〇一二三四五六七八九十]+)\s*集(?:\s+|[：:]\s*)?(.*)$/);
  if (!match) return null;
  const episodeNo = parseEpisodeNumber(match[1]);
  return episodeNo === null ? null : { episodeNo, title: match[2]?.trim() ?? "" };
}

function parseEpisodeNumber(value: string): number | null {
  if (/^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (value === "十") return 10;
  if (!value.includes("十")) return value.length === 1 && digits[value] ? digits[value] : null;
  const [tensText, onesText] = value.split("十");
  const tens = tensText ? digits[tensText] : 1;
  const ones = onesText ? digits[onesText] : 0;
  if (tens === undefined || ones === undefined || tens === 0) return null;
  return tens * 10 + ones;
}

function buildStoryboardShotRow(shot: StoryboardShot): ContentSceneRow {
  const key = `${shot.episodeNo}:${shot.sceneNo}:${shot.shotNo}`;
  return {
    id: `scene-${key}`,
    key: storyboardScene(key),
    source: "storyboard",
    sourceLabel: "已生成镜头",
    episodeNo: shot.episodeNo,
    sceneNo: shot.shotNo,
    title: `镜头 ${String(shot.shotNo).padStart(2, "0")} · ${shot.scene || `场景 ${shot.sceneNo}`}`,
    location: inferLocation(shot.scene),
    timeOfDay: inferSceneTime(shot.scene),
    weather: inferSceneWeather(shot.scene),
    duration: shot.duration || 0,
    shots: 1,
    characters: shot.characters.filter(Boolean),
    status: "ready",
    lines: [shot.pictureDesc].filter(Boolean),
    dialogue: [shot.dialogue, shot.voiceOver].filter(Boolean),
    action: shot.action || shot.cameraMovement || shot.pictureDesc,
    emotion: shot.emotion?.trim() ?? "",
    shotId: shot.id
  };
}

interface ScriptSceneCandidate {
  sourceTitle: string;
  lines: string[];
}

function splitScriptIntoSceneCandidates(content: string, episodeTitle: string): ScriptSceneCandidate[] {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const scenes: ScriptSceneCandidate[] = [];
  const prelude: string[] = [];
  let activeScene: ScriptSceneCandidate | null = null;

  for (const line of lines) {
    const boundaryTitle = matchSceneBoundary(line);
    if (boundaryTitle !== null) {
      if (activeScene) scenes.push(activeScene);
      activeScene = {
        sourceTitle: boundaryTitle,
        lines: scenes.length === 0 ? [...prelude, line] : [line]
      };
    } else if (activeScene) {
      activeScene.lines.push(line);
    } else {
      prelude.push(line);
    }
  }

  if (!activeScene) {
    return [{ sourceTitle: episodeTitle, lines }];
  }
  scenes.push(activeScene);
  return scenes;
}

function matchSceneBoundary(line: string): string | null {
  const numbered = line.match(/^\s*第\s*[一二三四五六七八九十0-9]+\s*[场幕]\s*(?:[：:\-—]\s*)?(.*)$/);
  if (numbered) {
    const remainder = numbered[1]?.trim() ?? "";
    const bracket = remainder.match(/^【([^】]+)】/);
    return bracket?.[1]?.trim() || remainder.replace(/^【|】$/g, "").trim();
  }
  const bracketed = line.match(/^\s*【([^】]+)】/);
  const title = bracketed?.[1]?.trim() ?? "";
  if (/^(?:开场画面|剧情节拍\d*|动作|台词|旁白|情绪节奏|结尾钩子)$/.test(title)) return null;
  return title || null;
}

function inferScriptSceneTitle(lines: string[], index: number): string {
  const first = lines[0] ?? "";
  const episodeHeading = matchEpisodeHeading(first);
  if (episodeHeading) return episodeHeading.title.slice(0, 18) || `第 ${episodeHeading.episodeNo} 集`;
  const bracket = first.match(/【([^】]+)】/);
  if (bracket?.[1]) return bracket[1].slice(0, 18);
  const marker = first.match(/第[一二三四五六七八九十0-9]+[场幕][：:\s]*(.{0,18})/);
  return marker?.[1]?.trim() || first.slice(0, 14) || `场次 ${index + 1}`;
}

function inferLocation(scene: string): string {
  const clean = scene.replace(/[【】]/g, "").trim();
  return clean.split(/[·｜|、,， -]/).map((part) => part.trim()).find(Boolean) || "待定场景";
}

function inferSceneTime(scene: string): string {
  if (/凌晨/.test(scene)) return "凌晨";
  if (/清晨|早晨|黎明/.test(scene)) return "清晨";
  if (/黄昏|傍晚/.test(scene)) return "傍晚";
  if (/夜|夜晚|晚间/.test(scene)) return "夜晚";
  if (/下午|午后/.test(scene)) return "下午";
  if (/中午/.test(scene)) return "中午";
  if (/白天|日间|日景/.test(scene)) return "白天";
  return "";
}

function inferSceneWeather(scene: string): string {
  if (/雨/.test(scene)) return "雨天";
  if (/雪/.test(scene)) return "雪天";
  if (/雾/.test(scene)) return "雾天";
  if (/阴/.test(scene)) return "阴天";
  if (/晴/.test(scene)) return "晴天";
  return "";
}

function sceneKeysEqual(left: SceneKey, right: SceneKey | null): boolean {
  return Boolean(right && left.source === right.source && left.value === right.value);
}

export function createWorkbenchState(initial: WorkbenchStateInitializers = {}): WorkbenchState {
  return {
    activeStage: initial.activeStage ?? "content",
    activeEpisodeNo: initial.activeEpisodeNo ?? initial.episodeNo ?? null,
    activeSceneKey: initial.activeSceneKey ?? initial.sceneKey ?? null,
    activeAsset: initial.activeAsset ?? null,
    activeShotId: initial.activeShotId ?? initial.shotId ?? null,
    selectedShotIds: [...(initial.selectedShotIds ?? [])],
    shotMode: initial.shotMode ?? "table",
    dirtyEntityKey: initial.dirtyEntityKey ?? null,
    inspectorOpen: initial.inspectorOpen ?? true
  };
}

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "set-stage":
      return {
        ...state,
        activeStage: action.stage,
        selectedShotIds: state.activeStage === "shots" && action.stage !== "shots" ? [] : state.selectedShotIds,
        dirtyEntityKey: state.activeStage === "shots" && action.stage !== "shots" ? null : state.dirtyEntityKey
      };
    case "set-content-selection": {
      const sceneShotIds = action.sceneKey?.source === "storyboard"
        ? action.storyboards
          .filter((shot) => `${shot.episodeNo}:${shot.sceneNo}` === action.sceneKey?.value)
          .map((shot) => shot.id)
        : [];
      return {
        ...state,
        activeEpisodeNo: action.episodeNo,
        activeSceneKey: action.sceneKey,
        activeShotId: state.activeShotId && sceneShotIds.includes(state.activeShotId)
          ? state.activeShotId
          : sceneShotIds[0] ?? null
      };
    }
    case "set-episode": {
      if (action.episodeNo === null) {
        return { ...state, activeEpisodeNo: null, activeSceneKey: null, activeShotId: null };
      }
      return reconcileSelection({ ...state, activeEpisodeNo: action.episodeNo }, action.storyboards);
    }
    case "set-scene": {
      if (action.sceneKey === null) {
        return { ...state, activeSceneKey: null, activeShotId: null };
      }
      return reconcileSelection({ ...state, activeSceneKey: action.sceneKey }, action.storyboards);
    }
    case "set-asset":
      return { ...state, activeAsset: action.asset };
    case "set-shot":
      return { ...state, activeShotId: action.shotId };
    case "set-selected-shots":
      return { ...state, selectedShotIds: [...action.shotIds] };
    case "set-shot-mode":
      return { ...state, shotMode: action.mode };
    case "set-dirty-entity":
      return { ...state, dirtyEntityKey: action.entityKey };
    case "set-inspector-open":
      return { ...state, inspectorOpen: action.open };
    case "reconcile-workflow":
      return reconcileSelection(state, action.storyboards);
  }
}

export function reconcileSelection(state: WorkbenchState, storyboards: StoryboardShot[]): WorkbenchState {
  const episodes = [...new Set(storyboards.map((shot) => shot.episodeNo))].sort((a, b) => a - b);
  const activeEpisodeNo = state.activeEpisodeNo !== null && episodes.includes(state.activeEpisodeNo)
    ? state.activeEpisodeNo
    : episodes[0] ?? null;

  const episodeShots = activeEpisodeNo === null
    ? []
    : storyboards.filter((shot) => shot.episodeNo === activeEpisodeNo);
  const sceneKeys = [...new Set(episodeShots.map((shot) => `${shot.episodeNo}:${shot.sceneNo}`))];
  const requestedSceneValue = state.activeSceneKey?.source === "storyboard" ? state.activeSceneKey.value : null;
  const activeSceneValue = requestedSceneValue && sceneKeys.includes(requestedSceneValue)
    ? requestedSceneValue
    : sceneKeys[0] ?? null;
  const activeSceneKey = activeSceneValue ? storyboardScene(activeSceneValue) : null;

  const sceneShotIds = activeSceneValue
    ? episodeShots
      .filter((shot) => `${shot.episodeNo}:${shot.sceneNo}` === activeSceneValue)
      .map((shot) => shot.id)
    : [];
  const activeShotId = state.activeShotId && sceneShotIds.includes(state.activeShotId)
    ? state.activeShotId
    : sceneShotIds[0] ?? null;
  const validShotIds = new Set(storyboards.map((shot) => shot.id));

  return {
    ...state,
    activeEpisodeNo,
    activeSceneKey,
    activeShotId,
    selectedShotIds: state.selectedShotIds.filter((shotId) => validShotIds.has(shotId))
  };
}

export type WorkbenchTheme = "light" | "dark";

export function nextWorkbenchTheme(theme: WorkbenchTheme): WorkbenchTheme {
  return theme === "dark" ? "light" : "dark";
}

export function resolveThemePreference(
  stored: string | null,
  systemPrefersDark: boolean | (() => boolean)
): WorkbenchTheme {
  if (stored === "light" || stored === "dark") return stored;
  const prefersDark = typeof systemPrefersDark === "function" ? systemPrefersDark() : systemPrefersDark;
  return prefersDark ? "dark" : "light";
}

export function buildTaskSummary(workflow: ProjectWorkflow): TaskTypeSummary[] {
  const summaries = new Map<TaskType, TaskTypeSummary>();
  for (const task of workflow.tasks) {
    const summary = summaries.get(task.type) ?? { type: task.type, total: 0, byStatus: {} };
    summary.total += 1;
    summary.byStatus[task.status] = (summary.byStatus[task.status] ?? 0) + 1;
    summaries.set(task.type, summary);
  }
  return [...summaries.values()];
}
