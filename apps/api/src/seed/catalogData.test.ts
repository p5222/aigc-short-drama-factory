import assert from "node:assert/strict";
import test from "node:test";
import { modelPrices, providers } from "./catalogData.js";

test("new projects expose no enabled ZML provider or price", () => {
  assert.equal(providers.some((provider) => provider.enabled && provider.id.startsWith("zml")), false);
  assert.equal(modelPrices.some((price) => price.enabled && price.providerId?.startsWith("zml")), false);
});

test("Ripp is an image-only GPT Image 2 provider", () => {
  assert.equal(providers.some((provider) => provider.enabled && provider.id === "pipp" && provider.modality === "text"), false);
  const ripp = providers.find((provider) => provider.id === "ripp-image");
  assert.deepEqual(ripp && { modality: ripp.modality, enabled: ripp.enabled, baseUrl: ripp.baseUrl, models: ripp.models }, {
    modality: "image",
    enabled: true,
    baseUrl: "https://ripp.best",
    models: ["gpt-image-2"]
  });
  assert.equal(modelPrices.some((price) => price.enabled && price.providerId === "ripp-image" && price.model === "gpt-image-2"), true);
});
