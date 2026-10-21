import { test, expect } from "@playwright/test";
import { loginAsStaff, gotoLogin, attachObservability } from "./_helpers.js";

test.describe("Staff navigation flows", () => {
  test("full journey: login → scanner → reload → logout → back to login", async ({ page }) => {
    await loginAsStaff(page);
    await expect(page).toHaveURL(/\/staff\/scanner$/);

    await page.reload();
    await expect(page).toHaveURL(/\/staff\/scanner$/);
    await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();

    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/staff\/login$/);
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("direct access to /staff/scanner while logged out redirects to login", async ({ page }) => {
    await page.goto("/staff/scanner");
    await page.waitForURL(/\/staff\/login$/);
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();
  });

  test("refresh after logout keeps the user logged out", async ({ page }) => {
    await loginAsStaff(page);
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/staff\/login$/);

    await page.reload();
    await expect(page).toHaveURL(/\/staff\/login$/);
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("back navigation after logout lands on a public page", async ({ page, context }) => {
    // Pre-load a public page so history has somewhere to go back to.
    await page.goto("/");
    await expect(page.locator(".nav-brand")).toBeVisible();

    await loginAsStaff(page);
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/staff\/login$/);

    await page.goBack();
    // The previous entry was the scanner page; the SPA router should land
    // somewhere sensible (home or scanner redirect). Either is acceptable
    // as long as we are NOT authenticated against /staff/scanner.
    await expect(page).not.toHaveURL(/\/staff\/scanner$/);
  });
});