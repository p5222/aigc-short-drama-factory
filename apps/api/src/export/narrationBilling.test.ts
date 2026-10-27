import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import type { ProjectWorkflow } from "@aifilm/shared";

const databaseUrl = process.env.AIFILM_TEST_DATABASE_URL;
test("PostgreSQL narration exports reserve, settle and reuse paid speech", { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const temporaryStorage = await mkdtemp(resolve(process.cwd(), ".narration-test-"));
  process.env.OBJECT_STORAGE_LOCAL_DIR = temporaryStorage;
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const { getOrCreatePaidNarration, quoteProjectNarration } = await import("./narrationBilling.js");
  const { createTtsAudioAsset, composeVideoExport, probeFfmpeg } = await import("./videoComposer.js");
  const { readStoredAsset, persistVideoBuffer } = await import("../storage/objectStorage.js");
  const originalProvider = await db.modelProvider.findUnique({ where: { id: "dashscope-tts" } });
  const model = `test-model-${crypto.randomUUID()}`;
  const priceId = `narration_price_${crypto.randomUUID()}`;
  const users: string[] = [];
  await db.modelProvider.upsert({ where: { id: "dashscope-tts" }, create: { id: "dashscope-tts", name: "Test narration", modality: "tts", models: [model], apiKey: "test-only-db-key", baseUrl: "https://tts.invalid/api/v1", enabled: true, capability: {}, costHint: "Test" },
    update: { enabled: true, modality: "tts", models: [model], apiKey: "test-only-db-key", baseUrl: "https://tts.invalid/api/v1", capability: {} } });
  await db.modelPrice.create({ data: { id: priceId, providerId: "dashscope-tts", providerName: "Test narration", modality: "tts", model, unit: "tts_character", unitCredits: 2 } });
  async function fixture(dialogue = "甲：你好😀", balance = 100) {
    const userId = `narration_user_${crypto.randomUUID()}`; users.push(userId);
    await db.user.create({ data: { id: userId, name: "Narration test", credit: { create: { id: `credit_${userId}`, balance } } } });
    const project = await db.project.create({ data: { id: `narration_project_${crypto.randomUUID()}`, userId, name: "Narration test", type: "test", sourceType: "idea", artStyle: "test", videoRatio: "9:16", status: "rendering" } });
    const workflow = { project, characters: [], assets: [], tasks: [], storyboards: [{ id: "shot-one", dialogue, voiceOver: "", characters: [], duration: 15, episodeNo: 1, sceneNo: 1, shotNo: 1 }] } as unknown as ProjectWorkflow;
    return { workflow, userId, account: () => db.creditAccount.findUniqueOrThrow({ where: { userId } }) };
  }
  const wav = (seconds = 0.1) => {
    const sampleRate = 24000; const bytes = Math.floor(seconds * sampleRate) * 2;
    const buffer = Buffer.alloc(44 + bytes); buffer.write("RIFF"); buffer.writeUInt32LE(36 + bytes, 4); buffer.write("WAVEfmt ", 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(bytes, 40);
    for (let offset = 44; offset < buffer.length; offset += 2) buffer.writeInt16LE(1000, offset);
    return buffer;
  };
  try {
    await t.test("quote counts actual spoken Unicode characters; DB config and reservation precede requests", async () => {
      const f = await fixture(); let calls = 0;
      const quote = await quoteProjectNarration(f.workflow, f.userId, db);
      assert.equal(quote.characters, 3); assert.equal(quote.estimatedCredits, 6); assert.equal(quote.model, model);
      const audio = await getOrCreatePaidNarration(f.workflow, f.userId, db, { maximumCredits: 6, synthesize: (workflow, runtime) => createTtsAudioAsset(workflow, runtime, { requestCue: async (configured, text) => {
        calls += 1; assert.equal(configured.apiKey, "test-only-db-key"); assert.equal(configured.baseUrl, "https://tts.invalid/api/v1"); assert.equal(configured.model, model); assert.equal(text, "你好😀");
        assert.equal((await f.account()).frozenBalance, 6);
        assert.equal(await db.generationTask.count({ where: { userId: f.userId, status: "running", type: "tts" } }), 1);
        return wav();
      } }) });
      assert.equal((await f.account()).balance, 94); assert.equal((await f.account()).frozenBalance, 0);
      const data = await readStoredAsset(audio.audioUrl);
      assert.equal(data.length, 44 + 15 * 24000 * 2, "A fifteen-second cue must not overflow JS argument limits");
      assert.equal((await quoteProjectNarration(f.workflow, f.userId, db)).estimatedCredits, 0);
      const reused = await getOrCreatePaidNarration(f.workflow, f.userId, db, { synthesize: async () => { calls += 1; throw new Error("Should reuse paid narration"); } });
      assert.equal(reused.audioUrl, audio.audioUrl); assert.equal(calls, 1);
      assert.equal(await db.creditTransaction.count({ where: { userId: f.userId, type: "consume" } }), 1);
      await db.modelProvider.update({ where: { id: "dashscope-tts" }, data: { enabled: false } });
      try { assert.equal((await getOrCreatePaidNarration(f.workflow, f.userId, db)).audioUrl, audio.audioUrl); }
      finally { await db.modelProvider.update({ where: { id: "dashscope-tts" }, data: { enabled: true } }); }
    });
    await t.test("failed models release reservations and cannot turn a placeholder into a paid success", async () => {
      const f = await fixture();
      await assert.rejects(getOrCreatePaidNarration(f.workflow, f.userId, db, { maximumCredits: 6, synthesize: async () => { throw new Error("Provider offline"); } }), /Provider offline/);
      assert.equal((await f.account()).balance, 100); assert.equal((await f.account()).frozenBalance, 0);
      assert.equal(await db.asset.count({ where: { projectId: f.workflow.project.id } }), 0);
      await assert.rejects(getOrCreatePaidNarration(f.workflow, f.userId, db, { maximumCredits: 6, synthesize: async () => ({ audioUrl: "/storage/audio/fake.wav", manifestUrl: "/storage/exports/fake.json", durationSeconds: 15, cueCount: 1, provider: "scratch-local-wav", ext: "wav", warnings: [] }) }), /占位配音/);
      assert.equal((await f.account()).balance, 100); assert.equal((await f.account()).frozenBalance, 0);
    });
    await t.test("changed quote or insufficient balance stops before an upstream call", async () => {
      const f = await fixture("你好", 3); let calls = 0;
      const synthesize = async () => { calls += 1; throw new Error("Must not call"); };
      await assert.rejects(getOrCreatePaidNarration(f.workflow, f.userId, db, { maximumCredits: 3, synthesize }), /重新获取报价/);
      await assert.rejects(getOrCreatePaidNarration(f.workflow, f.userId, db, { maximumCredits: 4, synthesize }), /不足/);
      assert.equal(calls, 0); assert.equal(await db.generationTask.count({ where: { userId: f.userId } }), 0);
    });
    await t.test("invalid audio headers fail promptly instead of entering an unbounded sample loop", async () => {
      const f = await fixture(); const malformed = wav(); malformed.writeUInt16LE(0, 22);
      await assert.rejects(getOrCreatePaidNarration(f.workflow, f.userId, db, { maximumCredits: 6, synthesize: (workflow, runtime) => createTtsAudioAsset(workflow, runtime, { requestCue: async () => malformed }) }), /PCM/);
      assert.equal((await f.account()).balance, 100); assert.equal((await f.account()).frozenBalance, 0);
    });
    await t.test("concurrent exports share a lease and do not pay for the same narration twice", async () => {
      const f = await fixture(); let started!: () => void; let release!: () => void; let calls = 0;
      const began = new Promise<void>(resolve => { started = resolve; }); const finish = new Promise<void>(resolve => { release = resolve; });
      const synthesize = (workflow: ProjectWorkflow, runtime: Parameters<typeof createTtsAudioAsset>[1]) => createTtsAudioAsset(workflow, runtime, { requestCue: async () => { calls += 1; started(); await finish; return wav(); } });
      const first = getOrCreatePaidNarration(f.workflow, f.userId, db, { maximumCredits: 6, synthesize });
      await began;
      try { await assert.rejects(getOrCreatePaidNarration(f.workflow, f.userId, db, { maximumCredits: 6, synthesize }), /正在生成/); }
      finally { release(); }
      await first; assert.equal(calls, 1); assert.equal((await f.account()).balance, 94);
    });
    await t.test("silent shots remain on the timeline, and long speech is never truncated", async () => {
      const f = await fixture("", 100);
      f.workflow.storyboards.push({ ...f.workflow.storyboards[0]!, id: "shot-two", dialogue: "你好", duration: 1 });
      const audio = await getOrCreatePaidNarration(f.workflow, f.userId, db, { maximumCredits: 4, synthesize: (workflow, runtime) => createTtsAudioAsset(workflow, runtime, { requestCue: async () => wav() }) });
      const data = await readStoredAsset(audio.audioUrl);
      assert.equal(data.readInt16LE(44), 0); assert.equal(data.readInt16LE(44 + 15 * 24000 * 2), 1000); assert.equal(data.length, 44 + 16 * 24000 * 2);
      const long = await fixture("太长的对白"); long.workflow.storyboards[0]!.duration = 1;
      await assert.rejects(getOrCreatePaidNarration(long.workflow, long.userId, db, { maximumCredits: 20, synthesize: (workflow, runtime) => createTtsAudioAsset(workflow, runtime, { requestCue: async () => wav(2) }) }), /超过/);
      assert.equal((await long.account()).balance, 100); assert.equal((await long.account()).frozenBalance, 0);
    });
    await t.test("edited dialogue receives a new quote and a missing paid file does not trigger rebilling", async () => {
      const f = await fixture();
      await getOrCreatePaidNarration(f.workflow, f.userId, db, { maximumCredits: 6, synthesize: (workflow, runtime) => createTtsAudioAsset(workflow, runtime, { requestCue: async () => wav() }) });
      await assert.rejects(getOrCreatePaidNarration(f.workflow, f.userId, db, { verifyAudio: async () => { throw new Error("File missing"); } }), /恢复存储备份/);
      f.workflow.storyboards[0]!.dialogue = "新对白";
      assert.equal((await quoteProjectNarration(f.workflow, f.userId, db)).cached, false);
      assert.equal((await f.account()).balance, 94);
    });
    await t.test("fractional video trim exports the selected source frame and rejects source overflow", async () => {
      const ffmpeg = await probeFfmpeg(); assert.equal(ffmpeg.ready, true);
      const f = await fixture("");
      f.workflow.project.videoRatio = "16:9";
      f.workflow.storyboards[0].duration = 0.5;
      f.workflow.storyboards[0].videoTrimStart = 1;
      f.workflow.storyboards[0].pictureDesc = "";
      const source = resolve(temporaryStorage, "trim-source.mp4");
      await promisify(execFile)(ffmpeg.bin, ["-y", "-f", "lavfi", "-i", "color=c=red:s=160x90:d=1",
        "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=1", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map", "[v]", "-c:v", "mpeg4", "-pix_fmt", "yuv420p", source], { timeout: 30000 });
      const { readFile } = await import("node:fs/promises");
      f.workflow.assets = [{ id: "video_shot-one", type: "video", status: "succeeded", referenceUrl: await persistVideoBuffer(await readFile(source), "trim-source") }] as ProjectWorkflow["assets"];
      const narration = await createTtsAudioAsset(f.workflow);
      const result = await composeVideoExport(f.workflow, narration);
      assert.equal(result.mimeType, "video/mp4");
      const output = resolve(temporaryStorage, result.outputUrl.replace(/^\/storage\//, ""));
      const frame = resolve(temporaryStorage, "trim-frame.rgb");
      await promisify(execFile)(ffmpeg.bin, ["-y", "-i", output, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", frame], { timeout: 30000 });
      const pixel = await readFile(frame);
      assert.ok(pixel[2] > pixel[0] + 100, "the cut must begin in the blue second half, not the red first frame");
      const ffprobe = isAbsolute(ffmpeg.bin) ? resolve(dirname(ffmpeg.bin), process.platform === "win32" ? "ffprobe.exe" : "ffprobe") : "ffprobe";
      const probe = await promisify(execFile)(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "json", output], { timeout: 30000 });
      assert.ok(Math.abs(Number(JSON.parse(probe.stdout).format.duration) - 0.5) < 0.1);
      f.workflow.storyboards[0].videoTrimStart = 1.9;
      const failed = await composeVideoExport(f.workflow, narration);
      assert.equal(failed.mimeType, "application/json");
      assert.ok(failed.warnings.some(warning => warning.includes("实际时长")));
    });
    await t.test("a real MP4 contains video, speech and subtitles; failed composition retries reuse paid narration", async () => {
      const ffmpeg = await probeFfmpeg(); assert.equal(ffmpeg.ready, true, "Install FFmpeg before running export integration tests");
      const f = await fixture("你好"); f.workflow.storyboards[0]!.duration = 1;
      let calls = 0;
      const narration = await getOrCreatePaidNarration(f.workflow, f.userId, db, { maximumCredits: 4, synthesize: (workflow, runtime) => createTtsAudioAsset(workflow, runtime, { requestCue: async () => { calls += 1; return wav(); } }) });
      f.workflow.assets.push({ id: "video_shot-one", type: "video", status: "succeeded", referenceUrl: "/storage/videos/missing.mp4" } as ProjectWorkflow["assets"][number]);
      const failed = await composeVideoExport(f.workflow, narration);
      assert.equal(failed.mimeType, "application/json");
      const source = resolve(temporaryStorage, "source.mp4");
      await promisify(execFile)(ffmpeg.bin, ["-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=1", "-c:v", "mpeg4", "-pix_fmt", "yuv420p", source], { timeout: 30_000 });
      const { readFile } = await import("node:fs/promises");
      f.workflow.assets[0]!.referenceUrl = await persistVideoBuffer(await readFile(source), "test-source");
      const cached = await getOrCreatePaidNarration(f.workflow, f.userId, db);
      const succeeded = await composeVideoExport(f.workflow, cached);
      assert.equal(succeeded.mimeType, "video/mp4"); assert.equal(succeeded.audioUrl, narration.audioUrl); assert.equal(calls, 1);
      const output = resolve(temporaryStorage, succeeded.outputUrl.replace(/^\/storage\//, ""));
      const ffprobe = isAbsolute(ffmpeg.bin) ? resolve(dirname(ffmpeg.bin), process.platform === "win32" ? "ffprobe.exe" : "ffprobe") : "ffprobe";
      const probe = await promisify(execFile)(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", output], { timeout: 30_000 });
      assert.deepEqual(JSON.parse(probe.stdout).streams.map((stream: { codec_type: string }) => stream.codec_type).sort(), ["audio", "subtitle", "video"]);
      assert.equal((await f.account()).balance, 96); assert.equal((await f.account()).frozenBalance, 0);
      assert.equal(await db.creditTransaction.count({ where: { userId: f.userId, type: "consume" } }), 1);
    });
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.modelPrice.delete({ where: { id: priceId } });
    if (originalProvider) await db.modelProvider.update({ where: { id: originalProvider.id }, data: { name: originalProvider.name, enabled: originalProvider.enabled, modality: originalProvider.modality, models: originalProvider.models, apiKey: originalProvider.apiKey, baseUrl: originalProvider.baseUrl, capability: originalProvider.capability! } });
    else await db.modelProvider.delete({ where: { id: "dashscope-tts" } });
    await db.$disconnect();
    assert.equal(dirname(temporaryStorage), resolve(process.cwd())); assert.ok(basename(temporaryStorage).startsWith(".narration-test-"));
    await rm(temporaryStorage, { recursive: true, force: true });
  }
});
