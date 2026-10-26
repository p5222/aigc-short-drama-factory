import { test, expect, type Page } from "@playwright/test";

// Isolated UI records and responses only; no supplier calls, payments or production writes.
const stamp = "2026-10-26T10:00:00Z";
const project = { id: "button-project", name: "雨后书店", type: "漫剧", intro: "一封旧信", sourceType: "script", artStyle: "国漫", videoRatio: "9:16", status: "draft", episodes: 1, storyboards: 0, characters: 2, imageAssets: 0, videoClips: 0, creditsSpent: 0, updatedAt: stamp, imageProvider: "image", imageModel: "wan2.6-t2i" };
const story = { id: "button-story", title: "旧信手稿", mode: "same_genre", status: "draft", activeStep: "source", chapterCount: 0, scriptCount: 0, sourceCount: 0, updatedAt: stamp };
const providers = [{ id: "image", name: "图片创作", modality: "image", models: ["wan2.6-t2i"], enabled: true, apiKeyConfigured: true, capability: { ratios: ["9:16"] } }];
const prices = [{ id: "image-price", providerId: "image", providerName: "图片创作", modality: "image", model: "wan2.6-t2i", unit: "image", unitCredits: 5, vendorCostCny: 0.02, enabled: true }];
const task = (id: string, status: string, extra = {}) => ({ id, projectId: project.id, projectName: project.name, type: "image", title: `任务 ${id}`, status, provider: "image", model: "wan2.6-t2i", progress: 0, estimatedCredits: 5, createdAt: stamp, updatedAt: stamp, ...extra });
const characters = ["林初", "沈砚"].map((name, index) => ({ id: `character-${index}`, projectId: project.id, name, identity: "书店店主", appearance: "黑发", costume: "青色外套", personality: "温和", voice: "", visualPrompt: name }));

async function fixtures(page: Page) {
  const state = {
    tasks: [task("failed", "failed"), task("running", "running"), task("done", "succeeded", { retryable: true, cancelable: true }), task("refunded", "refunded", { retryable: false })],
    stories: [story], writes: [] as Array<{ path: string; body: Record<string, unknown> }>,
    rejectMutation: false, failRefresh: false, failList: false, rejectProjectRead: false,
    holdRefresh: null as Promise<void> | null,
    holdGeneration: null as Promise<void> | null, holdUpload: null as Promise<void> | null
  };
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "button-review-fixture"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (["PATCH", "POST", "DELETE"].includes(method)) {
      state.writes.push({ path, body: route.request().postDataJSON() ?? {} });
      if (state.rejectMutation) return route.fulfill({ status: 503, json: { message: "夹具：暂时无法提交" } });
      if (/\/tasks\/.+\/(retry|cancel)$/.test(path)) {
        const id = path.split("/")[2];
        const updated = { ...state.tasks.find(item => item.id === id)!, status: path.endsWith("cancel") ? "canceled" : state.failRefresh ? "failed" : "pending" };
        state.tasks = state.tasks.map(item => item.id === id ? updated : item);
        return route.fulfill({ json: updated });
      }
      if (path === `/content/projects/${story.id}` && method === "DELETE") {
        state.stories = []; return route.fulfill({ json: { deleted: true } });
      }
      if (path.endsWith("/model-routes")) return route.fulfill({ json: { ...project, ...route.request().postDataJSON() } });
      if (path.endsWith("/characters/images/generate")) {
        await state.holdGeneration;
        return route.fulfill({ json: { assetsCreated: 1, project, task: task("generated", "succeeded") } });
      }
      if (path.endsWith("/reference")) {
        await state.holdUpload;
        return route.fulfill({ json: { saved: true } });
      }
      return route.fulfill({ json: { saved: true } });
    }
    if (path.endsWith("/workflow")) await state.holdRefresh;
    if (state.rejectProjectRead && path.endsWith("/workflow") || state.failRefresh && state.writes.length && (path.endsWith("/workflow") || path === "/tasks")) return route.fulfill({ status: 503, json: { message: "夹具：任务记录未能刷新" } });
    if (state.failList && state.writes.length && path === "/content/projects") return route.fulfill({ status: 503, json: { message: "夹具：列表未能刷新" } });
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "button-user", name: "自检创作者", role: "admin", status: "active" } },
      "/providers": providers, "/model-prices": prices, "/projects": [project], "/content/projects": state.stories, "/tasks": state.tasks,
      "/workbench/summary": { userName: "自检创作者", projects: 1, storyboards: 0, credits: 1000, runningTasks: 0, recentProjects: [project], recentTasks: [], announcements: [] },
      "/credits/account": { userId: "button-user", balance: 1000, frozenBalance: 0, totalRecharge: 1000, totalConsume: 0 },
      [`/projects/${project.id}/workflow`]: { project, characters, storyboards: [], assets: [], tasks: state.tasks, script: { id: "script", projectId: project.id, name: project.name, content: "书店的旧信", synopsis: "", version: 1, createdAt: stamp } },
      [`/content/projects/${story.id}/package`]: { projectId: story.id, chapters: [] },
      [`/content/projects/${story.id}/versions`]: { projectId: story.id, analyses: [], outlines: [], chapters: [], scripts: [] },
      "/admin/summary": {}, "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] },
      "/admin/showcase/works": { items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 },
      "/admin/content-projects": [{ ...story, status: "stale", user: { name: "自检创作者" }, counts: { sources: 0, analyses: 1, outlines: 1, chapters: 0, scripts: 0 } }]
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
  return state;
}

async function openTasks(page: Page) {
  await expect(page.getByRole("navigation", { name: "项目生产阶段" })).toBeVisible();
  const desktop = page.getByRole("button", { name: "打开生成任务", exact: true });
  if (await desktop.isVisible()) await desktop.click();
  else { await page.getByRole("button", { name: "更多操作", exact: true }).click(); await desktop.last().click(); }
  return page.getByRole("dialog", { name: "生成任务", exact: true });
}
async function inspector(page: Page) {
  await expect(page.locator(".wb-asset-canvas")).toBeVisible();
  const trigger = page.getByRole("button", { name: "打开检查器", exact: true });
  if (await trigger.isVisible()) await trigger.click();
}
async function capture(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/button-function-review-20261026/screenshots"}/${label}-${test.info().project.name}.png`, fullPage: true });
}

test("workbench task drawer provides retry, cancel and explicit refresh while respecting terminal capability limits", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto(`/#/project/${project.id}`);
  const drawer = await openTasks(page);
  await expect(drawer.locator(".wb-task-row").filter({ hasText: "任务 done" }).getByRole("button")).toHaveCount(0);
  await drawer.locator(".wb-task-row").filter({ hasText: "任务 failed" }).getByRole("button", { name: "重试", exact: true }).click();
  await expect(drawer.getByText("重试请求已受理，任务记录已刷新。", { exact: true })).toBeVisible();
  await drawer.locator(".wb-task-row").filter({ hasText: "任务 running" }).getByRole("button", { name: "取消", exact: true }).click();
  await expect(drawer.getByText("取消请求已处理，任务记录已刷新。", { exact: true })).toBeVisible();
  expect(state.writes.map(write => write.path)).toEqual(["/tasks/failed/retry", "/tasks/running/cancel"]);
  await capture(page, "task-drawer");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page.locator(".wb-header button:focus")).toHaveCount(1);
});

test("accepted task retry with failed refresh stays blocked across closing and reopening until refresh succeeds", async ({ page }) => {
  const state = await fixtures(page);
  state.failRefresh = true;
  await page.goto(`/#/project/${project.id}`);
  let drawer = await openTasks(page);
  const row = () => drawer.locator(".wb-task-row").filter({ hasText: "任务 failed" });
  await row().getByRole("button", { name: "重试", exact: true }).click();
  await expect(drawer.getByRole("alert")).toContainText("操作已受理");
  await expect(row().getByRole("button", { name: "重试", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  drawer = await openTasks(page);
  await expect(row().getByRole("button", { name: "重试", exact: true })).toBeDisabled();
  state.failRefresh = false;
  await drawer.getByRole("button", { name: "刷新任务记录", exact: true }).click();
  await expect(drawer.getByText("任务记录已刷新。", { exact: true })).toBeVisible();
  await expect(row().getByRole("button", { name: "重试", exact: true })).toBeEnabled();
  expect(state.writes).toHaveLength(1);
});

test("task rejection preserves retry and queue exposes refunded records and safe refresh recovery", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/#/tasks");
  await page.getByRole("button", { name: "已退款", exact: true }).click();
  await expect(page.locator(".queue-task-select")).toHaveCount(1);
  await expect(page.locator(".queue-task-select")).toContainText("任务 refunded");
  await page.getByRole("button", { name: "失败", exact: true }).click();
  state.rejectMutation = true;
  await page.getByRole("button", { name: "重试任务", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("夹具：暂时无法提交");
  await expect(page.getByRole("button", { name: "重试任务", exact: true })).toBeEnabled();
  state.rejectMutation = false; state.failRefresh = true;
  await page.getByRole("button", { name: "重试任务", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "操作已受理" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试任务", exact: true })).toBeDisabled();
  state.failRefresh = false;
  await page.getByRole("button", { name: "刷新队列", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试任务", exact: true })).toBeEnabled();
  expect(state.writes).toHaveLength(2);
  await capture(page, "refunded-and-recovery");
});

test("my works can delete a story, preserve it on rejection and keep the committed deletion when statistics fail", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/#/scripts");
  await page.getByRole("button", { name: "删除故事 旧信手稿", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除这部作品？", exact: true });
  await expect(dialog).toContainText("已交接的漫剧项目保留");
  state.rejectMutation = true;
  await dialog.getByRole("button", { name: "删除作品", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("夹具：暂时无法提交");
  await expect(page.getByRole("button", { name: "打开内容创作 旧信手稿", exact: true })).toHaveCount(1);
  state.rejectMutation = false; state.failList = true;
  await dialog.getByRole("button", { name: "删除作品", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开内容创作 旧信手稿", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开漫剧作品 雨后书店", exact: true })).toBeVisible();
  expect(state.writes.map(write => write.path)).toEqual([`/content/projects/${story.id}`, `/content/projects/${story.id}`]);
  await capture(page, "story-delete");
});

for (const failList of [false, true]) test(`deleting the opened content project reconciles selection without a false missing-project or deletion failure (refresh failure: ${failList})`, async ({ page }) => {
  const state = await fixtures(page);
  await page.goto(`/#/content/${story.id}`);
  await expect(page.getByRole("button", { name: "删除作品", exact: true })).toBeEnabled();
  state.failList = failList;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "删除作品", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新建内容创作", exact: true })).toBeVisible();
  await expect(page.getByText("找不到这个内容项目", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/内容项目已删除/)).toBeVisible();
  expect(state.writes).toHaveLength(1);
  await page.getByRole("button", { name: "返回我的作品", exact: true }).click();
  await expect(page.getByRole("button", { name: "打开内容创作 旧信手稿", exact: true })).toHaveCount(0);
});

test("asset generation locks reference changes and generation settings; upload has progress and format feedback", async ({ page }) => {
  const state = await fixtures(page);
  let finish!: () => void;
  state.holdGeneration = new Promise<void>(resolve => { finish = resolve; });
  await page.goto(`/#/project/${project.id}`);
  await page.getByRole("navigation", { name: "项目生产阶段" }).getByRole("button", { name: "资产", exact: true }).click();
  await inspector(page);
  await page.getByRole("button", { name: "生成身份板", exact: true }).click();
  await expect.poll(() => state.writes.some(write => write.path.endsWith("/characters/images/generate"))).toBeTruthy();
  await expect(page.locator(".wb-reference-actions input[type=file]")).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "尺寸", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "质量", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^选择图像模型/ })).toBeDisabled();
  expect(state.writes.find(write => write.path.endsWith("/characters/images/generate"))?.body).toEqual({ characterIds: ["character-0"], forceRegenerate: false });
  finish();
  await expect(page.locator(".wb-reference-actions input[type=file]")).toBeEnabled();
  await page.locator(".wb-reference-actions input[type=file]").setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") });
  await expect(page.getByRole("alert")).toContainText("8 MB");
  state.holdUpload = new Promise<void>(resolve => { finish = resolve; });
  await page.locator(".wb-reference-actions input[type=file]").setInputFiles({ name: "tiny.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7i0AAAAASUVORK5CYII=", "base64") });
  await expect(page.getByText("正在保存参考图…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成身份板", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "正在处理…", exact: true })).toBeDisabled();
  finish();
  await expect(page.getByText("创作者参考图已保存，不会覆盖生成身份板。", { exact: true })).toBeVisible();
  await capture(page, "asset-actions");
});

test("admin price creation and editing block invalid numbers while allowing explicit zero and retain drafts on failure", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/admin#价格策略");
  await page.getByRole("button", { name: "新增价格", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "新增价格策略", exact: true });
  const credits = dialog.getByLabel(/^积分 \//);
  await credits.fill("");
  await expect(dialog.getByRole("button", { name: "新增价格", exact: true })).toBeDisabled();
  await credits.fill("1.5");
  await expect(dialog.getByRole("button", { name: "新增价格", exact: true })).toBeDisabled();
  await credits.fill("0");
  await dialog.getByLabel(/^成本（元/).fill("0");
  await expect(dialog.getByRole("button", { name: "新增价格", exact: true })).toBeEnabled();
  state.rejectMutation = true;
  await dialog.getByRole("button", { name: "新增价格", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("夹具：暂时无法提交");
  await expect(credits).toHaveValue("0");
  await capture(page, "admin-price-validation");
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "放弃修改", exact: true }).click();
  await page.getByRole("button", { name: "展开价格", exact: true }).click();
  await page.getByRole("button", { name: "编辑价格", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "编辑价格策略", exact: true });
  await dialog.getByLabel(/^积分 \//).fill("0.5");
  await expect(dialog.getByRole("button", { name: "保存价格", exact: true })).toBeDisabled();
  await dialog.getByLabel(/^积分 \//).fill("0");
  await expect(dialog.getByRole("button", { name: "保存价格", exact: true })).toBeEnabled();
  expect(state.writes).toHaveLength(1);
});

test("admin content progress translates current workflow statuses", async ({ page }) => {
  await fixtures(page);
  const reviewLoaded = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/showcase/works" && response.status() === 200);
  await page.goto("/admin#创作现场管理");
  await reviewLoaded;
  await page.getByRole("button", { name: "内容创作进度", exact: true }).click();
  await expect(page.getByRole("cell", { name: "内容待更新", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "stale", exact: true })).toHaveCount(0);
  await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
});

test("evaluation refresh provides in-dialog progress, failure and retry feedback", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto(`/#/project/${project.id}`);
  await expect(page.getByRole("navigation", { name: "项目生产阶段" })).toBeVisible();
  const trigger = page.getByRole("button", { name: "打开评测反馈", exact: true });
  if (await trigger.isVisible()) await trigger.click();
  else { await page.getByRole("button", { name: "更多操作", exact: true }).click(); await trigger.last().click(); }
  const drawer = page.getByRole("dialog", { name: "评测与反馈", exact: true });
  let finish!: () => void;
  state.holdRefresh = new Promise<void>(resolve => { finish = resolve; });
  state.rejectProjectRead = true;
  await drawer.getByRole("button", { name: "刷新评测数据", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "刷新中…", exact: true })).toBeDisabled();
  finish();
  await expect(drawer.getByRole("alert")).toContainText("夹具：任务记录未能刷新");
  state.holdRefresh = null; state.rejectProjectRead = false;
  await drawer.getByRole("button", { name: "刷新评测数据", exact: true }).click();
  await expect(drawer.getByText("评测与反馈记录已刷新。", { exact: true })).toBeVisible();
});
