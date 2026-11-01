import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("custom channel IDs use declared protocols without borrowing credentials or changing billed inputs", async t => {
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const root = await mkdtemp(join(tmpdir(), "manjiao-protocols-"));
  process.env.OBJECT_STORAGE_LOCAL_DIR = root;
  process.env.DEEPSEEK_API_KEY = "must-not-borrow";
  process.env.DASHSCOPE_API_KEY = "must-not-borrow-media";
  process.env.DOUBAO_VIDEO_POLL_INTERVAL_MS = "1";
  const originalFetch = globalThis.fetch;
  const { callTextModelJson, testTextModelConnection } = await import("../agents/generator.js");
  const { generateImage } = await import("./dashscopeImage.js");
  const { generateVideo, queryVideoTaskResult, videoBillingInput, videoRuntimeSnapshot } = await import("./video.js");
  const { getProviderQuotaSnapshot } = await import("./modelQuota.js");
  const connection = { protocol: "seedance-video" as const, resolution: "720p" as const };
  try {
    await t.test("unknown and mismatched protocols fail before any request", async () => {
      let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("must not call"); };
      await assert.rejects(callTextModelJson({ textProvider: "private-story", textModel: "author-v1", system: "test", prompt: "test" }), /协议/);
      await assert.rejects(generateImage({ provider: "private-picture", prompt: "test" }), /协议/);
      await assert.rejects(generateVideo({ provider: "private-video", prompt: "test" }), /协议/);
      await assert.rejects(generateImage({ provider: "private-picture", model: "image-v1", baseUrl: "https://fixture.invalid/v1", connection: { protocol: "openai-chat" }, prompt: "test" }), /协议/);
      await assert.rejects(callTextModelJson({ textProvider: "private-story", textModel: "author-v1", connection: { protocol: "openai-chat" }, baseUrl: "https://fixture.invalid/v1", system: "test", prompt: "test" }), /API key/);
      await assert.rejects(testTextModelConnection({ textProvider: "private-story", textModel: "author-v1", connection: { protocol: "openai-chat" }, baseUrl: "https://fixture.invalid/v1" }), /API Key/);
      assert.equal(calls, 0);
    });
    await t.test("chat, Responses and Gemini retain each custom channel's key and exact model", async () => {
      for (const protocol of ["openai-chat", "openai-responses", "gemini-text"] as const) {
        for (const apiKey of ["saved-key-one", "rotated-key-two"]) {
          let calls = 0;
          globalThis.fetch = async (url, init) => {
            calls++;
            const payload = JSON.parse(String(init?.body));
            const headers = new Headers(init?.headers);
            assert.equal(headers.get(protocol === "gemini-text" ? "x-goog-api-key" : "authorization"), protocol === "gemini-text" ? apiKey : `Bearer ${apiKey}`);
            assert.match(String(url), protocol === "gemini-text" ? /models\/author-v1:generateContent$/ : protocol === "openai-responses" ? /\/responses$/ : /\/chat\/completions$/);
            if (protocol !== "gemini-text") assert.equal(payload.model, "author-v1");
            return new Response(JSON.stringify(protocol === "gemini-text" ? { candidates: [{ content: { parts: [{ text: '{"ready":true}' }] } }] }
              : protocol === "openai-responses" ? { output_text: '{"ready":true}' } : { choices: [{ message: { content: '{"ready":true}' } }] }));
          };
          const result = await callTextModelJson<{ ready: boolean }>({ textProvider: `private-${protocol}`, textModel: "author-v1",
            connection: { protocol }, apiKey, baseUrl: "https://fixture.invalid/v1", singleSubmission: true, system: "test", prompt: "test" });
          assert.equal(result.ready, true); assert.equal(calls, 1);
        }
      }
    });
    await t.test("custom image protocol sends its saved model, key, dimensions and quality", async () => {
      globalThis.fetch = async (url, init) => {
        assert.equal(String(url), "https://fixture.invalid/v1/images/generations");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer custom-image-key");
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.model, "gpt-image-private"); assert.equal(payload.size, "1024x1536"); assert.equal(payload.quality, "high");
        return new Response(JSON.stringify({ data: [{ url: "https://fixture.invalid/image.png" }] }));
      };
      const image = await generateImage({ provider: "custom-studio", connection: { protocol: "openai-image" }, model: "gpt-image-private",
        apiKey: "custom-image-key", baseUrl: "https://fixture.invalid/v1", size: "1024x1536", quality: "high", prompt: "test" });
      assert.equal(image.model, "gpt-image-private"); assert.equal(image.provider, "custom-studio"); assert.ok(image.imageUrl);
    });
    await t.test("video quote, payload, checkpoint and resume share channel identity and normalized input", async () => {
      let checkpoint = false, submissions = 0;
      globalThis.fetch = async (url, init) => {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer custom-video-key");
        if (init?.method === "POST") {
          submissions++;
          const payload = JSON.parse(String(init.body));
          assert.equal(payload.model, "ep-private");
          assert.match(payload.content[0].text, /--duration 15/); assert.match(payload.content[0].text, /--resolution 720p/);
          assert.doesNotMatch(payload.content[0].text, /--duration 90|--resolution 1080p/);
          return new Response(JSON.stringify({ id: "original-task" }));
        }
        assert.equal(checkpoint, true); assert.match(String(url), /tasks\/original-task$/);
        return new Response(JSON.stringify({ status: "succeeded", content: { video_url: "https://fixture.invalid/final.mp4" } }));
      };
      const input = { provider: "custom-film", model: "ep-private", connection, apiKey: "custom-video-key", baseUrl: "https://fixture.invalid/api/v3" };
      assert.deepEqual(videoBillingInput(input.provider, 30, "9:16", connection), { seconds: 15, resolution: "720p" });
      const snapshot = videoRuntimeSnapshot(input);
      assert.equal(JSON.stringify(snapshot).includes("custom-video-key"), false);
      const result = await generateVideo({ ...input, prompt: "test --duration 90 --resolution 1080p", duration: 30, onTaskSubmitted: async remote => {
        assert.deepEqual(remote, { taskId: "original-task", provider: "custom-film", model: "ep-private" }); checkpoint = true;
      } });
      assert.equal(result.status, "succeeded");
      assert.equal((await queryVideoTaskResult({ ...input, ...snapshot, taskId: "original-task" })).status, "succeeded");
      assert.equal(submissions, 1);
      assert.equal((await getProviderQuotaSnapshot("custom-film", ["ep-private"]))[0].submissions, 1);
      assert.equal((await getProviderQuotaSnapshot("doubao-seedance", ["ep-private"]))[0].submissions, 0);
    });
    await t.test("Gemini, Qwen and Seedream preserve reference images in their own wire formats", async () => {
      const reference = "data:image/png;base64,aW1hZ2UtZml4dHVyZQ==";
      for (const protocol of ["gemini-image", "dashscope-image", "seedream-image"] as const) {
        globalThis.fetch = async (_url, init) => {
          const payload = JSON.parse(String(init?.body));
          if (protocol === "gemini-image") {
            assert.deepEqual(payload.input, [{ type: "image", mime_type: "image/png", data: "aW1hZ2UtZml4dHVyZQ==" }, { type: "text", text: "keep identity" }]);
            return new Response(JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "b3V0cHV0" }] }] }));
          }
          if (protocol === "dashscope-image") {
            assert.deepEqual(payload.input.messages[0].content, [{ image: reference }, { text: "keep identity" }]);
            return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image: "https://fixture.invalid/output.png" }] } }] } }));
          }
          assert.equal(payload.image, reference);
          return new Response(JSON.stringify({ data: [{ url: "https://fixture.invalid/output.png" }] }));
        };
        const result = await generateImage({ provider: `private-${protocol}`, model: protocol === "dashscope-image" ? "qwen-image-2.0" : "private-image",
          connection: { protocol }, baseUrl: "https://fixture.invalid/v1", apiKey: "saved", prompt: "keep identity", referenceImageUrls: [reference] });
        assert.ok(result.imageUrl);
      }
    });
    await t.test("unsupported reference-image edits stop instead of silently discarding the reference", async () => {
      let calls = 0; globalThis.fetch = async () => { calls++; return new Response("not supported", { status: 404 }); };
      const input = { provider: "custom-edits", model: "gpt-image-private", baseUrl: "https://fixture.invalid/v1", apiKey: "saved", prompt: "keep identity", referenceImageUrls: ["data:image/png;base64,aW1hZ2U="] };
      await assert.rejects(generateImage({ ...input, connection: { protocol: "openai-image" } }), /参考图编辑/);
      assert.equal(calls, 1);
      calls = 0;
      await assert.rejects(generateImage({ ...input, model: "qwen-image", connection: { protocol: "dashscope-image" } }), /不接受参考图/);
      assert.equal(calls, 0);
    });
    await t.test("plugin catalog never marks an unwired protocol ready from an API key", async () => {
      process.env.OPENAI_API_KEY = "fixture";
      const { listVisualPipelines, testVisualPipeline } = await import("./visualPipelineRegistry.js");
      assert.equal(listVisualPipelines().find(item => item.id === "sora")?.status, "not_integrated");
      assert.equal((await testVisualPipeline("sora")).ok, false);
    });
    await t.test("a successful HTTP response with unreadable content never triggers a second paid request", async () => {
      let calls = 0; globalThis.fetch = async () => { calls++; return new Response("not-json", { status: 200 }); };
      await assert.rejects(callTextModelJson({ textProvider: "private-story", textModel: "author-v1", connection: { protocol: "openai-chat" },
        baseUrl: "https://fixture.invalid", apiKey: "saved", system: "test", prompt: "test" }), /unknown|unreadable/);
      assert.equal(calls, 1); calls = 0;
      await assert.rejects(generateImage({ provider: "private-picture", model: "image-v1", connection: { protocol: "openai-image" },
        baseUrl: "https://fixture.invalid", apiKey: "saved", prompt: "test" }), /unknown|unreadable/);
      assert.equal(calls, 1);
    });
  } finally { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});
