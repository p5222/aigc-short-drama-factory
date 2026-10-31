import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { CREATOR_GUIDE_VERSION, CREATOR_SKILL_VERSION, inspectModelPrice, type CreatorAgentState, type CreatorBrief, type CreatorFinding, type CreatorQuote, type StoryFact } from "@aifilm/shared";
import { prisma } from "../db/client.js";
import { callTextModelJson } from "../agents/generator.js";
import { materializeProductionPrompt } from "../prompts/production.js";
import { quotePrice } from "../billing/pricing.js";
import { assembleContext, estimateContextTokens } from "./contextBudget.js";
import { briefSchema, checkCreatorScript, creatorRunInput, creatorScriptSchema, creatorTools } from "./creatorContracts.js";
import { ContentMutationError, withIdleContentProject } from "./contentMutation.js";
import { collectFactCandidates, invalidateSourceFacts } from "./storyMemory.js";
import { runBilledContentGeneration, saveContentOperationOutput, withContentGenerationOperation } from "./generationBilling.js";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const hash = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const fail = (message: string): never => { throw new ContentMutationError(409, message); };
type Db = Prisma.TransactionClient;

export const shortProjectInput = z.object({
  requestId: z.string().uuid(), title: z.string().trim().min(1).max(160), brief: briefSchema,
  source: z.string().trim().max(12000).default(""),
  textProvider: z.string().min(1).max(120), textModel: z.string().min(1).max(160),
  styleProfile: z.record(z.string(), z.unknown()).default({})
}).strict().refine(x => x.brief.material === "idea" || x.source.length >= 20, "请填写已有故事或剧本");

export async function creatorEvent(tx: Db, userId: string, contentProjectId: string | null, eventName: string, properties: Record<string, unknown> = {}) {
  await tx.analyticsEvent.create({ data: {
    id: `event_${crypto.randomUUID()}`, userId, eventName, entityType: "creator", entityId: contentProjectId,
    properties: json(properties), sourceChannel: "creator_studio"
  } });
}
export async function creatorPreference(userId: string) {
  const [preference, productionCount, contentCount] = await Promise.all([
    prisma.creatorPreference.findUnique({ where: { userId } }),
    prisma.project.count({ where: { userId } }), prisma.contentProject.count({ where: { userId } })
  ]);
  return { guideVersion: CREATOR_GUIDE_VERSION, guideState: preference?.guideVersion === CREATOR_GUIDE_VERSION ? preference.guideState : "new", hasProjects: productionCount + contentCount > 0 };
}
export async function updateCreatorPreference(userId: string, raw: unknown) {
  const input = z.object({ guideVersion: z.literal(CREATOR_GUIDE_VERSION), guideState: z.enum(["shown", "skipped", "started", "completed"]) }).strict().parse(raw);
  await prisma.$transaction(async tx => {
    await tx.creatorPreference.upsert({ where: { userId }, create: { userId, ...input }, update: input });
    await creatorEvent(tx, userId, null, `creator_guide_${input.guideState}`, { guideVersion: input.guideVersion });
  });
  return creatorPreference(userId);
}
export async function createShortProject(userId: string, raw: unknown) {
  const input = shortProjectInput.parse(raw);
  const key = `creator:${userId}:${input.requestId}`;
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${key}))`;
    const existing = await tx.contentProject.findUnique({ where: { importKey: key }, include: { sources: true } });
    if (existing) {
      if (object(existing.sources[0]?.metadata).creationHash !== hash(input)) fail("同一创建请求的内容已改变，请使用新的请求编号。");
      return { id: existing.id };
    }
    const provider = await tx.modelProvider.findFirst({ where: { id: input.textProvider, enabled: true, modality: "text" } });
    if (!provider?.models.includes(input.textModel)) fail("所选文本模型不可用");
    const id = `content_${crypto.randomUUID()}`;
    await tx.contentProject.create({ data: { id, userId, title: input.title, mode: input.brief.material === "idea" ? "original" : "adaptation",
      brief: json(input.brief), styleProfile: json(input.styleProfile), textProvider: input.textProvider, textModel: input.textModel, importKey: key,
      sources: { create: { id: `source_${crypto.randomUUID()}`, kind: input.brief.material === "script" ? "script" : input.brief.material === "idea" ? "idea" : "short_story",
        title: input.title, content: input.source || input.brief.intent, metadata: { creationHash: hash(input) } } }
    } });
    await creatorEvent(tx, userId, id, "creator_brief_saved", { durationSeconds: input.brief.durationSeconds, material: input.brief.material });
    return { id };
  });
}

export async function updateCreatorBrief(userId: string, contentProjectId: string, raw: unknown) {
  const input = z.object({ brief: briefSchema, expectedRevision: z.number().int().positive() }).strict().parse(raw);
  await withIdleContentProject(userId, contentProjectId, async tx => {
    const row = await tx.contentProject.findUniqueOrThrow({ where: { id: contentProjectId } });
    if (row.revision !== input.expectedRevision) fail("作品已有更新，请刷新后核对。");
    if (hash(row.brief) === hash(input.brief)) return;
    await tx.contentProject.update({ where: { id: contentProjectId }, data: { brief: json(input.brief), revision: { increment: 1 } } });
    await tx.scriptVersion.updateMany({ where: { contentProjectId }, data: { status: "stale" } });
    await tx.productionEpisode.updateMany({ where: { contentProjectId }, data: { status: "stale" } });
  });
  return getCreatorState(userId, contentProjectId);
}

export async function continueCreatorProject(userId: string, contentProjectId: string, raw: unknown) {
  const input = z.object({ requestId: z.string().uuid(), title: z.string().trim().min(1).max(160), intent: z.string().trim().min(2).max(3000) }).strict().parse(raw);
  return withIdleContentProject(userId, contentProjectId, async tx => {
    const key = `creator-next:${userId}:${input.requestId}`;
    const existing = await tx.contentProject.findUnique({ where: { importKey: key } });
    if (existing) {
      if (existing.parentContentId !== contentProjectId || object(existing.brief).intent !== input.intent || existing.title !== input.title) fail("同一续创请求的内容已改变。");
      return { id: existing.id };
    }
    const parent = await tx.contentProject.findUniqueOrThrow({ where: { id: contentProjectId }, include: { facts: { where: { status: { in: ["confirmed", "locked"] } } } } });
    const brief = briefSchema.parse(parent.brief);
    const id = `content_${crypto.randomUUID()}`;
    await tx.contentProject.create({ data: { id, userId, title: input.title, mode: "original",
      parentContentId: contentProjectId, importKey: key, brief: json({ ...brief, intent: input.intent, material: "idea" }),
      styleProfile: json(parent.styleProfile), textProvider: parent.textProvider, textModel: parent.textModel,
      sources: { create: { id: `source_${crypto.randomUUID()}`, kind: "idea", title: input.title, content: input.intent, metadata: { parentContentId: contentProjectId, parentRevision: parent.revision } } }
    } });
    // Carry the source and time scopes; temporal states remain candidates for the
    // author to place on this episode's timeline before becoming constraints.
    for (const fact of parent.facts) {
      const stable = fact.validFrom === 1 && fact.validTo === null && ["身份", "姓名", "世界规则", "identity", "name", "world_rule"].includes(fact.predicate);
      await tx.storyFact.create({ data: { id: `fact_${crypto.randomUUID()}`, contentProjectId: id, subject: fact.subject, predicate: fact.predicate,
        value: fact.value, status: stable ? fact.status : "candidate", validFrom: fact.validFrom, validTo: fact.validTo, knownBy: fact.knownBy,
        sourceType: "reused_fact", sourceId: fact.id, sourceVersion: fact.revision } });
    }
    await creatorEvent(tx, userId, id, "creator_next_episode_started", { parentContentId: contentProjectId, parentRevision: parent.revision, reusedFacts: parent.facts.length });
    return { id };
  });
}

async function prepare(userId: string, contentProjectId: string, feedback = "", baseScriptId?: string) {
  const project = await prisma.contentProject.findFirst({ where: { id: contentProjectId, userId }, include: {
    sources: { orderBy: { updatedAt: "desc" }, take: 1 }, facts: true, scripts: { orderBy: { version: "desc" }, take: 1 }
  } });
  if (!project) throw new ContentMutationError(404, "内容项目不存在");
  const brief = briefSchema.parse(project.brief);
  const baseScript = project.scripts[0];
  if (baseScriptId && baseScript?.id !== baseScriptId) fail("修订所依据的剧本已有变化，请刷新后重试。");
  // A short script can span several story times or include a flashback; retain
  // every author-approved scope rather than flattening to the first scene.
  const facts = project.facts.filter(f => ["confirmed", "locked"].includes(f.status)) as StoryFact[];
  const { selected, manifest } = assembleContext([
    { id: "brief", label: "创作意图", content: brief, required: true },
    { id: "source", label: "当前素材", content: project.sources[0]?.content ?? brief.intent, required: true },
    { id: "memory", label: "作者确认设定", content: facts, required: true },
    { id: "style", label: "视觉风格", content: project.styleProfile, required: true },
    ...(baseScriptId ? [{ id: "baseScript", label: "待修订剧本", content: baseScript!.content, required: true }] : [])
  ]);
  const repair = feedback || "首次生成；先完成短剧本，等待作者确认。";
  const prompt = await materializeProductionPrompt("creator_short_script", { context: selected, repair });
  const actualEstimate = estimateContextTokens(`${prompt.systemPrompt}\n${prompt.userPrompt}`);
  if (actualEstimate + manifest.reservedOutputTokens + manifest.safetyTokens > manifest.budgetTokens) fail("素材和提示词合计超过本步预算，请缩小素材范围。");
  manifest.estimatedInputTokens = actualEstimate;
  manifest.sources.push({ id: "instructions", label: "技能说明与修订要求", required: true, included: true,
    estimatedTokens: estimateContextTokens(`${prompt.systemPrompt}\n${repair}`) });
  const rows = await prisma.modelPrice.findMany({ where: { providerId: project.textProvider, model: project.textModel, modality: "text", enabled: true }, take: 2 });
  const price = inspectModelPrice(rows, { providerId: project.textProvider, model: project.textModel, modality: "text" }).price;
  if (!price) fail("所选模型尚无唯一有效价格，请联系管理员核对。");
  // A repair can be larger than the first prompt; the same conservative per-call
  // ceiling covers both, and actual usage is settled by the existing ledger.
  const billingInput = { inputTokens: manifest.budgetTokens - manifest.reservedOutputTokens - manifest.safetyTokens, outputTokens: manifest.reservedOutputTokens, cachedInputTokens: 0 };
  const perCallCredits = await quotePrice(price!, billingInput);
  return { project, brief, facts, selected, manifest, prompt, billingInput, perCallCredits };
}
export async function quoteCreatorRun(userId: string, contentProjectId: string, raw: unknown): Promise<CreatorQuote> {
  const input = creatorRunInput.pick({ maxCalls: true, feedback: true, baseScriptId: true }).parse(raw);
  const prepared = await prepare(userId, contentProjectId, input.feedback, input.baseScriptId);
  return { provider: prepared.project.textProvider, model: prepared.project.textModel, maxCalls: input.maxCalls,
    perCallCredits: prepared.perCallCredits, maximumCredits: prepared.perCallCredits * input.maxCalls, inputRevision: prepared.project.revision, context: prepared.manifest };
}
export async function createCreatorRun(userId: string, contentProjectId: string, raw: unknown) {
  const input = creatorRunInput.parse(raw);
  const existing = await prisma.creatorRun.findUnique({ where: { userId_requestId: { userId, requestId: input.requestId } } });
  if (existing) {
    if (existing.contentProjectId !== contentProjectId || existing.inputHash !== hash(input)) fail("同一执行请求的输入已改变，请创建新的执行请求。");
    return { id: existing.id };
  }
  const p = await prepare(userId, contentProjectId, input.feedback, input.baseScriptId);
  if (p.project.revision !== input.expectedRevision) fail("作品已有更新，请重新报价。");
  if (p.perCallCredits * input.maxCalls > input.maximumCredits) fail("报价超过已批准上限，请重新报价。");
  return withIdleContentProject(userId, contentProjectId, async tx => {
    const previous = await tx.creatorRun.findUnique({ where: { userId_requestId: { userId, requestId: input.requestId } } });
    if (previous) {
      if (previous.contentProjectId !== contentProjectId || previous.inputHash !== hash(input)) fail("同一执行请求的输入已改变。");
      return { id: previous.id };
    }
    const project = await tx.contentProject.findUniqueOrThrow({ where: { id: contentProjectId } });
    if (project.revision !== p.project.revision) fail("作品版本已变化，请重新报价。");
    if (await tx.creatorRun.count({ where: { contentProjectId, status: { in: ["pending", "running", "unknown"] } } })) fail("已有未结束的执行计划，请先查看或恢复该计划。");
    const run = await tx.creatorRun.create({ data: {
      id: `creator_run_${crypto.randomUUID()}`, userId, contentProjectId, requestId: input.requestId, inputHash: hash(input),
      inputRevision: project.revision, skillVersion: CREATOR_SKILL_VERSION, maxCalls: input.maxCalls, maximumCredits: input.maximumCredits,
      input: json({ brief: p.brief, facts: p.facts, context: p.selected, prompt: p.prompt, manifest: p.manifest, perCallCredits: p.perCallCredits,
        billingInput: p.billingInput, provider: project.textProvider, model: project.textModel, feedback: input.feedback, baseScriptId: input.baseScriptId })
    } });
    await creatorEvent(tx, userId, contentProjectId, "creator_plan_approved", { maxCalls: input.maxCalls, maximumCredits: input.maximumCredits, skillVersion: CREATOR_SKILL_VERSION });
    return { id: run.id };
  });
}

export async function executeCreatorRun(userId: string, contentProjectId: string, runId: string) {
  return withContentGenerationOperation(userId, contentProjectId, "首作短剧本", async () => {
    let run = await prisma.creatorRun.findFirst({ where: { id: runId, userId, contentProjectId }, include: { steps: { orderBy: { sequence: "asc" } } } });
    if (!run) throw new ContentMutationError(404, "执行计划不存在");
    if (["completed", "awaiting_review", "canceled"].includes(run.status) || (run.status === "needs_repair" && run.error)) return getCreatorState(userId, contentProjectId);
    if (run.status === "unknown") fail("供应商结果尚未核对，已停止自动重试。");
    // An expired operation lease cannot prove that the supplier did no work.
    if (run.steps.some(step => step.status === "running")) {
      await saveContentOperationOutput(tx => tx.creatorRun.update({ where: { id: runId }, data: { status: "unknown", error: "上次调用中断，供应商结果未知。请核对任务与账单后结束该计划。" } }));
      return getCreatorState(userId, contentProjectId);
    }
    const project = await prisma.contentProject.findUniqueOrThrow({ where: { id: contentProjectId } });
    if (project.revision !== run.inputRevision) fail("计划依据的作品已修改，请按新版本创建计划。");
    const input = object(run.input);
    if (project.textProvider !== input.provider || project.textModel !== input.model) fail("所选模型已变化，请重新报价。");
    if (run.cancelRequested) {
      await saveContentOperationOutput(tx => tx.creatorRun.update({ where: { id: runId }, data: { status: "canceled" } }));
      return getCreatorState(userId, contentProjectId);
    }
    await saveContentOperationOutput(tx => tx.creatorRun.update({ where: { id: runId }, data: { status: "running", error: null } }));
    try {
      while (true) {
        run = await prisma.creatorRun.findUniqueOrThrow({ where: { id: runId }, include: { steps: { orderBy: { sequence: "asc" } } } });
        if (run.cancelRequested) {
          await saveContentOperationOutput(tx => tx.creatorRun.update({ where: { id: runId }, data: { status: "canceled" } }));
          break;
        }
        const attempted = run.steps.filter(step => step.taskId);
        if (attempted.length >= run.maxCalls) {
          await saveContentOperationOutput(tx => tx.creatorRun.update({ where: { id: runId }, data: { status: "needs_repair", error: "已达到本计划调用上限。请手动修改，或核对后创建新的修订计划。" } }));
          break;
        }
        const previous = attempted.at(-1);
        const tool = previous ? "repair_short_script" : "write_short_script";
        const sequence = run.steps.length + 1;
        let prompt = object(input.prompt);
        if (previous) {
          const prior = object(previous.output);
          prompt = await materializeProductionPrompt("creator_short_script", { context: input.context,
            repair: { author: input.feedback || "", findings: previous.findings, previousResult: prior.raw ?? prior.script, instruction: "只修复检查指出的问题；保留其余内容，不修改作者锁定事实。" } });
        }
        const estimatedInputTokens = estimateContextTokens(`${prompt.systemPrompt}\n${prompt.userPrompt}`);
        const manifest = { ...input.manifest, estimatedInputTokens };
        if (estimatedInputTokens + manifest.reservedOutputTokens + manifest.safetyTokens > manifest.budgetTokens) fail("修订资料超过上下文预算，请手动缩小修订范围。");
        const provider = await prisma.modelProvider.findFirst({ where: { id: project.textProvider, enabled: true, modality: "text" } });
        if (!provider || !provider.models.includes(project.textModel)) throw new ContentMutationError(409, "报价模型当前不可用，未替换模型。");
        const stepId = `creator_step_${crypto.randomUUID()}`;
        await runBilledContentGeneration(project, previous ? "定向修订短剧本" : "生成短剧本", async () => callTextModelJson<unknown>({
          textProvider: project.textProvider, textModel: project.textModel, baseUrl: provider.baseUrl ?? undefined,
          singleSubmission: true,
          apiKey: ["manjiao", "pipp"].includes(project.textProvider) ? undefined : provider.apiKey ?? undefined,
          system: String(prompt.systemPrompt), prompt: String(prompt.userPrompt), maxTokens: creatorTools[tool].maxOutputTokens, label: "首作短剧本"
        }), async (tx, raw) => {
          const live = await tx.creatorRun.findUniqueOrThrow({ where: { id: runId } });
          const currentProject = await tx.contentProject.findUniqueOrThrow({ where: { id: contentProjectId } });
          if (currentProject.revision !== live.inputRevision) fail("输入版本已变化，旧结果不会覆盖当前作品。");
          const checked = checkCreatorScript(raw, input.brief.durationSeconds, input.facts);
          const blocked = checked.findings.some(finding => finding.severity === "blocking");
          let scriptId: string | undefined;
          if (checked.script) {
            const latest = await tx.scriptVersion.findFirst({ where: { contentProjectId }, orderBy: { version: "desc" } });
            scriptId = `content_script_${crypto.randomUUID()}`;
            await tx.scriptVersion.create({ data: { id: scriptId, contentProjectId, version: (latest?.version ?? 0) + 1,
              status: "draft", content: checked.script.script, result: json({ ...checked.script, findings: checked.findings, runId }),
              promptSnapshot: json({ ...prompt.snapshot, skillVersion: CREATOR_SKILL_VERSION, tool: creatorTools[tool], inputRevision: live.inputRevision, contextManifest: manifest }) } });
            if (latest) await invalidateSourceFacts(tx, contentProjectId, latest.id);
            await collectFactCandidates(tx, contentProjectId, checked.script.factUpdates, { id: scriptId, version: (latest?.version ?? 0) + 1, type: "script", storyTime: 1 });
          }
          await tx.creatorStep.update({ where: { id: stepId }, data: { status: "completed", output: json({ raw, scriptId }), findings: json(checked.findings) } });
          const noProgress = previous && hash((previous.findings as unknown as CreatorFinding[]).filter(f => f.severity === "blocking")) === hash(checked.findings.filter(f => f.severity === "blocking"));
          await tx.creatorRun.update({ where: { id: runId }, data: {
            status: live.cancelRequested ? "canceled" : blocked ? "needs_repair" : "awaiting_review",
            error: blocked && noProgress ? "定向修订没有消除已发现问题，已停止自动修订。请作者核对。" : null
          } });
          await tx.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "script", status: "draft" } });
          await creatorEvent(tx, userId, contentProjectId, "creator_script_generated", { structurePassed: !blocked, sequence });
        }, {
          maximumCredits: input.perCallCredits, billingInput: input.billingInput,
          onReserved: async (tx, taskId, maximumCredits) => {
            const live = await tx.creatorRun.findUniqueOrThrow({ where: { id: runId }, include: { steps: true } });
            if (live.cancelRequested || live.status !== "running") fail("计划已停止，未提交新调用。");
            const taskIds = live.steps.flatMap(step => step.taskId ? [step.taskId] : []);
            const prior = await tx.generationTask.aggregate({ where: { id: { in: taskIds }, userId }, _sum: { estimatedCredits: true } });
            if (taskIds.length >= live.maxCalls || (prior._sum.estimatedCredits ?? 0) + maximumCredits > live.maximumCredits) fail("执行已达到批准的调用次数或积分上限。");
            await tx.creatorStep.create({ data: { id: stepId, runId, sequence, tool: `${tool}@${creatorTools[tool].version}`, status: "running", taskId, inputManifest: json(manifest) } });
          }
        });
        const after = await prisma.creatorRun.findUniqueOrThrow({ where: { id: runId } });
        if (after.status !== "needs_repair" || after.error || sequence >= run.maxCalls) break;
        await saveContentOperationOutput(tx => tx.creatorRun.update({ where: { id: runId }, data: { status: "running" } }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "执行失败";
      await saveContentOperationOutput(async tx => {
        const unfinished = await tx.creatorStep.findFirst({ where: { runId, status: "running" } });
        // Conservatively stop whenever an external request might have been sent.
        await tx.creatorRun.update({ where: { id: runId }, data: { status: unfinished ? "unknown" : "failed", error: unfinished ? `供应商结果待核对；未自动重试。${message}` : message } });
        if (unfinished) await tx.creatorStep.update({ where: { id: unfinished.id }, data: { status: "unknown", error: message } });
      });
    }
    return getCreatorState(userId, contentProjectId);
  });
}

export async function cancelCreatorRun(userId: string, contentProjectId: string, runId: string) {
  const changed = await prisma.creatorRun.updateMany({ where: { id: runId, userId, contentProjectId, status: { in: ["pending", "running", "needs_repair", "failed"] } },
    data: { cancelRequested: true } });
  if (!changed.count) fail("当前计划不能取消；结果未知时请先核对供应商状态。");
  // An in-flight request may still finish and incur the previously quoted cost.
  await prisma.creatorRun.updateMany({ where: { id: runId, userId, status: { in: ["pending", "needs_repair", "failed"] } }, data: { status: "canceled" } });
  return getCreatorState(userId, contentProjectId);
}
export async function acknowledgeUnknownRun(userId: string, contentProjectId: string, runId: string, raw: unknown) {
  z.object({ supplierChecked: z.literal(true) }).strict().parse(raw);
  await withIdleContentProject(userId, contentProjectId, async tx => {
    const changed = await tx.creatorRun.updateMany({ where: { id: runId, userId, contentProjectId, status: "unknown" }, data: { status: "canceled", cancelRequested: true, error: "作者已声明核对供应商结果并结束计划；不代表供应商未发生费用。" } });
    if (!changed.count) fail("当前计划不处于结果待核对状态。");
    await creatorEvent(tx, userId, contentProjectId, "creator_unknown_acknowledged", { runId });
  });
  return getCreatorState(userId, contentProjectId);
}

export async function reviewCreatorScript(userId: string, contentProjectId: string, raw: unknown) {
  const input = z.object({ expectedScriptId: z.string().min(1), expectedRevision: z.number().int().positive(),
    content: z.string().trim().min(80).max(14000), approve: z.boolean(), note: z.string().trim().max(2000).default(""),
    details: creatorScriptSchema.pick({ estimatedSeconds: true, characters: true, scenes: true, props: true }).optional() }).strict().parse(raw);
  await withIdleContentProject(userId, contentProjectId, async tx => {
    const project = await tx.contentProject.findUniqueOrThrow({ where: { id: contentProjectId } });
    const latest = await tx.scriptVersion.findFirst({ where: { contentProjectId }, orderBy: { version: "desc" } });
    if (!latest) fail("请先生成短剧本。");
    const previous = latest!;
    if (previous.id !== input.expectedScriptId) {
      if (previous.content === input.content && object(previous.result).authorReview?.baseScriptId === input.expectedScriptId
        && Boolean(object(previous.result).authorReview?.approved) === input.approve
        && object(previous.result).authorReview?.note === input.note
        && (!input.details || hash(creatorScriptSchema.pick({ estimatedSeconds: true, characters: true, scenes: true, props: true }).parse(previous.result)) === hash(input.details))) return;
      fail("剧本已有新版本；请保留本地草稿并刷新后核对。");
    }
    if (project.revision !== input.expectedRevision) fail("作品设定已有更新，请刷新后再确认剧本。");
    if (previous.status === "stale") fail("剧本依据的设定已变化，请先按新设定修订。");
    const brief = briefSchema.parse(project.brief);
    const facts = await tx.storyFact.findMany({ where: { contentProjectId } });
    const result: Record<string, any> = { ...object(previous.result), ...input.details };
    const checked = checkCreatorScript({ ...result, script: input.content }, brief.durationSeconds, facts as StoryFact[]);
    if (input.approve && checked.findings.some(f => f.severity === "blocking")) fail("结构或锁定设定检查尚未通过，请先完成修订。");
    const scriptId = `content_script_${crypto.randomUUID()}`;
    const review = { approved: input.approve, note: input.note, baseScriptId: previous.id, authorId: userId, reviewedAt: new Date().toISOString() };
    await tx.scriptVersion.create({ data: { id: scriptId, contentProjectId, version: previous.version + 1, content: input.content,
      status: input.approve ? "confirmed" : "draft", result: json({ ...result, script: input.content, findings: checked.findings, authorReview: review }),
      promptSnapshot: json({ ...object(previous.promptSnapshot), authorReview: review }) } });
    if (input.content !== previous.content) await invalidateSourceFacts(tx, contentProjectId, previous.id);
    await tx.productionEpisode.updateMany({ where: { contentProjectId }, data: { status: "stale" } });
    if (input.approve) {
      const episode = await tx.productionEpisode.upsert({ where: { contentProjectId_episodeNo: { contentProjectId, episodeNo: 1 } },
        create: { id: `episode_${crypto.randomUUID()}`, contentProjectId, episodeNo: 1, title: result.title || project.title, sourceStart: 0, sourceEnd: input.content.length,
          sourceCharacterCount: input.content.length, targetDurationSeconds: brief.durationSeconds },
        update: { title: result.title || project.title, targetDurationSeconds: brief.durationSeconds, sourceEnd: input.content.length, sourceCharacterCount: input.content.length } });
      const max = await tx.episodeScriptVersion.aggregate({ where: { episodeId: episode.id }, _max: { version: true } });
      const version = (max._max.version ?? 0) + 1;
      await tx.episodeScriptVersion.create({ data: { id: `episode_script_${crypto.randomUUID()}`, episodeId: episode.id, version, status: "confirmed",
        content: input.content, structuredResult: json({ ...result, script: input.content }), promptSnapshot: json({ sourceScriptId: scriptId, authorReview: review }) } });
      await tx.productionEpisode.update({ where: { id: episode.id }, data: { activeScriptVersion: version, status: "confirmed" } });
      await tx.creatorRun.updateMany({ where: { id: result.runId ?? "", userId, contentProjectId }, data: { status: "completed" } });
      await tx.contentProject.update({ where: { id: contentProjectId }, data: { activeStep: "script", status: "confirmed", revision: { increment: 1 } } });
      await tx.creatorPreference.upsert({ where: { userId }, create: { userId, guideVersion: CREATOR_GUIDE_VERSION, guideState: "completed" }, update: { guideVersion: CREATOR_GUIDE_VERSION, guideState: "completed" } });
    }
    await creatorEvent(tx, userId, contentProjectId, input.approve ? "creator_script_accepted" : "creator_script_edited",
      { scriptId, baseScriptId: previous.id, changed: previous.content !== input.content || Boolean(input.details && hash(input.details) !== hash(creatorScriptSchema.pick({ estimatedSeconds: true, characters: true, scenes: true, props: true }).parse(previous.result))) });
  });
  return getCreatorState(userId, contentProjectId);
}

export async function getCreatorState(userId: string, contentProjectId: string): Promise<CreatorAgentState> {
  const project = await prisma.contentProject.findFirst({ where: { id: contentProjectId, userId }, include: {
    facts: { where: { status: { not: "superseded" } }, orderBy: { createdAt: "desc" }, take: 300 },
    creatorRuns: { orderBy: { createdAt: "desc" }, take: 20, include: { steps: { orderBy: { sequence: "asc" } } } },
    scripts: { orderBy: { version: "desc" }, take: 20 }
  } });
  if (!project) throw new ContentMutationError(404, "内容项目不存在");
  const ids = project.creatorRuns.flatMap(run => run.steps.flatMap(step => step.taskId ? [step.taskId] : []));
  const tasks = await prisma.generationTask.findMany({ where: { id: { in: ids }, userId } });
  const brief = briefSchema.safeParse(project.brief);
  return {
    brief: brief.success ? brief.data : null, revision: project.revision, parentContentId: project.parentContentId,
    facts: project.facts as StoryFact[],
    scripts: project.scripts.map(script => ({ id: script.id, version: script.version, status: script.status, content: script.content,
      createdAt: script.createdAt.toISOString(), findings: object(script.result).findings ?? [],
      details: creatorScriptSchema.pick({ estimatedSeconds: true, characters: true, scenes: true, props: true }).safeParse(script.result).success
        ? creatorScriptSchema.pick({ estimatedSeconds: true, characters: true, scenes: true, props: true }).parse(script.result) : undefined,
      authorReview: object(script.result).authorReview })),
    nextAction: !brief.success ? "brief" : !project.scripts[0] ? "script" : project.scripts[0].status === "confirmed" ? "production" : "review",
    runs: project.creatorRuns.map(run => ({
      id: run.id, requestId: run.requestId, inputRevision: run.inputRevision, skillVersion: run.skillVersion,
      status: run.status as CreatorAgentState["runs"][number]["status"], maxCalls: run.maxCalls, maximumCredits: run.maximumCredits,
      cancelRequested: run.cancelRequested, error: run.error, createdAt: run.createdAt.toISOString(),
      feedback: object(run.input).feedback ?? "", baseScriptId: object(run.input).baseScriptId,
      steps: run.steps.map(step => {
        const task = tasks.find(t => t.id === step.taskId), calls = object(task?.billingUsage).calls;
        const usage = Array.isArray(calls) && calls.length ? calls.reduce((sum, call) => ({
          inputTokens: sum.inputTokens + (call.usage?.inputTokens ?? 0), outputTokens: sum.outputTokens + (call.usage?.outputTokens ?? 0),
          cachedInputTokens: sum.cachedInputTokens + (call.usage?.cachedInputTokens ?? 0)
        }), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }) : null;
        const settlement = object(task?.billingSettlement);
        return { id: step.id, sequence: step.sequence, tool: step.tool, status: step.status, taskId: step.taskId,
          inputManifest: step.inputManifest as any, findings: step.findings as unknown as CreatorFinding[], error: step.error,
          scriptId: object(step.output).scriptId, credits: task?.finalCredits ?? null, usage,
          costMicros: typeof settlement.costMicros === "number" ? settlement.costMicros : null, costStatus: settlement.costStatus ?? "unknown" };
      })
    }))
  };
}
