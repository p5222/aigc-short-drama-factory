import { test, expect, type Page } from "@playwright/test";

const policy = { emailDomain: "qq.com", phoneRequired: true, smsRequired: false, emailVerificationRequired: true, mailAvailable: true, codeTtlSeconds: 600, resendAfterSeconds: 60 };
async function openSignup(page: Page, available = true) {
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/registration-policy") ? { ...policy, mailAvailable: available } : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始制作我的故事", exact: true }).click();
  await page.getByRole("button", { name: "注册", exact: true }).click();
}
async function credentials(page: Page) {
  await page.locator('[name="register_phone"]').fill("13900000001");
  await page.locator('[name="register_email"]').fill("creator@qq.com");
  await page.locator('[name="register_password"]').fill("Fixture-password");
  await page.locator('[name="register_confirm_password"]').fill("Fixture-password");
  await page.locator(".cine-agree-row input").check();
}

test("QQ signup verifies email before registration, preserves fields on failure and invalidates changed email", async ({ page }, info) => {
  await openSignup(page);
  let sends = 0, verifications = 0, registrations = 0;
  let rejectVerify = true;
  await page.route("**/api/auth/email/send", route => {
    sends++;
    expect(route.request().postDataJSON()).toEqual({ email: "creator@qq.com" });
    return route.fulfill({ json: { sent: true, expiresInSeconds: 600, resendAfterSeconds: 60 } });
  });
  await page.route("**/api/auth/email/verify", route => {
    verifications++;
    return rejectVerify ? route.fulfill({ status: 400, json: { message: "邮箱验证码不正确" } }) :
      route.fulfill({ json: { verificationToken: "a".repeat(64), expiresInSeconds: 600 } });
  });
  await page.route("**/api/auth/register", route => {
    registrations++;
    expect(route.request().postDataJSON()).toEqual({ email: "creator@qq.com", phone: "13900000001", password: "Fixture-password", verificationToken: "a".repeat(64) });
    return route.fulfill({ status: 503, json: { message: "服务暂时不可用，请重试。" } });
  });
  const register = page.getByRole("button", { name: "立即注册", exact: true });
  await credentials(page);
  await expect(register).toBeDisabled();
  await page.locator('[name="register_email"]').fill("creator@example.test");
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await expect(page.getByText("请使用 qq.com 邮箱注册。", { exact: true })).toBeVisible();
  expect(sends).toBe(0);
  await page.locator('[name="register_email"]').fill("creator@qq.com");
  await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await expect(page.getByText(/验证码已发送至 QQ 邮箱/)).toBeVisible();
  await expect(page.getByRole("button", { name: /\d+s/, exact: true })).toBeDisabled();
  await page.locator('[name="register_email_code"]').fill("123456");
  await page.getByRole("button", { name: "验证邮箱", exact: true }).click();
  await expect(page.getByText("邮箱验证码不正确", { exact: true })).toBeVisible();
  await expect(page.locator('[name="register_email_code"]')).toHaveValue("123456");
  await expect(register).toBeDisabled();
  rejectVerify = false;
  await page.getByRole("button", { name: "验证邮箱", exact: true }).click();
  await expect(register).toBeEnabled();
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/qq-registration"}/verified-${info.project.name}.png`, fullPage: true });
  await register.click();
  await expect(page.getByText("服务暂时不可用，请重试。", { exact: true })).toBeVisible();
  await expect(page.locator('[name="register_phone"]')).toHaveValue("13900000001");
  await expect(page.locator('[name="register_password"]')).toHaveValue("Fixture-password");
  expect(registrations).toBe(1);
  expect(verifications).toBe(2);
  await page.locator('[name="register_email"]').fill("changed@qq.com");
  await expect(register).toBeDisabled();
  await expect(page.locator('[name="register_email_code"]')).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("unavailable mail service and English mobile signup clearly explain the required verification", async ({ page }, info) => {
  await openSignup(page, false);
  await expect(page.getByText(/邮箱验证服务暂未开通/)).toBeVisible();
  await expect(page.getByRole("button", { name: "立即注册", exact: true })).toBeDisabled();
  await expect(page.locator('[name="register_captcha"]')).toHaveCount(0);
  await expect(page.locator('[name="register_phone"]')).toHaveAttribute("required", "");
  await page.screenshot({ path: `${process.env.PLAYWRIGHT_SCREENSHOT_DIR ?? "../../outputs/qq-registration"}/unavailable-${info.project.name}.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "选择语言", exact: true }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Create my story", exact: true }).click();
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByText(/Email verification is not available yet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});
