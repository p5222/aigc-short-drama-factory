import type { ImageGenerationInput, ImageGenerationResult, ProviderAdapter } from "./types.js";

export const mockImageProvider: ProviderAdapter & {
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult>;
} = {
  id: "mock-image",
  modality: "image",
  capability: {
    supportsReferenceImage: true,
    supportsSeed: true,
    supportsImageToImage: true,
    supportsImageToVideo: false,
    supportsAsyncTask: true,
    ratios: ["9:16", "16:9", "1:1"]
  },
  async test() {
    return { ok: true, message: "Mock image provider is ready." };
  },
  async generateImage(input) {
    return {
      taskId: `mock_image_${Date.now()}`,
      status: "queued",
      imageUrl: input.referenceImageUrls?.[0]
    };
  }
};

