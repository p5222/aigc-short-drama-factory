import { test, expect, type Page } from "@playwright/test";

// Fixture-only UI checks; no real billing provider is called.
const plans = [
  { id: "creator", name: "当前配置会员", monthlyPrice: 48.5, monthlyCredits: 4567, discountPercent: 7, priorityLevel: 1, enabled: true, features: [] },
  { id: "pro", name: "另一档会员", monthlyPrice: 138, monthlyCredits: 15000, discountPercent: 18, priorityLevel: 2, enabled: true, features: [] }
];
const current = { planId: "creator", planName: "购买时会员", startsAt: "2026-10-20T12:00:00Z",
  endsAt: "2026-11-20T12:00:00Z", discountPercent: 10, priorityLevel: 1 };
const future = { ...current, startsAt: current.endsAt, endsAt: "2026-12-20T12:00:00Z", discountPercent: 20, priorityLevel: 2 };
const pending = { id: "pending-member", planId: "creator", planName: "当前配置会员", kind: "membership", channel: "wechat",
  amountCny: 48.5, amountFen: 4850, credits: 4567, bonusCredits: 0, status: "pending",
  expiresAt: "2000-01-01T00:00:00Z", createdAt: "2026-10-27T00:00:00Z", invoiceStatus: "none" };
async function fixture(page: Page, options: { admin?: boolean; dark?: boolean; available?: boolean; status?: unknown; orders?: unknown[] } = {}) {
  await page.addInitScript(({ dark }) => {
    localStorage.setItem("aifilm_auth_token", "commercial-fixture");
    if (!localStorage.getItem("manjiao-theme")) localStorage.setItem("manjiao-theme", dark ? "dark" : "light");
  }, { dark: options.dark ?? false });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const data: Record<string, unknown> = {
      "/auth/me": { user: { id: "fixture", name: "会员验收用户", role: options.admin ? "admin" : "creator", status: "active" } },
      "/workbench/summary": { userName: "会员验收用户", projects: 0, storyboards: 0, runningTasks: 0, credits: 123, recentProjects: [], recentTasks: [], announcements: [] },
      "/credits/account": { userId: "fixture", balance: 123, frozenBalance: 0, totalRecharge: 123, totalConsume: 0 },
      "/credits/ledger": { items: [], total: 0, page: 1, pageSize: 20 },
      "/membership-plans": plans, "/plans": [],
      "/billing/availability": { wechat: options.available ?? false, membership: options.available ?? false, autoRenew: false },
      "/billing/membership": options.status ?? { active: null, paidThrough: null, scheduled: [], scheduledCount: 0, lastExpired: null, autoRenew: false },
      "/billing/orders": options.orders ?? [],
      "/admin/summary": { users: 2, projects: 0, tasksToday: 0, totalTasks: 0, completedTasks: 0, successRate: 0, creditsConsumed: 0, providerCost: null, paidRechargeCny: 0 },
      "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] },
      "/admin/users/page": { items: [], total: 0, page: 1, pageSize: 25 }
    };
    return route.fulfill({ json: data[path] ?? [] });
  });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
}

test("paused membership stays visible and uses current configured prices in light and dark", async ({ page }, info) => {
  await fixture(page);
  await page.goto("/#/recharge");
  await expect(page.getByRole("heading", { name: "会员中心与在线支付" })).toBeVisible();
  await expect(page.getByText(/会员购买暂未开放/)).toBeVisible();
  await expect(page.locator(".membership-card").first()).toContainText("48.50");
  await expect(page.locator(".membership-card").first()).toContainText("4,567");
  await expect(page.getByRole("button", { name: "暂未开放购买" })).toHaveCount(2);
  if (info.project.name === "mobile") {
    const first = (await page.locator(".membership-card").first().boundingBox())!;
    const second = (await page.locator(".membership-card").last().boundingBox())!;
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  }
  await noOverflow(page);
  await page.locator(".online-checkout").screenshot({ path: `../../outputs/membership-commercialization-20261027/member-paused-${info.project.name}.png` });
  await page.evaluate(() => localStorage.setItem("manjiao-theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByText(/会员购买暂未开放/)).toBeVisible();
  await noOverflow(page);
  await page.locator(".online-checkout").screenshot({ path: `../../outputs/membership-commercialization-20261027/member-dark-${info.project.name}.png` });
});

test("current and purchased periods stay separate; cancellation never creates an order", async ({ page }, info) => {
  await fixture(page, { available: true, status: { active: current, paidThrough: future.endsAt, scheduled: [future], scheduledCount: 1, lastExpired: null, autoRenew: false } });
  let checkoutCalls = 0;
  await page.route("**/api/billing/checkout", route => { checkoutCalls++; return route.fulfill({ json: pending }); });
  await page.goto("/#/recharge");
  const rights = page.getByLabel("我的会员权益");
  await expect(rights).toContainText("购买时会员");
  await expect(rights).toContainText("本期权益截止");
  await expect(rights).toContainText("2026/11/20");
  await expect(rights).toContainText("2026/12/20");
  await expect(rights).toContainText("减免 10%");
  await page.getByText("已购待生效权益 · 1 期").click();
  await expect(page.locator(".membership-scheduled")).toContainText("减免 20%");
  const renewal = page.getByRole("button", { name: "同档续费一个月" });
  await renewal.click();
  await expect(page.getByRole("dialog", { name: "确认会员购买" })).toContainText("7%");
  expect(checkoutCalls).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(renewal).toBeFocused();
  expect(checkoutCalls).toBe(0);
  await noOverflow(page);
  await page.locator(".online-checkout").screenshot({ path: `../../outputs/membership-commercialization-20261027/member-renewed-${info.project.name}.png` });
});

test("failed membership purchase keeps confirmation and reuses its durable request", async ({ page }) => {
  await fixture(page, { available: true });
  const requestIds: string[] = [];
  await page.route("**/api/billing/checkout", route => {
    requestIds.push(route.request().postDataJSON().requestId);
    return requestIds.length === 1 ? route.fulfill({ status: 503, json: { message: "测试：下单状态暂未确认，请重试核对。" } })
      : route.fulfill({ json: { ...pending, expiresAt: new Date(Date.now() + 600_000).toISOString(), codeUrl: "weixin://test-only-fixture" } });
  });
  await page.goto("/#/recharge");
  await page.getByRole("button", { name: "购买一个月", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "确认会员购买" });
  await dialog.getByRole("button", { name: "确认并获取付款码" }).click();
  await expect(dialog).toContainText("下单状态暂未确认");
  await dialog.getByRole("button", { name: "确认并获取付款码" }).click();
  await expect(dialog).toHaveCount(0);
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
  await expect(page.getByRole("region", { name: "当前支付订单" })).toContainText("待支付");
  await expect(page.getByText("微信扫一扫", { exact: true })).toBeVisible();
  await noOverflow(page);
});

test("expired membership retains its date and balance; unresolved expired QR protects tier", async ({ page }) => {
  await fixture(page, { available: true, status: { active: null, paidThrough: "2026-10-20T00:00:00Z",
    lastExpired: { ...current, endsAt: "2026-10-20T00:00:00Z" }, scheduled: [], scheduledCount: 0, autoRenew: false }, orders: [pending] });
  await page.goto("/#/recharge");
  await expect(page.getByLabel("我的会员权益")).toContainText("已到期");
  await expect(page.getByLabel("我的会员权益")).toContainText("账户积分仍永久有效");
  await expect(page.getByText(/有一笔会员订单待确认/)).toBeVisible();
  await expect(page.getByRole("button", { name: "购买一个月", exact: true }).first()).toBeEnabled();
  await expect(page.getByRole("button", { name: "购买一个月", exact: true }).last()).toBeDisabled();
  await expect(page.locator(".online-order-list")).toContainText("待支付");
  await noOverflow(page);
});

test("recovering a pending order already paid refreshes membership without creating another order", async ({ page }) => {
  const recoverable = { ...pending, expiresAt: new Date(Date.now() + 600_000).toISOString() };
  await fixture(page, { available: true, orders: [recoverable] });
  let paid = false, creates = 0, resumes = 0;
  await page.route("**/api/billing/checkout", route => { creates++; return route.fulfill({ status: 500, json: {} }); });
  await page.route("**/api/billing/orders/pending-member/checkout", route => {
    paid = true; resumes++; return route.fulfill({ json: { ...recoverable, status: "paid" } });
  });
  await page.route("**/api/billing/orders", route => route.fulfill({ json: [{ ...recoverable, status: paid ? "paid" : "pending" }] }));
  await page.route("**/api/billing/membership", route => route.fulfill({ json: {
    active: paid ? current : null, paidThrough: paid ? current.endsAt : null, scheduled: [], scheduledCount: 0, autoRenew: false
  } }));
  await page.goto("/#/recharge");
  await page.getByRole("button", { name: "购买一个月", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "确认并获取付款码" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("我的会员权益")).toContainText("购买时会员");
  await expect(page.getByRole("region", { name: "当前支付订单" })).toContainText("已到账");
  expect(creates).toBe(0);
  expect(resumes).toBe(1);
});

test("an open member page updates current-term rights at the paid term boundary", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-27T12:00:00Z") });
  await fixture(page, { available: true });
  const first = { ...current, endsAt: "2026-10-27T12:00:05Z" };
  const next = { ...future, startsAt: first.endsAt };
  await page.route("**/api/billing/membership", async route => {
    const switched = await page.evaluate(() => Date.now() >= Date.parse("2026-10-27T12:00:05Z"));
    return route.fulfill({ json: { active: switched ? next : first, paidThrough: next.endsAt,
      scheduled: switched ? [] : [next], scheduledCount: switched ? 0 : 1, autoRenew: false } });
  });
  await page.goto("/#/recharge");
  await expect(page.getByLabel("我的会员权益")).toContainText("减免 10%");
  await page.clock.runFor(10_100);
  await expect(page.getByLabel("我的会员权益")).toContainText("减免 20%");
});

test("membership read failure offers recovery without claiming normal membership", async ({ page }) => {
  await fixture(page);
  let failing = true;
  await page.route("**/api/billing/membership", route => failing ? route.fulfill({ status: 503, json: { message: "fixture unavailable" } })
    : route.fulfill({ json: { active: null, paidThrough: null, autoRenew: false } }));
  await page.goto("/#/recharge");
  await expect(page.getByText(/在线支付信息暂时加载失败/)).toBeVisible();
  await expect(page.locator(".membership-state")).not.toContainText("普通创作者");
  await expect(page.getByRole("button", { name: "正在读取…" })).toHaveCount(2);
  failing = false;
  await page.getByRole("button", { name: "刷新支付信息" }).click();
  await expect(page.locator(".membership-state")).toContainText("普通创作者");
  await noOverflow(page);
});

test("future-only or retired membership remains legible without an active plan", async ({ page }) => {
  await fixture(page, { status: { active: null, paidThrough: future.endsAt, scheduled: [future], scheduledCount: 1, autoRenew: false } });
  await page.route("**/api/membership-plans", route => route.fulfill({ json: [] }));
  await page.goto("/#/recharge");
  await expect(page.locator(".membership-state")).toContainText("待生效会员");
  await expect(page.getByText("已购待生效权益 · 1 期")).toBeVisible();
  await expect(page.getByText(/暂无开放的会员套餐/)).toBeVisible();
  await noOverflow(page);
});

test("admin combines membership and online payment filters without granting role", async ({ page }, info) => {
  await fixture(page, { admin: true });
  const members = [
    { id: "paid-member", name: "付费会员", role: "creator", status: "active", credits: 123, frozenCredits: 0, totalRecharge: 123, totalConsume: 0, projects: 1, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z",
      commercial: { membership: "active", planName: "购买时会员", currentEndsAt: current.endsAt, paidThrough: future.endsAt, onlinePaidOrders: 2, onlinePaidCny: 88.8 } },
    { id: "gifted", name: "只有赠分的用户", role: "creator", status: "active", credits: 999, frozenCredits: 0, totalRecharge: 999, totalConsume: 0, projects: 0, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z",
      commercial: { membership: "none", onlinePaidOrders: 0, onlinePaidCny: 0 } }
  ];
  let lastQuery = new URLSearchParams();
  await page.route("**/api/admin/users/page?**", route => {
    lastQuery = new URL(route.request().url()).searchParams;
    const items = members.filter(user => (!lastQuery.has("membership") || user.commercial.membership === lastQuery.get("membership"))
      && (!lastQuery.has("commercial") || (lastQuery.get("commercial") === "online_paid" ? user.commercial.onlinePaidOrders > 0 : user.commercial.onlinePaidOrders === 0)));
    return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 25 } });
  });
  await page.goto("/admin#用户管理");
  await expect(page.getByRole("cell").filter({ hasText: "只有赠分的用户" })).toBeVisible();
  await page.getByLabel("会员状态筛选").selectOption("active");
  await page.getByLabel("在线付费筛选").selectOption("online_paid");
  await expect(page.getByRole("cell").filter({ hasText: "只有赠分的用户" })).toHaveCount(0);
  await expect.poll(() => lastQuery.get("membership")).toBe("active");
  await expect.poll(() => lastQuery.get("commercial")).toBe("online_paid");
  await page.getByRole("button", { name: "管理用户 付费会员" }).click();
  const detail = page.getByLabel("商业身份与付费记录");
  await expect(detail).toContainText("88.80");
  await expect(detail).toContainText("不含卡密");
  await expect(detail).toContainText("会员身份不授予后台权限");
  await expect(page.getByRole("combobox", { name: "用户角色", exact: true })).toHaveValue("creator");
  await noOverflow(page);
  await page.getByRole("dialog").screenshot({ path: `../../outputs/membership-commercialization-20261027/admin-member-${info.project.name}.png` });
});
