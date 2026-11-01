import crypto from "node:crypto";

const prefix = "enc:v1:";
export function settingsEncryptionReady() {
  return /^[a-f0-9]{64}$/i.test(process.env.PLATFORM_SETTINGS_KEY || "");
}
function key() {
  if (!settingsEncryptionReady()) throw new Error("后台密钥存储尚未初始化，请先配置服务器 PLATFORM_SETTINGS_KEY。");
  return Buffer.from(process.env.PLATFORM_SETTINGS_KEY!, "hex");
}
export function encryptSettingSecret(value: string, purpose: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return prefix + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
/** Existing provider keys remain readable during an additive deployment. */
export function decryptSettingSecret(value: string, purpose: string) {
  if (!value.startsWith(prefix)) return value;
  try {
    const data = Buffer.from(value.slice(prefix.length), "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  } catch { throw new Error("后台密钥无法解密，请核对服务器密钥或恢复匹配的配置备份。"); }
}
