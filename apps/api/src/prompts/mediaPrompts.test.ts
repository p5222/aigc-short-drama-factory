import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";

const databaseUrl = process.env.AIFILM_TEST_COMMERCE_DATABASE_URL;
test("production media handlers submit activated prompts and retain snapshots with their tasks", { skip: !databaseUrl, timeout: 90000 }, async () => {
  const url = new URL(databaseUrl!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_commerce_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false"; process.env.DATABASE_URL = databaseUrl;
  const storage = await mkdtemp(join(tmpdir(), "craft-media-prompts-"));
  process.env.OBJECT_STORAGE_LOCAL_DIR = storage;
  process.env.DASHSCOPE_VIDEO_SUBMIT_POLL_TIMEOUT_MS = "0";
  const { prisma: db } = await import("../db/client.js");
  const prompts = await import("./production.js");
  const actions = await import("../db/storyboardActions.js");
  const { runProjectVideoTasks } = await import("../db/repository.js");
  const userId = `craft_user_${crypto.randomUUID()}`, projectId = `craft_project_${crypto.randomUUID()}`, characterId = `craft_character_${crypto.randomUUID()}`, shotId = `craft_shot_${crypto.randomUUID()}`;
  const keys = ["character_identity_board", "scene_environment_image", "prop_reference_image", "storyboard_first_frame", "shot_motion"];
  const providerIds = ["openai-compatible", "dashscope-video"];
  const originals = await db.modelProvider.findMany({ where: { id: { in: providerIds } } });
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const png = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#778899" } }).png().toBuffer()).toString("base64");
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /^https:\/\/craft-fixture\.invalid\//);
    if (String(input).includes("video-synthesis")) {
      requests.push(JSON.parse(String(init?.body)).input.prompt);
      return new Response(JSON.stringify({ output: { task_id: "craft-remote-task", task_status: "PENDING" } }));
    }
    requests.push(init?.body instanceof FormData ? String(init.body.get("prompt")) : JSON.parse(String(init?.body)).prompt);
    return new Response(JSON.stringify({ data: [{ b64_json: png }] }));
  };
  try {
    await db.user.create({ data: { id: userId, name: "Creative media fixture", credit: { create: { id: `credit_${userId}`, balance: 10000 } } } });
    for (const [index, id] of providerIds.entries()) {
      const data = { name: "Fixture provider", modality: index ? "video" : "image", models: ["craft-fixture-model"], enabled: true, baseUrl: "https://craft-fixture.invalid/v1", apiKey: "fixture-only", capability: {}, costHint: "test" };
      await db.modelProvider.upsert({ where: { id }, create: { id, ...data }, update: data });
      await db.modelPrice.create({ data: { id: `${userId}_price_${index}`, providerId: id, providerName: "Fixture provider", model: "craft-fixture-model", modality: data.modality, unit: index ? "video_second" : "image", unitCredits: 1 } });
    }
    await db.project.create({ data: { id: projectId, userId, name: "Creative media fixture", type: "test", sourceType: "script", artStyle: "二维", videoRatio: "9:16", status: "asseting",
      imageProvider: providerIds[0], imageModel: "craft-fixture-model", videoProvider: providerIds[1], videoModel: "craft-fixture-model" } });
    await db.character.create({ data: { id: characterId, projectId, name: "阿青", identity: "店员", appearance: "短发", costume: "绿围裙", personality: "细心", prompt: "短发店员", negativePrompt: "" } });
    await db.asset.createMany({ data: [
      { id: `role_${characterId}`, projectId, type: "role", name: "阿青", description: "店员", prompt: "短发店员", status: "pending", relatedCharacterId: characterId },
      ...["scene", "prop"].map(type => ({ id: `${type}_${projectId}`, projectId, type, name: type === "scene" ? "店门" : "饭盒", description: "已确认资料", prompt: "已确认外观", status: "pending" }))
    ] });
    await db.storyboard.create({ data: { id: shotId, projectId, episodeNo: 1, sceneNo: 1, shotNo: 1, duration: 5, shotSize: "中景", cameraAngle: "平视", cameraMovement: "固定", characters: ["阿青"], scene: "店门", pictureDesc: "店员托着饭盒", dialogue: "", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: "饭盒尚未放下", videoPrompt: "慢慢放下饭盒", referenceAssetIds: [], status: "pending" } });
    for (const key of keys) {
      const detail = await prompts.getProductionPrompt(key);
      const saved = await prompts.saveProductionPrompt(key, { systemPrompt: `${detail.builtin.systemPrompt}\nACTIVE_${key}`, userTemplate: detail.builtin.userTemplate, expectedRevision: detail.revision, requestId: crypto.randomUUID(), notes: "真实处理器夹具回归" }, userId);
      await prompts.activateProductionPrompt(key, { versionId: saved.id, expectedRevision: detail.revision });
    }
    await actions.generateCharacterReferenceImages(projectId, userId);
    await actions.generateSceneEnvironmentImage(projectId, `scene_${projectId}`, userId);
    await actions.generateSceneEnvironmentImage(projectId, `prop_${projectId}`, userId);
    await actions.regenerateStoryboardShotImage(projectId, shotId, userId);
    // Keep this transport test independent of public signed-media hosting.
    await db.asset.update({ where: { id: `image_${shotId}` }, data: { referenceUrl: "https://media-fixture.invalid/first.png" } });
    const pending = await runProjectVideoTasks(projectId, userId, { storyboardIds: [shotId] });
    assert.equal(pending.task.status, "pending");
    assert.equal(requests.length, keys.length);
    for (const [index, key] of keys.entries()) {
      assert.ok(requests[index].includes(`ACTIVE_${key}`), `${key} must reach the provider`);
      assert.doesNotMatch(requests[index], /输出字段约束/);
      const event = await db.analyticsEvent.findFirstOrThrow({ where: { entityId: key, taskId: { in: (await db.generationTask.findMany({ where: { projectId }, select: { id: true } })).map(task => task.id) } } });
      assert.match(String((event.properties as Record<string, unknown>).systemPrompt), new RegExp(`ACTIVE_${key}`));
    }
    assert.match(requests[4], /5秒|5 秒/);
    assert.match(requests[4], /慢慢放下饭盒/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      const current = await prompts.getProductionPrompt(key);
      await prompts.activateProductionPrompt(key, { versionId: null, expectedRevision: current.revision });
    }
    await db.productionPromptVersion.deleteMany({ where: { owner: userId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.modelPrice.deleteMany({ where: { id: { startsWith: `${userId}_price_` } } });
    for (const id of providerIds) {
      const old = originals.find(row => row.id === id);
      if (old) { const { id: _, createdAt, updatedAt, ...data } = old; await db.modelProvider.update({ where: { id }, data: { ...data, capability: data.capability as object } }); }
      else await db.modelProvider.delete({ where: { id } });
    }
    await db.$disconnect();
    await rm(storage, { recursive: true, force: true });
  }
});
