import assert from "node:assert/strict";
import test from "node:test";
import { encryptSettingSecret, decryptSettingSecret } from "./secrets.js";
import { providerRuntimeOptions } from "../providers/connection.js";

test("encrypted configuration is authenticated, purpose-bound and compatible with existing provider secrets", () => {
  const previous = process.env.PLATFORM_SETTINGS_KEY;
  process.env.PLATFORM_SETTINGS_KEY = "ab".repeat(32);
  try {
    const secret = "fixture-only-sensitive-text";
    const encrypted = encryptSettingSecret(secret, "provider:private");
    assert.notEqual(encrypted, encryptSettingSecret(secret, "provider:private"));
    assert.equal(encrypted.includes(secret), false);
    assert.equal(decryptSettingSecret(encrypted, "provider:private"), secret);
    assert.throws(() => decryptSettingSecret(encrypted, "provider:other"), /无法解密/);
    assert.equal(providerRuntimeOptions({ id: "private", modality: "text", apiKey: encrypted }).apiKey, secret);
    assert.equal(decryptSettingSecret(secret, "provider:legacy"), secret);
    process.env.PLATFORM_SETTINGS_KEY = "cd".repeat(32);
    assert.throws(() => decryptSettingSecret(encrypted, "provider:private"), /无法解密/);
    delete process.env.PLATFORM_SETTINGS_KEY;
    assert.throws(() => encryptSettingSecret(secret, "email:password"), /尚未初始化/);
  } finally { if (previous === undefined) delete process.env.PLATFORM_SETTINGS_KEY; else process.env.PLATFORM_SETTINGS_KEY = previous; }
});
