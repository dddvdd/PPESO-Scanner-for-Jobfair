// Offline browser verification; all Auth/Data API responses are local fixtures.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const origin = "http://127.0.0.1:5187";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5187, strictPort: true },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(origin),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("local-test-public-key"),
  },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let mustChangePassword = true;
let role = "staff";
let changes = 0;
let setupCalls = 0;
const initial = ["pass",123].join("");
const errors = [];
const outbound = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin) { outbound.push(url.origin); await route.abort(); return; }
  const reply = value => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
  if (url.pathname === "/auth/v1/token") return reply({
    access_token: "local-test-access", refresh_token: "local-test-refresh", token_type: "bearer", expires_in: 3600,
    user: { id: "00000000-0000-4000-8000-000000000029", email: "scanner@tuguegarao.peso", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
  });
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const rpc = url.pathname.split("/").pop();
    if (rpc === "my_role") return reply(role);
    if (rpc === "staff_account_status") return reply({ municipality: "Tuguegarao City", must_change_password: mustChangePassword });
    if (rpc === "staff_change_initial_password") {
      const body = request.postDataJSON();
      assert.equal(body.p_current_password, initial);
      assert.equal(body.p_new_password, "NewMunicipalPassword42");
      changes++; mustChangePassword = false;
      return reply({ status: "ok" });
    }
    if (rpc === "staff_lookup") return reply({ status: "ok", results: [] });
    if (rpc === "admin_list_profiles") return reply([]);
    if (rpc === "admin_create_municipal_scanners") {
      assert.equal(request.postDataJSON().p_initial_password, initial);
      setupCalls++;
      return reply({ status: "ok", accounts: [{ email: "scanner@tuguegarao.peso", municipality: "Tuguegarao City", status: "created" }] });
    }
    return reply({ status: "ok", events: [] });
  }
  if (url.pathname.startsWith("/rest/v1/")) return reply([]);
  return route.continue();
});
try {
  await page.goto(`${origin}/staff/login`);
  await page.getByLabel("Email", { exact: true }).fill("scanner@tuguegarao.peso");
  await page.getByLabel("Password", { exact: true }).fill(initial);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/staff/account");
  await page.getByText("Change your temporary password before accessing events or scanning tickets.").waitFor();
  for (const path of ["/staff/scanner", "/staff/interviews", "/staff/walk-ins"]) {
    await page.goto(origin + path);
    await page.waitForURL("**/staff/account");
    await page.getByRole("heading", { name: "Change password", exact: true }).waitFor();
  }
  await page.reload();
  await page.getByRole("heading", { name: "Change password", exact: true }).waitFor();
  mkdirSync("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/municipal-scanner-first-login.png" });
  const overflow = await page.evaluate(() => ({
    width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll("main *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1)
      .map(el => ({ tag:el.tagName, className:el.className, width:el.getBoundingClientRect().width })).slice(0,8),
  }));
  assert.deepEqual(overflow.elements,[],"Account form fits the mobile viewport");
  await page.getByLabel("Current password", { exact: true }).fill(initial);
  await page.getByLabel("New password", { exact: true }).fill("NewMunicipalPassword42");
  await page.getByLabel("Confirm new password", { exact: true }).fill("NewMunicipalPassword42");
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await page.getByText("Password updated. Use your new password next time you sign in.").waitFor();
  await page.getByRole("link", { name: "Back to scanner", exact: true }).click();
  await page.waitForURL("**/staff/scanner");
  assert.equal(changes,1);
  role = "admin";
  await page.goto(`${origin}/admin?tab=staff`);
  await page.getByLabel("Temporary password for new scanners", { exact: true }).fill(initial);
  await page.getByRole("button", { name: "Create 29 municipal scanners", exact: true }).click();
  await page.getByText("Tuguegarao City: scanner@tuguegarao.peso — created").waitFor();
  assert.equal(setupCalls,1);
  await page.goto(`${origin}/admin`);
  await page.getByRole("button", { name: "+ Create your first event", exact: true }).click();
  assert.equal(await page.locator("#ev-municipality option").count(),30);
  await page.getByLabel("Municipality / City", { exact: true }).selectOption("Tuguegarao City");
  assert.deepEqual(errors,[]);
  assert.deepEqual(outbound,[]);
  console.log("PASS: offline browser login, forced redirects, refresh, password change, scanner access, admin provisioning and 29 municipality options.");
} finally {
  await browser.close();
  await server.close();
}
