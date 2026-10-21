import { test, expect } from "@playwright/test";

const STAFF_LOGIN_PATH = "/staff/login";

test("invalid staff login is rejected without crashing", async ({ page }) => {
  // Intentionally invalid; no real credentials used.
  const bogusEmail = `e2e-invalid-${Date.now()}@example.test`;
  const bogusPassword = "definitely-not-a-real-password-x9k2";

  await page.goto(STAFF_LOGIN_PATH);
  await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();

  await page.getByLabel("Email").fill(bogusEmail);
  await page.getByLabel("Password").fill(bogusPassword);
  await page.getByRole("button", { name: /sign in/i }).click();

  // An auth error from the application appears in the page.
  const errorAlert = page.locator('[role="alert"]', { hasText: /invalid|credentials|sign-in/i });
  await expect(errorAlert).toBeVisible({ timeout: 10_000 });

  // User remains on the login page; no redirect to the scanner.
  await expect(page).toHaveURL(new RegExp(`${STAFF_LOGIN_PATH}$`));
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();

  // The login form is still usable — submit button is enabled again.
  await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled();
});