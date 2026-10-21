import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".git", ".jobseeker-update", ".kilo"]);

function walkFiles(dir, fileList = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, fileList);
    else fileList.push(full);
  }
  return fileList;
}

test("Attack Class 1: No hardcoded secrets in source files or client bundle", async (t) => {
  await t.test(".gitignore properly ignores environment files", () => {
    assert.ok(existsSync(join(ROOT, ".gitignore")), ".gitignore must exist");
    const gi = readFileSync(join(ROOT, ".gitignore"), "utf8");
    assert.match(gi, /^\.env$/m, ".gitignore must ignore .env");
  });

  await t.test(".env.example contains only placeholders, no real secrets", () => {
    assert.ok(existsSync(join(ROOT, ".env.example")), ".env.example must exist");
    const ex = readFileSync(join(ROOT, ".env.example"), "utf8");
    assert.doesNotMatch(ex, /eyJ[A-Za-z0-9_-]{30,}/, "No JWT secrets in .env.example");
    assert.doesNotMatch(ex, /\bsk-[a-zA-Z0-9_-]{20,}\b/, "No API keys in .env.example");
  });

  await t.test("client source code in src/ contains no service_role or secret keys", () => {
    const srcFiles = walkFiles(join(ROOT, "src"));
    for (const f of srcFiles) {
      const rel = relative(ROOT, f);
      const text = readFileSync(f, "utf8");
      assert.doesNotMatch(
        text,
        /service_role/i,
        `Forbidden service_role reference in ${rel}`
      );
      assert.doesNotMatch(
        text,
        /SUPABASE_SERVICE/i,
        `Forbidden SUPABASE_SERVICE reference in ${rel}`
      );
      assert.doesNotMatch(
        text,
        /\bsk-[a-zA-Z0-9_-]{20,}\b/,
        `Forbidden API secret key in ${rel}`
      );
    }
  });

  await t.test("built client bundle in dist/ contains no secrets or service keys", () => {
    if (!existsSync(join(ROOT, "dist"))) {
      return; // dist not built yet in this run
    }
    const distFiles = walkFiles(join(ROOT, "dist"));
    for (const f of distFiles) {
      const rel = relative(ROOT, f);
      if (f.endsWith(".map") || f.endsWith(".png") || f.endsWith(".ico")) continue;
      const text = readFileSync(f, "utf8");
      assert.doesNotMatch(
        text,
        /service_role/i,
        `Forbidden service_role reference found in client bundle ${rel}`
      );
      assert.doesNotMatch(
        text,
        /\bsk-[a-zA-Z0-9_-]{20,}\b/,
        `Forbidden API secret key in client bundle ${rel}`
      );
      assert.doesNotMatch(
        text,
        /SUPABASE_SERVICE/i,
        `Forbidden SUPABASE_SERVICE reference in client bundle ${rel}`
      );
    }
  });
});
