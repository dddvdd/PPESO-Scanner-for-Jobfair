import { test, expect } from "@playwright/test";
import { loginAsStaff, attachObservability, assertNoHorizontalOverflow } from "./_helpers.js";

const SHOTS = "screenshots/staff-scanner";

test.describe("Staff Scanner UI/UX (desktop)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("loads after login, renders scan controls, search section, and sign-out", async ({ page }) => {
    const obs = attachObservability(page);
    await loginAsStaff(page);

    await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();

    // Main scan action.
    await expect(page.getByRole("button", { name: /scan again/i })).toBeVisible();

    // Search / registrants area exists.
    await expect(page.getByPlaceholder(/search all registrants/i)).toBeVisible();

    // Staff actions live in the hamburger menu before the main heading.
    const menuToggle = page.getByRole("button", { name: /open staff actions/i });
    await expect(menuToggle).toBeVisible();
    await menuToggle.click();
    await expect(page.getByRole("link", { name: /interview status/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /account/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();

    // Signed-in email visible in the kicker.
    const email = process.env.E2E_STAFF_EMAIL ?? "";
    if (email) {
      await expect(page.locator(".sc-kicker")).toContainText(email);
    }

    await page.screenshot({ path: `${SHOTS}-desktop.png`, fullPage: true });
    expect(obs.pageErrors).toEqual([]);
    // No console errors except benign Vite HMR warnings, which we don't capture.
  });
});

test.describe("Staff Scanner UI/UX (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders without horizontal overflow at mobile width", async ({ page }) => {
    const obs = attachObservability(page);
    await loginAsStaff(page);

    await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.screenshot({ path: `${SHOTS}-mobile.png`, fullPage: true });
    expect(obs.pageErrors).toEqual([]);
  });
});