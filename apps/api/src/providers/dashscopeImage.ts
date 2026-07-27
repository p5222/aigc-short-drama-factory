import type { ImageGenerationInput, ImageGenerationResult } from "./types.js";
import { normalizeImageOutputQuality, normalizeImageOutputSize } from "@aifilm/shared";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { storageRoot } from "../storage/objectStorage.js";
import { blockModelUntilNextDay, coolDownModel, getModelQuotaDecision, recordModelSubmission } from "./modelQuota.js";

interface DashScopeResponse {
  output?: {
    choices?: Array<{ message?: { content?: Array<{ image?: string; url?: string; text?: string }> } }>;
    results?: Array<{ url?: string }>;
    task_id?: string;
    task_status?: string;
  };
  usage?: unknown;
  request_id?: string;
  code?: string;
  message?: string;
}

interface DashScopeTaskResponse {
  output?: {
    task_id?: string;
    task_status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | string;
    submit_time?: string;
    scheduled_time?: string;
    end_time?: string;
    results?: Array<{ url?: string; orig_prompt?: string; actual_prompt?: string }>;
    code?: string;
    message?: string;
  };
  request_id?: string;
  code?: string;
  message?: string;
}

interface OpenAIImageResponse {
  id?: string;
  data?: Array<{ url?: string; b64_json?: string }>; 
}

interface GeminiImageResponse {
  id?: string;
  output_text?: string;
  output_image?: {
    data?: string;
    mime_type?: string;
  };
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      image?: string;
      data?: string;
      mime_type?: string;
    }>;
  }>;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
        inline_data?: {
          mime_type?: string;
          data?: string;
        };
      }>;
    };
  }>;
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; data?: string; mime_type?: string }>;
    summary?: Array<{ type?: string; text?: string; data?: string; mime_type?: string }>;
  }>;
}

export async function generateDashScopeImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("Missing DASHSCOPE_API_KEY");

  const baseUrl = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v1";
  const preferredModel = normalizeDashScopeImageModel(input.model || process.env.DASHSCOPE_IMAGE_MODEL || "qwen-image");
  const candidates = resolveDashScopeImageCandidates(input, preferredModel);
  const skipped: string[] = [];
  let lastError: unknown;

  for (const model of candidates) {
    const decision = await getModelQuotaDecision("dashscope-image", model);
    if (!decision.available) {
      skipped.push(decision.reason ?? `${model}: local quota guard skipped this candidate.`);
      continue;
    }
    try {
      const result = await submitDashScopeImage(input, { apiKey, baseUrl }, model);
      await recordModelSubmission("dashscope-image", model);
      return {
        ...result,
        model
      };
    } catch (error) {
      lastError = error;
      const fallback = await handleDashScopeImageFallbackError(model, error);
      if (fallback.shouldContinue) {
        skipped.push(fallback.message);
        continue;
      }
      throw error;
    }
  }

  throw new Error(buildDashScopeImageAllFailedMessage(skipped, lastError));
}

export async function generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
  const provider = normalizeImageProvider(input.provider || process.env.IMAGE_PROVIDER || "mock");

  if (provider === "dashscope") return generateDashScopeImage(input);
  if (provider === "google-gemini-image") return generateGeminiImage(input);
  if (provider === "zml-image" || provider === "manjiao-image" || provider === "ripp-image") return generateOpenAICompatibleImage(input, provider);
  if (provider === "doubao-seedream") return generateOpenAICompatibleImage(input, "doubao-seedream");
  if (provider === "openai-compatible") return generateOpenAICompatibleImage(input, provider);

  return {
    taskId: `mock_image_${Date.now()}`,
    status: "succeeded",
    imageUrl: undefined,
    provider: "Mock Image Adapter",
    model: "mock-image-v1"
  };
}

async function submitDashScopeImage(
  input: ImageGenerationInput,
  runtime: { apiKey: string; baseUrl: string },
  model: string
): Promise<ImageGenerationResult & { message?: string }> {
  const useAsyncImageSynthesis = shouldUseDashScopeAsyncSynthesis(model);
  const url = useAsyncImageSynthesis
    ? dashScopeEndpoint(runtime.baseUrl, "services/aigc/text2image/image-synthesis")
    : dashScopeEndpoint(runtime.baseUrl, "services/aigc/multimodal-generation/generation");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.apiKey}`,
      ...(useAsyncImageSynthesis ? { "X-DashScope-Async": "enable" } : {})
    },
    body: JSON.stringify(buildDashScopeImagePayload(input, model, useAsyncImageSynthesis))
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`DashScope image request failed: ${response.status} ${text.slice(0, 220)}`);
  }

  const data = (await response.json()) as DashScopeResponse;
  const directUrl = extractDashScopeImageUrl(data);
  const taskId = data.output?.task_id || data.request_id || `dashscope_image_${Date.now()}`;
  if (directUrl) {
    return {
      taskId,
      status: "succeeded",
      imageUrl: directUrl,
      provider: "DashScope / Qwen Image",
      model
    };
  }
  if (!data.output?.task_id) {
    throw new Error(`DashScope image response did not include image URL or task_id: ${compactJson(data)}`);
  }
  const taskResult = await pollDashScopeImageTask({
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey,
    taskId: data.output.task_id,
    timeoutMs: Number(process.env.DASHSCOPE_IMAGE_POLL_TIMEOUT_MS ?? 180_000),
    intervalMs: Number(process.env.DASHSCOPE_IMAGE_POLL_INTERVAL_MS ?? 2_500)
  });
  return {
    taskId: data.output.task_id,
    status: "succeeded",
    imageUrl: taskResult,
    provider: "DashScope / Qwen Image",
    model
  };
}

function buildDashScopeImagePayload(input: ImageGenerationInput, model: string, useAsyncImageSynthesis: boolean) {
  const commonParameters = {
    size: sizeFromRatio(input.ratio ?? "9:16"),
    n: 1,
    seed: input.seed,
    negative_prompt: input.negativePrompt,
    prompt_extend: true,
    watermark: false
  };
  if (useAsyncImageSynthesis) {
    return {
      model,
      input: { prompt: input.prompt },
      parameters: commonParameters
    };
  }
  return {
    model,
    input: {
      messages: [{ role: "user", content: [{ text: input.prompt }] }]
    },
    parameters: commonParameters
  };
}

async function generateGeminiImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
  const runtime = resolveImageRuntime(input, "google-gemini-image");
  if (!runtime.apiKey) throw new Error("Missing GEMINI_API_KEY for Google AI Studio image provider");
  if (!runtime.baseUrl) throw new Error("Missing base URL for Google AI Studio image provider");

  const prompt = [input.prompt, input.negativePrompt ? `Negative prompt: ${input.negativePrompt}` : ""].filter(Boolean).join("\n\n");
  const response = await fetch(geminiEndpoint(runtime.baseUrl, "interactions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": runtime.apiKey
    },
    body: JSON.stringify({
      model: runtime.model,
      input: prompt,
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: input.ratio ?? "9:16",
        image_size: process.env.GEMINI_IMAGE_SIZE || "1K"
      },
      generation_config: {
        thinking_level: process.env.GEMINI_IMAGE_THINKING_LEVEL || "low"
      }
    })
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Google AI Studio image request failed: ${response.status} ${text.slice(0, 180)}`);
  }

  const data = JSON.parse(text) as GeminiImageResponse;
  const inlineImage = data.output_image ?? findGeminiStepsImage(data) ?? findGeminiGenerateContentImage(data) ?? findGeminiInlineImage(data);
  const imageUrl = inlineImage?.data
    ? `data:${inlineImage.mime_type || "image/png"};base64,${inlineImage.data}`
    : undefined;

  return {
    taskId: data.id || `google_gemini_image_${Date.now()}`,
    status: imageUrl ? "succeeded" : "queued",
    imageUrl,
    provider: runtime.name,
    model: runtime.model
  };
}

async function generateOpenAICompatibleImage(input: ImageGenerationInput, provider: string): Promise<ImageGenerationResult> {
  const runtime = resolveImageRuntime(input, provider);
  if (!runtime.apiKey) throw new Error("Missing API key for image provider " + provider);
  if (!runtime.baseUrl) throw new Error("Missing base URL for image provider " + provider);
  const apiKey = runtime.apiKey;
  const baseUrl = runtime.baseUrl;
  const model = runtime.model;
  const providerName = runtime.name;

  try {
    return await withImageProviderQueue(`${provider}:${baseUrl}:${model}`, providerName, async () => {
    const referenceImages = input.referenceImageUrls?.filter(Boolean) ?? [];
    const shouldTryImageEdit = referenceImages.length > 0 && provider !== "zml-image" && process.env.IMAGE_EDIT_WITH_REFERENCES !== "false";
    if (shouldTryImageEdit) {
      const editData = await postImageEditWithFallback({
        urls: endpointCandidates(baseUrl, "images/edits"),
        apiKey,
        model,
        prompt: input.prompt,
        size: openAIImageSizeFromRatio(input.ratio ?? "9:16"),
        referenceImageUrls: referenceImages
      }).catch((error) => {
        if (String(error.message || error).includes("Image edit endpoint unavailable")) return undefined;
        throw error;
      });
      const editFirst = editData?.data?.[0];
      const editImageUrl = editFirst?.url || (editFirst?.b64_json ? `data:image/png;base64,${editFirst.b64_json}` : undefined);
      if (editImageUrl || editData) {
        return {
          taskId: editData?.id || `${provider}_image_edit_${Date.now()}`,
          status: editImageUrl ? "succeeded" : "queued",
          imageUrl: editImageUrl,
          provider: providerName,
          model
        };
      }
    }

    const data = await postImageJsonWithFallback({
      urls: endpointCandidates(baseUrl, "images/generations"),
      apiKey,
      payload: cleanPayload({
        model,
        prompt: input.prompt,
        n: 1,
        size: imageSizeFromInput(provider, input),
        response_format: supportsImageResponseFormat(model) ? "b64_json" : undefined,
        quality: imageQuality(model, input.quality),
        background: supportsImageBackground(model) ? "auto" : undefined
      })
    });

    const first = data.data?.[0];
    const imageUrl = first?.url || (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : undefined);

      return {
        taskId: data.id || `${provider}_image_${Date.now()}`,
        status: imageUrl ? "succeeded" : "queued",
        imageUrl,
        provider: providerName,
        model
      };
    });
  } catch (error) {
    throw new Error(formatImageFailure(error, providerName, baseUrl));
  }
}

export async function testImageModelConnection(options: Pick<ImageGenerationInput, "provider" | "model" | "baseUrl" | "apiKey"> = {}) {
  const started = Date.now();
  const provider = normalizeImageProvider(options.provider || process.env.IMAGE_PROVIDER || "mock");
  const runtime = resolveImageRuntime(
    {
      provider,
      model: options.model,
      baseUrl: options.baseUrl,
      prompt: ""
    },
    provider
  );
  const prompt = [
    "竖屏 9:16 AI 漫剧分镜图，镜头 1-1，中景",
    "雨夜街口，湿润路面反光，年轻女主站在左前方，深色外套男主撑黑伞从右后方走近",
    "两人保持三步距离，克制重逢情绪，国漫写实电影光感，画面干净",
    "no text, no subtitle, no watermark"
  ].join(", ");
  try {
    const result = await generateImage({
      provider: options.provider,
      model: options.model,
      baseUrl: options.baseUrl,
      prompt,
      negativePrompt: "text, subtitle, watermark, logo, malformed hands, extra fingers, face drift, duplicate person, low quality",
      ratio: "9:16",
      seed: 12001
    });
    const latencyMs = Date.now() - started;

    return {
      ok: true,
      mode: result.imageUrl ? "real" as const : result.provider?.includes("Mock") ? "local" as const : "queued" as const,
      provider: result.provider || runtime.name,
      model: result.model || runtime.model,
      hasImageUrl: Boolean(result.imageUrl),
      imageUrl: result.imageUrl,
      prompt,
      latencyMs,
      message: result.imageUrl
        ? `生图模型真实返回图片，耗时 ${latencyMs}ms。后台预览已使用分镜镜头要求测试。`
        : `生图任务已提交但暂未返回图片 URL，耗时 ${latencyMs}ms；请检查该上游是否需要异步轮询。`
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    return {
      ok: false,
      mode: "failed" as const,
      provider: runtime.name,
      model: runtime.model,
      hasImageUrl: false,
      prompt,
      latencyMs,
      message: `生图模型测试失败，耗时 ${latencyMs}ms：${formatProviderError(error)}`
    };
  }
}

function resolveImageRuntime(input: ImageGenerationInput, provider: string) {
  if (provider === "google-gemini-image") {
    return {
      name: "Google AI Studio / Gemini Image",
      apiKey: input.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      baseUrl: input.baseUrl || process.env.GEMINI_BASE_URL || process.env.GOOGLE_AI_STUDIO_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
      model: normalizeGeminiImageModel(input.model || process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview")
    };
  }

  if (provider === "zml-image") {
    return {
      name: "ZML Image Relay",
      apiKey: input.apiKey || process.env.ZML_API_KEY,
      baseUrl: input.baseUrl || process.env.ZML_BASE_URL || "https://api.zmlmfling.com",
      model: normalizeRelayImageModel(input.model || process.env.ZML_IMAGE_MODEL || "gpt-image-2")
    };
  }

  if (provider === "manjiao-image") {
    return {
      name: "Manjiao Image Relay",
      apiKey: input.apiKey || process.env.MANJIAO_IMAGE_API_KEY,
      baseUrl: input.baseUrl || process.env.MANJIAO_BASE_URL || "https://api.zmlmfling.com",
      model: normalizeRelayImageModel(input.model || process.env.MANJIAO_IMAGE_MODEL || "gpt-image-2")
    };
  }

  if (provider === "ripp-image") {
    return {
      name: "Ripp / GPT Image 2",
      apiKey: input.apiKey || process.env.RIPP_IMAGE_API_KEY,
      baseUrl: input.baseUrl || process.env.RIPP_IMAGE_BASE_URL || "https://ripp.best",
      model: normalizeRelayImageModel(input.model || process.env.RIPP_IMAGE_MODEL || "gpt-image-2")
    };
  }

  if (provider === "doubao-seedream") {
    return {
      name: "Doubao Seedream Image",
      apiKey: input.apiKey || process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY,
      baseUrl: input.baseUrl || process.env.DOUBAO_BASE_URL || process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
      model: normalizeDoubaoImageModel(input.model || process.env.DOUBAO_SEEDREAM_MODEL || "doubao-seedream-5-0-lite-260128")
    };
  }

  return {
    name: "OpenAI-compatible Image Relay",
    apiKey: input.apiKey || process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY,
    baseUrl: input.baseUrl || process.env.OPENAI_IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || process.env.OPENAI_COMPATIBLE_BASE_URL,
    model: normalizeRelayImageModel(input.model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2")
  };
}

function normalizeImageProvider(provider: string) {
  if (["dashscope", "dashscope-image", "wanxiang", "qwen-image"].includes(provider)) return "dashscope";
  if (["google", "google-ai-studio", "google-gemini-image", "gemini-image", "gemini-3-pro-image", "gemini-3.1-flash-image"].includes(provider)) return "google-gemini-image";
  if (["zml", "zml-image", "zml-gpt-image", "zml-relay", "gpt-image-2"].includes(provider)) return "zml-image";
  if (["ripp", "ripp-image"].includes(provider)) return "ripp-image";
  if (["manjiao", "manjiao-image", "manjiao-relay"].includes(provider)) return "manjiao-image";
  if (["doubao", "doubao-seedream", "seedream", "Doubao-Seedream-5.0-lite", "doubao-seedream-5-0-lite-260128"].includes(provider)) return "doubao-seedream";
  if (["openai-compatible", "openai-compatible-image", "relay", "relay-image", "image2", "gpt-image2", "openai-image"].includes(provider)) return "openai-compatible";
  return "mock";
}

function normalizeGeminiImageModel(model: string) {
  const aliases: Record<string, string> = {
    "gemini 3 pro image": "gemini-3-pro-image-preview",
    "gemini-3-pro-image": "gemini-3-pro-image-preview",
    "gemini 3.1 flash image": "gemini-3.1-flash-image-preview",
    "gemini-3.1-flash-image": "gemini-3.1-flash-image-preview",
    "gemini-3.1pro": "gemini-3.1-pro-preview",
    "gemini-3.1-pro": "gemini-3.1-pro-preview",
    "gemini-3.1-pro-image": "gemini-3.1-pro-preview",
    "nano-banana-2": "gemini-3.1-flash-image-preview",
    "nano banana 2": "gemini-3.1-flash-image-preview",
    "nano-banana-pro": "gemini-3-pro-image-preview",
    "nano banana pro": "gemini-3-pro-image-preview"
  };
  return aliases[model.trim().toLowerCase()] ?? model;
}

function normalizeDashScopeImageModel(model: string) {
  if (["image2", "gpt-image2", "gpt-image-2", "Doubao-Seedream-5.0-lite"].includes(model)) return process.env.DASHSCOPE_IMAGE_MODEL || "qwen-image";
  return model;
}

function resolveDashScopeImageCandidates(input: ImageGenerationInput, preferredModel: string) {
  return uniqueStrings([
    preferredModel,
    ...(input.modelPool ?? []),
    ...splitModelList(process.env.DASHSCOPE_IMAGE_MODEL_POOL)
  ]).map(normalizeDashScopeImageModel);
}

function shouldUseDashScopeAsyncSynthesis(model: string) {
  return ["qwen-image", "qwen-image-plus"].includes(model);
}

async function handleDashScopeImageFallbackError(model: string, error: unknown) {
  const message = formatProviderError(error);
  if (isDashScopeImageQuotaError(message)) {
    await blockModelUntilNextDay("dashscope-image", model, message);
    return { shouldContinue: true, message: `${model}: free quota exhausted, blocked until next day and switching. ${message}` };
  }
  if (isDashScopeImageRateLimitError(message)) {
    await coolDownModel("dashscope-image", model, message, Number(process.env.IMAGE_MODEL_RATE_LIMIT_COOLDOWN_MS ?? process.env.VIDEO_MODEL_RATE_LIMIT_COOLDOWN_MS ?? 120_000));
    return { shouldContinue: true, message: `${model}: hit rate/concurrency limits, cooling down and switching. ${message}` };
  }
  if (isDashScopeImageModelUnavailableError(message)) {
    await coolDownModel("dashscope-image", model, message, Number(process.env.IMAGE_MODEL_UNAVAILABLE_COOLDOWN_MS ?? 300_000));
    return { shouldContinue: true, message: `${model}: model unavailable or not authorized, skipping. ${message}` };
  }
  if (isDashScopeImageTransientError(message)) {
    await coolDownModel("dashscope-image", model, message);
    return { shouldContinue: true, message: `${model}: transient upstream failure, switching to the next candidate. ${message}` };
  }
  return { shouldContinue: false, message };
}

function withDashScopeImageFallbackMessage(message: string | undefined, skipped: string[], selectedModel: string) {
  const fallbackNote = skipped.length ? `Model fallback: skipped ${skipped.length} candidates, currently using ${selectedModel}. ${skipped.slice(0, 3).join(" | ")}` : "";
  return [message, fallbackNote].filter(Boolean).join(" ");
}

function buildDashScopeImageAllFailedMessage(skipped: string[], lastError: unknown) {
  const detail = skipped.length ? skipped.join(" | ") : formatProviderError(lastError);
  return `DashScope image model pool has no available candidate. Details: ${detail}`;
}

function splitModelList(value?: string) {
  return value?.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean) ?? [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isDashScopeImageQuotaError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("allocationquota.freetieronly") ||
    lower.includes("freetieronly") ||
    lower.includes("free tier only") ||
    lower.includes("free trial quota") ||
    lower.includes("quota exceeded") ||
    lower.includes("insufficient_quota") ||
    lower.includes("daily quota") ||
    lower.includes("resource package")
  );
}

function isDashScopeImageRateLimitError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("ratelimit") ||
    lower.includes("too many requests") ||
    lower.includes("rpm") ||
    lower.includes("tpm") ||
    lower.includes("qps") ||
    lower.includes("concurrency")
  );
}

function isDashScopeImageModelUnavailableError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("model not found") ||
    lower.includes("endpoint not found") ||
    lower.includes("deployment not found") ||
    lower.includes("not authorized") ||
    lower.includes("no permission") ||
    lower.includes("access denied") ||
    lower.includes("invalid model")
  );
}

function isDashScopeImageTransientError(message: string) {
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

function normalizeDoubaoImageModel(model: string) {
  const normalized = model.trim();
  if (
    normalized === "Doubao-Seedream-5.0-lite" ||
    normalized === "doubao-seedream-lite" ||
    normalized === "doubao-seedream-5-0-lite" ||
    normalized.startsWith("ark-")
  ) {
    return process.env.DOUBAO_SEEDREAM_MODEL || "doubao-seedream-5-0-lite-260128";
  }
  return normalized;
}

function normalizeRelayImageModel(model: string) {
  if (["image2", "gpt-image2"].includes(model)) return "gpt-image-2";
  return model;
}

function cleanPayload<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function supportsImageResponseFormat(model: string) {
  return !model.startsWith("gpt-image-");
}

function supportsImageBackground(model: string) {
  return model.startsWith("gpt-image-1");
}

function imageQuality(model: string, selectedQuality?: string) {
  if (model.startsWith("gpt-image-")) return normalizeImageOutputQuality(selectedQuality || process.env.OPENAI_IMAGE_QUALITY || process.env.ZML_IMAGE_QUALITY || "medium");
  return undefined;
}

function currentFallbackImageModel(provider?: string) {
  const normalizedProvider = normalizeImageProvider(provider || process.env.IMAGE_PROVIDER || "mock");
  if (normalizedProvider === "dashscope") return process.env.DASHSCOPE_IMAGE_MODEL || "qwen-image";
  if (normalizedProvider === "google-gemini-image") return process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
  if (normalizedProvider === "zml-image") return process.env.ZML_IMAGE_MODEL || "gpt-image-2";
  if (normalizedProvider === "doubao-seedream") return process.env.DOUBAO_SEEDREAM_MODEL || "doubao-seedream-5-0-lite-260128";
  if (normalizedProvider === "openai-compatible") return process.env.OPENAI_IMAGE_MODEL || "openai-compatible-image";
  return "mock-image-v1";
}

const imageProviderQueues = new Map<string, Promise<unknown>>();

async function withImageProviderQueue<T>(key: string, providerName: string, action: () => Promise<T>): Promise<T> {
  const previous = imageProviderQueues.get(key)?.catch(() => undefined) ?? Promise.resolve();
  const run = previous.then(() => retryRateLimitedImageRequest(providerName, action));
  let tracked: Promise<void>;
  tracked = run
    .then(() => undefined, () => undefined)
    .then(() => {
      if (imageProviderQueues.get(key) === tracked) imageProviderQueues.delete(key);
    });
  imageProviderQueues.set(key, tracked);
  return run;
}

async function retryRateLimitedImageRequest<T>(providerName: string, action: () => Promise<T>): Promise<T> {
  const maxAttempts = Math.max(1, Number(process.env.IMAGE_RATE_LIMIT_RETRY_ATTEMPTS ?? 3));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isImageRateLimitError(error) || attempt >= maxAttempts) break;
      await sleep(Number(process.env.IMAGE_RATE_LIMIT_RETRY_BASE_MS ?? 3500) * attempt);
    }
  }

  if (isImageRateLimitError(lastError)) {
    throw new Error(
      `${providerName} 上游并发额度限制：当前账号同一时间可执行的 GPT Image 生图任务已满。系统已串行排队并自动重试，仍被 429 拒绝；请稍后重试、降低连续点击频率，或在 ZML 中转站升级/释放并发额度。原始错误：${formatProviderError(lastError)}`
    );
  }
  throw lastError;
}

function isImageRateLimitError(error: unknown) {
  const message = formatProviderError(error).toLowerCase();
  return message.includes("429") || message.includes("rate_limit") || message.includes("concurrency limit") || message.includes("too many requests");
}

function formatProviderError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatImageFailure(error: unknown, providerName: string, baseUrl: string) {
  const message = formatProviderError(error);
  const lower = message.toLowerCase();
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return `${providerName} 上游生图超时：${message}。该任务已失败记录，可稍后重试、提高 ZML_IMAGE_REQUEST_TIMEOUT_MS，或在项目模型路由切换到其他生图模型继续。`;
  }
  if (lower.includes("fetch failed") || lower.includes("network") || lower.includes("econn")) {
    return `${providerName} 网络请求失败：无法连接 ${baseUrl}。请检查中转站域名、服务端网络、防火墙或代理，再重试。原始错误：${message}`;
  }
  return `${providerName} 生图失败：${message}`;
}

function findGeminiStepsImage(data: GeminiImageResponse) {
  const content = data.steps
    ?.filter((step) => step.type !== "thought")
    .flatMap((step) => step.content ?? [])
    .find((item) => item.type === "image" && item.data);
  if (!content?.data) return undefined;
  return {
    data: content.data,
    mime_type: content.mime_type
  };
}
function findGeminiInlineImage(data: GeminiImageResponse) {
  const content =
    data.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.data || item.image);
  if (!content) return undefined;
  return {
    data: content.data || content.image,
    mime_type: content.mime_type
  };
}

function findGeminiGenerateContentImage(data: GeminiImageResponse) {
  const part = data.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .find((item) => item.inlineData?.data || item.inline_data?.data);
  const inlineData = part?.inlineData;
  const inlineDataSnake = part?.inline_data;
  const imageData = inlineData?.data ?? inlineDataSnake?.data;
  if (!imageData) return undefined;
  return {
    data: imageData,
    mime_type: inlineData?.mimeType ?? inlineDataSnake?.mime_type
  };
}

async function postImageJsonWithFallback({
  urls,
  apiKey,
  payload
}: {
  urls: string[];
  apiKey: string;
  payload: unknown;
}): Promise<OpenAIImageResponse> {
  let lastStatus = 0;
  let lastText = "";

  for (const url of urls) {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    lastStatus = response.status;
    lastText = await response.text().catch(() => "");
    if (response.ok) {
      try {
        return JSON.parse(lastText) as OpenAIImageResponse;
      } catch {
        if (url !== urls[urls.length - 1]) continue;
      }
    }

    if (![404, 405].includes(response.status)) break;
  }

  throw new Error(`Image request failed: ${lastStatus} ${lastText.slice(0, 180)}`);
}

async function postImageEditWithFallback({
  urls,
  apiKey,
  model,
  prompt,
  size,
  referenceImageUrls
}: {
  urls: string[];
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  referenceImageUrls: string[];
}): Promise<OpenAIImageResponse> {
  let lastStatus = 0;
  let lastText = "";

  for (const url of urls) {
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", prompt);
    form.set("size", size);
    form.set("n", "1");

    const blobs = await Promise.all(referenceImageUrls.slice(0, 4).map((imageUrl, index) => imageUrlToBlob(imageUrl, index)));
    blobs.forEach((blob, index) => {
      form.append("image[]", blob, `reference-${index + 1}.png`);
    });

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });

    lastStatus = response.status;
    lastText = await response.text().catch(() => "");
    if (response.ok) return JSON.parse(lastText) as OpenAIImageResponse;
    if (![404, 405].includes(response.status)) break;
  }

  if ([404, 405].includes(lastStatus)) {
    throw new Error(`Image edit endpoint unavailable: ${lastStatus} ${lastText.slice(0, 180)}`);
  }
  throw new Error(`Image edit request failed: ${lastStatus} ${lastText.slice(0, 180)}`);
}

function endpointCandidates(baseUrl: string, path: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1")) return [`${normalized}/${path}`];
  return [`${normalized}/${path}`, `${normalized}/v1/${path}`];
}

async function pollDashScopeImageTask({
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
}) {
  const started = Date.now();
  const url = dashScopeEndpoint(baseUrl, `tasks/${taskId}`);

  while (Date.now() - started < timeoutMs) {
    await sleep(intervalMs);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(`DashScope image task query failed: ${response.status} ${text.slice(0, 180)}`);
    }

    const data = JSON.parse(text) as DashScopeTaskResponse;
    const status = data.output?.task_status;
    const imageUrl = data.output?.results?.find((item) => item.url)?.url;
    if (status === "SUCCEEDED" && imageUrl) return imageUrl;
    if (status === "FAILED" || status === "CANCELED") {
      throw new Error(`DashScope image task ${status}: ${data.output?.message || data.message || compactJson(data)}`);
    }
    if (imageUrl) return imageUrl;
  }

  throw new Error(`DashScope image task timed out after ${Math.round(timeoutMs / 1000)}s: ${taskId}`);
}

function extractDashScopeImageUrl(data: DashScopeResponse) {
  const content = data.output?.choices?.[0]?.message?.content;
  return (
    content?.find((item) => item.image || item.url)?.image ??
    content?.find((item) => item.image || item.url)?.url ??
    data.output?.results?.find((item) => item.url)?.url
  );
}

function dashScopeEndpoint(baseUrl: string, path: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/api/v1")) return `${normalized}/${path}`;
  if (normalized.endsWith("/compatible-mode/v1") || normalized.endsWith("/v1")) {
    return `${normalized.replace(/\/compatible-mode\/v1$|\/v1$/, "/api/v1")}/${path}`;
  }
  return `${normalized}/api/v1/${path}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactJson(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 360);
  } catch {
    return String(value).slice(0, 360);
  }
}

async function imageUrlToBlob(imageUrl: string, index: number) {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) throw new Error(`Invalid data URL reference image at index ${index}`);
    return new Blob([Buffer.from(match[2], "base64")], { type: match[1] || "image/png" });
  }
  if (imageUrl.startsWith("/storage/")) {
    const relativePath = imageUrl.replace(/^\/storage\//, "").replace(/\.\./g, "");
    const buffer = await readFile(resolve(storageRoot, relativePath));
    return new Blob([buffer], { type: mimeTypeFromPath(relativePath) });
  }
  const response = await fetchWithTimeout(imageUrl, {}, Number(process.env.IMAGE_REFERENCE_FETCH_TIMEOUT_MS ?? 30_000));
  if (!response.ok) throw new Error(`Reference image fetch failed: ${response.status} ${imageUrl.slice(0, 80)}`);
  return new Blob([await response.arrayBuffer()], { type: response.headers.get("content-type") || "image/png" });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = imageRequestTimeoutMs(url)) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Image request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function imageRequestTimeoutMs(url: string) {
  if (url.includes("api.zmlmfling.com")) return Number(process.env.ZML_IMAGE_REQUEST_TIMEOUT_MS ?? process.env.IMAGE_REQUEST_TIMEOUT_MS ?? 180_000);
  return Number(process.env.IMAGE_REQUEST_TIMEOUT_MS ?? 75_000);
}

function mimeTypeFromPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function geminiEndpoint(baseUrl: string, path: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1") || normalized.endsWith("/v1beta")) return `${normalized}/${path}`;
  return `${normalized}/v1beta/${path}`;
}

function geminiModelEndpoint(baseUrl: string, model: string, method: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  const versioned = normalized.endsWith("/v1") || normalized.endsWith("/v1beta") ? normalized : `${normalized}/v1beta`;
  return `${versioned}/models/${model}:${method}`;
}

function sizeFromRatio(ratio: "9:16" | "16:9" | "1:1") {
  if (ratio === "16:9") return "1696*960";
  if (ratio === "1:1") return "1280*1280";
  return "960*1696";
}

function openAIImageSizeFromRatio(ratio: "9:16" | "16:9" | "1:1") {
  if (ratio === "16:9") return "1536x1024";
  if (ratio === "1:1") return "1024x1024";
  return "1024x1536";
}

function imageSizeFromInput(provider: string, input: ImageGenerationInput) {
  const model = normalizeRelayImageModel(input.model || currentFallbackImageModel(provider));
  if (model.startsWith("gpt-image-")) {
    const selectedSize = normalizeImageOutputSize(input.size);
    if (selectedSize !== "auto") return selectedSize;
  }
  return imageSizeFromRatio(provider, input.ratio ?? "9:16");
}

function doubaoSeedreamSizeFromRatio(ratio: "9:16" | "16:9" | "1:1") {
  if (ratio === "16:9") return "2560x1440";
  if (ratio === "1:1") return "1920x1920";
  return "1440x2560";
}

function imageSizeFromRatio(provider: string, ratio: "9:16" | "16:9" | "1:1") {
  if (provider === "doubao-seedream") return doubaoSeedreamSizeFromRatio(ratio);
  return openAIImageSizeFromRatio(ratio);
}



