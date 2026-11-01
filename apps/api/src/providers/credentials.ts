import type { ModelProvider } from "@aifilm/shared";

/** Keep catalog readiness and the generation adapters on the same credentials. */
export function providerEnvApiKey(providerId: string, modality?: ModelProvider["modality"]): string {
  const envKeys: Record<string, string[]> = {
    manjiao: ["MANJIAO_TEXT_API_KEY"],
    pipp: ["PIPP_TEXT_API_KEY"],
    "manjiao-image": ["MANJIAO_IMAGE_API_KEY"],
    deepseek: ["DEEPSEEK_API_KEY"],
    "dashscope-text": ["DASHSCOPE_TEXT_API_KEY", "DASHSCOPE_API_KEY", "BAILIAN_TEXT_API_KEY"],
    "bailian-text": ["DASHSCOPE_TEXT_API_KEY", "DASHSCOPE_API_KEY", "BAILIAN_TEXT_API_KEY"],
    "dashscope-image": ["DASHSCOPE_API_KEY"],
    "dashscope-video": ["DASHSCOPE_API_KEY"],
    "dashscope-tts": ["DASHSCOPE_TTS_API_KEY", "TTS_API_KEY", "DASHSCOPE_API_KEY", "DASHSCOPE_TEXT_API_KEY"],
    "doubao-text": ["DOUBAO_TEXT_API_KEY", "DOUBAO_API_KEY", "ARK_API_KEY", "VOLCENGINE_API_KEY"],
    "doubao-seedream": ["DOUBAO_API_KEY", "ARK_API_KEY", "VOLCENGINE_API_KEY"],
    "doubao-seedance": ["DOUBAO_API_KEY", "ARK_API_KEY", "VOLCENGINE_API_KEY"],
    "google-ai-studio": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    "google-gemini-image": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    "zml-text": ["ZML_API_KEY"],
    "zml-image": ["ZML_API_KEY"],
    "ripp-image": ["RIPP_IMAGE_API_KEY"],
    "openai-upstream": ["OPENAI_API_KEY", "OPENAI_COMPATIBLE_API_KEY"],
    "openai-compatible": modality === "image"
      ? ["OPENAI_IMAGE_API_KEY", "OPENAI_API_KEY", "OPENAI_COMPATIBLE_API_KEY"]
      : ["OPENAI_COMPATIBLE_API_KEY", "OPENAI_API_KEY"]
  };
  return (envKeys[providerId] ?? []).map(key => process.env[key]?.trim()).find(Boolean) || "";
}

/** Only known channel identities may inherit server endpoint configuration. */
export function providerDefaultBaseUrl(id: string, modality: string): string | undefined {
  const env = process.env;
  if (id === "pipp") return env.PIPP_TEXT_BASE_URL || "https://ripp.best";
  if (id === "manjiao" || id === "manjiao-image") return env.MANJIAO_BASE_URL || "https://api.zmlmfling.com";
  if (id === "zml-text" || id === "zml-image") return env.ZML_BASE_URL || "https://api.zmlmfling.com";
  if (id === "ripp-image") return env.RIPP_IMAGE_BASE_URL || "https://ripp.best";
  if (id === "deepseek") return env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  if (id === "dashscope-text" || id === "bailian-text") return env.DASHSCOPE_TEXT_BASE_URL || env.BAILIAN_TEXT_BASE_URL || env.OPENAI_COMPATIBLE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  if (id === "dashscope-tts") return env.DASHSCOPE_TTS_BASE_URL || env.TTS_BASE_URL || env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v1";
  if (id === "dashscope-image" || id === "dashscope-video") return env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v1";
  if (id === "doubao-text") return env.DOUBAO_TEXT_BASE_URL || env.DOUBAO_BASE_URL || env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
  if (id === "doubao-seedream" || id === "doubao-seedance") return env.DOUBAO_BASE_URL || env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
  if (id === "google-ai-studio" || id === "google-gemini-image") return env.GEMINI_BASE_URL || env.GOOGLE_AI_STUDIO_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
  if (id === "openai-upstream") return env.OPENAI_BASE_URL || env.OPENAI_COMPATIBLE_BASE_URL;
  if (id === "openai-compatible") return modality === "image"
    ? env.OPENAI_IMAGE_BASE_URL || env.OPENAI_BASE_URL || env.OPENAI_COMPATIBLE_BASE_URL
    : env.OPENAI_COMPATIBLE_BASE_URL || env.OPENAI_BASE_URL;
  return undefined;
}
