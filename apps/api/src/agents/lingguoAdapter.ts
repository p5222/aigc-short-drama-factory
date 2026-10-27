import type { ProjectWorkflow, StoryboardShot } from "@aifilm/shared";

export interface LingGuoVoiceCue {
  shotId: string;
  shotNo: string;
  speaker: string;
  text: string;
  emotion: string;
  duration: number;
  suggestedVoiceId?: string;
  audioRole: "dialogue" | "voice_over" | "silence";
}

export interface LingGuoCompositionClip {
  shotId: string;
  order: number;
  imageUrl?: string;
  videoUrl?: string;
  duration: number;
  transition: {
    type: "none" | "fade" | "crossfade" | "flash";
    duration: number;
    reason: string;
  };
  subtitle: string;
  audioPrompt: string;
}

export interface LingGuoProductionManifest {
  projectId: string;
  projectName: string;
  source: "LingGuo-Drama inspired adapter";
  voiceEngine: string;
  lipsyncEngine: string;
  compositionEngine: string;
  ffmpegReady: boolean;
  voiceCues: LingGuoVoiceCue[];
  subtitles: Array<{
    index: number;
    start: string;
    end: string;
    text: string;
    shotId: string;
  }>;
  clips: LingGuoCompositionClip[];
  nextSteps: string[];
}

export function createLingGuoProductionManifest(workflow: ProjectWorkflow, ffmpegReady: boolean): LingGuoProductionManifest {
  const voiceCues = workflow.storyboards.map((shot) => createVoiceCue(shot, workflow));
  const subtitles = workflow.storyboards.map((shot, index) => {
    const startSeconds = workflow.storyboards.slice(0, index).reduce((sum, item) => sum + item.duration, 0);
    const endSeconds = startSeconds + shot.duration;
    return {
      index: index + 1,
      start: formatSrtTime(startSeconds),
      end: formatSrtTime(endSeconds),
      text: shot.dialogue || shot.voiceOver || "",
      shotId: shot.id
    };
  });
  const assetById = new Map(workflow.assets.map((asset) => [asset.id, asset]));
  const clips = workflow.storyboards.map<LingGuoCompositionClip>((shot, index) => {
    const imageAsset = assetById.get(`image_${shot.id}`);
    const videoAsset = assetById.get(`video_${shot.id}`);
    return {
      shotId: shot.id,
      order: index + 1,
      imageUrl: imageAsset?.referenceUrl,
      videoUrl: videoAsset?.referenceUrl,
      duration: shot.duration,
      transition: suggestTransition(shot, workflow.storyboards[index + 1]),
      subtitle: shot.dialogue || shot.voiceOver || "",
      audioPrompt: buildAudioPrompt(shot)
    };
  });

  const missingVideoCount = clips.filter((clip) => !clip.videoUrl).length;
  const missingVoiceCount = voiceCues.filter((cue) => cue.audioRole !== "silence" && !cue.suggestedVoiceId).length;

  return {
    projectId: workflow.project.id,
    projectName: workflow.project.name,
    source: "LingGuo-Drama inspired adapter",
    voiceEngine: process.env.TTS_PROVIDER || "manifest-only",
    lipsyncEngine: process.env.LIPSYNC_PROVIDER || "not-configured",
    compositionEngine: "ffmpeg",
    ffmpegReady,
    voiceCues,
    subtitles,
    clips,
    nextSteps: [
      missingVoiceCount > 0
        ? `有 ${missingVoiceCount} 条对白缺少角色音色。后台接入 TTS/声音克隆渠道后即可批量生成音频。`
        : "角色音色字段已具备，可进入 TTS 渠道生成。",
      missingVideoCount > 0
        ? `有 ${missingVideoCount} 条镜头还没有视频片段。请先完成图生视频，再做最终合成。`
        : "视频片段已齐，可执行 FFmpeg 合成。",
      ffmpegReady ? "已检测到 FFmpeg，可直接合成导出 MP4。" : "未检测到 FFmpeg，请配置 FFMPEG_BIN 或安装 FFmpeg 后再合成。",
      "唇形同步需要接入 Wav2Lip/SadTalker 服务地址；当前先输出可复盘的任务清单。"
    ]
  };
}

export function buildLingGuoTtsManifest(workflow: ProjectWorkflow) {
  return {
    projectId: workflow.project.id,
    projectName: workflow.project.name,
    source: "LingGuo-Drama inspired TTS manifest",
    provider: process.env.TTS_PROVIDER || "manifest-only",
    items: workflow.storyboards.map((shot) => createVoiceCue(shot, workflow))
  };
}

export function buildLingGuoSrt(workflow: ProjectWorkflow) {
  return workflow.storyboards
    .map((shot, index) => {
      const startSeconds = workflow.storyboards.slice(0, index).reduce((sum, item) => sum + item.duration, 0);
      const endSeconds = startSeconds + shot.duration;
      const text = shot.dialogue || shot.voiceOver || "";
      if (!text) return "";
      return [String(index + 1), `${formatSrtTime(startSeconds)} --> ${formatSrtTime(endSeconds)}`, normalizeSubtitleText(text), ""].join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

export function getLingGuoAdapterMetadata() {
  return {
    id: "lingguo-voice-composition",
    name: "LingGuo 配音/唇形/合成适配层",
    sourceRepo: "LingGuoAI/LingGuo-Drama",
    licenseNote: "LingGuo-Drama README 标注 MIT；当前按其任务拆分、视频插件、FFmpeg 合成思想做 TypeScript 适配。",
    capabilities: ["TTS 配音清单", "SRT 字幕", "FFmpeg 合成清单", "转场建议", "Wav2Lip/SadTalker 外部服务预留", "视频模型插件注册"],
    requiredEnv: ["TTS_PROVIDER 可选", "LIPSYNC_PROVIDER 可选", "FFMPEG_BIN 可选"]
  };
}

function createVoiceCue(shot: StoryboardShot, workflow: ProjectWorkflow): LingGuoVoiceCue {
  const text = shot.dialogue || shot.voiceOver || "";
  const speaker = inferSpeaker(shot, text);
  const character = workflow.characters.find((item) => item.name === speaker) ?? workflow.characters.find((item) => shot.characters.includes(item.name));
  return {
    shotId: shot.id,
    shotNo: `${shot.episodeNo}-${shot.sceneNo}-${shot.shotNo}`,
    speaker,
    text,
    emotion: shot.emotion || "平稳",
    duration: shot.duration,
    suggestedVoiceId: character?.voiceId,
    audioRole: shot.dialogue ? "dialogue" : shot.voiceOver ? "voice_over" : "silence"
  };
}

function inferSpeaker(shot: StoryboardShot, text: string) {
  const match = text.match(/^([\u4e00-\u9fa5A-Za-z0-9_]{1,12})[：:]/);
  if (match?.[1]) return match[1];
  if (shot.voiceOver) return "旁白";
  return shot.characters[0] || "旁白";
}

function buildAudioPrompt(shot: StoryboardShot) {
  return [
    shot.environmentSound ? `环境声：${shot.environmentSound}` : "",
    shot.soundEffect ? `音效：${shot.soundEffect}` : "",
    shot.emotion ? `情绪：${shot.emotion}` : ""
  ].filter(Boolean).join("；") || "保持轻微环境底噪";
}

function suggestTransition(current: StoryboardShot, next?: StoryboardShot): LingGuoCompositionClip["transition"] {
  if (!next) return { type: "none", duration: 0, reason: "最后一镜不需要转场" };
  if (current.scene !== next.scene) return { type: "fade", duration: 0.45, reason: "跨场景，用淡入淡出避免突兀" };
  if ((current.emotion || "") !== (next.emotion || "")) return { type: "crossfade", duration: 0.25, reason: "情绪转折，用短交叉淡化承接" };
  if ((next.soundEffect || "").includes("突然") || (next.emotion || "").includes("危机")) {
    return { type: "flash", duration: 0.18, reason: "危机/冲击镜头，用闪白增强节奏" };
  }
  return { type: "none", duration: 0, reason: "同场连续动作，直接剪切" };
}

function normalizeSubtitleText(value: string) {
  return value.replace(/^[\u4e00-\u9fa5A-Za-z0-9_]{1,12}[：:]/, "").trim();
}

function formatSrtTime(totalSeconds: number) {
  const milliseconds = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${String(milliseconds % 1000).padStart(3, "0")}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
