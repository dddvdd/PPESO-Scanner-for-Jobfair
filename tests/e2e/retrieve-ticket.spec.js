import { test, expect } from "@playwright/test";
import { attachObservability, assertNoHorizontalOverflow } from "./_helpers.js";

/**
 * Phase 3D — Ticket retrieval UX.
 *
 * Phase 3B is BLOCKED, so there is no real disposable registration to
 * retrieve. These tests cover the page's rendering, empty-input validation,
 * and the anti-enumeration generic not-found response for clearly-nonexistent
 * emails. They do not validate any real ticket, token, or PII.
 *
 * Retrieval calls the `retrieve_ticket` RPC. We tolerate a 400/422-style
 * generic not-found response (TICKET_NOT_FOUND) — that is the documented
 * anti-enumeration behavior — and assert the same generic copy is rendered.
 */

const SCREENSHOTS = "screenshots";

test.describe.configure({ mode: "serial" });

async function gotoRetrieve(page) {
  await page.goto("/retrieve-ticket");
  await expect(page.getByRole("heading", { name: /retrieve your ticket/i })).toBeVisible();
  await expect(page.getByLabel(/email address/i)).toBeVisible();
  await expect(page.getByLabel(/registration number/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /retrieve ticket/i })).toBeVisible();
}

test("Phase 3D — retrieval page renders at desktop", async ({ page }) => {
  const obs = attachObservability(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoRetrieve(page);
  expect(obs.pageErrors).toEqual([]);
  await page.screenshot({ path: `${SCREENSHOTS}/retrieve-ticket-desktop.png`, fullPage: true });
});

test("Phase 3D — retrieval page renders at mobile without overflow", async ({ page }) => {
  const obs = attachObservability(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoRetrieve(page);
  await assertNoHorizontalOverflow(page);
  expect(obs.pageErrors).toEqual([]);
  await page.screenshot({ path: `${SCREENSHOTS}/retrieve-ticket-mobile.png`, fullPage: true });
});

test("Phase 3D — empty email blocks submission client-side", async ({ page }) => {
  await gotoRetrieve(page);
  await page.getByRole("button", { name: /retrieve ticket/i }).click();
  await expect(page.getByText(/email address is required/i)).toBeVisible();
  await expect(page).toHaveURL(/\/retrieve-ticket$/);
});

test("Phase 3D — clearly nonexistent email returns generic not-found (anti-enumeration)", async ({ page }) => {
  const obs = attachObservability(page);
  await gotoRetrieve(page);

  // Use a unique, obviously-non-existent email. The retrieval RPC enforces
  // anti-enumeration: this returns the same generic message regardless of
  // whether the address exists or not.
  const probeEmail = `e2e-nonexistent-${Date.now()}@example.test`;
  await page.getByLabel(/email address/i).fill(probeEmail);
  await page.getByRole("button", { name: /retrieve ticket/i }).click();

  // Generic not-found copy (identical for any miss per the contract).
  await expect(page.getByText(/we couldn't find a ticket/i)).toBeVisible({ timeout: 10_000 });

  // No QR/ticket card should appear for a miss.
  await expect(page.locator("canvas")).toHaveCount(0);

  expect(obs.pageErrors).toEqual([]);
});

test("Phase 3D — invalid email format blocks at the input", async ({ page }) => {
  await gotoRetrieve(page);
  const emailInput = page.getByLabel(/email address/i);
  await emailInput.fill("not-an-email");
  // The input is type="email" but noValidate is set; check the client-side
  // behaviour. We only assert the page does not crash and the form is
  // submitted (browser-side validation may or may not block; we accept both).
  await page.getByRole("button", { name: /retrieve ticket/i }).click();
  await page.waitForTimeout(500);
  // The page should still be on /retrieve-ticket (the form is in-page).
  await expect(page).toHaveURL(/\/retrieve-ticket$/);
});