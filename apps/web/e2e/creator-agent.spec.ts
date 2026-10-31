import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const brief = { format: "short", material: "idea", intent: "一个邮差在日落前送出最后一封信", durationSeconds: 30, audience: "喜欢短故事的观众", emotion: "温暖", mustKeep: "", fidelity: "faithful" };
const script = "场景一：邮局，黄昏。邮差取下墙上最后一封信，发现地址是多年前拆除的老屋。他沿着河边跑向老街，在夕阳落下之前敲开一扇木门。场景二：老屋门前，黄昏。一位老人接过信，读出年轻时没能说出口的名字。邮差微笑，把帽子抱在胸前。风吹动信纸，河面映着最后一道金光。";
const details = { estimatedSeconds: 30, characters: [{ name: "邮差", identity: "邮差", appearance: "短发", costume: "蓝色外套", personality: "善良" }], scenes: [{ location: "邮局", description: "老邮局", characters: ["邮差"] }], props: [] };
async function fixture(page: Page, options: { saved?: boolean; preferenceFails?: boolean; unknown?: boolean; conflict?: boolean; theme?: string } = {}) {
  await page.addInitScript(theme => { localStorage.setItem("aifilm_auth_token", "creator-agent-fixture"); localStorage.setItem("manjiao-theme", theme); }, options.theme ?? "light");
  const provider = { id: "fixture", name: "文本验收渠道", modality: "text", models: ["fixture-text", "fixture-next"], enabled: true, apiKeyConfigured: true, capability: { ratios: [] } };
  const price = { id: "price", providerId: "fixture", providerName: provider.name, model: "fixture-text", modality: "text", unit: "text_run", unitCredits: 10, vendorCostCny: .01, enabled: true };
  let exists = Boolean(options.saved), preference = { guideVersion: 1, guideState: "new", hasProjects: exists };
  const project: any = { id: "short-fixture", title: "日落前的信", brief: { ...brief }, revision: 1, mode: "original", activeStep: "source", status: "draft", styleProfile: { key: "anime_jp" }, textProvider: "fixture", textModel: "fixture-text", updatedAt: "2026-10-31T00:00:00Z", sourceCount: 1, chapterCount: 0, scriptCount: options.saved ? 1 : 0 };
  const context = { estimator: "utf8_upper_bound_v1", budgetTokens: 16000, estimatedInputTokens: 1200, reservedOutputTokens: 5000, safetyTokens: 500, sources: [{ id: "brief", label: "创作意图", required: true, estimatedTokens: 200, included: true }] };
  const state: any = { brief: project.brief, revision: 1, parentContentId: null, facts: [], runs: [], scripts: options.saved ? [{ id: "script-1", version: 1, status: "draft", content: script, details, createdAt: project.updatedAt, findings: [{ code: "author_review", layer: "author", severity: "warning", message: "请核对原意、因果与人物知情范围后确认。" }] }] : [], nextAction: options.saved ? "review" : "script" };
  if (options.unknown) state.runs = [{ id: "run-unknown", requestId: "unknown", status: "unknown", maxCalls: 1, maximumCredits: 10, inputRevision: 1, skillVersion: "short-film/1.0.0", cancelRequested: false, error: "供应商结果待核对", createdAt: project.updatedAt, steps: [], feedback: "" }];
  const writes: Array<{ path: string; body: any }> = [];
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const body = request.postData() ? request.postDataJSON() : undefined;
    if (request.method() !== "GET") writes.push({ path, body });
    if (path === "/content/creator/preference") {
      if (options.preferenceFails) return route.fulfill({ status: 503, json: { message: "暂不可读" } });
      if (body) preference = { ...preference, guideState: body.guideState };
      return route.fulfill({ json: preference });
    }
    if (path === "/content/creator/projects" && body) { exists = true; Object.assign(project, { title: body.title, brief: body.brief }); state.brief = body.brief; return route.fulfill({ json: { id: project.id } }); }
    if (path.endsWith("/model-route")) { Object.assign(project, body); return route.fulfill({ json: body }); }
    if (path.endsWith("/quote")) return route.fulfill({ json: { provider: "fixture", model: project.textModel, perCallCredits: 10, maximumCredits: body.maxCalls * 10, maxCalls: body.maxCalls, inputRevision: state.revision, context } });
    if (path.endsWith("/runs") && body) {
      state.runs.unshift({ id: "run-1", requestId: body.requestId, status: "pending", inputRevision: state.revision, maxCalls: body.maxCalls, maximumCredits: body.maximumCredits, skillVersion: "short-film/1.0.0", cancelRequested: false, error: null, createdAt: project.updatedAt, steps: [], feedback: body.feedback });
      return route.fulfill({ json: { id: "run-1" } });
    }
    if (path.endsWith("/execute")) {
      state.runs[0].status = "awaiting_review";
      state.runs[0].steps = [{ id: "step-1", sequence: 1, tool: "write_short_script@1.0.0", status: "completed", taskId: "task-1", inputManifest: context, findings: [], credits: 8, usage: { inputTokens: 100, outputTokens: 200, cachedInputTokens: 20 }, costMicros: 1000, costStatus: "usage_derived" }];
      state.scripts = [{ id: "script-1", version: 1, status: "draft", content: script, details, createdAt: project.updatedAt, findings: [] }]; state.nextAction = "review";
      return route.fulfill({ json: state });
    }
    if (path.endsWith("/review")) {
      if (options.conflict) return route.fulfill({ status: 409, json: { message: "剧本已有新版本；请保留本地草稿并刷新后核对。" } });
      const old = state.scripts[0];
      state.scripts.unshift({ ...old, id: `script-${old.version + 1}`, version: old.version + 1, content: body.content, details: body.details ?? old.details, status: body.approve ? "confirmed" : "draft", authorReview: { approved: body.approve, note: body.note, baseScriptId: old.id } });
      state.nextAction = body.approve ? "production" : "review"; state.revision++;
      return route.fulfill({ json: state });
    }
    if (path.endsWith("/acknowledge")) { expect(body.supplierChecked).toBe(true); state.runs[0].status = "canceled"; return route.fulfill({ json: state }); }
    if (path === "/content/creator/projects/short-fixture") return route.fulfill({ json: state });
    if (path.endsWith("/production/sync")) return route.fulfill({ json: { productionProjectId: "production-short" } });
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "creator-fixture", name: "林间", role: "creator", status: "active" } },
      "/workbench/summary": { userName: "林间", projects: 0, recentProjects: [], recentTasks: [], announcements: [], credits: 1000 },
      "/projects": [], "/content/projects": exists ? [project] : [], "/tasks": [],
      "/providers": [provider], "/model-prices": [price, { ...price, id: "next-price", model: "fixture-next" }],
      "/credits/account": { userId: "creator-fixture", balance: 1000, frozenBalance: 0 }
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
  return { writes, state };
}
async function screenshot(page: Page, name: string, device: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  if (!process.env.PLAYWRIGHT_SCREENSHOT_DIR) return;
  await mkdir(process.env.PLAYWRIGHT_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.PLAYWRIGHT_SCREENSHOT_DIR, `${name}-${device}.png`), fullPage: true });
}
test("first visit offers explicit paths and skip can be resumed", async ({ page }, info) => {
  const server = await fixture(page);
  await page.goto("/#/workbench");
  await expect(page.getByRole("heading", { name: "先讲一个小故事。" })).toBeVisible();
  await screenshot(page, "creator-welcome", info.project.name);
  await page.getByRole("button", { name: "暂时跳过首作引导" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "先讲一个小故事。" })).toHaveCount(0);
  await page.getByRole("button", { name: /打开首作引导/ }).click();
  await page.getByRole("button", { name: /先试一个示例/ }).click();
  await expect(page).toHaveURL(/__short_sample__/);
  await expect(page.getByLabel("故事与创作意图")).toHaveValue(/便利店/);
  expect(server.writes.some(write => write.path.endsWith("/execute"))).toBe(false);
});
test("failed preference read never auto-opens a first-visit guide", async ({ page }) => {
  await fixture(page, { preferenceFails: true });
  await page.goto("/#/workbench");
  await expect(page.getByText(/首作引导状态暂未读取成功/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "先讲一个小故事。" })).toHaveCount(0);
});
for (const theme of ["light", "dark"]) test(`saved brief, bounded quote, editable review and handoff (${theme})`, async ({ page }, info) => {
  const server = await fixture(page, { theme });
  await page.goto("/#/content/__short__");
  await page.getByLabel("作品标题").fill("日落前的信");
  await page.getByLabel("故事与创作意图").fill(brief.intent);
  await page.getByLabel("目标时长").selectOption("60");
  await page.getByRole("button", { name: "保存并查看创作计划" }).click();
  await expect(page).toHaveURL(/short-fixture$/);
  expect(server.writes.find(write => write.path === "/content/creator/projects")?.body.brief.durationSeconds).toBe(60);
  await page.getByLabel("自动修复额度").selectOption("2");
  await page.getByRole("button", { name: "核对生成报价" }).click();
  await expect(page.getByText("本次积分上限", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认上限并生成" }).click();
  await expect(page.getByLabel("短片剧本", { exact: true })).toHaveValue(script);
  const plan = server.writes.find(write => write.path.endsWith("/runs"))?.body;
  expect(plan.maximumCredits).toBe(20); expect(plan.maxCalls).toBe(2);
  await page.getByLabel("短片剧本", { exact: true }).fill(`${script}老人向邮差道谢。`);
  await page.getByText("核对角色、场景与剧本估时", { exact: true }).click();
  await page.getByLabel("角色 1 · 服装").fill("绿色外套");
  await page.getByRole("button", { name: "保存修改版本" }).click();
  expect(server.writes.find(write => write.path.endsWith("/review"))?.body.details.characters[0].costume).toBe("绿色外套");
  await page.getByRole("button", { name: "确认原意与人物关系" }).click();
  await expect(page.getByRole("button", { name: "进入制作", exact: true })).toBeEnabled();
  await page.getByText("对照历史版本与作者反馈", { exact: true }).click();
  await expect(page.locator(".short-comparison article")).toHaveCount(2);
  await screenshot(page, `creator-review-${theme}`, info.project.name);
  await page.getByRole("button", { name: "进入制作", exact: true }).click();
  await expect(page).toHaveURL(/#\/project\/production-short$/);
});
test("unknown results require explicit supplier check and never auto-submit", async ({ page }) => {
  const server = await fixture(page, { saved: true, unknown: true });
  await page.goto("/#/content/short-fixture");
  await expect(page.getByRole("button", { name: "核对修订报价" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "结束待核对计划" })).toBeDisabled();
  await page.getByLabel("我已核对供应商结果与费用").check();
  await page.getByRole("button", { name: "结束待核对计划" }).click();
  await expect(page.getByRole("button", { name: "核对修订报价" })).toBeEnabled();
  expect(server.writes.some(write => write.path.endsWith("/execute"))).toBe(false);
});
test("conflicting save keeps the author's local draft across reload", async ({ page }) => {
  await fixture(page, { saved: true, conflict: true });
  await page.goto("/#/content/short-fixture");
  const value = `${script}这里是我没有保存的修改。`;
  await page.getByLabel("短片剧本", { exact: true }).fill(value);
  await page.getByRole("button", { name: "保存修改版本" }).click();
  await expect(page.getByRole("alert")).toContainText("剧本已有新版本");
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.getByLabel("短片剧本", { exact: true })).toHaveValue(value);
});
test("a new material draft survives navigation without entering long-form generation", async ({ page }) => {
  await fixture(page);
  await page.goto("/#/content/__short_story__");
  await page.getByLabel("作品标题").fill("我的材料");
  await page.getByLabel("粘贴已有故事").fill("这是一段已经写好的故事。主角寻找旧物，最后发现自己真正想念的人就在身边。");
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "作品列表", exact: true }).click();
  await page.goto("/#/content/__short_story__");
  await expect(page.getByLabel("作品标题")).toHaveValue("我的材料");
  await expect(page.getByLabel("粘贴已有故事")).toHaveValue(/已经写好/);
});
test("changing models requires saving before quote; fact and feedback drafts survive reload", async ({ page }) => {
  const server = await fixture(page, { saved: true });
  await page.goto("/#/content/short-fixture");
  await page.getByText("剧本模型与渠道", { exact: true }).click();
  await page.getByRole("button", { name: /^修订剧本模型：/ }).click();
  await page.getByRole("option").filter({ hasText: "fixture-next" }).click();
  await expect(page.getByRole("button", { name: "核对修订报价" })).toBeDisabled();
  await page.getByRole("button", { name: "保存模型选择" }).click();
  await expect(page.getByRole("button", { name: "核对修订报价" })).toBeEnabled();
  expect(server.writes.find(write => write.path.endsWith("/model-route"))?.body.textModel).toBe("fixture-next");
  await page.getByLabel("修订方向", { exact: true }).fill("让结尾更加自然");
  await page.getByRole("button", { name: "添加故事设定" }).click();
  await page.getByLabel("人物 / 对象").fill("邮差");
  await page.getByLabel("事实内容").fill("他不知道信里写了什么");
  await expect(page.getByRole("button", { name: "核对修订报价" })).toBeDisabled();
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.getByLabel("修订方向", { exact: true })).toHaveValue("让结尾更加自然");
  await page.getByRole("button", { name: "添加故事设定" }).click();
  await expect(page.getByLabel("人物 / 对象")).toHaveValue("邮差");
  await expect(page.getByLabel("事实内容")).toHaveValue("他不知道信里写了什么");
});
