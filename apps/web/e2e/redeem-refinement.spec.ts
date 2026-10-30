import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const stamp = "2026-10-29T08:00:00.000Z";
async function fixtures(page: Page) {
  const codes = [
    { id: "code-1", batchId: "batch-A", name: "创作体验", code: "TRIAL-0123456789ABCDEF01234567", credits: 300, maxRedemptions: 2, usedCount: 0, enabled: true, createdAt: stamp },
    { id: "code-2", batchId: "batch-A", name: "创作体验", code: "TRIAL-ABCDEF012345678901234567", credits: 300, maxRedemptions: 2, usedCount: 1, enabled: true, createdAt: stamp }
  ];
  const attempts: Record<string, unknown>[] = [], updates: Record<string, unknown>[] = [];
  let fail = true;
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "redeem-ui"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url()), path = url.pathname.replace(/^\/api/, "");
    if (path === "/admin/redeem-codes/batch") {
      const input = route.request().postDataJSON(); attempts.push(input);
      if (fail) { fail = false; return route.fulfill({ status: 503, json: { message: "网络响应中断，请重试" } }); }
      const created = Array.from({ length: input.count }, (_, i) => ({ ...codes[0], ...input, id: `new-${i}`, batchId: "new-batch", code: `NEW-CODE-${i}`, usedCount: 0 }));
      codes.push(...created); return route.fulfill({ status: 201, json: created });
    }
    if (path.startsWith("/admin/redeem-codes/") && route.request().method() === "PATCH") {
      const input = route.request().postDataJSON(); updates.push(input);
      const code = codes.find(code => code.id === path.split("/").at(-1))!;
      Object.assign(code, input); return route.fulfill({ json: code });
    }
    const data: Record<string, unknown> = {
      "/auth/me": { user: { id: "admin-fixture", name: "运营", role: "admin", status: "active" } },
      "/admin/redeem-codes": codes,
      "/admin/summary": { users: 2, projects: 0, tasksToday: 0, totalTasks: 0, completedTasks: 0, creditsConsumed: 0 },
      "/admin/redeem-redemptions": { items: [{ id: "history-1", name: "创作体验", maskedCode: "•••• 4567", credits: 300, createdAt: stamp, user: { id: "creator-1", name: "林初" } }], total: 1, page: 1, pageSize: 20 },
      "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] },
    };
    return route.fulfill({ json: data[path] ?? [] });
  });
  return { attempts, updates };
}

test("redeem creation previews liability, preserves retry identity, offers a downloadable receipt", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/admin#兑换码");
  await page.getByRole("button", { name: "生成兑换码", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "生成兑换码", exact: true });
  await dialog.getByLabel("活动名", { exact: true }).fill("=SUM(1,2)");
  await dialog.getByLabel("生成份数", { exact: true }).fill("2");
  await dialog.getByLabel("每码总次数", { exact: true }).fill("3");
  await dialog.getByLabel("结束时间", { exact: true }).fill("2099-12-01T18:30");
  await expect(dialog.locator(".adm-redeem-preview")).toContainText("1,800");
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog).toContainText("网络响应中断");
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.attempts).toHaveLength(2);
  expect(state.attempts[0].requestId).toBe(state.attempts[1].requestId);
  expect(state.attempts[1].endsAt).toMatch(/^2099-/);
  await expect(page.locator(".adm-redeem-receipt")).toContainText("已生成 2 个兑换码");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出新批次", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("兑换码-2份.csv");
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("\"'=SUM(1,2)\"");
  expect(csv).toContain("NEW-CODE-0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR}/redeem-${test.info().project.name}.png`, fullPage: true });
});

test("redeem batches retain whole-batch totals; used code identity is locked and history is readable", async ({ page }) => {
  await fixtures(page);
  await page.goto("/admin#兑换码");
  const view = page.locator("select").filter({ has: page.locator('option[value="batches"]') });
  await view.selectOption("batches");
  await expect(page.locator(".admin-redeem-batch-summary")).toContainText("2 总数");
  await page.getByRole("button", { name: "展开批次", exact: true }).click();
  await expect(page.locator(".admin-redeem-record")).toHaveCount(2);
  const used = page.locator(".admin-redeem-record").filter({ hasText: "已用 1 / 2" });
  await used.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑兑换码", exact: true });
  await expect(editor.getByLabel("兑换码", { exact: true })).toBeDisabled();
  await expect(editor.getByLabel("每次到账积分", { exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "停用并保留记录", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await used.getByRole("button", { name: "记录", exact: true }).click();
  const history = page.getByRole("dialog", { name: "兑换记录", exact: true });
  await expect(history).toContainText("林初");
  await expect(history).toContainText("+300 积分");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  expect(await page.locator(".admin-redeem-code-list").evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1))).toBeTruthy();
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR}/redeem-batches-dark-${test.info().project.name}.png`, fullPage: true });
});

test("creator redemption reveals the receipt and recovers a history read failure", async ({ page }) => {
  await fixtures(page);
  let redeemed = false, failHistory = true, requests = 0;
  await page.route("**/api/credits/**", route => {
    const path = new URL(route.request().url()).pathname;
    const account = { balance: redeemed ? 400 : 100, frozenBalance: 0, totalRecharge: redeemed ? 400 : 100, totalConsume: 0 };
    if (path.endsWith("/redeem")) { requests++; redeemed = true; return route.fulfill({ json: { ...account, balance: 400, totalRecharge: 400 } }); }
    if (path.endsWith("/account")) return route.fulfill({ json: account });
    if (path.endsWith("/redemptions")) {
      if (failHistory) return route.fulfill({ status: 503, json: { message: "兑换记录读取失败，请刷新记录" } });
      return route.fulfill({ json: { items: [{ id: "receipt", name: "创作体验", maskedCode: "•••• 4567", credits: 300, createdAt: stamp }], total: 1, page: 1, pageSize: 20 } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/billing/**", route => route.fulfill({ json: { wechat: false, membership: false, scheduled: [] } }));
  await page.goto("/#/recharge");
  await page.getByRole("textbox", { name: "兑换码", exact: true }).fill("TRIAL-0123456789ABCDEF01234567");
  await page.getByRole("button", { name: "兑换积分", exact: true }).click();
  await expect(page.getByText("兑换成功，当前积分余额 400。")).toBeVisible();
  const history = page.getByRole("region", { name: "我的兑换记录", exact: true });
  await expect(history).toContainText("兑换记录读取失败");
  failHistory = false;
  await history.getByRole("button", { name: "刷新记录", exact: true }).click();
  await expect(history).toContainText("+300 积分");
  expect(requests).toBe(1);
  await expect(page.getByRole("textbox", { name: "兑换码", exact: true })).toBeEmpty();
});
