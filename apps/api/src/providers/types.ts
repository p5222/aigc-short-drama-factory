import type { ModelModality, ProviderCapability } from "@aifilm/shared";

export interface ProviderAdapter {
  id: string;
  modality: ModelModality;
  capability: ProviderCapability;
  test(): Promise<{ ok: boolean; message: string }>;
}

export interface ImageGenerationInput {
  prompt: string;
  negativePrompt?: string;
  referenceImageUrls?: string[];
  ratio?: "9:16" | "16:9" | "1:1";
  seed?: number;
  provider?: string;
  model?: string;
  modelPool?: string[];
  size?: string;
  quality?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface ImageGenerationResult {
  taskId: string;
  status: "queued" | "succeeded";
  imageUrl?: string;
  provider?: string;
  model?: string;
}

export interface VideoGenerationInput {
  prompt: string;
  imageUrl?: string;
  ratio?: "9:16" | "16:9" | "1:1";
  duration?: number;
  provider?: string;
  model?: string;
  modelPool?: string[];
  baseUrl?: string;
  apiKey?: string;
}

export interface VideoGenerationResult {
  taskId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "timeout" | "canceled";
  videoUrl?: string;
  provider?: string;
  model?: string;
  message?: string;
  failureCategory?: "auth" | "config" | "network" | "provider_timeout" | "provider_failed" | "input_unreachable" | "no_output" | "canceled" | "unknown";
  retryable?: boolean;
}
