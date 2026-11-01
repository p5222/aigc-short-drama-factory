import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import test from "node:test";
import type { ModelModality, ProviderConnection } from "@aifilm/shared";

const databaseUrl = process.env.AIFILM_TEST_DATABASE_URL;
test("saved administrator configuration drives creation, references, shots, speech and a real MP4", { skip: !databaseUrl, timeout: 240000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  process.env.DATABASE_URL = databaseUrl;
  process.env.PLATFORM_SETTINGS_KEY = "73".repeat(32);
  const root = await mkdtemp(join(tmpdir(), "manjiao-configuration-pipeline-"));
  process.env.OBJECT_STORAGE_LOCAL_DIR = root;
  // These deliberately disagree with the administrator's saved configuration.
  process.env.DASHSCOPE_TTS_DEFAULT_VOICE = "wrong-environment-voice";
  process.env.DASHSCOPE_TTS_LANGUAGE_TYPE = "wrong-environment-language";
  const { prisma: db } = await import("../db/client.js");
  const repository = await import("../db/repository.js");
  const settings = await import("../config/platformSettings.js");
  const creator = await import("../content/creatorAgent.js");
  const { syncContentToProduction } = await import("../content/service.js");
  const shots = await import("../db/storyboardActions.js");
  const { probeFfmpeg } = await import("../export/videoComposer.js");
  const { persistVideoBuffer, readStoredAsset } = await import("../storage/objectStorage.js");
  const fetchOriginal = globalThis.fetch;
  const userId = `configuration_pipeline_${crypto.randomUUID()}`;
  const ids = Object.fromEntries(["text", "image", "video", "tts"].map(kind => [kind, `pipeline-${kind}-${crypto.randomUUID()}`]));
  const savedRouting = await db.platformSetting.findUnique({ where: { key: "routing" } });
  const calls: Array<{ kind: string; body: any; key: string | null }> = [];
  let expectedTextKey = "text-first-key", textResult: unknown;
  let videoUrl = "";
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lm1sAAAAASUVORK5CYII=";
  const wav = Buffer.alloc(44 + 4800);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(4800, 40);
  for (let offset = 44; offset < wav.length; offset += 2) wav.writeInt16LE(1000, offset);
  // Only the external provider transports are fixtures. No billing, persistence,
  // orchestration, audio alignment or FFmpeg implementation is substituted.
  const downloadMock = t.mock.method(https, "request", ((_url: URL, options: any, callback: (response: unknown) => void) => {
    assert.equal(options.hostname, "93.184.216.34");
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
    request.destroy = error => { request.emit("error", error); request.emit("close"); };
    request.end = () => queueMicrotask(() => {
      const response = Object.assign(Readable.from([wav]), { statusCode: 200, headers: { "content-type": "audio/wav" } });
      response.once("end", () => request.emit("close"));
      callback(response);
    });
    return request;
  }) as typeof https.request);
  syncBuiltinESMExports();
  globalThis.fetch = async (input, init) => {
    const target = new URL(String(input));
    assert.equal(target.hostname, "configuration-fixture.invalid");
    const kind = target.pathname.split("/")[1];
    const key = new Headers(init?.headers).get("authorization");
    const body = JSON.parse(String(init?.body));
    calls.push({ kind, body, key });
    assert.equal(body.model, `${kind}-model`);
    assert.equal(key, `Bearer ${kind === "text" ? expectedTextKey : `${kind}-saved-key`}`);
    const account = await db.creditAccount.findUniqueOrThrow({ where: { userId } });
    assert.ok(account.frozenBalance > 0, "reserve credits before contacting an upstream");
    let response: unknown;
    if (kind === "text") {
      assert.match(target.pathname, /chat\/completions$/);
      response = { choices: [{ message: { content: JSON.stringify(textResult) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } };
    } else if (kind === "image") {
      assert.match(target.pathname, /images\/generations$/);
      response = { data: [{ url: `data:image/png;base64,${png}` }] };
    } else if (kind === "video") {
      assert.match(target.pathname, /contents\/generations\/tasks$/);
      assert.match(body.content[0].text, /--duration 15/);
      assert.match(body.content[0].text, /--resolution 720p/);
      assert.match(body.content[1].image_url.url, /^data:image\//);
      response = { id: crypto.randomUUID(), status: "succeeded", content: { video_url: videoUrl } };
    } else {
      assert.equal(kind, "tts");
      assert.match(target.pathname, /multimodal-generation\/generation$/);
      response = { output: { audio: { url: "https://93.184.216.34/voice.wav" } } };
    }
    return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
  };
  let projectId = "", ffmpegBin = "";
  try {
    await t.test("administrator channels store encrypted keys and establish defaults", async () => {
      await db.user.create({ data: { id: userId, name: "Configuration pipeline fixture", credit: { create: { id: `credit_${userId}`, balance: 10000 } } } });
      const protocols: Record<string, ProviderConnection> = {
        text: { protocol: "openai-chat" }, image: { protocol: "seedream-image" },
        video: { protocol: "seedance-video", resolution: "720p" },
        tts: { protocol: "dashscope-tts", defaultVoice: "Cherry", language: "Chinese" }
      };
      for (const kind of ["text", "image", "video", "tts"] as ModelModality[]) {
        const result = await repository.createProvider({ id: ids[kind], name: `Pipeline ${kind}`, modality: kind,
          models: [`${kind}-model`], baseUrl: `https://configuration-fixture.invalid/${kind}`,
          apiKey: kind === "text" ? expectedTextKey : `${kind}-saved-key`, connection: protocols[kind], unitCredits: 2 });
        assert.equal(result.connectionSupported, true);
        const stored = await db.modelProvider.findUniqueOrThrow({ where: { id: ids[kind] } });
        assert.match(stored.apiKey!, /^enc:v1:/);
        assert.equal(JSON.stringify(result).includes(`${kind}-saved-key`), false);
      }
      const current = await settings.readPlatformSettings("routing");
      await settings.updatePlatformSettings("routing", { expectedVersion: current.version, values: {
        textProvider: ids.text, imageProvider: ids.image, videoProvider: ids.video, ttsProvider: ids.tts
      } }, userId);
      const providers = await repository.listProviders();
      for (const id of Object.values(ids)) assert.equal(providers.find(provider => provider.id === id)?.platformDefault, true);
    });
    const script = { title: "旧书店的信", synopsis: "修表师读到父亲留下的线索",
      script: "场景一：旧书店，日。阿青轻轻推门，门铃响起。他抚平信纸，凝视纸上的钟楼图案。\n阿青：原来你一直在等我。\n场景二：钟楼前，日。阿青握着怀表，钟声响起。他停下脚步，将信贴近胸口，然后坚定地走向钟楼。画面渐暗，钟声延续。\n旁白：回家的路就在眼前。",
      estimatedSeconds: 30, characters: [{ name: "阿青", identity: "修表师", appearance: "短发", costume: "蓝色外套", personality: "细心" }],
      scenes: [{ location: "旧书店", description: "旧书架和门铃", characters: ["阿青"] }], props: [], factUpdates: [],
      storyDesign: { goal: "寻找父亲线索", obstacle: "线索在旧信里", choice: "前往钟楼", payoff: "找到新的方向", beats: [
        { seconds: 15, action: "辨认旧信上的图案", evidence: "他抚平信纸，凝视纸上的钟楼图案。", spokenText: "原来你一直在等我。" },
        { seconds: 15, action: "走向钟楼", evidence: "他停下脚步，将信贴近胸口，然后坚定地走向钟楼。", spokenText: "回家的路就在眼前。" }
      ] } };
    await t.test("creator execution and handoff preserve all saved routes and later default changes cannot overwrite them", async () => {
      const selected = await settings.applyDefaultModelRoutes({ textProvider: undefined, textModel: undefined });
      const content = await creator.createShortProject(userId, { requestId: crypto.randomUUID(), title: script.title,
        brief: { format: "short", material: "idea", intent: "一位修表师寻找父亲留下的信", durationSeconds: 30 },
        textProvider: selected.textProvider, textModel: selected.textModel });
      const quote = await creator.quoteCreatorRun(userId, content.id, { maxCalls: 1 });
      const run = await creator.createCreatorRun(userId, content.id, { requestId: crypto.randomUUID(), expectedRevision: quote.inputRevision, maximumCredits: quote.maximumCredits, maxCalls: 1 });
      textResult = script;
      const state = await creator.executeCreatorRun(userId, content.id, run.id);
      assert.equal(state.runs[0].status, "awaiting_review", JSON.stringify(state.scripts[0]?.findings));
      await creator.reviewCreatorScript(userId, content.id, { expectedScriptId: state.scripts[0].id, expectedRevision: state.revision, content: state.scripts[0].content, approve: true });
      projectId = await syncContentToProduction(userId, content.id);
      const production = await db.project.findUniqueOrThrow({ where: { id: projectId } });
      assert.equal(production.textProvider, ids.text); assert.equal(production.imageProvider, ids.image); assert.equal(production.videoProvider, ids.video);
      const current = await settings.readPlatformSettings("routing");
      await settings.updatePlatformSettings("routing", { expectedVersion: current.version, values: { imageProvider: "", videoProvider: "" } }, userId);
      await syncContentToProduction(userId, content.id);
      assert.equal((await db.project.findUniqueOrThrow({ where: { id: projectId } })).imageProvider, ids.image);
    });
    await t.test("rotated text key applies to real storyboard orchestration; reference images reach the image protocol", async () => {
      expectedTextKey = "text-rotated-key";
      await repository.updateProvider(ids.text, { apiKey: expectedTextKey });
      textResult = { storyboards: [1, 2].map((n) => ({
        episodeNo: 1, sceneNo: n, shotNo: n, duration: 15, shotSize: "全景", cameraAngle: "平视", cameraMovement: "固定",
        characters: ["阿青"], scene: n === 1 ? "旧书店" : "钟楼", pictureDesc: n === 1 ? "阿青凝视信纸" : "阿青走向钟楼",
        action: "凝视", orientation: "朝右", spatialRelation: "站在中央", emotion: "平静",
        dialogue: n === 1 ? "阿青：原来你一直在等我。" : "", voiceOver: n === 2 ? "旁白：回家的路就在眼前。" : "",
        environmentSound: "钟声", soundEffect: "", imagePrompt: "旧书店里的阿青，日光", videoPrompt: "阿青缓慢移动，固定机位"
      })) };
      assert.equal((await shots.runProjectStoryboardTasks(projectId, userId, { mode: "director" })).assetsCreated, 2);
      assert.deepEqual((await repository.getProjectWorkflow(projectId, userId))!.storyboards.map(shot => shot.duration), [15, 15]);
      assert.ok((await shots.generateCharacterReferenceImages(projectId, userId)).assetsCreated > 0);
      assert.equal((await repository.runProjectImageTasks(projectId, userId)).assetsCreated, 2);
      assert.ok(calls.filter(call => call.kind === "image").some(call => call.body.image), "shot images must carry the generated role reference");
      assert.equal(calls.filter(call => call.kind === "text").at(-1)?.key, `Bearer ${expectedTextKey}`);
    });
    await t.test("video uses the saved resolution, persists paid outputs and does not resubmit completed shots", async () => {
      const ffmpeg = await probeFfmpeg(); assert.equal(ffmpeg.ready, true); ffmpegBin = ffmpeg.bin;
      const source = join(root, "provider-video.mp4");
      await promisify(execFile)(ffmpeg.bin, ["-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=15", "-c:v", "mpeg4", "-pix_fmt", "yuv420p", source], { timeout: 30000 });
      videoUrl = await persistVideoBuffer(await readFile(source), "upstream-fixture");
      const generated = await repository.runProjectVideoTasks(projectId, userId);
      assert.equal(generated.assetsCreated, 2, JSON.stringify(generated));
      assert.equal(calls.filter(call => call.kind === "video").length, 2);
      await assert.rejects(repository.runProjectVideoTasks(projectId, userId), /没有可生成/);
      assert.equal(calls.filter(call => call.kind === "video").length, 2);
    });
    await t.test("custom TTS defaults, explicit character voice and paid cache survive a real MP4 export", async () => {
      await db.character.updateMany({ where: { projectId, name: "阿青" }, data: { voiceId: "Ethan" } });
      const quote = await repository.quoteProjectExport(projectId, userId, "video_export");
      assert.equal(quote.providerId, ids.tts); assert.ok(quote.estimatedCredits > 0);
      const result = await repository.createProjectExportJob(projectId, userId, "video_export", undefined, quote.estimatedCredits);
      assert.equal(result.status, "succeeded", JSON.stringify(result));
      assert.ok(result.outputUrl);
      const tts = calls.filter(call => call.kind === "tts");
      assert.deepEqual(tts.map(call => call.body.input.voice), ["Ethan", "Cherry"]);
      assert.deepEqual(tts.map(call => call.body.input.language_type), ["Chinese", "Chinese"]);
      const ffprobe = isAbsolute(ffmpegBin) ? resolve(dirname(ffmpegBin), process.platform === "win32" ? "ffprobe.exe" : "ffprobe") : "ffprobe";
      const probe = await promisify(execFile)(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json",
        join(root, result.outputUrl!.replace(/^\/storage\//, ""))], { timeout: 30000 });
      assert.deepEqual(JSON.parse(probe.stdout).streams.map((stream: { codec_type: string }) => stream.codec_type).sort(), ["audio", "subtitle", "video"]);
      const audio = await db.asset.findFirstOrThrow({ where: { projectId, type: "audio" } });
      assert.ok((await readStoredAsset(audio.referenceUrl!)).length > wav.length);
      const manifest = JSON.parse((await readStoredAsset(JSON.parse(audio.description).audio.manifestUrl)).toString());
      assert.equal(manifest.provider, ids.tts); assert.doesNotMatch(manifest.note, /占位/);
      assert.equal((await repository.quoteProjectExport(projectId, userId, "video_export")).estimatedCredits, 0);
      const replay = await repository.createProjectExportJob(projectId, userId, "tts");
      assert.equal(replay.status, "succeeded");
      assert.equal(calls.filter(call => call.kind === "tts").length, 2);
      await repository.updateProvider(ids.tts, { connection: { protocol: "dashscope-tts", defaultVoice: "Serena", language: "English" } });
      const changed = await repository.quoteProjectExport(projectId, userId, "tts");
      assert.equal(changed.cached, false);
      const revised = await repository.createProjectExportJob(projectId, userId, "tts", undefined, changed.estimatedCredits);
      assert.equal(revised.status, "succeeded");
      assert.deepEqual(calls.filter(call => call.kind === "tts").slice(2).map(call => [call.body.input.voice, call.body.input.language_type]), [["Ethan", "English"], ["Serena", "English"]]);
      const account = await db.creditAccount.findUniqueOrThrow({ where: { userId } });
      assert.equal(account.frozenBalance, 0);
      const spent = await db.creditTransaction.findMany({ where: { userId, type: "consume" } });
      assert.equal(10000 - account.balance, spent.reduce((total, item) => total + Math.abs(item.amount), 0));
      const metadata = await db.generationTask.findMany({ where: { userId } });
      assert.doesNotMatch(JSON.stringify(metadata), /text-rotated-key|tts-saved-key|image-saved-key|video-saved-key/);
    });
  } finally {
    globalThis.fetch = fetchOriginal;
    downloadMock.mock.restore(); syncBuiltinESMExports();
    if (savedRouting) await db.platformSetting.upsert({ where: { key: "routing" }, create: savedRouting as any, update: { values: savedRouting.values!, version: savedRouting.version, updatedBy: savedRouting.updatedBy, updatedAt: savedRouting.updatedAt } });
    else await db.platformSetting.deleteMany({ where: { key: "routing" } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.modelPrice.deleteMany({ where: { providerId: { in: Object.values(ids) } } });
    await db.modelProvider.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await db.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
});
