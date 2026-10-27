import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// UI fixtures only; real transaction/ownership evidence lives in API tests.
async function fixtures(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("aifilm_auth_token", "audit-fixture");
    localStorage.setItem("manjiao-theme", "light");
  });
  let userId = "audit-one", failReads = false;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (failReads && path !== "/auth/login" && path !== "/auth/registration-policy") return route.fulfill({ status: 503, json: { message: "夹具：新账号数据暂不可读" } });
    if (path === "/auth/login") return route.fulfill({ json: { token: "replacement-fixture", user: { id: userId, name: userId, role: "creator", status: "active" } } });
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: userId, name: userId, role: "creator", status: "active" } },
      "/workbench/summary": { userName: userId, projects: 0, storyboards: 0, runningTasks: 0, credits: 123, recentProjects: [], recentTasks: [], announcements: [] },
      "/credits/account": { userId, balance: 123, frozenBalance: 0, totalRecharge: 123, totalConsume: 0 },
      "/auth/registration-policy": { emailDomain: "qq.com", emailVerificationRequired: true, mailAvailable: false },
      "/credits/ledger": { items: [], total: 0, page: 1, pageSize: 20 }
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
  return { changeUser: () => { userId = "audit-two"; failReads = true; } };
}

async function shot(page: Page, name: string, project: string) {
  if (!process.env.PLAYWRIGHT_SCREENSHOT_DIR) return;
  await mkdir(process.env.PLAYWRIGHT_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.PLAYWRIGHT_SCREENSHOT_DIR, `${name}-${project}.png`), fullPage: true });
}

async function signIn(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("手机号 / 邮箱", { exact: true }).fill("fixture@qq.com");
  await dialog.getByLabel("密码", { exact: true }).fill("Fixture-password");
  const captcha = await page.locator(".cine-captcha-image span").innerText();
  await dialog.getByLabel("图形验证码", { exact: true }).fill(captcha.trim());
  await dialog.getByRole("button", { name: "登录", exact: true }).last().click();
}

test("401 and reauthentication survive browser storage denial while a different user never sees cached account data", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/#/profile");
  await expect(page.getByRole("heading", { name: "我的账户", exact: true })).toBeVisible();
  state.changeUser();
  await page.evaluate(() => {
    Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("Storage denied", "SecurityError"); } });
    // Simulate the transport's current-token expiry event without supplier calls.
    localStorage.removeItem("aifilm_auth_token");
    window.dispatchEvent(new CustomEvent("manjiao:auth-session-expired"));
  });
  await expect(page.getByText(/登录已过期，请重新登录/)).toBeVisible();
  await signIn(page);
  await expect(page.getByText("页面数据尚未读取成功")).toBeVisible();
  await expect(page.getByText("audit-one", { exact: true })).toHaveCount(0);
  await expect(page.locator(".profile-v2-balance")).toHaveCount(0);
});

test("same-user session recovery survives storage method failures and returns to the original account page", async ({ page }) => {
  await fixtures(page);
  await page.goto("/#/profile");
  await expect(page.getByRole("heading", { name: "我的账户", exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(window, "sessionStorage", { value: {
      getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("denied"); }
    } });
    localStorage.removeItem("aifilm_auth_token");
    window.dispatchEvent(new CustomEvent("manjiao:auth-session-expired"));
  });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "我的账户", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "开始制作我的故事", exact: true })).toBeVisible();
});

test("chapter conflict retains the draft; an accepted new version survives failed history refresh", async ({ page }, info) => {
  await fixtures(page);
  const project = { id: "audit-content", title: "章节版本验收", mode: "original", status: "confirmed", sourceCount: 1, chapterCount: 1, scriptCount: 0, textProvider: "fixture", textModel: "fixture", updatedAt: "2026-10-27T00:00:00Z" };
  const chapter = { id: "chapter-base", chapterNo: 1, title: "来信", status: "confirmed", content: "故事中的人物在书店发现旧信，决定仔细核对信中的地址和日期。", updatedAt: project.updatedAt };
  const pkg = { projectId: project.id, analysis: { id: "analysis", version: 1, status: "confirmed", result: { intent: "书店旧信的故事", intentType: "title" } }, chapters: [chapter], outline: { id: "outline", version: 1, status: "confirmed", result: { title: project.title, chapters: [{ chapterNo: 1, title: "来信", objective: "发现旧信", conflict: "地址有误", cliffhanger: "谁留下了这封信" }] } } };
  let reject = true, writes = 0, failHistory = false;
  await page.route("**/api/content/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "PATCH") {
      writes++;
      expect(route.request().postDataJSON().expectedChapterId).toBe("chapter-base");
      if (reject) return route.fulfill({ status: 409, json: { message: "本章已有更新版本。你的修改已保留，请先复制草稿并刷新核对后再编辑。" } });
      chapter.content = route.request().postDataJSON().content;
      chapter.id = "chapter-v2";
      failHistory = true;
      return route.fulfill({ json: pkg });
    }
    if (path.endsWith("/versions")) return failHistory ? route.fulfill({ status: 503, json: { message: "夹具：版本列表未刷新" } }) : route.fulfill({ json: { projectId: project.id, analyses: [], outlines: [], chapters: [], scripts: [] } });
    return route.fulfill({ json: path.endsWith("/package") ? pkg : [project] });
  });
  await page.goto("/#/content/audit-content");
  await page.getByRole("navigation", { name: "创作流程" }).getByRole("button", { name: /正文创作/ }).click();
  await page.getByRole("button", { name: "编辑本章", exact: true }).click();
  const draft = "作者修改后的正文保留新的线索，人物先在书店读完旧信，再去钟楼核对日期。";
  await page.getByLabel("第 1 章正文", { exact: true }).fill(draft);
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByText(/本章已有更新版本/)).toBeVisible();
  await expect(page.getByLabel("第 1 章正文", { exact: true })).toHaveValue(draft);
  await shot(page, "chapter-conflict", info.project.name);
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await shot(page, "after-chapter-edit-dark", info.project.name);
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  reject = false;
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByText(/章已保存，原正文已保留。版本列表暂未刷新/)).toBeVisible();
  await expect(page.getByRole("button", { name: "保存修改", exact: true })).toHaveCount(0);
  expect(writes).toBe(2);
  await shot(page, "chapter-saved-history-unavailable", info.project.name);
});

test("English showcase uses translated controls and unchanged category keys across layout widths", async ({ page }, info) => {
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/showcase/works")) return route.fulfill({ json: {
      items: [{ id: "public-fixture", title: "A letter from yesterday", creatorName: "Fixture creator", category: "科幻风", description: "", coverUrl: "", videoUrl: "/fixture-unavailable.mp4", durationLabel: "00:30", featured: true }],
      total: 21, page: 1, pageSize: 20, totalPages: 2
    } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "选择语言", exact: true }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Live Studio", exact: true }).click();
  const request = page.waitForRequest(req => {
    const url = new URL(req.url());
    return url.pathname.endsWith("/showcase/works") && url.searchParams.get("category") === "科幻风";
  });
  await page.getByRole("button", { name: "Sci-fi", exact: true }).click();
  await request;
  await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeVisible();
  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    if (width === 360 || width === 1440) await shot(page, `showcase-english-${width}`, info.project.name);
  }
  await page.getByRole("button", { name: "Watch film", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await expect(page.getByText(/video could not be played/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Watch film", exact: true })).toBeFocused();
});
