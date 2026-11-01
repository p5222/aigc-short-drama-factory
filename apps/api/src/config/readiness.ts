import { assertProviderConnection, readProviderConnection, inspectModelPrice } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { mapProvider, readProviderRoutingState } from "../db/mappers.js";
import { effectiveSettings, effectiveWechatConfig, settingsEnvironment } from "./platformSettings.js";
import { settingsEncryptionReady } from "./secrets.js";
import { registrationMailConfig } from "../auth/emailVerification.js";
import { probeFfmpeg } from "../export/videoComposer.js";
import { configuredRuntime, providerRuntimeOptions } from "../providers/connection.js";

export async function configurationReadiness() {
  const [defaults, providers, prices] = await Promise.all([
    effectiveSettings("routing"), prisma.modelProvider.findMany(), prisma.modelPrice.findMany({ where: { enabled: true } })
  ]);
  const items: Array<{ id: string; title: string; state: "ready" | "missing" | "paused"; detail: string; module: string }> = [];
  for (const [modality, title] of [["text", "文本创作"], ["image", "角色与分镜图"], ["video", "镜头视频"], ["tts", "成片配音"]] as const) {
    const id = String(defaults[`${modality}Provider`] || "");
    const provider = providers.find(item => item.id === id && item.modality === modality);
    let detail = "请先选择默认渠道，并在模型渠道中填写协议、根地址、密钥和模型。";
    let ready = false;
    if (provider) {
      const model = readProviderRoutingState(provider.capability, provider.models).preferredModel;
      try {
        assertProviderConnection(readProviderConnection(provider.id, modality, provider.capability), modality);
        const mapped = await mapProvider(provider);
        const options = providerRuntimeOptions(provider);
        configuredRuntime({ ...options, connection: readProviderConnection(provider.id, modality, provider.capability), model, provider: id }, modality);
        const price = inspectModelPrice(prices, { providerId: id, model: model || "", modality });
        if (!provider.enabled) detail = "默认渠道已停用，请启用或更换默认渠道。";
        else if (!mapped.apiKeyConfigured) detail = "默认渠道缺少密钥，请在模型渠道中配置。";
        else if (!model) detail = "默认渠道尚未添加模型。";
        else if (price.state !== "ready") detail = price.state === "conflict" ? "默认模型存在多条启用价格，请核对模型定价。" : "默认模型缺少有效价格，请核对模型定价。";
        else { ready = true; detail = `${provider.name} · ${model} 配置齐全，真实生成需单独测试。`; }
      } catch (error) { detail = error instanceof Error ? error.message : "渠道配置不可用。"; }
    }
    items.push({ id: modality, title, state: ready ? "ready" : "missing", detail, module: !id ? "configuration" : "providers" });
  }
  items.push({ id: "encryption", title: "密钥存储", state: settingsEncryptionReady() ? "ready" : "missing",
    detail: settingsEncryptionReady() ? "后台敏感配置使用加密存储。" : "请按部署指南初始化服务器 PLATFORM_SETTINGS_KEY。", module: "configuration" });
  const email = Boolean(registrationMailConfig(await settingsEnvironment("email")));
  items.push({ id: "email", title: "注册邮件", state: email ? "ready" : "missing", detail: email ? "邮件配置完整，可测试 SMTP 认证，再验证真实收件。" : "请补齐 SMTP 发件邮箱和授权码。", module: "configuration" });
  const payment = await effectiveSettings("payment");
  let paymentValid = false;
  try { paymentValid = Boolean(await effectiveWechatConfig()); } catch { /* Report configured status without credentials. */ }
  items.push({ id: "payment", title: "微信收款", state: !payment.enabled ? "paused" : paymentValid ? "ready" : "missing",
    detail: !payment.enabled ? "新收款暂停，可保存商户配置后主动启用。" : paymentValid ? "配置校验通过；真实下单、付款和到账仍需验收。" : "支付配置不完整或密钥格式无效。", module: "configuration" });
  const ffmpeg = await probeFfmpeg();
  items.push({ id: "export", title: "成片导出", state: ffmpeg.ready ? "ready" : "missing", detail: ffmpeg.ready ? "FFmpeg 可用，可进行视频拼接、配音和字幕合成。" : "请按部署指南安装 FFmpeg 并配置路径。", module: "configuration" });
  return { items, checkedAt: new Date().toISOString(), scope: "configuration" as const };
}
