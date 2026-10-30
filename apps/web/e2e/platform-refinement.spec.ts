import { expect, test, type Page } from "@playwright/test";

const capability = { ratios: ["16:9", "9:16"], supportsReferenceImage: false, supportsSeed: false, supportsImageToImage: false, supportsImageToVideo: false, supportsAsyncTask: false };
const providers = [
  { id: "qwen-main", name: "千问主渠道", models: ["qwen-plus", "qwen-max"] },
  { id: "doubao-main", name: "豆包创作", models: ["doubao-pro"] },
  { id: "gemini-main", name: "Gemini 创作", models: ["gemini-pro", "gemini-flash"] },
  { id: "gemini-backup", name: "Gemini 创作", models: ["gemini-pro"] },
].map(provider => ({ ...provider, modality: "text", enabled: true, apiKeyConfigured: true, capability, costHint: "", routing: { mode: "auto", modelPool: provider.models } }));
const basePrices = providers.flatMap(provider => provider.models.map((model, i) => ({
  id: `${provider.id}-${i}`, providerId: provider.id, providerName: provider.name, modality: "text", model,
  unit: "text_run", unitCredits: 8 + i * 4, vendorCostCny: 0.03, enabled: true
}))).filter(price => price.model !== "qwen-max");
for (let i = 0; i < 23; i++) basePrices.push({ ...basePrices[0], id: `historical-${i}`, model: `qwen-retired-${i}` });

async function fixtures(page: Page) {
  let prices = structuredClone(basePrices);
  const writes: unknown[] = [];
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "platform-ui-fixture"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path.startsWith("/admin/model-prices/") && route.request().method() === "PATCH") {
      const input = route.request().postDataJSON();
      writes.push(input);
      prices = prices.map(price => price.id === path.split("/").at(-1) ? { ...price, ...input } : price);
      return route.fulfill({ json: prices.find(price => price.id === path.split("/").at(-1)) });
    }
    const data: Record<string, unknown> = {
      "/auth/me": { user: { id: "admin-fixture", name: "漫角运营", role: "admin", status: "active" } },
      "/providers": providers, "/model-prices": prices,
      "/admin/summary": { users: 38, projects: 106, tasksToday: 32, totalTasks: 450, completedTasks: 420, successRate: 98, creditsConsumed: 12600, paidRechargeCny: 880, providerCost: null, refundCredits: 360, operations: { openTickets: 3, pendingWorks: 2, pendingOrders: 1, activeTasks: 4, updatedAt: "2026-10-29T12:00:00Z" } },
      "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] }
    };
    return route.fulfill({ json: data[path] ?? [] });
  });
  return writes;
}
async function capture(page: Page, name: string) {
  await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/platform-upgrade-20261029/screenshots"}/${name}-${test.info().project.name}.png`, fullPage: true });
  if (name === "prices") await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/platform-upgrade-20261029/screenshots"}/prices-viewport-${test.info().project.name}.png` });
}
test("model coverage counts declared models, exposes missing prices and opens the exact channel", async ({ page }) => {
  await fixtures(page);
  await page.goto("/admin#运营总览");
  const channel = page.locator(".adm-health-row").filter({ hasText: "千问主渠道" });
  await expect(channel.locator("meter")).toHaveAttribute("value", "1");
  await expect(channel.locator("meter")).toHaveAttribute("max", "2");
  await expect(channel).toContainText("未配置价格");
  await capture(page, "overview");
  await page.getByRole("button", { name: /待处理渠道/ }).click();
  await expect(page.locator(".adm-health-row")).toHaveCount(1);
  await channel.getByRole("button", { name: "检查渠道", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "编辑千问主渠道渠道", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/admin#运营总览");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await capture(page, "overview-dark");
});
test("prices compare models by route; grouped pages never split a channel; editing persists", async ({ page }) => {
  const writes = await fixtures(page);
  await page.goto("/admin#价格策略");
  await expect(page.getByRole("heading", { name: "模型价格明细", exact: true })).toBeVisible();
  await expect(page.locator(".adm-table-scroll tbody tr")).toHaveCount(20);
  await expect(page.locator(".adm-table-scroll tbody tr").filter({ hasText: "qwen-plus" })).toContainText("Qwen Plus");
  await capture(page, "prices");
  const first = page.locator(".adm-table-scroll tbody tr").filter({ hasText: "qwen-plus" }).first();
  await first.getByRole("button", { name: "编辑价格", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑价格策略", exact: true });
  await dialog.getByLabel("积分 / 次", { exact: true }).fill("15");
  await dialog.getByRole("button", { name: "保存价格", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(dialog).toHaveCount(0);
  await expect(first).toContainText("15");
  await page.getByRole("button", { name: "按渠道", exact: true }).click();
  await expect(page.locator(".admin-price-provider-card")).toHaveCount(4);
  const group = page.locator(".admin-price-provider-card").filter({ hasText: "千问主渠道" });
  await group.getByRole("button", { name: "展开价格", exact: true }).click();
  await expect(group.locator(".admin-price-record")).toHaveCount(24);
  await expect(page.locator(".admin-price-provider-card").filter({ hasText: "Gemini 创作" })).toHaveCount(2);
});
test("real colored marks render across repeated Gemini instances without duplicate gradient IDs", async ({ page }) => {
  await fixtures(page);
  await page.goto("/admin#运营总览");
  await expect(page.locator('[data-brand="seed"] path[fill="#37E1BE"]')).toHaveCount(1);
  await expect(page.locator('[data-brand="qwen"] path[fill="#082dff"]')).toHaveCount(1);
  const gradients = page.locator('[data-brand="gemini"] linearGradient');
  await expect(gradients).toHaveCount(6);
  const ids = await gradients.evaluateAll(elements => elements.map(element => element.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(await page.locator('[data-brand="gemini"] path[fill^="url"]').evaluateAll(paths => paths.every(path => {
    const id = path.getAttribute("fill")!.slice(5, -1);
    return !!path.closest("svg")?.querySelector(`[id="${id}"]`);
  }))).toBeTruthy();
});
