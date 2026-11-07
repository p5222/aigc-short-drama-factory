import type { ExportJob } from "@aifilm/shared";
import { isPersistedPlayableVideoReference } from "@aifilm/shared";

export function isPlayableExport(job: ExportJob) {
  return job.status === "succeeded" && (job.type === "video_export" || job.outputKind === "mp4")
    && isPersistedPlayableVideoReference(job.previewUrl || job.outputUrl);
}

export function outputTypeLabel(job: ExportJob) {
  if (job.outputKind === "diagnostic_bundle") return "诊断包";
  return job.type === "tts" ? "配音" : job.type === "subtitle" ? "字幕" : "成片";
}

export function outputSourceLabel(job: ExportJob) {
  return job.sourceStatus === "current" ? "输入已核验" : job.sourceStatus === "stale" ? "历史版本 · 内容已更新" : "历史版本 · 输入未核验";
}

export function outputScopeLabel(job: ExportJob, currentIds: readonly string[] = []) {
  const scope = job.storyboardIds ?? [];
  if (job.deliveryEdit) return `第 ${job.deliveryEdit.episodeNo} 集 · 剪辑 v${job.deliveryEdit.revision} · ${scope.length} 镜头`;
  if (!scope.length) return "范围未记录";
  const matches = currentIds.length === scope.length && scope.every((id, index) => id === currentIds[index]);
  return `${matches ? "当前镜头范围" : "其他镜头范围"} · ${scope.length} 镜头`;
}

export function outputDownloadName(job: ExportJob, projectName: string, mime = "") {
  const knownExtension = job.outputUrl?.split(/[?#]/)[0]?.match(/\.(mp4|mp3|wav|m4a|aac|ogg|srt|vtt|zip|json)$/i)?.[1]?.toLowerCase();
  const extension = knownExtension ?? (job.outputKind === "diagnostic_bundle" ? "zip" : job.type === "subtitle" ? "srt" : job.type === "tts" ? mime.includes("mpeg") ? "mp3" : "wav" : "mp4");
  const version = job.deliveryEdit ? `第${job.deliveryEdit.episodeNo}集-剪辑v${job.deliveryEdit.revision}` : `${job.storyboardIds?.length ?? 0}镜`;
  return `${projectName}-${outputTypeLabel(job)}-${version}-${job.id}.${extension}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
}
