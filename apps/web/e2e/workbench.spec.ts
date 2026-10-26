import { test, expect } from "@playwright/test";

test.describe("dual-theme creator workbench", () => {
  test("landing shell has no horizontal document overflow", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("theme preference persists and reduced motion is honored", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "首页导航", exact: true })).toBeVisible();
    await page.evaluate(() => localStorage.setItem("manjiao-theme", "dark"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("manjiao-theme"))).toBe("dark");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    expect(reduced).toBe(true);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ds-motion-fast").trim())).toBe("0ms");
  });

  test("unsupported controls are not exposed on the public entry", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /单镜头视频|新增镜头|时间线编辑/ })).toHaveCount(0);
  });

  test("workbench drawer contract when a real project URL is supplied", async ({ page }) => {
    const projectURL = process.env.PLAYWRIGHT_WORKBENCH_URL;
    test.skip(!projectURL, "Set PLAYWRIGHT_WORKBENCH_URL to run authenticated workbench interaction gates.");
    await page.goto(projectURL!);
    await expect(page.getByRole("navigation", { name: /项目生产阶段/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /内容/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /资产/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /镜头/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /成片/ })).toBeVisible();

    const evaluation = page.getByRole("button", { name: /评测反馈/ });
    if (await evaluation.count()) {
      await evaluation.click();
      await expect(page.getByRole("dialog", { name: /评测与反馈/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: /评测与反馈/ })).toHaveCount(0);
    }
    const tasks = page.getByRole("button", { name: /生成任务/ });
    if (await tasks.count()) {
      await tasks.click();
      await expect(page.getByRole("dialog", { name: /生成任务/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: /生成任务/ })).toHaveCount(0);
    }
  });
});
