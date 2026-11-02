import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const writes: Array<{ path: string; body: any }> = [];
  let conflict = true, readFails = false, conflictStatus = 503;
  const row = { id: "platform-task-fixture", kind: "generation", userId: "creator-fixture", projectId: "project-fixture", title: "生成分镜",
    type: "video", status: "pending", provider: "已保存渠道", model: "video-fixture", frozenCredits: 30, chargedCredits: 0,
    reviewRequired: true, remoteTaskId: "supplier-known-id", sourceFingerprint: "f".repeat(64), canQuery: true, canResolve: true,
    attempts: [{ id: "attempt-fixture", state: "unknown", startedAt: "2026-11-02T09:00:00.000Z", submittedAt: "2026-11-02T09:00:02.000Z" }],
    createdAt: "2026-11-02T09:00:00.000Z", updatedAt: "2026-11-02T09:00:03.000Z" };
  await page.addInitScript(() => { localStorage.setItem("aifilm_auth_token", "task-operation-fixture"); localStorage.setItem("manjiao-theme", "light"); });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); writes.push({ path, body });
      if (path.endsWith("/query")) return route.fulfill({ json: { status: "running", checkedAt: "2026-11-02T10:00:00Z", message: "仅查询原任务，未重新提交。" } });
      if (conflict) return route.fulfill({ status: conflictStatus, json: { message: conflictStatus === 409 ? "任务状态已变化，请刷新详情后重新核对。" : "处置结果暂未确认，请保留当前理由重试。" } });
      row.status = "canceled"; row.canResolve = false;
      return route.fulfill({ json: { targetId: row.id, affectedTaskIds: [row.id], releasedCredits: 30 } });
    }
    if (path === "/admin/task-operations/generation/platform-task-fixture") return route.fulfill({ json: row });
    if (path === "/admin/task-operations") return route.fulfill(readFails
      ? { status: 503, json: { message: "任务读取暂不可用" } }
      : { json: { items: [row], total: 1, page: 1, pageSize: 30 } });
    const data: Record<string, unknown> = {
      "/auth/me": { user: { id: "task-operator", name: "测试管理员", role: "admin", status: "active" } },
      "/admin/summary": { users: 1, projects: 1, totalTasks: 1, tasksToday: 1, creditsConsumed: 0 },
      "/admin/evaluation/overview": { datasets: [], runs: [], experiments: [], promptVersions: [] }
    };
    return route.fulfill({ json: data[path] ?? [] });
  });
  return { writes, allowResolve: () => { conflict = false; }, staleVersion: () => { conflictStatus = 409; }, failReads: () => { readFails = true; } };
}

test("operator query and guarded resolution preserve the reason and replay identity after a failure", async ({ page }) => {
  const server = await fixture(page);
  await page.goto("/admin#异常任务");
  await page.getByRole("button", { name: "查看任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "任务核对与结束" });
  await expect(dialog.getByText("supplier-known-id")).toBeVisible();
  const end = dialog.getByRole("button", { name: "结束未交付任务并释放冻结" });
  await expect(end).toBeDisabled();
  await dialog.getByRole("button", { name: "查询原上游任务" }).click();
  await expect(dialog.getByText(/仅查询原任务/)).toBeVisible();
  expect(server.writes).toHaveLength(1);
  await dialog.getByLabel("核对依据").fill("已在供应商控制台核对，没有交付素材，结束此任务。");
  await dialog.getByLabel("我已核对供应商记录，确认结束未交付部分").check();
  await end.click();
  await expect(dialog.getByText("处置结果暂未确认，请保留当前理由重试。")).toBeVisible();
  await expect(dialog.getByLabel("核对依据")).toHaveValue("已在供应商控制台核对，没有交付素材，结束此任务。");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR}/task-operation-${test.info().project.name}.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeVisible();
  server.allowResolve();
  await end.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/已结束 1 项关联任务，释放 30 积分/)).toBeVisible();
  const mutations = server.writes.filter(write => write.path.endsWith("/resolve"));
  expect(mutations).toHaveLength(2);
  expect(mutations[0].body).toEqual(mutations[1].body);
  expect(mutations[0].body.expectedUpdatedAt).toBe("2026-11-02T09:00:03.000Z");
});

test("failed task reads show an error and expose no stale resolution controls", async ({ page }) => {
  const server = await fixture(page); server.failReads();
  await page.goto("/admin#异常任务");
  await expect(page.getByText("任务读取暂不可用")).toBeVisible();
  await expect(page.getByRole("button", { name: "查看任务", exact: true })).toHaveCount(0);
  expect(server.writes).toHaveLength(0);
});

test("a version conflict requires refreshed details and renewed confirmation while retaining the draft", async ({ page }) => {
  const server = await fixture(page); server.staleVersion();
  await page.goto("/admin#异常任务");
  await page.getByRole("button", { name: "查看任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "任务核对与结束" }), end = dialog.getByRole("button", { name: "结束未交付任务并释放冻结" });
  await dialog.getByLabel("核对依据").fill("确认没有交付结果，本次申请结束未交付任务。");
  await dialog.getByLabel("我已核对供应商记录，确认结束未交付部分").check();
  await end.click();
  await expect(dialog.getByText("任务状态已变化，请刷新详情后重新核对。")).toBeVisible();
  await expect(end).toBeDisabled();
  await dialog.getByRole("button", { name: "刷新详情与核对记录" }).click();
  await expect(dialog.getByLabel("核对依据")).toHaveValue("确认没有交付结果，本次申请结束未交付任务。");
  await expect(end).toBeDisabled();
  server.allowResolve();
  await dialog.getByLabel("我已核对供应商记录，确认结束未交付部分").check();
  await end.click();
  await expect(dialog).toBeHidden();
});
