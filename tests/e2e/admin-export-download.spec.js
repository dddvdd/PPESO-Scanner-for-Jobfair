import { test, expect } from "@playwright/test";
import { join } from "node:path";

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.length === 0) throw new Error(`Missing env var ${name}`);
  return value;
}

async function loginAsAdmin(page) {
  const email = requireEnv("E2E_ADMIN_EMAIL");
  const password = requireEnv("E2E_ADMIN_PASSWORD");
  await page.goto("/staff/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) =>
    url.pathname === "/staff/scanner" || url.pathname === "/admin",
    { timeout: 20_000 }
  );
  if (page.url().includes("/staff/scanner")) {
    await page.goto("/admin");
  }
  await expect(page.getByRole("heading", { name: /event.*staff administration/i })).toBeVisible();
}

async function openExportTabAndSelectDmwEvent(page) {
  await page.getByRole("tab", { name: /export/i }).click();
  await expect(page.getByLabel("Select event")).toBeVisible();
  const select = page.getByLabel("Select event");
  await select.waitFor({ state: "visible" });
  await select.selectOption({ index: 1 });
}

test.describe("Export DMW event CSVs via Export tab", () => {
  test("download pre-registrants CSV", async ({ page }) => {
    await loginAsAdmin(page);
    await openExportTabAndSelectDmwEvent(page);
    const btn = page.getByRole("button", { name: /download pre-registrants/i });
    await expect(btn).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      btn.click(),
    ]);
    const dest = join(process.cwd(), "test-results", download.suggestedFilename());
    await download.saveAs(dest);
    console.log(`Saved: ${dest}`);
  });

  test("download check-ins CSV", async ({ page }) => {
    await loginAsAdmin(page);
    await openExportTabAndSelectDmwEvent(page);
    const btn = page.getByRole("button", { name: /download check-ins/i });
    await expect(btn).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      btn.click(),
    ]);
    const dest = join(process.cwd(), "test-results", download.suggestedFilename());
    await download.saveAs(dest);
    console.log(`Saved: ${dest}`);
  });
});
