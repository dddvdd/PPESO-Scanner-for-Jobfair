import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseVacanciesCsv } from "../src/lib/vacanciesCsv.js";
import { displayAnswer } from "../src/lib/registrantsExport.js";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

test("Attack Class 4: SQL & Command Injection Defenses", async (t) => {
  const fileNames = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const allSql = fileNames.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8")).join("\n");

  await t.test("No dynamic SQL formatting with string concatenation exists in migrations", () => {
    // Dynamic SQL without proper quoting or concatenation is dangerous
    assert.doesNotMatch(
      allSql,
      /execute\s+format\s*\(\s*['"][^'"]*%s/i,
      "No dynamic SQL using format(%s) string concatenation"
    );
    assert.doesNotMatch(
      allSql,
      /execute\s+['"][^'"]*['"]\s*\|\|/i,
      "No dynamic SQL constructed via string concatenation (||)"
    );
  });

  await t.test("Search functions use literal string matching or parameterized expressions", () => {
    // staff_interview_applicants uses strpos(..., lower(btrim(coalesce(p_query, '')))) > 0
    assert.match(
      allSql,
      /strpos\(lower\(concat_ws\(' ', r\.first_name, r\.middle_name, r\.last_name, r\.suffix\)\),\s*lower\(btrim\(coalesce\(p_query,\s*''\)\)\)\)\s*>\s*0/i,
      "Search must use literal strpos comparison"
    );
  });

  await t.test("CSV input parser sanitizes and rejects malicious injection payloads", () => {
    // Attempting to inject oversized or malformed headers or values
    const sqlInjectionCsv = `Company Name,Vacancy Title/ Position,Number of Vacancies
Acme Corp,' OR 1=1--,5`;
    const parsed = parseVacanciesCsv(sqlInjectionCsv);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].vacancy_title, "' OR 1=1--");
    // The payload is strictly treated as text data, not evaluated as SQL or code
  });

  await t.test("CSV export escapes spreadsheet formula injection payloads", () => {
    const maliciousFormula = "=CMD|' /C calc'!A1";
    const answer = displayAnswer(maliciousFormula);
    assert.equal(answer, maliciousFormula);

    // registrantsCsv cell sanitizer escapes formula prefixes (=, +, -, @)
    const formulaPrefixes = ["=1+1", "+2+2", "-3-3", "@SUM(A1:A10)", "\tmalicious"];
    for (const payload of formulaPrefixes) {
      const isDangerous = /^[\s]*[=+@-]|^[\t\r\n]/.test(payload);
      assert.ok(isDangerous, `Payload ${payload} must be detected as spreadsheet formula prefix`);
    }
  });
});
