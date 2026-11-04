// Local-only UX checks. All data/auth responses are fixtures; outbound traffic is blocked.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const origin = "http://127.0.0.1:5188";
const eventId = "00000000-0000-4000-8000-000000000001";
const formId = "00000000-0000-4000-8000-000000000002";
const event = { id: eventId, name: "Tuguegarao City Recruitment Event", event_date: "2099-11-18", location: "Tuguegarao City People's Gymnasium", status: "published", description: "Meet participating employers and register for the event." };
const server = await createServer({
  server: { host: "127.0.0.1", port: 5188, strictPort: true },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(origin),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("local-test-public-key"),
  },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const outbound = [];
let eventFailure = false;
let events = [event];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) { outbound.push(url.origin); return route.abort(); }
  const reply = value => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
  if (url.pathname === "/rest/v1/events") {
    if (eventFailure) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Local fixture failure" }) });
    return reply(events);
  }
  if (url.pathname === "/rest/v1/forms") return reply([{ id: formId, event_id: eventId, name: "Jobseeker details", status: "published" }]);
  if (url.pathname === "/auth/v1/token") return reply({
    access_token: "local-test-access", refresh_token: "local-test-refresh", token_type: "bearer", expires_in: 3600,
    user: { id: "00000000-0000-4000-8000-000000000029", email: "admin@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
  });
  if (url.pathname.endsWith("/my_role")) return reply("admin");
  if (url.pathname.endsWith("/staff_account_status")) return reply({ municipality: null, must_change_password: false });
  if (url.pathname.endsWith("/staff_lookup")) return reply({ status: "ok", results: [] });
  if (url.pathname.startsWith("/rest/v1/")) return reply([]);
  return route.continue();
});

async function fits(width, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  assert(dimensions.content <= width, `${label} fits ${width}px: ${JSON.stringify(dimensions)}`);
}

try {
  mkdirSync("screenshots", { recursive: true });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await page.getByRole("heading", { name: event.name }).waitFor();
    await page.locator(".nav-brand-seal").evaluate(img => img.decode());
    assert.match(await page.locator("time").innerText(), /November 18, 2099/);
    await fits(width, "Event list");
    assert.equal(await page.getByRole("dialog").count(), 0, "Closed menu is inaccessible");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("dialog", { name: "Navigation" }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Close menu");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Staff Login");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Close menu");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button", { name: "Menu", exact: true }).getAttribute("aria-expanded"), "false");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Menu");
    await fits(width, "Closed menu");
    await page.screenshot({ path: `screenshots/ppeso-events-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: `Register for ${event.name}` }).click();
    await page.getByLabel("First name", { exact: false }).waitFor();
    await fits(width, "Registration form");
    await page.getByRole("button", { name: "Submit registration" }).click();
    await page.getByText("First name is required.", { exact: true }).waitFor();
    assert.equal(await page.locator("#identity-firstName").getAttribute("aria-describedby"), "identity-firstName-error");
    if (width === 390) await page.screenshot({ path: "screenshots/ppeso-registration-mobile.png", fullPage: true });
    await page.goto(origin + "/staff/login");
    await page.getByRole("heading", { name: "Staff sign in" }).waitFor();
    await fits(width, "Staff login");
    assert.equal(await page.getByLabel("Email", { exact: true }).getAttribute("autocomplete"), "username");
    if (width === 390) await page.screenshot({ path: "screenshots/ppeso-login-mobile.png", fullPage: true });
    console.log(`PASS: ${width}px event list, registration, login, menu focus and overflow`);
  }
  eventFailure = true;
  await page.goto(origin);
  await page.getByRole("button", { name: "Try again" }).waitFor();
  eventFailure = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("heading", { name: event.name }).waitFor();
  events = [];
  await page.reload();
  await page.getByRole("heading", { name: "No events right now." }).waitFor({ state: "attached" });
  await page.locator(".events-empty-art img").evaluate(img => img.decode());
  assert.equal(await page.getByRole("link", { name: "PPESO Cagayan on Facebook" }).getAttribute("href"), "https://www.facebook.com/pesocagayan");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector(".events-empty-art img").currentSrc.endsWith("no-events.png"));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 320, height: 900 });
  await fits(320, "Personalized no-events page");
  await page.screenshot({ path: "screenshots/ppeso-no-events-mobile.png", fullPage: true });
  events = [{ ...event, event_date: null }];
  await page.reload();
  await page.getByText(event.location, { exact: true }).waitFor();
  await page.getByText("To be announced", { exact: true }).waitFor();
  events = [];
  await page.goto(origin + "/staff/login");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page.getByLabel("Password", { exact: true }).fill("LocalFixturePassword42");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin");
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + "/admin");
    await page.getByRole("tab", { name: "Events", exact: true }).waitFor();
    await fits(width, "Admin");
    await page.screenshot({ path: `screenshots/ppeso-admin-${width}.png`, fullPage: true });
    await page.goto(origin + "/staff/scanner");
    await page.getByRole("searchbox", { name: "Search registrants" }).waitFor();
    await fits(width, "Scanner");
    await page.screenshot({ path: `screenshots/ppeso-scanner-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  console.log("PASS: retry, empty state, undated venue, admin/scanner layouts; no browser errors or external requests");
} finally {
  await browser.close();
  await server.close();
}
