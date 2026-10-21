import { test, expect } from "@playwright/test";
import { gotoLogin, loginAsStaff, attachObservability, assertNoHorizontalOverflow } from "./_helpers.js";

const SCREENSHOT_DIR = "screenshots/staff-login";

test.describe("Staff Login UI/UX (desktop)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("page loads with branding, heading, and accessible form", async ({ page }) => {
    const obs = attachObservability(page);
    await page.goto("/staff/login");

    await expect(page).toHaveURL(/\/staff\/login$/);

    // Brand element exists in the header.
    await expect(page.locator(".nav-brand")).toBeVisible();

    // Heading and lead copy.
    await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();
    await expect(
      page.getByText(/sign in with your staff account to open the ticket scanner/i)
    ).toBeVisible();

    // Form fields are properly labelled.
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();

    // Tab navigation reaches the form inputs. The skip link and brand link come
    // first; within the first few Tab presses we must reach the email and
    // password fields.
    await page.locator("body").focus();
    const stops = [];
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => document.activeElement?.id ?? "");
      stops.push(id);
    }
    expect(stops).toContain("staff-email");
    expect(stops).toContain("staff-password");

    await page.screenshot({ path: `${SCREENSHOT_DIR}-desktop.png`, fullPage: true });
    expect(obs.pageErrors).toEqual([]);
  });

  test("email + password inputs accept typing", async ({ page }) => {
    await gotoLogin(page);
    const email = page.getByLabel("Email");
    const pw = page.getByLabel("Password");
    await email.fill("user@example.test");
    await pw.fill("hunter2");
    await expect(email).toHaveValue("user@example.test");
    await expect(pw).toHaveValue("hunter2");
  });

  test("submitting shows a loading state then transitions to scanner", async ({ page }) => {
    await loginAsStaff(page);
    await expect(page).toHaveURL(/\/staff\/scanner$/);
    await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();
  });

  test("invalid credentials show an understandable error and stay on login", async ({ page }) => {
    const obs = attachObservability(page);
    await gotoLogin(page);
    await page.getByLabel("Email").fill(`bad-${Date.now()}@example.test`);
    await page.getByLabel("Password").fill("definitely-not-real");
    await page.getByRole("button", { name: /sign in/i }).click();

    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeVisible({ timeout: 10_000 });
    const text = (await alert.textContent()) ?? "";
    expect(text.length).toBeGreaterThan(0);

    await expect(page).toHaveURL(/\/staff\/login$/);
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled();

    await page.screenshot({ path: `${SCREENSHOT_DIR}-invalid.png`, fullPage: true });
    expect(obs.pageErrors).toEqual([]);
  });
});

test.describe("Staff Login UI/UX (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders without horizontal overflow at mobile width", async ({ page }) => {
    await page.goto("/staff/login");
    await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}-mobile.png`, fullPage: true });
  });
});