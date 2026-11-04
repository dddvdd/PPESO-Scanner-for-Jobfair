import { test, expect } from "@playwright/test";
import { attachObservability, assertNoHorizontalOverflow } from "./_helpers.js";

/**
 * Phase 3C — Registration success / ticket page UX.
 *
 * No real submission is performed (Phase 3B is BLOCKED — see report). We
 *   verify the success page in two ways:
 *
 *   1. Visit /registration/success with no router state — the page must
 *      guide the user to their saved QR or event staff rather than crash.
 *
 *   2. Render the page in the same in-memory state that the production
 *      code receives after a real submission, by pre-seeding
 *      `window.history.state.state` BEFORE the SPA mounts and pointing
 *      at /registration/success. React Router v6 reads that on the
 *      initial render.
 */

const SCREENSHOTS = "screenshots";

const MOCK_SUCCESS_STATE = {
  registrationNumber: "E2E-MOCK-0001",
  ticketToken: "0".repeat(48),
  firstName: "E2E",
  lastName: "Mock",
  eventName: "Mock Job Fair",
};

async function gotoSuccessWithMockState(page) {
  await page.addInitScript((state) => {
    // Run BEFORE the SPA mounts. React Router reads window.history.state
    // on initial render.
    const target = "/registration/success";
    const key = "e2e-" + Math.random().toString(36).slice(2);
    // history.state shape: { usr: <our state>, key, idx }
    window.history.replaceState({ usr: state, key, idx: 0 }, "", target);
  }, MOCK_SUCCESS_STATE);
  await page.goto("/registration/success");
  await expect(page.getByRole("heading", { name: /you're registered/i })).toBeVisible({
    timeout: 15_000,
  });
}

test("Phase 3C — registration success page renders ticket info and QR (desktop)", async ({ page }) => {
  const obs = attachObservability(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoSuccessWithMockState(page);

  // The ticket card shows the registration number, applicant name, and an
  // event label.
  await expect(page.getByText(/E2E-MOCK-0001/)).toBeVisible();
  await expect(page.getByText(/Mock Job Fair/)).toBeVisible();

  const qrImage = page.getByRole("img", { name: "Ticket QR code", exact: true });
  await expect(qrImage).toBeVisible({ timeout: 10_000 });
  await expect(qrImage).toHaveAttribute("src", /^data:image\/png;base64,/);

  await expect(page.getByText(/take a screenshot of your qr ticket/i)).toBeVisible();

  expect(obs.pageErrors).toEqual([]);
  await page.screenshot({ path: `${SCREENSHOTS}/registration-success-desktop.png`, fullPage: true });
});

test("Phase 3C — registration success page renders without horizontal overflow (mobile)", async ({ page }) => {
  const obs = attachObservability(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoSuccessWithMockState(page);
  await assertNoHorizontalOverflow(page);
  expect(obs.pageErrors).toEqual([]);
  await page.screenshot({ path: `${SCREENSHOTS}/registration-success-mobile.png`, fullPage: true });
});

test("Phase 3C — direct entry to success without state shows the recovery path", async ({ page }) => {
  // Hitting /registration/success with no state should NOT crash; it should
  // direct the user to their saved ticket or event staff.
  await page.goto("/registration/success");
  await expect(page.getByText(/no recent confirmation/i)).toBeVisible();
  await expect(page.getByText(/ask event staff to find your registration/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /view published events/i })).toBeVisible();
});
