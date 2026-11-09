import { test, expect, type Page } from "@playwright/test";

// Browser fixtures validate presentation and contracts, not supplier output quality.
const stamp = "2026-11-08T03:00:00Z";
const project = { id: "feedback-ui", name: "雨夜书店", type: "漫剧", intro: "迟来的信", sourceType: "script", artStyle: "国漫", videoRatio: "9:16", status: "draft", episodes: 1, storyboards: 0, characters: 1, imageAssets: 1, videoClips: 0, creditsSpent: 0, updatedAt: stamp };
async function fixtures(page: Page, dark = false) {
  await page.addInitScript(({ dark }) => { localStorage.setItem("aifilm_auth_token", "feedback-ui-fixture"); localStorage.setItem("manjiao-theme", dark ? "dark" : "light"); }, { dark });
  const reports = Array.from({ length: 10 }, (_, i) => ({ id: `report-${i}`, projectId: project.id, stage: i === 9 ? "image" : "script", totalScore: i ? 75 : 0,
    evidenceScope: i === 9 ? "structure" : "text", pass: i !== 0, evaluatorType: "ai", dimensionScores: {}, problems: ["人物动机待补充", "结尾缺少回应"],
    suggestions: ["交代回到书店的原因", "让旧信在结尾获得回应"], recommendedAction: "revise_text", createdAt: `2026-11-08T${String(20 - i).padStart(2, "0")}:00:00Z`, updatedAt: stamp }));
  const feedbacks = [
    { id: "resolved", projectId: project.id, userId: "author", stage: "script", rating: 2, usability: "unusable", tags: ["人物动机"], content: "为何回到书店没有说明", status: "resolved", priority: "p1", resolution: "已补充旧信与书店的联系，并完成文本复核。", createdAt: stamp, processedAt: stamp, source: "creator" },
    { id: "open", projectId: project.id, userId: "author", stage: "character", rating: 3, usability: "barely_usable", tags: ["服装不一致"], content: "衣服颜色与前一镜不一致", status: "processing", priority: "p2", createdAt: "2026-11-08T04:00:00Z", source: "creator" }
  ];
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const state = { failRead: false, failWrite: false, holdWrite: null as Promise<void> | null };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      writes.push({ path, body });
      await state.holdWrite;
      if (state.failWrite) return route.fulfill({ status: 400, json: { message: "夹具：请补充反馈说明" } });
      feedbacks.unshift({ ...feedbacks[1], ...body, id: "new-feedback", status: "open", createdAt: "2026-11-08T22:00:00Z" });
      return route.fulfill({ json: feedbacks[0] });
    }
    if (path.endsWith("/workflow")) {
      if (state.failRead) return route.fulfill({ status: 503, json: { message: "夹具：记录暂时不可读" } });
      return route.fulfill({ json: { project, characters: [{ id: "character-0", projectId: project.id, name: "林初", identity: "书店店主", appearance: "黑发", costume: "青色外套", personality: "温和", voice: "", visualPrompt: "林初" }],
        assets: [{ id: "role_character-0", projectId: project.id, relatedCharacterId: "character-0", type: "role", name: "林初身份板", description: "", prompt: "", status: "succeeded", referenceUrl: "/media/cineart-home/desert_poster.jpg" }],
        storyboards: [], tasks: [], qualityReports: reports, feedbacks } });
    }
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "author", name: "创作者", role: "user", status: "active" } },
      "/workbench/summary": { userName: "创作者", projects: 1, storyboards: 0, runningTasks: 0, credits: 100, recentProjects: [project], recentTasks: [], announcements: [] },
      "/projects": [project], "/tasks": [], "/credits/account": { balance: 100, frozenBalance: 0 }
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
  return { state, writes };
}
async function openDrawer(page: Page) {
  await expect(page.getByRole("navigation", { name: "项目生产阶段" })).toBeVisible();
  const trigger = page.getByRole("button", { name: "打开评测反馈", exact: true });
  if (await trigger.first().isVisible()) await trigger.first().click();
  else { await page.getByRole("button", { name: "更多操作", exact: true }).click(); await trigger.last().click(); }
  return page.getByRole("dialog", { name: "评测与反馈", exact: true });
}
async function capture(page: Page, name: string, device: string, outputDir: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? outputDir}/${name}-${device}.png` });
}
for (const dark of [false, true]) test(`creator quality suggestions and feedback progress ${dark ? "dark" : "light"}`, async ({ page }, info) => {
  await fixtures(page, dark);
  await page.goto(`/#/project/${project.id}`);
  const drawer = await openDrawer(page);
  await expect(drawer.locator(".qf-record")).toHaveCount(8);
  await expect(drawer.locator(".qf-score strong").first()).toHaveText("0");
  await drawer.locator("summary").first().click();
  await expect(drawer.getByText("结尾缺少回应", { exact: true }).first()).toBeVisible();
  await capture(page, `creator-quality-${dark ? "dark" : "light"}`, info.project.name, info.outputDir);
  await drawer.getByRole("button", { name: /加载更多/ }).click();
  await expect(drawer.locator(".qf-record")).toHaveCount(10);
  await drawer.getByLabel("筛选记录阶段").selectOption("video");
  await expect(drawer.getByText("该阶段暂无记录", { exact: true })).toBeVisible();
  await drawer.getByLabel("筛选记录阶段").selectOption("all");
  await drawer.getByRole("button", { name: /我的反馈/ }).click();
  await expect(drawer.locator(".qf-record")).toHaveCount(2);
  await expect(drawer.getByText("已解决", { exact: true })).toBeVisible();
  await expect(drawer.getByText("已补充旧信与书店的联系，并完成文本复核。", { exact: true })).toBeVisible();
  await expect(drawer.getByText("1 条反馈待处理 · 1 条已解决", { exact: true })).toBeVisible();
  await capture(page, `creator-feedback-${dark ? "dark" : "light"}`, info.project.name, info.outputDir);
  await drawer.getByRole("button", { name: "刷新评测数据" }).focus();
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("button", { name: "关闭对话框" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});

test("creator feedback requires a deliberate opinion, preserves failures and prevents duplicate submits", async ({ page }, info) => {
  const { state, writes } = await fixtures(page, true);
  await page.goto(`/#/project/${project.id}`);
  await page.getByRole("navigation", { name: "项目生产阶段" }).getByRole("button", { name: /资产/ }).click();
  const trigger = page.getByRole("button", { name: "打开检查器", exact: true });
  if (await trigger.isVisible()) await trigger.click();
  const form = page.locator(".qf-composer");
  await expect(form.getByRole("button", { name: "提交反馈" })).toBeDisabled();
  await form.getByRole("radio", { name: "2 分", exact: true }).check();
  await form.getByRole("radio", { name: "需调整", exact: true }).check();
  await form.getByRole("button", { name: "服装不一致", exact: true }).click();
  await form.getByLabel("补充说明").fill("衣服颜色与前一镜不一致，请保留原来的青色外套。");
  await capture(page, "creator-feedback-form-dark", info.project.name, info.outputDir);
  state.failWrite = true;
  await form.getByRole("button", { name: "提交反馈" }).click();
  await expect(form.getByRole("alert")).toContainText("请补充反馈说明");
  await expect(form.getByLabel("补充说明")).toHaveValue(/青色外套/);
  state.failWrite = false;
  let release!: () => void;
  state.holdWrite = new Promise<void>(resolve => { release = resolve; });
  await form.getByRole("button", { name: "提交反馈" }).click();
  await expect(form.getByRole("button", { name: "提交中…" })).toBeDisabled();
  await expect(form.getByLabel("补充说明")).toBeDisabled();
  release();
  await expect(form.getByRole("status")).toContainText("反馈已保存");
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toMatchObject({ projectId: project.id, assetId: "role_character-0", stage: "character", rating: 2, usability: "barely_usable", tags: ["服装不一致"] });
  await expect(form.getByLabel("补充说明")).toHaveValue("");
  await expect(form.getByRole("button", { name: "提交反馈" })).toBeDisabled();
});
