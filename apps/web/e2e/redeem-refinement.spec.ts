import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { redeemCodeStatus, type RedeemCode } from "@aifilm/shared";

const stamp = "2026-10-29T08:00:00.000Z", newer = "2026-10-30T09:00:00.000Z";
async function fixtures(page: Page, count = 2) {
  const codes: RedeemCode[] = Array.from({ length: count }, (_, i) => ({
    id: `code-${i + 1}`, batchId: "batch-A", name: "创作体验", code: `TRIAL-${String(i + 1).padStart(24, "0")}`,
    credits: 300, maxRedemptions: 2, usedCount: i === 1 ? 1 : 0, enabled: true, createdAt: stamp, updatedAt: stamp
  }));
  const batches = [{ id: "batch-A", name: "创作体验", prefix: "TRIAL", enabled: true, createdAt: stamp, updatedAt: stamp }];
  const state = { codes, attempts: [] as Record<string, any>[], updates: [] as Record<string, any>[], reads: [] as string[], queries: [] as URLSearchParams[], failCreate: true, failBatches: false, failCodes: false, failHistory: false, conflict: false, userId: "admin-fixture" };
  const createdByRequest = new Map<string, RedeemCode[]>();
  const summary = (rows: RedeemCode[]) => ({ codes: rows.length, active: rows.filter(row => row.status === "active").length, disabled: rows.filter(row => row.status === "disabled").length, scheduled: 0, expired: 0, used_up: 0,
    remainingCredits: rows.reduce((sum, row) => sum + (row.status === "active" ? (row.maxRedemptions - row.usedCount) * row.credits : 0), 0), redemptions: rows.filter(row => row.id === "code-2").length, redeemedCredits: rows.some(row => row.id === "code-2") ? 300 : 0 });
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "redeem-ui"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url()), path = url.pathname.replace(/^\/api/, ""), q = url.searchParams;
    const codeRows = () => codes.map(code => { const row = { ...code, batchEnabled: batches.find(batch => batch.id === code.batchId)?.enabled ?? true }; return { ...row, status: redeemCodeStatus(row) }; });
    const filtered = () => codeRows().filter(code => (!q.get("batchId") || code.batchId === q.get("batchId")) && (!q.get("codeId") || code.id === q.get("codeId")) && (q.get("legacy") !== "true" || !code.batchId) && (!q.get("search") || `${code.name} ${code.code}`.includes(q.get("search")!)) && (!q.get("status") || q.get("status") === "all" || code.status === q.get("status")) && (q.get("distributable") !== "true" || (code.status === "active" && code.usedCount === 0)));
    const paged = (rows: unknown[]) => { const pageNo = Math.min(Number(q.get("page") || 1), Math.max(1, Math.ceil(rows.length / 20))); return { items: rows.slice((pageNo - 1) * 20, pageNo * 20), total: rows.length, page: pageNo, pageSize: 20 }; };
    if (route.request().method() === "GET") { state.reads.push(path); state.queries.push(q); }
    if (path === "/admin/redeem-codes/batch") {
      const input = route.request().postDataJSON(); state.attempts.push(input);
      if (!createdByRequest.has(input.requestId)) {
        const id = `new-batch-${createdByRequest.size}`;
        const created = Array.from({ length: input.count }, (_, i) => ({ ...codes[0], ...input, id: `${id}-${i}`, batchId: id, code: `NEW-CODE-${i}`, usedCount: 0 }));
        codes.push(...created); createdByRequest.set(input.requestId, created);
        batches.unshift({ id, name: input.name, prefix: input.prefix, enabled: true, createdAt: stamp, updatedAt: stamp });
      }
      if (state.failCreate) { state.failCreate = false; return route.fulfill({ status: 503, json: { message: "网络响应中断，请重试" } }); }
      return route.fulfill({ status: 201, json: createdByRequest.get(input.requestId) });
    }
    if (route.request().method() === "PATCH" && path.includes("/redeem-")) {
      const input = route.request().postDataJSON(); state.updates.push({ path, ...input });
      if (path === "/admin/redeem-codes/status") {
        const rows = codes.filter(code => input.codes.some((item: { id: string }) => item.id === code.id));
        const changed = rows.filter(row => row.enabled !== input.enabled).length;
        rows.forEach(row => Object.assign(row, { enabled: input.enabled, updatedAt: newer }));
        return route.fulfill({ json: { requested: rows.length, changed, unchanged: rows.length - changed } });
      }
      if (path.startsWith("/admin/redeem-batches/")) {
        Object.assign(batches.find(batch => path.includes(batch.id))!, { enabled: input.enabled, updatedAt: newer });
        return route.fulfill({ json: { requested: count, changed: count, unchanged: 0 } });
      }
      const code = codes.find(code => code.id === path.split("/").at(-1))!;
      if (state.conflict) { state.conflict = false; Object.assign(code, { name: "另一位管理员已更新", updatedAt: newer }); return route.fulfill({ status: 409, json: { message: "记录已被修改，请刷新后核对" } }); }
      Object.assign(code, input, { updatedAt: newer }); return route.fulfill({ json: code });
    }
    if (path === "/admin/redeem-batches") {
      if (state.failBatches) return route.fulfill({ status: 503, json: { message: "批次读取暂时失败" } });
      const rows = batches.filter(batch => (!q.get("search") || `${batch.id} ${batch.name} ${batch.prefix}`.includes(q.get("search")!)) && (!q.get("status") || q.get("status") === "all" || batch.enabled === (q.get("status") === "enabled"))).map(batch => ({ ...batch, summary: summary(codeRows().filter(row => row.batchId === batch.id)) }));
      return route.fulfill({ json: { ...paged(rows), legacyCodes: codes.filter(code => !code.batchId).length } });
    }
    if (path === "/admin/redeem-codes/page") {
      if (state.failCodes) return route.fulfill({ status: 503, json: { message: "码明细读取暂时失败" } });
      const rows = filtered(); return route.fulfill({ json: { ...paged(rows), summary: summary(rows) } });
    }
    if (path === "/admin/redeem-codes/export") { const items = filtered(); return route.fulfill({ json: { items, total: items.length, exportedAt: stamp } }); }
    if (path === "/admin/redeem-redemptions") {
      if (state.failHistory) return route.fulfill({ status: 503, json: { message: "记录读取暂时失败" } });
      return route.fulfill({ json: { items: [{ id: "history-1", name: "创作体验", maskedCode: "•••• 0002", credits: 300, createdAt: stamp, user: { id: "creator-1", name: "林初" } }], total: 1, page: 1, pageSize: 20 } });
    }
    const data: Record<string, unknown> = {
      "/auth/me": { user: { id: state.userId, name: "运营", role: "admin", status: "active" } },
      "/admin/summary": { users: 2, projects: 0, tasksToday: 0, totalTasks: 0, completedTasks: 0, creditsConsumed: 0 },
      "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] }
    };
    return route.fulfill({ json: data[path] ?? [] });
  });
  return state;
}
async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/operations-refinement-20261030/screenshots"}/${name}-${test.info().project.name}.png`, fullPage: true });
}

test("create receipt survives a lost response and keeps one identity across reopening", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/admin#兑换码");
  await page.getByRole("button", { name: "生成兑换码", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "生成兑换码", exact: true });
  await dialog.getByLabel("活动名", { exact: true }).fill("=SUM(1,2)");
  await dialog.getByLabel("生成份数", { exact: true }).fill("2");
  await dialog.getByLabel("每码总次数", { exact: true }).fill("3");
  await dialog.getByLabel("结束时间", { exact: true }).fill("2099-12-01T18:30");
  await expect(dialog.locator(".redeem-create-preview")).toContainText("1,800");
  await capture(page, "redeem-create");
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog).toContainText("网络响应中断");
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "生成兑换码", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "生成兑换码", exact: true });
  await expect(dialog.getByLabel("活动名", { exact: true })).toHaveValue("=SUM(1,2)");
  state.failBatches = true;
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".redeem-created")).toContainText("已生成 2 个兑换码");
  expect(state.attempts).toHaveLength(2);
  expect(state.attempts[0].requestId).toBe(state.attempts[1].requestId);
  expect(state.codes).toHaveLength(4);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出新批次", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^兑换码-新批次-2份-/);
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("\"'=SUM(1,2)\""); expect(csv).toContain("NEW-CODE-0");
  state.failBatches = false;
  await page.getByRole("button", { name: "重新读取批次", exact: true }).click();
  await expect(page.getByRole("table", { name: "活动批次列表" })).toBeVisible();
  expect(state.attempts).toHaveLength(2);
  expect(state.reads).not.toContain("/admin/redeem-codes");
  expect(state.reads.filter(path => path === "/admin/summary")).toHaveLength(1);
});

test("create retry identity is scoped to the current administrator", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/admin#兑换码");
  await page.getByRole("button", { name: "生成兑换码", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("网络响应中断");
  state.userId = "second-admin";
  await page.reload();
  await page.getByRole("button", { name: "生成兑换码", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toContainText("已恢复本账号");
  await page.getByRole("dialog").getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.locator(".redeem-created")).toBeVisible();
  expect(state.attempts[0].requestId).not.toBe(state.attempts[1].requestId);
});

test("batch control preserves individual flags, exports accurate scopes and shows used-code history", async ({ page }) => {
  const state = await fixtures(page);
  state.codes[0].enabled = false;
  await page.goto("/admin#兑换码");
  await expect(page.getByRole("button", { name: "活动批次", exact: true })).toHaveAttribute("aria-pressed", "true");
  await capture(page, "redeem-batches");
  await page.getByRole("button", { name: "管理批次", exact: true }).click();
  const batch = page.getByRole("dialog", { name: "批次详情", exact: true });
  await expect(batch.locator(".redeem-totals")).toContainText("300");
  await batch.getByRole("button", { name: "暂停批次", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "暂停整批", exact: true }).click();
  await expect(batch.getByRole("button", { name: "恢复批次", exact: true })).toBeEnabled();
  await batch.getByRole("button", { name: "恢复批次", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "恢复整批", exact: true }).click();
  await expect(batch.getByRole("button", { name: "暂停批次", exact: true })).toBeEnabled();
  expect(state.codes[0].enabled).toBe(false);
  expect(state.updates.every(item => item.path === "/admin/redeem-batches/batch-A/status")).toBeTruthy();
  await batch.getByRole("button", { name: "导出可发放码", exact: true }).click();
  await expect(batch).toContainText("当前范围没有可导出");
  const downloadEvent = page.waitForEvent("download");
  await batch.getByRole("button", { name: "导出整批", exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toMatch(/整批-batch-A-2份/);
  const used = batch.getByRole("row").filter({ hasText: "已用 1 / 2" });
  await used.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑兑换码", exact: true });
  await expect(editor.getByLabel("兑换码", { exact: true })).toBeDisabled();
  await expect(editor.getByLabel("每次到账积分", { exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await used.getByRole("button", { name: "记录", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "兑换记录", exact: true })).toContainText("林初");
  await page.keyboard.press("Escape");
  await capture(page, "redeem-batch-detail");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await capture(page, "redeem-batches-dark");
  await page.getByRole("button", { name: "管理批次", exact: true }).click();
  await expect(batch.getByRole("table")).toBeVisible();
  await capture(page, "redeem-batch-detail-dark");
});

test("server pages clear selection; filtered export and atomic status payload match their stated scope", async ({ page }) => {
  const state = await fixtures(page, 33);
  await page.goto("/admin#兑换码");
  await page.getByRole("button", { name: "码明细", exact: true }).click();
  const list = page.getByRole("region", { name: "码明细", exact: true });
  await expect(list.locator("tbody tr")).toHaveCount(20);
  await list.getByRole("checkbox", { name: "选择当前页全部兑换码", exact: true }).check();
  await expect(list).toContainText("已选 20 个");
  const selectedDownload = page.waitForEvent("download");
  await list.getByRole("button", { name: "导出选中 20 份", exact: true }).click();
  expect((await selectedDownload).suggestedFilename()).toContain("当前选择-20份");
  await list.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(list.locator("tbody tr")).toHaveCount(13);
  await expect(list.getByRole("checkbox", { name: "选择当前页全部兑换码", exact: true })).not.toBeChecked();
  await list.getByRole("checkbox", { name: "选择当前页全部兑换码", exact: true }).check();
  await list.getByRole("button", { name: "停用选中", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "停用 13 个码", exact: true }).click();
  await expect(list).toContainText("已处理 13 个码");
  expect(state.updates).toHaveLength(1);
  expect(state.updates[0].codes).toHaveLength(13);
  expect(state.updates[0].codes[0]).toEqual({ id: "code-21", updatedAt: stamp });
  await list.getByLabel("兑换状态", { exact: true }).selectOption("disabled");
  await expect(list).toContainText("本页 13 个");
  expect(state.queries.at(-1)?.get("page")).toBe("1");
  const filteredDownload = page.waitForEvent("download");
  await list.getByRole("button", { name: "导出当前筛选 13 份", exact: true }).click();
  const download = await filteredDownload;
  expect(download.suggestedFilename()).toContain("当前筛选-13份");
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain(state.codes[20].code); expect(csv).not.toContain(state.codes[0].code);
  await capture(page, "redeem-code-list");
  expect(state.reads.filter(path => path === "/admin/summary")).toHaveLength(1);
});

test("failed reads remain distinguishable from empty results and history owns its filters", async ({ page }) => {
  const state = await fixtures(page);
  state.failBatches = true;
  await page.goto("/admin#兑换码");
  await expect(page.getByText("批次读取暂时失败", { exact: false })).toBeVisible();
  await expect(page.getByText("创建第一批兑换码", { exact: true })).toHaveCount(0);
  state.failBatches = false;
  await page.getByRole("button", { name: "重新读取批次", exact: true }).click();
  await expect(page.getByRole("table", { name: "活动批次列表" })).toBeVisible();
  state.failCodes = true;
  await page.getByRole("button", { name: "码明细", exact: true }).click();
  await expect(page.getByText("码明细读取暂时失败", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /导出当前筛选/ })).toHaveCount(0);
  state.failCodes = false;
  await page.getByRole("button", { name: "重新读取码明细", exact: true }).click();
  await expect(page.getByRole("table", { name: "兑换码列表" })).toBeVisible();
  await page.getByRole("button", { name: "兑换记录", exact: true }).click();
  const history = page.getByRole("region", { name: "兑换记录", exact: true });
  await history.getByLabel("搜索记录", { exact: true }).fill("林初");
  await history.getByLabel("到账开始日期", { exact: true }).fill("2026-10-28");
  await history.getByLabel("到账结束日期", { exact: true }).fill("2026-10-30");
  await history.getByRole("button", { name: "筛选记录", exact: true }).click();
  await expect.poll(() => state.queries.at(-1)?.get("search")).toBe("林初");
  expect(state.queries.at(-1)?.get("from")).toBeTruthy();
  expect(Date.parse(state.queries.at(-1)!.get("to")!) - Date.parse(state.queries.at(-1)!.get("from")!)).toBe(3 * 86400000);
  await expect(page.getByLabel("兑换状态", { exact: true })).toHaveCount(0);
  await expect(history).toContainText("+300 积分");
  const downloadEvent = page.waitForEvent("download");
  await history.getByRole("button", { name: "导出本页记录", exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toContain("兑换记录-第1页-1条");
  await capture(page, "redeem-history");
});

test("concurrent edit keeps the draft until the administrator explicitly reloads the latest version", async ({ page }) => {
  const state = await fixtures(page); state.conflict = true;
  await page.goto("/admin#兑换码");
  await page.getByRole("button", { name: "码明细", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).first().click();
  const editor = page.getByRole("dialog", { name: "编辑兑换码", exact: true });
  await editor.getByLabel("活动名称", { exact: true }).fill("我的活动草稿");
  await editor.getByRole("button", { name: "保存兑换码", exact: true }).click();
  await expect(editor).toContainText("记录已变化");
  expect(state.updates[0].expectedUpdatedAt).toBe(stamp);
  await expect(editor.getByLabel("活动名称", { exact: true })).toHaveValue("我的活动草稿");
  await editor.getByRole("button", { name: "读取最新配置", exact: true }).click();
  await expect(editor).toContainText("另一位管理员已更新");
  await expect(editor.getByLabel("活动名称", { exact: true })).toHaveValue("我的活动草稿");
  await expect(editor.getByRole("button", { name: "保存兑换码", exact: true })).toBeDisabled();
  await capture(page, "redeem-conflict");
  await editor.getByRole("button", { name: "载入最新并重填", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "载入最新配置", exact: true }).click();
  await expect(editor.getByLabel("活动名称", { exact: true })).toHaveValue("另一位管理员已更新");
  await editor.getByLabel("活动名称", { exact: true }).fill("核对后的活动");
  await editor.getByRole("button", { name: "保存兑换码", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(state.updates[1].expectedUpdatedAt).toBe(newer);
});

test("creator can confirm a lost redemption response without submitting another redemption", async ({ page }) => {
  await fixtures(page);
  let requests = 0, lookupFail = true, lookups = 0;
  await page.route("**/api/credits/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/redeem")) { requests++; return route.fulfill({ status: 503, json: { message: "兑换响应中断" } }); }
    if (path.endsWith("/redeem/receipt")) {
      lookups++;
      if (lookupFail) return route.fulfill({ status: 503, json: { message: "读取暂不可用" } });
      return route.fulfill({ json: { found: true, receipt: { id: "receipt", name: "创作体验", maskedCode: "•••• 0001", credits: 300, createdAt: stamp } } });
    }
    if (path.endsWith("/account")) return route.fulfill({ json: { balance: 400, frozenBalance: 0, totalRecharge: 400, totalConsume: 0 } });
    if (path.endsWith("/redemptions")) return route.fulfill({ json: { items: [{ id: "receipt", name: "创作体验", maskedCode: "•••• 0001", credits: 300, createdAt: stamp }], total: 1, page: 1, pageSize: 20 } });
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/billing/**", route => route.fulfill({ json: { wechat: false, membership: false, scheduled: [] } }));
  await page.goto("/#/recharge");
  await page.getByRole("textbox", { name: "兑换码", exact: true }).fill("TRIAL-000000000000000000000001");
  await page.getByRole("button", { name: "兑换积分", exact: true }).click();
  await expect(page.getByRole("button", { name: "兑换积分", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "核对到账", exact: true }).click();
  await expect(page.getByText("到账记录读取失败", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "兑换积分", exact: true })).toBeDisabled();
  lookupFail = false;
  await page.getByRole("button", { name: "核对到账", exact: true }).click();
  await expect(page.getByText("已确认到账 300 积分", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "我的兑换记录", exact: true })).toContainText("+300 积分");
  expect(requests).toBe(1); expect(lookups).toBe(2);
  await expect(page.getByRole("textbox", { name: "兑换码", exact: true })).toBeEmpty();
});

test("creator success and a missing receipt have distinct recovery paths", async ({ page }) => {
  await fixtures(page);
  let requests = 0, failHistory = true;
  await page.route("**/api/credits/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/redeem")) { requests++; return route.fulfill({ json: { balance: 400, frozenBalance: 0, totalRecharge: 400, totalConsume: 0 } }); }
    if (path.endsWith("/redeem/receipt")) return route.fulfill({ json: { found: false } });
    if (path.endsWith("/account")) return route.fulfill({ json: { balance: requests ? 400 : 100, frozenBalance: 0, totalRecharge: 100, totalConsume: 0 } });
    if (path.endsWith("/redemptions")) {
      if (failHistory) return route.fulfill({ status: 503, json: { message: "兑换记录读取失败，请刷新记录" } });
      return route.fulfill({ json: { items: [{ id: "receipt", name: "创作体验", maskedCode: "•••• 0001", credits: 300, createdAt: stamp }], total: 1, page: 1, pageSize: 20 } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/billing/**", route => route.fulfill({ json: { wechat: false, membership: false, scheduled: [] } }));
  await page.goto("/#/recharge");
  await page.getByRole("textbox", { name: "兑换码", exact: true }).fill("TRIAL-000000000000000000000001");
  await page.getByRole("button", { name: "核对到账", exact: true }).click();
  await expect(page.getByText("尚未查到此码", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "兑换积分", exact: true })).toBeEnabled();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "兑换积分", exact: true }).click();
  await expect(page.getByText("兑换成功，当前积分余额 400。", { exact: true })).toBeVisible();
  const history = page.getByRole("region", { name: "我的兑换记录", exact: true });
  await expect(history).toContainText("兑换记录读取失败");
  failHistory = false;
  await history.getByRole("button", { name: "刷新记录", exact: true }).click();
  await expect(history).toContainText("+300 积分");
  expect(requests).toBe(1);
});
