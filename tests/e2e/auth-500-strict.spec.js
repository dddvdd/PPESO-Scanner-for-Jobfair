import { test, expect } from "@playwright/test";
import { gotoLogin, attachObservability } from "./_helpers.js";

const TOKEN_ENDPOINT = "/auth/v1/token";
const TOKEN_GRANT = "grant_type=password";

/**
 * Strict Auth 500 detection.
 *
 * - Listens on EVERY response during the entire login attempt.
 * - Fails the test if /auth/v1/token?grant_type=password returns HTTP 500.
 * - HTTP 400/401 (normal auth rejection) is expected and tolerated.
 * - Captures and reports console errors and failed requests without
 *   leaking secrets (tokens/passwords/JWTs are filtered).
 */
test("/auth/v1/token?grant_type=password must not return HTTP 500", async ({ page }) => {
  const tokenResponses = [];
  const obs = attachObservability(page);

  page.on("response", (response) => {
    const url = response.url();
    if (url.includes(TOKEN_ENDPOINT) && url.includes(TOKEN_GRANT)) {
      tokenResponses.push({ status: response.status(), url: response.url() });
    }
  });

  // Use intentionally-bad credentials — we want to confirm the network layer
  // is healthy and the failure is a normal auth rejection.
  await gotoLogin(page);
  await page.getByLabel("Email").fill(`e2e-probe-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("probe-only-not-a-real-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for either the error alert or a network settle.
  await Promise.race([
    page
      .locator('[role="alert"]')
      .first()
      .waitFor({ timeout: 10_000 }),
    page.waitForLoadState("networkidle", { timeout: 10_000 }),
  ]);

  expect(
    tokenResponses.length,
    "expected at least one /auth/v1/token request during the login attempt"
  ).toBeGreaterThan(0);

  const fives = tokenResponses.filter((r) => r.status === 500);
  expect(fives, `Auth endpoint returned HTTP 500: ${JSON.stringify(fives)}`).toEqual([]);

  for (const r of tokenResponses) {
    expect([200, 400, 401, 422]).toContain(r.status);
  }

  // No uncaught page errors expected for this flow.
  expect(obs.pageErrors).toEqual([]);

  // The browser logs the rejected network response as a console.error. That
  // is expected for an invalid-credentials attempt (HTTP 400 from Supabase)
  // and must NOT fail the test. We tolerate that single benign message and
  // flag anything else.
  const sanitize = (text) =>
    String(text).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<jwt>")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <token>")
      .replace(/password=[^\s&]+/gi, "password=<redacted>");
  const isBenignAuthRejection = (text) =>
    /Failed to load resource: the server responded with a status of (400|422)/i.test(text);
  const unexpectedConsoleErrors = obs.consoleErrors
    .map(sanitize)
    .filter((t) => !isBenignAuthRejection(t));
  expect(
    unexpectedConsoleErrors,
    `unexpected console errors: ${JSON.stringify(unexpectedConsoleErrors)}`
  ).toEqual([]);
  expect(obs.failedRequests.map(sanitize)).toEqual([]);
});