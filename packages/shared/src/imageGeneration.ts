export type ImageOutputSize =
  | "auto"
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "1920x1088"
  | "2048x1152"
  | "2560x1440"
  | "3840x2160"
  | "2160x3840";

export type ImageOutputQuality = "low" | "medium" | "high" | "auto";

export type CanonicalImageProviderId =
  | "dashscope-image"
  | "google-gemini-image"
  | "zml-image"
  | "ripp-image"
  | "doubao-seedream"
  | "openai-compatible-image"
  | "mock-image";

export function normalizeImageProviderId(provider?: string | null): CanonicalImageProviderId {
  if (provider === "dashscope" || provider === "dashscope-image") return "dashscope-image";
  if (provider === "google" || provider === "google-ai-studio" || provider === "google-gemini-image") return "google-gemini-image";
  if (provider === "zml" || provider === "zml-image" || provider === "zml-relay") return "zml-image";
  if (provider === "ripp" || provider === "ripp-image") return "ripp-image";
  if (provider === "doubao" || provider === "doubao-seedream") return "doubao-seedream";
  if (provider === "openai-compatible" || provider === "openai-compatible-image" || provider === "relay" || provider === "relay-image") return "openai-compatible-image";
  return "mock-image";
}

export function defaultImageUnitCredits(provider?: string | null): number {
  const canonical = normalizeImageProviderId(provider);
  if (canonical === "dashscope-image") return 8;
  if (canonical === "google-gemini-image") return 24;
  if (canonical === "zml-image") return 28;
  if (canonical === "ripp-image") return 28;
  if (canonical === "doubao-seedream") return 8;
  if (canonical === "openai-compatible-image") return 30;
  return 5;
}

export interface ImageUnitPriceLike {
  providerId?: string | null;
  modality: string;
  model: string;
  unitCredits: number;
  enabled: boolean;
}

export function resolveImageUnitCredits(
  prices: readonly ImageUnitPriceLike[],
  provider: string,
  model: string
): number {
  const providerId = normalizeImageProviderId(provider);
  return prices.find((price) => (
    price.enabled
    && price.modality === "image"
    && price.providerId === providerId
    && price.model === model
  ))?.unitCredits ?? defaultImageUnitCredits(provider);
}

export interface ImageOutputSizeOption {
  value: ImageOutputSize;
  label: string;
  ratio: "auto" | "1:1" | "16:9" | "9:16";
  multiplier: number;
  hint: string;
}

export interface ImageOutputQualityOption {
  value: ImageOutputQuality;
  label: string;
  multiplier: number;
  hint: string;
}

export const imageOutputSizeOptions: ImageOutputSizeOption[] = [
  { value: "auto", label: "自动匹配", ratio: "auto", multiplier: 1, hint: "由上游按画幅自动选择，适合普通测试。" },
  { value: "1024x1024", label: "1K 方图 1024x1024", ratio: "1:1", multiplier: 1, hint: "头像、角色小样、低成本测试。" },
  { value: "1536x1024", label: "横图 1536x1024", ratio: "16:9", multiplier: 1.15, hint: "横版分镜基础档。" },
  { value: "1024x1536", label: "竖图 1024x1536", ratio: "9:16", multiplier: 1.15, hint: "竖屏角色和短剧镜头基础档。" },
  { value: "1920x1088", label: "1080P 横图 1920x1088", ratio: "16:9", multiplier: 1.25, hint: "接近 1080P，宽高均为 16 的倍数。" },
  { value: "2048x1152", label: "2K 横图 2048x1152", ratio: "16:9", multiplier: 1.35, hint: "当前推荐生产档，清晰度和成本平衡。" },
  { value: "2560x1440", label: "2.5K 横图 2560x1440", ratio: "16:9", multiplier: 1.55, hint: "更高细节，适合关键镜头。" },
  { value: "3840x2160", label: "4K 横图 3840x2160", ratio: "16:9", multiplier: 1.9, hint: "4K 实验档，适合封面和重点画面。" },
  { value: "2160x3840", label: "4K 竖图 2160x3840", ratio: "9:16", multiplier: 1.9, hint: "竖屏 4K 实验档，适合重点竖屏镜头。" }
];

export const imageOutputQualityOptions: ImageOutputQualityOption[] = [
  { value: "low", label: "低成本草稿", multiplier: 0.85, hint: "快速试画面和构图。" },
  { value: "medium", label: "标准生产", multiplier: 1, hint: "默认推荐，适合批量分镜图。" },
  { value: "high", label: "高清精修", multiplier: 1.35, hint: "角色定稿、关键镜头和封面。" },
  { value: "auto", label: "上游自动", multiplier: 1.15, hint: "让上游自动选择质量，成本按保守倍率预估。" }
];

export function normalizeImageOutputSize(value?: string | null): ImageOutputSize {
  return imageOutputSizeOptions.some((item) => item.value === value) ? value as ImageOutputSize : "2048x1152";
}

export function normalizeImageOutputQuality(value?: string | null): ImageOutputQuality {
  return imageOutputQualityOptions.some((item) => item.value === value) ? value as ImageOutputQuality : "medium";
}

export function imageSizeMultiplier(value?: string | null) {
  return imageOutputSizeOptions.find((item) => item.value === normalizeImageOutputSize(value))?.multiplier ?? 1;
}

export function imageQualityMultiplier(value?: string | null) {
  return imageOutputQualityOptions.find((item) => item.value === normalizeImageOutputQuality(value))?.multiplier ?? 1;
}

export function imageParameterMultiplier(size?: string | null, quality?: string | null) {
  return imageSizeMultiplier(size) * imageQualityMultiplier(quality);
}

export function estimateImageCredits(baseUnitCredits: number, size?: string | null, quality?: string | null) {
  return Math.max(0, Math.ceil(baseUnitCredits * imageParameterMultiplier(size, quality)));
}
