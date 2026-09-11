import assert from "node:assert/strict";
import test from "node:test";
import type { CreateProjectInput, ModelProvider } from "@aifilm/shared";
import { buildEstimateInput, buildGenerationInput, canManageModelTests, creationBillingSignature, createCreationQuoteGate, isConfiguredModelRoute } from "./wizardRequestModel.ts";

const form = { title: "", content: "第1集 夜行\n场景1 / 庭院\n对白\n第2集 清晨\n场景2 / 客厅\n对白", sourceType: "script", mode: "director", genre: "", artStyle: "", targetEpisodes: 9 } as CreateProjectInput;
test("estimate and create keep script input and identical episode scope", () => {
  assert.equal(buildEstimateInput(form).sourceType, "script");
  assert.equal(buildGenerationInput(form).sourceType, "script");
  assert.equal(buildEstimateInput(form).targetEpisodes, 2);
  assert.equal(buildEstimateInput(form).targetEpisodes, buildGenerationInput(form).targetEpisodes);
});
test("both requests migrate legacy screenplay drafts and preserve supported source types", () => {
  const legacy = { ...form, sourceType: "screenplay" } as unknown as CreateProjectInput;
  assert.equal(buildEstimateInput(legacy).sourceType, "script");
  assert.equal(buildGenerationInput(legacy).sourceType, "script");
  for (const sourceType of ["novel", "short_story", "idea", "excel"] as const) {
    assert.equal(buildEstimateInput({ ...form, sourceType }).sourceType, sourceType);
    assert.equal(buildGenerationInput({ ...form, sourceType }).sourceType, sourceType);
  }
});
test("only current server-authorized admin role can test models", () => {
  for (const role of [undefined, "user", "creator", "operator", "finance", "support"]) assert.equal(canManageModelTests(role), false);
  assert.equal(canManageModelTests("admin"), true);
});
test("configured route requires enabled catalog provider and exact model/modality", () => {
  const provider = { id: "text", modality: "text", enabled: true, models: ["qwen"] } as ModelProvider;
  assert.equal(isConfiguredModelRoute([provider], "text", "text", "qwen"), true);
  assert.equal(isConfiguredModelRoute([{ ...provider, enabled: false }], "text", "text", "qwen"), false);
  assert.equal(isConfiguredModelRoute([provider], "text", "other", "qwen"), false);
  assert.equal(isConfiguredModelRoute([provider], "text", "text", "invented-fallback"), false);
  assert.equal(isConfiguredModelRoute([provider], "image", "text", "qwen"), false);
  assert.equal(isConfiguredModelRoute([], "text", "text", "qwen"), false);
});

test("creation billing signature tracks actual content, route and bounded episode input, excluding old credit caps", () => {
  const base = { ...form, textProvider: "configured-text", textModel: "model-1", targetEpisodes: 1 };
  const signature = creationBillingSignature(base);
  assert.equal(creationBillingSignature({ ...base, maxCredits: 123 }), signature);
  assert.equal(creationBillingSignature({ ...base, title: "Updated project title" }), signature);
  for (const changed of [{ content: base.content + "新对白" }, { textProvider: "different-text" }, { textModel: "model-2" }, { targetEpisodes: 2 }, { sourceType: "novel" as const }, { mode: "nine_grid" as const }]) assert.notEqual(creationBillingSignature({ ...base, ...changed }), signature);
});

test("late quotes cannot replace current input or revive after switching back to earlier input", async () => {
  const gate = createCreationQuoteGate();
  const original = gate.begin("original"), pendingOld = Promise.resolve(original);
  gate.select("edited");
  assert.equal(gate.current(await pendingOld), false);
  gate.select("original");
  assert.equal(gate.current(original), false);
  const fresh = gate.begin("original");
  assert.equal(gate.current(fresh), true);
  const newer = gate.begin("original");
  assert.equal(gate.current(fresh), false);
  assert.equal(gate.current(newer), true);
});
