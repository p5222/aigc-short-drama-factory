import { test, expect, type Page } from "@playwright/test";

// Isolated UI fixtures: no suppliers, payments or production writes.
const providers = [
  { id: "relay-a", name: "创作主渠道", models: ["deepseek-v4-pro", "qwen3.7-plus"], apiKeyConfigured: true },
  { id: "relay-b", name: "备用渠道", models: ["deepseek-v4-pro"], apiKeyConfigured: true },
  { id: "missing-key", name: "待配置渠道", models: ["gpt-5.5"], apiKeyConfigured: false },
].map(item => ({ ...item, modality: "text", enabled: true, baseUrl: "https://example.test/v1", costHint: "界面夹具", capability: { ratios: [], supportsReferenceImage: false, supportsSeed: false }, routing: { mode: "auto" } }));
const prices = [
  { id: "price-a", providerId: "relay-a", providerName: "创作主渠道", model: "deepseek-v4-pro", unitCredits: 12 },
  { id: "price-q", providerId: "relay-a", providerName: "创作主渠道", model: "qwen3.7-plus", unitCredits: 5 },
  { id: "price-g", providerId: "missing-key", providerName: "待配置渠道", model: "gpt-5.5", unitCredits: 20 },
].map(item => ({ ...item, modality: "text", unit: "text_run", vendorCostCny: 0.1, enabled: true }));

async function fixtures(page: Page, admin = false) {
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "model-ui-fixture"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "model-user", name: "模型体验", role: admin ? "admin" : "creator", status: "active" } },
      "/providers": providers, "/model-prices": prices,
      "/workbench/summary": { userName: "模型体验", projects: 0, storyboards: 0, runningTasks: 0, credits: 1000, recentProjects: [], recentTasks: [], announcements: [] },
      "/credits/account": { userId: "model-user", balance: 1000, frozenBalance: 0, totalRecharge: 1000, totalConsume: 0 },
      "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] },
      "/admin/summary": { users: 0, projects: 0, tasksToday: 0, creditsConsumed: 0 },
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
}
async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/model-experience-20261026/screenshots"}/${name}-${test.info().project.name}.png`, fullPage: true });
}
test("catalog shows exact prices and configuration issues; favorites and compare persist", async ({ page }) => {
  await fixtures(page);
  await page.goto("/#/models");
  await expect(page.getByRole("heading", { name: "为每一步创作，找到合适的模型" })).toBeVisible();
  const primary = page.locator(".model-library-card").filter({ hasText: "创作主渠道 · deepseek-v4-pro" });
  const backup = page.locator(".model-library-card").filter({ hasText: "备用渠道 · deepseek-v4-pro" });
  await expect(primary).toContainText("12 积分/次");
  await expect(backup).toContainText("未配置价格");
  await expect(backup).not.toContainText("12 积分/次");
  await primary.getByRole("button", { name: /^收藏/ }).click();
  await primary.getByRole("checkbox").check();
  await page.locator(".model-library-card").filter({ hasText: "qwen3.7-plus" }).getByRole("checkbox").check();
  await capture(page, "catalog");
  await page.getByRole("button", { name: "对比模型", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "模型对比" })).toContainText("不同计费单位不能直接比较");
  await capture(page, "compare");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^收藏 1$/ }).click();
  await expect(page.locator(".model-library-card")).toHaveCount(1);
  await page.reload();
  await expect(primary.getByRole("button", { name: /^取消收藏/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await capture(page, "catalog-dark");
});
test("search keyboard and unavailable routes work; create submits chosen model and locks while pending", async ({ page }) => {
  await fixtures(page);
  let body: Record<string, unknown> | undefined;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/api/content/projects", async route => {
    if (route.request().method() !== "POST") return route.fulfill({ json: [] });
    body = route.request().postDataJSON();
    await pending;
    await route.fulfill({ status: 503, json: { message: "界面夹具：创建稍后重试" } });
  });
  await page.goto("/#/content");
  const trigger = page.getByRole("button", { name: /^选择文本创作模型/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "选择文本创作模型" });
  const search = dialog.getByRole("combobox");
  await expect(search).toBeFocused();
  await expect(dialog.getByRole("option").filter({ hasText: "未配置价格" })).toHaveAttribute("aria-disabled", "true");
  await expect(dialog.getByRole("option").filter({ hasText: "待配置" })).toHaveAttribute("aria-disabled", "true");
  await capture(page, "picker");
  await search.fill("does-not-exist");
  await expect(dialog.getByText("没有匹配的模型", { exact: true })).toBeVisible();
  await search.fill("qwen");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("Qwen 3.7 Plus");
  await page.getByRole("textbox", { name: "已有标题", exact: true }).fill("雨后的旧书店");
  await page.getByRole("button", { name: "开始结构拆解", exact: true }).click();
  await expect.poll(() => body?.textModel).toBe("qwen3.7-plus");
  expect(body?.textProvider).toBe("relay-a");
  await expect(trigger).toBeDisabled();
  finish();
  await expect(page.getByText("界面夹具：创建稍后重试", { exact: true })).toBeVisible();
});
test("admin catalog enters editor; nested picker escape restores parent and focus", async ({ page }) => {
  await fixtures(page, true);
  await page.goto("/admin#模型路由");
  await page.getByRole("button", { name: "模型目录与配置检查", exact: true }).click();
  await expect(page.getByText(/配置检查：2 个模型需要处理/)).toBeVisible();
  await capture(page, "admin-catalog");
  await page.locator(".model-library-card").filter({ hasText: "创作主渠道 · deepseek-v4-pro" }).getByRole("button", { name: "编辑渠道", exact: true }).click();
  const parent = page.getByRole("dialog", { name: "编辑创作主渠道渠道", exact: true });
  await expect(parent).toBeVisible();
  const trigger = parent.getByRole("button", { name: /^选择待测试模型/ });
  await trigger.click();
  const child = page.getByRole("dialog", { name: "选择待测试模型", exact: true });
  await expect(child).toBeVisible();
  await capture(page, "admin-picker");
  await child.getByRole("combobox").fill("qwen");
  await child.getByRole("option").filter({ hasText: "Qwen 3.7 Plus" }).click();
  await expect(child).toHaveCount(0);
  await expect(parent).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("Qwen 3.7 Plus");
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(child).toHaveCount(0);
  await expect(parent).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(parent).toHaveCount(0);
  await page.goto("/admin#价格策略");
  await page.getByRole("button", { name: "新增价格", exact: true }).click();
  await page.getByRole("button", { name: /^选择价格策略模型/ }).click();
  await expect(page.getByRole("dialog", { name: "选择价格策略模型", exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "选择价格策略模型", exact: true }).getByRole("combobox").click();
  await capture(page, "admin-price-picker");
});
test("no usable configured text model keeps creation disabled", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/model-prices", route => route.fulfill({ json: [] }));
  await page.goto("/#/content");
  await page.getByRole("textbox", { name: "已有标题", exact: true }).fill("没有配置的创作");
  await expect(page.getByRole("button", { name: "开始结构拆解", exact: true })).toBeDisabled();
});

test("brand, channel and availability intersect; reset restores hidden routes", async ({ page }) => {
  await fixtures(page);
  await page.goto("/#/models");
  await page.getByLabel("模型品牌", { exact: true }).selectOption("deepseek");
  await expect(page.locator(".model-library-card")).toHaveCount(2);
  await page.getByLabel("接入渠道", { exact: true }).selectOption("relay-b");
  await expect(page.locator(".model-library-card")).toHaveCount(1);
  await page.getByLabel("可用状态", { exact: true }).selectOption("ready");
  await expect(page.getByText("没有匹配的模型", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await expect(page.locator(".model-library-card")).toHaveCount(4);
  await page.getByLabel("模型品牌", { exact: true }).selectOption("qwen");
  await expect(page.locator(".model-library-card")).toHaveCount(1);
  await expect(page.locator(".model-library-card [data-brand=qwen] svg")).toHaveCount(1);
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await capture(page, "brand-filters-dark");
});
