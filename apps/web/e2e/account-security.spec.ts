import { test, expect, type Page } from "@playwright/test";

async function openRecovery(page: Page) {
  await page.route("**/api/**", route => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByRole("button", { name: "开始制作我的故事", exact: true }).click();
  await page.getByRole("button", { name: "忘记密码?", exact: true }).click();
  await expect(page.getByRole("heading", { name: "找回密码", exact: true })).toBeVisible();
}
async function fillRecovery(page: Page) {
  await page.locator('[name="recovery_email"]').fill("verified@qq.com");
  await page.locator('[name="recovery_code"]').fill("123456");
  await page.locator('[name="recovery_password"]').fill("New-fixture-password");
  await page.locator('[name="recovery_confirm"]').fill("New-fixture-password");
}
async function profile(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("aifilm_auth_token", "account-fixture");
    localStorage.setItem("manjiao-theme", "light");
  });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const values: Record<string, unknown> = {
      "/auth/me": { user: { id: "account-fixture", name: "林间", email: "legacy@qq.com", emailVerified: false, role: "creator", status: "active" } },
      "/workbench/summary": { userName: "林间", projects: 0, storyboards: 0, runningTasks: 0, credits: 100, recentProjects: [], recentTasks: [], announcements: [] },
      "/credits/account": { balance: 100, frozenBalance: 0 },
      "/credits/ledger": { items: [], total: 0 }
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
  await page.goto("/#/profile");
  await expect(page.getByRole("heading", { name: "我的账户", exact: true })).toBeVisible();
}

test("password recovery preserves failed input and reuses its grant before returning to sign in", async ({ page }, info) => {
  await openRecovery(page);
  let sends = 0, verifies = 0, resets = 0;
  await page.route("**/api/auth/recovery/send", route => { sends++; return route.fulfill({ json: { sent: true, resendAfterSeconds: 60 } }); });
  await page.route("**/api/auth/recovery/verify", route => { verifies++; return route.fulfill({ json: { verificationToken: "a".repeat(64), expiresInSeconds: 600 } }); });
  await page.route("**/api/auth/recovery/reset", route => {
    resets++; expect(route.request().postDataJSON()).toEqual({ email: "verified@qq.com", verificationToken: "a".repeat(64), newPassword: "New-fixture-password" });
    return resets === 1 ? route.fulfill({ status: 503, json: { message: "账户更新未确认，请重试。" } }) : route.fulfill({ json: { ok: true, requiresLogin: true } });
  });
  await page.locator('[name="recovery_email"]').fill("verified@qq.com");
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await expect(page.getByRole("button", { name: /\d+s/, exact: true })).toBeDisabled();
  await fillRecovery(page);
  await page.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByText("账户更新未确认，请重试。", { exact: true })).toBeVisible();
  await expect(page.locator('[name="recovery_password"]')).toHaveValue("New-fixture-password");
  await expect(page.locator('[name="recovery_code"]')).toHaveValue("123456");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  if (process.env.PLAYWRIGHT_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR}/account-recovery-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByText("密码已重置，全部会话已退出。请使用新密码登录。", { exact: true })).toBeVisible();
  await expect(page.locator('[name="creator_password"]')).toHaveValue("");
  expect(sends).toBe(1); expect(verifies).toBe(1); expect(resets).toBe(2);
});

test("failed verification retains input and changing the mailbox discards the old grant", async ({ page }) => {
  await openRecovery(page);
  let verifies = 0, resets = 0;
  await page.route("**/api/auth/recovery/verify", route => {
    verifies++;
    return verifies === 1 ? route.fulfill({ status: 400, json: { message: "验证码不正确，请核对。" } }) : route.fulfill({ json: { verificationToken: "b".repeat(64), expiresInSeconds: 600 } });
  });
  await page.route("**/api/auth/recovery/reset", route => { resets++; return route.fulfill({ status: 503, json: { message: "暂不可用" } }); });
  await fillRecovery(page);
  await page.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByText("验证码不正确，请核对。", { exact: true })).toBeVisible();
  await expect(page.locator('[name="recovery_code"]')).toHaveValue("123456");
  expect(resets).toBe(0);
  await page.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByText("暂不可用", { exact: true })).toBeVisible();
  await page.locator('[name="recovery_email"]').fill("changed@qq.com");
  await expect(page.locator('[name="recovery_code"]')).toHaveValue("");
  await page.locator('[name="recovery_code"]').fill("234567");
  await page.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect.poll(() => verifies).toBe(3);
});

test("legacy account can verify its current email, retain its draft and sign out after saving", async ({ page }, info) => {
  await profile(page);
  await expect(page.getByText(/待验证，暂不可用于找回/)).toBeVisible();
  await page.getByRole("button", { name: "验证邮箱", exact: true }).click();
  let verifies = 0, saves = 0;
  await page.route("**/api/auth/email-binding/send", route => route.fulfill({ json: { sent: true, resendAfterSeconds: 60 } }));
  await page.route("**/api/auth/email-binding/verify", route => { verifies++; return route.fulfill({ json: { verificationToken: "c".repeat(64), expiresInSeconds: 600 } }); });
  await page.route("**/api/auth/profile", route => {
    saves++;
    expect(route.request().postDataJSON()).toEqual({ email: "legacy@qq.com", currentPassword: "Current-fixture-password", verificationToken: "c".repeat(64) });
    return saves === 1 ? route.fulfill({ status: 503, json: { message: "邮箱保存未确认" } }) : route.fulfill({ json: { requiresLogin: true } });
  });
  await page.getByLabel("当前密码", { exact: true }).fill("Current-fixture-password");
  await page.getByRole("button", { name: "发送邮箱验证码", exact: true }).click();
  await expect(page.getByRole("button", { name: /\d+ 秒后重发/ })).toBeDisabled();
  await page.getByLabel("邮箱验证码", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "保存邮箱", exact: true }).click();
  await expect(page.getByText("邮箱保存未确认", { exact: true })).toBeVisible();
  await expect(page.getByLabel("当前密码", { exact: true })).toHaveValue("Current-fixture-password");
  if (process.env.PLAYWRIGHT_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR}/account-binding-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "保存邮箱", exact: true }).click();
  await expect(page.getByText("QQ 邮箱已验证并保存，所有登录会话已退出。请重新登录。", { exact: true })).toBeVisible();
  expect(verifies).toBe(1); expect(saves).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem("aifilm_auth_token"))).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

test("successful password change clears the current token and prompts sign in", async ({ page }) => {
  await profile(page);
  await page.route("**/api/auth/password", route => route.fulfill({ json: { ok: true, requiresLogin: true } }));
  await page.getByRole("button", { name: /修改登录密码/ }).click();
  await page.getByLabel("当前密码", { exact: true }).fill("Current-fixture-password");
  await page.getByLabel("新密码", { exact: true }).fill("New-fixture-password");
  await page.getByLabel("确认新密码", { exact: true }).fill("New-fixture-password");
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect(page.getByText("密码已更新，所有登录会话已退出。请使用新密码登录。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("aifilm_auth_token"))).toBeNull();
});
