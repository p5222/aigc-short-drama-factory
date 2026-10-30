import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import type { CreateProjectInput } from "@aifilm/shared";
import { promptCatalog } from "./catalog.js";
import { renderPrompt } from "./runtime.js";

const databaseUrl = process.env.AIFILM_TEST_COMMERCE_DATABASE_URL;
if (databaseUrl) {
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  process.env.DATABASE_URL = databaseUrl;
  process.env.OBJECT_STORAGE_LOCAL_DIR = await mkdtemp(join(tmpdir(), "manjiao-prompt-test-"));
}

test("production drafts preserve required variables, contracts and data boundaries", async () => {
  const { validateProductionDraft, previewProductionPrompt } = await import("./production.js");
  for (const builtin of promptCatalog) {
    const draft = { systemPrompt: builtin.systemPrompt, userTemplate: builtin.userTemplate };
    assert.equal(validateProductionDraft(builtin.key, draft).version, "1.1.0");
    const variables = Object.fromEntries(builtin.variables.map(key => [key, "测试数据"]));
    assert.ok(previewProductionPrompt(builtin.key, draft, variables).characters > 0);
    assert.match(builtin.systemPrompt, /待处理数据/);
    assert.throws(() => validateProductionDraft(builtin.key, { ...draft, userTemplate: "缺少全部变量的输入模板" }), /缺少必需变量/);
    assert.throws(() => validateProductionDraft(builtin.key, { ...draft, userTemplate: `${draft.userTemplate} {{constructor}}` }), /不支持的变量/);
    assert.throws(() => validateProductionDraft(builtin.key, { ...draft, userTemplate: `${draft.userTemplate} {{ invalid-key }}` }), /占位符/);
  }
  assert.throws(() => renderPrompt("{{constructor}}", {}), /缺少变量/);
});

test("PostgreSQL production prompts: atomic publication, immutable versions, runtime snapshots and lab isolation", { skip: !databaseUrl, timeout: 60000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_commerce_[a-z0-9_]+$/i);
  process.env.AIFILM_LOAD_ENV_FILES = "false"; process.env.DATABASE_URL = databaseUrl;
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const service = await import("./production.js");
  const key = "episode_adaptation", otherKey = "chapter_generation";
  const scriptKeys = ["novel_to_script", "existing_script_structure"];
  const definition = promptCatalog.find(item => item.key === key)!;
  const owner = `prompt_audit_${crypto.randomUUID()}`, labId = `lab_${crypto.randomUUID()}`;
  const labKey = `lab_${crypto.randomUUID()}`;
  await db.productionPromptState.deleteMany({ where: { key: { in: [key, otherKey] } } });
  await db.productionPromptVersion.deleteMany({ where: { key: { in: [key, otherKey] } } });
  try {
    const draft = { systemPrompt: `${definition.systemPrompt}\n版本甲标记`, userTemplate: definition.userTemplate, notes: "版本甲", expectedRevision: 0, requestId: crypto.randomUUID() };
    let first!: { id: string; number: number }, second!: { id: string; number: number };
    await t.test("concurrent retries return one immutable candidate and never publish it", async () => {
      const results = await Promise.all([service.saveProductionPrompt(key, draft, owner), service.saveProductionPrompt(key, draft, owner)]);
      first = results[0]!;
      assert.deepEqual(results[0], results[1]);
      assert.equal((await service.resolveProductionPrompt(key)).version, "1.1.0");
      assert.equal((await service.getProductionPrompt(key)).totalVersions, 1);
      await assert.rejects(service.saveProductionPrompt(key, { ...draft, notes: "不同内容" }, owner), /请求的内容已改变/);
      second = await service.saveProductionPrompt(key, { ...draft, systemPrompt: `${definition.systemPrompt}\n版本乙标记`, notes: "版本乙", requestId: crypto.randomUUID() }, owner);
    });
    await t.test("two publishers sharing a revision cannot silently overwrite each other", async () => {
      const results = await Promise.allSettled([service.activateProductionPrompt(key, { versionId: first.id, expectedRevision: 0 }), service.activateProductionPrompt(key, { versionId: second.id, expectedRevision: 0 })]);
      assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
      assert.equal(results.filter(item => item.status === "rejected").length, 1);
      const detail = await service.getProductionPrompt(key);
      assert.equal(detail.revision, 1); assert.equal(detail.totalVersions, 2);
      const snapshot = (await service.materializeProductionPrompt(key, { episodeNo: 1, duration: 180, content: "本集事实", styleProfile: "二维" })).snapshot;
      assert.equal(snapshot.version, detail.effective.version);
      assert.match(snapshot.systemPrompt, /版本[甲乙]标记/);
      await service.activateProductionPrompt(key, { versionId: null, expectedRevision: 1 });
      assert.equal((await service.resolveProductionPrompt(key)).version, "1.1.0");
      assert.match(snapshot.version, /custom/);
      await assert.rejects(service.saveProductionPrompt(key, { ...draft, requestId: crypto.randomUUID() }, owner), /其他管理员更新/);
      assert.deepEqual(await service.saveProductionPrompt(key, draft, owner), first);
    });
    await t.test("foreign versions and reference templates cannot publish; lab active rows do not affect production", async () => {
      await assert.rejects(service.activateProductionPrompt(otherKey, { versionId: first.id, expectedRevision: 0 }), /不属于/);
      await assert.rejects(service.activateProductionPrompt("storyboard_core", { versionId: null, expectedRevision: 0 }), /设计参考/);
      await db.promptVersion.create({ data: { id: labId, key, name: "Lab only", stage: "script", purpose: "generation", version: owner, content: "lab marker", status: "active" } });
      assert.equal((await service.resolveProductionPrompt(key)).version, "1.1.0");
      const missing = { systemPrompt: definition.systemPrompt, userTemplate: definition.userTemplate };
      assert.throws(() => service.previewProductionPrompt(key, missing, {}), /缺少变量/);
    });
    await t.test("corrupted active contracts fail closed instead of changing provider input silently", async () => {
      await service.activateProductionPrompt(key, { versionId: first.id, expectedRevision: 2 });
      await db.productionPromptVersion.update({ where: { id: first.id }, data: { definition: { ...definition, version: `1.1.0+custom.${first.number}`, outputSchema: { invalid: "string" } } } });
      await assert.rejects(service.resolveProductionPrompt(key), /不兼容/);
      assert.match((await service.getProductionPrompt(key)).compatibilityError!, /生成已阻止/);
      await service.activateProductionPrompt(key, { versionId: null, expectedRevision: 3 });
      assert.equal((await service.resolveProductionPrompt(key)).version, "1.1.0");
    });
    await t.test("failed and concurrent experiment activations retain one valid active version", async () => {
      const lab = await import("../db/evaluation.js");
      const input = { key: labKey, name: "实验版本", stage: "script" as const, purpose: "evaluation" as const, version: "v1", content: "评分内容", status: "active" as const };
      const first = await lab.createPromptVersion(input);
      await assert.rejects(lab.createPromptVersion(input));
      assert.equal((await db.promptVersion.findUniqueOrThrow({ where: { id: first.id } })).status, "active");
      const second = await lab.createPromptVersion({ ...input, version: "v2", status: "draft" });
      await Promise.all([lab.updatePromptVersion(first.id, { status: "active" }), lab.updatePromptVersion(second.id, { status: "active" })]);
      assert.equal(await db.promptVersion.count({ where: { key: labKey, status: "active" } }), 1);
    });
    await t.test("actual script adapter sends the active version to a test upstream and preserves supplied scripts", async () => {
      await db.productionPromptState.deleteMany({ where: { key: { in: scriptKeys } } });
      await db.productionPromptVersion.deleteMany({ where: { key: { in: scriptKeys } } });
      const requests: { messages: { role: string; content: string }[] }[] = [];
      const upstream = createServer(async (req, res) => {
        let body = ""; for await (const chunk of req) body += chunk;
        requests.push(JSON.parse(body));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ synopsis: "雨夜书店", script: "模型返回的改编正文", characters: [{ name: "林晚", identity: "主角", appearance: "unknown", costume: "unknown", personality: "好奇" }] }) } }] }));
      });
      upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
      try {
        const { generateProjectScriptContent } = await import("../agents/generator.js");
        const address = upstream.address() as { port: number };
        for (const promptKey of scriptKeys) {
          const builtin = promptCatalog.find(item => item.key === promptKey)!;
          const saved = await service.saveProductionPrompt(promptKey, { systemPrompt: `${builtin.systemPrompt}\nADAPTER_VERSION_MARKER`, userTemplate: builtin.userTemplate, notes: "验证实际适配器", expectedRevision: 0, requestId: crypto.randomUUID() }, owner);
          await service.activateProductionPrompt(promptKey, { versionId: saved.id, expectedRevision: 0 });
          const sourceType = promptKey === "novel_to_script" ? "novel" : "script";
          const input: CreateProjectInput = { title: "雨夜书店", content: "第1场 书店\n林晚：这封信是谁的？", genre: "都市", sourceType, mode: "nine_grid", videoRatio: "9:16", artStyle: "二维", textProvider: "openai-compatible", textModel: "prompt-audit", apiKey: "test-only", baseUrl: `http://127.0.0.1:${address.port}/v1` };
          const result = await generateProjectScriptContent(`audit_${sourceType}`, input);
          assert.equal(result.mode, "real"); // Real adapter; upstream here is explicitly a local fixture.
          assert.equal(result.promptSnapshot?.version, "1.1.0+custom.1");
          assert.match(requests.at(-1)!.messages.find(item => item.role === "system")!.content, /ADAPTER_VERSION_MARKER/);
          if (sourceType === "script") assert.equal(result.script.content, input.content);
        }
        assert.equal(requests.length, 2);
      } finally { upstream.close(); await once(upstream, "close"); }
    });
  } finally {
    await db.promptVersion.deleteMany({ where: { OR: [{ id: labId }, { key: labKey }] } });
    await db.productionPromptState.deleteMany({ where: { key: { in: [key, otherKey, ...scriptKeys] } } });
    await db.productionPromptVersion.deleteMany({ where: { owner } });
    await db.$disconnect();
  }
});
