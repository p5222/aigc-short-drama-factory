import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import test from "node:test";

test("text requests preserve the exact selected model and its fixed candidate pool", async t => {
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const temporaryStorage = await mkdtemp(resolve(process.cwd(), ".text-model-test-"));
  const keys = ["OBJECT_STORAGE_LOCAL_DIR", "DEEPSEEK_RUNTIME_MODEL", "DEEPSEEK_MODEL_POOL", "GEMINI_TEXT_WIRE_API", "GEMINI_TEXT_MODEL", "OPENAI_TEXT_MODEL_POOL"];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  process.env.OBJECT_STORAGE_LOCAL_DIR = temporaryStorage;
  process.env.DEEPSEEK_RUNTIME_MODEL = "unselected-runtime-override";
  process.env.DEEPSEEK_MODEL_POOL = "unselected-environment-fallback";
  process.env.GEMINI_TEXT_MODEL = "unselected-google-environment-model";
  const { callTextModelJson, testTextModelConnection } = await import("./generator.js");
  const originalFetch = globalThis.fetch;
  const base = { apiKey: "fixture-server-key", baseUrl: "https://model.example.invalid/v1", system: "Return JSON", prompt: "A fixture request" };
  const chatResponse = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ready":true}' } }] }), { status: 200 });
  try {
    await t.test("DeepSeek selected IDs cannot be replaced by legacy aliases or DEEPSEEK_RUNTIME_MODEL", async () => {
      for (const selected of ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v3"]) {
        const sent: string[] = [];
        globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(String(init?.body)).model); return chatResponse(); };
        const result = await callTextModelJson<{ ready: boolean }>({ ...base, textProvider: "deepseek", textModel: selected, textModelPool: [selected] });
        assert.equal(result.ready, true); assert.deepEqual(sent, [selected]);
      }
    });
    await t.test("Google Interactions payload and connection result keep the configured ID", async () => {
      process.env.GEMINI_TEXT_WIRE_API = "interactions";
      const selected = "gemini-3.1pro"; const sent: string[] = [];
      globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(String(init?.body)).model); return new Response(JSON.stringify({ output_text: '{"ready":true}' }), { status: 200 }); };
      const result = await testTextModelConnection({ ...base, textProvider: "google-ai-studio", textModel: selected, textModelPool: [selected] });
      assert.equal(result.model, selected); assert.deepEqual(sent, [selected]);
    });
    await t.test("Google generateContent uses the exact model in its resource path", async () => {
      process.env.GEMINI_TEXT_WIRE_API = "generateContent";
      const selected = "gemini-3-pro"; const urls: string[] = [];
      globalThis.fetch = async (url) => { urls.push(String(url)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ready":true}' }] } }] }), { status: 200 }); };
      await callTextModelJson({ ...base, textProvider: "google-ai-studio", textModel: selected, textModelPool: [selected] });
      assert.equal(urls.length, 1); assert.ok(urls[0]!.endsWith(`/models/${selected}:generateContent`)); assert.ok(!urls[0]!.includes("preview"));
    });
    await t.test("an unavailable explicit model fails without using an environment fallback", async () => {
      const selected = "unsupported-selected-model"; const sent: string[] = [];
      globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(String(init?.body)).model); return new Response("model not found", { status: 404 }); };
      await assert.rejects(callTextModelJson({ ...base, textProvider: "deepseek", textModel: selected }), /failed|不可用|not found/i);
      assert.deepEqual(sent, [selected]);
    });
    await t.test("a rate-limited fixed singleton does not escape into the environment pool", async () => {
      const selected = "selected-fixed-singleton"; const sent: string[] = [];
      globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(String(init?.body)).model); return new Response("rate limit reached", { status: 429 }); };
      await assert.rejects(callTextModelJson({ ...base, textProvider: "deepseek", textModel: selected, textModelPool: [selected] }));
      assert.deepEqual(sent, [selected]);
    });
    await t.test("an explicitly configured multi-model pool stays inside that exact pool", async () => {
      const selected = "pool-selected"; const fallback = "pool-authorized-fallback"; const sent: string[] = [];
      globalThis.fetch = async (_url, init) => {
        const model = JSON.parse(String(init?.body)).model; sent.push(model);
        return model === selected ? new Response("rate limit reached", { status: 429 }) : chatResponse();
      };
      await callTextModelJson({ ...base, textProvider: "deepseek", textModel: selected, textModelPool: [selected, fallback] });
      assert.deepEqual(sent, [selected, fallback]);
    });
    await t.test("chat, Google and Responses reject a selected model missing from the fixed pool before fetching", async () => {
      let calls = 0; globalThis.fetch = async () => { calls++; return chatResponse(); };
      for (const textProvider of ["deepseek", "google-ai-studio", "openai-upstream"]) {
        await assert.rejects(callTextModelJson({ ...base, textProvider, textModel: "outside-pool", textModelPool: ["inside-pool"] }), /不在固定模型池/);
      }
      assert.equal(calls, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(dirname(temporaryStorage), resolve(process.cwd())); assert.ok(basename(temporaryStorage).startsWith(".text-model-test-"));
    await rm(temporaryStorage, { recursive: true, force: true });
  }
});
