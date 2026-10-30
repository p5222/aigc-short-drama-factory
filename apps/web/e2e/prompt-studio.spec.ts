import { expect, test, type Page } from "@playwright/test";

const builtin = {
  key: "episode_adaptation", name: "分集素材改编", stage: "script", purpose: "generation", version: "1.1.0",
  systemPrompt: "你是漫剧改编编剧。保留人物与原文事实，只输出合法 JSON。不得新增剧情。",
  userTemplate: "当前原文：{{content}}\n目标秒数：{{duration}}",
  variables: ["content", "duration"], outputSchema: { script: "string", preservedFacts: "array" },
  validationRules: ["保留可定位的原文事实"], negativeRules: ["不得新增剧情"]
};
const reference = { ...builtin, key: "storyboard_core", name: "核心剧本分镜", stage: "storyboard" };

async function fixture(page: Page) {
  let revision = 0, activeId: string | null = null;
  const versions: any[] = [];
  const state = { writes: [] as any[], rejectSave: false, rejectPublish: false, failDetail: false, failList: false };
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "prompt-ui-fixture"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace(/^\/api/, "");
    const summary = (definition: typeof builtin, connected = true) => ({
      key: definition.key, name: definition.name, stage: definition.stage,
      runtimeScope: connected ? "内容工作台 · 分集改编" : null, builtinVersion: "1.1.0",
      activeVersion: connected && activeId ? versions.find(row => row.id === activeId).definition.version : "1.1.0", activeVersionId: connected ? activeId : null, revision: connected ? revision : 0
    });
    if (path.startsWith("/admin/production-prompts")) {
      if (path === "/admin/production-prompts") return state.failList ? route.fulfill({ status: 503, json: { message: "目录读取失败" } }) : route.fulfill({ json: [summary(builtin), summary(reference, false)] });
      const key = path.split("/")[3], definition = key === builtin.key ? builtin : reference, connected = key === builtin.key;
      if (route.request().method() === "GET") return state.failDetail ? route.fulfill({ status: 503, json: { message: "模板读取失败" } }) : route.fulfill({ json: {
        ...summary(definition, connected), builtin: definition, effective: connected && activeId ? versions.find(row => row.id === activeId).definition : definition, versions: connected ? versions.toReversed() : [], totalVersions: connected ? versions.length : 0
      } });
      const body = route.request().postDataJSON(); state.writes.push({ path, body });
      if (path.endsWith("/preview")) {
        if (!body.userTemplate.includes("{{content}}") || !body.variables.content) return route.fulfill({ status: 400, json: { message: "模板缺少必需变量：content" } });
        return route.fulfill({ json: { systemPrompt: body.systemPrompt, userPrompt: `当前原文：${body.variables.content}\n目标秒数：${body.variables.duration}`, characters: 156 } });
      }
      if (path.endsWith("/versions")) {
        if (state.rejectSave) return route.fulfill({ status: 503, json: { message: "保存暂时失败，请重试" } });
        const previous = versions.find(row => row.requestId === body.requestId);
        const row = previous ?? { id: `version-${versions.length + 1}`, number: versions.length + 1, requestId: body.requestId, notes: body.notes, createdAt: "2026-10-29T12:00:00Z", definition: { ...definition, ...body, version: `1.1.0+custom.${versions.length + 1}` } };
        if (!previous) versions.push(row);
        return route.fulfill({ json: { id: row.id, number: row.number }, status: 201 });
      }
      if (path.endsWith("/activate")) {
        if (state.rejectPublish || body.expectedRevision !== revision) return route.fulfill({ status: 409, json: { message: "生效版本已被其他管理员更新。草稿已保留，请刷新版本后重新核对。" } });
        activeId = body.versionId; revision++;
        return route.fulfill({ json: { revision } });
      }
    }
    const data: Record<string, unknown> = {
      "/auth/me": { user: { id: "admin-fixture", name: "漫角运营", role: "admin", status: "active" } },
      "/admin/summary": {}, "/admin/evaluation/overview": { datasets: [], runs: [], promptVersions: [], experiments: [] },
      "/templates": [{ id: "score-script", name: "内容评分", type: "script", version: "v1", enabled: true, summary: "按人物与因果评分", content: "输出评分与改进建议" }]
    };
    await route.fulfill({ json: data[path] ?? [] });
  });
  return state;
}
async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  expect(await page.locator(".prompt-studio-editor").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/platform-upgrade-20261029/screenshots"}/${name}-${test.info().project.name}.png`, fullPage: true });
}
test("preview, retry-safe save, explicit publication and built-in rollback remain separate", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin#提示词评分");
  await expect(page.getByRole("heading", { name: "分集素材改编", exact: true })).toBeVisible();
  const system = page.getByRole("textbox", { name: /^系统指令/ });
  await system.fill(builtin.systemPrompt + "\n先标注人物位置，再写动作。");
  await page.getByRole("button", { name: "变量预览", exact: true }).click();
  await page.getByRole("button", { name: "检查并预览", exact: true }).click();
  await expect(page.getByLabel("渲染预览")).toContainText("林晚");
  await page.getByRole("textbox", { name: "修改说明", exact: true }).fill("补充人物位置");
  state.rejectSave = true;
  await page.getByRole("button", { name: "保存新版本", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存暂时失败");
  state.rejectSave = false;
  await page.getByRole("button", { name: "保存新版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("尚未发布");
  const saves = state.writes.filter(row => row.path.endsWith("/versions"));
  expect(saves).toHaveLength(2); expect(saves[0].body.requestId).toBe(saves[1].body.requestId);
  expect(state.writes.filter(row => row.path.endsWith("/activate"))).toHaveLength(0);
  await page.getByRole("button", { name: "发布此版本", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "发布版本", exact: true }).click();
  await expect(page.locator(".prompt-live-status")).toContainText("1.1.0+custom.1");
  await page.getByRole("button", { name: "版本记录", exact: true }).click();
  await page.getByRole("button", { name: "查看内置", exact: true }).click();
  await page.getByRole("button", { name: "恢复内置", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "恢复内置", exact: true }).click();
  await expect(page.locator(".prompt-live-status")).not.toContainText("custom");
  expect(state.writes.filter(row => row.path.endsWith("/activate")).map(row => row.body.expectedRevision)).toEqual([0, 1]);
  await page.getByRole("button", { name: "指令与契约", exact: true }).click();
  await capture(page, "prompt-studio");
});
test("draft guards, publication conflicts, truthful references and score templates", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin#提示词评分");
  const system = page.getByRole("textbox", { name: /^系统指令/ });
  await system.fill(builtin.systemPrompt + "\n增加冲突测试指令。");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "质量评分模板", exact: true }).click();
  await expect(system).toHaveValue(/冲突测试/);
  await page.getByRole("textbox", { name: "修改说明", exact: true }).fill("并发冲突测试");
  await page.getByRole("button", { name: "保存新版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("尚未发布");
  state.rejectPublish = true;
  await page.getByRole("button", { name: "发布此版本", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "发布版本", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("其他管理员");
  await expect(system).toHaveValue(/冲突测试/);
  await page.getByRole("button", { name: "刷新版本", exact: true }).click();
  await expect(system).toHaveValue(/冲突测试/);
  await page.getByRole("button", { name: /核心剧本分镜/ }).click();
  await expect(page.getByRole("heading", { name: "核心剧本分镜", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存新版本", exact: true })).toHaveCount(0);
  await expect(page.locator(".prompt-reference-note")).toContainText("不提供发布");
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await capture(page, "prompt-studio-dark-reference");
  await page.getByRole("button", { name: "质量评分模板", exact: true }).click();
  await expect(page.locator(".prompt-editor-card")).toContainText("评测提示词");
  await page.getByRole("button", { name: "载入推荐标准", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "评分标准与提示词正文", exact: true })).toHaveValue(/证据不足/);
  await expect(page.locator(".prompt-editor-card")).toHaveAttribute("data-admin-dirty", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/platform-upgrade-20261029/screenshots"}/prompt-scoring-dark-${test.info().project.name}.png`, fullPage: true });
});
test("failed detail reads and missing variables are recoverable", async ({ page }) => {
  const state = await fixture(page); state.failDetail = true;
  await page.goto("/admin#提示词评分");
  await expect(page.getByRole("alert")).toContainText("模板读取失败");
  state.failDetail = false;
  await page.getByRole("button", { name: "重试读取模板", exact: true }).click();
  await page.getByRole("button", { name: "变量预览", exact: true }).click();
  await page.getByRole("textbox", { name: "源文素材", exact: true }).fill("");
  await page.getByRole("button", { name: "检查并预览", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("缺少必需变量");
  await page.getByRole("textbox", { name: "源文素材", exact: true }).fill("林晚推门进入书店。");
  await page.getByRole("button", { name: "检查并预览", exact: true }).click();
  await expect(page.getByLabel("渲染预览")).toContainText("林晚推门进入书店");
});
