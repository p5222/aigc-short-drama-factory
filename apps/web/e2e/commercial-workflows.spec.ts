import { test, expect, type Page } from "@playwright/test";

// Deliberately local fixtures: verifies UI contracts, never supplier/payment integration.
async function fixtureApi(page: Page, options: { admin?: boolean; tasks?: number; failedSummary?: boolean; populated?: boolean } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem("aifilm_auth_token", "ui-fixture-token");
    localStorage.setItem("manjiao-theme", "light");
  });
  const tasks = Array.from({ length: options.tasks ?? 0 }, (_, i) => ({
    id: `task-${i}`, type: "text", title: `测试任务 ${String(i).padStart(2, "0")}`, provider: "fixture",
    model: "test", status: "succeeded", progress: 100, estimatedCredits: 1, finalCredits: 1,
    createdAt: "2026-10-23T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z"
  }));
  let failedSummary = options.failedSummary;
  const project = { id: "production", name: "界面验收项目", type: "漫剧", intro: "仅用于界面验证", sourceType: "script", artStyle: "国漫", videoRatio: "9:16", status: "draft", episodes: 1, storyboards: 0, characters: 0, imageAssets: 0, videoClips: 0, creditsSpent: 0, updatedAt: "2026-10-23T00:00:00Z" };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/admin/quality-center") return route.fulfill({ status: 503, json: { message: "测试：质量快照暂不可用，请刷新重试。" } });
    if (path === "/workbench/summary" && failedSummary) return route.fulfill({ status: 503, json: { message: "测试：暂时不可用" } });
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "fixture", name: "验收创作者", role: options.admin ? "admin" : "user", status: "active" } },
      "/workbench/summary": { userName: "验收创作者", projects: options.populated ? 1 : 0, storyboards: 0, runningTasks: 0, credits: 100, recentProjects: options.populated ? [project] : [], recentTasks: tasks.slice(0, 3), announcements: [] },
      "/projects": options.populated ? [project] : [],
      "/tasks": tasks,
      "/projects/production/workflow": { project, characters: [], assets: [], storyboards: [], tasks: [] },
      "/credits/account": { userId: "fixture", balance: 100, frozenBalance: 0, totalRecharge: 100, totalConsume: 0 },
      "/credits/ledger": { items: [], total: 0, page: 1, pageSize: 20 },
      "/admin/summary": { users: 0, projects: 0, tasksToday: 0, totalTasks: 0, completedTasks: 0, successRate: 0, creditsConsumed: 0, providerCost: null, paidRechargeCny: 0 },
      "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] },
      "/admin/redeem-batches": { items: [], total: 0, page: 1, pageSize: 20, legacyCodes: 0 },
      "/admin/users/page": { items: [], total: 0, page: 1, pageSize: 25 },
      "/admin/audit-logs": { items: [], total: 0, page: 1, pageSize: 30 },
      "/admin/showcase/works": { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 },
      "/showcase/works": { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 },
      "/support/tickets": { items: [], total: 0, page: 1, pageSize: 20, counts: {} },
      "/admin/support/tickets": { items: [], total: 0, page: 1, pageSize: 20, counts: {} }
    };
    await route.fulfill({ json: values[path] ?? [] });
  });
  return { recover: () => { failedSummary = false; } };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
}

test("account-wide backlog remains actionable when recent task samples are empty", async ({ page }) => {
  await fixtureApi(page, { populated: true });
  const project = { id: "old-waiting", name: "早期待确认作品", type: "漫剧", status: "scripting", storyboards: 3, videoRatio: "9:16", updatedAt: "2026-10-20T00:00:00Z" };
  await page.route("**/api/workbench/summary", route => route.fulfill({ json: {
    userName: "验收创作者", projects: 12, storyboards: 30, runningTasks: 11, credits: 100,
    actionCounts: { waiting: 9, active: 11, failed: 4 }, actionProjects: [project], updatedAt: "2026-10-26T00:00:00Z",
    recentProjects: [{ ...project, id: "recent", name: "最近作品", status: "completed" }], recentTasks: [], announcements: []
  } }));
  await page.goto("/#/workbench");
  const waiting = page.locator(".dashboard-focus-card.warning");
  await expect(waiting).toContainText("9");
  await expect(waiting).toContainText("早期待确认作品");
  await expect(page.locator(".dashboard-focus-card.active")).toContainText("11");
  await expect(page.locator(".dashboard-focus-card.danger")).toContainText("4");
  await page.locator(".dashboard-focus-card.danger").getByRole("button", { name: "查看原因" }).click();
  await expect(page.getByRole("heading", { name: "生成队列", exact: true })).toBeVisible();
  await noOverflow(page);
});

test("admin overview shows real operational backlog and enters open support tickets", async ({ page }) => {
  await fixtureApi(page, { admin: true });
  await page.route("**/api/admin/summary", route => route.fulfill({ json: {
    users: 3, projects: 2, tasksToday: 1, totalTasks: 6, completedTasks: 2, successRate: 100, creditsConsumed: 20,
    providerCost: null, paidRechargeCny: 0,
    operations: { openTickets: 4, pendingWorks: 2, pendingOrders: 1, activeTasks: 3, updatedAt: "2026-10-26T00:00:00Z" }
  } }));
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "运营待办", exact: true })).toBeVisible();
  const metrics = page.locator(".admin-product-metrics").first();
  await expect(metrics).toContainText("待处理工单");
  await expect(metrics).toContainText("4");
  await expect(metrics).toContainText("待确认订单");
  await page.getByRole("button", { name: "回复待处理工单", exact: true }).click();
  await expect(page.getByRole("heading", { name: "支持工单", exact: true }).first()).toBeVisible();
  await noOverflow(page);
});

test("non-retryable task exposes platform ID, manual diagnostics and support without a retry", async ({ page, context }) => {
  await fixtureApi(page);
  await context.grantPermissions(["clipboard-write"]);
  await page.route("**/api/tasks", route => route.fulfill({ json: [{
    id: "platform-support-id", jobId: "media:internal-job", type: "video", title: "视频生成失败",
    provider: "fixture", model: "fixture", status: "failed", progress: 0, retryable: false, cancelable: false,
    estimatedCredits: 20, finalCredits: 0, errorReason: "需要核对原任务结果",
    createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z"
  }] }));
  await page.goto("/#/tasks");
  await expect(page.getByText(/此任务不能从队列直接重试/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重试任务", exact: true })).toHaveCount(0);
  await expect(page.getByText("platform-support-id", { exact: true })).toBeVisible();
  await page.getByText("工单诊断摘要", { exact: true }).click();
  await page.getByRole("button", { name: "复制诊断摘要", exact: true }).click();
  await expect(page.getByText("诊断摘要已复制，可粘贴到工单。")).toBeVisible();
  await expect(page.locator(".queue-diagnostic")).not.toContainText("media:internal-job");
  await noOverflow(page);
  await page.getByRole("button", { name: "前往帮助中心提交工单" }).click();
  await expect(page.getByRole("heading", { name: "帮助中心", exact: true })).toBeVisible();
});

test("online cashier reuses pending orders and refreshes the UI after a confirmed-paid fixture", async ({ page }) => {
  await fixtureApi(page);
  const plan = { id: "cashier-trial", name: "支付验收套餐", price: 9.9, credits: 1000, bonusCredits: 0, features: [], enabled: true };
  let creates = 0, paid = false;
  let order: Record<string, unknown> | undefined;
  await page.route("**/api/plans", route => route.fulfill({ json: [plan] }));
  await page.route("**/api/membership-plans", route => route.fulfill({ json: [] }));
  await page.route("**/api/billing/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/availability")) return route.fulfill({ json: { wechat: true, membership: false, autoRenew: false } });
    if (path.endsWith("/membership")) return route.fulfill({ json: { active: null, paidThrough: null, autoRenew: false } });
    if (path === "/api/billing/checkout") {
      creates++;
      order = { id: "cashier-order-123", planId: plan.id, planName: plan.name, kind: "recharge", channel: "wechat",
        amountCny: 9.9, amountFen: 990, credits: 1000, bonusCredits: 0, status: "pending", invoiceStatus: "none",
        codeUrl: "weixin://wxpay/bizpayurl?pr=ui-fixture", expiresAt: new Date(Date.now()+600_000).toISOString(), createdAt: new Date().toISOString() };
      return route.fulfill({ status: 201, json: order });
    }
    if (path.endsWith("/checkout")) return route.fulfill({ json: order });
    if (path.endsWith("/orders")) return route.fulfill({ json: order ? [{ ...order, status: paid ? "paid" : "pending" }] : [] });
    if (path.includes("/orders/")) { paid = true; return route.fulfill({ json: { ...order, status: "paid", codeUrl: undefined } }); }
    return route.fulfill({ json: [] });
  });
  await page.goto("/#/recharge");
  const buy = page.getByRole("button", { name: /支付验收套餐 · ¥9.90/ });
  await buy.click();
  await expect(page.getByRole("region", { name: "当前支付订单" })).toContainText("待支付");
  await expect(page.getByText("微信扫一扫", { exact: true })).toBeVisible();
  await buy.click();
  expect(creates).toBe(1);
  await expect(page.getByRole("region", { name: "当前支付订单" })).toContainText("已到账", { timeout: 10_000 });
  await expect(page.getByText("微信扫一扫", { exact: true })).toHaveCount(0);
  await noOverflow(page);
});

test("membership checkout exposes current benefits, same-tier renewal and no automatic charge", async ({ page }) => {
  await fixtureApi(page);
  const member = { id: "member-fixture", name: "验收会员", monthlyPrice: 39.9, monthlyCredits: 4000,
    discountPercent: 10, priorityLevel: 1, features: [], enabled: true };
  await page.route("**/api/membership-plans", route => route.fulfill({ json: [member, { ...member, id: "higher", name: "另一档会员" }] }));
  await page.route("**/api/billing/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/availability")) return route.fulfill({ json: { wechat: true, membership: true, autoRenew: false } });
    if (path.endsWith("/membership")) return route.fulfill({ json: { active: { planId: member.id, planName: member.name,
      startsAt: new Date().toISOString(), endsAt: new Date(Date.now()+86400_000).toISOString(), discountPercent: 10, priorityLevel: 1 },
      paidThrough: new Date(Date.now()+86400_000).toISOString(), autoRenew: false } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/#/recharge");
  await expect(page.getByRole("button", { name: "同档续费一个月" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "购买一个月", exact: true })).toBeDisabled();
  await page.getByText("会员购买与计费规则", { exact: true }).click();
  await expect(page.getByText(/每次购买一个自然月，不自动扣款/)).toBeVisible();
  await noOverflow(page);
});

test("admin users create, validate, edit, delete and restore with recoverable failures", async ({ page }) => {
  await fixtureApi(page, { admin: true });
  const users: Array<Record<string, any>> = [];
  let rejectSave = true;
  await page.route("**/api/admin/users**", async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const id = url.pathname.split("/").at(-1);
    if (method === "POST") {
      const input = route.request().postDataJSON();
      users.push({ ...input, id: "created-user", credits: input.initialCredits, frozenCredits: 0, totalRecharge: input.initialCredits, totalConsume: 0, projects: 0, hasPassword: true });
      return route.fulfill({ json: users[0] });
    }
    if (method === "PATCH") {
      if (rejectSave) { rejectSave = false; return route.fulfill({ status: 409, json: { message: "测试：邮箱已占用，请修改后重试" } }); }
      Object.assign(users.find(user => user.id === id)!, route.request().postDataJSON());
      return route.fulfill({ json: users[0] });
    }
    if (method === "DELETE") { users.find(user => user.id === id)!.status = "deleted"; return route.fulfill({ json: users[0] }); }
    if (url.pathname.endsWith("/page")) {
      const status = url.searchParams.get("status");
      const items = users.filter(user => status === "deleted" ? user.status === "deleted" : user.status !== "deleted");
      return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 25 } });
    }
    return route.fulfill({ json: users.filter(user => user.status !== "deleted") });
  });
  await page.goto("/admin#用户管理");
  await page.getByRole("button", { name: "创建用户", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("用户名", { exact: true }).fill("回归用户");
  await dialog.getByLabel("邮箱", { exact: true }).fill("test@example.test");
  await dialog.getByLabel("初始密码", { exact: true }).fill("Test-password-2026");
  await dialog.getByLabel("初始积分", { exact: true }).fill("-10");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  expect(users).toHaveLength(0);
  await dialog.getByLabel("初始积分", { exact: true }).fill("100");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("cell").filter({ hasText: "回归用户" }).click();
  await dialog.getByLabel("用户名", { exact: true }).fill("修改后用户");
  await dialog.getByLabel("邮箱", { exact: true }).fill("changed@example.test");
  await dialog.getByRole("button", { name: "保存账号资料" }).click();
  await expect(dialog).toContainText("邮箱已占用");
  await expect(dialog.getByLabel("用户名", { exact: true })).toHaveValue("修改后用户");
  await dialog.getByRole("button", { name: "保存账号资料" }).click();
  await expect(dialog.getByRole("button", { name: "保存账号资料" })).toBeDisabled();
  await dialog.getByRole("button", { name: "账号安全", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "删除用户", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "资料与权限", exact: true }).click();
  await dialog.getByRole("combobox", { name: "账号状态", exact: true }).selectOption("disabled");
  await dialog.getByRole("button", { name: "保存账号资料" }).click();
  await dialog.getByRole("button", { name: "账号安全", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "删除用户", exact: true })).toBeEnabled();
  await noOverflow(page);
  await dialog.getByRole("button", { name: "删除用户", exact: true }).click();
  await page.getByRole("alertdialog", { name: "删除用户" }).getByRole("button", { name: "移入回收站", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("cell").filter({ hasText: "修改后用户" })).toHaveCount(0);
  await page.getByRole("button", { name: /回收站/ }).click();
  await page.getByRole("cell").filter({ hasText: "修改后用户" }).click();
  await expect(dialog).toContainText("恢复后为停用状态");
  await dialog.getByRole("button", { name: "恢复用户", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "账号状态", exact: true })).toHaveValue("disabled");
  expect(users[0].status).toBe("disabled");
  expect(users[0].credits).toBe(100);
});

test("creator workflow, content entry and both themes fit viewport", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await fixtureApi(page);
  await page.goto("/#/workbench");
  await expect(page.getByRole("heading", { name: "把第一个故事变成作品" })).toBeVisible();
  await noOverflow(page);
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await noOverflow(page);
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results"}/creator-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "全部作品", exact: true }).click();
  await expect(page).toHaveURL(/#\/scripts$/);
  await expect(page.getByRole("heading", { name: "我的作品", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("first read failure offers recovery without presenting empty data", async ({ page }) => {
  const fixture = await fixtureApi(page, { failedSummary: true });
  await page.goto("/#/workbench");
  await expect(page.getByText("页面数据尚未读取成功", { exact: true })).toBeVisible();
  await expect(page.getByText("还没有项目", { exact: true })).toHaveCount(0);
  fixture.recover();
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(page.getByText("还没有项目", { exact: true })).toBeVisible();
});

test("task pagination and filtering reset selection to a visible row", async ({ page }) => {
  await fixtureApi(page, { tasks: 41 });
  await page.goto("/#/tasks");
  await expect(page.locator(".queue-task-row")).toHaveCount(20);
  await page.getByRole("button", { name: "下一页任务" }).click();
  await expect(page.locator(".queue-task-row")).toHaveCount(20);
  await page.getByRole("button", { name: "下一页任务" }).click();
  await expect(page.locator(".queue-task-row")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "搜索任务", exact: true }).fill("测试任务 00");
  await expect(page.locator(".queue-task-row")).toHaveCount(1);
  await expect(page.locator(".queue-task-row").first()).toContainText("测试任务 00");
  await noOverflow(page);
});

test("admin module search, location, navigation and themes", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await fixtureApi(page, { admin: true });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "运营总览", exact: true })).toBeVisible();
  await noOverflow(page);
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results"}/admin-${testInfo.project.name}.png`, fullPage: true });
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.getByRole("searchbox", { name: "查找管理模块" }).fill("价格");
  await expect(page.getByRole("navigation", { name: "后台模块" }).getByRole("button")).toHaveCount(1);
  await page.getByRole("navigation", { name: "后台模块" }).getByRole("button", { name: "价格策略" }).click();
  await expect(page.locator(".adm-location strong")).toHaveText("价格策略");
  await expect(page.getByRole("heading", { name: "价格策略", exact: true })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("creator route inventory renders without crashes or document overflow", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await fixtureApi(page);
  for (const [route, title] of [["scripts", "我的作品"], ["tasks", "生成队列"], ["profile", "我的账户"], ["recharge", "积分充值"], ["ledger", "积分明细"], ["settings", "设置"], ["help", "帮助中心"], ["studio", "剪辑中心"], ["wizard", "让一个新故事，从这里开始"], ["content/__new__", "新建内容创作"]]) {
    await page.goto(`/#/${route}`);
    await expect(page.getByRole("heading", { name: title, exact: true }).first()).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results"}/${route.replaceAll("/", "-")}-${testInfo.project.name}.png`, fullPage: true });
    const themeButton = page.getByRole("button", { name: "切换主题", exact: true });
    if (await themeButton.isVisible()) {
      await themeButton.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await noOverflow(page);
      await themeButton.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    }
  }
  expect(errors).toEqual([]);
});

test("production stages stay usable without generated assets", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await fixtureApi(page);
  await page.goto("/#/project/production");
  await expect(page.getByText("界面验收项目", { exact: true }).first()).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "项目生产阶段" });
  for (const [index, name] of ["内容", "资产", "分镜", "成片"].entries()) {
    await navigation.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results"}/production-${index}-${testInfo.project.name}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "前往分镜制作", exact: true }).click();
  await expect(navigation.getByRole("button", { name: /分镜/ })).toHaveAttribute("aria-current", "step");
  expect(errors).toEqual([]);
});

test("all admin modules render with empty or recoverable unavailable data", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await fixtureApi(page, { admin: true });
  const modules = ["用户管理", "操作记录", "平台公告", "支持工单", "创作现场管理", "创作质量中心", "兑换码", "套餐会员", "订阅会员", "模型路由", "价格策略", "提示词评分"];
  for (const [index, module] of modules.entries()) {
    await page.goto(`/admin#${encodeURIComponent(module)}`);
    const title = module === "套餐会员" ? "充值套餐" : module === "提示词评分" ? "提示词工作室" : module;
    await expect(page.getByRole("heading", { name: title, exact: true }).first()).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results"}/admin-${index + 1}-${testInfo.project.name}.png`, fullPage: true });
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await noOverflow(page);
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  }
  expect(errors).toEqual([]);
});

test("offline notice preserves the current workspace and clears on reconnection", async ({ page, context }) => {
  await fixtureApi(page);
  await page.goto("/#/workbench");
  await expect(page.getByRole("heading", { name: "把第一个故事变成作品" })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/网络已断开。请保留当前页面/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "把第一个故事变成作品" })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/网络已断开。请保留当前页面/)).toHaveCount(0);
});

test("admin sidebar collapse persists and remains navigable after resizing", async ({ page }, testInfo) => {
  await fixtureApi(page, { admin: true });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "运营总览", exact: true })).toBeVisible();
  if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await expect(page.locator(".adm-shell")).toHaveClass(/is-collapsed/);
  await page.reload();
  await expect(page.locator(".adm-shell")).toHaveClass(/is-collapsed/);
  await page.getByRole("navigation", { name: "后台模块" }).getByRole("button", { name: "用户管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "用户管理", exact: true })).toBeVisible();
  await noOverflow(page);
  await page.setViewportSize({ width: 393, height: 851 });
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "查找管理模块" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "打开导航", exact: true })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "查找管理模块" })).toBeVisible();
});

test("populated creator workbench resumes the selected project in both themes", async ({ page }, testInfo) => {
  await fixtureApi(page, { populated: true, tasks: 3 });
  await page.goto("/#/workbench");
  await expect(page.getByRole("region", { name: "界面验收项目" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "把第一个故事变成作品" })).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results"}/creator-populated-light-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await noOverflow(page);
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results"}/creator-populated-dark-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "进入创作", exact: true }).click();
  await expect(page).toHaveURL(/#\/project\/production$/);
  await expect(page.getByRole("navigation", { name: "项目生产阶段" })).toBeVisible();
});

test("public login form supports password reveal and restores keyboard focus", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("manjiao-theme", "light"));
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "开始制作我的故事", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const password = dialog.getByLabel("密码", { exact: true });
  await password.fill("Preview-password");
  await expect(password).toHaveAttribute("type", "password");
  await dialog.getByRole("button", { name: "显示密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await noOverflow(page);
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results"}/public-login-${testInfo.project.name}.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "后台管理系统", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回漫角创作平台" })).toHaveAttribute("href", "/");
  await noOverflow(page);
});
