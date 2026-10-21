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
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === STAFF_SCANNER_PATH, {
    timeout: 20_000,
  });
}

test("logout returns to login and blocks the protected route", async ({ page }) => {
  await loginAsStaff(page);
  await expect(page).toHaveURL(new RegExp(`${STAFF_SCANNER_PATH}$`));

  // Trigger the existing logout control.
  await page.getByRole("button", { name: /sign out/i }).click();

  // After sign-out, the scanner must redirect to the login page.
  await page.waitForURL((url) => url.pathname === STAFF_LOGIN_PATH, {
    timeout: 15_000,
  });
  await expect(page).toHaveURL(new RegExp(`${STAFF_LOGIN_PATH}$`));
  await expect(page.getByLabel("Email")).toBeVisible();

  // Attempting to reach the protected route again must bounce back to login.
  await page.goto(STAFF_SCANNER_PATH);
  await page.waitForURL((url) => url.pathname === STAFF_LOGIN_PATH, {
    timeout: 15_000,
  });
  await expect(page).toHaveURL(new RegExp(`${STAFF_LOGIN_PATH}$`));
  await expect(page.getByLabel("Email")).toBeVisible();

  // Observable: the scanner UI must not be reachable while logged out.
  await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
});