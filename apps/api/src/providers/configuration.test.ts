import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("provider configuration and test results use the supplied server credentials", async (t) => {
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  process.env.OBJECT_STORAGE_LOCAL_DIR = await mkdtemp(join(tmpdir(), "aifilm-provider-test-"));
  const images = await import("./dashscopeImage.js");
  const videos = await import("./video.js");
  const originalFetch = globalThis.fetch;
  const originalMode = process.env.VIDEO_MODEL_TEST_MODE;
  try {
    await t.test("DashScope image uses database-supplied apiKey and baseUrl", async () => {
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        calls++;
        assert.ok(String(url).startsWith("https://stub.example.test/"));
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-image-key");
        return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image: "https://stub.example.test/image.png" }] } }] } }), { status: 200 });
      };
      const result = await images.generateDashScopeImage({ prompt: "Test", model: "qwen-image", modelPool: ["qwen-image"], apiKey: "fixture-image-key", baseUrl: "https://stub.example.test/api/v1" });
      assert.equal(result.imageUrl, "https://stub.example.test/image.png");
      assert.equal(calls, 1);
    });
    await t.test("image connection test forwards its apiKey to the adapter", async () => {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-relay-key");
        return new Response(JSON.stringify({ data: [{ b64_json: "dGVzdA==" }] }), { status: 200 });
      };
      const result = await images.testImageModelConnection({ provider: "manjiao", model: "gpt-image-2", baseUrl: "https://stub.example.test", apiKey: "fixture-relay-key" });
      assert.equal(result.ok, true);
      assert.equal(calls, 1);
    });
    await t.test("video config test accepts the supplied apiKey", async () => {
      process.env.VIDEO_MODEL_TEST_MODE = "config";
      const result = await videos.testVideoModelConnection({ provider: "doubao-seedance", model: "doubao-seedance-1-5-pro-251215", baseUrl: "https://stub.example.test/api/v3", apiKey: "fixture-video-key" });
      assert.equal(result.ok, true);
      assert.equal(result.mode, "config");
    });
    await t.test("a failed real video test cannot report success", async () => {
      process.env.VIDEO_MODEL_TEST_MODE = "real";
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-video-key");
        return new Response(JSON.stringify({ message: "Invalid test credential" }), { status: 401 });
      };
      const result = await videos.testVideoModelConnection({ provider: "doubao-seedance", model: "doubao-seedance-1-5-pro-251215", baseUrl: "https://stub.example.test/api/v3", apiKey: "fixture-video-key" });
      assert.equal(result.ok, false);
      assert.equal(result.mode, "failed");
      assert.equal(calls, 1);
    });
    await t.test("the upstream video task is checkpointed before polling", async () => {
      let persisted = false;
      process.env.DOUBAO_VIDEO_POLL_INTERVAL_MS = "1";
      globalThis.fetch = async (url, init) => {
        if (init?.method === "POST") return new Response(JSON.stringify({ id: "remote-test-job" }), { status: 200 });
        assert.equal(persisted, true);
        assert.ok(String(url).endsWith("/remote-test-job"));
        return new Response(JSON.stringify({ status: "succeeded", content: { video_url: "https://stub.example.test/final.mp4" } }), { status: 200 });
      };
      const result = await videos.generateVideo({ provider: "doubao-seedance", model: "doubao-seedance-1-5-pro-251215", modelPool: ["doubao-seedance-1-5-pro-251215"], prompt: "Test", baseUrl: "https://stub.example.test/api/v3", apiKey: "fixture-video-key", onTaskSubmitted: async (task) => { assert.equal(task.taskId, "remote-test-job"); persisted = true; } });
      assert.equal(result.status, "succeeded");
      assert.equal(persisted, true);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.VIDEO_MODEL_TEST_MODE; else process.env.VIDEO_MODEL_TEST_MODE = originalMode;
  }
});
