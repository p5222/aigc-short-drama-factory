import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

const databaseUrl = process.env.AIFILM_TEST_DATABASE_URL;
test("content edits and deletion preserve versions, ownership and running work", { skip: !databaseUrl, timeout: 60_000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  process.env.DATABASE_URL = databaseUrl;
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const { prisma: db } = await import("../db/client.js");
  const { updateContentChapter: edit, deleteContentProject: remove } = await import("./service.js");
  const { withContentGenerationOperation: operation } = await import("./generationBilling.js");
  const users: string[] = [];
  async function fixture() {
    const userId = `audit_content_edit_${crypto.randomUUID()}`;
    users.push(userId);
    await db.user.create({ data: { id: userId, name: "Content mutation fixture", credit: { create: { id: `credit_${userId}`, balance: 100 } } } });
    const project = await db.contentProject.create({ data: { id: `content_edit_${crypto.randomUUID()}`, userId, title: "Version fixture", mode: "original" } });
    const chapter = await db.storyChapter.create({ data: {
      id: `chapter_${crypto.randomUUID()}`, contentProjectId: project.id, chapterNo: 1, title: "Original",
      content: "原稿中的人物从旧书店出发，在钟楼寻找母亲留下的旧信。", status: "confirmed", version: 1,
      result: { handoff: "An old generated handoff" }, promptSnapshot: { version: "fixture-v1" }
    } });
    return { project, chapter };
  }
  const conflicts = (error: unknown) => error instanceof Error && "status" in error && error.status === 409;
  try {
    await t.test("editing appends a version, preserves old text and refreshes the continuity handoff without charging", async () => {
      const { project, chapter } = await fixture();
      await db.productionEpisode.create({ data: { id: `episode_${crypto.randomUUID()}`, contentProjectId: project.id, episodeNo: 1, title: "Episode", status: "confirmed", sourceStart: 0, sourceEnd: 30, sourceCharacterCount: 30 } });
      const content = "作者修改了正文：人物留在书店，决定先读完整封信，再去钟楼寻找线索。";
      const pkg = await edit(project.userId, project.id, 1, { content, expectedChapterId: chapter.id });
      assert.equal((await db.storyChapter.findUniqueOrThrow({ where: { id: chapter.id } })).content, chapter.content);
      const versions = await db.storyChapter.findMany({ where: { contentProjectId: project.id }, orderBy: { version: "desc" } });
      assert.equal(versions.length, 2);
      assert.equal(versions[0]!.version, 2);
      assert.equal(versions[0]!.content, content);
      assert.equal(pkg.chapters?.[0]?.id, versions[0]!.id);
      assert.deepEqual((versions[0]!.result as any).handoff.content, content);
      assert.equal((await db.productionEpisode.findFirstOrThrow({ where: { contentProjectId: project.id } })).status, "stale");
      await edit(project.userId, project.id, 1, { content, expectedChapterId: chapter.id });
      assert.equal(await db.storyChapter.count({ where: { contentProjectId: project.id } }), 2);
      assert.equal(await db.creditTransaction.count({ where: { userId: project.userId } }), 0);
      assert.equal((await db.creditAccount.findUniqueOrThrow({ where: { userId: project.userId } })).balance, 100);
    });

    await t.test("two writers based on the same version cannot overwrite each other", async () => {
      const { project, chapter } = await fixture();
      const results = await Promise.allSettled(["第一位作者让人物留在书店阅读旧信，并仔细核对每个线索。", "第二位作者让人物直接赶往钟楼寻找线索，故事有不同的发展。"]
        .map(content => edit(project.userId, project.id, 1, { content, expectedChapterId: chapter.id })));
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const rejection = results.find(result => result.status === "rejected");
      assert.ok(rejection?.status === "rejected" && conflicts(rejection.reason));
      assert.equal(await db.storyChapter.count({ where: { contentProjectId: project.id } }), 2);
    });

    await t.test("an active generation lease blocks edit and delete until the output has finished", async () => {
      const { project, chapter } = await fixture();
      let release!: () => void, started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const pending = operation(project.userId, project.id, "No supplier fixture", async () => {
        started();
        await new Promise<void>(resolve => { release = resolve; });
      });
      await ready;
      try {
        await assert.rejects(remove(project.userId, project.id), conflicts);
        await assert.rejects(edit(project.userId, project.id, 1, { content: "保存不应覆盖仍在生成的正文，这段文本仅用于保护机制验收。", expectedChapterId: chapter.id }), conflicts);
        assert.ok(await db.contentProject.findUnique({ where: { id: project.id } }));
      } finally { release(); await pending; }
      await remove(project.userId, project.id);
      assert.equal(await db.contentProject.findUnique({ where: { id: project.id } }), null);
      assert.equal(await db.generationTask.count({ where: { userId: project.userId, status: "succeeded" } }), 1);
    });

    await t.test("an orphan pending billable task still blocks deletion and foreign ownership remains private", async () => {
      const { project } = await fixture();
      const other = await fixture();
      await assert.rejects(remove(other.project.userId, project.id), (error: any) => error.status === 404);
      await assert.rejects(edit(other.project.userId, project.id, 1, { content: "其他账号的编辑请求不能访问这个项目或它的章节正文。" }), (error: any) => error.status === 404);
      await db.generationTask.create({ data: {
        id: `orphan_${crypto.randomUUID()}`, userId: project.userId, type: "text", title: "Pending child", provider: "fixture", model: "fixture",
        jobId: `content:${project.id}:billing:old:child`, status: "pending", estimatedCredits: 0
      } });
      await assert.rejects(remove(project.userId, project.id), conflicts);
      assert.ok(await db.contentProject.findUnique({ where: { id: project.id } }));
    });
  } finally {
    for (const userId of users) {
      await db.generationTask.deleteMany({ where: { userId } });
      await db.contentProject.deleteMany({ where: { userId } });
      await db.creditTransaction.deleteMany({ where: { userId } });
      await db.creditAccount.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
    }
  }
});
