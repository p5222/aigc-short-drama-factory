import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import type { ExportJob } from "@aifilm/shared";
import { captureVideoExportSnapshot } from "./exportCompletion.js";
import { captureExportSource, exportSourceFromDiagnostics } from "./exportSource.js";
import { selectExportWorkflow } from "./exportSelection.js";
import type { MediaExportResult } from "./mediaExport.js";

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;

test("saved export sources are verified against one current PostgreSQL snapshot", { skip: !databaseUrl, timeout: 60_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const queries: string[] = [];
  const db = new PrismaClient({ datasourceUrl: databaseUrl, log: [{ emit: "event", level: "query" }] });
  db.$on("query", event => { queries.push(event.query); });
  const { getProjectWorkflow, persistProjectExportSuccess, listExportJobs, getExportJobForDownload } = await import("../db/repository.js");
  const userId = "export_source_user_" + crypto.randomUUID();
  await db.user.create({ data: { id: userId, name: "Export source fixture" } });

  async function fixture() {
    const projectId = "export_source_" + crypto.randomUUID();
    const characterId = projectId + "_character";
    await db.project.create({ data: { id: projectId, userId, name: "Source fixture", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "rendering", episodes: 2 } });
    await db.character.create({ data: { id: characterId, projectId, name: "甲", identity: "", appearance: "", costume: "", personality: "", prompt: "", negativePrompt: "", voiceId: "voice-one" } });
    for (const episodeNo of [1, 2]) {
      const shotId = projectId + "_shot_" + episodeNo;
      await db.storyboard.create({ data: {
        id: shotId, projectId, episodeNo, sceneNo: 1, shotNo: 1, duration: 2, shotSize: "全景", cameraAngle: "平视", cameraMovement: "固定",
        characters: ["甲"], scene: "书店", pictureDesc: "雨后的书店", dialogue: "甲：你好。", voiceOver: "", environmentSound: "", soundEffect: "",
        imagePrompt: "bookstore", videoPrompt: "a quiet bookstore", referenceAssetIds: [], status: "succeeded"
      } });
      await db.asset.createMany({ data: [
        { id: "image_" + shotId, projectId, type: "image", name: "First frame", description: "", prompt: "", referenceUrl: "/storage/" + shotId + ".png", status: "succeeded" },
        { id: "video_" + shotId, projectId, type: "video", name: "Source clip", description: "", prompt: "", referenceUrl: "/storage/" + shotId + ".mp4", status: "succeeded" }
      ] });
    }
    const workflow = await getProjectWorkflow(projectId, userId, db);
    assert.ok(workflow);
    return { projectId, characterId, workflow };
  }

  async function prepare(source: Awaited<ReturnType<typeof fixture>>, type: ExportJob["type"], selectedIds?: string[]) {
    const workflow = selectExportWorkflow(source.workflow, selectedIds);
    const jobId = "export_source_job_" + crypto.randomUUID();
    const sourceSnapshot = captureExportSource(workflow, type, selectedIds === undefined ? "project" : "selection");
    await db.exportJob.create({ data: { id: jobId, projectId: source.projectId, userId, type, status: "running",
      errorReason: JSON.stringify({ kind: "export_diagnostics", sourceSnapshot }) } });
    const outputKind = type === "video_export" ? "mp4" : type === "tts" ? "audio" : "subtitle";
    const exportResult: MediaExportResult = {
      outputKind, outputUrl: "/storage/" + jobId + (type === "video_export" ? ".mp4" : type === "tts" ? ".wav" : ".srt"),
      ...(type === "video_export" ? { ffmpegReady: true, clipCount: workflow.storyboards.length } : {})
    };
    return { projectId: source.projectId, userId, jobId, type, workflow, exportResult, sourceSnapshot,
      videoSnapshot: type === "video_export" ? captureVideoExportSnapshot(workflow) : undefined };
  }

  try {
    await t.test("all new formats save their original input and list/download verify current source; one workflow read per project", async () => {
      const source = await fixture();
      for (const type of ["video_export", "tts", "subtitle"] as const) {
        const input = await prepare(source, type, [source.workflow.storyboards[0]!.id]);
        const saved = await persistProjectExportSuccess(input, db);
        assert.equal(saved.sourceStatus, "current");
        assert.deepEqual(exportSourceFromDiagnostics(saved.errorReason), input.sourceSnapshot);
        assert.equal((await getExportJobForDownload(source.projectId, input.jobId, userId, db)).sourceStatus, "current");
      }
      queries.length = 0;
      const jobs = await listExportJobs(userId, source.projectId, db);
      assert.equal(jobs.length, 3);
      assert.ok(jobs.every(job => job.sourceStatus === "current"));
      assert.equal(queries.filter(query => /FROM "public"\."Storyboard"/.test(query)).length, 1, "three exports share one storyboard query");
      assert.equal(queries.filter(query => /FROM "public"\."Asset"/.test(query)).length, 1, "three exports share one asset query");
      assert.equal(queries.filter(query => /FROM "public"\."Character"/.test(query)).length, 1, "three exports share one character query");
    });

    await t.test("selected exports ignore other episodes; voice changes affect audio/video but not subtitles", async () => {
      const source = await fixture();
      for (const type of ["video_export", "tts", "subtitle"] as const) await persistProjectExportSuccess(await prepare(source, type, [source.workflow.storyboards[0]!.id]), db);
      await db.storyboard.update({ where: { id: source.workflow.storyboards[1]!.id }, data: { dialogue: "别的集数已修改", duration: 9 } });
      assert.ok((await listExportJobs(userId, source.projectId, db)).every(job => job.sourceStatus === "current"));
      await db.character.update({ where: { id: source.characterId }, data: { voiceId: "voice-two" } });
      const jobs = await listExportJobs(userId, source.projectId, db);
      assert.equal(jobs.find(job => job.type === "subtitle")!.sourceStatus, "current");
      for (const job of jobs.filter(job => job.type !== "subtitle")) {
        assert.equal(job.sourceStatus, "stale");
        assert.equal((await getExportJobForDownload(source.projectId, job.id, userId, db)).sourceStatus, "stale");
      }
      await db.storyboard.update({ where: { id: source.workflow.storyboards[0]!.id }, data: { dialogue: "甲：这段台词已修改。", duration: 3 } });
      assert.ok((await listExportJobs(userId, source.projectId, db)).every(job => job.sourceStatus === "stale"));
    });

    await t.test("an edit during production keeps successful historical output but cannot replace its original source proof", async () => {
      const source = await fixture();
      const inputs = await Promise.all((["video_export", "tts", "subtitle"] as const).map(type => prepare(source, type)));
      await db.storyboard.update({ where: { id: source.workflow.storyboards[0]!.id }, data: { dialogue: "甲：导出期间的新台词。" } });
      for (const input of inputs) {
        const saved = await persistProjectExportSuccess(input, db);
        assert.equal(saved.status, "succeeded");
        assert.equal(saved.sourceStatus, "stale");
        assert.deepEqual(exportSourceFromDiagnostics(saved.errorReason), input.sourceSnapshot);
        assert.equal((await getExportJobForDownload(source.projectId, saved.id, userId, db)).outputUrl, input.exportResult.outputUrl);
        assert.equal(await db.asset.count({ where: { projectId: source.projectId, referenceUrl: input.exportResult.outputUrl } }), 1);
      }
      assert.notEqual((await db.project.findUniqueOrThrow({ where: { id: source.projectId } })).status, "completed");
    });

    await t.test("legacy/malformed source remains unknown and downloadable without crossing project or user ownership", async () => {
      const source = await fixture(), other = await fixture();
      for (const errorReason of [null, "legacy success", '{"sourceSnapshot":{"version":1}}']) {
        const id = "legacy_export_" + crypto.randomUUID();
        await db.exportJob.create({ data: { id, projectId: source.projectId, userId, type: "video_export", status: "succeeded", outputUrl: "/storage/" + id + ".mp4", errorReason } });
        assert.equal((await getExportJobForDownload(source.projectId, id, userId, db)).sourceStatus, "unknown");
        await assert.rejects(getExportJobForDownload(other.projectId, id, userId, db), /不存在/);
        await assert.rejects(getExportJobForDownload(source.projectId, id, userId + "_foreign", db), /不存在/);
      }
      assert.ok((await listExportJobs(userId, source.projectId, db)).every(job => job.sourceStatus === "unknown"));
      assert.deepEqual(await listExportJobs(userId + "_foreign", source.projectId, db), []);
    });

    await t.test("new or missing shots change whole-project coverage while selected output retains its scope", async () => {
      const source = await fixture();
      const full = await prepare(source, "subtitle");
      const partial = await prepare(source, "subtitle", [source.workflow.storyboards[0]!.id]);
      await persistProjectExportSuccess(full, db); await persistProjectExportSuccess(partial, db);
      const template = await db.storyboard.findUniqueOrThrow({ where: { id: source.workflow.storyboards[1]!.id } });
      const newId = source.projectId + "_new_shot";
      await db.storyboard.create({ data: { id: newId, projectId: source.projectId, episodeNo: 2, sceneNo: 1, shotNo: 2,
        duration: template.duration, shotSize: template.shotSize, cameraAngle: template.cameraAngle, cameraMovement: template.cameraMovement,
        characters: template.characters, scene: template.scene, pictureDesc: template.pictureDesc, dialogue: template.dialogue,
        voiceOver: template.voiceOver, environmentSound: template.environmentSound, soundEffect: template.soundEffect,
        imagePrompt: template.imagePrompt, videoPrompt: template.videoPrompt, referenceAssetIds: [], status: "succeeded" } });
      assert.equal((await getExportJobForDownload(source.projectId, full.jobId, userId, db)).sourceStatus, "stale");
      assert.equal((await getExportJobForDownload(source.projectId, partial.jobId, userId, db)).sourceStatus, "current");
      await db.storyboard.delete({ where: { id: source.workflow.storyboards[0]!.id } });
      assert.equal((await getExportJobForDownload(source.projectId, partial.jobId, userId, db)).sourceStatus, "stale");
    });
  } finally {
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
