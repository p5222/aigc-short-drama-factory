import { assertProviderConnection, readProviderConnection, storedProviderConnection, type ProviderConnection } from "@aifilm/shared";
import { providerEnvApiKey, providerDefaultBaseUrl } from "./credentials.js";
import { decryptSettingSecret } from "../config/secrets.js";

export function providerRuntimeOptions(row: { id: string; modality: string; baseUrl?: string | null; apiKey?: string | null; capability?: unknown } | null | undefined) {
  if (!row) return {};
  return {
    baseUrl: row.baseUrl || providerDefaultBaseUrl(row.id, row.modality),
    apiKey: row.apiKey ? decryptSettingSecret(row.apiKey, `provider:${row.id}`) : providerEnvApiKey(row.id, row.modality as "text"),
    connection: storedProviderConnection(row.capability)
  };
}

export function configuredRuntime(input: { provider?: string; model?: string; baseUrl?: string; apiKey?: string; connection?: ProviderConnection }, modality: string) {
  assertProviderConnection(input.connection, modality);
  const baseUrl = input.baseUrl || providerDefaultBaseUrl(input.provider || "", modality);
  if (!baseUrl || !input.model) throw new Error("自定义协议渠道需要填写接口根地址和模型 ID。");
  validateProviderUrl(baseUrl);
  return {
    name: input.provider || input.connection.protocol,
    provider: input.provider || input.connection.protocol,
    model: input.model,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: input.apiKey || providerEnvApiKey(input.provider || "", modality as "text"),
    missingKeyMessage: "渠道缺少 API Key，请在后台模型渠道中配置。"
  };
}

export function validateProviderUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("渠道地址必须是有效的 HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new Error("渠道地址仅支持 HTTP(S)，不能嵌入账号密码、查询参数或片段。");
  }
  return url.toString().replace(/\/+$/, "");
}

export function validateConnectionForChannel(id: string, modality: string, capability: unknown) {
  const connection = readProviderConnection(id, modality, capability);
  assertProviderConnection(connection, modality);
  return connection;
}
