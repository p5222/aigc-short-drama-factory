import { test, expect, type Page } from "@playwright/test";
import { platformSettingGroups, type ModelProvider, type PlatformSettingView, type SettingGroup } from "@aifilm/shared";

async function fixtures(page: Page) {
  const writes: Array<{ path: string; input: any }> = [];
  let conflict = false;
  const stamp = "2026-11-01T10:00:00.000Z";
  const providers: ModelProvider[] = (["text", "image", "video", "tts"] as const).map((modality, index) => ({
    id: `config-${modality}`, name: ["文本测试渠道", "画面测试渠道", "视频测试渠道", "配音测试渠道"][index]!, modality, enabled: true,
    apiKeyConfigured: true, endpointConfigured: true, connectionSupported: true, baseUrl: "https://fixture.invalid/v1",
    models: [`fixture-${modality}`], capability: { ratios: ["9:16"] }, costHint: "隔离 UI 夹具",
    connection: { protocol: (["openai-chat", "openai-image", "dashscope-video", "dashscope-tts"] as const)[index]! },
    routing: { mode: "manual", preferredModel: `fixture-${modality}`, modelPool: [`fixture-${modality}`], quotaStatus: [] }, updatedAt: stamp
  }));
  const views = Object.fromEntries(platformSettingGroups.map(group => [group.id, {
    group: group.id, version: 1, encryptionReady: true,
    values: Object.fromEntries(group.fields.filter(field => field.type !== "secret").map(field => [field.key, field.defaultValue ?? ""])),
    secrets: Object.fromEntries(group.fields.filter(field => field.type === "secret").map(field => [field.key, true])),
    sources: Object.fromEntries(group.fields.map(field => [field.key, field.type === "secret" ? "database" : "default"]))
  }])) as Record<SettingGroup, PlatformSettingView>;
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "configuration-ui-fixture"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (["PATCH", "POST"].includes(route.request().method())) {
      const input = route.request().postData() ? route.request().postDataJSON() : {};
      writes.push({ path, input });
      if (conflict) return route.fulfill({ status: 409, json: { message: "配置已被其他管理员更新，草稿已保留。" } });
      if (/\/admin\/settings\/(routing|email|payment)$/.test(path)) {
        const group = path.split("/").at(-1) as SettingGroup, view = views[group];
        for (const [key, value] of Object.entries(input.values)) {
          if (value === null) { view.sources[key] = "environment"; if (key in view.secrets) view.secrets[key] = true; }
          else { view.sources[key] = "database"; if (key in view.secrets) view.secrets[key] = true; else view.values[key] = value as string; }
        }
        view.version++; return route.fulfill({ json: view });
      }
      if (path.startsWith("/admin/providers/")) {
        const item = providers.find(item => item.id === path.split("/").at(-1))!;
        Object.assign(item, input, { apiKey: undefined, updatedAt: "2026-11-01T11:00:00.000Z" });
        return route.fulfill({ json: item });
      }
      return route.fulfill({ json: { ok: true, mode: input.mode === "config" ? "config" : path.includes("video") ? "queued" : "real", taskId: path.includes("video") ? "fixture-video-task" : undefined, provider: "夹具", model: "fixture", message: path.includes("email") ? "SMTP 认证通过，尚未验证收件。" : "已接收测试请求" } });
    }
    if (path.startsWith("/admin/settings/")) return route.fulfill({ json: views[path.split("/").at(-1) as SettingGroup] });
    const data: Record<string, unknown> = {
      "/auth/me": { user: { id: "config-admin", name: "测试管理员", role: "admin", status: "active" } },
      "/providers": providers,
      "/model-prices": providers.map(item => ({ id: `price-${item.id}`, providerId: item.id, providerName: item.name, modality: item.modality, model: item.models[0], unit: ({ text: "text_run", image: "image", video: "video_second", tts: "tts_100_chars" } as Record<string, string>)[item.modality], unitCredits: 2, vendorCostCny: .02, enabled: true })),
      "/admin/configuration-readiness": { scope: "configuration", checkedAt: stamp, items: ["text", "image", "video", "tts", "encryption", "email", "payment", "export"].map((id, index) => ({ id, title: ["文本创作", "角色与分镜图", "镜头视频", "成片配音", "密钥存储", "注册邮件", "微信收款", "成片导出"][index], state: id === "payment" ? "paused" : "ready", detail: id === "payment" ? "新收款暂停" : "配置完整，真实生成需单独测试。", module: "configuration" })) },
      "/admin/summary": { users: 1, projects: 0, totalTasks: 0, tasksToday: 0, creditsConsumed: 0 },
      "/admin/evaluation/overview": { datasets: [], runs: [], experiments: [], promptVersions: [] }
    };
    return route.fulfill({ json: data[path] ?? [] });
  });
  return { writes, setConflict: (value: boolean) => { conflict = value; } };
}

test("configuration saves only edited fields, hides stored secrets and preserves conflicting drafts", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/admin#平台配置");
  await page.getByRole("navigation", { name: "配置分组" }).getByRole("button", { name: /^注册邮件/ }).click();
  await expect(page.getByLabel(/SMTP 授权码/)).toHaveValue("");
  await page.getByLabel(/SMTP 服务器/).fill("smtp.changed.invalid");
  state.setConflict(true);
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByText("配置已被其他管理员更新，草稿已保留。")).toBeVisible();
  await expect(page.getByLabel(/SMTP 服务器/)).toHaveValue("smtp.changed.invalid");
  expect(state.writes.at(-1)?.input).toEqual({ expectedVersion: 1, values: { host: "smtp.changed.invalid" } });
  state.setConflict(false);
  await page.getByLabel(/SMTP 授权码/).fill("fixture-new-secret");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByText("配置已保存，新请求开始使用。")).toBeVisible();
  await expect(page.getByLabel(/SMTP 授权码/)).toHaveValue("");
  expect(state.writes.at(-1)?.input.values.password).toBe("fixture-new-secret");
  await page.getByRole("button", { name: "测试 SMTP 认证" }).click();
  await expect(page.getByText("SMTP 认证通过，尚未验证收件。")).toBeVisible();
  const field = page.locator(".configuration-field").filter({ has: page.getByLabel(/SMTP 授权码/) });
  await field.getByRole("button", { name: "恢复服务器配置 / 默认值" }).click();
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByText("配置已保存，新请求开始使用。")).toBeVisible();
  expect(state.writes.at(-1)?.input).toEqual({ expectedVersion: 2, values: { password: null } });
});

test("default routes persist and dirty settings require deliberate group changes", async ({ page }) => {
  const { writes } = await fixtures(page);
  await page.goto("/admin#平台配置");
  await page.getByLabel(/文本创作/).selectOption("config-text");
  await page.getByRole("navigation", { name: "配置分组" }).getByRole("button", { name: /^注册邮件/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel(/文本创作/)).toHaveValue("config-text");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByText("配置已保存，新请求开始使用。")).toBeVisible();
  expect(writes.at(-1)?.input.values).toEqual({ textProvider: "config-text" });
  await page.getByRole("button", { name: /微信 Native 支付/ }).click();
  await expect(page.getByLabel(/开放新订单收款/)).toHaveValue("false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR}/configuration-payment-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR}/configuration-dark-${test.info().project.name}.png`, fullPage: true });
});

test("channel edits retain conflicts and send protocol, nullable clears and saved version", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/admin#模型路由");
  await page.getByRole("button", { name: "展开文本测试渠道渠道", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑文本测试渠道渠道", exact: true });
  await dialog.getByLabel("Base URL", { exact: true }).fill("");
  await dialog.getByLabel(/^接口协议/).selectOption("openai-responses");
  await dialog.getByRole("button", { name: "清除后台密钥，恢复服务器配置" }).click();
  state.setConflict(true);
  await dialog.getByRole("button", { name: "保存渠道", exact: true }).click();
  await expect(dialog.getByText("配置已被其他管理员更新，草稿已保留。")).toBeVisible();
  await expect(dialog.getByLabel(/^接口协议/)).toHaveValue("openai-responses");
  expect(state.writes.at(-1)?.input).toMatchObject({ expectedUpdatedAt: "2026-11-01T10:00:00.000Z", baseUrl: null, apiKey: null, connection: { protocol: "openai-responses" } });
  state.setConflict(false);
  await dialog.getByRole("button", { name: "保存渠道", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "保存渠道", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("TTS performs one confirmed test and video distinguishes checks from real submission", async ({ page }) => {
  const { writes } = await fixtures(page);
  await page.goto("/admin#模型路由");
  await page.getByRole("button", { name: "测试配音测试渠道已保存配置", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "开始测试", exact: true }).click();
  await expect.poll(() => writes.filter(item => item.path === "/settings/tts-model-test").length).toBe(1);
  await page.getByRole("button", { name: "测试视频测试渠道已保存配置", exact: true }).click();
  await expect.poll(() => writes.filter(item => item.path === "/settings/video-model-test").length).toBe(1);
  expect(writes.at(-1)?.input.mode).toBe("config");
  await page.getByRole("button", { name: "展开视频测试渠道渠道", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑视频测试渠道渠道", exact: true });
  await expect(dialog.getByRole("button", { name: "提交真实视频测试" })).toBeDisabled();
  await dialog.getByLabel(/真实测试首帧 URL/).fill("https://fixture.invalid/frame.png");
  await dialog.getByRole("button", { name: "提交真实视频测试" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "开始测试", exact: true }).click();
  await expect(dialog.getByText("任务已提交 · 等待供应商完成，请勿重复测试")).toBeVisible();
  expect(writes.filter(item => item.path === "/settings/video-model-test")).toHaveLength(2);
  expect(writes.at(-1)?.input).toMatchObject({ mode: "real", imageUrl: "https://fixture.invalid/frame.png" });
});
