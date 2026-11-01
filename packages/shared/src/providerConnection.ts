import type { ModelModality } from "./index.js";

/** Channel IDs identify billing/accounts; protocols identify the wire contract. */
export const providerProtocols = [
  { id: "openai-chat", modality: "text", label: "OpenAI Chat Completions", baseUrl: "https://api.openai.com/v1" },
  { id: "openai-responses", modality: "text", label: "OpenAI Responses", baseUrl: "https://api.openai.com/v1" },
  { id: "gemini-text", modality: "text", label: "Gemini GenerateContent", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "openai-image", modality: "image", label: "OpenAI Images", baseUrl: "https://api.openai.com/v1" },
  { id: "dashscope-image", modality: "image", label: "通义万相 / Qwen Image", baseUrl: "https://dashscope.aliyuncs.com/api/v1" },
  { id: "seedream-image", modality: "image", label: "火山方舟 Seedream", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "gemini-image", modality: "image", label: "Gemini Interactions Image", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "dashscope-video", modality: "video", label: "通义万相异步视频", baseUrl: "https://dashscope.aliyuncs.com/api/v1" },
  { id: "seedance-video", modality: "video", label: "火山方舟 Seedance 异步视频", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "dashscope-tts", modality: "tts", label: "DashScope Qwen TTS", baseUrl: "https://dashscope.aliyuncs.com/api/v1" }
] as const;

export type ProviderProtocol = typeof providerProtocols[number]["id"];
export interface ProviderConnection {
  protocol: ProviderProtocol;
  resolution?: "480p" | "720p" | "1080p";
  defaultVoice?: string;
  language?: string;
}

export function inferProviderProtocol(id: string, modality: string): ProviderProtocol | undefined {
  if (modality === "text") {
    if (id === "google-ai-studio") return "gemini-text";
    if (id === "openai-upstream") return "openai-responses";
    if (["manjiao", "pipp", "deepseek", "dashscope-text", "bailian-text", "zml-text", "doubao-text", "doubao", "openai-compatible"].includes(id)) return "openai-chat";
  }
  if (modality === "image") {
    if (["dashscope", "dashscope-image", "wanxiang", "qwen-image"].includes(id)) return "dashscope-image";
    if (["google", "google-ai-studio", "google-gemini-image", "gemini-image", "gemini-3-pro-image", "gemini-3.1-flash-image"].includes(id)) return "gemini-image";
    if (["doubao", "doubao-seedream", "seedream", "Doubao-Seedream-5.0-lite", "doubao-seedream-5-0-lite-260128"].includes(id)) return "seedream-image";
    if (["manjiao", "manjiao-image", "manjiao-relay", "zml", "zml-image", "zml-gpt-image", "zml-relay", "gpt-image-2", "ripp", "ripp-image", "openai-compatible", "openai-compatible-image", "relay", "relay-image", "image2", "gpt-image2", "openai-image"].includes(id)) return "openai-image";
  }
  if (modality === "video") {
    if (["dashscope", "dashscope-video", "wanxiang", "wanx", "qwen-video"].includes(id)) return "dashscope-video";
    if (["doubao", "doubao-seedance", "seedance", "volcengine", "ark"].includes(id)) return "seedance-video";
  }
  if (modality === "tts" && id === "dashscope-tts") return "dashscope-tts";
  return undefined;
}

export function storedProviderConnection(capability: unknown): ProviderConnection | undefined {
  if (!capability || typeof capability !== "object" || !("connection" in capability)) return undefined;
  return capability.connection as ProviderConnection | undefined;
}

export function readProviderConnection(id: string, modality: string, capability?: unknown): ProviderConnection | undefined {
  const stored = storedProviderConnection(capability);
  if (stored) return stored;
  const protocol = inferProviderProtocol(id, modality);
  return protocol ? { protocol } : undefined;
}

export function isSupportedProviderProtocol(protocol: unknown, modality: string) {
  return providerProtocols.some(item => item.id === protocol && item.modality === modality);
}

export function assertProviderConnection(connection: ProviderConnection | undefined, modality: ModelModality | string): asserts connection is ProviderConnection {
  if (!connection || !isSupportedProviderProtocol(connection.protocol, modality)) {
    throw new Error("该渠道尚未配置受支持的接口协议，请在后台模型渠道中选择与用途匹配的协议。");
  }
}
