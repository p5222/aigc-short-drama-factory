import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

const databaseUrl = process.env.AIFILM_TEST_DATABASE_URL;
test("creator run persistence, costs, recovery and author acceptance with real PostgreSQL", { skip: !databaseUrl, timeout: 180000 }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.match(url.pathname, /^\/audit_credits_[a-z0-9_]+$/i);
  process.env.DATABASE_URL = databaseUrl;
  process.env.AIFILM_LOAD_ENV_FILES = "false";
  const { prisma: db } = await import("../db/client.js");
  const agent = await import("./creatorAgent.js");
  const { syncContentToProduction } = await import("./service.js");
  const { saveFact } = await import("./storyMemory.js");
  const fetchOriginal = globalThis.fetch;
  const userId = `audit_creator_${crypto.randomUUID()}`, providerId = `audit_creator_provider_${crypto.randomUUID()}`;
  const valid = { title: "旧书店的信", synopsis: "修表师读到父亲留下的线索", script: "场景一：旧书店，日。阿青轻轻推门，门铃响起。他抚平信纸，凝视纸上的钟楼图案。阿青：原来你一直在等我。场景二：钟楼前，日。阿青握着怀表，钟声响起。他停下脚步，将信贴近胸口，然后坚定地走向钟楼。画面渐暗，钟声延续。",
    estimatedSeconds: 30, characters: [{ name: "阿青", identity: "修表师", appearance: "短发", costume: "蓝色外套", personality: "细心" }],
    scenes: [{ location: "旧书店", description: "旧书架和门铃", characters: ["阿青"] }], props: [], factUpdates: [] };
  let calls = 0, respond: () => Promise<Response>;
  const response = (value: unknown) => new Response(JSON.stringify({ id: `fixture_${calls}`, choices: [{ message: { content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 200, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 50 } } }), { status: 200, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.match(String(input), /^https:\/\/creator-fixture\.invalid\/v1\/chat\/completions$/);
    assert.equal(JSON.parse(String(init?.body)).model, "fixture-text");
    calls++;
    return respond();
  }) as typeof fetch;
  const create = async () => {
    const input = { requestId: crypto.randomUUID(), title: valid.title, brief: { format: "short", material: "idea", intent: "一位修表师寻找父亲留下的信", durationSeconds: 30 },
      textProvider: providerId, textModel: "fixture-text" };
    const project = await agent.createShortProject(userId, input);
    return { projectId: project.id, input };
  };
  const plan = async (projectId: string, maxCalls = 1) => {
    const quote = await agent.quoteCreatorRun(userId, projectId, { maxCalls });
    const input = { requestId: crypto.randomUUID(), expectedRevision: quote.inputRevision, maximumCredits: quote.maximumCredits, maxCalls };
    const run = await agent.createCreatorRun(userId, projectId, input);
    return { runId: run.id, input, quote };
  };
  try {
    await db.user.create({ data: { id: userId, name: "Creator integration fixture", credit: { create: { id: `credit_${userId}`, balance: 1000 } } } });
    await db.modelProvider.create({ data: { id: providerId, name: "Fixture text", modality: "text", enabled: true, models: ["fixture-text"], apiKey: "fixture-only", baseUrl: "https://creator-fixture.invalid/v1", capability: {}, costHint: "test",
      prices: { create: { id: `price_${crypto.randomUUID()}`, providerName: "Fixture", modality: "text", model: "fixture-text", unit: "text_run", unitCredits: 10 } } } });

    await t.test("create and execute retries reuse committed output and charge exactly once", async () => {
      const { projectId, input: creation } = await create();
      assert.equal((await agent.createShortProject(userId, creation)).id, projectId);
      await assert.rejects(agent.createShortProject(userId, { ...creation, title: "changed" }), /同一创建请求/);
      const { runId, input } = await plan(projectId);
      assert.equal((await agent.createCreatorRun(userId, projectId, input)).id, runId);
      await assert.rejects(agent.createCreatorRun(userId, projectId, { ...input, maxCalls: 2 }), /同一执行请求/);
      const before = calls;
      respond = async () => response(valid);
      let state = await agent.executeCreatorRun(userId, projectId, runId);
      assert.equal(state.runs[0]?.status, "awaiting_review");
      assert.equal(state.runs[0]?.steps[0]?.usage?.inputTokens, 200);
      await agent.executeCreatorRun(userId, projectId, runId);
      assert.equal(calls - before, 1);
      assert.equal(await db.scriptVersion.count({ where: { contentProjectId: projectId } }), 1);
      assert.equal(await db.creditTransaction.count({ where: { userId, taskId: state.runs[0]!.steps[0]!.taskId, type: "consume" } }), 1);
      await assert.rejects(syncContentToProduction(userId, projectId), /确认短剧本/);
      const script = await db.scriptVersion.findFirstOrThrow({ where: { contentProjectId: projectId } });
      const review = { expectedScriptId: script.id, expectedRevision: state.revision, content: script.content, approve: true };
      state = await agent.reviewCreatorScript(userId, projectId, review);
      await agent.reviewCreatorScript(userId, projectId, review);
      assert.equal(state.nextAction, "production");
      assert.equal(state.runs[0]?.status, "completed");
      const productionId = await syncContentToProduction(userId, projectId);
      assert.equal((await db.project.findUniqueOrThrow({ where: { id: productionId } })).episodeDurationSeconds, 30);
      assert.equal((await db.productionEpisode.findFirstOrThrow({ where: { contentProjectId: projectId } })).targetDurationSeconds, 30);
      await assert.rejects(agent.getCreatorState("someone_else", projectId), /不存在/);
    });
    await t.test("bounded targeted repair saves findings, counts both attempts and stops without progress", async () => {
      const { projectId } = await create();
      const { runId } = await plan(projectId, 2);
      const before = calls;
      respond = async () => response({ ...valid, estimatedSeconds: 90 });
      const state = await agent.executeCreatorRun(userId, projectId, runId);
      assert.equal(calls - before, 2);
      assert.equal(state.runs[0]?.status, "needs_repair");
      assert.equal(state.runs[0]?.steps.length, 2);
      assert.match(state.runs[0]?.error ?? "", /停止自动修订/);
      await agent.executeCreatorRun(userId, projectId, runId);
      assert.equal(calls - before, 2);
    });
    await t.test("one-call budget with blocking findings ends in reviewable repair state", async () => {
      const { projectId } = await create();
      const { runId } = await plan(projectId);
      respond = async () => response({ ...valid, estimatedSeconds: 90 });
      const state = await agent.executeCreatorRun(userId, projectId, runId);
      assert.equal(state.runs[0]?.status, "needs_repair");
      assert.equal(state.scripts[0]?.findings.some(f => f.code === "duration"), true);
      const latest = state.scripts[0]!;
      const details = { ...latest.details!, estimatedSeconds: 30, characters: latest.details!.characters.map(character => ({ ...character, costume: "绿色外套" })) };
      const review = { expectedScriptId: latest.id, expectedRevision: state.revision, content: latest.content, approve: true, details, note: "缩短停顿并修正服装" };
      const accepted = await agent.reviewCreatorScript(userId, projectId, review);
      assert.equal(accepted.nextAction, "production");
      await assert.rejects(agent.reviewCreatorScript(userId, projectId, { ...review, note: "不同意见不是重放" }), /已有新版本/);
      const productionId = await syncContentToProduction(userId, projectId);
      assert.equal((await db.character.findFirstOrThrow({ where: { projectId: productionId } })).costume, "绿色外套");
      assert.equal(await syncContentToProduction(userId, projectId), productionId);
      const confirmed = accepted.scripts[0]!;
      await agent.reviewCreatorScript(userId, projectId, { ...review, expectedScriptId: confirmed.id, expectedRevision: accepted.revision,
        details: { ...details, characters: details.characters.map(character => ({ ...character, costume: "灰色外套" })) } });
      const revisedProduction = await syncContentToProduction(userId, projectId);
      assert.notEqual(revisedProduction, productionId);
      assert.equal((await db.character.findFirstOrThrow({ where: { projectId: productionId } })).costume, "绿色外套");
      assert.equal((await db.character.findFirstOrThrow({ where: { projectId: revisedProduction } })).costume, "灰色外套");
      assert.equal(await db.scriptDraft.count({ where: { projectId: productionId } }), 1);
    });
    await t.test("unknown provider results do not retry without acknowledgement", async () => {
      const { projectId } = await create();
      const { runId } = await plan(projectId, 2);
      const before = calls;
      respond = async () => { throw new Error("connection lost after submit"); };
      const state = await agent.executeCreatorRun(userId, projectId, runId);
      assert.equal(state.runs[0]?.status, "unknown");
      assert.equal(calls - before, 1);
      await assert.rejects(agent.executeCreatorRun(userId, projectId, runId), /尚未核对/);
      await assert.rejects(agent.acknowledgeUnknownRun(userId, projectId, runId, { supplierChecked: false }));
      await agent.acknowledgeUnknownRun(userId, projectId, runId, { supplierChecked: true });
      assert.equal((await agent.getCreatorState(userId, projectId)).runs[0]?.status, "canceled");
      assert.equal((await db.creditAccount.findUniqueOrThrow({ where: { userId } })).frozenBalance, 0);
    });
    await t.test("pending cancellation and stale inputs make zero external calls", async () => {
      const { projectId } = await create();
      const first = await plan(projectId);
      await agent.cancelCreatorRun(userId, projectId, first.runId);
      const before = calls;
      await agent.executeCreatorRun(userId, projectId, first.runId);
      assert.equal(calls, before);
      const second = await plan(projectId);
      await saveFact(userId, projectId, { subject: "阿青", predicate: "身份", value: "修表师", status: "locked" });
      await assert.rejects(agent.executeCreatorRun(userId, projectId, second.runId), /已修改/);
      assert.equal(calls, before);
    });
    await t.test("author locks survive conflicting model candidates and edits use revisions", async () => {
      const { projectId } = await create();
      const locked = await saveFact(userId, projectId, { subject: "阿青", predicate: "身份", value: "修表师", status: "locked" });
      const run = await plan(projectId);
      respond = async () => response({ ...valid, factUpdates: [{ subject: "阿青", predicate: "身份", value: "医生", validFrom: 1 }] });
      const state = await agent.executeCreatorRun(userId, projectId, run.runId);
      assert.equal((await db.storyFact.findUniqueOrThrow({ where: { id: locked.id } })).value, "修表师");
      assert.equal(state.runs[0]?.status, "needs_repair");
      assert.ok(state.facts.some(f => f.status === "candidate" && f.value === "医生"));
      await assert.rejects(saveFact(userId, projectId, { subject: "阿青", predicate: "身份", value: "医生", status: "locked" }), /锁定设定冲突/);
      await assert.rejects(saveFact(userId, projectId, { subject: "阿青", predicate: "身份", value: "医生", status: "locked", expectedRevision: 9 }, locked.id), /已有更新/);
    });
    await t.test("budget and permissions reject external work before reservation", async () => {
      const { projectId } = await create();
      const before = calls;
      await assert.rejects(agent.createCreatorRun(userId, projectId, { requestId: crypto.randomUUID(), expectedRevision: 1, maximumCredits: 0 }), /上限/);
      await assert.rejects(agent.createCreatorRun("other_user", projectId, { requestId: crypto.randomUUID(), expectedRevision: 1, maximumCredits: 10 }), /不存在/);
      assert.equal(calls, before);
    });
    await t.test("onboarding preferences are per user and analytics do not store source text", async () => {
      await agent.updateCreatorPreference(userId, { guideVersion: 1, guideState: "skipped" });
      assert.equal((await agent.creatorPreference(userId)).guideState, "skipped");
      assert.equal((await agent.creatorPreference("other_user")).guideState, "new");
      const events = await db.analyticsEvent.findMany({ where: { userId, sourceChannel: "creator_studio" } });
      assert.ok(events.length > 0);
      assert.ok(events.every(event => !JSON.stringify(event.properties).includes(valid.script)));
      const { creatorInsights } = await import("./creatorInsights.js");
      const insights = await creatorInsights();
      assert.ok(insights.stages.some(stage => stage.event === "creator_brief_saved" && stage.users > 0));
      assert.ok(insights.firstAccepted.projects > 0);
      assert.ok(insights.firstAccepted.medianSeconds !== null && insights.firstAccepted.medianSeconds >= 0);
    });
    await t.test("continuation preserves ownership, stable facts and material provenance without old shots", async () => {
      const { projectId } = await create();
      await saveFact(userId, projectId, { subject: "阿青", predicate: "身份", value: "修表师", status: "locked" });
      await saveFact(userId, projectId, { subject: "阿青", predicate: "伤势", value: "受伤", validFrom: 2, status: "confirmed" });
      const first = await plan(projectId);
      respond = async () => response(valid);
      let state = await agent.executeCreatorRun(userId, projectId, first.runId);
      const script = await db.scriptVersion.findFirstOrThrow({ where: { contentProjectId: projectId } });
      await agent.reviewCreatorScript(userId, projectId, { expectedScriptId: script.id, expectedRevision: state.revision, content: script.content, approve: true });
      const originId = await syncContentToProduction(userId, projectId);
      const role = await db.asset.findFirstOrThrow({ where: { projectId: originId, type: "role" } });
      await db.asset.update({ where: { id: role.id }, data: { status: "succeeded", referenceUrl: "/storage/fixture-reference.png" } });
      const continuation = { requestId: crypto.randomUUID(), title: "旧钟楼", intent: "阿青读懂钟楼的秘密" };
      const next = await agent.continueCreatorProject(userId, projectId, continuation);
      assert.equal((await agent.continueCreatorProject(userId, projectId, continuation)).id, next.id);
      await assert.rejects(agent.continueCreatorProject("other_user", projectId, { ...continuation, requestId: crypto.randomUUID() }), /不存在|无权/);
      state = await agent.getCreatorState(userId, next.id);
      assert.ok(state.facts.some(f => f.predicate === "身份" && f.status === "locked"));
      assert.ok(state.facts.some(f => f.predicate === "伤势" && f.status === "candidate"));
      assert.equal(await db.scriptVersion.count({ where: { contentProjectId: next.id } }), 0);
      const nextPlan = await plan(next.id);
      state = await agent.executeCreatorRun(userId, next.id, nextPlan.runId);
      const nextScript = await db.scriptVersion.findFirstOrThrow({ where: { contentProjectId: next.id } });
      await agent.reviewCreatorScript(userId, next.id, { expectedScriptId: nextScript.id, expectedRevision: state.revision, content: nextScript.content, approve: true });
      const nextProduction = await syncContentToProduction(userId, next.id);
      const reused = await db.asset.findFirstOrThrow({ where: { projectId: nextProduction, type: "role" } });
      assert.equal(reused.reusedFromAssetId, role.id);
      assert.equal(reused.referenceUrl, "/storage/fixture-reference.png");
      assert.equal(await db.storyboard.count({ where: { projectId: nextProduction } }), 0);
    });
  } finally {
    globalThis.fetch = fetchOriginal;
    await db.contentProject.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.modelProvider.deleteMany({ where: { id: providerId } });
    await db.$disconnect();
  }
});
