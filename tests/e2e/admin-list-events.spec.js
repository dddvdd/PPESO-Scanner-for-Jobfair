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

test("list all event cards and their pre-registrant counts", async ({ page }) => {
  await loginAsAdmin(page);
  await page.waitForSelector(".event-card", { timeout: 15_000 });
  
  const cards = page.locator(".event-card");
  const count = await cards.count();
  console.log(`Total event cards: ${count}`);
  
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const title = await card.locator("h2").textContent();
    const meta = await card.locator(".event-meta").first().textContent();
    const preRegCount = await card.locator(".category-table-total td:nth-child(2)").textContent().catch(() => "N/A");
    const checkinCount = await card.locator(".category-table-total td:nth-child(3)").textContent().catch(() => "N/A");
    console.log(`Card ${i}: "${title}" | ${meta} | PreReg: ${preRegCount} | Checkins: ${checkinCount}`);
  }
});
