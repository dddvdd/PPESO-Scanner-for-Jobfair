import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

test("Attack Class 7: Debug & Administrative Route Protection", async (t) => {
  const appJsx = readFileSync(join(ROOT, "src", "App.jsx"), "utf8");
  const staffRouteJsx = readFileSync(join(ROOT, "src", "components", "StaffRoute.jsx"), "utf8");

  await t.test("No /debug or dev-diagnostic routes exist in production router", () => {
    assert.doesNotMatch(
      appJsx,
      /path=["']\/debug["']/i,
      "The /debug route must not be registered"
    );
    assert.doesNotMatch(
      appJsx,
      /path=["']\/dev["']/i,
      "The /dev route must not be registered"
    );
  });

  await t.test("Unmatched routes fallback to NotFound (404)", () => {
    assert.match(
      appJsx,
      /<Route\s+path=["']\*["']\s+element=\{<NotFound\s*\/>\}/i,
      "Router must catch all unknown routes and render NotFound"
    );
  });

  await t.test("Administrative routes are strictly gated by StaffRoute adminOnly", () => {
    assert.match(
      appJsx,
      /<Route\s+path=["']\/admin["']\s+element=\{\s*<StaffRoute\s+adminOnly>/i,
      "/admin must be wrapped in <StaffRoute adminOnly>"
    );
    assert.match(
      appJsx,
      /<Route\s+path=["']\/admin\/events\/:eventId\/registrants["']\s+element=\{\s*<StaffRoute\s+adminOnly>/i,
      "/admin/events/:eventId/registrants must be wrapped in <StaffRoute adminOnly>"
    );
  });

  await t.test("StaffRoute denies unauthenticated and unauthorized roles (403 / redirect)", () => {
    assert.match(
      staffRouteJsx,
      /if\s*\(!session\)\s*\{\s*return\s*<Navigate\s+to=["']\/staff\/login["']/i,
      "StaffRoute must redirect unauthenticated users to /staff/login"
    );
    assert.match(
      staffRouteJsx,
      /<UnauthorizedPanel\s+adminOnly=\{adminOnly\}\s*\/>/i,
      "StaffRoute must render UnauthorizedPanel for unauthorized accounts"
    );
  });
});
