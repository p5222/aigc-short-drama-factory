import type { ProjectWorkflow } from "@aifilm/shared";
import { persistTextReference } from "../storage/objectStorage.js";
import { buildExportSrt, composeVideoExport, type TtsAudioAsset, type VideoCompositionResult } from "./videoComposer.js";

export type MediaExportResult = {
  outputUrl: string;
  outputKind: "audio" | "subtitle" | "mp4" | "diagnostic_bundle";
  manifestUrl?: string;
  subtitleUrl?: string;
  audioUrl?: string;
  previewUrl?: string;
  ffmpegReady?: boolean;
  clipCount?: number;
  warnings?: string[];
  mimeType?: VideoCompositionResult["mimeType"] | "audio/wav" | "audio/mpeg" | "application/x-subrip";
};

export async function createSubtitleAsset(workflow: ProjectWorkflow): Promise<MediaExportResult> {
  const outputUrl = await persistTextReference(buildExportSrt(workflow), `subtitle-${workflow.project.id}`, "exports", "srt");
  return {
    outputUrl,
    subtitleUrl: outputUrl,
    outputKind: "subtitle",
    mimeType: "application/x-subrip",
    warnings: []
  };
}

export async function createTtsManifest(workflow: ProjectWorkflow, audio: TtsAudioAsset): Promise<MediaExportResult> {
  return {
    outputUrl: audio.audioUrl,
    outputKind: "audio",
    audioUrl: audio.audioUrl,
    manifestUrl: audio.manifestUrl,
    ffmpegReady: undefined,
    clipCount: audio.cueCount,
    warnings: audio.warnings,
    mimeType: audio.ext === "mp3" ? "audio/mpeg" : "audio/wav"
  };
}

export async function createVideoExportPackage(workflow: ProjectWorkflow, audio: TtsAudioAsset): Promise<MediaExportResult> {
  const result = await composeVideoExport(workflow, audio);
  return {
    outputUrl: result.outputUrl,
    outputKind: result.mimeType === "video/mp4" ? "mp4" : "diagnostic_bundle",
    manifestUrl: result.manifestUrl,
    subtitleUrl: result.subtitleUrl,
    audioUrl: result.audioUrl,
    previewUrl: result.finalVideoUrl,
    ffmpegReady: result.ffmpegReady,
    clipCount: result.clipCount,
    warnings: result.warnings,
    mimeType: result.mimeType
  };
}
