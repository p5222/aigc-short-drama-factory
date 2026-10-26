import assert from "node:assert/strict";
import test from "node:test";
import type { ModelPrice, ModelProvider } from "@aifilm/shared";
import { buildModelCatalog, defaultModelRoute, modelIdentity, modelPriceLabel, searchModelCatalog } from "./modelCatalog.ts";

const provider = (id: string, overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  id, name: `渠道 ${id}`, modality: "text", enabled: true, apiKeyConfigured: true, models: ["deepseek-v4-pro"],
  costHint: "", capability: { supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false, ratios: [] },
  ...overrides
});
const price = (providerId: string, overrides: Partial<ModelPrice> = {}): ModelPrice => ({
  id: `price-${providerId}`, providerId, providerName: `渠道 ${providerId}`, modality: "text", model: "deepseek-v4-pro",
  unit: "text_run", unitCredits: 12, vendorCostCny: 0.1, enabled: true, ...overrides
});

test("a relay name cannot turn DeepSeek or an unknown custom ID into an OpenAI model", () => {
  const items = buildModelCatalog([provider("manjiao", { name: "GPT 中转渠道", models: ["deepseek-v4-pro", "private-model-v2"] })]);
  assert.equal(items[0].family, "deepseek");
  assert.equal(items[0].name, "DeepSeek V4 Pro");
  assert.equal(items[1].family, "generic");
  assert.equal(items[1].name, "private-model-v2");
  assert.deepEqual(modelIdentity("google/gemini-2.5-pro"), { family: "gemini", name: "Gemini 2.5 Pro" });
});

test("a same-named model on another route never supplies the displayed price", () => {
  const items = buildModelCatalog([provider("a"), provider("b")], [price("a", { unitCredits: 3 })]);
  assert.equal(items[0].price?.unitCredits, 3);
  assert.equal(items[1].price, undefined);
  assert.equal(items[1].state, "missing_price");
  assert.equal(items[1].selectable, false);
});

test("disabled or wrong-modality prices do not qualify; explicit zero is a real price", () => {
  const [item] = buildModelCatalog([provider("a")], [price("a", { enabled: false }), price("a", { modality: "image" })]);
  assert.equal(item.price, undefined);
  const [free] = buildModelCatalog([provider("a")], [price("a", { unitCredits: 0 })]);
  assert.equal(free.selectable, true);
  assert.equal(modelPriceLabel(free.price), "0 积分/次");
  assert.equal(modelPriceLabel(), "报价时确认");
});

test("conflicting active route prices are not silently reduced to one", () => {
  const [item] = buildModelCatalog([provider("a")], [price("a"), price("a", { id: "duplicate", unitCredits: 5 })]);
  assert.equal(item.state, "price_conflict");
  assert.equal(item.price, undefined);
});

test("missing keys, disabled routes and temporary quota failures cannot become default selections", () => {
  const pool = [
    provider("missing", { apiKeyConfigured: false }),
    provider("disabled", { enabled: false }),
    provider("cooling", { routing: { mode: "auto", modelPool: ["deepseek-v4-pro"], quotaStatus: [{ model: "deepseek-v4-pro", submissions: 2, available: false, coolingDown: true }] } }),
    provider("ready")
  ];
  assert.deepEqual(buildModelCatalog(pool).map(item => item.state), ["missing_key", "disabled", "cooling", "configured"]);
  assert.deepEqual(defaultModelRoute(pool, "text"), { providerId: "ready", model: "deepseek-v4-pro" });
  assert.deepEqual(defaultModelRoute(pool.slice(0, 3), "text"), { providerId: "", model: "" });
});

test("legacy responses with no connection flag remain unknown; search matches both identity and route", () => {
  const items = buildModelCatalog([provider("a", { apiKeyConfigured: undefined })]);
  assert.equal(items[0].state, "unknown");
  assert.equal(items[0].statusLabel, "连接待确认");
  assert.equal(searchModelCatalog(items, "DeepSeek 渠道").length, 1);
  assert.equal(searchModelCatalog(items, "no-match").length, 0);
});
