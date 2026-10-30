import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Local browser fixtures only; no real models, accounts, credits or production writes.
const now = "2026-10-26T10:00:00Z";
const baseProject = { id: "chain-project", name: "雨后书店", type: "漫剧", intro: "书店中的旧信", sourceType: "novel", artStyle: "真实漫画", videoRatio: "9:16", status: "draft", episodes: 2, storyboards: 5, characters: 0, imageAssets: 5, videoClips: 1, creditsSpent: 0, updatedAt: now, textProvider: "text-ready", textModel: "deepseek-v4-pro", imageProvider: "image-ready", imageModel: "wan2.6-t2i", videoProvider: "video-a", videoModel: "wan2.7-i2v" };
const providers = [
  { id: "text-missing", name: "未配置文本渠道", modality: "text", models: ["gpt-5.5"], apiKeyConfigured: false },
  { id: "text-ready", name: "可用文本渠道", modality: "text", models: ["deepseek-v4-pro"], apiKeyConfigured: true },
  { id: "image-ready", name: "图像渠道", modality: "image", models: ["wan2.6-t2i"], apiKeyConfigured: true },
  { id: "video-a", name: "视频主渠道", modality: "video", models: ["wan2.7-i2v"], apiKeyConfigured: true },
  { id: "video-b", name: "视频备用渠道", modality: "video", models: ["seedance-2-pro"], apiKeyConfigured: true }
].map(provider => ({ ...provider, enabled: true, costHint: "隔离界面验证", capability: { ratios: ["9:16"], maxDuration: 15, supportsReferenceImage: true, supportsImageToVideo: true } }));
const prices = providers.map(provider => ({ id: `price-${provider.id}`, providerId: provider.id, providerName: provider.name, model: provider.models[0], modality: provider.modality, unit: provider.modality === "text" ? "text_run" : provider.modality === "image" ? "image" : "video_second", unitCredits: provider.id === "video-b" ? 9 : 5, vendorCostCny: 0.1, enabled: true }));
const shots = ["a", "b", "c", "d", "e"].map((id, index) => ({
  id, projectId: baseProject.id, episodeNo: id === "e" ? 2 : 1, sceneNo: 1, shotNo: index + 1,
  duration: 6, shotSize: "中景", cameraAngle: "平视", cameraMovement: "推进", characters: [], scene: "书店", pictureDesc: `镜头 ${id}`, action: "翻开旧信", dialogue: "雨停了", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: "书店", videoPrompt: "翻开旧信", referenceAssetIds: [], status: "succeeded"
}));
const assets = [
  ...shots.map(shot => ({ id: `image_${shot.id}`, projectId: baseProject.id, type: "image", name: `首帧 ${shot.id}`, description: "", prompt: "", status: "succeeded", referenceUrl: `/storage/frame-${shot.id}.png` })),
  ...[["a", "failed"], ["c", "succeeded"], ["d", "running"], ["e", "failed"]].map(([id, status]) => ({ id: `video_${id}`, projectId: baseProject.id, type: "video", name: `视频 ${id}`, description: status === "failed" ? "上游返回失败" : "", prompt: "", status, referenceUrl: status === "succeeded" ? "/storage/current.mp4" : undefined }))
];
const packageResult = { projectId: "content-kept", chapters: [], analysis: { id: "analysis", version: 1, status: "confirmed", result: { intent: "雨后书店", intentType: "title", chapterCount: 10, targetWords: 20000, batchSize: 2, dimensions: { opening: "雨后书店", climax: "发现旧信" } } } };

async function fixtures(page: Page) {
  const state = {
    project: { ...baseProject }, storyboards: [...shots], assets: [...assets], writes: [] as Array<{ path: string; body: Record<string, unknown> }>,
    contentProjects: [] as Array<Record<string, unknown>>, failAnalyze: false, failListAfterAnalysis: false,
    failRefreshAfterGenerate: false, rejectRefresh: false
  };
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "chain-ui-fixture"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/storage/frame-*.png", route => route.fulfill({ path: fileURLToPath(new URL("../public/media/cineart-home/photo-w_poster.jpg", import.meta.url)), contentType: "image/jpeg" }));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (method === "PATCH" || method === "POST" || method === "DELETE") state.writes.push({ path, body: route.request().postDataJSON() ?? {} });
    if (path.endsWith("/model-routes")) {
      Object.assign(state.project, route.request().postDataJSON()); return route.fulfill({ json: state.project });
    }
    if (path.endsWith("/videos/generate")) {
      state.rejectRefresh = state.failRefreshAfterGenerate;
      return route.fulfill({ json: { assetsCreated: 1, message: "本批次已处理", project: state.project, task: { id: "video-task", status: "succeeded" } } });
    }
    if (path.endsWith("/images/generate")) {
      return route.fulfill({ json: { assetsCreated: 1, project: state.project, task: { id: "image-task", status: "succeeded" } } });
    }
    if (path.endsWith("/workflow") && state.rejectRefresh) {
      state.rejectRefresh = false; return route.fulfill({ status: 503, json: { message: "夹具：数据暂未刷新" } });
    }
    if (path === "/content/projects" && method === "POST") {
      const created = { id: "content-kept", title: "雨后书店", mode: "same_genre", status: "draft", sourceCount: 0, scriptCount: 0, chapterCount: 0, textProvider: "text-ready", textModel: "deepseek-v4-pro", updatedAt: now };
      state.contentProjects = [created]; return route.fulfill({ json: created });
    }
    if (path.endsWith("/analyze")) {
      if (state.failAnalyze) { state.failAnalyze = false; return route.fulfill({ status: 503, json: { message: "夹具：结构拆解中断" } }); }
      return route.fulfill({ json: packageResult });
    }
    if (path === "/content/projects") {
      if (state.failListAfterAnalysis && state.writes.some(write => write.path.endsWith("/analyze"))) return route.fulfill({ status: 503, json: { message: "夹具：列表刷新失败" } });
      return route.fulfill({ json: state.contentProjects });
    }
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "chain-user", name: "自检创作者", role: "admin", status: "active" } },
      "/providers": providers, "/model-prices": prices,
      "/workbench/summary": { userName: "自检创作者", projects: 1, storyboards: 5, runningTasks: 0, credits: 1000, recentProjects: [state.project], recentTasks: [], announcements: [] },
      "/projects": [state.project], "/projects/chain-project/workflow": { project: state.project, storyboards: state.storyboards, assets: state.assets, tasks: [], characters: [], script: { id: "script", projectId: state.project.id, name: state.project.name, content: "书店中的旧信", synopsis: "", version: 1, createdAt: now } },
      "/credits/account": { userId: "chain-user", balance: 1000, frozenBalance: 0, totalRecharge: 1000, totalConsume: 0 },
      "/content/projects/content-kept/package": packageResult,
      "/content/projects/content-kept/versions": { outlines: [], analyses: [], chapters: [], scripts: [] },
      "/admin/summary": {}, "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] }
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
  return state;
}
async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/full-chain-review-20261026/screenshots"}/${name}-${test.info().project.name}.png`, fullPage: true });
}
async function delivery(page: Page) {
  await page.goto("/#/project/chain-project");
  await page.getByRole("navigation", { name: "项目生产阶段" }).getByRole("button", { name: "成片", exact: true }).click();
}
async function inspector(page: Page) {
  const trigger = page.getByRole("button", { name: "打开检查器", exact: true });
  if (await trigger.isVisible()) await trigger.click();
}

test("shot video batches use the displayed episode, exclude running media and stop at twenty exact IDs", async ({ page }) => {
  const state = await fixtures(page);
  const batch = Array.from({ length: 24 }, (_, index) => ({ ...shots[4], id: `scoped-${index}`, shotNo: index + 1 }));
  state.storyboards = [...shots.slice(0, 4), ...batch];
  state.assets.push(...batch.map(shot => ({ ...assets[0], id: `image_${shot.id}`, type: "image", referenceUrl: "/storage/frame-ready.png" })));
  state.assets.push({ ...assets[0], id: "video_scoped-0", type: "video", status: "running", referenceUrl: undefined });
  state.failRefreshAfterGenerate = true;
  await page.goto("/#/project/chain-project");
  await page.getByRole("navigation", { name: "项目生产阶段" }).getByRole("button", { name: "分镜", exact: true }).click();
  await page.getByRole("combobox", { name: "选择分镜剧集" }).selectOption("2");
  await expect(page.locator(".wb-shot-table tbody tr")).toHaveCount(24);
  await page.getByRole("tab", { name: "视频", exact: true }).click();
  await inspector(page);
  await expect(page.locator(".wb-shot-generation")).toContainText("本批 20 个");
  page.once("dialog", async dialog => { expect(dialog.message()).toContain("第 2 集视频请求范围 20 个"); await dialog.accept(); });
  await page.getByRole("button", { name: "生成当前批次视频", exact: true }).click();
  await expect.poll(() => state.writes.filter(write => write.path.endsWith("/videos/generate")).length).toBe(1);
  expect(state.writes.find(write => write.path.endsWith("/videos/generate"))?.body).toEqual({ storyboardIds: batch.slice(1, 21).map(shot => shot.id) });
  await expect(page.getByRole("button", { name: "重试刷新", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成当前批次视频", exact: true })).toBeDisabled();
  if (await page.getByRole("dialog", { name: "检查器", exact: true }).count()) await page.keyboard.press("Escape");
  await expect(page.getByText(/重试刷新不会重复生成/)).toBeVisible();
  await inspector(page);
  await page.getByRole("button", { name: "重试刷新", exact: true }).click();
  await expect(page.getByRole("button", { name: "生成当前批次视频", exact: true })).toBeEnabled();
  expect(state.writes.filter(write => write.path.endsWith("/videos/generate"))).toHaveLength(1);
});

test("shot episode changes protect drafts, clear empty episodes and submit only this episode's pending images", async ({ page }) => {
  const state = await fixtures(page);
  state.project.episodes = 3;
  state.assets = state.assets.filter(asset => !["image_b", "image_e"].includes(asset.id));
  await page.goto("/#/project/chain-project");
  await page.getByRole("navigation", { name: "项目生产阶段" }).getByRole("button", { name: "分镜", exact: true }).click();
  await expect(page.locator(".wb-shot-table tbody tr")).toHaveCount(4);
  await inspector(page);
  await page.getByRole("textbox", { name: "画面描述", exact: true }).fill("暂存的镜头修改");
  if (test.info().project.name === "mobile") await page.keyboard.press("Escape");
  const episode = page.getByRole("combobox", { name: "选择分镜剧集" });
  page.once("dialog", dialog => dialog.dismiss());
  await episode.selectOption("2");
  await expect(episode).toHaveValue("1");
  await inspector(page);
  await expect(page.getByRole("textbox", { name: "画面描述", exact: true })).toHaveValue("暂存的镜头修改");
  if (test.info().project.name === "mobile") await page.keyboard.press("Escape");
  page.once("dialog", dialog => dialog.accept());
  await episode.selectOption("3");
  await expect(episode).toHaveValue("3");
  await expect(page.getByText("第 3 集暂无镜头，请先在内容阶段拆解这一集。")).toBeVisible();
  await page.reload();
  await expect(episode).toHaveValue("3");
  await page.getByRole("navigation", { name: "项目生产阶段" }).getByRole("button", { name: "成片", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "选择剧集", exact: true })).toHaveValue("3");
  await expect(page.getByText("本集还没有分镜。请先拆解镜头、准备首帧，再生成视频。")).toBeVisible();
  await page.getByRole("navigation", { name: "项目生产阶段" }).getByRole("button", { name: "分镜", exact: true }).click();
  await expect(episode).toHaveValue("3");
  await page.getByRole("tab", { name: "视频", exact: true }).click();
  await inspector(page);
  await expect(page.getByRole("textbox", { name: "画面描述", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成当前批次视频", exact: true })).toBeDisabled();
  if (test.info().project.name === "mobile") await page.keyboard.press("Escape");
  await episode.selectOption("2");
  await page.getByRole("tab", { name: "镜头表", exact: true }).click();
  await expect(page.locator(".wb-shot-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".wb-shot-table")).toContainText("镜头 e");
  await page.getByRole("tab", { name: "分镜图", exact: true }).click();
  await inspector(page);
  page.once("dialog", async dialog => { expect(dialog.message()).toContain("第 2 集首帧请求范围 1 个"); await dialog.accept(); });
  await page.getByRole("button", { name: "生成本集待生成首帧（1）", exact: true }).click();
  await expect.poll(() => state.writes.filter(write => write.path.endsWith("/images/generate")).length).toBe(1);
  expect(state.writes.find(write => write.path.endsWith("/images/generate"))?.body).toEqual({ shotIds: ["e"] });
});

test("delivery saves the displayed model before generation and submits only ready remaining shots in the current episode", async ({ page }) => {
  const state = await fixtures(page);
  await delivery(page);
  await inspector(page);
  await page.getByRole("button", { name: /^选择视频模型/ }).click();
  const dialog = page.getByRole("dialog", { name: "选择视频模型", exact: true });
  await dialog.getByRole("combobox").fill("seedance");
  await dialog.getByRole("option").filter({ hasText: "Seedance 2 Pro" }).click();
  expect(await page.getByRole("button", { name: /^选择视频模型/ }).locator(".mrp-trigger-model").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  await expect(page.getByRole("status", { name: "视频生成状态" })).toContainText("模型已修改，生成前会自动保存");
  await capture(page, "delivery-draft-model");
  if (await page.getByRole("dialog", { name: "成片参数" }).count()) await page.keyboard.press("Escape");
  page.once("dialog", async dialog => { expect(dialog.message()).toContain("视频备用渠道"); expect(dialog.message()).toContain("108 积分"); await dialog.accept(); });
  await page.getByRole("button", { name: "批量生成剩余视频（2）", exact: true }).click();
  await expect.poll(() => state.writes.some(write => write.path.endsWith("/videos/generate"))).toBeTruthy();
  const relevant = state.writes.filter(write => /model-routes|videos\/generate/.test(write.path));
  expect(relevant.map(write => write.path.split("/").at(-1))).toEqual(["model-routes", "generate"]);
  expect(relevant[0].body).toEqual({ videoProvider: "video-b", videoModel: "seedance-2-pro" });
  expect(relevant[1].body).toEqual({ storyboardIds: ["a", "b"] });
  await expect(page.getByRole("status", { name: "视频生成状态" })).toContainText("已保存为项目默认");
});

test("failed-shot retry is scoped to the visible episode; a successful generation with failed refresh cannot be resubmitted", async ({ page }) => {
  const state = await fixtures(page);
  state.failRefreshAfterGenerate = true;
  await delivery(page);
  await inspector(page);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "重试失败镜头", exact: true }).click();
  await expect.poll(() => state.writes.filter(write => write.path.endsWith("/videos/generate")).length).toBe(1);
  expect(state.writes.find(write => write.path.endsWith("/videos/generate"))?.body).toEqual({ storyboardIds: ["a"] });
  await expect(page.getByText(/生成请求已处理，但成片数据刷新失败/)).toBeVisible();
  if (await page.getByRole("dialog", { name: "成片参数" }).count()) await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "批量生成剩余视频（2）", exact: true })).toBeDisabled();
  await capture(page, "delivery-refresh-required");
  await page.getByRole("button", { name: "重新核对数据", exact: true }).click();
  await expect(page.getByRole("button", { name: "批量生成剩余视频（2）", exact: true })).toBeEnabled();
  expect(state.writes.filter(write => write.path.endsWith("/videos/generate"))).toHaveLength(1);
});

test("new drama defaults to a configured text route and an actual configured video model", async ({ page }) => {
  await fixtures(page);
  await page.goto("/#/wizard");
  await page.getByRole("button", { name: /开始小说改编/ }).click();
  await page.getByLabel("小说正文", { exact: true }).fill("第一章 雨后的旧书店\n她推开店门，发现了一封旧信。".repeat(4));
  await page.getByRole("button", { name: "下一步：全局设定", exact: true }).click();
  await page.getByRole("button", { name: "下一步：确认创建", exact: true }).click();
  await page.locator(".creation-model-settings > summary").click();
  await expect(page.getByRole("button", { name: /^选择文本模型/ })).toContainText("DeepSeek V4 Pro");
  await expect(page.getByRole("button", { name: "获取文本报价并确认", exact: true })).toBeEnabled();
  await capture(page, "wizard-configured-defaults");
});

test("content analysis failure retains one project and retries the original intent without creating another", async ({ page }) => {
  const state = await fixtures(page);
  state.failAnalyze = true;
  await page.goto("/#/content");
  await page.getByRole("textbox", { name: "已有标题", exact: true }).fill("雨后书店");
  await page.getByRole("button", { name: "开始结构拆解", exact: true }).click();
  await expect(page.getByText("结构拆解中断，项目已保留", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始结构拆解", exact: true })).toBeDisabled();
  await capture(page, "content-retry");
  await page.getByRole("button", { name: "重试当前阶段", exact: true }).click();
  await expect(page.getByText("结构拆解已完成", { exact: true })).toBeVisible();
  expect(state.writes.filter(write => write.path === "/content/projects")).toHaveLength(1);
  const attempts = state.writes.filter(write => write.path.endsWith("/analyze"));
  expect(attempts).toHaveLength(2);
  expect(attempts[1].body).toEqual(attempts[0].body);
});

test("content success followed by a failed list refresh stays completed; admin exposes simultaneous configuration defects", async ({ page }) => {
  const state = await fixtures(page);
  state.failListAfterAnalysis = true;
  await page.goto("/#/content");
  await page.getByRole("textbox", { name: "已有标题", exact: true }).fill("雨后书店");
  await page.getByRole("button", { name: "开始结构拆解", exact: true }).click();
  await expect(page.getByText(/结构拆解已完成。作品列表暂未刷新/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重试当前阶段", exact: true })).toHaveCount(0);
  expect(state.writes.filter(write => write.path.endsWith("/analyze"))).toHaveLength(1);
  await page.route("**/api/model-prices", route => route.fulfill({ json: prices.filter(price => price.providerId !== "text-missing") }));
  await page.goto("/admin#模型路由");
  await page.getByRole("button", { name: "模型目录与配置检查", exact: true }).click();
  const card = page.locator(".model-library-card").filter({ hasText: "未配置文本渠道 · gpt-5.5" });
  await expect(card).toContainText("需核对：待配置 · 未配置价格");
  await capture(page, "admin-multiple-config-issues");
});

test("large delivery batch requests twenty shots at most and never includes another episode", async ({ page }) => {
  const state = await fixtures(page);
  state.storyboards = Array.from({ length: 22 }, (_, index) => ({ ...shots[0], id: `batch-${index}`, shotNo: index + 1, episodeNo: index === 21 ? 2 : 1 }));
  state.assets = state.storyboards.map(shot => ({ ...assets[0], id: `image_${shot.id}` }));
  await delivery(page);
  await expect(page.getByRole("status", { name: "视频生成状态" })).toContainText("本集剩余 21 镜，本次最多请求 20 镜");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "批量生成剩余视频（20）", exact: true }).click();
  await expect.poll(() => state.writes.filter(write => write.path.endsWith("/videos/generate")).length).toBe(1);
  expect(state.writes.find(write => write.path.endsWith("/videos/generate"))?.body.storyboardIds).toEqual(Array.from({ length: 20 }, (_, index) => `batch-${index}`));
});

test("saved video route with the wrong billing unit cannot generate and explains the configuration problem", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/model-prices", route => route.fulfill({ json: prices.map(price => price.providerId === "video-a" ? { ...price, unit: "image" } : price) }));
  await delivery(page);
  await expect(page.getByRole("button", { name: "批量生成剩余视频（2）", exact: true })).toBeDisabled();
  await expect(page.getByRole("status", { name: "视频生成状态" })).toContainText("计费单位与模型类型不匹配");
  await inspector(page);
  await expect(page.getByText("价格配置无效，请重新选择。", { exact: true })).toBeVisible();
});
