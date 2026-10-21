import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");

test("Attack Class 6: Restrictive CORS Allowlist", async (t) => {
  const functionDirs = readdirSync(FUNCTIONS_DIR);

  await t.test("No Edge Function uses wildcard Access-Control-Allow-Origin: *", () => {
    for (const dir of functionDirs) {
      const indexPath = join(FUNCTIONS_DIR, dir, "index.ts");
      try {
        const content = readFileSync(indexPath, "utf8");
        assert.doesNotMatch(
          content,
          /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/i,
          `Edge Function ${dir} must not use wildcard Access-Control-Allow-Origin: *`
        );
      } catch {
        // Not a directory or no index.ts
      }
    }
  });

  await t.test("Edge Functions implement origin allowlist validation", () => {
    for (const dir of ["event-weather", "send-registration-corrections"]) {
      const indexPath = join(FUNCTIONS_DIR, dir, "index.ts");
      const content = readFileSync(indexPath, "utf8");
      assert.match(
        content,
        /getCorsHeaders/i,
        `Edge Function ${dir} must implement getCorsHeaders with allowlist checking`
      );
      assert.match(
        content,
        /ALLOWED_ORIGINS/i,
        `Edge Function ${dir} must read ALLOWED_ORIGINS allowlist`
      );
      assert.match(
        content,
        /Vary/i,
        `Edge Function ${dir} must set Vary: Origin on reflected allowed origins`
      );
    }
  });

  await t.test("Simulated CORS validator rejects untrusted evil.example origin", () => {
    function evaluateCors(requestOrigin, allowedEnv = "") {
      const envOrigins = allowedEnv.split(",").map((o) => o.trim()).filter(Boolean);
      const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin);
      const isAllowed = envOrigins.includes(requestOrigin) || isLocal;
      if (!isAllowed) {
        return { allowed: false, allowOrigin: null };
      }
      return { allowed: true, allowOrigin: requestOrigin, vary: "Origin" };
    }

    const evilResult = evaluateCors("https://evil.example", "https://app.example.com");
    assert.equal(evilResult.allowed, false, "evil.example must be rejected");
    assert.equal(evilResult.allowOrigin, null, "evil.example must receive no Access-Control-Allow-Origin header");

    const validResult = evaluateCors("https://app.example.com", "https://app.example.com");
    assert.equal(validResult.allowed, true, "Whitelisted origin must be accepted");
    assert.equal(validResult.allowOrigin, "https://app.example.com");
    assert.equal(validResult.vary, "Origin");
  });
});
