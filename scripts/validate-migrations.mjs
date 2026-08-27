import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "supabase", "migrations");
let names;
try {
  names = readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
} catch {
  console.error("supabase/migrations directory not found");
  process.exit(1);
}

if (names.length < 3) {
  console.error(`Expected at least 3 migration files, found ${names.length}: ${names.join(", ")}`);
  process.exit(1);
}

const sql = names.map((n) => readFileSync(join(dir, n), "utf8")).join("\n");

const problems = [];

function need(label, re) {
  if (!re.test(sql)) problems.push(label);
}

// --- Tables ---
need("table public.events missing", /create table public\.events\s*\(/i);
need("table public.forms missing", /create table public\.forms\s*\(/i);
need("table public.form_fields missing", /create table public\.form_fields\s*\(/i);
need("table public.registrations missing", /create table public\.registrations\s*\(/i);
need("table public.check_ins missing", /create table public\.check_ins\s*\(/i);
need("table public.profiles missing", /create table public\.profiles\s*\(/i);

// --- Field types required by the form builder spec ---
for (const t of ["short_text", "long_text", "multi_select", "yes_no"]) {
  need(`field_type enum value ${t} missing`, new RegExp(`['"]${t}['"]`, "i"));
}

// --- Integrity constraints ---
need("unique registration_number missing", /registration_number\s+text\s+not null unique/i);
need("unique ticket_token missing", /ticket_token\s+text\s+not null unique/i);
need("duplicate-email guard index missing", /registrations_event_email_key[\s\S]{0,200}lower\(email\)/i);
need(
  "one-success-per-registration partial unique index missing",
  /create unique index check_ins_one_success_per_registration[\s\S]{0,300}where status = 'success'/i
);
need(
  "(event_id, form_id) composite FK to forms(event_id, id) missing",
  /foreign key \(event_id,\s*form_id\)\s*references public\.forms\s*\(event_id,\s*id\)/i
);
need("profiles role check constraint missing", /role in \('admin',\s*'staff',\s*'pending'\)/i);

// --- RLS enabled on all six tables ---
const rlsCount = (sql.match(/enable row level security/gi) || []).length;
if (rlsCount < 6) problems.push(`RLS enabled on only ${rlsCount}/6 tables`);

// --- Policies use role helpers / auth.uid() ---
need("no is_admin() usage in policies", /is_admin\(\)/i);
need("no auth.uid() usage in policies", /auth\.uid\(\)/i);
need("no admin policy on registrations", /create policy[\s\S]{0,80}on public\.registrations[\s\S]{0,120}is_admin\(\)/i);
need("no policy set on events", /create policy[\s\S]{0,80}on public\.events/i);
need("no policy set on forms", /create policy[\s\S]{0,80}on public\.forms/i);
need("no policy set on form_fields", /create policy[\s\S]{0,80}on public\.form_fields/i);
need("no policy set on profiles", /create policy[\s\S]{0,80}on public\.profiles/i);
need("no policy set on check_ins", /create policy[\s\S]{0,80}on public\.check_ins/i);

// --- RPC functions ---
need("register_applicant function missing", /create or replace function public\.register_applicant/i);
need("retrieve_ticket function missing", /create or replace function public\.retrieve_ticket/i);
need("perform_check_in function missing", /create or replace function public\.perform_check_in/i);
need("staff_lookup function missing", /create or replace function public\.staff_lookup/i);
need(
  "perform_check_in lacks atomic ON CONFLICT DO NOTHING insert",
  /insert into public\.check_ins[\s\S]{0,400}on conflict \(registration_id\)[\s\S]{0,120}do nothing/i
);
need("perform_check_in does not guard with is_staff()", /create or replace function public\.perform_check_in[\s\S]{0,600}is_staff\(\)/i);
need("retrieve_ticket does not require verification input", /retrieve_ticket[\s\S]{0,200}p_verification/i);

// --- Privilege hygiene ---
need("perform_check_in not revoked from anon", /revoke execute on function public\.perform_check_in[\s\S]{0,120}from anon/i);
need("staff_lookup not revoked from anon", /revoke execute on function public\.staff_lookup[\s\S]{0,120}from anon/i);

// --- Forbidden patterns (must NOT match) ---
if (/disable row level security/i.test(sql)) problems.push("RLS is disabled somewhere");
if (/drop policy/i.test(sql)) problems.push("migration drops policies");

if (problems.length > 0) {
  console.error("MIGRATIONS INVALID:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(`MIGRATIONS_VALID (${names.length} migrations checked)`);
