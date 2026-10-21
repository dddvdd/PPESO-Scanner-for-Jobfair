import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

test("Attack Class 2: Broken Access Control & IDOR / BOLA Prevention", async (t) => {
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");

  await t.test("Profiles table has strict IDOR prevention (own-row policy auth.uid() = id)", () => {
    assert.match(
      migrations,
      /create policy\s+["']?profiles_select_own["']?\s+on\s+public\.profiles\s+for\s+select\s+using\s*\(\s*auth\.uid\(\)\s*=\s*id\s*\)/i,
      "Profiles table must enforce auth.uid() = id for user select"
    );
    assert.match(
      migrations,
      /create policy\s+["']?profiles_update_own["']?\s+on\s+public\.profiles\s+for\s+update\s+using\s*\(\s*auth\.uid\(\)\s*=\s*id\s*\)/i,
      "Profiles table must enforce auth.uid() = id for user update"
    );
  });

  await t.test("Staff and Admin functions reject unauthorized callers with forbidden status or 42501", () => {
    // Check that sensitive RPC functions explicitly guard against unauthorized callers
    assert.match(
      migrations,
      /create or replace function public\.perform_check_in[\s\S]{1,500}if auth\.uid\(\) is null or not public\.is_staff\(\) then[\s\S]{1,100}return jsonb_build_object\('status', 'forbidden'\)/i,
      "perform_check_in must return forbidden status on unauthorized caller"
    );
    assert.match(
      migrations,
      /create or replace function public\.staff_interview_applicants[\s\S]{1,500}if auth\.uid\(\) is null or not public\.is_staff\(\) then[\s\S]{1,100}raise exception 'UNAUTHORIZED' using errcode = '42501'/i,
      "staff_interview_applicants must raise 42501 on unauthorized caller"
    );
    assert.match(
      migrations,
      /revoke execute on function public\.staff_lookup\(text\) from public, anon/i,
      "staff_lookup must revoke execute from anon and public"
    );
  });

  await t.test("Direct registration mutations are forbidden from client roles", () => {
    // Anon or authenticated non-admin cannot directly write to registrations
    assert.doesNotMatch(
      migrations,
      /create policy[\s\S]{1,100}on public\.registrations\s+for\s+(insert|update|delete)\s+to\s+(anon|authenticated)\s+using\s*\(\s*true\s*\)/i,
      "Direct writes to registrations must never be permitted to anon or authenticated"
    );
  });

  await t.test("Admin operations require public.is_admin() check", () => {
    assert.match(
      migrations,
      /create or replace function public\.admin_create_user[\s\S]{1,500}if not public\.is_admin\(\) then/i,
      "admin_create_user must enforce is_admin()"
    );
    assert.match(
      migrations,
      /create or replace function public\.admin_set_password[\s\S]{1,500}if not public\.is_admin\(\) then/i,
      "admin_set_password must enforce is_admin()"
    );
    assert.match(
      migrations,
      /create or replace function public\.admin_delete_user[\s\S]{1,500}if not public\.is_admin\(\) then/i,
      "admin_delete_user must enforce is_admin()"
    );
  });
});
