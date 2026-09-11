import assert from "node:assert/strict";
import test from "node:test";
import { confirmedDeliveryCredits, deliveryQuoteScopeKey, type DeliveryExportQuote } from "./deliveryQuoteModel.ts";

const quote: DeliveryExportQuote = { type: "tts", providerId: "voice", providerName: "Voice", model: "speech", characters: 120, estimatedCredits: 12, unitCredits: 0.1, unit: "tts_character", cached: false, cueCount: 3 };
const shot = { id: "shot-a", duration: 5, dialogue: "第一句", voiceOver: "" };

test("explicit quote authorizes exactly the displayed cap", () => {
  assert.equal(confirmedDeliveryCredits(quote, "tts", "scope", "scope"), 12);
  assert.equal(confirmedDeliveryCredits(null, "tts", "scope", "scope"), null);
  assert.equal(confirmedDeliveryCredits(quote, "video_export", "scope", "scope"), null);
});

test("reorder, episode switch or dialogue edit invalidates the quote", () => {
  const first = deliveryQuoteScopeKey("project", 1, [shot, { ...shot, id: "shot-b" }]);
  for (const changed of [
    deliveryQuoteScopeKey("project", 2, [shot, { ...shot, id: "shot-b" }]),
    deliveryQuoteScopeKey("project", 1, [{ ...shot, id: "shot-b" }, shot]),
    deliveryQuoteScopeKey("project", 1, [{ ...shot, dialogue: "修改后的台词" }, { ...shot, id: "shot-b" }])
  ]) assert.equal(confirmedDeliveryCredits(quote, "tts", first, changed), null);
});

test("cached audio and subtitle require zero credits; malformed prices cannot submit", () => {
  assert.equal(confirmedDeliveryCredits({ ...quote, cached: true, estimatedCredits: 0 }, "tts", "a", "a"), 0);
  assert.equal(confirmedDeliveryCredits({ ...quote, cached: true }, "tts", "a", "a"), null);
  assert.equal(confirmedDeliveryCredits({ ...quote, type: "subtitle", estimatedCredits: 0 }, "subtitle", "a", "a"), 0);
  for (const estimatedCredits of [-1, NaN, Infinity, 1.5]) assert.equal(confirmedDeliveryCredits({ ...quote, estimatedCredits }, "tts", "a", "a"), null);
});
