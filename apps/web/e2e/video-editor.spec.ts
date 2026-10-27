import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// UI contract fixtures using an existing local brand video. No provider/payment calls.
async function fixtures(page: Page) {
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "video-ui-fixture"); localStorage.setItem("manjiao-theme", "light"); });
  const media = await readFile(resolve("public/media/cinematic-login-bg.mp4"));
  await page.route("**/storage/editor-*.mp4", route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    return route.fulfill({ status: range ? 206 : 200, body: media.subarray(start, end + 1), contentType: "video/mp4",
      headers: { "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${media.length}` } : {}) } });
  });
  const project = { id: "video-edit", name: "雨后书店 · 剪辑验收", type: "漫剧", intro: "", sourceType: "script", artStyle: "国漫", videoRatio: "16:9", status: "rendering", episodes: 1, storyboards: 3, characters: 0, imageAssets: 0, videoClips: 3, creditsSpent: 0, updatedAt: "2026-10-27T00:00:00Z" };
  const storyboards = ["a", "b", "c"].map((id, index) => ({ id, projectId: project.id, episodeNo: 1, sceneNo: 1, shotNo: index + 1, duration: 5, shotSize: "全景", cameraAngle: "平视", cameraMovement: "固定", characters: [], scene: ["书店外", "靠窗座位", "旧信"][index], pictureDesc: "雨停后，人物在书店发现一封旧信", dialogue: "故事从这里开始", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: "", videoPrompt: "", referenceAssetIds: [], status: "succeeded" }));
  const historyId = "video_a_history_12345678-1234-1234-1234-123456789abc";
  const assets = [...storyboards.map(shot => ({ id: `video_${shot.id}`, projectId: project.id, type: "video", name: "视频", description: "", prompt: "", referenceUrl: `/storage/editor-${shot.id}.mp4`, status: "succeeded" })),
    { id: historyId, projectId: project.id, type: "video", name: "历史视频", description: "", prompt: "", referenceUrl: "/storage/editor-history.mp4", status: "succeeded" }];
  let edits: any[] = [], jobs: any[] = [{ id: "old-film", projectId: project.id, type: "video_export", status: "succeeded", sourceStatus: "stale", outputKind: "mp4", outputUrl: "/storage/editor-old.mp4", storyboardIds: ["a", "b", "c"], createdAt: project.updatedAt, updatedAt: project.updatedAt }];
  let writes = 0, conflict = false, failRefresh = false, quoteRequest: any, exportRequest: any;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path.endsWith("/delivery-edit") && route.request().method() === "PUT") {
      writes++;
      const input = route.request().postDataJSON();
      if (conflict) return route.fulfill({ status: 409, json: { message: "剪辑已有更新版本，你的修改仍保留。请复制剪辑草稿并刷新核对后再保存。" } });
      expect(input.clips.every((clip: any) => !("sourceUrl" in clip))).toBeTruthy();
      edits = [{ projectId: project.id, episodeNo: input.episodeNo, revision: (edits[0]?.revision ?? 0) + 1,
        clips: input.clips.map((clip: any) => ({ ...clip, sourceUrl: assets.find(asset => asset.id === clip.sourceAssetId)?.referenceUrl })), updatedAt: project.updatedAt }];
      return route.fulfill({ json: edits[0] });
    }
    if (path.endsWith("/exports/quote")) {
      quoteRequest = route.request().postDataJSON();
      return route.fulfill({ json: { type: quoteRequest.type, providerId: "test", providerName: "验收配音", model: "test", characters: 10, estimatedCredits: 2, unitCredits: 1, unit: "tts_character", cached: false, cueCount: 2 } });
    }
    if (path.endsWith("/export/jobs") && route.request().method() === "POST") {
      exportRequest = route.request().postDataJSON();
      const job = { ...jobs[0], id: "new-film", sourceStatus: "current", storyboardIds: exportRequest.storyboardIds, deliveryEdit: exportRequest.deliveryEdit };
      jobs = [job, ...jobs]; return route.fulfill({ status: 201, json: job });
    }
    if (path.endsWith("/workflow")) return failRefresh ? route.fulfill({ status: 503, json: { message: "夹具：刷新暂不可用" } }) : route.fulfill({ json: { project, storyboards, assets, characters: [], tasks: [], deliveryEdits: edits } });
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "video-fixture", name: "创作者", role: "creator", status: "active" } },
      "/workbench/summary": { userName: "创作者", projects: 1, storyboards: 3, runningTasks: 0, credits: 100, recentProjects: [project], recentTasks: [], announcements: [] },
      "/projects": [project], "/tasks": [],
      "/projects/video-edit/export/jobs": jobs,
      "/credits/account": { userId: "video-fixture", balance: 100, frozenBalance: 0, totalRecharge: 100, totalConsume: 0 }
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
  return { historyId, writes: () => writes, setConflict: () => { conflict = true; }, failRefresh: () => { failRefresh = true; },
    replaceVideo: () => { assets[0].referenceUrl = "/storage/editor-replaced.mp4"; },
    quote: () => quoteRequest, exported: () => exportRequest };
}

async function openEditor(page: Page) {
  await page.goto("/#/project/video-edit");
  await page.getByRole("navigation", { name: "项目生产阶段" }).getByRole("button", { name: /成片/ }).click();
  await expect(page.getByLabel("镜头入点秒数")).toBeVisible();
}
async function screenshot(page: Page, name: string, device: string) {
  if (!process.env.PLAYWRIGHT_SCREENSHOT_DIR) return;
  await mkdir(process.env.PLAYWRIGHT_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.PLAYWRIGHT_SCREENSHOT_DIR, `${name}-${device}.png`), fullPage: true });
}

test("trim, reorder and historical source save across reload and reach the quoted export", async ({ page }, info) => {
  const state = await fixtures(page); await openEditor(page);
  await page.getByLabel("镜头入点秒数").fill("1.2");
  await page.getByLabel("镜头出点秒数").fill("3.7");
  const player = page.locator(".dlv2-player video");
  await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
  await player.evaluate((video: HTMLVideoElement) => { video.currentTime = 0; });
  await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(1.2, 1);
  await player.evaluate((video: HTMLVideoElement) => { video.currentTime = 4.5; });
  await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(3.7, 1);
  await page.getByLabel("选用视频版本").selectOption(state.historyId);
  await page.getByRole("button", { name: "镜头后移", exact: true }).click();
  await expect(page.getByRole("button", { name: /导出第 1 集 MP4/ })).toBeDisabled();
  await page.getByRole("button", { name: "保存剪辑", exact: true }).click();
  await expect(page.getByText("剪辑 v1 · 已保存", { exact: true })).toBeVisible();
  expect(state.writes()).toBe(1);
  await page.reload();
  await expect(page.getByText("剪辑 v1 · 已保存", { exact: true })).toBeVisible();
  const ids = await page.locator(".dlv2-track-video .dlv2-clip").evaluateAll(nodes => nodes.map(node => node.getAttribute("title")));
  expect(ids).toHaveLength(3);
  await page.getByRole("button", { name: /导出第 1 集 MP4/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(state.quote().deliveryEdit).toEqual({ episodeNo: 1, revision: 1 });
  expect(state.quote().storyboardIds).toEqual(["b", "a", "c"]);
  await page.getByRole("dialog").getByRole("button", { name: /确认.*积分/ }).click();
  await expect.poll(() => state.exported()?.maxCredits).toBe(2);
  expect(state.exported().deliveryEdit).toEqual({ episodeNo: 1, revision: 1 });
  if (info.project.name === "mobile") await page.getByRole("button", { name: "打开检查器", exact: true }).click();
  await page.getByRole("button", { name: "预览成片 old-film", exact: true }).click();
  await expect(page.locator(".dlv2-player video")).toHaveAttribute("src", "/storage/editor-old.mp4");
  await screenshot(page, "saved-cut-and-film", info.project.name);
});

test("save conflict retains trims, supports draft download and protects navigation", async ({ page }, info) => {
  const state = await fixtures(page); await openEditor(page);
  await page.getByLabel("镜头入点秒数").fill("1.5");
  state.setConflict();
  await page.getByRole("button", { name: "保存剪辑", exact: true }).click();
  await expect(page.getByText(/剪辑已有更新版本/)).toBeVisible();
  await expect(page.getByLabel("镜头入点秒数")).toHaveValue("1.5");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载剪辑草稿", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("剪辑草稿.json");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("navigation", { name: "项目生产阶段" }).getByRole("button", { name: /分镜/ }).click();
  await expect(page.getByLabel("镜头入点秒数")).toHaveValue("1.5");
  expect(state.writes()).toBe(1);
  await screenshot(page, "conflict-keeps-draft", info.project.name);
});

test("replaced source requires explicit confirmation and saving a new cut", async ({ page }, info) => {
  const state = await fixtures(page); await openEditor(page);
  await page.getByRole("button", { name: "保存剪辑", exact: true }).click();
  await expect(page.getByText("剪辑 v1 · 已保存", { exact: true })).toBeVisible();
  state.replaceVideo(); await page.reload();
  await expect(page.getByText(/剪辑选用的视频已有更新/)).toBeVisible();
  await expect(page.getByRole("button", { name: /导出第 1 集 MP4/ })).toBeDisabled();
  await page.getByRole("button", { name: "选用更新后的视频", exact: true }).click();
  await expect(page.getByRole("button", { name: /导出第 1 集 MP4/ })).toBeDisabled();
  await page.getByRole("button", { name: "保存剪辑", exact: true }).click();
  await expect(page.getByText("剪辑 v2 · 已保存", { exact: true })).toBeVisible();
  await expect(page.locator(".dlv2-player video")).toHaveAttribute("src", "/storage/editor-replaced.mp4");
  await screenshot(page, "editor-light", info.project.name);
});

test("acknowledged save with refresh failure does not invite a duplicate save", async ({ page }) => {
  const state = await fixtures(page); await openEditor(page);
  await page.getByLabel("镜头出点秒数").fill("3.7");
  state.failRefresh();
  await page.getByRole("button", { name: "保存剪辑", exact: true }).click();
  await expect(page.getByText(/剪辑已保存，页面刷新失败/)).toBeVisible();
  await expect(page.getByRole("button", { name: "保存剪辑", exact: true })).toBeDisabled();
  expect(state.writes()).toBe(1);
  await expect(page.getByLabel("镜头出点秒数")).toHaveValue("3.7");
});

test("editor, output library and dark theme remain usable at narrow widths", async ({ page }, info) => {
  await fixtures(page); await openEditor(page);
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `页面在 ${width}px 宽度不应水平溢出` }).toBeTruthy();
    await expect(page.getByLabel("镜头入点秒数")).toBeVisible();
  }
  await page.getByRole("button", { name: /切换到深色主题/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await screenshot(page, "editor-dark", info.project.name);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.getByRole("button", { name: "打开检查器", exact: true }).click();
  await page.getByRole("button", { name: "预览成片 old-film", exact: true }).click();
  await expect(page.getByText(/历史成片 · 内容已更新/)).toBeVisible();
  await screenshot(page, "historical-film-mobile", info.project.name);
});

test("studio keeps generated clips accessible after final exports and previews historical outputs", async ({ page }, info) => {
  await fixtures(page);
  await page.goto("/#/studio");
  await page.getByRole("button", { name: /生成片段 · 3/ }).click();
  await expect(page.getByRole("tablist", { name: "片段连播列表" })).toBeVisible();
  await page.getByRole("button", { name: "预览成片 old-film", exact: true }).click();
  await expect(page.locator(".studio-player video")).toHaveAttribute("src", "/storage/editor-old.mp4");
  await screenshot(page, "studio-outputs", info.project.name);
  await page.getByRole("button", { name: "继续剪辑", exact: true }).click();
  await expect(page.getByLabel("镜头入点秒数")).toBeVisible();
});
