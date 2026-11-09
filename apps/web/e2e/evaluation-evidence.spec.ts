import { test, expect, type Page } from "@playwright/test";
import type { EvaluationAttempt, EvaluationRun, EvaluationRunDetail } from "@aifilm/shared";

// UI fixtures verify interaction, not supplier quality, media or billing.
const stamp = "2026-11-08T03:00:00Z";
const project = { id: "eval-project", name: "雨夜归人", type: "漫剧", status: "draft", sourceType: "script", artStyle: "国漫", videoRatio: "9:16", episodes: 1, updatedAt: stamp };
const report = { id: "report", projectId: project.id, stage: "script" as const, evidenceScope: "text" as const, evaluatorType: "ai" as const, totalScore: 0, pass: false, dimensionScores: {}, problems: ["人物动机待补充"], suggestions: ["明确回到书店的原因"], recommendedAction: "revise_text", createdAt: stamp, updatedAt: stamp };
const attempt: EvaluationAttempt = {
  id: "attempt-text", runId: "eval-run", channel: "text", evaluatorKey: "text:judge/model", contractHash: "contract-hash",
  contract: { coverage: { items: 1, totalItems: 1 }, includeFeedback: false }, status: "succeeded", reviewVersion: 0,
  sample: { id: "sample", projectId: project.id, stage: "script", sampleKey: "eval-project:script", fingerprint: "f".repeat(64), createdAt: stamp,
    snapshot: { project, scripts: [{ id: "script", content: "林初推开旧书店的门，将那封迟来的信放在桌上。", synopsis: "一封迟来的信" }], assets: [] } },
  report, usage: { calls: [] }, cost: { status: "unknown" }, reviews: []
};
const run: EvaluationRun = {
  id: "eval-run", name: "书店剧本基线", protocolVersion: 2, datasetSnapshot: {}, projectIds: [project.id], stages: ["script"], mode: "llm",
  evaluatorModels: [], promptSnapshot: {}, generationPromptSnapshot: {}, maxLlmCalls: 1, maxShotsPerPrompt: 8, includeFeedback: false, status: "completed",
  usage: { ruleReports: 0, llmReports: 1, llmCalls: 1, llmFailures: 0, estimatedPromptItems: 1, unknownCostCalls: 1 },
  summary: { reportCount: 1, projectCount: 1, averageScore: 0, passCount: 0, passRate: 0, stageScores: [], channels: [{ channel: "text:judge/model", reports: 1, averageScore: 0, passRate: 0 }] },
  startedAt: stamp, createdAt: stamp, updatedAt: stamp, skipped: []
};
async function fixtures(page: Page, options: { dark?: boolean; legacy?: boolean; lost?: boolean; media?: boolean; unknown?: boolean; experiment?: boolean } = {}) {
  await page.addInitScript(({ dark }) => { localStorage.setItem("aifilm_auth_token", "evaluation-admin-fixture"); localStorage.setItem("manjiao-theme", dark ? "dark" : "light"); }, options);
  const detail: EvaluationRunDetail = structuredClone({ run, reports: [report], attempts: [attempt], calibration: { reviewed: 0, agreed: 0, disagreed: 0 } });
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let failDetail = false;
  if (options.legacy) { detail.run.protocolVersion = 1; detail.attempts = []; }
  if (options.unknown) { detail.attempts![0].status = "unknown"; detail.attempts![0].report = undefined; detail.run.status = "needs_review"; }
  if (options.media) {
    detail.attempts![0] = { ...detail.attempts![0], channel: "structure", sample: { ...detail.attempts![0].sample, stage: "video" } };
  }
  const paged = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 100, totalPages: 1 });
  const feedback = { id: "feedback", projectId: project.id, userId: "author", stage: "script", rating: 2, usability: "unusable", tags: ["人物动机"], content: "为何回到书店没有说明", status: "open", priority: "p1", source: "creator", createdAt: "2026-11-08T02:00:00Z", version: 0 };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (method !== "GET") {
      const body = route.request().postDataJSON() ?? {};
      writes.push({ path, body });
      if (path === "/admin/evaluation/run") {
        if (options.lost) return route.abort("failed");
        return route.fulfill({ json: { run: detail.run, reports: detail.reports, projects: 1, stages: ["script"], mode: "rules", usage: detail.run.usage, skipped: [] } });
      }
      if (path.endsWith("/reviews")) {
        const a = detail.attempts![0];
        a.reviewVersion++;
        a.reviews.unshift({ id: "review-1", attemptId: a.id, version: a.reviewVersion, fingerprint: a.sample.fingerprint, scope: body.scope, verdict: body.verdict, reason: body.reason, mediaIds: [], createdAt: stamp });
        return route.fulfill({ json: { id: "review-1", version: a.reviewVersion } });
      }
      if (path.endsWith("/reconcile")) {
        detail.attempts![0].status = "failed";
        detail.attempts![0].reconciliation = { outcome: body.outcome, reason: body.reason, reference: body.reference, reconciledAt: stamp };
        return route.fulfill({ json: { id: "attempt-text", reconciled: true } });
      }
      if (path === "/admin/feedback/feedback/dataset") return route.fulfill({ json: { feedback: { ...feedback, status: "processing", version: 1, convertedDatasetId: "dataset" }, dataset: { id: "dataset" } } });
      if (path === "/admin/feedback/feedback") return route.fulfill({ json: { ...feedback, ...body, version: 2 } });
    }
    if (path === "/admin/evaluation/runs/eval-run" || path.startsWith("/admin/evaluation/requests/")) {
      if (failDetail) return route.fulfill({ status: 503, json: { message: "证据暂不可读" } });
      return route.fulfill({ json: detail });
    }
    if (path.endsWith("/media")) return route.fulfill({ json: [{ id: "media", name: "书店视频", type: "video", available: false, reason: "文件内容已变化，无法核验原样本" }] });
    const data: Record<string, unknown> = {
      "/auth/me": { user: { id: "operator", name: "运营", role: "admin", status: "active" } }, "/providers": [], "/model-prices": [], "/templates": [],
      "/admin/summary": {},
      "/admin/evaluation/overview": { northStar: { effectiveProjects: 0, totalProjects: 1, completionRate: 0 }, funnel: [], feedback: { total: 1, unusable: 1, topTags: [] }, failures: [], modelQuality: [], recentReports: [], recentFeedback: [feedback] },
      "/admin/evaluation/projects": [{ project, userName: "作者", reports: [], feedbacks: [feedback], latestStage: "script", averageScore: 0, blockedReasons: [] }],
      "/admin/evaluation/runs/page": paged([detail.run]), "/admin/evaluation/datasets/page": paged([]), "/admin/evaluation/prompt-versions": paged([]),
      "/admin/evaluation/experiments": paged(options.experiment ? [{ id: "experiment", name: "书店文本对比", experimentType: "prompt", stage: "script", winner: "pending",
        metrics: { comparability: { paired: 1, regressions: 0, changed: 1, unmatched: 0, channels: [{ channel: "structure", baseline: 70, candidate: 90 }], reasons: ["缺少可追溯的相同生成输入"] } } }] : []),
      "/admin/feedback/page": paged([feedback]),
      "/admin/quality-center": { summary: { successRate: 0, failureRate: 0, averageScore: 0, p95LatencyMs: 0, costAnomalies: 0, modelHealth: 0, openEvents: 1, sampleCount: 1 }, events: [], voc: [], modelMonitoring: [], lab: { datasets: [], runs: [detail.run], recentReports: [] }, samples: [], attribution: [], releaseGates: [], lineage: [], stageOptimization: { windowDays: 30, rows: [] }, generatedAt: stamp }
    };
    return route.fulfill({ json: data[path] ?? (path.endsWith("/page") ? paged([]) : []) });
  });
  return { detail, writes, failDetail: (value: boolean) => { failDetail = value; } };
}
async function openEvidence(page: Page) {
  await page.goto("/admin#评测闭环");
  await page.getByRole("button", { name: "评测记录", exact: true }).click();
  await page.getByRole("button", { name: "查看证据", exact: true }).click();
  return page.getByRole("dialog", { name: "评测证据与复核" });
}
for (const dark of [false, true]) test(`evidence review preserves zero and saves independent opinion ${dark ? "dark" : "light"}`, async ({ page }, info) => {
  const state = await fixtures(page, { dark });
  const dialog = await openEvidence(page);
  await expect(dialog.getByText("林初推开旧书店的门，将那封迟来的信放在桌上。", { exact: false })).toBeVisible();
  await expect(dialog.getByText("0 分 · 本范围未通过")).not.toBeVisible();
  await dialog.getByLabel("复核结论").selectOption("usable");
  await dialog.getByLabel("复核理由").fill("逐句查看了固定剧本，人物动机可由对白确认。");
  await dialog.getByRole("button", { name: "保存复核意见" }).click();
  await expect(dialog.getByText("第 1 版 · 文本评审 · 可用")).toBeVisible();
  const write = state.writes.find(w => w.path.endsWith("/reviews"))!;
  expect(write.body.expectedVersion).toBe(0); expect(write.body.fingerprint).toBe("f".repeat(64)); expect(write.body.requestId).toBeTruthy();
  await dialog.getByText("展开自动评分与执行证据", { exact: true }).click();
  await expect(dialog.getByText("0 分 · 本范围未通过")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await dialog.locator(".admin-modal-body").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? info.outputDir}/evaluation-evidence-${dark ? "dark" : "light"}-${info.project.name}.png` });
});
test("legacy, failed detail and changed media communicate evidence gaps", async ({ page }) => {
  const state = await fixtures(page, { legacy: true });
  const dialog = await openEvidence(page);
  await expect(dialog.getByText(/旧版记录没有固定样本/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存复核意见" })).toHaveCount(0);
  state.failDetail(true);
  await dialog.getByRole("button", { name: "刷新证据" }).click();
  await expect(dialog.getByRole("alert")).toContainText("证据暂不可读");
});
test("media cannot receive usable verdict without verified viewed files", async ({ page }) => {
  await fixtures(page, { media: true });
  const dialog = await openEvidence(page);
  await expect(dialog.getByText("文件内容已变化，无法核验原样本")).toBeVisible();
  await dialog.getByLabel("复核结论").selectOption("usable");
  await dialog.getByLabel("复核理由").fill("当前文件不可核验");
  await expect(dialog.getByRole("button", { name: "保存复核意见" })).toBeDisabled();
  await dialog.getByLabel("复核结论").selectOption("insufficient");
  await expect(dialog.getByRole("button", { name: "保存复核意见" })).toBeEnabled();
});
test("unknown supplier attempt closes with a durable reconciliation and no new run", async ({ page }) => {
  const state = await fixtures(page, { unknown: true });
  const dialog = await openEvidence(page);
  await expect(dialog.getByRole("button", { name: "保存复核意见" })).toBeDisabled();
  await dialog.getByLabel("核对依据").fill("provider-call-123");
  await dialog.getByLabel("核对处理说明").fill("已查看供应商终态记录，调用已失败。");
  await dialog.getByRole("button", { name: "保存核对结果" }).click();
  await expect(dialog.getByText(/已人工核对：供应商已失败/)).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].path).toBe("/admin/evaluation/attempts/attempt-text/reconcile");
});
test("lost run response keeps request and queries without resubmitting", async ({ page }) => {
  const state = await fixtures(page, { lost: true });
  await page.goto("/admin#评测闭环");
  await page.getByRole("button", { name: "运行评测", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "查询本次评测" })).toBeEnabled();
  expect(state.writes.filter(w => w.path.endsWith("/evaluation/run"))).toHaveLength(1);
  const body = state.writes[0].body;
  expect(body.requestId).toBeTruthy(); expect(body.includeFeedback).toBe(false); expect(body.stages).toEqual(["script"]);
  await page.getByRole("button", { name: "查询本次评测" }).click();
  await expect(page.getByRole("dialog", { name: "评测证据与复核" })).toBeVisible();
  expect(state.writes.filter(w => w.path.endsWith("/evaluation/run"))).toHaveLength(1);
});
test("experiment score improvement remains pending without production evidence", async ({ page }) => {
  await fixtures(page, { experiment: true });
  await page.goto("/admin#评测闭环");
  await page.getByRole("button", { name: "版本与实验", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "书店文本对比" });
  await expect(row.getByText("待验证", { exact: true })).toBeVisible();
  await expect(row.getByText("缺少可追溯的相同生成输入", { exact: true })).toBeVisible();
  await expect(row.getByText("候选更优", { exact: true })).toHaveCount(0);
  await expect(row.getByText("持平", { exact: true })).toHaveCount(0);
});
test("feedback captures atomically and requires a review to mark fixed", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/admin#用户反馈");
  await page.locator(".feedback-ops-card").first().click();
  await expect(page.getByRole("button", { name: "标记已解决", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "样本与复测", exact: true }).click();
  await page.getByRole("button", { name: "沉淀为评测样本", exact: true }).click();
  await expect(page.getByRole("button", { name: "已保存固定样本" })).toBeDisabled();
  expect(state.writes.map(w => w.path)).toEqual(["/admin/feedback/feedback/dataset"]);
  await page.getByLabel("关联复测证据").selectOption("eval-run");
  await page.getByRole("button", { name: "查看并关联复核" }).click();
  const dialog = page.getByRole("dialog", { name: "评测证据与复核" });
  await dialog.getByLabel("复核结论").selectOption("usable");
  await dialog.getByLabel("复核理由").fill("已查看修订后的完整文本");
  await dialog.getByRole("button", { name: "保存复核意见" }).click();
  await dialog.getByRole("button", { name: "关联为本条反馈的修复证据" }).click();
  await page.getByPlaceholder("记录复现情况、影响范围、修复方案、补偿结论或回归验证结果。").fill("已补全回到书店的动机，完整文本复核通过。");
  await page.getByRole("button", { name: "标记已解决", exact: true }).click();
  await expect.poll(() => state.writes.filter(w => w.path === "/admin/feedback/feedback").length).toBe(1);
  const write = state.writes.find(w => w.path === "/admin/feedback/feedback")!;
  expect(write.body).toMatchObject({ expectedVersion: 1, resolutionAttemptId: "attempt-text", resolutionReviewId: "review-1", status: "resolved" });
  await expect(page.getByRole("status").filter({ hasText: "反馈已解决" })).toBeVisible();
  await expect(page.locator(".feedback-detail-head p")).toContainText("已解决");
  if (test.info().project.name === "mobile") await page.getByRole("button", { name: "返回反馈列表" }).click();
  await expect(page.locator(".feedback-ops-card").first()).toContainText("已解决");
});

for (const dark of [false, true]) test(`evaluation and feedback workspace presentation ${dark ? "dark" : "light"}`, async ({ page }, info) => {
  await fixtures(page, { dark });
  await page.goto("/admin#评测闭环");
  await expect(page.locator(".evaluation-runner-card")).toBeVisible();
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? info.outputDir}/evaluation-runner-${dark ? "dark" : "light"}-${info.project.name}.png`, fullPage: true });
  await page.goto("/admin#用户反馈");
  await page.locator(".feedback-ops-card").first().click();
  await expect(page.locator(".feedback-detail-panel h2")).toHaveText("雨夜归人");
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? info.outputDir}/feedback-workspace-${dark ? "dark" : "light"}-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  const surface = await page.locator(".feedback-detail-panel").evaluate(node => ({
    actual: getComputedStyle(node).backgroundColor,
    expected: getComputedStyle(node.closest(".admin-product")!).getPropertyValue("--adm-surface").trim(),
  }));
  expect(surface.actual).toBe(dark ? "rgb(32, 34, 36)" : "rgb(255, 255, 255)");
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "返回反馈列表" }).click();
    await expect(page.getByRole("region", { name: "反馈列表" })).toBeFocused();
    await expect(page.locator(".feedback-detail-panel")).toBeHidden();
  }
});

test("independent review draft survives refresh cancellation and closing cancellation", async ({ page }) => {
  const state = await fixtures(page);
  const dialog = await openEvidence(page);
  await dialog.getByLabel("复核理由").fill("保留尚未保存的独立判断");
  page.once("dialog", confirmation => confirmation.dismiss());
  await dialog.getByRole("button", { name: "刷新证据" }).click();
  await expect(dialog.getByLabel("复核理由")).toHaveValue("保留尚未保存的独立判断");
  await dialog.getByRole("button", { name: "返回", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog.getByLabel("复核理由")).toHaveValue("保留尚未保存的独立判断");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/admin/evaluation/runs/eval-run", async route => {
    await held;
    await route.fulfill({ json: state.detail });
  });
  page.once("dialog", notice => notice.accept());
  await dialog.getByRole("button", { name: "刷新证据" }).click();
  await expect(dialog.getByLabel("复核理由")).toBeDisabled();
  release();
  await expect(dialog.getByLabel("复核理由")).toBeEnabled();
  await expect(dialog.getByLabel("复核理由")).toHaveValue("");
});

test("feedback query applies explicitly, keeps a draft on cancel and clears it after confirmed reload", async ({ page }) => {
  await fixtures(page);
  await page.goto("/admin#用户反馈");
  await page.locator(".feedback-ops-card").first().click();
  await page.getByLabel("处理结论").fill("尚未保存的处理记录");
  await page.getByPlaceholder("搜索反馈内容、标签、作品或用户...").fill("不存在");
  await expect(page.getByLabel("处理结论")).toHaveValue("尚未保存的处理记录");
  page.once("dialog", confirmation => confirmation.dismiss());
  await page.getByRole("button", { name: "查询反馈", exact: true }).click();
  await expect(page.locator(".feedback-ops-card")).toHaveCount(1);
  await page.getByPlaceholder("搜索反馈内容、标签、作品或用户...").fill("");
  page.once("dialog", confirmation => confirmation.accept());
  await page.getByRole("button", { name: "查询反馈", exact: true }).click();
  await expect(page.getByRole("button", { name: "查询反馈", exact: true })).toBeEnabled();
  await page.locator(".feedback-ops-card").first().click();
  await expect(page.getByLabel("处理结论")).toHaveValue("");
  await expect(page.getByRole("button", { name: "标记已解决", exact: true })).toBeDisabled();
});

test("feedback pagination keeps applied filters until an explicit query", async ({ page }) => {
  await fixtures(page);
  const queries: string[] = [];
  await page.route("**/api/admin/feedback/page?**", async route => {
    const url = new URL(route.request().url());
    queries.push(url.searchParams.get("keyword") ?? "");
    await route.fulfill({ json: { items: [], total: 60, page: Number(url.searchParams.get("page") ?? 1), pageSize: 50, totalPages: 2 } });
  });
  await page.goto("/admin#用户反馈");
  await expect(page.getByRole("button", { name: "下一页反馈" })).toBeEnabled();
  await page.getByPlaceholder("搜索反馈内容、标签、作品或用户...").fill("待应用条件");
  await page.getByRole("button", { name: "下一页反馈" }).click();
  await expect(page.getByRole("button", { name: "上一页反馈" })).toBeEnabled();
  await page.getByRole("button", { name: "上一页反馈" }).click();
  await expect(page.getByRole("button", { name: "下一页反馈" })).toBeEnabled();
  expect(queries).toEqual(["", "", ""]);
  await page.getByRole("button", { name: "查询反馈", exact: true }).click();
  await expect.poll(() => queries.at(-1)).toBe("待应用条件");
});
