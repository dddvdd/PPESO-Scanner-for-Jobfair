import { test, expect } from "@playwright/test";

const STAFF_LOGIN_PATH = "/staff/login";
const STAFF_SCANNER_PATH = "/staff/scanner";

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it in your local .env.local (gitignored) before running E2E tests.`
    );
  }
  return value;
}

async function loginAsStaff(page) {
  const email = requireEnv("E2E_STAFF_EMAIL");
  const password = requireEnv("E2E_STAFF_PASSWORD");
  await page.goto(STAFF_LOGIN_PATH);
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === STAFF_SCANNER_PATH, {
    timeout: 20_000,
  });
}

test("staff login success", async ({ page }) => {
  await loginAsStaff(page);

  await expect(page).toHaveURL(new RegExp(`${STAFF_SCANNER_PATH}$`));
  await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();

  // Observable authenticated session: the scanner exposes the signed-in
  // email in the topbar kicker, and shows a "Sign Out" control.
  const email = requireEnv("E2E_STAFF_EMAIL");
  await expect(page.locator(".sc-kicker")).toContainText(email);
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
});