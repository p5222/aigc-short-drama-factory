import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// UI-only fixtures: no production accounts, supplier requests or payments.
async function setup(page: Page, options: { storyCount?: number; projectCount?: number; storyError?: boolean; savedDraft?: boolean; admin?: boolean } = {}) {
  await page.addInitScript(({ savedDraft }) => {
    localStorage.setItem("aifilm_auth_token", "flow-fixture");
    localStorage.setItem("manjiao-theme", "light");
    if (savedDraft && !sessionStorage.getItem("manjiao_support:flow-user:user:create:draft")) sessionStorage.setItem("manjiao_support:flow-user:user:create:draft", JSON.stringify({ subject: "原来的账单问题", category: "billing", body: "这段未提交的内容请保留。" }));
  }, { savedDraft: options.savedDraft });
  let stories = Array.from({ length: options.storyCount ?? 1 }, (_, i) => ({ id: `story-${i}`, title: `时光邮局 ${i + 1}`, mode: "original", status: "confirmed", activeStep: "chapter", sourceCount: 1, chapterCount: 3, scriptCount: 0, updatedAt: `2026-10-${String(27 - i % 20).padStart(2, "0")}T10:00:00Z` }));
  const projects = Array.from({ length: options.projectCount ?? 1 }, (_, i) => ({ id: `project-${i}`, name: `风起旧书店 ${i + 1}`, type: "漫剧", intro: "旧书店的来信，开启一段关于重逢的故事。", sourceType: "script", artStyle: "国漫", videoRatio: "16:9", status: "scripting", episodes: 3, storyboards: 12, characters: 2, imageAssets: 6, videoClips: 0, creditsSpent: 28, updatedAt: "2026-10-01T10:00:00Z" }));
  const tasks = Array.from({ length: 25 }, (_, i) => ({ id: `task-${i}`, title: `书店镜头 ${i + 1}`, type: "video", projectId: "project-0", projectName: "风起旧书店", provider: "测试渠道", model: "fixture", status: i === 24 ? "failed" : "succeeded", progress: i === 24 ? 0 : 100, estimatedCredits: 20, finalCredits: i === 24 ? 0 : 20, retryable: false, jobId: "private-internal-job", errorReason: i === 24 ? "需要核对结果" : undefined, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z" }));
  let failStories = options.storyError;
  let writes: Record<string, unknown>[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/content/projects" && failStories) return route.fulfill({ status: 503, json: { message: "故事暂不可读" } });
    if (path.startsWith("/content/projects/") && route.request().method() === "DELETE") { stories = stories.filter(story => !path.endsWith(story.id)); return route.fulfill({ json: { ok: true } }); }
    if (path === "/support/tickets" && route.request().method() === "POST") {
      const input = route.request().postDataJSON(); writes.push(input);
      return route.fulfill({ status: 201, json: { ticket: { id: "ticket-1", subject: input.subject, category: input.category, status: "open", version: 1 }, messages: [{ id: "message-1", authorRole: "user", authorName: "林间", body: input.body, createdAt: "2026-10-27T00:00:00Z" }] } });
    }
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "flow-user", name: "林间", role: options.admin ? "admin" : "user", status: "active" } },
      "/workbench/summary": { userName: "林间", projects: projects.length, storyboards: 12, runningTasks: 0, credits: 1280, recentProjects: projects.slice(0, 3), recentTasks: [tasks[24]], actionCounts: { waiting: projects.length, active: 0, failed: 1 }, announcements: [] },
      "/projects": projects, "/content/projects": stories, "/tasks": tasks,
      "/credits/account": { balance: 1280, frozenBalance: 0 }, "/credits/ledger": { items: [], total: 0 },
      "/support/tickets": { items: [], total: 0, page: 1, pageSize: 20 },
      "/admin/support/tickets": { items: [], total: 0, page: 1, pageSize: 20 },
      "/admin/summary": { users: 0, projects: 0, tasksToday: 0, totalTasks: 0, completedTasks: 0, successRate: 0 },
      "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] },
      "/admin/quality-center": { projects: [] }
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
  return { recoverStories: () => { failStories = false; }, writes };
}

async function capture(page: Page, name: string, project: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  if (!process.env.PLAYWRIGHT_SCREENSHOT_DIR) return;
  await mkdir(process.env.PLAYWRIGHT_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.PLAYWRIGHT_SCREENSHOT_DIR, `${name}-${project}.png`), fullPage: true });
}

test("workbench resumes the newer story and failed-task shortcut survives reload", async ({ page }, info) => {
  await setup(page);
  await page.goto("/#/workbench");
  await expect(page.getByRole("heading", { name: "时光邮局 1", exact: true })).toBeVisible();
  await capture(page, "workbench-stories", info.project.name);
  await page.getByRole("button", { name: "继续写作", exact: true }).click();
  await expect(page).toHaveURL(/#\/content\/story-0$/);
  await page.goto("/#/workbench");
  await page.getByRole("button", { name: "查看原因", exact: true }).click();
  await expect(page).toHaveURL(/#\/tasks\?status=failed$/);
  await expect(page.locator(".queue-task-row")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "失败", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("story read failure remains visible and recovery restores the saved manuscript", async ({ page }) => {
  const state = await setup(page, { storyError: true, projectCount: 0 });
  await page.goto("/#/workbench");
  await expect(page.getByText("故事列表暂未读取成功", { exact: true })).toBeVisible();
  await expect(page.getByText("把第一个故事变成作品", { exact: true })).toHaveCount(0);
  state.recoverStories();
  await page.getByRole("button", { name: "重新读取故事", exact: true }).click();
  await expect(page.getByRole("button", { name: "继续写作", exact: true })).toBeVisible();
});

test("library pages independently, resets for search and recovers after last-page deletion", async ({ page }, info) => {
  await setup(page, { storyCount: 13, projectCount: 14 });
  await page.goto("/#/scripts");
  const stories = page.getByRole("region", { name: "内容创作", exact: true });
  const productions = page.getByRole("region", { name: "漫剧作品", exact: true });
  await expect(stories.locator(".project-card")).toHaveCount(12);
  await expect(productions.locator(".project-card")).toHaveCount(12);
  await page.getByLabel("作品排序").selectOption("title");
  await page.getByRole("button", { name: "下一页故事", exact: true }).click();
  await expect(stories.locator(".project-card")).toHaveCount(1);
  await expect(productions.locator(".project-card")).toHaveCount(12);
  await page.getByRole("button", { name: "删除故事 时光邮局 13", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除作品", exact: true }).click();
  await expect(stories.locator(".project-card")).toHaveCount(12);
  await expect(page.getByRole("navigation", { name: "故事列表分页" })).toHaveCount(0);
  await page.getByLabel("搜索我的作品", { exact: true }).fill("旧书店 14");
  await expect(productions.locator(".project-card")).toHaveCount(1);
  await page.getByLabel("搜索我的作品", { exact: true }).fill("");
  await capture(page, "library", info.project.name);
});

test("task shortcut locates an item beyond page one and mobile detail has a return path", async ({ page }, info) => {
  await setup(page);
  await page.goto("/#/tasks?task=task-22");
  await expect(page.getByRole("region", { name: "所选任务详情" }).getByRole("heading", { name: "书店镜头 23" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "任务列表分页" })).toContainText("2 / 2");
  await page.locator(".queue-task-select").first().click();
  if (info.project.name === "mobile") {
    await expect(page.getByRole("region", { name: "所选任务详情" })).toBeFocused();
    await page.getByRole("button", { name: "返回任务列表" }).click();
    await expect(page.locator(".queue-list-card")).toBeFocused();
  } else await expect(page.getByRole("button", { name: "返回任务列表" })).toBeHidden();
  await capture(page, "task-detail", info.project.name);
  await page.getByLabel("搜索任务", { exact: true }).fill("不存在");
  await page.evaluate(() => { window.location.hash = "#/tasks?status=failed&task=task-24"; });
  await expect(page.getByRole("region", { name: "所选任务详情" }).getByRole("heading", { name: "书店镜头 25" })).toBeVisible();
  await page.evaluate(() => { window.location.hash = "#/tasks?task=task-22"; });
  await expect(page.getByRole("region", { name: "所选任务详情" }).getByRole("heading", { name: "书店镜头 23" })).toBeVisible();
  await page.getByRole("button", { name: "刷新队列", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "任务列表分页" })).toContainText("2 / 2");
});

test("task support opens a reviewable draft and only sends it after explicit submission", async ({ page }, info) => {
  const state = await setup(page);
  await page.goto("/#/tasks?status=failed");
  await page.getByRole("button", { name: "前往帮助中心提交工单" }).click();
  await expect(page.getByLabel("问题标题")).toHaveValue("任务问题 · task-24");
  await expect(page.getByLabel("问题分类")).toHaveValue("generation");
  await expect(page.getByLabel("问题说明")).toHaveValue(/平台任务编号：task-24/);
  await expect(page.getByLabel("问题说明")).not.toHaveValue(/private-internal-job/);
  expect(state.writes).toHaveLength(0);
  await capture(page, "support-task-draft", info.project.name);
  await page.getByRole("button", { name: "提交工单", exact: true }).click();
  await expect(page.getByText(/工单已提交，编号/)).toBeVisible();
  expect(state.writes).toHaveLength(1);
});

test("bringing task context preserves existing unsent work until the user chooses to attach it", async ({ page }, info) => {
  const state = await setup(page, { savedDraft: true });
  await page.goto("/#/tasks?status=failed");
  await page.getByRole("button", { name: "前往帮助中心提交工单" }).click();
  await expect(page.getByLabel("问题说明")).toHaveValue("这段未提交的内容请保留。");
  await expect(page.getByLabel("问题分类")).toHaveValue("billing");
  await page.getByRole("button", { name: "补充任务信息" }).click();
  await expect(page.getByLabel("问题标题")).toHaveValue("原来的账单问题");
  await expect(page.getByLabel("问题说明")).toHaveValue(/这段未提交的内容请保留。[\s\S]*平台任务编号：task-24/);
  expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await capture(page, "support-draft-dark", info.project.name);
  await page.reload();
  await page.getByRole("button", { name: "提交问题", exact: true }).click();
  await expect(page.getByLabel("问题说明")).toHaveValue(/这段未提交的内容请保留。[\s\S]*平台任务编号：task-24/);
});
