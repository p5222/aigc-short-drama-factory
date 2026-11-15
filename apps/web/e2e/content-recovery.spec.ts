import { test, expect, type Page } from "@playwright/test";
import type { ContentProductionPackage } from "@aifilm/shared";

const now = "2026-11-15T08:00:00Z";
const project = { id: "recovery", title: "雨后书店", mode: "same_genre", status: "succeeded", sourceCount: 0, scriptCount: 0, chapterCount: 4, updatedAt: now, textProvider: "text-ready", textModel: "deepseek-v4-pro" };
const outline = { id: "outline-1", version: 1, status: "confirmed" as const, createdAt: now, result: { chapters: [1, 2, 3, 4].map(chapterNo => ({ chapterNo, title: `旧信${chapterNo}`, summary: `第${chapterNo}章线索`, cliffhanger: "信封里还有什么？" })) } };
const chapter = (chapterNo: number) => ({ id: `chapter-${chapterNo}`, chapterNo, title: `旧信${chapterNo}`, content: `第${chapterNo}章已保存正文。她推开书店的门，在柜台找到了一封旧信。`, status: "succeeded" as const, updatedAt: now });

async function fixtures(page: Page) {
  const state = {
    pkg: { projectId: project.id, analysis: { id: "analysis", version: 1, status: "succeeded", createdAt: now, result: { dimensions: { opening: "旧信" } } }, outline: structuredClone(outline), chapters: [] } as ContentProductionPackage,
    generationCalls: 0, packageReads: 0, versionReads: 0, listFails: false, packageFails: false,
    mutation: async () => new Response()
  };
  // These tests use isolated API fixtures; no supplier calls or credits are involved.
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "recovery-fixture"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (route.request().method() === "POST" && path.startsWith("/content/projects/recovery/")) {
      state.generationCalls++;
      const response = await state.mutation();
      return route.fulfill({ status: response.status, body: await response.text(), contentType: "application/json" });
    }
    if (path === "/content/projects/recovery/package") {
      state.packageReads++;
      return state.packageFails ? route.fulfill({ status: 503, json: { message: "内容读取中断" } }) : route.fulfill({ json: state.pkg });
    }
    if (path === "/content/projects/recovery/versions") state.versionReads++;
    if (path === "/content/projects" && state.listFails) return route.fulfill({ status: 503, json: { message: "列表读取中断" } });
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "reader", name: "创作者", role: "user", status: "active" } },
      "/providers": [{ id: "text-ready", name: "文本渠道", modality: "text", models: ["deepseek-v4-pro"], enabled: true, apiKeyConfigured: true, capability: {} }],
      "/model-prices": [{ id: "price", providerId: "text-ready", model: "deepseek-v4-pro", modality: "text", unit: "text_run", unitCredits: 5, vendorCostCny: 0.1, enabled: true }],
      "/content/projects": [project],
      "/content/projects/recovery/versions": { projectId: project.id, analyses: [], outlines: [], chapters: (state.pkg.chapters ?? []).map(item => ({ chapterNo: item.chapterNo, title: item.title, latestStatus: item.status, versions: [{ id: item.id, version: 1, status: item.status, updatedAt: now }] })), scripts: [] },
      "/credits/account": { userId: "reader", balance: 1000, frozenBalance: 0, totalRecharge: 1000, totalConsume: 0 },
      "/workbench/summary": { projects: 0, storyboards: 0, runningTasks: 0, credits: 1000, recentProjects: [], recentTasks: [], announcements: [] }
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
  return state;
}
const json = (value: unknown) => new Response(JSON.stringify(value));
const refresh = (page: Page) => page.getByRole("button", { name: "刷新", exact: true });

test("completed outline survives list failure and read-only recovery updates content plus versions", async ({ page }) => {
  const state = await fixtures(page);
  state.pkg.outline = undefined;
  state.mutation = async () => { state.pkg.outline = { ...outline, status: "succeeded" }; state.listFails = true; return json(state.pkg); };
  await page.goto("/#/content/recovery");
  await page.getByRole("button", { name: "生成章节大纲", exact: true }).click();
  await expect(page.getByText(/大纲已生成，可以编辑后确认。作品列表暂未刷新/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /确认大纲/ })).toBeEnabled();
  const reads = [state.packageReads, state.versionReads];
  state.listFails = false;
  await refresh(page).click();
  await expect(page.getByText("已核对最新内容与状态。", { exact: true })).toBeVisible();
  expect(state.packageReads).toBeGreaterThan(reads[0]);
  expect(state.versionReads).toBeGreaterThan(reads[1]);
  expect(state.generationCalls).toBe(1);
});

test("batch with no new chapters stops once and keeps previously saved progress", async ({ page }) => {
  const state = await fixtures(page);
  state.pkg.chapters = [chapter(1), chapter(2)];
  state.mutation = async () => json(state.pkg);
  await page.goto("/#/content/recovery");
  await page.getByRole("button", { name: "一键生成全部剩余 2 章", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("本批未新增章节，已停止自动生成");
  await expect(page.getByText(chapter(1).content, { exact: true })).toBeVisible();
  await refresh(page).click();
  await expect(page.getByText("已核对最新内容与状态。", { exact: true })).toBeVisible();
  expect(state.generationCalls).toBe(1);
});

test("malformed response stops a multi-batch plan and refresh recovers accepted chapters without another mutation", async ({ page }) => {
  const state = await fixtures(page);
  state.mutation = async () => {
    state.pkg.chapters = state.generationCalls === 1 ? [chapter(1), chapter(2)] : [chapter(1), chapter(2), chapter(3), chapter(4)];
    return state.generationCalls === 1 ? json(state.pkg) : new Response("truncated-json");
  };
  await page.goto("/#/content/recovery");
  await page.getByRole("button", { name: "一键生成全部剩余 4 章", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("暂时无法确认操作结果");
  await expect(page.getByRole("alert")).toContainText("已完成章节仍保留");
  await expect(page.getByRole("button", { name: "一键生成全部剩余 2 章", exact: true })).toBeEnabled();
  await refresh(page).click();
  await expect(page.getByText("已核对最新内容与状态。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "一键生成全部剩余 0 章", exact: true })).toBeDisabled();
  expect(state.generationCalls).toBe(2);
});

test("completed multi-batch generation remains successful when only list synchronization fails", async ({ page }) => {
  const state = await fixtures(page);
  state.mutation = async () => {
    state.pkg.chapters = [1, 2, 3, 4].slice(0, state.generationCalls * 2).map(chapter);
    state.listFails = true;
    return json(state.pkg);
  };
  await page.goto("/#/content/recovery");
  await page.getByRole("button", { name: "一键生成全部剩余 4 章", exact: true }).click();
  await expect(page.getByText(/全部 4 章正文已生成。作品列表暂未刷新/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "一键生成全部剩余 0 章", exact: true })).toBeDisabled();
  expect(state.generationCalls).toBe(2);
});

test("read-only recovery preserves a chapter draft and reports partial read failure honestly", async ({ page }) => {
  const state = await fixtures(page);
  state.pkg.chapters = [chapter(1)];
  await page.goto("/#/content/recovery");
  await page.getByRole("button", { name: "编辑本章", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "第 1 章正文", exact: true });
  await editor.fill("作者未保存的新正文，必须保留。这封信来自十年前的自己。");
  state.packageFails = true;
  await refresh(page).click();
  await expect(page.getByRole("alert")).toContainText("当前内容刷新失败");
  await expect(editor).toHaveValue("作者未保存的新正文，必须保留。这封信来自十年前的自己。");
  state.packageFails = false;
  state.pkg.chapters = [{ ...chapter(1), id: "chapter-new", content: "服务器新版本" }];
  await refresh(page).click();
  await expect(page.getByText(/已核对最新内容与状态。未保存的编辑仍保留/)).toBeVisible();
  await expect(editor).toHaveValue("作者未保存的新正文，必须保留。这封信来自十年前的自己。");
  expect(state.generationCalls).toBe(0);
});

test("refreshing a newer outline retains the author's unsaved title", async ({ page }) => {
  const state = await fixtures(page);
  state.pkg.outline!.status = "succeeded";
  await page.goto("/#/content/recovery");
  const title = page.getByRole("textbox", { name: "第1章标题", exact: true });
  await title.fill("作者尚未保存的标题");
  state.pkg.outline = { ...outline, id: "outline-2", version: 2, status: "succeeded" };
  await refresh(page).click();
  await expect(page.getByText(/已核对最新内容与状态。未保存的编辑仍保留/)).toBeVisible();
  await expect(title).toHaveValue("作者尚未保存的标题");
  expect(state.generationCalls).toBe(0);
});
