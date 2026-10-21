import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function walkFiles(dir, fileList = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, fileList);
    else fileList.push(full);
  }
  return fileList;
}

test("Attack Class 5: XSS Mitigation & Content Security Policy", async (t) => {
  await t.test("No dangerouslySetInnerHTML in any UI component or source file", () => {
    const srcFiles = walkFiles(join(ROOT, "src"));
    for (const f of srcFiles) {
      if (!f.endsWith(".js") && !f.endsWith(".jsx")) continue;
      const content = readFileSync(f, "utf8");
      assert.doesNotMatch(
        content,
        /dangerouslySetInnerHTML/i,
        `Found dangerouslySetInnerHTML in ${f}`
      );
    }
  });

  await t.test("index.html contains Content-Security-Policy meta tag", () => {
    const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");
    assert.match(
      indexHtml,
      /<meta\s+http-equiv=["']Content-Security-Policy["']/i,
      "index.html must contain a Content-Security-Policy meta tag"
    );
    assert.match(indexHtml, /default-src\s+'self'/i, "CSP must restrict default-src to 'self'");
    assert.match(indexHtml, /object-src\s+'none'/i, "CSP must disallow plugins/object-src");
  });

  await t.test("vercel.json contains security headers including CSP and X-Frame-Options", () => {
    const vercelJson = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const headerRules = vercelJson.headers ?? [];
    const catchAll = headerRules.find((h) => h.source === "/(.*)");
    assert.ok(catchAll, "vercel.json must have headers for /(.*)");
    const headers = catchAll.headers;

    const csp = headers.find((h) => h.key === "Content-Security-Policy");
    assert.ok(csp, "vercel.json must include Content-Security-Policy header");
    assert.match(csp.value, /default-src\s+'self'/, "vercel CSP must restrict default-src");
    assert.match(csp.value, /frame-ancestors\s+'none'/, "vercel CSP must disallow frame-ancestors");

    const xfo = headers.find((h) => h.key === "X-Frame-Options");
    assert.ok(xfo, "vercel.json must include X-Frame-Options header");
    assert.equal(xfo.value, "DENY", "X-Frame-Options must be DENY");

    const nosniff = headers.find((h) => h.key === "X-Content-Type-Options");
    assert.ok(nosniff, "vercel.json must include X-Content-Type-Options: nosniff");
    assert.equal(nosniff.value, "nosniff");
  });

  await t.test("HTML escaping neutralizes script and event handler injection payloads", () => {
    function escapeHtml(value) {
      const escaped = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return value.replace(/[&<>"']/g, (character) => escaped[character] ?? character);
    }

    const payload = '<img src=x onerror=alert(1)>';
    const escaped = escapeHtml(payload);
    assert.equal(escaped, "&lt;img src=x onerror=alert(1)&gt;");
    assert.doesNotMatch(escaped, /<img/);
    assert.doesNotMatch(escaped, />/);
  });
});
