import { test, expect } from "@playwright/test";
import { attachObservability, assertNoHorizontalOverflow } from "./_helpers.js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var ${name}`);
  }
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

async function openExportTab(page) {
  await page.getByRole("tab", { name: /export/i }).click();
  await expect(page.locator("#panel-export")).toBeVisible();
}

test.describe("Admin Export sidebar", () => {
  test("Export tab is visible in the admin navigation", async ({ page }) => {
    const snapshot = attachObservability(page);
    await loginAsAdmin(page);
    const tab = page.getByRole("tab", { name: /export/i });
    await expect(tab).toBeVisible();
    expect(snapshot.pageErrors).toEqual([]);
  });

  test("Export interface opens with event selector", async ({ page }) => {
    const snapshot = attachObservability(page);
    await loginAsAdmin(page);
    await openExportTab(page);
    await expect(page.getByLabel("Select event")).toBeVisible();
    await expect(page.getByRole("button", { name: /download pre-registrants/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /download check-ins/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /manage interview/i })).toBeVisible();
    expect(snapshot.pageErrors).toEqual([]);
  });

  test("Event selector loads real events", async ({ page }) => {
    const snapshot = attachObservability(page);
    await loginAsAdmin(page);
    await openExportTab(page);
    const select = page.getByLabel("Select event");
    await expect(select).toBeVisible();
    const optionCount = await select.locator("option").count();
    expect(optionCount).toBeGreaterThan(1);
    expect(snapshot.pageErrors).toEqual([]);
  });

  test("Pre-registrant download requires an event selection", async ({ page }) => {
    const snapshot = attachObservability(page);
    await loginAsAdmin(page);
    await openExportTab(page);
    const btn = page.getByRole("button", { name: /download pre-registrants/i });
    await expect(btn).toBeDisabled();
    expect(snapshot.pageErrors).toEqual([]);
  });

  test("Check-in download requires an event selection", async ({ page }) => {
    const snapshot = attachObservability(page);
    await loginAsAdmin(page);
    await openExportTab(page);
    const btn = page.getByRole("button", { name: /download check-ins/i });
    await expect(btn).toBeDisabled();
    expect(snapshot.pageErrors).toEqual([]);
  });

  test("Manage Interview button uses selected event", async ({ page }) => {
    const snapshot = attachObservability(page);
    await loginAsAdmin(page);
    await openExportTab(page);
    const btn = page.getByRole("button", { name: /manage interview/i });
    await expect(btn).toBeDisabled();
    const select = page.getByLabel("Select event");
    const options = select.locator("option");
    const count = await options.count();
    if (count > 1) {
      const secondOptionValue = await options.nth(1).getAttribute("value");
      await select.selectOption(secondOptionValue);
      await expect(btn).toBeEnabled();
      const [response] = await Promise.all([
        page.waitForURL(/\/staff\/interviews\?event=/, { timeout: 5_000 }),
        btn.click(),
      ]);
      expect(page.url()).toContain("event=");
    }
    expect(snapshot.pageErrors).toEqual([]);
  });

  test("Export downloads successfully after selecting event", async ({ page }) => {
    const snapshot = attachObservability(page);
    await loginAsAdmin(page);
    await openExportTab(page);
    const select = page.getByLabel("Select event");
    const options = select.locator("option");
    const count = await options.count();
    if (count > 1) {
      const secondOptionValue = await options.nth(1).getAttribute("value");
      await select.selectOption(secondOptionValue);
      const btn = page.getByRole("button", { name: /download pre-registrants/i });
      await expect(btn).toBeEnabled();
      const downloadPromise = page.waitForEvent("download");
      await btn.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/pre-registrants\.csv$/);
    }
    expect(snapshot.pageErrors).toEqual([]);
  });

  test("Event-card export buttons are removed", async ({ page }) => {
    const snapshot = attachObservability(page);
    await loginAsAdmin(page);
    await page.waitForSelector(".event-card", { timeout: 15_000 });
    const eventsPanel = page.locator("#panel-events");
    const cardBtns = eventsPanel.locator("button:has-text('Download Pre-registrants')");
    await expect(cardBtns).toHaveCount(0);
    const cardBtns2 = eventsPanel.locator("button:has-text('Download Check-ins')");
    await expect(cardBtns2).toHaveCount(0);
    expect(snapshot.pageErrors).toEqual([]);
  });

  test("existing Registrants/Publish/Edit buttons remain on event cards", async ({ page }) => {
    const snapshot = attachObservability(page);
    await loginAsAdmin(page);
    await page.waitForSelector(".event-card", { timeout: 15_000 });
    await expect(page.getByRole("link", { name: /registrants/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /unpublish|publish/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^edit$/i }).first()).toBeVisible();
    expect(snapshot.pageErrors).toEqual([]);
  });

  test("Desktop layout works - no overflow in export panel", async ({ page }) => {
    const snapshot = attachObservability(page);
    await loginAsAdmin(page);
    await openExportTab(page);
    const metrics = await page.locator("#panel-export").evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(metrics.scrollWidth - metrics.clientWidth).toBeLessThanOrEqual(1);
    expect(snapshot.pageErrors).toEqual([]);
  });

  test("Mobile layout works - no overflow in export panel", async ({ page }) => {
    const snapshot = attachObservability(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(page);
    await openExportTab(page);
    const metrics = await page.locator("#panel-export").evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(metrics.scrollWidth - metrics.clientWidth).toBeLessThanOrEqual(1);
    expect(snapshot.pageErrors).toEqual([]);
  });

  test("Mobile sidebar tab is accessible", async ({ page }) => {
    const snapshot = attachObservability(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(page);
    const exportTab = page.getByRole("tab", { name: /export/i });
    await expect(exportTab).toBeVisible();
    await exportTab.click();
    await expect(page.getByLabel("Select event")).toBeVisible();
    expect(snapshot.pageErrors).toEqual([]);
  });
});
