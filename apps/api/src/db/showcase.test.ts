import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createCreatorShowcaseWork, listCreatorShowcaseWorks, resubmitCreatorShowcaseWork, reviewAdminShowcaseWork, updateAdminShowcaseWork } from "./showcase.js";

const databaseUrl = process.env.AIFILM_TEST_API_DATABASE_URL;

test("showcase revisions preserve review records and submit exactly the previewed media", { skip: !databaseUrl, timeout: 60_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/(?:audit_api_[a-z0-9_]+|manjiao_review_20260912)$/i);
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const userId = `showcase_review_${crypto.randomUUID()}`;
  await db.user.create({ data: { id: userId, name: "Isolated showcase review test" } });

  async function fixture() {
    const projectId = `showcase_project_${crypto.randomUUID()}`;
    const sourceAssetId = `video_${projectId}`;
    await db.project.create({ data: { id: projectId, userId, name: "Showcase fixture", type: "test", sourceType: "script", artStyle: "test", videoRatio: "9:16", status: "rendering" } });
    await db.asset.create({ data: { id: sourceAssetId, projectId, type: "video", name: "Preview version", description: "No actual supplier call", prompt: "fixture", status: "succeeded", referenceUrl: `/storage/videos/${projectId}-v1.mp4` } });
    return { projectId, sourceAssetId, videoUrl: `/storage/videos/${projectId}-v1.mp4`, coverUrl: `/storage/images/${projectId}.png`, title: "Original submission", description: "Original description", durationLabel: "0:02", category: "概念片" };
  }
  const conflict = (error: unknown) => error instanceof Error && (error as Error & { status?: number }).status === 409;
  try {
    await t.test("asset submission validates the exact preview URL and stores pending", async () => {
      const input = await fixture();
      const created = await createCreatorShowcaseWork(userId, input, db);
      assert.equal(created.videoUrl, input.videoUrl);
      assert.equal(created.status, "pending");
      assert.equal(created.sourceAssetId, input.sourceAssetId);
      const before = await db.showcaseWork.count({ where: { projectId: input.projectId } });
      await db.asset.update({ where: { id: input.sourceAssetId }, data: { referenceUrl: input.videoUrl.replace("v1", "v2") } });
      await assert.rejects(createCreatorShowcaseWork(userId, input, db), conflict);
      await assert.rejects(createCreatorShowcaseWork(userId, { ...input, videoUrl: undefined }, db), conflict);
      assert.equal(await db.showcaseWork.count({ where: { projectId: input.projectId } }), before);
    });

    await t.test("resubmission updates the original rejected record while retaining review feedback", async () => {
      const input = await fixture();
      const created = await createCreatorShowcaseWork(userId, input, db);
      await db.showcaseWork.update({ where: { id: created.id }, data: { status: "rejected", reviewNote: "请修改说明后重新提交" } });
      const revised = await resubmitCreatorShowcaseWork(userId, created.id, { ...input, title: "Revised title", description: "Revised description" }, db);
      assert.equal(revised.id, created.id);
      assert.equal(revised.createdAt, created.createdAt);
      assert.equal(revised.status, "pending");
      assert.equal(revised.description, "Revised description");
      assert.equal(revised.reviewNote, "请修改说明后重新提交");
      assert.equal(await db.showcaseWork.count({ where: { projectId: input.projectId } }), 1);
      for (const status of ["pending", "approved"]) {
        await db.showcaseWork.update({ where: { id: created.id }, data: { status } });
        await assert.rejects(resubmitCreatorShowcaseWork(userId, created.id, input, db), conflict);
        assert.equal((await db.showcaseWork.findUniqueOrThrow({ where: { id: created.id } })).status, status);
      }
    });

    await t.test("a stale revision cannot change its record or transfer it to another project", async () => {
      const input = await fixture(), other = await fixture();
      const created = await createCreatorShowcaseWork(userId, input, db);
      await db.showcaseWork.update({ where: { id: created.id }, data: { status: "rejected", reviewNote: "Original review" } });
      await db.asset.update({ where: { id: input.sourceAssetId }, data: { referenceUrl: input.videoUrl.replace("v1", "v2") } });
      const before = await db.showcaseWork.findUniqueOrThrow({ where: { id: created.id } });
      await assert.rejects(resubmitCreatorShowcaseWork(userId, created.id, input, db), conflict);
      await assert.rejects(resubmitCreatorShowcaseWork(userId, created.id, other, db), conflict);
      await assert.rejects(resubmitCreatorShowcaseWork("another-user", created.id, input, db), conflict);
      assert.deepEqual(await db.showcaseWork.findUniqueOrThrow({ where: { id: created.id } }), before);
    });

    await t.test("concurrent resubmissions accept one revision without duplicate records", async () => {
      const input = await fixture();
      const created = await createCreatorShowcaseWork(userId, input, db);
      await db.showcaseWork.update({ where: { id: created.id }, data: { status: "rejected", reviewNote: "Retry once" } });
      const outcomes = await Promise.allSettled([resubmitCreatorShowcaseWork(userId, created.id, input, db), resubmitCreatorShowcaseWork(userId, created.id, input, db)]);
      assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
      const rejected = outcomes.find(item => item.status === "rejected");
      assert.ok(rejected?.status === "rejected" && conflict(rejected.reason));
      assert.equal(await db.showcaseWork.count({ where: { projectId: input.projectId } }), 1);
    });

    await t.test("owned historical MP4 exports remain explicitly shareable and empty-body retry revalidates media", async () => {
      const source = await fixture();
      const input = { ...source, sourceAssetId: undefined, videoUrl: `/storage/exports/${source.projectId}.mp4` };
      await db.exportJob.create({ data: { id: `export_${source.projectId}`, userId, projectId: source.projectId, type: "video_export", status: "succeeded", outputUrl: input.videoUrl } });
      const created = await createCreatorShowcaseWork(userId, input, db);
      await db.showcaseWork.update({ where: { id: created.id }, data: { status: "rejected", reviewNote: "Keep the historical snapshot" } });
      const revised = await resubmitCreatorShowcaseWork(userId, created.id, undefined, db);
      assert.equal(revised.videoUrl, input.videoUrl);
      assert.equal(revised.reviewNote, "Keep the historical snapshot");
      assert.equal(revised.id, created.id);
    });

    await t.test("project-filtered creator history finds an older project beyond the account's newest fifty records", async () => {
      const input = await fixture(), other = await fixture();
      const created = await createCreatorShowcaseWork(userId, input, db);
      await db.showcaseWork.update({ where: { id: created.id }, data: { status: "rejected", createdAt: new Date("2020-01-01") } });
      await db.showcaseWork.createMany({ data: Array.from({ length: 51 }, (_, i) => ({ id: `newer_showcase_${crypto.randomUUID()}`, creatorId: userId, projectId: other.projectId, title: `Newer ${i}`, coverUrl: other.coverUrl, videoUrl: other.videoUrl, status: "pending" })) });
      assert.equal((await listCreatorShowcaseWorks(userId, undefined, db)).some(work => work.id === created.id), false);
      const projectWorks = await listCreatorShowcaseWorks(userId, input.projectId, db);
      assert.deepEqual(projectWorks.map(work => work.id), [created.id]);
      assert.deepEqual(await listCreatorShowcaseWorks("another-user", input.projectId, db), []);
    });

    await t.test("stale administrator drafts cannot overwrite or approve a creator's newer revision", async () => {
      const input = await fixture();
      const original = await createCreatorShowcaseWork(userId, input, db);
      const rejected = await reviewAdminShowcaseWork(original.id, "reject", "Revise description", original.updatedAt, db);
      const revised = await resubmitCreatorShowcaseWork(userId, original.id, { ...input, description: "Creator's newer revision" }, db);
      await assert.rejects(updateAdminShowcaseWork(original.id, { title: "Outdated admin title", expectedUpdatedAt: rejected.updatedAt }, db), conflict);
      await assert.rejects(reviewAdminShowcaseWork(original.id, "approve", "Old review", rejected.updatedAt, db), conflict);
      assert.equal((await db.showcaseWork.findUniqueOrThrow({ where: { id: original.id } })).description, revised.description);
      assert.equal((await db.showcaseWork.findUniqueOrThrow({ where: { id: original.id } })).status, "pending");
      const saved = await updateAdminShowcaseWork(original.id, { title: "Reviewed title", authorName: "Reviewed author", expectedUpdatedAt: revised.updatedAt }, db);
      assert.notEqual(saved.updatedAt, revised.updatedAt);
      assert.equal(saved.creatorName, "Reviewed author");
      await assert.rejects(reviewAdminShowcaseWork(original.id, "approve", "", revised.updatedAt, db), conflict);
      const approved = await reviewAdminShowcaseWork(original.id, "approve", "Verified latest revision", saved.updatedAt, db);
      assert.equal(approved.status, "approved");
      assert.equal(approved.title, "Reviewed title");
      assert.ok(approved.publishedAt);
    });

    await t.test("competing administrator changes accept exactly one reviewed version", async () => {
      const input = await fixture();
      const original = await createCreatorShowcaseWork(userId, input, db);
      const outcomes = await Promise.allSettled([
        updateAdminShowcaseWork(original.id, { title: "Admin changed title", expectedUpdatedAt: original.updatedAt }, db),
        reviewAdminShowcaseWork(original.id, "approve", "Concurrent approval", original.updatedAt, db)
      ]);
      assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
      const rejected = outcomes.find(result => result.status === "rejected");
      assert.ok(rejected?.status === "rejected" && conflict(rejected.reason));
    });
  } finally {
    await db.showcaseWork.deleteMany({ where: { creatorId: userId } });
    await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }
});
