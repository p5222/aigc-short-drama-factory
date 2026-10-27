import type { AssetItem, ProjectWorkflow } from "./index.js";
import { isPersistedPlayableVideoReference } from "./videoMedia.js";

export interface DeliveryEditClip {
  shotId: string;
  sourceAssetId: string;
  inPoint: number;
  outPoint: number;
  /** Captured by the server; prevents a regenerated canonical asset replacing this edit silently. */
  sourceUrl?: string;
}

export interface DeliveryEdit {
  projectId: string;
  episodeNo: number;
  revision: number;
  clips: DeliveryEditClip[];
  updatedAt: string;
}

export interface DeliveryEditReference { episodeNo: number; revision: number; }

export function shotVideoVersions(assets: AssetItem[], shotId: string): AssetItem[] {
  const canonical = `video_${shotId}`;
  const history = `${canonical}_history_`;
  return assets.filter(asset => asset.type === "video" && asset.status === "succeeded"
    && isPersistedPlayableVideoReference(asset.referenceUrl)
    && (asset.id === canonical || (asset.id.startsWith(history) && /^[a-f0-9-]{36}$/i.test(asset.id.slice(history.length)))))
    .sort((a, b) => Number(b.id === canonical) - Number(a.id === canonical));
}

export function defaultDeliveryClips(workflow: ProjectWorkflow, episodeNo: number): DeliveryEditClip[] {
  return workflow.storyboards.filter(shot => Math.max(1, shot.episodeNo || 1) === episodeNo).map(shot => ({
    shotId: shot.id, sourceAssetId: `video_${shot.id}`, inPoint: 0,
    outPoint: Math.max(0.2, Number.isFinite(shot.duration) ? shot.duration : 1)
  }));
}

/** Never accept a URL supplied by a client. Select only a successful video from this shot/project. */
export function validateDeliveryClips(workflow: ProjectWorkflow, episodeNo: number, clips: DeliveryEditClip[]): DeliveryEditClip[] {
  if (!Number.isSafeInteger(episodeNo) || episodeNo < 1 || !clips.length || clips.length > 2000) throw new Error("请选择有效剧集和至少一个镜头");
  const shots = new Map(workflow.storyboards.filter(shot => Math.max(1, shot.episodeNo || 1) === episodeNo).map(shot => [shot.id, shot]));
  const seen = new Set<string>();
  return clips.map(clip => {
    const shot = shots.get(clip.shotId);
    if (!shot || seen.has(clip.shotId)) throw new Error("剪辑包含重复、已删除或其他剧集的镜头，请刷新核对");
    seen.add(clip.shotId);
    const source = shotVideoVersions(workflow.assets, shot.id).find(asset => asset.id === clip.sourceAssetId && asset.projectId === workflow.project.id);
    if (!source) throw new Error("选用的视频版本不可用，请重新选择");
    if (!Number.isFinite(clip.inPoint) || !Number.isFinite(clip.outPoint) || clip.inPoint < 0
      || clip.outPoint - clip.inPoint < 0.1999 || clip.outPoint > Math.max(0.2, shot.duration) + 0.001) {
      throw new Error("入出点无效：片段至少保留 0.2 秒，且不能超出镜头时长");
    }
    return { shotId: shot.id, sourceAssetId: source.id, sourceUrl: source.referenceUrl!,
      inPoint: Math.round(clip.inPoint * 1000) / 1000, outPoint: Math.round(clip.outPoint * 1000) / 1000 };
  });
}

/** Materialize the saved cut for all export types, without changing original shots/assets. */
export function applyDeliveryEdit(workflow: ProjectWorkflow, reference: DeliveryEditReference): ProjectWorkflow {
  const edit = workflow.deliveryEdits?.find(item => item.episodeNo === reference.episodeNo);
  if (!edit || edit.revision !== reference.revision) throw new Error("剪辑版本已变化，请刷新并重新确认导出");
  const clips = validateDeliveryClips(workflow, edit.episodeNo, edit.clips);
  if (clips.some((clip, index) => clip.sourceUrl !== edit.clips[index]?.sourceUrl)) throw new Error("剪辑使用的视频已替换，请重新选片并保存");
  const shots = new Map(workflow.storyboards.map(shot => [shot.id, shot]));
  const assets = new Map(workflow.assets.map(asset => [asset.id, asset]));
  const replacements = clips.map(clip => ({ ...assets.get(clip.sourceAssetId)!, id: `video_${clip.shotId}` }));
  const replaced = new Set(replacements.map(asset => asset.id));
  return { ...workflow, exportEdit: reference,
    storyboards: clips.map(clip => ({ ...shots.get(clip.shotId)!, duration: clip.outPoint - clip.inPoint, videoTrimStart: clip.inPoint })),
    assets: [...workflow.assets.filter(asset => !replaced.has(asset.id)), ...replacements] };
}
