import { expect } from "@playwright/test";

const STAFF_LOGIN_PATH = "/staff/login";
const STAFF_SCANNER_PATH = "/staff/scanner";
const STAFF_ACCOUNT_PATH = "/staff/account";

export function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it in your local .env (gitignored) before running E2E tests.`
    );
  }
  return value;
}

export const paths = {
  login: STAFF_LOGIN_PATH,
  scanner: STAFF_SCANNER_PATH,
  account: STAFF_ACCOUNT_PATH,
};

export async function gotoLogin(page) {
  await page.goto(STAFF_LOGIN_PATH);
  await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
}

export async function loginAsStaff(page) {
  const email = requireEnv("E2E_STAFF_EMAIL");
  const password = requireEnv("E2E_STAFF_PASSWORD");
  await gotoLogin(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === STAFF_SCANNER_PATH, {
    timeout: 20_000,
  });
  await expect(page.getByRole("heading", { name: /staff check-in/i })).toBeVisible();
}

/**
 * Capture browser-side failures (uncaught exceptions, console errors, failed
 * network requests). The caller is responsible for asserting — this just
 * aggregates a snapshot.
 */
export function attachObservability(page) {
  const snapshot = {
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
  };

  page.on("pageerror", (err) => {
    snapshot.pageErrors.push(String(err?.message ?? err));
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/React DevTools|Download the React DevTools/i.test(text)) return;
    snapshot.consoleErrors.push(text);
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    // Dev-server HMR pings can fail in some environments; not application errors.
    if (/\/@vite\/|\/ws\b|\/__webpack_hmr/.test(url)) return;
    snapshot.failedRequests.push(`${req.method()} ${url} :: ${req.failure()?.errorText ?? "failed"}`);
  });

  return snapshot;
}

/**
 * Assert that the page body does not overflow horizontally. Mobile-viewport
 * safe.
 */
export async function assertNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    metrics.scrollWidth - metrics.clientWidth,
    `horizontal overflow detected (scrollWidth=${metrics.scrollWidth}, clientWidth=${metrics.clientWidth})`
  ).toBeLessThanOrEqual(1);
}