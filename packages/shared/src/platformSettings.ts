export type SettingGroup = "routing" | "email" | "payment";
export type SettingValue = string | number | boolean;
export interface SettingField {
  key: string;
  label: string;
  type: "text" | "secret" | "multiline" | "boolean" | "number" | "provider";
  env?: string;
  defaultValue?: SettingValue;
  modality?: "text" | "image" | "video" | "tts";
  hint?: string;
}
export const platformSettingGroups: Array<{ id: SettingGroup; title: string; description: string; fields: SettingField[] }> = [
  { id: "routing", title: "创作默认渠道", description: "文本、图片和视频用于新作品的初始选择，已保存作品保持原模型。配音按导出时的默认渠道重新报价。", fields: [
    { key: "textProvider", label: "文本创作", type: "provider", modality: "text" },
    { key: "imageProvider", label: "角色与分镜图", type: "provider", modality: "image" },
    { key: "videoProvider", label: "镜头视频", type: "provider", modality: "video" },
    { key: "ttsProvider", label: "成片配音", type: "provider", modality: "tts", defaultValue: "dashscope-tts" }
  ] },
  { id: "email", title: "注册邮件", description: "保存后对新发送的验证码生效，SMTP 全程使用 TLS。", fields: [
    { key: "host", label: "SMTP 服务器", type: "text", env: "REGISTRATION_SMTP_HOST", defaultValue: "smtp.qq.com" },
    { key: "port", label: "端口", type: "number", env: "REGISTRATION_SMTP_PORT", defaultValue: 465 },
    { key: "secure", label: "使用隐式 TLS（通常为 465 端口）", type: "boolean", env: "REGISTRATION_SMTP_SECURE", defaultValue: true, hint: "关闭时仍强制 STARTTLS，通常使用 587 端口。" },
    { key: "user", label: "发件邮箱", type: "text", env: "REGISTRATION_SMTP_USER" },
    { key: "password", label: "SMTP 授权码", type: "secret", env: "REGISTRATION_SMTP_PASSWORD" }
  ] },
  { id: "payment", title: "微信 Native 支付", description: "配置并校验后可主动开放收款。暂停收款不影响已有订单的回调和对账。", fields: [
    { key: "enabled", label: "开放新订单收款", type: "boolean", env: "WECHAT_PAY_ENABLED", defaultValue: false },
    { key: "appId", label: "应用 AppID", type: "text", env: "WECHAT_PAY_APP_ID" },
    { key: "merchantId", label: "商户号", type: "text", env: "WECHAT_PAY_MCH_ID" },
    { key: "serial", label: "商户证书序列号", type: "text", env: "WECHAT_PAY_SERIAL" },
    { key: "privateKey", label: "商户私钥（PEM）", type: "secret", env: "WECHAT_PAY_PRIVATE_KEY" },
    { key: "apiV3Key", label: "API v3 密钥", type: "secret", env: "WECHAT_PAY_API_V3_KEY" },
    { key: "publicKeys", label: "微信支付公钥（JSON）", type: "multiline", env: "WECHAT_PAY_PUBLIC_KEYS_JSON", hint: "格式：{\"公钥ID\":\"-----BEGIN PUBLIC KEY-----\\n...\"}，可同时保留轮换前后的公钥。" },
    { key: "notifyUrl", label: "支付回调地址", type: "text", env: "WECHAT_PAY_NOTIFY_URL", hint: "https://你的域名/api/billing/wechat/notify" }
  ] }
];
export interface PlatformSettingView {
  group: SettingGroup;
  version: number;
  values: Record<string, SettingValue>;
  sources: Record<string, "database" | "environment" | "default" | "empty">;
  secrets: Record<string, boolean>;
  encryptionReady: boolean;
  updatedAt?: string;
}
export interface PlatformSettingUpdate {
  expectedVersion: number;
  values: Record<string, SettingValue | null>;
}
