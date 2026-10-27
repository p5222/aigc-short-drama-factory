import assert from "node:assert/strict";
import test from "node:test";
import { calculateOfficialCredits, calculateOfficialBatchCredits, defaultCreditPolicy, validateCostRule, validateCreditPolicy, verifiedOfficialCosts } from "./creditPricing.ts";
const rule = (model: string) => verifiedOfficialCosts.find(r => r.model === model)!;
test("40% margin means cost divided by 0.6, round upward", () => {
  const result = calculateOfficialCredits(rule("qwen-image-2.0-pro"), { images: 1 }, defaultCreditPolicy);
  assert.equal(result.payableCredits, 84); assert.equal(result.costMicros, 500000); assert.ok(result.marginBps! >= 4000);
});
test("micro-priced narration sums the entire request before rounding", () => {
  const r = rule("qwen3-tts-flash");
  assert.equal(calculateOfficialCredits(r, { characters: 1000 }, defaultCreditPolicy).payableCredits, 14);
  assert.equal(calculateOfficialCredits(r, { characters: 10 }, defaultCreditPolicy).payableCredits, 1);
  assert.equal(calculateOfficialBatchCredits(r, Array(1000).fill({ characters: 1 }), defaultCreditPolicy).payableCredits, 14);
});
test("batch pricing does not compound rounding of each image", () => {
  assert.equal(calculateOfficialCredits(rule("qwen-image-2.0-pro"), { images: 4 }, defaultCreditPolicy).payableCredits, 334);
});
test("text cache is an input subset and billed separately", () => {
  const r = { ...rule("qwen3.7-plus"), tiers: [], cachedInputMicros: 200000 };
  const result = calculateOfficialCredits(r, { inputTokens: 1000000, cachedInputTokens: 500000, outputTokens: 1000000 }, defaultCreditPolicy);
  assert.equal(result.costMicros, 9100000); assert.equal(result.payableCredits, 1517);
  assert.throws(() => calculateOfficialCredits(r, { inputTokens: 1, cachedInputTokens: 2 }, defaultCreditPolicy), /缓存/);
});
test("context tiers are selected per request, never summed across requests", () => {
  const r = { ...rule("qwen3.7-plus"), tiers: [{ aboveInputTokens: 100, inputMicros: 6000000, outputMicros: 24000000 }] };
  assert.equal(calculateOfficialCredits(r, { inputTokens: 100, outputTokens: 100 }, defaultCreditPolicy).costMicros, 1000);
  assert.equal(calculateOfficialCredits(r, { inputTokens: 101, outputTokens: 100 }, defaultCreditPolicy).costMicros, 3006);
  assert.equal(calculateOfficialBatchCredits(r, [{ inputTokens: 100, outputTokens: 100 }, { inputTokens: 100, outputTokens: 100 }], defaultCreditPolicy).costMicros, 2000);
});
test("USD prices require a configured business exchange rate", () => {
  const r = { ...rule("qwen3.7-plus"), currency: "USD" as const, inputMicros: 300000, outputMicros: 1200000, tiers: [] };
  assert.throws(() => calculateOfficialCredits(r, { inputTokens: 1000000 }, defaultCreditPolicy), /汇率/);
  assert.equal(calculateOfficialCredits(r, { inputTokens: 1000000 }, { ...defaultCreditPolicy, usdCnyMicros: 7200000 }).payableCredits, 360);
});
test("discount preview exposes margin loss or adjusts list price to protect margin", () => {
  const r = rule("qwen-image-2.0-pro");
  const protectedPrice = calculateOfficialCredits(r, { images: 1 }, defaultCreditPolicy, 10);
  assert.equal(protectedPrice.listCredits, 93); assert.equal(protectedPrice.payableCredits, 84);
  const discounted = calculateOfficialCredits(r, { images: 1 }, { ...defaultCreditPolicy, protectMargin: false }, 10);
  assert.equal(discounted.payableCredits, 76); assert.ok(discounted.marginBps! < 4000);
  assert.throws(() => calculateOfficialCredits(r, { images: 1 }, defaultCreditPolicy, 100), /减免/);
});
test("bonus cash value and explicit overhead increase required credits", () => {
  const r = rule("qwen-image-2.0-pro");
  assert.equal(calculateOfficialCredits(r, { images: 1 }, { ...defaultCreditPolicy, creditValueMicros: 8333 }).payableCredits, 101);
  assert.equal(calculateOfficialCredits(r, { images: 1 }, { ...defaultCreditPolicy, overheadBps: 2000 }).payableCredits, 100);
});
test("video resolution selects the exact official cost", () => {
  assert.equal(calculateOfficialCredits(rule("wan2.7-i2v"), { seconds: 5, resolution: "1080P" }, defaultCreditPolicy).payableCredits, 834);
});
test("invalid precision, quantities, rates and margin are rejected", () => {
  assert.throws(() => validateCreditPolicy({ ...defaultCreditPolicy, targetMarginBps: 10000 }), /毛利/);
  assert.throws(() => calculateOfficialCredits(rule("qwen3-tts-flash"), { characters: .1 }, defaultCreditPolicy), /整数/);
  assert.throws(() => calculateOfficialCredits(rule("qwen-image-2.0"), { images: -1 }, defaultCreditPolicy), /整数/);
  assert.throws(() => validateCostRule({ ...rule("qwen-image-2.0"), sourceUrl: "http://example.com" }), /HTTPS/);
  assert.throws(() => calculateOfficialCredits(rule("qwen-image-2.0"), { images: Number.MAX_SAFE_INTEGER }, defaultCreditPolicy), /范围/);
});
