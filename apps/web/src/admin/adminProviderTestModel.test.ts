import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "@aifilm/shared";
import { providerTestAvailability, testSavedProvider } from "./adminProviderTestModel.ts";

const provider = { id: "saved-provider", modality: "text", enabled: true, models: ["saved-model"] } as ModelProvider;

test("each supported modality calls only its matching API with saved provider and model IDs", async () => {
  for (const modality of ["text", "image", "video"] as const) {
    const calls: Array<[string, unknown]> = [];
    const result = { ok: true, mode: "real", provider: "saved-provider", model: "saved-model", message: "Fixture result" };
    const client = {
      modelTest: async (input: unknown) => { calls.push(["text", input]); return result; },
      imageModelTest: async (input: unknown) => { calls.push(["image", input]); return result; },
      videoModelTest: async (input: unknown) => { calls.push(["video", input]); return result; }
    } as Parameters<typeof testSavedProvider>[2];
    assert.equal(await testSavedProvider({ ...provider, modality }, "saved-model", client), result);
    assert.deepEqual(calls, [[modality, { [`${modality}Provider`]: provider.id, [`${modality}Model`]: "saved-model" }]]);
  }
});

test("unsupported modalities and uncommitted or disabled configurations never call a supplier API", async () => {
  let calls = 0;
  const unexpected = async () => { calls += 1; throw new Error("Unexpected network call"); };
  const client = { modelTest: unexpected, imageModelTest: unexpected, videoModelTest: unexpected };
  for (const modality of ["tts", "embedding"] as const) {
    const current = { ...provider, modality };
    assert.equal(providerTestAvailability(current, "saved-model").available, false);
    assert.match(providerTestAvailability(current, "saved-model", { dirty: true }).reason, /未保存改动/);
    await assert.rejects(testSavedProvider(current, "saved-model", client), /尚未提供连接测试接口/);
  }
  for (const options of [{ dirty: true }, { pending: true }]) await assert.rejects(testSavedProvider(provider, "saved-model", client, options));
  await assert.rejects(testSavedProvider({ ...provider, enabled: false }, "saved-model", client), /停用/);
  await assert.rejects(testSavedProvider(provider, "unsaved-model", client), /已保存渠道/);
  await assert.rejects(testSavedProvider(provider, "", client), /请选择/);
  assert.equal(calls, 0);
});

test("test failures and configuration-only results preserve their real meaning", async () => {
  const result = { ok: true, mode: "config", provider: provider.id, model: "saved-model", message: "Only configuration checked" };
  const unexpected = async () => { throw new Error("Unexpected modality"); };
  const client = { modelTest: unexpected, imageModelTest: unexpected, videoModelTest: async () => result } as Parameters<typeof testSavedProvider>[2];
  assert.equal(await testSavedProvider({ ...provider, modality: "video" }, "saved-model", client), result);
  await assert.rejects(testSavedProvider(provider, "saved-model", { ...client, modelTest: async () => { throw new Error("Fixture supplier rejected request"); } }), /supplier rejected/);
});
