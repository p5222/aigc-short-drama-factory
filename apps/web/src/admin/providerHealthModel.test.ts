import assert from "node:assert/strict";
import test from "node:test";
import type { ModelPrice, ModelProvider } from "@aifilm/shared";
import { groupAdminPrices, inspectAdminPrice, providerHealth } from "./providerHealthModel.ts";
import { providerModelFamily } from "../components/modelCatalog.ts";

const provider: ModelProvider = { id: "a", name: "相同渠道名", modality: "text", models: ["qwen-plus", "gemini-pro"], enabled: true, apiKeyConfigured: true, costHint: "", capability: { ratios: [], supportsSeed: false, supportsReferenceImage: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false } };
const price: ModelPrice = { id: "p", providerId: "a", providerName: provider.name, modality: "text", model: "qwen-plus", unit: "text_run", unitCredits: 10, vendorCostCny: 0.1, enabled: true };

test("coverage counts distinct declared models with exactly one valid price, not price records", () => {
  const prices = [price, ...Array.from({ length: 6 }, (_, i) => ({ ...price, id: `unused${i}`, model: `old-model-${i}` }))];
  const result = providerHealth({ ...provider, models: ["qwen-plus", "qwen-plus", " gemini-pro "] }, prices);
  assert.equal(result.models.length, 2);
  assert.equal(result.covered, 1);
  assert.equal(result.ready, 1);
  assert.equal(result.needsAttention, true);
  assert.equal(providerHealth(provider, [price, { ...price, id: "duplicate" }]).covered, 0);
  assert.equal(providerHealth(provider, [{ ...price, unit: "image" }]).covered, 0);
});
test("enabled flags alone never imply readiness; prices, keys, models and quotas all matter", () => {
  const modelProvider = { ...provider, models: ["qwen-plus"] };
  assert.equal(providerHealth(modelProvider, [price]).status, "配置齐全");
  assert.equal(providerHealth({ ...modelProvider, apiKeyConfigured: undefined }, [price]).ready, 0);
  assert.equal(providerHealth({ ...modelProvider, apiKeyConfigured: false }, [price]).ready, 0);
  assert.equal(providerHealth({ ...modelProvider, enabled: false }, [price]).needsAttention, false);
  assert.equal(providerHealth({ ...provider, models: [] }, [price]).needsAttention, true);
  assert.equal(providerHealth({ ...modelProvider, routing: { mode: "auto", modelPool: [], quotaStatus: [{ model: "qwen-plus", submissions: 1, available: false, coolingDown: true }] } }, [price]).ready, 0);
});
test("price association requires ID, modality and model; same channel names cannot mask orphans", () => {
  assert.equal(inspectAdminPrice(price, [provider], [price]).state, "ready");
  assert.equal(inspectAdminPrice(price, [{ ...provider, id: "b" }], [price]).state, "orphan");
  assert.equal(inspectAdminPrice(price, [{ ...provider, modality: "image" }], [price]).state, "orphan");
  assert.equal(inspectAdminPrice(price, [{ ...provider, models: ["gemini-pro"] }], [price]).state, "orphan");
  assert.equal(inspectAdminPrice(price, [provider], [price, { ...price, id: "p2" }]).state, "conflict");
  assert.equal(inspectAdminPrice(price, [{ ...provider, enabled: false }], [price]).state, "disabled_route");
});
test("whole channel groups preserve all records and distinct same-named routes", () => {
  const prices = Array.from({ length: 25 }, (_, i) => ({ ...price, id: `p${i}`, model: `qwen-${i}` }));
  const groups = groupAdminPrices([...prices, { ...price, id: "b", providerId: "b" }]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].prices.length, 25);
  assert.equal(groups[1].prices.length, 1);
  assert.notEqual(groups[0].id, groups[1].id);
});
test("mixed and opaque channels use neutral identities, homogeneous models use the real brand", () => {
  assert.equal(providerModelFamily(["doubao-pro", "seedance-1"]), "seed");
  assert.equal(providerModelFamily(["qwen-plus", "qwen-max"]), "qwen");
  assert.equal(providerModelFamily(["qwen-plus", "gemini-pro"]), "generic");
  assert.equal(providerModelFamily(["ep-123", "doubao-pro"]), "generic");
  assert.equal(providerModelFamily([]), "generic");
});
