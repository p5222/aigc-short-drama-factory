import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// UI fixtures only. No real account, model generation, payment or production mutation.
async function fixture(page: Page, admin = false) {
  await page.addInitScript(() => {
    localStorage.setItem("aifilm_auth_token", "brand-platform-fixture");
    localStorage.setItem("manjiao-theme", "light");
  });
  const models = [
    ["DeepSeek 官方 API", "deepseek-v4-pro", "text"], ["OpenAI 接入渠道", "gpt-5.5", "text"],
    ["Google AI Studio", "gemini-3.1-pro-preview", "text"], ["阿里云百炼", "qwen3.7-plus", "text"],
    ["豆包视觉", "doubao-seedream-5-0-lite", "image"], ["Google AI Studio", "gemini-3-pro-image", "image"],
    ["通义万相", "wanx2.1-i2v-plus", "video"], ["豆包视频", "doubao-seedance-1-5-pro", "video"],
    ["阿里云百炼", "glm-5.1", "text"]
  ];
  const providers = models.map(([name, model, modality], i) => ({ id: `provider-${i}`, name, models: [model], modality, enabled: true, apiKeyConfigured: true,
    capability: { ratios: ["16:9", "9:16"], supportsImageToImage: modality === "image", supportsImageToVideo: modality === "video", supportsReferenceImage: modality !== "text" } }));
  const prices = providers.map((p, i) => ({ id: `price-${i}`, providerId: p.id, providerName: p.name, model: p.models[0], modality: p.modality, unit: p.modality === "text" ? "text_run" : p.modality === "image" ? "image" : "video_second", unitCredits: 12 + i, vendorCostCny: .1, enabled: true }));
  const project = { id: "brand-project", name: "风起旧书店", intro: "一封未寄出的信，一段跨越时光的相遇。", type: "漫剧", status: "scripting", sourceType: "script", artStyle: "国漫", videoRatio: "16:9", episodes: 3, storyboards: 12, characters: 2, imageAssets: 6, videoClips: 0, creditsSpent: 28, updatedAt: "2026-10-28T10:00:00Z" };
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "brand-user", name: "林间", email: "creator@qq.com", role: admin ? "admin" : "creator", status: "active" } },
      "/providers": providers, "/model-prices": prices, "/projects": [project],
      "/workbench/summary": { userName: "林间", projects: 1, storyboards: 12, runningTasks: 0, credits: 12080, recentProjects: [project], recentTasks: [], actionCounts: { waiting: 1, active: 0, failed: 0 }, announcements: [] },
      "/credits/account": { balance: 12400, frozenBalance: 320, totalRecharge: 20000, totalConsume: 7600 },
      "/credits/ledger": { items: [], total: 0 },
      "/plans": [49, 129, 299].map((price, i) => ({ id: `plan-${i}`, name: ["轻量创作", "进阶创作", "专业创作"][i], enabled: true, price, credits: [5000, 15000, 40000][i], bonusCredits: [0, 1000, 5000][i], badge: i === 1 ? "推荐" : "", features: ["积分永久有效", "全部创作能力通用"], shopUrl: "https://example.test/checkout" })),
      "/billing/availability": { wechat: false, membership: false, autoRenew: false },
      "/billing/membership": { scheduled: [] },
      "/support/tickets": { items: [], total: 0 },
      "/admin/summary": { users: 0, projects: 0, tasksToday: 0 },
      "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] }
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
}
async function capture(page: Page, name: string) {
  await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  if (process.env.PLAYWRIGHT_SCREENSHOT_DIR) {
    await mkdir(process.env.PLAYWRIGHT_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.PLAYWRIGHT_SCREENSHOT_DIR, `${name}-${test.info().project.name}.png`), fullPage: true });
  }
}
test("account overview exposes admin entry only to active administrators", async ({ page }) => {
  await fixture(page, true);
  await page.goto("/#/profile");
  await expect(page.getByRole("link", { name: /进入管理后台/ })).toHaveAttribute("href", "/admin");
  await expect(page.getByRole("region", { name: "账户概览" })).toContainText("12,080");
  await capture(page, "profile-light");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await capture(page, "profile-dark");
});
test("creator recharge shows spendable balance and jumps to redeem without changing route", async ({ page }) => {
  await fixture(page);
  await page.goto("/#/profile");
  await expect(page.getByRole("link", { name: /进入管理后台/ })).toHaveCount(0);
  await page.goto("/#/recharge");
  await expect(page.getByRole("region", { name: "充值账户概览" })).toContainText("12,080");
  await page.getByRole("button", { name: "使用兑换码", exact: true }).click();
  await expect(page).toHaveURL(/#\/recharge$/);
  await expect(page.getByRole("heading", { name: "已有卡密？直接兑换" })).toBeInViewport();
  await page.evaluate(() => scrollTo(0, 0));
  await capture(page, "recharge-light");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await capture(page, "recharge-dark");
});
test("shared creator pages retain readable geometry across themes", async ({ page }) => {
  await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const route of ["workbench", "models", "scripts", "tasks", "help", "settings", "ledger"]) {
    await page.goto(`/#/${route}`);
    await expect(page.locator(".page-stack h1").first()).toBeVisible();
    await capture(page, `${route}-light`);
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await capture(page, `${route}-dark`);
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
  }
  expect(errors).toEqual([]);
});
