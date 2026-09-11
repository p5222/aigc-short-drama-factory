import type { ImageModelTestResult, ModelProvider, ModelTestResult, VideoModelTestResult } from "@aifilm/shared";

export type ProviderConnectionTestResult = ModelTestResult | ImageModelTestResult | VideoModelTestResult;
type TestProvider = Pick<ModelProvider, "id" | "modality" | "enabled" | "models">;
type TestOptions = { dirty?: boolean; pending?: boolean };
type TestClient = {
  modelTest(input: { textProvider: string; textModel: string }): Promise<ModelTestResult>;
  imageModelTest(input: { imageProvider: string; imageModel: string }): Promise<ImageModelTestResult>;
  videoModelTest(input: { videoProvider: string; videoModel: string }): Promise<VideoModelTestResult>;
};

export function providerTestAvailability(provider: TestProvider, model: string, options: TestOptions = {}) {
  if (options.pending) return { available: false, reason: "正在测试已保存配置，请等待结果后再编辑或测试。" };
  if (options.dirty) return { available: false, reason: "配置有未保存改动，请先保存，再测试已保存配置。" };
  if (provider.modality === "tts") return { available: false, reason: "配音渠道尚未提供连接测试接口；保存配置不会验证实际配音效果。" };
  if (provider.modality === "embedding") return { available: false, reason: "向量渠道尚未提供连接测试接口；保存配置不会验证实际检索效果。" };
  if (!["text", "image", "video"].includes(provider.modality)) return { available: false, reason: "当前模型类型尚不支持连接测试。" };
  if (!provider.enabled) return { available: false, reason: "此渠道已停用，请先启用并保存后再测试。" };
  if (!model || !provider.models.includes(model)) return { available: false, reason: "请选择已保存渠道中的模型。" };
  return { available: true, reason: "测试使用服务端已保存的配置；文本和图片测试可能产生供应商费用。视频以返回的配置检查或实际测试结果为准。" };
}

export async function testSavedProvider(provider: TestProvider, model: string, client: TestClient, options: TestOptions = {}): Promise<ProviderConnectionTestResult> {
  const readiness = providerTestAvailability(provider, model, options);
  if (!readiness.available) throw new Error(readiness.reason);
  switch (provider.modality) {
    case "text": return client.modelTest({ textProvider: provider.id, textModel: model });
    case "image": return client.imageModelTest({ imageProvider: provider.id, imageModel: model });
    case "video": return client.videoModelTest({ videoProvider: provider.id, videoModel: model });
    default: throw new Error("当前模型类型尚不支持连接测试。");
  }
}
