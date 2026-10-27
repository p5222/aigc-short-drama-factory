import type { ModelProvider } from "@aifilm/shared";

/** Keep catalog readiness and the generation adapters on the same credentials. */
export function providerEnvApiKey(providerId: string, modality?: ModelProvider["modality"]): string {
  const envKeys: Record<string, string[]> = {
    manjiao: ["MANJIAO_TEXT_API_KEY"],
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
