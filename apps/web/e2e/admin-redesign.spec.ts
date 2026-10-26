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
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/ui-redesign-20261025/screenshots"}/admin-${label}-${test.info().project.name}.png`, fullPage: true, animations: "disabled" });
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
      await page.getByRole("button", { name: /^编辑公告 / }).first().click();
      await capture(page, "announcement-edit");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /帮助中心/ }).last().click();
      await capture(page, "help");
    }
    if (module === "模型路由") {
      await page.getByRole("button", { name: "展开文字创作渠道", exact: true }).click();
      await capture(page, "provider-edit");
      await page.keyboard.press("Escape");
    }
    if (module === "创作现场管理") {
      await page.getByRole("button", { name: "内容创作进度", exact: true }).click();
      await expect(page.getByRole("cell").filter({ hasText: "雨后的旧书店" })).toBeVisible();
      await capture(page, "content-progress");
    }
  }
  expect(errors).toEqual([]);
});

test("all create dialogs keep footer visible, inherit theme and guard unsaved input", async ({ page }) => {
  test.setTimeout(90_000);
  await adminFixtures(page);
  const entries = [
    ["用户管理", "创建用户", "创建用户", "用户名"],
    ["平台公告", "新增公告", "新增平台公告", "标题"],
    ["兑换码", "生成兑换码", "生成兑换码", "活动名"],
    ["套餐会员", "新增套餐", "新增充值套餐", "套餐名"],
    ["订阅会员", "新增会员方案", "新增订阅会员", "会员名"],
    ["模型路由", "新增渠道", "新增模型渠道", "渠道名称"],
    ["价格策略", "新增价格", "新增价格策略", "渠道名称"]
  ];
  for (const [module, button, title, field] of entries) {
    await page.goto(`/admin#${encodeURIComponent(module)}`);
    await page.getByRole("button", { name: button, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    const geometry = await dialog.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const footer = node.querySelector(".admin-modal-footer")!.getBoundingClientRect();
      return { within: rect.top >= 0 && rect.bottom <= innerHeight + 1, footer: footer.bottom <= innerHeight, scroll: getComputedStyle(node.querySelector(".admin-modal-body")!).overflowY };
    });
    expect(geometry).toEqual({ within: true, footer: true, scroll: "auto" });
    await dialog.getByLabel(field, { exact: true }).fill("待保存的修改");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog.getByLabel(field, { exact: true })).toHaveValue("待保存的修改");
    await page.keyboard.press("Escape");
    await confirm.getByRole("button", { name: "放弃修改", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: button, exact: true })).toBeFocused();
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(dialog).toHaveCSS("background-color", "rgb(30, 41, 59)");
    await expect(dialog.getByLabel(field, { exact: true })).toHaveCSS("color", "rgb(243, 244, 246)");
    await capture(page, `create-${module}-dark`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
  }
});

test("record editors open as dialogs and cancel deletion without sending a mutation", async ({ page }) => {
  await adminFixtures(page);
  let mutations = 0;
  page.on("request", request => { if (["POST","PATCH","DELETE"].includes(request.method())) mutations++; });
  await page.goto("/admin#平台公告");
  await page.getByRole("button", { name: /^编辑公告 / }).first().click();
  const editor = page.getByRole("dialog", { name: "编辑平台公告" });
  await expect(editor.getByLabel("公告内容")).toBeVisible();
  await editor.getByRole("button", { name: "删除公告", exact: true }).click();
  await page.getByRole("alertdialog", { name: "删除平台公告" }).getByRole("button", { name: "取消" }).click();
  await expect(editor).toBeVisible();
  expect(mutations).toBe(0);
  await page.keyboard.press("Escape");
  await page.goto("/admin#套餐会员");
  await page.getByRole("button", { name: "编辑", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "编辑充值套餐" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "编辑充值套餐" })).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByRole("dialog", { name: "编辑充值套餐" })).toHaveCSS("opacity", "1");
  expect(await page.getByRole("dialog", { name: "编辑充值套餐" }).evaluate(node => {
    const faded: string[] = [];
    for (let element: Element | null = node; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (Number(style.opacity) < 1 || style.filter !== "none") faded.push(`${element.className}: ${style.opacity} / ${style.filter}`);
    }
    return faded;
  })).toEqual([]);
  await capture(page, "edit-plan");
  await page.keyboard.press("Escape");
  await page.goto("/admin#订阅会员");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "编辑方案", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "编辑订阅方案" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "编辑订阅方案" })).toHaveCSS("animation-name", "none");
  await capture(page, "edit-membership");
});

test("help creator and all record editors retain failed changes and can save again", async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  await adminFixtures(page);
  let fail = true;
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/**", async route => {
    if (!["PATCH", "POST"].includes(route.request().method())) return route.fallback();
    requests.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill(fail ? { status: 503, json: { message: "测试保存失败，请重试" } } : { json: { id: "saved", ...route.request().postDataJSON() } });
  });
  const editors = [
    { module: "平台公告", trigger: /^编辑公告 /, title: "编辑平台公告", field: "标题", value: "更新公告标题", save: "保存", key: "title" },
    { module: "平台公告", help: true, trigger: /^编辑文章 /, title: "编辑帮助文章", field: "标题", value: "更新帮助标题", save: "保存", key: "title" },
    { module: "套餐会员", trigger: /^编辑$/, title: "编辑充值套餐", field: "套餐名称", value: "新的充值套餐", save: "保存修改", key: "name" },
    { module: "订阅会员", trigger: /^编辑方案$/, title: "编辑订阅方案", field: "方案名称", value: "新的订阅方案", save: "保存方案", key: "name" },
    { module: "模型路由", trigger: /展开文字创作渠道/, title: "编辑文字创作渠道", field: "渠道名称", value: "更新文字渠道", save: "保存渠道", key: "name" },
    { module: "价格策略", trigger: /^编辑价格$/, title: "编辑价格策略", field: /^积分 \//, value: "25", save: "保存价格", key: "unitCredits" },
    { module: "兑换码", trigger: /^编辑$/, title: "编辑兑换码", field: "活动名称", value: "更新兑换活动", save: "保存兑换码", key: "name" }
  ];
  for (const editor of editors) {
    await page.goto(`/admin#${encodeURIComponent(editor.module)}`);
    if (editor.help) await page.getByRole("button", { name: /帮助中心/ }).last().click();
    if (editor.module === "价格策略") await page.getByRole("button", { name: "展开价格", exact: true }).first().click();
    if (editor.module === "兑换码" && await page.getByRole("button", { name: "展开批次", exact: true }).first().isVisible()) await page.getByRole("button", { name: "展开批次", exact: true }).first().click();
    await page.getByRole("button", { name: editor.trigger }).first().click();
    const dialog = page.getByRole("dialog", { name: editor.title, exact: true });
    await dialog.getByLabel(editor.field, { exact: typeof editor.field === "string" }).fill(editor.value);
    fail = true;
    const count = requests.length;
    await dialog.getByRole("button", { name: editor.save, exact: true }).click();
    await expect(dialog.getByText("测试保存失败，请重试", { exact: false }).first()).toBeVisible();
    await expect(dialog.getByLabel(editor.field, { exact: typeof editor.field === "string" })).toHaveValue(editor.value);
    expect(requests.length).toBe(count + 1);
    expect(String(requests.at(-1)!.body[editor.key])).toBe(editor.value);
    fail = false;
    await dialog.getByRole("button", { name: editor.save, exact: true }).click();
    await expect.poll(() => requests.length).toBe(count + 2);
    await expect(page.locator('[role="dialog"][aria-busy="true"]')).toHaveCount(0);
    await capture(page, `saved-${editor.module}${editor.help ? "-help" : ""}`);
    // The fixture read remains immutable; dismiss retained editors before the next route.
    if (await dialog.isVisible()) {
      await page.keyboard.press("Escape");
      const discard = page.getByRole("alertdialog").getByRole("button", { name: "放弃修改", exact: true });
      if (await discard.isVisible()) await discard.click();
    }
  }
  await page.goto("/admin#平台公告");
  await page.getByRole("button", { name: /帮助中心/ }).last().click();
  await page.getByRole("button", { name: "新增帮助", exact: true }).click();
  const help = page.getByRole("dialog");
  await help.getByLabel("标题", { exact: true }).fill("界面验证帮助");
  await help.getByLabel("正文", { exact: true }).fill("这是隔离的帮助文章提交验证。");
  await capture(page, "create-help");
  const before = requests.length;
  await help.locator(".admin-modal-footer .admin-primary-btn").click();
  await expect.poll(() => requests.length).toBe(before + 1);
  expect(requests.at(-1)!.path).toBe("/api/admin/help-articles");
});
