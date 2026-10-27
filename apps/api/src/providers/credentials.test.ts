import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { providerEnvApiKey } from "./credentials.js";

test("catalog credential readiness agrees with generation credentials", async t => {
  const keys = [
    "AIFILM_LOAD_ENV_FILES", "OBJECT_STORAGE_LOCAL_DIR", "MANJIAO_TEXT_API_KEY", "MANJIAO_IMAGE_API_KEY",
    "DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "DASHSCOPE_TEXT_API_KEY", "BAILIAN_TEXT_API_KEY",
    "DASHSCOPE_TTS_API_KEY", "TTS_API_KEY", "DOUBAO_TEXT_API_KEY", "DOUBAO_API_KEY", "ARK_API_KEY",
    "VOLCENGINE_API_KEY", "OPENAI_API_KEY", "OPENAI_IMAGE_API_KEY", "OPENAI_COMPATIBLE_API_KEY"
  ];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  const root = await mkdtemp(join(tmpdir(), "manjiao-credentials-"));
  const originalFetch = globalThis.fetch;
  for (const key of keys) delete process.env[key];
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  process.env.OBJECT_STORAGE_LOCAL_DIR = root;
  const { mapProvider } = await import("../db/mappers.js");
  const { callTextModelJson } = await import("../agents/generator.js");
  const { generateDashScopeImage, generateImage } = await import("./dashscopeImage.js");
  const row = (id: string, modality: "text" | "image" | "video" | "tts") => ({
    id, name: id, modality, models: ["fixture-model"], enabled: true, apiKey: "", capability: {}
  });
  const chat = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ready":true}' } }] }));
  try {
    await t.test("Manjiao and DeepSeek environment keys enable the catalog and authenticate requests", async () => {
      for (const [id, key] of [["manjiao", "MANJIAO_TEXT_API_KEY"], ["deepseek", "DEEPSEEK_API_KEY"]]) {
        process.env[key!] = "fixture-text-0123";
        assert.equal((await mapProvider(row(id!, "text"))).apiKeyConfigured, true);
        let calls = 0;
        globalThis.fetch = async (url, init) => {
          calls++;
          assert.ok(String(url).startsWith("https://fixture.example.test/"));
          assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-text-0123");
          return chat();
        };
        const result = await callTextModelJson<{ ready: boolean }>({
          textProvider: id, textModel: "fixture-model", baseUrl: "https://fixture.example.test/v1",
          system: "Return JSON", prompt: "Test"
        });
        assert.equal(result.ready, true);
        assert.equal(calls, 1);
        delete process.env[key!];
      }
    });
    await t.test("Manjiao image environment key enables and authenticates the image route", async () => {
      process.env.MANJIAO_IMAGE_API_KEY = "fixture-image-4567";
      assert.equal((await mapProvider(row("manjiao-image", "image"))).apiKeyConfigured, true);
      globalThis.fetch = async (_url, init) => {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-image-4567");
        return new Response(JSON.stringify({ data: [{ url: "https://fixture.example.test/image.png" }] }));
      };
      const image = await generateImage({ provider: "manjiao-image", model: "gpt-image-2", prompt: "Test", baseUrl: "https://fixture.example.test" });
      assert.equal(image.imageUrl, "https://fixture.example.test/image.png");
    });
    await t.test("a TTS-only key cannot mark images or videos ready or authenticate an image request", async () => {
      process.env.DASHSCOPE_TTS_API_KEY = "fixture-tts-8910";
      assert.equal((await mapProvider(row("dashscope-tts", "tts"))).apiKeyConfigured, true);
      for (const id of ["dashscope-image", "dashscope-video"]) {
        assert.equal((await mapProvider(row(id, id.endsWith("image") ? "image" : "video"))).apiKeyConfigured, false);
      }
      let calls = 0; globalThis.fetch = async () => { calls++; return chat(); };
      await assert.rejects(generateDashScopeImage({ prompt: "Test" }), /Missing DASHSCOPE_API_KEY/);
      assert.equal(calls, 0);
      process.env.DASHSCOPE_API_KEY = "fixture-media-1112";
      assert.equal((await mapProvider(row("dashscope-image", "image"))).apiKeyPreview, "****1112");
      assert.equal((await mapProvider(row("dashscope-video", "video"))).apiKeyPreview, "****1112");
      assert.equal((await mapProvider(row("dashscope-tts", "tts"))).apiKeyPreview, "****8910");
    });
    await t.test("supported text and TTS fallback keys are reflected in catalog readiness", async () => {
      delete process.env.DASHSCOPE_API_KEY; delete process.env.DASHSCOPE_TTS_API_KEY;
      process.env.BAILIAN_TEXT_API_KEY = "fixture-bailian";
      process.env.DOUBAO_TEXT_API_KEY = "fixture-doubao";
      process.env.TTS_API_KEY = "fixture-tts";
      for (const [id, modality] of [["dashscope-text", "text"], ["doubao-text", "text"], ["dashscope-tts", "tts"]] as const) {
        assert.equal((await mapProvider(row(id, modality))).apiKeyConfigured, true);
      }
      assert.equal(providerEnvApiKey("doubao-seedream", "image"), "");
      process.env.TTS_API_KEY = " ";
      process.env.DASHSCOPE_TEXT_API_KEY = "fixture-text-fallback";
      assert.equal(providerEnvApiKey("dashscope-tts"), "fixture-text-fallback");
    });
    await t.test("OpenAI credentials follow modality priority and database keys remain authoritative", async () => {
      process.env.OPENAI_COMPATIBLE_API_KEY = "fixture-compatible-1314";
      process.env.OPENAI_API_KEY = "fixture-openai-1516";
      process.env.OPENAI_IMAGE_API_KEY = "fixture-image-1718";
      assert.equal((await mapProvider(row("openai-compatible", "text"))).apiKeyPreview, "****1314");
      assert.equal((await mapProvider(row("openai-compatible", "image"))).apiKeyPreview, "****1718");
      const mapped = await mapProvider({ ...row("manjiao-image", "image"), apiKey: "fixture-database-1920" });
      assert.equal(mapped.apiKeyPreview, "****1920");
      assert.equal("apiKey" in mapped, false);
      assert.equal((await mapProvider(row("unknown-route", "text"))).apiKeyConfigured, false);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
