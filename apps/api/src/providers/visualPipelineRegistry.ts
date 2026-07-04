import type { ModelProvider } from "@aifilm/shared";

export type VisualPipelineKind = "video" | "workflow" | "lipsync" | "tts";

export interface VisualPipelineDescriptor {
  id: string;
  name: string;
  kind: VisualPipelineKind;
  providerAliases: string[];
  defaultBaseUrl?: string;
  defaultModel?: string;
  envKeys: string[];
  capability: string[];
  status: "ready" | "missing_key" | "disabled" | "not_configured";
  message: string;
}

const pipelineCatalog: Array<Omit<VisualPipelineDescriptor, "status" | "message"> & { keyEnv?: string; baseUrlEnv?: string; modelEnv?: string }> = [
  {
    id: "sora",
    name: "OpenAI Sora / 兼容视频",
    kind: "video",
    providerAliases: ["sora", "openai-sora", "openai-video"],
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "sora-1.0-turbo",
    envKeys: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_VIDEO_MODEL"],
    keyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    modelEnv: "OPENAI_VIDEO_MODEL",
    capability: ["文生视频", "图生视频", "异步任务", "内容接口取回"]
  },
  {
    id: "runway",
    name: "Runway Gen-3 / Gen-4",
    kind: "video",
    providerAliases: ["runway", "runwayml"],
    defaultBaseUrl: "https://api.runwayml.com",
    defaultModel: "gen3a_turbo",
    envKeys: ["RUNWAY_API_KEY", "RUNWAY_BASE_URL", "RUNWAY_VIDEO_MODEL"],
    keyEnv: "RUNWAY_API_KEY",
    baseUrlEnv: "RUNWAY_BASE_URL",
    modelEnv: "RUNWAY_VIDEO_MODEL",
    capability: ["图生视频", "任务轮询", "首帧控制"]
  },
  {
    id: "comfyui",
    name: "ComfyUI 工作流",
    kind: "workflow",
    providerAliases: ["comfyui", "comfy-ui"],
    defaultBaseUrl: "http://127.0.0.1:8188",
    defaultModel: "workflow-api",
    envKeys: ["COMFYUI_BASE_URL", "COMFYUI_API_KEY"],
    keyEnv: "COMFYUI_API_KEY",
    baseUrlEnv: "COMFYUI_BASE_URL",
    capability: ["工作流队列", "角色 LoRA", "ControlNet", "动漫/国风3D管线"]
  },
  {
    id: "svd",
    name: "Stable Video Diffusion",
    kind: "workflow",
    providerAliases: ["svd", "stable-video-diffusion"],
    defaultBaseUrl: "http://127.0.0.1:8188",
    defaultModel: "svd-workflow",
    envKeys: ["SVD_BASE_URL", "SVD_API_KEY"],
    keyEnv: "SVD_API_KEY",
    baseUrlEnv: "SVD_BASE_URL",
    capability: ["图生视频", "本地/ComfyUI 工作流", "成本可控"]
  },
  {
    id: "wav2lip",
    name: "Wav2Lip 唇形同步",
    kind: "lipsync",
    providerAliases: ["wav2lip"],
    defaultBaseUrl: "http://127.0.0.1:7860",
    defaultModel: "wav2lip",
    envKeys: ["WAV2LIP_BASE_URL", "WAV2LIP_API_KEY"],
    keyEnv: "WAV2LIP_API_KEY",
    baseUrlEnv: "WAV2LIP_BASE_URL",
    capability: ["视频+音频唇形同步", "外部服务适配"]
  },
  {
    id: "sadtalker",
    name: "SadTalker 数字人动脸",
    kind: "lipsync",
    providerAliases: ["sadtalker", "sad-talker"],
    defaultBaseUrl: "http://127.0.0.1:7861",
    defaultModel: "sadtalker",
    envKeys: ["SADTALKER_BASE_URL", "SADTALKER_API_KEY"],
    keyEnv: "SADTALKER_API_KEY",
    baseUrlEnv: "SADTALKER_BASE_URL",
    capability: ["头像驱动", "情感配音动脸", "外部服务适配"]
  },
  {
    id: "easyvoice",
    name: "easyVoice / 多角色长文本配音",
    kind: "tts",
    providerAliases: ["easyvoice", "easy-voice"],
    defaultBaseUrl: "http://127.0.0.1:3000",
    defaultModel: "edge-compatible-multi-role",
    envKeys: ["TTS_PROVIDER=easyvoice", "EASYVOICE_BASE_URL", "EASYVOICE_DEFAULT_VOICE", "EASYVOICE_VOICE_MAP"],
    baseUrlEnv: "EASYVOICE_BASE_URL",
    modelEnv: "EASYVOICE_DEFAULT_VOICE",
    capability: ["超长文本配音", "多角色分段", "批量合成音频", "HTTP 服务适配"]
  },
  {
    id: "voicebox",
    name: "Voicebox / 本地语音克隆与多引擎 TTS",
    kind: "tts",
    providerAliases: ["voicebox"],
    defaultBaseUrl: "http://127.0.0.1:8080",
    defaultModel: "local-profile",
    envKeys: ["TTS_PROVIDER=voicebox", "VOICEBOX_BASE_URL", "VOICEBOX_PROFILE_ID", "VOICEBOX_PROFILE_MAP"],
    baseUrlEnv: "VOICEBOX_BASE_URL",
    modelEnv: "VOICEBOX_PROFILE_ID",
    capability: ["本地语音克隆", "多 TTS 引擎", "长文本自动分块", "REST API"]
  },
  {
    id: "vibevoice",
    name: "VibeVoice-TTS / 自托管长音频多说话人",
    kind: "tts",
    providerAliases: ["vibevoice", "vibevoice-tts"],
    defaultModel: "VibeVoice-1.5B",
    envKeys: ["TTS_PROVIDER=vibevoice", "VIBEVOICE_BASE_URL", "VIBEVOICE_MODEL"],
    baseUrlEnv: "VIBEVOICE_BASE_URL",
    modelEnv: "VIBEVOICE_MODEL",
    capability: ["长音频生成", "最多 4 说话人", "中英文多语", "自托管推理服务适配"]
  },
  {
    id: "dashscope-tts",
    name: "阿里云百炼 / Qwen TTS",
    kind: "tts",
    providerAliases: ["dashscope-tts", "aliyun-tts", "qwen-tts"],
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
    defaultModel: "qwen3-tts-flash",
    envKeys: ["TTS_PROVIDER=dashscope-tts", "DASHSCOPE_TTS_BASE_URL", "DASHSCOPE_TTS_API_KEY", "DASHSCOPE_TTS_MODEL"],
    keyEnv: "DASHSCOPE_TTS_API_KEY",
    baseUrlEnv: "DASHSCOPE_TTS_BASE_URL",
    modelEnv: "DASHSCOPE_TTS_MODEL",
    capability: ["官方云端 TTS", "多角色 voice map", "长文本分段合成", "可迁移生产部署"]
  },
  {
    id: "edge-tts",
    name: "Edge TTS / 本地配音",
    kind: "tts",
    providerAliases: ["edge-tts", "local-tts"],
    defaultModel: "zh-CN-XiaoxiaoNeural",
    envKeys: ["TTS_PROVIDER", "TTS_BASE_URL", "TTS_API_KEY"],
    keyEnv: "TTS_API_KEY",
    baseUrlEnv: "TTS_BASE_URL",
    modelEnv: "TTS_MODEL",
    capability: ["对白配音", "旁白配音", "按角色音色映射"]
  }
];

export function listVisualPipelines(providers: ModelProvider[] = []): VisualPipelineDescriptor[] {
  return pipelineCatalog.map((item) => {
    const provider = providers.find((candidate) => item.providerAliases.includes(candidate.id) || item.providerAliases.some((alias) => candidate.name.toLowerCase().includes(alias)));
    const hasProviderConfig = Boolean(provider?.enabled && (provider.apiKeyConfigured || provider.baseUrl));
    const hasEnvKey = Boolean(item.keyEnv && process.env[item.keyEnv]);
    const hasLocalBaseUrl = Boolean(item.baseUrlEnv && process.env[item.baseUrlEnv]);
    const noKeyRequired = ["edge-tts", "easyvoice", "voicebox", "vibevoice", "comfyui", "svd", "wav2lip", "sadtalker"].includes(item.id);
    const status: VisualPipelineDescriptor["status"] = provider?.enabled === false
      ? "disabled"
      : hasProviderConfig || hasEnvKey || (noKeyRequired && hasLocalBaseUrl)
        ? "ready"
        : provider || hasLocalBaseUrl
          ? "missing_key"
          : "not_configured";
    const baseUrl = provider?.baseUrl || (item.baseUrlEnv ? process.env[item.baseUrlEnv] : undefined) || item.defaultBaseUrl;
    const model = provider?.models[0] || (item.modelEnv ? process.env[item.modelEnv] : undefined) || item.defaultModel;
    return {
      id: item.id,
      name: provider?.name || item.name,
      kind: item.kind,
      providerAliases: item.providerAliases,
      defaultBaseUrl: baseUrl,
      defaultModel: model,
      envKeys: item.envKeys,
      capability: item.capability,
      status,
      message: pipelineStatusMessage(status, baseUrl, model)
    };
  });
}

export async function testVisualPipeline(
  pipelineId: string,
  providers: ModelProvider[] = []
): Promise<VisualPipelineDescriptor & { ok: boolean; latencyMs: number }> {
  const started = Date.now();
  const descriptor = listVisualPipelines(providers).find((item) => item.id === pipelineId);
  if (!descriptor) throw new Error("未知视觉/配音插件：" + pipelineId);
  if (descriptor.status === "disabled") return { ...descriptor, ok: false, latencyMs: Date.now() - started, message: `${descriptor.name} 已停用。` };
  if (descriptor.status === "not_configured" || descriptor.status === "missing_key") {
    return { ...descriptor, ok: false, latencyMs: Date.now() - started };
  }

  if (descriptor.defaultBaseUrl?.startsWith("http://127.0.0.1") || descriptor.defaultBaseUrl?.startsWith("http://localhost")) {
    const health = await probeLocalService(descriptor.defaultBaseUrl).catch((error) => error instanceof Error ? error.message : String(error));
    if (health !== true) {
      return {
        ...descriptor,
        ok: false,
        status: "missing_key",
        latencyMs: Date.now() - started,
        message: `${descriptor.name} 本地服务未响应：${health}`
      };
    }
  }

  return {
    ...descriptor,
    ok: true,
    latencyMs: Date.now() - started,
    message: `${descriptor.name} 配置可用。真实生成会在对应 TTS/图生视频/合成任务中提交。`
  };
}

function pipelineStatusMessage(status: VisualPipelineDescriptor["status"], baseUrl?: string, model?: string) {
  if (status === "ready") return `配置已就绪：${[baseUrl, model].filter(Boolean).join(" / ")}`;
  if (status === "disabled") return "后台渠道已停用。";
  if (status === "missing_key") return `已发现 Base URL 或渠道记录，但缺少 Key/服务凭据：${baseUrl || "未配置 Base URL"}`;
  return "尚未在后台模型路由或环境变量中配置。";
}

async function probeLocalService(baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(baseUrl, { method: "GET", signal: controller.signal });
    return response.ok || response.status < 500;
  } finally {
    clearTimeout(timeout);
  }
}
