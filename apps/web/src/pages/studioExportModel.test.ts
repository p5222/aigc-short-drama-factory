import assert from "node:assert/strict";
import test from "node:test";
import type { AssetItem, ExportJob, ProjectWorkflow, StoryboardShot } from "@aifilm/shared";
import { buildStudioExportIntent, createScopedRequestGate, submitStudioExport } from "./studioExportModel.ts";
import type { DeliveryExportQuote } from "../workbench/stages/deliveryQuoteModel.ts";

const shot = (id: string, episodeNo: number): StoryboardShot => ({ id, projectId: "p", episodeNo, sceneNo: 1, shotNo: 1, duration: 5, shotSize: "", cameraAngle: "", cameraMovement: "", characters: [], scene: "", pictureDesc: id, dialogue: `台词${id}`, voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: "", videoPrompt: "", referenceAssetIds: [], status: "succeeded" });
const shots = [shot("a", 1), shot("b", 2)];
const assets: AssetItem[] = shots.map(item => ({ id: `video_${item.id}`, projectId: "p", type: "video", name: item.id, description: "", prompt: "", referenceUrl: `/storage/${item.id}.mp4`, status: "succeeded" }));
const workflow = { project: { id: "p" }, storyboards: shots, assets } as ProjectWorkflow;
const quote: DeliveryExportQuote = { type: "video_export", providerId: "tts", providerName: "配音", model: "voice", characters: 6, estimatedCredits: 12, unitCredits: 2, unit: "tts_character", cached: false, cueCount: 2 };
const job: ExportJob = { id: "export-one", projectId: "p", type: "video_export", status: "succeeded", outputKind: "mp4", outputUrl: "/storage/result.mp4", createdAt: "2026-09-12", updatedAt: "2026-09-12" };

test("studio explicitly quotes and submits every episode in displayed project order", async () => {
  const intent = buildStudioExportIntent(workflow, "video_export");
  assert.deepEqual(intent.storyboardIds, ["a", "b"]);
  const calls: unknown[] = [];
  const result = await submitStudioExport(intent, quote, intent.scopeKey, {
    submit: async (projectId, input) => { calls.push({ projectId, input }); return job; },
    sync: async () => undefined
  });
  assert.equal(result.status, "accepted");
  assert.deepEqual(calls, [{ projectId: "p", input: { type: "video_export", storyboardIds: ["a", "b"], maxCredits: 12 } }]);
});

test("missing clip blocks MP4 but allows separate narration and subtitles", () => {
  const incomplete = { ...workflow, assets: assets.slice(0, 1) };
  assert.throws(() => buildStudioExportIntent(incomplete, "video_export"), /1 个镜头视频未完成/);
  assert.deepEqual(buildStudioExportIntent(incomplete, "tts").storyboardIds, ["a", "b"]);
  assert.deepEqual(buildStudioExportIntent(incomplete, "subtitle").storyboardIds, ["a", "b"]);
  assert.throws(() => buildStudioExportIntent({ ...workflow, storyboards: [] }, "tts"), /没有可导出/);
});

test("changing project, order, text or type cannot submit an old quotation", async () => {
  const intent = buildStudioExportIntent(workflow, "video_export");
  const changes = [
    { ...workflow, project: { ...workflow.project, id: "other" } },
    { ...workflow, storyboards: [...shots].reverse() },
    { ...workflow, storyboards: [{ ...shots[0]!, dialogue: "新台词" }, shots[1]!] }
  ];
  let submitted = 0;
  for (const changed of changes) {
    await assert.rejects(submitStudioExport(intent, quote, buildStudioExportIntent(changed, "tts").scopeKey, {
      submit: async () => { submitted += 1; return job; }, sync: async () => undefined
    }), /重新获取报价/);
  }
  await assert.rejects(submitStudioExport(intent, { ...quote, type: "tts" }, intent.scopeKey, {
    submit: async () => { submitted += 1; return job; }, sync: async () => undefined
  }), /重新获取报价/);
  assert.equal(submitted, 0);
});

test("accepted export with failed refresh retains its job and never repeats submission", async () => {
  const intent = buildStudioExportIntent(workflow, "video_export");
  let submissions = 0;
  const result = await submitStudioExport(intent, quote, intent.scopeKey, {
    submit: async () => { submissions += 1; return job; },
    sync: async () => { throw new Error("offline"); }
  });
  assert.equal(result.status, "sync-required");
  assert.equal(result.job, job);
  assert.equal(submissions, 1);
});

test("cached narration and subtitle submit an explicit zero cap", async () => {
  for (const type of ["tts", "subtitle"] as const) {
    const intent = buildStudioExportIntent(workflow, type);
    let cap: number | undefined;
    await submitStudioExport(intent, { ...quote, type, cached: type === "tts", estimatedCredits: 0 }, intent.scopeKey, {
      submit: async (_projectId, input) => { cap = input.maxCredits; return { ...job, type }; },
      sync: async () => undefined
    });
    assert.equal(cap, 0);
  }
});

test("a failed export remains a failed record and does not get labeled as accepted", async () => {
  const intent = buildStudioExportIntent(workflow, "video_export");
  let refreshes = 0;
  const failed = { ...job, status: "failed" as const, errorReason: "合成失败，已付费配音可复用" };
  const result = await submitStudioExport(intent, quote, intent.scopeKey, {
    submit: async () => failed, sync: async () => { refreshes += 1; }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.job.errorReason, failed.errorReason);
  assert.equal(refreshes, 0);
});

test("late project reads cannot overwrite newer selections or the same project reopened", () => {
  const gate = createScopedRequestGate();
  const firstA = gate.begin("a");
  assert.equal(gate.isCurrent(firstA, "b"), false);
  const b = gate.begin("b");
  const secondA = gate.begin("a");
  assert.equal(gate.isCurrent(firstA, "a"), false);
  assert.equal(gate.isCurrent(b, "a"), false);
  assert.equal(gate.isCurrent(secondA, "a"), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(secondA, "a"), false);
});
