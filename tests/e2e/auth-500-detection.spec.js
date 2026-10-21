import { test, expect } from "@playwright/test";

const TOKEN_ENDPOINT = "/auth/v1/token";
const TOKEN_GRANT = "grant_type=password";

/**
 * Auth 500 detection.
 *
 * Watch every response on /auth/v1/token?grant_type=password and fail if the
 * server returns HTTP 500. A normal auth failure (HTTP 400/401) is allowed
 * and must not be classified as an Auth 500.
 */
test("/auth/v1/token?grant_type=password must not return HTTP 500", async ({ page }) => {
  const tokenResponses = [];
  const consoleErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Filter benign development-only noise (React DevTools etc.).
      if (/React DevTools|Download the React DevTools/i.test(text)) return;
      consoleErrors.push(text);
    }
  });

  page.on("response", (response) => {
    const url = response.url();
    if (url.includes(TOKEN_ENDPOINT) && url.includes(TOKEN_GRANT)) {
      tokenResponses.push({
        status: response.status(),
        url,
      });
    }
  });

  // Exercise the login flow at least once so a token request actually fires.
  // Use intentionally-invalid credentials — we are verifying the response
  // status, not the auth result. A 400/401 here is the expected, non-failing
  // outcome of the bad credentials.
  await page.goto("/staff/login");
  await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();
  await page.getByLabel("Email").fill(`e2e-probe-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("probe-only-not-a-real-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for either an error alert or for the network to settle.
  await Promise.race([
    page
      .locator('[role="alert"]', { hasText: /invalid|credentials|sign-in/i })
      .waitFor({ timeout: 10_000 }),
    page.waitForLoadState("networkidle", { timeout: 10_000 }),
  ]);

  // At least one token request must have been observed.
  expect(tokenResponses.length, "expected an /auth/v1/token request").toBeGreaterThan(0);

  const serverErrors = tokenResponses.filter((r) => r.status === 500);
  expect(
    serverErrors,
    `Auth endpoint returned HTTP 500 during login: ${JSON.stringify(serverErrors)}`
  ).toEqual([]);

  // 400/401 responses are expected on bad credentials and must NOT fail the test.
  for (const r of tokenResponses) {
    expect([200, 400, 401]).toContain(r.status);
  }

  // Fail on relevant runtime console errors only (no secrets, no tokens).
  const sensitive = consoleErrors.filter((e) => /password|token|secret|bearer/i.test(e));
  expect(sensitive, "console output leaked sensitive terms").toEqual([]);
});