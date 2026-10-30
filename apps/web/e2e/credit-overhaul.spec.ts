import { test, expect, type Page } from "@playwright/test";
const stamp = "2026-10-26T00:00:00.000Z";
const policy = { version: 1, targetMarginBps: 4000, creditValueMicros: 10000, usdCnyMicros: null, overheadBps: 0, protectMargin: true };
const rule = { version: 1, currency: "CNY", kind: "character", rateMicros: 800000, model: "qwen3-tts-flash", region: "cn-beijing",
  verifiedAt: stamp, sourceUrl: "https://help.aliyun.com/zh/model-studio/model-pricing" };
async function fixture(page: Page) {
  const state = { writes: [] as Array<{ path: string; body: any }>, queries: [] as URL[], reject: false, failFunding: false, hold: undefined as Promise<void> | undefined };
  let currentPolicy = { ...policy };
  const prices = [
    { id: "price-tts", providerId: "dashscope-tts", providerName: "配音渠道", model: "qwen3-tts-flash", modality: "tts", unit: "tts_character",
      unitCredits: 134, vendorCostCny: 0, billing: { ...rule }, officialCandidate: rule, enabled: true, updatedAt: stamp },
    { id: "price-text", providerId: "qwen-text", providerName: "文本渠道", model: "qwen-plus", modality: "text", unit: "text_run",
      unitCredits: 24, vendorCostCny: 0, billing: { ...rule, model: "qwen-plus", kind: "tokens", rateMicros: undefined, inputMicros: 2000000, outputMicros: 8000000, cachedInputMicros: 1000000 }, officialCandidate: null, enabled: true, updatedAt: stamp },
    { id: "price-video", providerId: "wan-video", providerName: "视频渠道", model: "wan2.7-i2v", modality: "video", unit: "video_second",
      unitCredits: 100, vendorCostCny: 0, billing: { ...rule, model: "wan2.7-i2v", kind: "second", rateMicros: 600000, resolutionRates: { "720P": 600000, "1080P": 1000000 } }, officialCandidate: null, enabled: true, updatedAt: stamp },
  ] as any[];
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "credits-ui-fixture"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace(/^\/api/, "");
    if (route.request().method() === "PATCH" || route.request().method() === "POST") {
      state.writes.push({ path, body: route.request().postDataJSON() }); await state.hold;
      if (!state.reject) {
        const input = route.request().postDataJSON();
        if (path.endsWith("/cost-rule")) prices.find(p => p.id === input.priceId).billing = input.rule;
        if (path.endsWith("/policy")) currentPolicy = { ...input.policy, version: currentPolicy.version + 1 };
      }
      return state.reject ? route.fulfill({ status: 409, json: { message: "价格或政策已变化，请重新预览" } }) : route.fulfill({ json: { saved: true } });
    }
    state.queries.push(url);
    if (state.failFunding && path === "/admin/credits/funding") return route.fulfill({ status: 503, json: { message: "账务读取暂时失败" } });
    const account = { userId: "credit-user", name: "林初", email: "fixture@example.test", balance: 1000, frozenBalance: 100, available: 900, totalRecharge: 1200, totalConsume: 200,
      consumeLedger: 200, frozenLedger: 100, fundedBalance: 1000, unclassifiedBalance: 0, anomaly: false };
    const rows = Array.from({ length: 45 }, (_, i) => ({ id: `ledger-${i}`, userId: account.userId, type: "consume", amount: -1, balanceAfter: 1000-i, description: `生成记录 ${i}`, taskId: `fixture-${i}`, createdAt: stamp }));
    const paged = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
    if (path.endsWith("/ledger.csv")) return route.fulfill({ contentType: "text/csv", headers: { "Content-Disposition": "attachment; filename=credit-page.csv" }, body: "流水ID,积分\nfixture,-1" });
    if (path.endsWith("/ledger")) {
      const number = Number(url.searchParams.get("page") ?? 1), size = Number(url.searchParams.get("pageSize") ?? 20);
      return route.fulfill({ json: { items: rows.slice((number-1)*size, number*size), total: rows.length, page: number, pageSize: size } });
    }
    const task = { id: "credit-task", title: "雨后书店配音", type: "tts", status: "succeeded", provider: "dashscope-tts", model: rule.model, estimatedCredits: 14, finalCredits: 14,
      createdAt: stamp, updatedAt: stamp, userId: account.userId, billing: { mode: "official", listCredits: 14, payableCredits: 14, maximumCredits: 14, discountPercent: 0, policyVersion: 1 },
      settlement: { chargedCredits: 14, releasedCredits: 0, costMicros: 80000, costStatus: "invoice_verified", funding: { cashMicros: 140000, unknownCredits: 0, giftCredits: 0, allocations: [] } } };
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: account.userId, name: account.name, role: "admin", status: "active" } },
      "/model-prices": prices, "/providers": [{ id: "dashscope-tts", name: "配音渠道", models: [rule.model], modality: "tts", enabled: true, apiKeyConfigured: true }],
      "/credits/account": account, "/credits/transactions": [], "/tasks": [task],
      "/admin/summary": {}, "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] },
      "/admin/credits/pricing": { policy: currentPolicy, effectivePolicy: currentPolicy, version: currentPolicy.version, prices, plans: [], memberships: [], catalog: [rule], warnings: [] },
      "/admin/credits/accounts": { ...paged([account]), totals: { balance: 1000, frozenBalance: 100, totalConsume: 200 } },
      "/admin/credits/funding": { items: [{ id: "fund-1", userId: account.userId, source: "paid", originalCredits: 1200, remainingCredits: 1000, cashMicros: 12000000, referenceId: "fixture-invoice", createdAt: stamp }], limit: 100 },
      "/admin/credits/tasks": paged([task]), "/billing/availability": { wechat: false, membership: false, autoRenew: false },
      "/billing/membership": { plans: [], active: null }, "/workbench/summary": { userName: account.name, credits: 900, recentProjects: [], recentTasks: [], announcements: [] }
    };
    await route.fulfill({ json: values[path] ?? [] });
  });
  return state;
}
async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  if (test.info().project.name === "mobile") expect(await page.locator(".credit-responsive").evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1))).toBeTruthy();
  await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
  await page.evaluate(() => document.querySelectorAll(".credit-table-scroll,.creator-table-scroll").forEach(element => { element.scrollLeft = 0; }));
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/credit-overhaul-20261026/screenshots"}/${name}-${test.info().project.name}.png`, fullPage: true });
}
test("official narration previews 1000 characters, cancellation makes no write and conflicts preserve the draft", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin#积分中心");
  await page.getByRole("combobox", { name: "模型价格", exact: true }).selectOption("price-tts");
  await page.getByLabel("配音字符数", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "预览报价", exact: true }).click();
  await expect(page.locator(".credit-preview")).toContainText("14 积分");
  await capture(page, "pricing");
  await page.getByRole("button", { name: "应用预览规则", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
  expect(state.writes).toHaveLength(0);
  state.reject = true;
  await page.getByRole("button", { name: "应用预览规则", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "应用此规则", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("价格或政策已变化");
  await expect(page.getByLabel("单位成本 / 万字符", { exact: true })).toHaveValue("0.8");
  expect(state.writes).toHaveLength(1);
});
test("wallet reconciliation, page CSV export and invoice verification remain single submissions", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin#积分中心");
  await page.getByRole("button", { name: "账户与资金", exact: true }).click();
  await expect(page.getByText("消费与冻结流水一致", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看账务", exact: true }).click();
  await expect(page.getByText("在线支付", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByRole("cell", { name: /生成记录 20/ })).toBeVisible();
  await page.getByRole("button", { name: "导出本页流水", exact: true }).click();
  await expect.poll(() => state.queries.filter(u => u.pathname.endsWith("/ledger.csv")).at(-1)?.searchParams.get("page")).toBe("2");
  expect(state.queries.filter(u => u.pathname.endsWith("/ledger.csv")).at(-1)?.searchParams.get("pageSize")).toBe("20");
  await capture(page, "accounts");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "任务对账", exact: true }).click();
  await expect(page.getByText("现金毛利 42.86%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "核对账单", exact: true }).click();
  await page.getByLabel("供应商账单成本（人民币元）").fill("0.08");
  await page.getByLabel("账单编号或核验凭据").fill("test-invoice");
  let finish!: () => void; state.hold = new Promise<void>(resolve => { finish = resolve; });
  await page.getByRole("button", { name: "保存账单核验", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存账单核验", exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  finish(); await expect(page.getByText("账单成本已核验，用户扣费保持不变。", { exact: true })).toBeVisible();
  await capture(page, "tasks");
});
test("creator ledger distinguishes frozen credits and exports the same server page", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/#/ledger");
  await expect(page.getByText("总余额 1,000 · 冻结 100", { exact: true })).toBeVisible();
  await expect(page.locator(".ledger-summary-grid article").first()).toContainText("900");
  await expect(page.locator("#creator-sidebar")).toContainText("900");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByRole("cell", { name: /生成记录 20/ })).toBeVisible();
  await page.getByRole("button", { name: "导出本页流水", exact: true }).click();
  await expect.poll(() => state.queries.filter(u => u.pathname.endsWith("/ledger.csv")).at(-1)?.searchParams.get("page")).toBe("2");
  expect(state.queries.filter(u => u.pathname.endsWith("/ledger.csv")).at(-1)?.searchParams.get("pageSize")).toBe("20");
  await capture(page, "ledger");
  await page.getByLabel("开始日期", { exact: true }).fill("2026-10-26");
  await page.getByLabel("结束日期", { exact: true }).fill("2026-10-26");
  await expect.poll(async () => {
    const query = state.queries.filter(u => u.pathname.endsWith("/ledger")).at(-1);
    if (!query?.searchParams.get("from") || !query.searchParams.get("to")) return null;
    return page.evaluate(({ from, to }) => {
      const start = new Date(from), end = new Date(to);
      return [start.getDate(), start.getHours(), end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()];
    }, { from: query.searchParams.get("from")!, to: query.searchParams.get("to")! });
  }).toEqual([26, 0, 26, 23, 59, 59, 999]);
  await page.goto("/#/profile");
  await expect(page.locator(".profile-v2-balance")).toContainText("900");
});
test("model pricing describes the narration reference as per ten thousand characters", async ({ page }) => {
  await fixture(page);
  await page.goto("/#/recharge");
  await page.locator(".creator-price-details summary").filter({ hasText: "查看全部模型价格" }).click();
  await expect(page.getByText("每万字符", { exact: true })).toBeVisible();
  await expect(page.getByText("每字符", { exact: true })).toHaveCount(0);
  await capture(page, "recharge");
});
test("structured text rates convert currency, reject invalid cache usage and preserve the draft across policy changes", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin#积分中心");
  await expect(page.getByLabel("目标毛利率（%）")).toHaveCount(0);
  await page.getByRole("combobox", { name: "模型价格", exact: true }).selectOption("price-text");
  await expect(page.getByLabel("视频秒数", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("输入成本 / 百万 Token", { exact: true })).toHaveValue("2");
  await page.getByLabel("输入成本 / 百万 Token", { exact: true }).fill("3.5");
  await page.getByLabel("输入 Token", { exact: true }).fill("1000");
  await page.getByLabel("输出 Token", { exact: true }).fill("0");
  await page.getByLabel("缓存输入 Token", { exact: true }).fill("2000");
  await page.getByRole("button", { name: "预览报价", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("缓存Token不能大于输入Token");
  await page.getByLabel("缓存输入 Token", { exact: true }).fill("0");
  await page.getByRole("button", { name: "预览报价", exact: true }).click();
  await expect(page.locator(".credit-preview")).toContainText("¥0.0035");
  await page.getByRole("button", { name: "编辑政策", exact: true }).click();
  await page.getByLabel("目标毛利率（%）").fill("50");
  await expect(page.getByRole("button", { name: "应用预览规则", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "保存政策", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "保存政策", exact: true }).click();
  await expect(page.getByRole("button", { name: "编辑政策", exact: true })).toBeVisible();
  await expect(page.getByLabel("输入成本 / 百万 Token", { exact: true })).toHaveValue("3.5");
  await expect(page.locator(".credit-preview")).toHaveCount(0);
  await page.getByRole("button", { name: "预览报价", exact: true }).click();
  await page.getByRole("button", { name: "应用预览规则", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "应用此规则", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1].body).toMatchObject({ priceId: "price-text", expectedPolicyVersion: 2, expectedUpdatedAt: stamp, rule: { inputMicros: 3500000, kind: "tokens" } });
  await expect(page.getByRole("button", { name: "放弃规则修改", exact: true })).toHaveCount(0);
});
test("video resolution preview uses its rate and advanced malformed data remains recoverable", async ({ page }) => {
  await fixture(page);
  await page.goto("/admin#积分中心");
  await page.getByRole("combobox", { name: "模型价格", exact: true }).selectOption("price-video");
  await expect(page.getByLabel("输入 Token", { exact: true })).toHaveCount(0);
  await page.getByLabel("视频秒数", { exact: true }).fill("5");
  await page.getByRole("combobox", { name: "视频分辨率", exact: true }).selectOption("1080P");
  await page.getByRole("button", { name: "预览报价", exact: true }).click();
  await expect(page.locator(".credit-preview")).toContainText("¥5.00");
  await expect(page.locator(".credit-preview")).toContainText("834 积分");
  await page.getByRole("combobox", { name: "结算币种", exact: true }).selectOption("USD");
  await page.getByRole("button", { name: "预览报价", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("美元计费需要先配置结算汇率");
  await page.locator("summary").filter({ hasText: "高级规则 JSON" }).click();
  const json = page.getByLabel("成本规则（JSON，金额为百万分之一货币）");
  const valid = await json.inputValue();
  await json.fill('{"version":1,"kind":"tokens","tiers":[null]}');
  await expect(page.getByRole("alert")).toContainText("规则结构不正确");
  await expect(page.getByRole("button", { name: "预览报价", exact: true })).toBeDisabled();
  await json.fill(valid.replace('"USD"', '"CNY"'));
  await page.getByRole("button", { name: "预览报价", exact: true }).click();
  await expect(page.locator(".credit-preview")).toContainText("834 积分");
  await page.locator("summary").filter({ hasText: "高级规则 JSON" }).click();
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await capture(page, "credit-video-dark");
});
test("invoice cost alone is guarded; optimistic conflicts retain cost and evidence", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin#积分中心");
  await page.getByRole("button", { name: "任务对账", exact: true }).click();
  await expect(page.getByRole("table", { name: "任务对账", exact: true }).getByText("已完成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "核对账单", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /真实账单核验/ });
  await dialog.getByLabel("供应商账单成本（人民币元）").fill("0.07");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toContainText("当前有尚未保存的修改");
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog.getByLabel("供应商账单成本（人民币元）")).toHaveValue("0.07");
  await dialog.getByLabel("账单编号或核验凭据").fill("invoice-audit");
  state.reject = true;
  await dialog.getByRole("button", { name: "保存账单核验", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("价格或政策已变化");
  await expect(dialog.getByLabel("账单编号或核验凭据")).toHaveValue("invoice-audit");
  expect(state.writes[0].body).toEqual({ taskId: "credit-task", expectedUpdatedAt: stamp, costMicros: 70000, invoiceReference: "invoice-audit" });
  await capture(page, "credit-invoice");
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "放弃修改", exact: true }).click();
  await page.getByRole("button", { name: "核对账单", exact: true }).click();
  await expect(dialog.getByLabel("供应商账单成本（人民币元）")).toHaveValue("");
});
test("account detail recovers from a read failure, closes cleanly and task filters reach the server", async ({ page }) => {
  const state = await fixture(page);
  state.failFunding = true;
  await page.goto("/admin#积分中心");
  await page.getByRole("button", { name: "账户与资金", exact: true }).click();
  await page.getByRole("button", { name: "查看账务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "账户账务 · 林初", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("账务读取暂时失败");
  state.failFunding = false;
  await dialog.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(dialog.getByText("在线支付", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.getByRole("button", { name: "查看账务", exact: true }).click();
  await expect(dialog.getByText("在线支付", { exact: true })).toBeVisible();
  await capture(page, "credit-account-dark");
  await page.keyboard.press("Escape");
  const count = state.queries.filter(query => query.pathname.endsWith("/funding")).length;
  await page.getByRole("button", { name: "任务对账", exact: true }).click();
  await page.getByRole("combobox", { name: "任务状态", exact: true }).selectOption("failed");
  await expect.poll(() => state.queries.filter(query => query.pathname.endsWith("/tasks")).at(-1)?.searchParams.get("status")).toBe("failed");
  expect(state.queries.filter(query => query.pathname.endsWith("/funding"))).toHaveLength(count);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await capture(page, "credit-tasks-dark");
});
