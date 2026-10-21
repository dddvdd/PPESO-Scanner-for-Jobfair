import { test, expect } from "@playwright/test";

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.length === 0) throw new Error(`Missing env var ${name}`);
  return value;
}

async function loginAsAdmin(page) {
  const email = requireEnv("E2E_ADMIN_EMAIL");
  const password = requireEnv("E2E_ADMIN_PASSWORD");
  await page.goto("/staff/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) =>
    url.pathname === "/staff/scanner" || url.pathname === "/admin",
    { timeout: 20_000 }
  );
}

test("screenshot export tab", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin?tab=export");
  await page.waitForSelector("#panel-export:not([hidden])", { timeout: 10_000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "screenshots/export-tab.png", fullPage: true });
  console.log("Screenshot saved");

  // Also check: are the buttons disabled?
  const preRegBtn = page.getByRole("button", { name: /download pre-registrants/i });
  const checkinBtn = page.getByRole("button", { name: /download check-ins/i });
  const manageBtn = page.getByRole("button", { name: /manage interview/i });
  console.log("Pre-reg disabled:", await preRegBtn.isDisabled());
  console.log("Check-in disabled:", await checkinBtn.isDisabled());
  console.log("Manage disabled:", await manageBtn.isDisabled());

  // Select first event
  const select = page.getByLabel("Select event");
  const options = select.locator("option");
  const count = await options.count();
  console.log("Options count:", count);
  if (count > 1) {
    await select.selectOption({ index: 1 });
    console.log("After select - Pre-reg disabled:", await preRegBtn.isDisabled());
    console.log("After select - Check-in disabled:", await checkinBtn.isDisabled());
    console.log("After select - Manage disabled:", await manageBtn.isDisabled());
  }
  await page.screenshot({ path: "screenshots/export-tab-selected.png", fullPage: true });
});
