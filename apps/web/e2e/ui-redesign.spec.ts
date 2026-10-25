import { test, expect, type Page } from "@playwright/test";

// Isolated UI fixtures; these never call a supplier, charge credits or change production data.
const source = "第一章 雨后的旧书店\n林初回到故乡，在旧书店发现一封写给二十年后自己的信。她循着信中的线索找到沈砚，两人约定在日落前解开钟楼的秘密。";
const project = { id: "design-project", name: "雨后的旧书店", type: "漫剧", intro: "一封信，串起两代人的约定。", sourceType: "novel", artStyle: "真实漫画", videoRatio: "9:16", status: "draft", episodes: 1, storyboards: 3, characters: 1, imageAssets: 0, videoClips: 0, creditsSpent: 15, updatedAt: "2026-10-25T08:00:00Z" };
const providers = [
  { id: "dashscope-text", name: "文本服务", modality: "text", models: ["qwen3.7-plus"] },
  { id: "dashscope-image", name: "图像服务", modality: "image", models: ["wan2.6-t2i"] },
  { id: "dashscope-video", name: "视频服务", modality: "video", models: ["wan2.7-i2v-2026-04-25"] }
].map(item => ({ ...item, enabled: true, apiKeyConfigured: true, capability: { ratios: ["9:16", "16:9"], maxDuration: 15, supportsReference: true }, costHint: "界面验证模型" }));
const workflow = {
  project, tasks: [], assets: [],
  script: { id: "script", projectId: project.id, name: project.name, content: source, synopsis: project.intro, version: 1, createdAt: project.updatedAt },
  characters: [{ id: "character", projectId: project.id, name: "林初", identity: "旧书店的继承人", appearance: "短发，清澈的目光", costume: "米白色衬衫、深色长裤", personality: "冷静、好奇", prompt: "短发女孩", negativePrompt: "", consistencyLevel: "high" }],
  storyboards: ["雨后的小巷", "旧书店内", "钟楼前"].map((scene, index) => ({
    id: `shot-${index}`, projectId: project.id, episodeNo: 1, sceneNo: index + 1, shotNo: index + 1, duration: 6,
    shotSize: "中景", cameraAngle: "平视", cameraMovement: "缓慢推进", characters: ["林初"], scene,
    pictureDesc: `${scene}，林初停下脚步，打开手中的旧信。雨滴沿着屋檐落下，傍晚的阳光照亮信纸。`,
    dialogue: "原来，你一直在等我。", voiceOver: "", action: "停步、抬头，展开信纸", emotion: "期待",
    environmentSound: "雨后鸟鸣", soundEffect: "", imagePrompt: "旧书店，雨后阳光", videoPrompt: "镜头缓慢推进", referenceAssetIds: [], status: "pending"
  }))
};

async function fixtures(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("aifilm_auth_token", "ui-redesign-fixture");
    localStorage.setItem("manjiao-theme", "light");
    localStorage.setItem("aifilm_creation_draft", JSON.stringify({ title: "之前的小说", content: "这是以前账号里的小说正文，不能自动带入新项目。", sourceType: "novel" }));
  });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "designer", name: "林初", role: "creator", status: "active" } },
      "/providers": providers,
      "/workbench/summary": { userName: "林初", projects: 1, storyboards: 3, runningTasks: 0, credits: 1000, recentProjects: [project], recentTasks: [], announcements: [] },
      "/projects": [project],
      "/credits/account": { userId: "designer", balance: 1000, frozenBalance: 0, totalRecharge: 1000, totalConsume: 15 },
      "/projects/design-project/workflow": workflow,
      "/creation/estimate": { estimatedCredits: 15, suggestedEpisodes: 1, breakdown: [{ label: "文本解析", totalCredits: 15, quantity: 1, unitCredits: 15 }], notes: ["文本费用"] },
      "/content/projects": [{ id: "existing-content", title: "已有小说", mode: "original", status: "draft", sourceCount: 1, scriptCount: 0, chapterCount: 0, textProvider: "dashscope-text", textModel: "qwen3.7-plus", updatedAt: project.updatedAt }],
      "/content/projects/existing-content/package": { projectId: "existing-content", source: { title: "旧素材", content: "旧正文不可串用" }, chapters: [] },
      "/content/projects/existing-content/versions": { outlines: [], analyses: [], chapters: [], scripts: [] }
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
}
async function screenshot(page: Page, name: string) {
  await expect(page.getByText("页面暂时无法显示", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `../../outputs/ui-redesign-20261025/screenshots/${name}-${test.info().project.name}.png`, fullPage: true });
}
async function newFromSidebar(page: Page) {
  if (await page.getByRole("button", { name: "打开导航", exact: true }).isVisible()) await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.locator(".side-create").click();
}
async function enterText(page: Page) {
  await page.getByRole("button", { name: /导入小说或剧本/ }).click();
  await expect(page.getByLabel("小说正文", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("作品名称", { exact: true })).toHaveValue("");
  await page.getByLabel("作品名称", { exact: true }).fill(project.name);
  await page.getByLabel("小说正文", { exact: true }).fill(source);
}

test("all new-drama entry paths are blank; draft recovery is explicit, including repeated new", async ({ page }) => {
  await fixtures(page);
  await page.goto("/#/workbench");
  await newFromSidebar(page);
  await expect(page.getByRole("button", { name: /导入小说或剧本/ })).toBeVisible();
  await screenshot(page, "creation-entry");
  await enterText(page);
  await newFromSidebar(page);
  await expect(page.getByRole("button", { name: "恢复草稿", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(page.getByLabel("小说正文", { exact: true })).toHaveValue(source);
  await newFromSidebar(page);
  await page.getByRole("button", { name: /导入小说或剧本/ }).click();
  await expect(page.getByLabel("小说正文", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("作品名称", { exact: true })).toHaveValue("");
});

test("source, settings and quoted review stay readable and preserve edits in both themes", async ({ page }) => {
  await fixtures(page);
  await page.goto("/#/wizard");
  await enterText(page);
  await screenshot(page, "creation-source");
  await page.getByRole("button", { name: "下一步：全局设定" }).click();
  await page.getByRole("button", { name: "真实漫画", exact: true }).click();
  await page.getByRole("button", { name: /横屏 16:9/ }).click();
  await screenshot(page, "creation-settings");
  await page.getByRole("button", { name: "下一步：确认创建" }).click();
  await page.getByRole("button", { name: "获取文本报价并确认", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认冻结 15 积分并创建" })).toBeEnabled();
  await screenshot(page, "creation-review");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await screenshot(page, "creation-review-dark");
  await page.locator(".creation-model-settings > summary").click();
  await screenshot(page, "creation-models-dark");
  await page.getByRole("button", { name: "修改原稿", exact: true }).click();
  await expect(page.getByLabel("小说正文", { exact: true })).toHaveValue(source);
});

test("new remains guarded while the creation result is pending", async ({ page }) => {
  await fixtures(page);
  let finish!: () => void;
  let submitted = false;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/api/creation/start", async route => {
    submitted = true;
    await pending;
    await route.fulfill({ status: 503, json: { message: "界面验证：稍后重试" } });
  });
  await page.goto("/#/wizard");
  await enterText(page);
  await page.getByRole("button", { name: "下一步：全局设定" }).click();
  await page.getByRole("button", { name: "下一步：确认创建" }).click();
  await page.getByRole("button", { name: "获取文本报价并确认", exact: true }).click();
  await page.getByRole("button", { name: "确认冻结 15 积分并创建" }).click();
  await expect.poll(() => submitted).toBeTruthy();
  await newFromSidebar(page);
  await expect(page.getByRole("heading", { name: "核对设置，开始制作" })).toBeVisible();
  await expect(page.getByText(/创建请求正在确认/)).toBeVisible();
  finish();
  await expect(page.getByText("界面验证：稍后重试", { exact: true })).toBeVisible();
  await newFromSidebar(page);
  await expect(page.getByRole("button", { name: /导入小说或剧本/ })).toBeVisible();
});

test("populated production stages, compact drawers and content fresh entry", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await fixtures(page);
  await page.goto("/#/project/design-project");
  const nav = page.getByRole("navigation", { name: "项目生产阶段" });
  for (const [index, label] of ["内容", "资产", "分镜", "成片"].entries()) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await screenshot(page, `production-${index}`);
    if (await page.getByRole("button", { name: "打开检查器", exact: true }).isVisible()) {
      await page.getByRole("button", { name: "打开检查器", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await screenshot(page, `production-${index}-settings`);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  }
  if (info.project.name === "desktop") {
    await page.setViewportSize({ width: 1280, height: 800 });
    await nav.getByRole("button", { name: "内容", exact: true }).click();
    await page.getByRole("button", { name: "打开检查器", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "检查器", exact: true })).toBeVisible();
    await screenshot(page, "production-laptop-settings");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  if (!await page.getByRole("button", { name: "切换到深色主题", exact: true }).isVisible()) await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("button", { name: "切换到深色主题", exact: true }).click();
  for (const [index, label] of ["内容", "资产", "分镜", "成片"].entries()) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await screenshot(page, `production-${index}-dark`);
  }
  if (!await page.getByRole("button", { name: "切换到浅色主题", exact: true }).isVisible()) await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("button", { name: "切换到浅色主题", exact: true }).click();
  await page.goto("/#/content/__new__");
  await expect(page.getByLabel("已有标题", { exact: true })).toHaveValue("");
  await screenshot(page, "content-intent");
  await page.getByLabel("已有标题", { exact: true }).fill("上一份未保存的灵感");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "新建内容创作", exact: true }).click();
  await expect(page.getByLabel("已有标题", { exact: true })).toHaveValue("");
  expect(errors).toEqual([]);
});

test("public hero has transparent navigation and original video colors", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: [] }));
  await page.goto("/");
  await expect(page.locator(".cine-bg-buffer").first()).toBeAttached();
  await expect(page.locator(".cine-top-nav")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".cine-top-nav")).toHaveCSS("backdrop-filter", "none");
  await expect(page.locator(".cine-bg-buffer").first()).toHaveCSS("filter", "none");
  await expect(page.locator(".cine-bottom-gradient,.cine-left-gradient,.cine-radial-glow")).toHaveCount(0);
  await screenshot(page, "public-home");
});

test("completed content project supports reviewing all five stages and editing chapters", async ({ page }) => {
  await fixtures(page);
  const contentProject = { id: "content-complete", title: project.name, mode: "original", status: "succeeded", sourceCount: 1, scriptCount: 1, chapterCount: 2, textProvider: "dashscope-text", textModel: "qwen3.7-plus", updatedAt: project.updatedAt };
  const pkg = {
    projectId: contentProject.id, source: { id: "source", kind: "novel", title: project.name, content: source, updatedAt: project.updatedAt },
    analysis: { id: "analysis", version: 1, status: "confirmed", result: { intent: project.intro, intentType: "title", targetWords: 6000, chapterCount: 2, batchSize: 1, dimensions: { opening: "雨停了，旧书店里出现一封来自过去的信。", climax: "两人在日落前赶到钟楼，却发现钥匙藏在旧信里。", reversal: "写信人正是二十年前的母亲。", payoffs: "失散的线索拼合成温暖的答案。" } } },
    outline: { id: "outline", version: 1, status: "confirmed", result: { title: project.name, chapters: [1,2].map(chapterNo => ({ chapterNo, title: chapterNo === 1 ? "雨后的来信" : "钟楼的约定", objective: "建立人物之间的联系，寻找旧信背后的故事。", conflict: "过去的误解阻止两人信任彼此。", cliffhanger: "谁在二十年前留下这封信？" })) } },
    chapters: [1,2].map(chapterNo => ({ id: `chapter-${chapterNo}`, chapterNo, title: chapterNo === 1 ? "雨后的来信" : "钟楼的约定", status: "confirmed", content: source.repeat(5), updatedAt: project.updatedAt })),
    script: { id: "script", version: 1, status: "confirmed", content: source.repeat(2) },
    entities: { characters: [{ id: "lin", name: "林初", description: "继承旧书店的女孩，冷静且好奇。" }], scenes: [{ id: "shop", name: "旧书店", description: "雨后被阳光照亮的木质书店。" }], props: [{ id: "letter", name: "旧信", description: "泛黄的信纸，封口用墨绿蜡印。" }] }
  };
  await page.route("**/api/content/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/package") ? pkg : path.endsWith("/versions") ? { outlines: [], analyses: [], chapters: [], scripts: [] } : [contentProject] });
  });
  await page.goto("/#/content/content-complete");
  const navigation = page.getByRole("navigation", { name: "创作流程" });
  expect((await page.locator(".cw2-title").boundingBox())!.width).toBeGreaterThan(200);
  for (const [index, stage] of ["创作意图", "结构拆解", "大纲确认", "正文创作", "制作交接"].entries()) {
    await navigation.getByRole("button", { name: new RegExp(stage) }).click();
    await screenshot(page, `content-stage-${index}`);
  }
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await screenshot(page, "content-handoff-dark");
  await navigation.getByRole("button", { name: /正文创作/ }).click();
  await page.getByRole("button", { name: "编辑本章", exact: true }).click();
  await expect(page.getByLabel("章节标题", { exact: true })).toHaveValue("雨后的来信");
  await screenshot(page, "content-chapter-edit-dark");
});
