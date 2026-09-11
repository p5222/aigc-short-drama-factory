import type { VideoGenerationInput, VideoGenerationResult } from "./types.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateEmbeddedMjpegVideo } from "../export/embeddedVideo.js";
import { storageRoot } from "../storage/objectStorage.js";
import { signProviderMediaUrl } from "../storage/mediaAccess.js";
import { blockModelUntilNextDay, coolDownModel, getModelQuotaDecision, recordModelSubmission } from "./modelQuota.js";

interface AsyncTaskResponse {
  output?: {
    task_id?: string;
    task_status?: string;
    video_url?: string;
    video?: { url?: string };
    results?: Array<{ url?: string; video_url?: string }>;
    message?: string;
    code?: string;
  };
  data?: {
    id?: string;
    task_id?: string;
    status?: string;
    video_url?: string;
    url?: string;
    message?: string;
    code?: string;
  };
  error?: {
    code?: string;
    type?: string;
    message?: string;
  };
  id?: string;
  task_id?: string;
  status?: string;
  content?: {
    video_url?: string;
    url?: string;
    video?: { url?: string };
  };
  request_id?: string;
  code?: string;
  message?: string;
}

export async function generateVideo(input: VideoGenerationInput): Promise<VideoGenerationResult> {
  const provider = normalizeVideoProvider(input.provider || process.env.VIDEO_PROVIDER || "mock-video");
  try {
    if (provider === "dashscope-video") return await generateDashScopeVideo(input);
    if (provider === "doubao-seedance") return await generateDoubaoSeedanceVideo(input);
    if (provider === "embedded-video" || provider === "mock-video") return await generateEmbeddedVideo(input, provider);
  } catch (error) {
    const runtime = resolveVideoRuntime(input, provider);
    return {
      taskId: `video_failed_${Date.now()}`,
      status: "failed",
      videoUrl: undefined,
      provider: runtime.name,
      model: runtime.model,
      message: formatProviderError(error),
      failureCategory: classifyVideoFailure(error),
      retryable: true
    };
  }

  return {
    taskId: `mock_video_${Date.now()}`,
    status: "succeeded",
    videoUrl: undefined,
    provider: "Mock Video Adapter",
    model: "mock-video-v1",
    message: "本地视频草稿适配器未调用真实模型。"
  };
}

async function generateEmbeddedVideo(input: VideoGenerationInput, provider: string): Promise<VideoGenerationResult> {
  const videoUrl = await generateEmbeddedMjpegVideo({
    prompt: input.prompt,
    imageUrl: input.imageUrl,
    ratio: input.ratio,
    duration: input.duration,
    nameHint: `embedded-video-${Date.now()}`
  });
  return {
    taskId: `embedded_video_${Date.now()}`,
    status: "succeeded",
    videoUrl,
    provider: provider === "mock-video" ? "内嵌最小视频生成器" : "Embedded MJPEG Video",
    model: input.model || "embedded-mjpeg-v1",
    message: "已使用项目内置 MJPEG/AVI 编码器生成真实视频片段；适合无外部视频模型时验证闭环。"
  };
}

export async function queryVideoTaskResult(input: Pick<VideoGenerationInput, "provider" | "model" | "baseUrl" | "apiKey"> & { taskId: string }) {
  const provider = normalizeVideoProvider(input.provider || process.env.VIDEO_PROVIDER || "mock-video");
  const runtime = resolveVideoRuntime(input, provider);
  if (!runtime.apiKey && provider !== "mock-video") throw new Error(runtime.missingKeyMessage);
  if (provider === "dashscope-video") {
    const apiKey = runtime.apiKey;
    if (!apiKey) throw new Error(runtime.missingKeyMessage);
    const taskResult = await pollDashScopeVideoTask({
      baseUrl: runtime.baseUrl,
      apiKey,
      taskId: input.taskId,
      timeoutMs: Number(process.env.VIDEO_TASK_REFRESH_TIMEOUT_MS ?? 45_000),
      intervalMs: Number(process.env.VIDEO_TASK_REFRESH_INTERVAL_MS ?? 3_000)
    });
    return {
      taskId: input.taskId,
      status: taskResult.videoUrl ? "succeeded" as const : taskResult.status,
      videoUrl: taskResult.videoUrl,
      provider: runtime.name,
      model: runtime.model,
      message: taskResult.message,
      failureCategory: taskResult.failureCategory,
      retryable: taskResult.retryable
    };
  }
  if (provider === "doubao-seedance") {
    const apiKey = runtime.apiKey;
    if (!apiKey) throw new Error(runtime.missingKeyMessage);
    const taskResult = await pollDoubaoSeedanceTask(runtime.baseUrl, apiKey, input.taskId, {
      timeoutMs: Number(process.env.VIDEO_TASK_REFRESH_TIMEOUT_MS ?? 45_000),
      intervalMs: Number(process.env.VIDEO_TASK_REFRESH_INTERVAL_MS ?? 3_000)
    });
    return {
      taskId: input.taskId,
      status: taskResult.videoUrl ? "succeeded" as const : taskResult.status,
      videoUrl: taskResult.videoUrl,
      provider: runtime.name,
      model: runtime.model,
      message: taskResult.message,
      failureCategory: taskResult.failureCategory,
      retryable: taskResult.retryable
    };
  }
  return {
    taskId: input.taskId,
    status: "queued" as const,
    videoUrl: undefined,
    provider: runtime.name,
    model: runtime.model,
    message: "当前视频适配器没有异步任务查询能力。"
  };
}

export async function testVideoModelConnection(options: { provider?: string; model?: string; baseUrl?: string; apiKey?: string } = {}) {
  const started = Date.now();
  const provider = normalizeVideoProvider(options.provider || process.env.VIDEO_PROVIDER || "mock-video");
  const model = options.model || currentVideoModel(provider);
  const runtime = resolveVideoRuntime({ provider, model, baseUrl: options.baseUrl, apiKey: options.apiKey, prompt: "test" });
  const configOnly = process.env.VIDEO_MODEL_TEST_MODE !== "real";

  try {
    if (configOnly) {
      if (!runtime.apiKey && provider !== "mock-video") throw new Error(runtime.missingKeyMessage);
      return {
        ok: true,
        mode: "config" as const,
        provider: runtime.name,
        model: runtime.model,
        latencyMs: Date.now() - started,
        message: `视频模型配置已就绪：${runtime.baseUrl}。如需真实提交测试，将 VIDEO_MODEL_TEST_MODE 改为 real。`
      };
    }

    const result = await generateVideo({
      provider,
      model,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      prompt: "AI 漫剧测试镜头，雨夜街口，轻微推镜，人物保持稳定，电影感光影，无字幕无水印。",
      ratio: "9:16",
      duration: 3
    });

    return {
      ok: !["failed", "timeout", "canceled"].includes(result.status),
      mode: ["failed", "timeout", "canceled"].includes(result.status) ? "failed" as const : result.videoUrl ? "real" as const : "queued" as const,
      provider: result.provider || runtime.name,
      model: result.model || runtime.model,
      taskId: result.taskId,
      videoUrl: result.videoUrl,
      latencyMs: Date.now() - started,
      message: result.videoUrl
        ? `视频模型真实返回视频，耗时 ${Date.now() - started}ms。`
        : result.message || `视频任务已提交：${result.taskId}，上游暂未返回视频 URL。`
    };
  } catch (error) {
    return {
      ok: false,
      mode: "failed" as const,
      provider: runtime.name,
      model: runtime.model,
      latencyMs: Date.now() - started,
      message: `视频模型测试失败：${formatProviderError(error)}`
    };
  }
}

async function generateDashScopeVideo(input: VideoGenerationInput): Promise<VideoGenerationResult> {
  const runtime = resolveVideoRuntime(input, "dashscope-video");
  if (!runtime.apiKey) throw new Error(runtime.missingKeyMessage);
  if (!input.imageUrl) throw new Error("通义万相图生视频需要先生成分镜图 URL。");
  const imageUrl = await providerReadableImageUrl(input.imageUrl, "dashscope-video");

  const candidates = resolveModelCandidates(input, "dashscope-video", runtime.model);
  const skipped: string[] = [];
  let lastError: unknown;
  for (const model of candidates) {
    const decision = await getModelQuotaDecision("dashscope-video", model);
    if (!decision.available) {
      skipped.push(decision.reason ?? `${model}: 本地额度保护已跳过。`);
      continue;
    }
    try {
      const result = await submitDashScopeVideo(input, runtime, model, imageUrl);
      await recordModelSubmission("dashscope-video", model);
      return {
        ...result,
        model,
        message: withFallbackMessage(result.message, skipped, model)
      };
    } catch (error) {
      lastError = error;
      const fallback = await handleModelFallbackError("dashscope-video", model, error);
      if (fallback.shouldContinue) {
        skipped.push(fallback.message);
        continue;
      }
      throw error;
    }
  }

  return {
    taskId: `dashscope_video_failed_${Date.now()}`,
    status: "failed",
    provider: runtime.name,
    model: runtime.model,
    message: buildAllModelsFailedMessage("通义万相 / Wanx", skipped, lastError),
    failureCategory: classifyVideoFailure(lastError ?? skipped.join(";")),
    retryable: true
  };
}

async function submitDashScopeVideo(
  input: VideoGenerationInput,
  runtime: ReturnType<typeof resolveVideoRuntime>,
  model: string,
  imageUrl: string
): Promise<VideoGenerationResult> {
  const apiKey = runtime.apiKey;
  if (!apiKey) throw new Error(runtime.missingKeyMessage);
  const response = await fetch(dashScopeEndpoint(runtime.baseUrl, "services/aigc/video-generation/video-synthesis"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-DashScope-Async": "enable"
    },
    body: JSON.stringify(buildDashScopeVideoPayload(input, model, imageUrl))
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(`DashScope video request failed: ${response.status} ${providerErrorText(text)}`);
  const data = parseProviderJson(text, "DashScope video") as AsyncTaskResponse;
  const taskId = data.output?.task_id || data.task_id || data.request_id || `dashscope_video_${Date.now()}`;
  const directUrl = extractVideoUrl(data);
  if (data.output?.task_id || data.task_id) await input.onTaskSubmitted?.({ taskId, provider: "dashscope-video", model });
  if (directUrl) {
    return { taskId, status: "succeeded", videoUrl: directUrl, provider: runtime.name, model };
  }
  if (!data.output?.task_id && !data.task_id) throw new Error(`DashScope video response did not include task_id: ${compactJson(data)}`);

  const taskResult = await pollDashScopeVideoTask({
    baseUrl: runtime.baseUrl,
    apiKey,
    taskId,
    timeoutMs: Number(process.env.DASHSCOPE_VIDEO_SUBMIT_POLL_TIMEOUT_MS ?? process.env.VIDEO_SUBMIT_POLL_TIMEOUT_MS ?? 8_000),
    intervalMs: Number(process.env.DASHSCOPE_VIDEO_POLL_INTERVAL_MS ?? 5_000)
  });

  return {
    taskId,
    status: taskResult.videoUrl ? "succeeded" : taskResult.status,
    videoUrl: taskResult.videoUrl,
    provider: runtime.name,
    model,
    message: taskResult.message,
    failureCategory: taskResult.failureCategory,
    retryable: taskResult.retryable
  };
}

async function generateDoubaoSeedanceVideo(input: VideoGenerationInput): Promise<VideoGenerationResult> {
  const runtime = resolveVideoRuntime(input, "doubao-seedance");
  if (!runtime.apiKey) throw new Error(runtime.missingKeyMessage);
  const imageUrl = input.imageUrl ? await providerReadableImageUrl(input.imageUrl, "doubao-seedance") : undefined;
  const candidates = resolveModelCandidates(input, "doubao-seedance", runtime.model);
  const skipped: string[] = [];
  let lastError: unknown;

  for (const model of candidates) {
    const decision = await getModelQuotaDecision("doubao-seedance", model);
    if (!decision.available) {
      skipped.push(decision.reason ?? `${model}: 本地额度保护已跳过。`);
      continue;
    }
    try {
      const result = await submitDoubaoSeedanceVideo(input, runtime, model, imageUrl);
      await recordModelSubmission("doubao-seedance", model);
      return {
        ...result,
        model,
        message: withFallbackMessage(result.message, skipped, model)
      };
    } catch (error) {
      lastError = error;
      const fallback = await handleModelFallbackError("doubao-seedance", model, error);
      if (fallback.shouldContinue) {
        skipped.push(fallback.message);
        continue;
      }
      throw error;
    }
  }

  return {
    taskId: `doubao_video_failed_${Date.now()}`,
    status: "failed",
    provider: runtime.name,
    model: runtime.model,
    message: buildAllModelsFailedMessage("豆包 Seedance", skipped, lastError),
    failureCategory: classifyVideoFailure(lastError ?? skipped.join(";")),
    retryable: true
  };
}

async function submitDoubaoSeedanceVideo(
  input: VideoGenerationInput,
  runtime: ReturnType<typeof resolveVideoRuntime>,
  model: string,
  imageUrl?: string
): Promise<VideoGenerationResult> {
  const apiKey = runtime.apiKey;
  if (!apiKey) throw new Error(runtime.missingKeyMessage);
  const payload = {
    model,
    content: [
      { type: "text", text: buildDoubaoSeedancePrompt(input) },
      ...(imageUrl ? [{ type: "image_url", image_url: { url: imageUrl } }] : [])
    ]
  };

  const response = await fetch(endpointWithPath(runtime.baseUrl, "contents/generations/tasks"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Doubao Seedance video request failed: ${response.status} ${providerErrorText(text)}`);
  }

  const data = parseProviderJson(text, "Doubao Seedance video") as AsyncTaskResponse;
  const taskId = data.id || data.task_id || data.data?.id || data.data?.task_id || `doubao_video_${Date.now()}`;
  if (!data.id && !data.task_id && !data.data?.id && !data.data?.task_id) throw new Error("Doubao Seedance response did not include task_id");
  await input.onTaskSubmitted?.({ taskId, provider: "doubao-seedance", model });
  const directUrl = extractVideoUrl(data);
  const taskResult: VideoGenerationResult = directUrl
    ? { taskId, status: "succeeded" as const, videoUrl: directUrl }
    : await pollDoubaoSeedanceTask(runtime.baseUrl, apiKey, taskId, {
        timeoutMs: Number(process.env.DOUBAO_VIDEO_SUBMIT_POLL_TIMEOUT_MS ?? process.env.VIDEO_SUBMIT_POLL_TIMEOUT_MS ?? 8_000),
        intervalMs: Number(process.env.DOUBAO_VIDEO_POLL_INTERVAL_MS ?? 3_000)
      });
  return {
    taskId,
    status: taskResult.videoUrl ? "succeeded" : taskResult.status,
    videoUrl: taskResult.videoUrl,
    provider: runtime.name,
    model,
    message: taskResult.videoUrl ? undefined : taskResult.message || "豆包 Seedance 已提交异步任务；如果长时间没有 URL，请确认 Ark 账号已开通视频生成和任务查询接口。",
    failureCategory: taskResult.failureCategory,
    retryable: taskResult.retryable
  };
}

async function pollDoubaoSeedanceTask(baseUrl: string, apiKey: string, taskId: string, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<VideoGenerationResult> {
  const timeoutMs = Number(options.timeoutMs ?? process.env.DOUBAO_VIDEO_POLL_TIMEOUT_MS ?? 180_000);
  const intervalMs = Number(options.intervalMs ?? process.env.DOUBAO_VIDEO_POLL_INTERVAL_MS ?? 3_000);
  const started = Date.now();
  const url = endpointWithPath(baseUrl, `contents/generations/tasks/${taskId}`);
  while (Date.now() - started < timeoutMs) {
    await sleep(intervalMs);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new Error(`Doubao Seedance task query failed: ${response.status} ${providerErrorText(text)}`);
    const data = parseProviderJson(text, "Doubao Seedance task") as AsyncTaskResponse;
    const videoUrl = extractVideoUrl(data);
    if (videoUrl) return { taskId, status: "succeeded", videoUrl };
    const status = data.status || data.data?.status || data.output?.task_status;
    if (isProviderFailedStatus(status)) {
      return {
        taskId,
        status: "failed",
        provider: "豆包 Seedance 视频",
        model: "",
        message: `Doubao Seedance task ${status}: ${data.message || compactJson(data)}`,
        failureCategory: "provider_failed",
        retryable: true
      };
    }
    if (isProviderCanceledStatus(status)) {
      return {
        taskId,
        status: "canceled",
        provider: "豆包 Seedance 视频",
        model: "",
        message: `Doubao Seedance task ${status}: ${data.message || compactJson(data)}`,
        failureCategory: "canceled",
        retryable: true
      };
    }
  }
  return {
    taskId,
    status: "running",
    provider: "豆包 Seedance 视频",
    model: "",
    message: `豆包 Seedance 任务仍在生成中，已等待 ${Math.round(timeoutMs / 1000)}s，可稍后刷新继续查询。`,
    retryable: false
  };
}

async function pollDashScopeVideoTask({
  baseUrl,
  apiKey,
  taskId,
  timeoutMs,
  intervalMs
}: {
  baseUrl: string;
  apiKey: string;
  taskId: string;
  timeoutMs: number;
  intervalMs: number;
}): Promise<VideoGenerationResult> {
  const started = Date.now();
  const url = dashScopeEndpoint(baseUrl, `tasks/${taskId}`);
  while (Date.now() - started < timeoutMs) {
    await sleep(intervalMs);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new Error(`DashScope video task query failed: ${response.status} ${providerErrorText(text)}`);
    const data = parseProviderJson(text, "DashScope video task") as AsyncTaskResponse;
    const status = data.output?.task_status || data.status;
    const videoUrl = extractVideoUrl(data);
    if (videoUrl) return { taskId, status: "succeeded", videoUrl };
    if (isProviderFailedStatus(status)) {
      return {
        taskId,
        status: "failed",
        message: `DashScope video task ${status}: ${data.output?.message || data.message || compactJson(data)}`,
        failureCategory: "provider_failed",
        retryable: true
      };
    }
    if (isProviderCanceledStatus(status)) {
      return {
        taskId,
        status: "canceled",
        message: `DashScope video task ${status}: ${data.output?.message || data.message || compactJson(data)}`,
        failureCategory: "canceled",
        retryable: true
      };
    }
  }
  return {
    taskId,
    status: "running",
    message: `DashScope 视频任务仍在生成中，已等待 ${Math.round(timeoutMs / 1000)}s，可稍后刷新继续查询。`,
    retryable: false
  };
}

function resolveVideoRuntime(input: Partial<VideoGenerationInput>, forcedProvider?: string) {
  const provider = normalizeVideoProvider(forcedProvider || input.provider || process.env.VIDEO_PROVIDER || "mock-video");
  if (provider === "dashscope-video") {
    return {
      name: "通义万相 / DashScope 视频",
      apiKey: input.apiKey || process.env.DASHSCOPE_API_KEY,
      baseUrl: input.baseUrl || process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v1",
      model: input.model || process.env.DASHSCOPE_VIDEO_MODEL || "wan2.7-i2v-2026-04-25",
      missingKeyMessage: "缺少通义万相视频 Key，请配置 DASHSCOPE_API_KEY。"
    };
  }
  if (provider === "doubao-seedance") {
    return {
      name: "豆包 Seedance 视频",
      apiKey: input.apiKey || process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY,
      baseUrl: input.baseUrl || process.env.DOUBAO_BASE_URL || process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
      model: input.model || process.env.DOUBAO_SEEDANCE_MODEL || "doubao-seedance-1-5-pro-251215",
      missingKeyMessage: "缺少豆包/火山方舟视频模型 Key，请配置 DOUBAO_API_KEY、ARK_API_KEY 或 VOLCENGINE_API_KEY。"
    };
  }
  return {
    name: provider === "embedded-video" ? "内嵌最小视频生成器" : "视频生成可插拔接口",
    apiKey: "",
    baseUrl: "",
    model: provider === "embedded-video" ? "embedded-mjpeg-v1" : "mock-video-v1",
    missingKeyMessage: ""
  };
}

function normalizeVideoProvider(provider: string) {
  if (["dashscope", "dashscope-video", "wanxiang", "wanx", "qwen-video"].includes(provider)) return "dashscope-video";
  if (["doubao", "doubao-seedance", "seedance", "volcengine", "ark"].includes(provider)) return "doubao-seedance";
  if (["embedded", "embedded-video", "local-video", "local-mjpeg"].includes(provider)) return "embedded-video";
  return "mock-video";
}

function currentVideoModel(provider: string) {
  if (provider === "dashscope-video") return process.env.DASHSCOPE_VIDEO_MODEL || "wan2.7-i2v-2026-04-25";
  if (provider === "doubao-seedance") return process.env.DOUBAO_SEEDANCE_MODEL || "doubao-seedance-1-5-pro-251215";
  if (provider === "embedded-video") return "embedded-mjpeg-v1";
  return "mock-video-v1";
}

function resolveModelCandidates(input: VideoGenerationInput, provider: string, preferredModel: string) {
  if (input.modelPool !== undefined) return uniqueStrings([preferredModel, ...input.modelPool]);
  const envPool =
    provider === "doubao-seedance"
      ? process.env.DOUBAO_SEEDANCE_MODEL_POOL
      : provider === "dashscope-video"
        ? process.env.DASHSCOPE_VIDEO_MODEL_POOL
        : process.env.VIDEO_MODEL_POOL;
  return uniqueStrings([
    preferredModel,
    ...(input.modelPool ?? []),
    ...splitModelList(envPool),
    ...splitModelList(process.env.VIDEO_MODEL_POOL)
  ]).filter(Boolean);
}

function splitModelList(value?: string) {
  return value?.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean) ?? [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function handleModelFallbackError(provider: string, model: string, error: unknown) {
  const message = formatProviderError(error);
  if (isDailyQuotaError(message)) {
    await blockModelUntilNextDay(provider, model, message);
    return { shouldContinue: true, message: `${model}: 免费额度/日额度已耗尽，已冷却到明天并切换下一个模型。${message}` };
  }
  if (isRateLimitError(message)) {
    await coolDownModel(provider, model, message);
    return { shouldContinue: true, message: `${model}: 触发 RPM/TPM/并发限流，已短时冷却并切换下一个模型。${message}` };
  }
  if (isModelUnavailableError(message)) {
    await coolDownModel(provider, model, message, Number(process.env.VIDEO_MODEL_UNAVAILABLE_COOLDOWN_MS ?? 300_000));
    return { shouldContinue: true, message: `${model}: 模型未授权/接入点不可用，已跳过。${message}` };
  }
  if (isTransientProviderError(message)) {
    await coolDownModel(provider, model, message);
    return { shouldContinue: true, message: `${model}: 上游临时失败，已切换下一个模型。${message}` };
  }
  return { shouldContinue: false, message };
}

function withFallbackMessage(message: string | undefined, skipped: string[], selectedModel: string) {
  const fallbackNote = skipped.length ? `模型轮换：已跳过 ${skipped.length} 个候选，当前使用 ${selectedModel}。${skipped.slice(0, 3).join("；")}` : "";
  return [message, fallbackNote].filter(Boolean).join(" ");
}

function buildAllModelsFailedMessage(providerName: string, skipped: string[], lastError: unknown) {
  const detail = skipped.length ? skipped.join("；") : formatProviderError(lastError);
  return `${providerName} 模型池没有可用候选。请在后台模型路由填入已授权的 ep- 接入点，或等待免费额度次日刷新。详情：${detail}`;
}

function buildDoubaoSeedancePrompt(input: VideoGenerationInput) {
  const flags = [
    `--resolution ${process.env.DOUBAO_SEEDANCE_RESOLUTION || process.env.VIDEO_RESOLUTION || "1080p"}`,
    `--duration ${Math.max(1, Math.min(15, input.duration ?? Number(process.env.DOUBAO_SEEDANCE_DURATION ?? 5)))}`,
    `--camerafixed ${process.env.DOUBAO_SEEDANCE_CAMERA_FIXED || "false"}`,
    `--watermark ${process.env.DOUBAO_SEEDANCE_WATERMARK || "false"}`
  ];
  const text = input.prompt.trim();
  const missingFlags = flags.filter((flag) => {
    const key = flag.split(" ")[0];
    return !new RegExp(`${escapeRegExp(key)}\\b`, "i").test(text);
  });
  return [text, ...missingFlags].join(" ");
}

function buildDashScopeVideoPayload(input: VideoGenerationInput, model: string, imageUrl: string) {
  const duration = Math.max(3, Math.min(5, input.duration ?? 5));
  const parameters = {
    resolution: dashScopeVideoResolution(input.ratio ?? "9:16"),
    duration,
    prompt_extend: true,
    watermark: false,
    audio: false
  };
  if (supportsDashScopeVideoMediaPayload(model)) {
    return {
      model,
      input: {
        prompt: input.prompt,
        media: [{ type: "first_frame", url: imageUrl }]
      },
      parameters
    };
  }
  return {
    model,
    input: {
      prompt: input.prompt,
      img_url: imageUrl
    },
    parameters
  };
}

function providerErrorText(text: string) {
  if (!text) return "";
  try {
    const data = JSON.parse(text) as AsyncTaskResponse;
    return [
      data.error?.code,
      data.error?.type,
      data.error?.message,
      data.code,
      data.message,
      data.output?.code,
      data.output?.message,
      data.data?.code,
      data.data?.message
    ].filter(Boolean).join(" ") || text.slice(0, 420);
  } catch {
    return text.slice(0, 420);
  }
}

function parseProviderJson(text: string, providerName: string) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${providerName} response is not valid JSON: ${text.slice(0, 260)}`);
  }
}

function dashScopeEndpoint(baseUrl: string, path: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/api/v1")) return `${normalized}/${path}`;
  if (normalized.endsWith("/compatible-mode/v1") || normalized.endsWith("/v1")) {
    return `${normalized.replace(/\/compatible-mode\/v1$|\/v1$/, "/api/v1")}/${path}`;
  }
  return `${normalized}/api/v1/${path}`;
}

function endpointWithPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}/${path}`;
}

function videoSizeFromRatio(ratio: "9:16" | "16:9" | "1:1") {
  if (ratio === "16:9") return "1280*720";
  if (ratio === "1:1") return "960*960";
  return "720*1280";
}

function dashScopeVideoResolution(ratio: "9:16" | "16:9" | "1:1") {
  if (ratio === "16:9") return process.env.DASHSCOPE_VIDEO_RESOLUTION_LANDSCAPE || "720P";
  if (ratio === "1:1") return process.env.DASHSCOPE_VIDEO_RESOLUTION_SQUARE || "720P";
  return process.env.DASHSCOPE_VIDEO_RESOLUTION_PORTRAIT || "720P";
}

function supportsDashScopeVideoMediaPayload(model: string) {
  return (
    model.startsWith("wan2.7-") ||
    model.startsWith("happyhorse-1.1-") ||
    model === "happyhorse-1.0-video-edit"
  );
}

function absoluteAssetUrl(url: string) {
  if (!url.startsWith("/")) return url;
  const publicBaseUrl = process.env.PUBLIC_API_BASE_URL || `http://localhost:${process.env.API_PORT || 4000}`;
  return `${publicBaseUrl.replace(/\/$/, "")}${url}`;
}

async function providerReadableImageUrl(url: string, provider: string) {
  if (!url.startsWith("/storage/")) return url;
  if (provider === "doubao-seedance" && process.env.DOUBAO_VIDEO_LOCAL_IMAGE_AS_DATA_URL !== "false") {
    return storedAssetDataUrl(url);
  }
  if (provider === "dashscope-video" && process.env.DASHSCOPE_VIDEO_LOCAL_IMAGE_AS_DATA_URL !== "false") {
    return storedAssetDataUrl(url);
  }
  if (!process.env.PUBLIC_API_BASE_URL) {
    throw new Error("视频模型需要可公网访问的首帧图片；当前是本地 /storage 文件。请配置 PUBLIC_API_BASE_URL 或先部署到服务器。");
  }
  return signProviderMediaUrl(url);
}

async function storedAssetDataUrl(url: string) {
  const relativePath = url.replace(/^\/storage\//, "").replace(/\.\./g, "");
  const buffer = await readFile(resolve(storageRoot, relativePath));
  return `data:${mimeTypeFromPath(relativePath)};base64,${buffer.toString("base64")}`;
}

function mimeTypeFromPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function extractVideoUrl(data: AsyncTaskResponse) {
  return (
    data.output?.video_url ||
    data.output?.video?.url ||
    data.output?.results?.find((item) => item.video_url || item.url)?.video_url ||
    data.output?.results?.find((item) => item.video_url || item.url)?.url ||
    data.data?.video_url ||
    data.data?.url ||
    data.content?.video_url ||
    data.content?.url ||
    data.content?.video?.url
  );
}

function isProviderFailedStatus(status?: string) {
  return ["failed", "FAILED", "FAIL", "error", "ERROR"].includes(String(status));
}

function isProviderCanceledStatus(status?: string) {
  return ["canceled", "CANCELED", "cancelled", "CANCELLED"].includes(String(status));
}

function isDailyQuotaError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("quotaexceeded") ||
    lower.includes("insufficient_quota") ||
    lower.includes("quota exceeded") ||
    lower.includes("free trial quota") ||
    lower.includes("daily quota") ||
    lower.includes("resource package") ||
    message.includes("免费额度") ||
    message.includes("日额度") ||
    message.includes("额度已用完") ||
    message.includes("资源包")
  );
}

function isRateLimitError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("ratelimit") ||
    lower.includes("too many requests") ||
    lower.includes("rpm") ||
    lower.includes("tpm") ||
    lower.includes("qps") ||
    lower.includes("concurrency") ||
    message.includes("限流") ||
    message.includes("频率") ||
    message.includes("并发")
  );
}

function isModelUnavailableError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("model not found") ||
    lower.includes("endpoint not found") ||
    lower.includes("deployment not found") ||
    lower.includes("not authorized") ||
    lower.includes("permission") ||
    lower.includes("no permission") ||
    lower.includes("access denied") ||
    lower.includes("invalid model") ||
    message.includes("模型不存在") ||
    message.includes("模型未授权") ||
    message.includes("无权限") ||
    message.includes("未开通") ||
    message.includes("接入点")
  );
}

function isTransientProviderError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("econn") ||
    lower.includes("503") ||
    lower.includes("502") ||
    lower.includes("500")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactJson(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 420);
  } catch {
    return String(value).slice(0, 420);
  }
}

function formatProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return readableVideoError(message);
}

function classifyVideoFailure(error: unknown): NonNullable<VideoGenerationResult["failureCategory"]> {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes("key") || message.includes("unauthorized") || message.includes("401") || message.includes("403")) return "auth";
  if (message.includes("public_api_base_url") || message.includes("公网") || message.includes("storage")) return "input_unreachable";
  if (message.includes("timeout") || message.includes("timed out") || message.includes("超时")) return "provider_timeout";
  if (message.includes("fetch failed") || message.includes("network") || message.includes("econn")) return "network";
  if (message.includes("failed") || message.includes("失败")) return "provider_failed";
  if (message.includes("缺少") || message.includes("配置")) return "config";
  return "unknown";
}

function readableVideoError(message: string) {
  const lower = message.toLowerCase();
  if (isDailyQuotaError(message)) {
    return `${message}。该模型免费额度/日额度已触发保护，系统会自动切换模型池里的下一个已授权模型继续提交。`;
  }
  if (isRateLimitError(message)) {
    return `${message}。该模型触发 RPM/TPM/并发限流，系统会短时冷却并自动切换下一个候选模型。`;
  }
  if (isModelUnavailableError(message)) {
    return `${message}。请确认后台模型 ID 填的是已授权接入点，例如 ep- 开头的接入点 ID；系统会跳过该候选继续尝试。`;
  }
  if (lower.includes("fetch failed") || lower.includes("network") || lower.includes("econn")) {
    return `视频模型网络请求失败：${message}。请检查服务端是否能访问上游 Base URL、API Key 是否在服务端配置、以及是否被代理/防火墙拦截。`;
  }
  if (lower.includes("public_api_base_url") || message.includes("公网") || lower.includes("/storage")) {
    return `${message}。生产部署需要配置 PUBLIC_API_BASE_URL，让上游视频模型能下载首帧；本地验证可切换内嵌最小视频生成器跑通闭环。`;
  }
  if (lower.includes("timeout") || lower.includes("timed out") || message.includes("超时")) {
    return `${message}。视频模型通常是异步任务，可稍后刷新继续轮询，或切换视频模型继续生成未完成镜头。`;
  }
  return message;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
