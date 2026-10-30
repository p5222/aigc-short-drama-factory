import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Configuration and navigation fixtures only; no provider requests or production credits.
async function setup(page: Page) {
  const project = { id: "ready-project", name: "雨后的小站", sourceType: "script", artStyle: "国漫", videoRatio: "9:16", status: "draft", episodes: 2, storyboards: 2, characters: 1, imageAssets: 1, videoClips: 0, creditsSpent: 0, updatedAt: "2026-10-30T00:00:00Z" };
  const providers = [{ id: "text-ready", name: "文本渠道", models: ["qwen-plus"], modality: "text", enabled: true, apiKeyConfigured: true, capability: { ratios: [], supportsReferenceImage: false }, costHint: "" }];
  const prices = [{ id: "price", providerId: "text-ready", model: "qwen-plus", modality: "text", enabled: true, unit: "text_run", unitCredits: 12, vendorCostCny: 0.1 }];
  const shots = [1, 2].map(episodeNo => ({ id: `shot-${episodeNo}`, projectId: project.id, episodeNo, sceneNo: 1, shotNo: 1, duration: 6, shotSize: "中景", cameraAngle: "平视", cameraMovement: "固定", characters: ["林初"], scene: "小站", pictureDesc: "林初在雨后的小站读信", action: "读信", dialogue: "你回来了吗", voiceOver: "", environmentSound: "", soundEffect: "", imagePrompt: "", videoPrompt: "", referenceAssetIds: [], status: "pending" }));
  const workflow = { project, storyboards: shots, tasks: [], script: { id: "script", projectId: project.id, name: project.name, content: "第1集\n场1 小站\n林初读信。\n第2集\n场1 小站\n林初等待列车。", synopsis: "一封旧信", version: 1 },
    characters: [{ id: "lin", projectId: project.id, name: "林初", identity: "主角", appearance: "短发", costume: "衬衣", personality: "安静", prompt: "", negativePrompt: "", consistencyLevel: "high" }],
    assets: [
      { id: "reference", type: "role_reference", relatedCharacterId: "lin", status: "succeeded", referenceUrl: "/storage/reference.png" },
      { id: "image_shot-1", type: "image", status: "succeeded", referenceUrl: "/storage/frame.png" },
      { id: "image_shot-2", type: "image", status: "succeeded", referenceUrl: "/storage/old.png", isHistorical: true },
      { id: "video_shot-1", type: "video", status: "failed", referenceUrl: "/storage/old.mp4" }
    ].map(asset => ({ ...asset, projectId: project.id, name: "测试资产", description: "", prompt: "" })) };
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "readiness-fixture"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/storage/*.png", route => route.fulfill({ path: fileURLToPath(new URL("../public/media/cineart-home/photo-w_poster.jpg", import.meta.url)), contentType: "image/jpeg" }));
  await page.route("**/storage/*.mp4", route => route.fulfill({ status: 404, body: "This failed fixture has no playable media." }));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "creator", name: "林初", role: "user", status: "active" } },
      "/providers": providers, "/model-prices": prices, "/projects": [project],
      "/projects/ready-project/workflow": workflow,
      "/credits/account": { balance: 1000, frozenBalance: 0 },
      "/creation/estimate": { estimatedCredits: 12, suggestedEpisodes: 1, breakdown: [], notes: [] }
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
}
async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  for (const item of await page.locator(".creator-readiness,.wb-stage-guide").all()) {
    expect(await item.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  }
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/platform-upgrade-20261029/screenshots"}/${name}-${test.info().project.name}.png`, fullPage: true });
}

test("existing script opens the correct path and text quotes remain available without image or video configuration", async ({ page }) => {
  await setup(page);
  await page.goto("/#/wizard");
  const ready = page.getByRole("region", { name: "生成准备情况" });
  await expect(ready).toContainText("连接与效果在实际生成时确认");
  await expect(ready.locator("li").filter({ hasText: "文本" })).toContainText("配置齐全");
  await expect(ready.locator("li").filter({ hasText: "图像" })).toContainText("暂未配置");
  expect(await ready.locator("header strong").evaluate(el => getComputedStyle(el).color)).not.toBe("rgb(248, 250, 252)");
  await capture(page, "creator-entry-final");
  await page.getByRole("button", { name: /开始剧本拆解/ }).click();
  await expect(page.getByRole("radio", { name: /已有剧本/ })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("剧本文本", { exact: true }).fill("第1集\n场1 小站\n林初：你回来了吗？\n林初打开旧信，等候列车。");
  await page.getByRole("button", { name: "下一步：全局设定", exact: true }).click();
  await page.getByRole("button", { name: "下一步：确认创建", exact: true }).click();
  await expect(ready.locator("li").filter({ hasText: "图像" })).toContainText("待选择");
  await page.locator(".creation-output-review > summary").click();
  await expect(page.getByText("保留原文，识别动作、台词、旁白与场次结构。", { exact: true })).toBeVisible();
  await page.locator(".creation-output-review > summary").click();
  await page.getByRole("button", { name: "获取文本报价并确认", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认冻结 12 积分并创建" })).toBeEnabled();
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await capture(page, "creator-script-review-dark");
});

test("stage guide respects unsaved edits, counts current episode media and does not finalize uploaded references", async ({ page }) => {
  await setup(page);
  await page.goto("/#/project/ready-project");
  const guide = page.getByRole("region", { name: "本阶段制作指引" });
  const nav = page.getByRole("navigation", { name: "项目生产阶段" });
  await page.getByRole("button", { name: "编辑镜头", exact: true }).click();
  await page.getByRole("textbox", { name: "画面描述", exact: true }).fill("尚未保存的画面");
  page.once("dialog", dialog => dialog.dismiss());
  await guide.getByRole("button", { name: "下一步：角色与场景" }).click();
  await expect(page.getByRole("textbox", { name: "画面描述", exact: true })).toHaveValue("尚未保存的画面");
  page.once("dialog", dialog => dialog.accept());
  await guide.getByRole("button", { name: "下一步：角色与场景" }).click();
  await expect(guide).toContainText("0 / 1");
  await expect(nav.getByRole("button", { name: "资产", exact: true }).locator(".wb-stage-complete")).toHaveCount(0);
  await guide.getByRole("button", { name: "下一步：分镜与首帧" }).click();
  await expect(guide).toContainText("第 1 集");
  await expect(guide.locator("dl > div").filter({ hasText: "有效首帧" })).toContainText("1 / 1");
  await expect(guide.locator("dl > div").filter({ hasText: "有效视频" })).toContainText("0 / 1");
  await capture(page, "creator-stage-final");
  await guide.getByRole("button", { name: "下一步：视频与成片" }).click();
  await page.getByRole("combobox", { name: "选择剧集", exact: true }).selectOption("2");
  await nav.getByRole("button", { name: "分镜", exact: true }).click();
  await expect(guide).toContainText("第 2 集");
  await expect(page.locator(".wb-shot-table tbody tr")).toHaveCount(1);
  await expect(guide.locator("dl > div").filter({ hasText: "有效首帧" })).toContainText("0 / 1");
  if (!await page.getByRole("button", { name: "切换到深色主题", exact: true }).isVisible()) await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("button", { name: "切换到深色主题", exact: true }).click();
  await capture(page, "creator-stage-final-dark");
});
