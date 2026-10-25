import { test, expect, type Page } from "@playwright/test";

// Local, fabricated records only; no production credentials, supplier calls or charges.
const stamp = "2026-10-25T08:30:00.000Z";
const accounts = Array.from({ length: 32 }, (_, i) => ({
  id: `design-user-${i}`, name: ["林初", "沈砚", "陈清禾", "漫角运营"][i % 4] + (i > 3 ? ` ${i}` : ""),
  email: `creator.${i}@example.test`, phone: i % 2 ? "13800000000" : undefined,
  role: i === 3 ? "admin" : "creator", status: i === 2 ? "disabled" : "active", hasPassword: true,
  credits: 12800 - i * 320, frozenCredits: i % 3 ? 0 : 120, totalRecharge: 16000, totalConsume: 3200,
  projects: 9 - i % 10, createdAt: `2026-10-${String(25 - i % 20).padStart(2, "0")}T02:15:00.000Z`,
  updatedAt: stamp, lastLoginAt: i % 3 ? stamp : undefined
}));
const providers = ["text", "image", "video"].map((modality, i) => ({ id: `design-${modality}`, name: ["文字创作", "视觉资产", "动态影像"][i], modality, enabled: true, apiKeyConfigured: true, models: [`design-${modality}-model`], capability: { ratios: ["16:9", "9:16"] }, routing: { mode: "auto" }, updatedAt: stamp }));
const ticket = { id: "support-design", userId: "design-user-0", userName: "林初", subject: "如何调整分镜中的角色形象", category: "generation", status: "waiting_staff", version: 1, createdAt: stamp, updatedAt: stamp };
const announcement = { id: "announcement", title: "创作工作台更新 · 更清晰的制作流程", body: "现在可以从原稿、全局设定到确认创建逐步完成准备。已创建的作品可在工作台继续制作。", type: "update", enabled: true, pinned: true, createdAt: stamp, updatedAt: stamp };
const plan = { id: "starter", name: "创作体验包", price: 29, credits: 3000, bonusCredits: 200, badge: "适合初次创作", features: ["文本、图片与视频共用积分", "按实际使用量扣费"], shopUrl: "", enabled: true };
const code = { id: "code-1", code: "CREATOR-TEST-2026", name: "创作体验活动", credits: 300, maxRedemptions: 1, usedCount: 0, enabled: true, status: "active", createdAt: stamp };

async function adminFixtures(page: Page) {
  const queries: URLSearchParams[] = [];
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "ui-admin-design"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url()), path = url.pathname.replace(/^\/api/, "");
    if (path === "/admin/users/page") {
      queries.push(url.searchParams);
      let rows = [...accounts], q = url.searchParams;
      if (q.get("keyword")) rows = rows.filter(row => `${row.name} ${row.email}`.includes(q.get("keyword")!));
      if (q.get("role") !== "all") rows = rows.filter(row => row.role === q.get("role"));
      if (q.get("status") !== "all") rows = rows.filter(row => row.status === q.get("status"));
      if (q.get("registeredFrom")) rows = rows.filter(row => Date.parse(row.createdAt) >= Date.parse(q.get("registeredFrom")!));
      if (q.get("registeredTo")) rows = rows.filter(row => Date.parse(row.createdAt) <= Date.parse(q.get("registeredTo")!));
      if (q.get("sort") === "created_asc") rows.sort((a,b) => a.createdAt.localeCompare(b.createdAt));
      const pageNo = Number(q.get("page")), pageSize = Number(q.get("pageSize"));
      return route.fulfill({ json: { items: rows.slice((pageNo-1)*pageSize, pageNo*pageSize), total: rows.length, page: pageNo, pageSize } });
    }
    const paged = (items: unknown[], pageSize = 20) => ({ items, total: items.length, page: 1, pageSize, totalPages: 1 });
    const data: Record<string, unknown> = {
      "/auth/me": { user: { id: "design-user-3", name: "漫角运营", role: "admin", status: "active" } },
      "/providers": providers, "/model-prices": providers.map(item => ({ id: `price-${item.id}`, providerId: item.id, providerName: item.name, modality: item.modality, model: item.models[0], unit: "次", unitCredits: 20, vendorCostCny: 0.2, enabled: true })),
      "/templates": [{ id: "eval_script", name: "剧本质量评分", type: "script", version: "v1", enabled: true, summary: "从冲突、节奏和可拍摄性评估剧本。", content: "请评估剧本中的人物动机、情节推进与镜头表现，返回评分与修改建议。" }],
      "/admin/users": accounts,
      "/admin/summary": { users: 32, projects: 86, tasksToday: 28, totalTasks: 240, completedTasks: 230, successRate: 0.965, creditsConsumed: 32800, providerCost: null, paidRechargeCny: 580, refundCredits: 600 },
      "/admin/announcements": [announcement, { ...announcement, id: "second", title: "新用户创作指南", type: "guide", pinned: false }],
      "/admin/help-articles": [{ id: "help", title: "完成你的第一部漫剧", summary: "从导入原稿开始，了解每一步的准备内容。", content: "导入原稿后选择画面比例和风格，确认文本报价后开始创建。", category: "getting_started", tags: ["新手"], enabled: true, pinned: true, sortOrder: 1, createdAt: stamp, updatedAt: stamp }],
      "/admin/plans": [plan], "/admin/membership-plans": [{ ...plan, id: "member", name: "创作月度方案", monthlyPrice: 99, monthlyCredits: 12000, discountPercent: 10, priorityLevel: 1 }],
      "/admin/redeem-codes": [code],
      "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] },
      "/admin/evaluation/projects": [],
      "/admin/quality-center": { summary: { successRate: 96, failureRate: 4, averageScore: 82, p95LatencyMs: 12000, costAnomalies: 0, modelHealth: 3, openEvents: 0, sampleCount: 20 }, events: [], voc: [], modelMonitoring: [], lab: { datasets: [], runs: [], recentReports: [] }, samples: [], attribution: [], releaseGates: [], lineage: [], stageOptimization: { windowDays: 30, rows: ["content","assets","storyboard","final"].map((key,i) => ({ key, label: ["内容","资产","分镜","成片"][i], stages: [], reportCount: 5, averageScore: 82, passRate: 90, openFeedback: 0, unusableFeedback: 0, failedTasks: 0, topProblems: [], topRootCauses: [], recommendation: "继续积累真实样本", health: "pass" })) }, generatedAt: stamp },
      "/admin/showcase/works": paged([{ id: "showcase", title: "雨后的旧书店", description: "一封迟来的信，让旧书店的故事重新开始。", category: "治愈", creatorName: "林初", coverUrl: "", videoUrl: "", durationLabel: "00:18", status: "pending", featured: false, sortOrder: 0, createdAt: stamp, updatedAt: stamp }]),
      "/admin/content-projects": [{ id: "content", title: "雨后的旧书店", user: { name: "林初" }, activeStep: "chapter", status: "active", counts: { analyses: 1, outlines: 1, chapters: 3, scripts: 1 }, updatedAt: stamp }],
      "/admin/support/tickets": paged([ticket]),
      "/admin/support/tickets/support-design": { ticket, messages: [{ id: "msg", ticketId: ticket.id, authorId: ticket.userId, authorName: "林初", authorRole: "user", body: "希望所有镜头保持相同的发型和服饰，需要在哪个步骤设置？", createdAt: stamp }] },
      "/admin/audit-logs": paged([{ id: "audit", actorId: "design-user-3", actorRole: "admin", action: "PATCH", target: "/api/admin/announcements/announcement", details: { fields: ["title", "body"] }, status: "succeeded", statusCode: 200, createdAt: stamp, completedAt: stamp }], 30)
    };
    return route.fulfill({ json: data[path] ?? (path.endsWith("/page") ? paged([]) : []) });
  });
  return queries;
}
async function capture(page: Page, label: string) {
  await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/ui-redesign-20261025/screenshots"}/admin-${label}-${test.info().project.name}.png`, fullPage: true });
}

test("populated user table exposes real dates, display columns, server filters and page size", async ({ page }) => {
  const queries = await adminFixtures(page);
  await page.goto("/admin#用户管理");
  await expect(page.getByRole("cell", { name: "林初 creator.0@example.test" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "注册时间", exact: true })).toBeVisible();
  await capture(page, "users");
  await page.locator(".adm-column-picker summary").click();
  await page.locator(".adm-column-picker").getByLabel("手机号", { exact: true }).check();
  await expect(page.getByRole("columnheader", { name: "手机号", exact: true })).toBeVisible();
  await page.locator(".adm-column-picker").getByLabel("手机号", { exact: true }).uncheck();
  await page.locator(".adm-column-picker summary").click();
  await page.getByRole("combobox", { name: "每页条数" }).selectOption("10");
  await expect.poll(() => queries.at(-1)?.get("pageSize")).toBe("10");
  await expect(page.locator(".adm-table-scroll tbody tr")).toHaveCount(10);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get("page")).toBe("2");
  await page.locator(".adm-user-filters summary").click();
  await page.getByLabel("注册开始日期", { exact: true }).fill("2026-10-20");
  await page.getByLabel("注册结束日期", { exact: true }).fill("2026-10-25");
  await page.getByRole("combobox", { name: "用户排序" }).selectOption("created_asc");
  await expect.poll(() => queries.at(-1)?.get("sort")).toBe("created_asc");
  expect(queries.at(-1)?.get("page")).toBe("1");
  expect(queries.at(-1)?.get("registeredTo")).toBeTruthy();
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await expect(page.getByRole("button", { name: "管理用户 林初", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "管理用户 林初", exact: true }).click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByText("注册时间", { exact: true })).toBeVisible();
  await expect(detail.getByText("资料更新时间", { exact: true })).toBeVisible();
  await capture(page, "user-profile");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await capture(page, "users-dark");
});

test("all admin modules with populated operational records fit desktop and mobile", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await adminFixtures(page);
  const modules = ["运营总览", "平台公告", "支持工单", "创作现场管理", "创作质量中心", "提示词评分", "兑换码", "套餐会员", "订阅会员", "模型路由", "价格策略", "操作记录"];
  for (const [index, module] of modules.entries()) {
    await page.goto(`/admin#${encodeURIComponent(module)}`);
    await expect(page.locator(".ui-page-heading h1")).toBeVisible();
    await expect(page.locator(".ui-state--loading")).toHaveCount(0);
    await capture(page, `module-${index}`);
    if (module === "平台公告") {
      await page.locator(".admin-record-disclosure summary").first().click();
      await capture(page, "announcement-edit");
      await page.getByRole("button", { name: /帮助中心/ }).last().click();
      await capture(page, "help");
    }
    if (module === "模型路由") {
      await page.getByRole("button", { name: "展开文字创作渠道", exact: true }).click();
      await capture(page, "provider-edit");
    }
    if (module === "创作现场管理") {
      await page.getByRole("button", { name: "内容创作进度", exact: true }).click();
      await expect(page.getByRole("cell").filter({ hasText: "雨后的旧书店" })).toBeVisible();
      await capture(page, "content-progress");
    }
  }
  expect(errors).toEqual([]);
});
