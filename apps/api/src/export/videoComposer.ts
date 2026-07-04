import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssetItem, ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import { buildLingGuoSrt, buildLingGuoTtsManifest, createLingGuoProductionManifest } from "../agents/lingguoAdapter.js";
import { persistAudioBuffer, storageRoot } from "../storage/objectStorage.js";
import { generateEmbeddedMjpegVideo, writeEmbeddedExportBundle } from "./embeddedVideo.js";
import { buildSrt } from "./subtitleTools.js";

type ExportSize = { width: number; height: number };
type CommandResult = { exitCode: number | null; stdout: string; stderr: string; errorMessage?: string; timedOut: boolean };
type FfmpegProbe = {
  ready: boolean;
  bin: string;
  version?: string;
  message?: string;
  failureCode?: "not_found" | "permission_denied" | "timeout" | "probe_failed";
  deployment: {
    strategy: "env_bin" | "bundled_bin" | "system_path";
    envKey: "FFMPEG_BIN";
    installHint: string;
  };
};
type VideoEncoder = { name: "libx264" | "mpeg4"; args: string[] };
type SessionFile = { path: string; url: string };

interface ClipPlan {
  order: number;
  shot: StoryboardShot;
  duration: number;
  videoUrl?: string;
  imageUrl?: string;
}

interface RenderedClip {
  order: number;
  shotId: string;
  duration: number;
  sourceKind: "video" | "image" | "color_card";
  sourceUrl?: string;
  outputPath: string;
  outputUrl: string;
}

export interface TtsAudioAsset {
  audioUrl: string;
  manifestUrl: string;
  durationSeconds: number;
  cueCount: number;
  provider: string;
  ext: "wav" | "mp3";
  warnings: string[];
}

export interface VideoCompositionResult {
  outputUrl: string;
  manifestUrl: string;
  subtitleUrl: string;
  audioUrl: string;
  concatListUrl?: string;
  finalVideoUrl?: string;
  ffmpegReady: boolean;
  clipCount: number;
  warnings: string[];
  mimeType: "video/mp4" | "application/json";
}

export function buildExportSrt(workflow: ProjectWorkflow) {
  const fromAdapter = buildLingGuoSrt(workflow);
  if (fromAdapter.trim()) return fromAdapter;
  let cursor = 0;
  const cues: Array<{ index: number; start: number; end: number; text: string }> = [];
  workflow.storyboards.forEach((shot) => {
    const duration = normalizeDuration(shot.duration);
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    const text = normalizeSubtitleText(shot.dialogue || shot.voiceOver || shot.pictureDesc);
    if (!text) return;
    cues.push({ index: cues.length + 1, start, end, text });
  });
  return buildSrt(cues);
}

export async function createTtsAudioAsset(workflow: ProjectWorkflow): Promise<TtsAudioAsset> {
  const session = await createExportSession(workflow.project.id, "tts");
  const cues = buildVoiceCues(workflow);
  const synthesis = await synthesizeNarrationWav(session, workflow, cues);
  const audioUrl = await persistAudioBuffer(synthesis.buffer, `tts-${workflow.project.id}`, synthesis.ext);
  const manifest = await writeSessionText(session, "tts-manifest.json", JSON.stringify({
    ...buildLingGuoTtsManifest(workflow),
    provider: synthesis.provider,
    audioUrl,
    durationSeconds: totalDuration(workflow),
    cueCount: cues.filter((cue) => cue.text).length,
    warnings: synthesis.warnings,
    ext: synthesis.ext,
    note: ttsProviderNote(synthesis.provider)
  }, null, 2));
  return {
    audioUrl,
    manifestUrl: manifest.url,
    durationSeconds: totalDuration(workflow),
    cueCount: cues.filter((cue) => cue.text).length,
    provider: synthesis.provider,
    ext: synthesis.ext,
    warnings: synthesis.warnings
  };
}

export async function composeVideoExport(workflow: ProjectWorkflow): Promise<VideoCompositionResult> {
  const session = await createExportSession(workflow.project.id, "video-export");
  const warnings: string[] = [];
  const startedAt = Date.now();
  const size = resolveExportSize(workflow.project.videoRatio);
  const subtitle = await writeSessionText(session, "subtitles.srt", buildExportSrt(workflow));
  const tts = await createTtsAudioAsset(workflow);
  warnings.push(...tts.warnings);
  const ffmpeg = await probeFfmpeg();
  const clipPlans = buildClipPlans(workflow);

  if (!clipPlans.length) {
    warnings.push("项目还没有可合成的分镜镜头，请先完成分镜拆解。");
    const manifest = await writeCompositionManifest(session, workflow, {
      outputUrl: undefined,
      subtitleUrl: subtitle.url,
      audioUrl: tts.audioUrl,
      ttsManifestUrl: tts.manifestUrl,
      ffmpeg,
      size,
      clips: [],
      warnings,
      startedAt,
      status: "diagnostic"
    });
    return diagnosticResult(manifest, subtitle.url, tts.audioUrl, ffmpeg.ready, warnings);
  }

  if (!ffmpeg.ready) {
    warnings.push(ffmpeg.message || "未检测到 FFmpeg，已生成配音、字幕和合成清单；安装 FFmpeg 后可一键生成 MP4。");
    const embeddedVideos = await Promise.all(clipPlans.map((clip) => generateEmbeddedMjpegVideo({
      prompt: clip.shot.videoPrompt || clip.shot.pictureDesc,
      imageUrl: clip.imageUrl,
      ratio: workflow.project.videoRatio,
      duration: clip.duration,
      nameHint: `embedded-${workflow.project.id}-${clip.order}`
    })));
    const concat = await writeSessionText(session, "concat.txt", embeddedVideos.map((url, index) => `# ${index + 1}. ${formatShotLabel(clipPlans[index]!.shot)} ${clipPlans[index]!.duration}s\nfile '${url}'`).join("\n"));
    const embeddedManifestUrl = await writeEmbeddedExportBundle({
      projectId: workflow.project.id,
      videoUrl: embeddedVideos[0] || "",
      audioUrl: tts.audioUrl,
      subtitleUrl: subtitle.url,
      manifest: {
        projectId: workflow.project.id,
        projectName: workflow.project.name,
        clips: embeddedVideos.map((url, index) => ({ order: index + 1, url, duration: clipPlans[index]?.duration, shotId: clipPlans[index]?.shot.id })),
        warnings
      }
    });
    const manifest = await writeCompositionManifest(session, workflow, {
      outputUrl: embeddedManifestUrl,
      subtitleUrl: subtitle.url,
      audioUrl: tts.audioUrl,
      ttsManifestUrl: tts.manifestUrl,
      concatListUrl: concat.url,
      ffmpeg,
      size,
      clips: [],
      warnings,
      startedAt,
      status: "diagnostic"
    });
    return {
      outputUrl: embeddedManifestUrl,
      manifestUrl: manifest.url,
      subtitleUrl: subtitle.url,
      audioUrl: tts.audioUrl,
      concatListUrl: concat.url,
      ffmpegReady: false,
      clipCount: embeddedVideos.length,
      warnings,
      mimeType: "application/json"
    };
  }

  try {
    const encoder = await resolveVideoEncoder(ffmpeg.bin);
    const renderedClips: RenderedClip[] = [];
    for (const clip of clipPlans) {
      renderedClips.push(await renderClip(ffmpeg.bin, encoder, session, clip, size, warnings));
    }
    const concat = await writeSessionText(session, "concat.txt", renderedClips.map((clip) => `file '${escapeConcatPath(clip.outputPath)}'`).join("\n"));
    const joined = fileInSession(session, "joined.mp4");
    await runFfmpegOrThrow(ffmpeg.bin, ["-y", "-f", "concat", "-safe", "0", "-i", concat.path, "-c", "copy", joined.path], 180_000);

    const final = fileInSession(session, `${safeSegment(workflow.project.name || workflow.project.id)}-final.mp4`);
    await muxFinalVideo(ffmpeg.bin, joined.path, tts.audioUrl, subtitle.path, final.path, warnings);
    const manifest = await writeCompositionManifest(session, workflow, {
      outputUrl: final.url,
      subtitleUrl: subtitle.url,
      audioUrl: tts.audioUrl,
      ttsManifestUrl: tts.manifestUrl,
      concatListUrl: concat.url,
      ffmpeg,
      encoder: encoder.name,
      size,
      clips: renderedClips,
      warnings,
      startedAt,
      status: "mp4_ready"
    });
    return {
      outputUrl: final.url,
      manifestUrl: manifest.url,
      subtitleUrl: subtitle.url,
      audioUrl: tts.audioUrl,
      concatListUrl: concat.url,
      finalVideoUrl: final.url,
      ffmpegReady: true,
      clipCount: renderedClips.length,
      warnings,
      mimeType: "video/mp4"
    };
  } catch (error) {
    warnings.push(`FFmpeg 合成失败，已保留配音/字幕/诊断清单：${formatError(error)}`);
    const manifest = await writeCompositionManifest(session, workflow, {
      outputUrl: undefined,
      subtitleUrl: subtitle.url,
      audioUrl: tts.audioUrl,
      ttsManifestUrl: tts.manifestUrl,
      ffmpeg,
      size,
      clips: [],
      warnings,
      startedAt,
      status: "diagnostic"
    });
    return diagnosticResult(manifest, subtitle.url, tts.audioUrl, true, warnings);
  }
}

export async function probeFfmpeg(): Promise<FfmpegProbe> {
  const candidates = ffmpegBinaryCandidates();
  let lastResult: CommandResult | undefined;
  let lastBin = candidates[0]!;
  for (const bin of candidates) {
    const result = await runProcess(bin, ["-version"], 8_000);
    lastResult = result;
    lastBin = bin;
    if (result.exitCode === 0) {
      return {
        ready: true,
        bin,
        deployment: ffmpegDeploymentStrategy(bin),
        version: firstLine(result.stdout || result.stderr)
      };
    }
  }
  const deployment = ffmpegDeploymentStrategy(lastBin);
  const result = lastResult ?? { exitCode: null, stdout: "", stderr: "", errorMessage: "ffmpeg probe did not run", timedOut: false };
  if (result.exitCode !== 0) {
    return {
      ready: false,
      bin: lastBin,
      failureCode: classifyFfmpegProbeFailure(result),
      deployment,
      message: result.errorMessage
        ? `未检测到可用 FFmpeg：${result.errorMessage}`
        : "未检测到可用 FFmpeg；请将 ffmpeg.exe 放入 tools/ffmpeg/bin 或 vendor/ffmpeg/bin，或在 .env.local 配置 FFMPEG_BIN。"
    };
  }
  return { ready: false, bin: lastBin, failureCode: "probe_failed", deployment };
}

function buildClipPlans(workflow: ProjectWorkflow): ClipPlan[] {
  const assetById = new Map(workflow.assets.map((asset) => [asset.id, asset]));
  return workflow.storyboards.map((shot, index) => {
    const video = assetById.get(`video_${shot.id}`);
    const image = assetById.get(`image_${shot.id}`);
    const videoUrl = video?.referenceUrl;
    return {
      order: index + 1,
      shot,
      duration: normalizeDuration(shot.duration),
      videoUrl: isPlayableMediaUrl(videoUrl) ? videoUrl : undefined,
      imageUrl: image?.referenceUrl
    };
  });
}

async function renderClip(
  ffmpegBin: string,
  encoder: VideoEncoder,
  session: ExportSession,
  clip: ClipPlan,
  size: ExportSize,
  warnings: string[]
): Promise<RenderedClip> {
  const output = fileInSession(session, `clip-${String(clip.order).padStart(3, "0")}-${safeSegment(clip.shot.id)}.mp4`);
  const videoInput = clip.videoUrl ? await resolveMediaInput(clip.videoUrl, warnings) : undefined;
  if (videoInput) {
    try {
      await encodeVideoClip(ffmpegBin, encoder, videoInput, output.path, clip.duration, size);
      return { order: clip.order, shotId: clip.shot.id, duration: clip.duration, sourceKind: "video", sourceUrl: clip.videoUrl, outputPath: output.path, outputUrl: output.url };
    } catch (error) {
      warnings.push(`镜头 ${formatShotLabel(clip.shot)} 视频片段转码失败，已回退到首帧图：${formatError(error)}`);
    }
  }

  const imageInput = clip.imageUrl ? await resolveMediaInput(clip.imageUrl, warnings) : undefined;
  if (imageInput) {
    try {
      await encodeImageClip(ffmpegBin, encoder, imageInput, output.path, clip.duration, size);
      return { order: clip.order, shotId: clip.shot.id, duration: clip.duration, sourceKind: "image", sourceUrl: clip.imageUrl, outputPath: output.path, outputUrl: output.url };
    } catch (error) {
      warnings.push(`镜头 ${formatShotLabel(clip.shot)} 首帧转视频失败，已回退到色卡片段：${formatError(error)}`);
    }
  }

  await encodeColorCardClip(ffmpegBin, encoder, output.path, clip.duration, size);
  return { order: clip.order, shotId: clip.shot.id, duration: clip.duration, sourceKind: "color_card", outputPath: output.path, outputUrl: output.url };
}

async function encodeVideoClip(ffmpegBin: string, encoder: VideoEncoder, input: string, output: string, duration: number, size: ExportSize) {
  await runFfmpegOrThrow(ffmpegBin, [
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    input,
    "-t",
    String(duration),
    "-an",
    "-vf",
    normalizeVideoFilter(size),
    "-r",
    "24",
    ...encoder.args,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output
  ], 180_000);
}

async function encodeImageClip(ffmpegBin: string, encoder: VideoEncoder, input: string, output: string, duration: number, size: ExportSize) {
  await runFfmpegOrThrow(ffmpegBin, [
    "-y",
    "-loop",
    "1",
    "-t",
    String(duration),
    "-i",
    input,
    "-vf",
    normalizeVideoFilter(size),
    "-r",
    "24",
    ...encoder.args,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output
  ], 120_000);
}

async function encodeColorCardClip(ffmpegBin: string, encoder: VideoEncoder, output: string, duration: number, size: ExportSize) {
  await runFfmpegOrThrow(ffmpegBin, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x111827:s=${size.width}x${size.height}:r=24:d=${duration}`,
    "-t",
    String(duration),
    ...encoder.args,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output
  ], 90_000);
}

async function muxFinalVideo(ffmpegBin: string, videoPath: string, audioUrl: string, subtitlePath: string, outputPath: string, warnings: string[]) {
  const audioPath = localStoragePath(audioUrl);
  if (!audioPath) throw new Error(`配音文件不可读取：${audioUrl}`);
  const subtitleHasContent = await fileHasContent(subtitlePath);
  if (subtitleHasContent) {
    try {
      await runFfmpegOrThrow(ffmpegBin, [
        "-y",
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-i",
        subtitlePath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-map",
        "2:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-af",
        "apad",
        "-c:s",
        "mov_text",
        "-metadata:s:s:0",
        "language=chi",
        "-shortest",
        "-movflags",
        "+faststart",
        outputPath
      ], 180_000);
      return;
    } catch (error) {
      warnings.push(`字幕轨封装失败，已生成带配音但不含字幕轨的 MP4：${formatError(error)}`);
    }
  }

  await runFfmpegOrThrow(ffmpegBin, [
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-af",
    "apad",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath
  ], 180_000);
}

async function resolveVideoEncoder(ffmpegBin: string): Promise<VideoEncoder> {
  const result = await runProcess(ffmpegBin, ["-hide_banner", "-encoders"], 10_000);
  const output = `${result.stdout}\n${result.stderr}`;
  if (output.includes("libx264")) return { name: "libx264", args: ["-c:v", "libx264", "-preset", "veryfast"] };
  return { name: "mpeg4", args: ["-c:v", "mpeg4", "-q:v", "4"] };
}

async function resolveMediaInput(url: string, warnings: string[]) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const local = localStoragePath(url);
  if (!local) {
    warnings.push(`素材不是本地 /storage 或 HTTP URL，无法直接交给 FFmpeg：${url.slice(0, 80)}`);
    return undefined;
  }
  try {
    await access(local);
    return local;
  } catch {
    warnings.push(`素材文件不存在，已跳过：${url}`);
    return undefined;
  }
}

function createScratchNarrationWav(workflow: ProjectWorkflow, cues = buildVoiceCues(workflow)) {
  const sampleRate = 24_000;
  const samples: number[] = [];
  cues.forEach((cue) => {
    const sampleCount = Math.max(1, Math.round(cue.duration * sampleRate));
    const hash = hashText(cue.text || cue.shotId);
    const baseFrequency = 170 + (hash % 90);
    const pulseRate = cue.text ? Math.min(7, Math.max(3, cue.text.length / Math.max(1, cue.duration) / 2)) : 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const t = i / sampleRate;
      const fade = Math.min(1, i / 800, (sampleCount - i) / 800);
      const speechGate = cue.text ? 0.2 + 0.8 * Math.max(0, Math.sin(Math.PI * 2 * pulseRate * t)) : 0;
      const ambience = cue.text ? 0 : 0.006 * Math.sin(Math.PI * 2 * 90 * t);
      const voice = cue.text
        ? 0.065 * speechGate * (Math.sin(Math.PI * 2 * baseFrequency * t) + 0.28 * Math.sin(Math.PI * 2 * baseFrequency * 1.52 * t))
        : ambience;
      samples.push(clampInt16(voice * fade * 32767));
    }
  });
  if (!samples.length) {
    for (let i = 0; i < sampleRate; i += 1) samples.push(0);
  }
  return pcm16Wav(samples, sampleRate);
}

function buildVoiceCues(workflow: ProjectWorkflow) {
  return workflow.storyboards.map((shot) => ({
    shotId: shot.id,
    duration: normalizeDuration(shot.duration),
    speaker: inferCueSpeaker(shot, shot.dialogue || shot.voiceOver || ""),
    voice: resolveCueVoice(workflow, shot, shot.dialogue || shot.voiceOver || ""),
    text: normalizeSubtitleText(shot.dialogue || shot.voiceOver || "")
  }));
}

async function synthesizeNarrationWav(
  session: ExportSession,
  workflow: ProjectWorkflow,
  cues = buildVoiceCues(workflow)
): Promise<{ buffer: Buffer; provider: string; ext: "wav" | "mp3"; warnings: string[] }> {
  const requestedProvider = normalizeTtsProvider(process.env.TTS_PROVIDER || inferConfiguredTtsProvider());
  if (requestedProvider === "dashscope-tts") {
    try {
      return await createDashScopeTtsNarration(session, cues);
    } catch (error) {
      return fallbackAfterOpenSourceTtsFailure(session, workflow, cues, `DashScope TTS 配音失败：${formatError(error)}`);
    }
  }
  if (requestedProvider === "easyvoice") {
    try {
      return await createEasyVoiceNarration(session, cues);
    } catch (error) {
      return fallbackAfterOpenSourceTtsFailure(session, workflow, cues, `easyVoice 配音失败：${formatError(error)}`);
    }
  }
  if (requestedProvider === "voicebox") {
    try {
      return await createVoiceboxNarration(cues);
    } catch (error) {
      return fallbackAfterOpenSourceTtsFailure(session, workflow, cues, `Voicebox 配音失败：${formatError(error)}`);
    }
  }
  if (requestedProvider === "vibevoice") {
    try {
      return await createVibeVoiceNarration(cues);
    } catch (error) {
      return fallbackAfterOpenSourceTtsFailure(session, workflow, cues, `VibeVoice 自托管适配失败：${formatError(error)}`);
    }
  }
  const canUseWindowsSapi = process.platform === "win32" && (!requestedProvider || requestedProvider === "windows-sapi" || requestedProvider === "local-tts");
  if (canUseWindowsSapi && cues.some((cue) => cue.text)) {
    try {
      return { buffer: await createWindowsSapiNarrationWav(session, cues), provider: "windows-sapi", ext: "wav", warnings: [] };
    } catch (error) {
      return {
        buffer: createScratchNarrationWav(workflow, cues),
        ext: "wav",
        provider: "scratch-local-wav",
        warnings: [`Windows SAPI 未生成可用音频，已退回占位音轨。生产环境建议配置 easyVoice/VibeVoice HTTP TTS 服务。${shortTtsFailure(error)}`]
      };
    }
  }
  return { buffer: createScratchNarrationWav(workflow, cues), provider: "scratch-local-wav", ext: "wav", warnings: [] };
}

async function createEasyVoiceNarration(session: ExportSession, cues: ReturnType<typeof buildVoiceCues>) {
  const endpoint = endpointFromBase(
    process.env.EASYVOICE_BASE_URL || process.env.TTS_BASE_URL || "http://127.0.0.1:3000",
    process.env.EASYVOICE_TTS_PATH || "/api/v1/tts/generateJson"
  );
  const payload = {
    data: cues
      .filter((cue) => cue.text)
      .map((cue, index) => ({
        id: cue.shotId,
        index: index + 1,
        speaker: cue.speaker,
        role: cue.speaker,
        voice: cue.voice || process.env.EASYVOICE_DEFAULT_VOICE || process.env.TTS_VOICE || "zh-CN-XiaoxiaoNeural",
        text: cue.text,
        desc: cue.text,
        rate: process.env.EASYVOICE_RATE || process.env.TTS_RATE || "+0%",
        pitch: process.env.EASYVOICE_PITCH || "+0Hz",
        volume: process.env.EASYVOICE_VOLUME || "+0%"
      })),
    format: "mp3",
    project: "aifilm-video-export"
  };
  const audio = await postJsonForAudio(endpoint, payload, "easyvoice");
  await writeSessionText(session, "easyvoice-request.json", JSON.stringify({ endpoint, payload: redactPayload(payload) }, null, 2));
  return { ...audio, provider: "easyvoice", warnings: [] };
}

async function createVoiceboxNarration(cues: ReturnType<typeof buildVoiceCues>) {
  const endpoint = endpointFromBase(
    process.env.VOICEBOX_BASE_URL || process.env.TTS_BASE_URL || "http://127.0.0.1:8080",
    process.env.VOICEBOX_TTS_PATH || "/generate"
  );
  const text = cues.filter((cue) => cue.text).map((cue) => `${cue.speaker}：${cue.text}`).join("\n");
  const payload = {
    text,
    profile_id: process.env.VOICEBOX_PROFILE_ID || process.env.TTS_VOICE,
    engine: process.env.VOICEBOX_ENGINE || process.env.TTS_MODEL,
    language: process.env.TTS_LANGUAGE || "zh"
  };
  const audio = await postJsonForAudio(endpoint, payload, "voicebox");
  return { ...audio, provider: "voicebox", warnings: [] };
}

async function createVibeVoiceNarration(cues: ReturnType<typeof buildVoiceCues>) {
  const baseUrl = process.env.VIBEVOICE_BASE_URL || process.env.TTS_BASE_URL;
  if (!baseUrl) throw new Error("VibeVoice 需要配置 VIBEVOICE_BASE_URL 或 TTS_BASE_URL 指向自托管推理服务。官方 VibeVoice-TTS 仓库不再提供可直接嵌入的 TTS 代码。 ");
  const endpoint = endpointFromBase(baseUrl, process.env.VIBEVOICE_TTS_PATH || "/tts");
  const speakers = Array.from(new Set(cues.filter((cue) => cue.text).map((cue) => cue.speaker))).slice(0, 4);
  const payload = {
    model: process.env.VIBEVOICE_MODEL || process.env.TTS_MODEL || "VibeVoice-1.5B",
    format: "wav",
    speakers,
    segments: cues.filter((cue) => cue.text).map((cue) => ({ speaker: cue.speaker, text: cue.text, duration: cue.duration }))
  };
  const audio = await postJsonForAudio(endpoint, payload, "vibevoice");
  return { ...audio, provider: "vibevoice", warnings: [] };
}

async function createDashScopeTtsNarration(session: ExportSession, cues: ReturnType<typeof buildVoiceCues>) {
  const runtime = resolveDashScopeTtsRuntime();
  const voicedCues = cues.filter((cue) => cue.text);
  if (!voicedCues.length) {
    return {
      buffer: pcm16Wav(new Array(24_000).fill(0), 24_000),
      provider: "dashscope-tts",
      ext: "wav" as const,
      warnings: ["当前项目没有可配音台词，已生成 1 秒静音音轨用于保持导出链路完整。"]
    };
  }

  const requests = voicedCues.map((cue, index) => ({
    index: index + 1,
    shotId: cue.shotId,
    speaker: cue.speaker,
    voice: cue.voice || runtime.defaultVoice,
    text: cue.text,
    duration: cue.duration
  }));
  await writeSessionText(session, "dashscope-tts-request.json", JSON.stringify({
    provider: "dashscope-tts",
    endpoint: runtime.endpoint,
    model: runtime.model,
    requests
  }, null, 2));

  const rendered = await Promise.all(requests.map(async (item) => ({
    ...item,
    wav: parsePcm16Wav(await requestDashScopeTtsCue(runtime, item.text, item.voice))
  })));
  const sampleRate = rendered[0]?.wav.sampleRate ?? 24_000;
  const samples: number[] = [];
  rendered.forEach((item) => {
    samples.push(...fitCueSamples(resampleSamples(item.wav.samples, item.wav.sampleRate, sampleRate), item.duration, sampleRate));
  });

  return {
    buffer: pcm16Wav(samples, sampleRate),
    provider: "dashscope-tts",
    ext: "wav" as const,
    warnings: []
  };
}

function resolveDashScopeTtsRuntime() {
  const apiKey =
    process.env.DASHSCOPE_TTS_API_KEY ||
    process.env.TTS_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.DASHSCOPE_TEXT_API_KEY;
  if (!apiKey) throw new Error("Missing DASHSCOPE_TTS_API_KEY or DASHSCOPE_API_KEY for DashScope TTS");
  const baseUrl =
    process.env.DASHSCOPE_TTS_BASE_URL ||
    process.env.TTS_BASE_URL ||
    process.env.DASHSCOPE_BASE_URL ||
    dashScopeApiBaseFromTextBase(process.env.DASHSCOPE_TEXT_BASE_URL) ||
    "https://dashscope.aliyuncs.com/api/v1";
  return {
    apiKey,
    baseUrl,
    endpoint: endpointFromBase(baseUrl, process.env.DASHSCOPE_TTS_PATH || "/services/aigc/multimodal-generation/generation"),
    model: process.env.DASHSCOPE_TTS_MODEL || process.env.TTS_MODEL || "qwen3-tts-flash",
    defaultVoice: process.env.DASHSCOPE_TTS_DEFAULT_VOICE || process.env.TTS_VOICE || "Cherry"
  };
}

async function requestDashScopeTtsCue(
  runtime: ReturnType<typeof resolveDashScopeTtsRuntime>,
  text: string,
  voice: string
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.TTS_REQUEST_TIMEOUT_MS ?? 300_000));
  try {
    const response = await fetch(runtime.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.apiKey}`
      },
      body: JSON.stringify({
        model: runtime.model,
        input: {
          text,
          voice,
          language_type: process.env.DASHSCOPE_TTS_LANGUAGE_TYPE || process.env.TTS_LANGUAGE || "Chinese"
        }
      }),
      signal: controller.signal
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(`DashScope TTS HTTP ${response.status}: ${bytes.toString("utf8").slice(0, 500)}`);
    const payload = JSON.parse(bytes.toString("utf8")) as {
      output?: { audio?: { url?: string } };
      data?: { audio?: { url?: string } };
    };
    const audioUrl = payload.output?.audio?.url || payload.data?.audio?.url;
    if (!audioUrl) throw new Error(`DashScope TTS response did not include audio.url: ${bytes.toString("utf8").slice(0, 500)}`);
    const audioResponse = await fetch(audioUrl);
    const audioBytes = Buffer.from(await audioResponse.arrayBuffer());
    if (!audioResponse.ok) throw new Error(`DashScope TTS audio download failed ${audioResponse.status}: ${audioBytes.toString("utf8").slice(0, 240)}`);
    if (audioBytes.toString("ascii", 0, 4) !== "RIFF") throw new Error("DashScope TTS did not return WAV audio");
    return audioBytes;
  } finally {
    clearTimeout(timeout);
  }
}

function dashScopeApiBaseFromTextBase(baseUrl?: string) {
  if (!baseUrl) return undefined;
  return baseUrl.replace(/\/compatible-mode\/v1\/?$/, "/api/v1");
}

async function fallbackAfterOpenSourceTtsFailure(
  session: ExportSession,
  workflow: ProjectWorkflow,
  cues: ReturnType<typeof buildVoiceCues>,
  warning: string
): Promise<{ buffer: Buffer; provider: string; ext: "wav" | "mp3"; warnings: string[] }> {
  if (process.platform === "win32" && cues.some((cue) => cue.text)) {
    try {
      return { buffer: await createWindowsSapiNarrationWav(session, cues), provider: "windows-sapi", ext: "wav", warnings: [warning] };
    } catch (error) {
      return {
        buffer: createScratchNarrationWav(workflow, cues),
        provider: "scratch-local-wav",
        ext: "wav",
        warnings: [warning, `Windows SAPI 兜底未生成可用音频，已退回占位音轨。${shortTtsFailure(error)}`]
      };
    }
  }
  return { buffer: createScratchNarrationWav(workflow, cues), provider: "scratch-local-wav", ext: "wav", warnings: [warning] };
}

async function postJsonForAudio(endpoint: string, payload: unknown, provider: string): Promise<{ buffer: Buffer; ext: "wav" | "mp3" }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.TTS_REQUEST_TIMEOUT_MS ?? 300_000));
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.TTS_API_KEY ? { Authorization: `Bearer ${process.env.TTS_API_KEY}` } : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") || "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(`${provider} HTTP ${response.status}: ${bytes.toString("utf8").slice(0, 500)}`);
    return contentType.includes("json") || looksLikeJson(bytes)
      ? await audioFromJsonResponse(bytes, endpoint)
      : { buffer: bytes, ext: audioExtFromMime(contentType, bytes) };
  } finally {
    clearTimeout(timeout);
  }
}

async function audioFromJsonResponse(bytes: Buffer, endpoint: string): Promise<{ buffer: Buffer; ext: "wav" | "mp3" }> {
  const data = JSON.parse(bytes.toString("utf8")) as any;
  const base64Audio = data.audio || data.audioBase64 || data.data?.audio || data.data?.audioBase64 || data.result?.audio;
  if (typeof base64Audio === "string" && base64Audio.length > 32) {
    const match = base64Audio.match(/^data:(.+?);base64,(.+)$/);
    const buffer = Buffer.from(match ? match[2] : base64Audio, "base64");
    return { buffer, ext: audioExtFromMime(match?.[1], buffer) };
  }
  const audioUrl = findAudioUrl(data);
  if (!audioUrl) throw new Error(`TTS 服务返回 JSON，但未找到 audio/url 字段：${JSON.stringify(data).slice(0, 500)}`);
  const resolvedUrl = new URL(audioUrl, endpoint).toString();
  const response = await fetch(resolvedUrl, { headers: process.env.TTS_API_KEY ? { Authorization: `Bearer ${process.env.TTS_API_KEY}` } : {} });
  const contentType = response.headers.get("content-type") || "";
  const audioBytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`下载 TTS 音频失败 ${response.status}: ${audioBytes.toString("utf8").slice(0, 300)}`);
  return { buffer: audioBytes, ext: audioExtFromMime(contentType, audioBytes) };
}

function findAudioUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "url" || key === "audioUrl" || key === "audio_url" || key === "file" || key === "path") && typeof entry === "string") {
      return entry;
    }
    const nested = findAudioUrl(entry);
    if (nested) return nested;
  }
  return undefined;
}

function audioExtFromMime(mime = "", bytes?: Buffer): "wav" | "mp3" {
  if (mime.includes("wav") || bytes?.toString("ascii", 0, 4) === "RIFF") return "wav";
  return "mp3";
}

function looksLikeJson(bytes: Buffer) {
  const first = bytes.toString("utf8", 0, Math.min(bytes.length, 16)).trimStart()[0];
  return first === "{" || first === "[";
}

function endpointFromBase(baseUrl: string, path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function normalizeTtsProvider(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[_\s-]+/g, "");
  if (normalized === "dashscopetts" || normalized === "aliyuntts" || normalized === "qwentts" || normalized === "bailiantts") return "dashscope-tts";
  if (normalized === "easyvoice") return "easyvoice";
  if (normalized === "voicebox") return "voicebox";
  if (normalized === "vibevoice" || normalized === "vibevoicetts") return "vibevoice";
  if (normalized === "windowssapi" || normalized === "sapi" || normalized === "localtts") return "windows-sapi";
  return value.trim().toLowerCase();
}

function inferConfiguredTtsProvider() {
  if (process.env.DASHSCOPE_TTS_API_KEY || process.env.DASHSCOPE_API_KEY) return "dashscope-tts";
  if (process.env.EASYVOICE_BASE_URL) return "easyvoice";
  if (process.env.VOICEBOX_BASE_URL) return "voicebox";
  if (process.env.VIBEVOICE_BASE_URL) return "vibevoice";
  return "";
}

function inferCueSpeaker(shot: StoryboardShot, rawText: string) {
  const match = rawText.match(/^([\u4e00-\u9fa5A-Za-z0-9_]{1,16})[：:]/);
  if (match?.[1]) return match[1];
  if (shot.voiceOver) return "旁白";
  return shot.characters[0] || "旁白";
}

function resolveCueVoice(workflow: ProjectWorkflow, shot: StoryboardShot, rawText: string) {
  const speaker = inferCueSpeaker(shot, rawText);
  const map = parseVoiceMap(process.env.DASHSCOPE_TTS_VOICE_MAP || process.env.EASYVOICE_VOICE_MAP || process.env.VOICEBOX_PROFILE_MAP || process.env.TTS_VOICE_MAP);
  if (map[speaker]) return map[speaker];
  const character = workflow.characters.find((item) => item.name === speaker) ?? workflow.characters.find((item) => shot.characters.includes(item.name));
  return character?.voiceId || process.env.DASHSCOPE_TTS_DEFAULT_VOICE || process.env.EASYVOICE_DEFAULT_VOICE || process.env.TTS_VOICE;
}

function parseVoiceMap(value?: string) {
  if (!value) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return Object.fromEntries(value.split(/[;,]/).map((item) => item.split(/[:=]/).map((part) => part.trim())).filter((item) => item[0] && item[1])) as Record<string, string>;
  }
}

function redactPayload<T>(payload: T): T {
  return payload;
}

function ttsProviderNote(provider: string) {
  if (provider === "dashscope-tts") return "当前使用阿里云百炼官方 Qwen TTS 生成多角色配音，音轨会直接进入字幕和 MP4 合成链路。";
  if (provider === "easyvoice") return "当前使用 easyVoice 开源 TTS 服务生成多角色/长文本配音，输出音频会进入最终 MP4 合成。";
  if (provider === "voicebox") return "当前使用 Voicebox 开源本地语音服务生成配音；多角色可通过 profile map 在环境变量中配置。";
  if (provider === "vibevoice") return "当前使用自托管 VibeVoice-TTS 兼容服务生成长文本多说话人配音。";
  if (provider === "windows-sapi") return "当前使用 Windows 系统语音合成生成与镜头时长对齐的 WAV；生产部署可切换到开源 TTS 服务。";
  return "当前内置 scratch-local-wav 会生成与镜头时长对齐的占位配音 WAV；接入开源 TTS 服务后可复用同一 cue 清单替换音频。";
}

async function createWindowsSapiNarrationWav(session: ExportSession, cues: ReturnType<typeof buildVoiceCues>) {
  const cueFile = fileInSession(session, "sapi-cues.json");
  await writeFile(cueFile.path, JSON.stringify(cues.map((cue, index) => ({ index: index + 1, text: cue.text })), null, 2), "utf8");
  const script = [
    "Add-Type -AssemblyName System.Speech",
    `$cues = Get-Content -LiteralPath ${psQuote(cueFile.path)} -Raw | ConvertFrom-Json`,
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "if ($env:TTS_VOICE) { try { $synth.SelectVoice($env:TTS_VOICE) } catch {} }",
    "if ($env:TTS_RATE) { $synth.Rate = [Math]::Max(-10, [Math]::Min(10, [int]$env:TTS_RATE)) }",
    "if ($env:TTS_VOLUME) { $synth.Volume = [Math]::Max(0, [Math]::Min(100, [int]$env:TTS_VOLUME)) } else { $synth.Volume = 92 }",
    `foreach ($cue in $cues) { if (-not [string]::IsNullOrWhiteSpace([string]$cue.text)) { $out = Join-Path ${psQuote(session.dir)} ("sapi-cue-" + $cue.index + ".wav"); $synth.SetOutputToWaveFile($out); $synth.Speak([string]$cue.text); $synth.SetOutputToNull() } }`,
    "$synth.Dispose()"
  ].join("; ");
  const result = await runProcess("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], 180_000);
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || result.errorMessage || "powershell exited with non-zero status");

  const parsed = new Map<number, PcmWav>();
  for (let index = 0; index < cues.length; index += 1) {
    if (!cues[index]?.text) continue;
    const wavPath = resolve(session.dir, `sapi-cue-${index + 1}.wav`);
    try {
      await access(wavPath);
      parsed.set(index, parsePcm16Wav(await readFile(wavPath)));
    } catch {
      // Some Windows voices silently skip file output. Missing cues become silence instead of failing the whole export.
    }
  }
  if (!parsed.size && cues.some((cue) => cue.text)) {
    throw new Error("Windows SAPI completed but did not create cue WAV files");
  }

  const sampleRate = parsed.values().next().value?.sampleRate ?? 24_000;
  const samples: number[] = [];
  cues.forEach((cue, index) => {
    const wav = parsed.get(index);
    const sourceSamples = wav ? resampleSamples(wav.samples, wav.sampleRate, sampleRate) : [];
    samples.push(...fitCueSamples(sourceSamples, cue.duration, sampleRate));
  });
  return pcm16Wav(samples.length ? samples : new Array(sampleRate).fill(0), sampleRate);
}

interface PcmWav {
  sampleRate: number;
  samples: number[];
}

function parsePcm16Wav(buffer: Buffer): PcmWav {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("系统 TTS 返回的不是 WAV 文件");
  }
  let offset = 12;
  let channels = 1;
  let sampleRate = 24_000;
  let bitsPerSample = 16;
  let audioFormat = 1;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      audioFormat = buffer.readUInt16LE(start);
      channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4);
      bitsPerSample = buffer.readUInt16LE(start + 14);
    } else if (id === "data") {
      dataOffset = start;
      dataSize = Math.max(0, Math.min(size, buffer.length - start));
    }
    offset = start + size + (size % 2);
  }
  if (audioFormat !== 1 || bitsPerSample !== 16 || dataOffset < 0) {
    throw new Error("仅支持 PCM 16-bit WAV TTS 输出");
  }
  const samples: number[] = [];
  const frameCount = Math.floor(dataSize / (channels * 2));
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += buffer.readInt16LE(dataOffset + (frame * channels + channel) * 2);
    }
    samples.push(Math.round(sum / channels));
  }
  return { sampleRate, samples };
}

function resampleSamples(samples: number[], fromRate: number, toRate: number) {
  if (fromRate === toRate || samples.length <= 1) return samples;
  const targetLength = Math.max(1, Math.round(samples.length * toRate / fromRate));
  const output: number[] = [];
  for (let index = 0; index < targetLength; index += 1) {
    const position = index * (samples.length - 1) / Math.max(1, targetLength - 1);
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const ratio = position - left;
    output.push(Math.round(samples[left] * (1 - ratio) + samples[right] * ratio));
  }
  return output;
}

function fitCueSamples(samples: number[], duration: number, sampleRate: number) {
  const target = Math.max(1, Math.round(duration * sampleRate));
  if (samples.length >= target) return samples.slice(0, target);
  return samples.concat(new Array(target - samples.length).fill(0));
}

function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function pcm16Wav(samples: number[], sampleRate: number) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * bytesPerSample));
  return buffer;
}

function clampInt16(value: number) {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

interface ExportSession {
  name: string;
  dir: string;
}

async function createExportSession(projectId: string, prefix: string): Promise<ExportSession> {
  const name = `${prefix}-${safeSegment(projectId)}-${Date.now()}`;
  const dir = resolve(storageRoot, "exports", name);
  await mkdir(dir, { recursive: true });
  return { name, dir };
}

async function writeSessionText(session: ExportSession, fileName: string, content: string): Promise<SessionFile> {
  const file = fileInSession(session, fileName);
  await writeFile(file.path, content, "utf8");
  return file;
}

function fileInSession(session: ExportSession, fileName: string): SessionFile {
  return {
    path: resolve(session.dir, fileName),
    url: `/storage/exports/${session.name}/${fileName}`
  };
}

async function writeCompositionManifest(
  session: ExportSession,
  workflow: ProjectWorkflow,
  data: {
    outputUrl?: string;
    subtitleUrl: string;
    audioUrl: string;
    ttsManifestUrl: string;
    concatListUrl?: string;
    ffmpeg: FfmpegProbe;
    encoder?: string;
    size: ExportSize;
    clips: RenderedClip[];
    warnings: string[];
    startedAt: number;
    status: "mp4_ready" | "diagnostic";
  }
) {
  return writeSessionText(session, "manifest.json", JSON.stringify({
    ...createLingGuoProductionManifest(workflow, data.ffmpeg.ready),
    status: data.status,
    pipeline: ["生成片段", "多角色配音", "SRT 字幕", "FFmpeg 合成 MP4", "权限下载"],
    outputKind: data.status === "mp4_ready" ? "mp4" : "diagnostic_bundle",
    downloadReady: Boolean(data.outputUrl),
    previewReady: data.status === "mp4_ready",
    cleanRoomImplementation: true,
    licenseNote: "Toonflow/字幕工具/easyVoice 仅作为流程和接口能力参考；本模块为项目内自研 TypeScript 编排、WAV/SRT/FFmpeg 调度和洁净兜底源码，未复制无明确许可证的第三方源码。",
    ttsSourcePolicy: "优先使用阿里云百炼官方 Qwen TTS 云端合成；开源或本地 TTS 仅作为降级适配器，不再承担正式生产主链路。当前仍保留 scratch/windows-sapi fallback 以保证异常时可继续导出诊断资产。",
    ffmpegDeployment: {
      requiredForMp4: true,
      ready: data.ffmpeg.ready,
      bin: data.ffmpeg.bin,
      version: data.ffmpeg.version,
      failureCode: data.ffmpeg.failureCode,
      strategy: data.ffmpeg.deployment.strategy,
      envKey: data.ffmpeg.deployment.envKey,
      installHint: data.ffmpeg.deployment.installHint
    },
    failureRefundPolicy: "视频模型未返回可播放片段前应保持 running 或 failed，不正式扣除最终消耗；导出失败只生成诊断包，不额外扣费。",
    outputUrl: data.outputUrl,
    subtitleUrl: data.subtitleUrl,
    audioUrl: data.audioUrl,
    ttsManifestUrl: data.ttsManifestUrl,
    concatListUrl: data.concatListUrl,
    ffmpeg: data.ffmpeg,
    encoder: data.encoder,
    exportSize: data.size,
    renderedClips: data.clips.map((clip) => ({
      order: clip.order,
      shotId: clip.shotId,
      duration: clip.duration,
      sourceKind: clip.sourceKind,
      sourceUrl: clip.sourceUrl,
      clipUrl: clip.outputUrl
    })),
    warnings: data.warnings,
    elapsedMs: Date.now() - data.startedAt
  }, null, 2));
}

function diagnosticResult(manifest: SessionFile, subtitleUrl: string, audioUrl: string, ffmpegReady: boolean, warnings: string[], concatListUrl?: string): VideoCompositionResult {
  return {
    outputUrl: manifest.url,
    manifestUrl: manifest.url,
    subtitleUrl,
    audioUrl,
    concatListUrl,
    ffmpegReady,
    clipCount: 0,
    warnings,
    mimeType: "application/json"
  };
}

function ffmpegBinaryCandidates() {
  const names = process.platform === "win32" ? ["ffmpeg.exe", "ffmpeg"] : ["ffmpeg"];
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
  const apiPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../");
  const bundledDirs = [
    resolve(repoRoot, "tools/ffmpeg/bin"),
    resolve(repoRoot, "vendor/ffmpeg/bin"),
    resolve(repoRoot, "deploy/ffmpeg/bin"),
    resolve(repoRoot, "bin/ffmpeg"),
    resolve(apiPackageRoot, "node_modules/ffmpeg-static")
  ];
  const candidates = [
    process.env.FFMPEG_BIN,
    ...bundledDirs.flatMap((dir) => names.map((name) => resolve(dir, name))),
    "ffmpeg"
  ].filter((item): item is string => Boolean(item));
  return [...new Set(candidates)];
}

function ffmpegDeploymentStrategy(bin: string): FfmpegProbe["deployment"] {
  const normalized = bin.replace(/\\/g, "/").toLowerCase();
  const isBundled = ["/tools/ffmpeg/bin/", "/vendor/ffmpeg/bin/", "/deploy/ffmpeg/bin/", "/bin/ffmpeg/"].some((part) => normalized.includes(part));
  return {
    strategy: process.env.FFMPEG_BIN ? "env_bin" : isBundled ? "bundled_bin" : "system_path",
    envKey: "FFMPEG_BIN",
    installHint: process.platform === "win32"
      ? "生产环境建议把 ffmpeg.exe 随服务放入 tools\\\\ffmpeg\\\\bin 或 vendor\\\\ffmpeg\\\\bin；也可以在 .env.production 配置 FFMPEG_BIN=C:\\\\path\\\\to\\\\ffmpeg.exe。"
      : "生产环境建议在 Docker 镜像安装 ffmpeg，或把静态 ffmpeg 二进制放入 tools/ffmpeg/bin 并配置 FFMPEG_BIN=/usr/local/bin/ffmpeg。"
  };
}

function classifyFfmpegProbeFailure(result: CommandResult): NonNullable<FfmpegProbe["failureCode"]> {
  const message = `${result.errorMessage || ""}\n${result.stderr || ""}`.toLowerCase();
  if (result.timedOut) return "timeout";
  if (message.includes("enoent") || message.includes("not found") || message.includes("找不到")) return "not_found";
  if (message.includes("permission") || message.includes("access") || message.includes("拒绝")) return "permission_denied";
  return "probe_failed";
}

function isPlayableMediaUrl(url?: AssetItem["referenceUrl"]) {
  if (!url) return false;
  return url.startsWith("/storage/") || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:video");
}

function localStoragePath(url: string) {
  if (!url.startsWith("/storage/")) return undefined;
  const relativePath = url.replace(/^\/storage\//, "").split(/[?#]/)[0]?.replace(/\\/g, "/").replace(/\.\./g, "");
  if (!relativePath) return undefined;
  const target = resolve(storageRoot, relativePath);
  const rel = relative(storageRoot, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return target;
}

function resolveExportSize(ratio: ProjectWorkflow["project"]["videoRatio"]): ExportSize {
  const envWidth = Number(process.env.EXPORT_VIDEO_WIDTH || 0);
  const envHeight = Number(process.env.EXPORT_VIDEO_HEIGHT || 0);
  if (envWidth > 0 && envHeight > 0) return { width: envWidth, height: envHeight };
  if (ratio === "16:9") return { width: 1280, height: 720 };
  if (ratio === "1:1") return { width: 1024, height: 1024 };
  return { width: 720, height: 1280 };
}

function normalizeVideoFilter(size: ExportSize) {
  return `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p`;
}

function normalizeDuration(value: number) {
  return Math.max(1, Math.min(30, Number.isFinite(value) ? Math.round(value) : 3));
}

function totalDuration(workflow: ProjectWorkflow) {
  return workflow.storyboards.reduce((sum, shot) => sum + normalizeDuration(shot.duration), 0) || 1;
}

function normalizeSubtitleText(value: string) {
  return value.replace(/^[\u4e00-\u9fa5A-Za-z0-9_]{1,12}[：:]/, "").trim();
}

function formatSrtTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${String(milliseconds).padStart(3, "0")}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function safeSegment(value: string) {
  return value
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "export";
}

function escapeConcatPath(value: string) {
  return value.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

async function fileHasContent(path: string) {
  const result = await access(path).then(() => true).catch(() => false);
  if (!result) return false;
  const { readFile } = await import("node:fs/promises");
  return (await readFile(path, "utf8")).trim().length > 0;
}

async function runFfmpegOrThrow(ffmpegBin: string, args: string[], timeoutMs: number) {
  const result = await runProcess(ffmpegBin, args, timeoutMs);
  if (result.exitCode === 0) return result;
  const command = formatCommand(ffmpegBin, args);
  const tail = (result.stderr || result.stdout || result.errorMessage || "unknown error").slice(-1200);
  throw new Error(`${command}\n${tail}`);
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = trimProcessBuffer(stdout + chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = trimProcessBuffer(stderr + chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ exitCode: null, stdout, stderr, errorMessage: error.message, timedOut });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

function trimProcessBuffer(value: string) {
  return value.length > 32_000 ? value.slice(-32_000) : value;
}

function formatCommand(command: string, args: string[]) {
  return [command, ...args].map((part) => /\s/.test(part) ? `"${part.replace(/"/g, "\\\"")}"` : part).join(" ");
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 900) : String(error).slice(0, 900);
}

function shortTtsFailure(error: unknown) {
  const message = formatError(error);
  if (!message) return "";
  if (message.includes("sapi-cue") || message.includes("ENOENT")) return "原因：系统语音没有写出 cue WAV 文件。";
  return `原因：${message.slice(0, 180)}`;
}

function firstLine(value: string) {
  return value.split(/\r?\n/).find(Boolean)?.trim();
}

function formatShotLabel(shot: StoryboardShot) {
  return `${shot.episodeNo}-${shot.sceneNo}-${shot.shotNo}`;
}
