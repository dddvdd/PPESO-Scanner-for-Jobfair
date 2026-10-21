import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

test("Attack Class 3: Row Level Security (RLS) Enforcement", async (t) => {
  const fileNames = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const allSql = fileNames.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8")).join("\n");

  await t.test("No migration ever disables RLS or drops policies", () => {
    assert.doesNotMatch(allSql, /disable\s+row\s+level\s+security/i, "RLS must never be disabled");
    assert.doesNotMatch(allSql, /drop\s+policy/i, "RLS policies must never be dropped");
  });

  const allTables = [
    "profiles",
    "events",
    "forms",
    "form_fields",
    "registrations",
    "check_ins",
    "interview_statuses",
    "vacancies",
    "interview_results",
    "registration_correction_tokens",
    "registration_correction_email_webhook_events",
    "event_weather_cache",
  ];

  await t.test("All application tables have RLS explicitly enabled", () => {
    for (const table of allTables) {
      const rlsPattern = new RegExp(
        `alter\\s+table\\s+(?:public\\.)?${table}\\s+enable\\s+row\\s+level\\s+security`,
        "i"
      );
      assert.match(
        allSql,
        rlsPattern,
        `Table public.${table} must have Row Level Security enabled`
      );
    }
  });

  await t.test("Protected tables have NO anonymous read or write policies", () => {
    const protectedTables = [
      "registrations",
      "check_ins",
      "interview_results",
      "interview_statuses",
      "registration_correction_tokens",
      "event_weather_cache",
    ];
    for (const table of protectedTables) {
      const anonPolicyPattern = new RegExp(
        `create\\s+policy[\\s\\S]{1,120}on\\s+(?:public\\.)?${table}[\\s\\S]{1,80}to\\s+anon`,
        "i"
      );
      assert.doesNotMatch(
        allSql,
        anonPolicyPattern,
        `Table public.${table} must not have permissive anon policies`
      );
    }
  });
});
