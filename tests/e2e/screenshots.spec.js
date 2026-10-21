import { test } from "@playwright/test";
import { loginAsStaff, gotoLogin } from "./_helpers.js";

/**
 * Screenshot-based UX capture. Each test saves a PNG to /screenshots/.
 * No secrets, credentials, or session data are ever written to disk.
 */

test("screenshot: Staff Login — desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoLogin(page);
  await page.screenshot({ path: "screenshots/staff-login-desktop.png", fullPage: true });
});

test("screenshot: Staff Login — mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLogin(page);
  await page.screenshot({ path: "screenshots/staff-login-mobile.png", fullPage: true });
});

test("screenshot: Staff Login — invalid credentials", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoLogin(page);
  await page.getByLabel("Email").fill(`bad-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("definitely-not-real");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page
    .locator('[role="alert"]')
    .first()
    .waitFor({ timeout: 10_000 });
  await page.screenshot({ path: "screenshots/staff-login-invalid.png", fullPage: true });
});

test("screenshot: Staff Scanner — desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsStaff(page);
  await page.screenshot({ path: "screenshots/staff-scanner-desktop.png", fullPage: true });
});

test("screenshot: Staff Scanner — mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsStaff(page);
  await page.screenshot({ path: "screenshots/staff-scanner-mobile.png", fullPage: true });
});

test("screenshot: Staff Scanner — camera/instruction state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsStaff(page);
  // The scanner UI shows a "camera permission/instruction" notice depending
  // on the browser environment. Give it a moment to settle and capture.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "screenshots/staff-scanner-instructions.png", fullPage: true });
});