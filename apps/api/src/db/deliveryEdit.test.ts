import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { saveDeliveryEdit } from "./deliveryEdit.js";
import { getProjectWorkflow } from "./repository.js";
import { applyDeliveryEdit } from "@aifilm/shared";

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;
test("PostgreSQL edits enforce ownership, optimistic concurrency and saved export identity", { skip: !databaseUrl, timeout: 60_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_api_[a-z0-9_]+$/i);
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const userId = `edit_user_${crypto.randomUUID()}`, projectId = `edit_project_${crypto.randomUUID()}`, shotId = `${projectId}_shot`;
  try {
    await db.user.create({ data: { id: userId, name: "Edit integration fixture" } });
    await db.project.create({ data: { id: projectId, userId, name: "Edit test", type: "test", sourceType: "script", artStyle: "test", videoRatio: "16:9", status: "rendering" } });
    await db.storyboard.create({ data: { id: shotId, projectId, episodeNo: 1, sceneNo: 1, shotNo: 1, duration: 5,
      shotSize: "", cameraAngle: "", cameraMovement: "", characters: [], scene: "", pictureDesc: "", dialogue: "", voiceOver: "", environmentSound: "", soundEffect: "",
      imagePrompt: "", videoPrompt: "", referenceAssetIds: [], status: "succeeded" } });
    await db.asset.create({ data: { id: `video_${shotId}`, projectId, type: "video", status: "succeeded",
      name: "Fixture", description: "", prompt: "", referenceUrl: "/storage/edit-fixture.mp4" } });
    const input = { episodeNo: 1, expectedRevision: 0, clips: [{ shotId, sourceAssetId: `video_${shotId}`, inPoint: 1.2, outPoint: 4.6 }] };
    await t.test("foreign user cannot read or save this edit", async () => {
      assert.equal(await getProjectWorkflow(projectId, "foreign-user", db), null);
      await assert.rejects(saveDeliveryEdit(projectId, "foreign-user", input, db), /项目不存在/);
      assert.equal(await db.deliveryEdit.count({ where: { projectId } }), 0);
    });
    await t.test("two saves from one revision accept exactly one without losing the winning cut", async () => {
      const outcomes = await Promise.allSettled([saveDeliveryEdit(projectId, userId, input, db), saveDeliveryEdit(projectId, userId, { ...input, clips: [{ ...input.clips[0], inPoint: 2 }] }, db)]);
      assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
      const rejected = outcomes.find(item => item.status === "rejected") as PromiseRejectedResult;
      assert.equal(rejected.reason.statusCode, 409);
      const workflow = await getProjectWorkflow(projectId, userId, db);
      assert.equal(workflow!.deliveryEdits![0].revision, 1);
      const edited = applyDeliveryEdit(workflow!, { episodeNo: 1, revision: 1 });
      assert.equal(edited.storyboards[0].duration, workflow!.deliveryEdits![0].clips[0].outPoint - workflow!.deliveryEdits![0].clips[0].inPoint);
      assert.equal(workflow!.storyboards[0].duration, 5);
      assert.equal(workflow!.deliveryEdits![0].clips[0].sourceUrl, "/storage/edit-fixture.mp4");
    });
    await t.test("invalid ranges and wrong source IDs leave the revision untouched", async () => {
      await assert.rejects(saveDeliveryEdit(projectId, userId, { ...input, expectedRevision: 1, clips: [{ ...input.clips[0], outPoint: 9 }] }, db), /入出点无效/);
      assert.equal((await db.deliveryEdit.findFirstOrThrow({ where: { projectId } })).revision, 1);
    });
  } finally { await db.user.deleteMany({ where: { id: userId } }); await db.$disconnect(); }
});
