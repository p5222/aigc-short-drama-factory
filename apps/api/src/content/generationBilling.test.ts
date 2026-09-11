import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

const testDatabaseUrl = process.env.AIFILM_TEST_DATABASE_URL;

test("content generation billing and durable project operation lease", { skip: !testDatabaseUrl }, async (t) => {
  const url = new URL(testDatabaseUrl!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const { prisma: db } = await import("../db/client.js");
  const { runBilledContentGeneration: generate, withContentGenerationOperation: operation } = await import("./generationBilling.js");
  const users: string[] = [];
  const projects: string[] = [];
  const providers: string[] = [];

  async function fixture(balance = 100) {
    const userId = `audit_content_${crypto.randomUUID()}`;
    const providerId = `audit_content_provider_${crypto.randomUUID()}`;
    users.push(userId); providers.push(providerId);
    await db.user.create({ data: { id: userId, name: "Content billing test", credit: { create: { id: `account_${crypto.randomUUID()}`, balance } } } });
    await db.modelProvider.create({ data: { id: providerId, name: "Fixture text model", modality: "text", enabled: true, models: ["fixture-text"], capability: {}, costHint: "Test only", prices: { create: { id: `price_${crypto.randomUUID()}`, providerName: "Fixture", modality: "text", model: "fixture-text", unit: "text_run", unitCredits: 30 } } } });
    const project = await db.contentProject.create({ data: { id: `audit_content_project_${crypto.randomUUID()}`, userId, title: "Content test", mode: "original", textProvider: providerId, textModel: "fixture-text" } });
    projects.push(project.id);
    return { project, account: () => db.creditAccount.findUniqueOrThrow({ where: { userId } }) };
  }

  function deferred() {
    let resolve!: () => void;
    return { promise: new Promise<void>((done) => { resolve = done; }), resolve: () => resolve() };
  }

  try {
    await t.test("freeze precedes the provider call; persistence and consume share one transaction", async () => {
      const { project, account } = await fixture();
      const result = await operation(project.userId, project.id, "Test content", () => generate(project, "Chapter 1", async () => {
        assert.equal((await account()).frozenBalance, 30);
        assert.equal(await db.generationTask.count({ where: { userId: project.userId, estimatedCredits: 30, status: "running" } }), 1);
        return "A saved chapter";
      }, async (tx, content) => tx.storyChapter.create({ data: { id: `chapter_${crypto.randomUUID()}`, contentProjectId: project.id, chapterNo: 1, title: "One", content, result: {}, promptSnapshot: {} } })));
      assert.equal(result.content, "A saved chapter");
      assert.equal((await account()).balance, 70);
      assert.equal((await account()).frozenBalance, 0);
      assert.equal(await db.creditTransaction.count({ where: { userId: project.userId, type: "consume" } }), 1);
      assert.equal(await db.generationTask.count({ where: { userId: project.userId, projectId: null, status: "succeeded" } }), 2);
    });

    await t.test("insufficient balance and missing provider pricing prevent external work", async () => {
      const { project } = await fixture(20);
      let calls = 0;
      const attempt = () => operation(project.userId, project.id, "Test", () => generate(project, "Chapter", async () => { calls++; return "text"; }, async () => undefined));
      await assert.rejects(attempt(), /积分余额不足/);
      await db.modelPrice.deleteMany({ where: { providerId: project.textProvider } });
      await assert.rejects(attempt(), /未配置有效价格/);
      assert.equal(calls, 0);
    });

    await t.test("failed generation releases its credits but retains already completed chapters", async () => {
      const { project, account } = await fixture();
      await assert.rejects(operation(project.userId, project.id, "Batch", async () => {
        await generate(project, "Chapter 1", async () => "completed", (tx, content) => tx.storyChapter.create({ data: { id: `chapter_${crypto.randomUUID()}`, contentProjectId: project.id, chapterNo: 1, title: "One", content, result: {}, promptSnapshot: {} } }));
        await generate(project, "Chapter 2", async () => { throw new Error("Provider timeout"); }, async () => undefined);
      }), /Provider timeout/);
      assert.equal(await db.storyChapter.count({ where: { contentProjectId: project.id } }), 1);
      assert.equal((await account()).balance, 70);
      assert.equal((await account()).frozenBalance, 0);
      assert.equal(await db.creditTransaction.count({ where: { userId: project.userId, type: "refund" } }), 1);
    });

    await t.test("failed persistence rolls back the output and charge", async () => {
      const { project, account } = await fixture();
      await assert.rejects(operation(project.userId, project.id, "Test", () => generate(project, "Chapter", async () => "text", async (tx, content) => {
        await tx.storyChapter.create({ data: { id: `chapter_${crypto.randomUUID()}`, contentProjectId: project.id, chapterNo: 1, title: "One", content, result: {}, promptSnapshot: {} } });
        throw new Error("Storage rejected");
      })), /Storage rejected/);
      assert.equal(await db.storyChapter.count({ where: { contentProjectId: project.id } }), 0);
      assert.equal((await account()).balance, 100);
      assert.equal((await account()).frozenBalance, 0);
    });

    await t.test("two simultaneous requests cannot run one content project twice", async () => {
      const { project } = await fixture();
      const started = deferred(); const release = deferred();
      const first = operation(project.userId, project.id, "First", async () => { started.resolve(); await release.promise; });
      await started.promise;
      await assert.rejects(operation(project.userId, project.id, "Duplicate", async () => undefined), /已有生成任务/);
      release.resolve(); await first;
      await operation(project.userId, project.id, "Next", async () => undefined);
    });

    await t.test("expired lease refunds old work; a late provider response cannot save or charge", async () => {
      const { project, account } = await fixture();
      const started = deferred(); const release = deferred();
      let saved = false;
      const old = operation(project.userId, project.id, "Old", () => generate(project, "Old text", async () => { started.resolve(); await release.promise; return "late"; }, async () => { saved = true; }));
      const oldRejected = assert.rejects(old, /内容操作已中断/);
      await started.promise;
      await db.generationTask.updateMany({ where: { userId: project.userId, jobId: { startsWith: `content:${project.id}:operation:` } }, data: { updatedAt: new Date(Date.now() - 180_000) } });
      await operation(project.userId, project.id, "New", async () => undefined);
      release.resolve(); await oldRejected;
      assert.equal(saved, false);
      assert.equal((await account()).balance, 100);
      assert.equal((await account()).frozenBalance, 0);
      assert.equal(await db.creditTransaction.count({ where: { userId: project.userId, type: "refund" } }), 1);
    });
  } finally {
    await db.contentProject.deleteMany({ where: { id: { in: projects } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.modelProvider.deleteMany({ where: { id: { in: providers } } });
    await db.$disconnect();
  }
});
