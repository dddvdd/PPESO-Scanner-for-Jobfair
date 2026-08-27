import pg from "pg";
import { loadEnv } from "./lib/env.mjs";

const env = loadEnv();
if (!env.dbUrl) {
  console.error("OBJECTS_BLOCKED: SUPABASE_DB_URL not set in this session.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const problems = [];

async function expectTrue(label, sql, params = []) {
  const { rows } = await client.query(sql, params);
  if (!rows.length || !Object.values(rows[0])[0]) problems.push(label);
  return rows;
}

// Extensions
await expectTrue("extension pgcrypto missing", "select exists(select 1 from pg_extension where extname='pgcrypto') as ok");

// Tables + RLS flags
{
  const tables = ["profiles", "events", "forms", "form_fields", "registrations", "check_ins"];
  const { rows } = await client.query(
    "select tablename, rowsecurity from pg_tables where schemaname='public' and tablename = any($1)",
    [tables]
  );
  for (const t of tables) {
    const row = rows.find((r) => r.tablename === t);
    if (!row) problems.push(`table public.${t} missing`);
    else if (!row.rowsecurity) problems.push(`RLS not enabled on public.${t}`);
  }
}

// Functions/RPCs
{
  const fns = [
    "register_applicant", "retrieve_ticket", "perform_check_in", "staff_lookup",
    "is_admin", "is_staff", "my_role", "set_updated_at", "handle_new_user",
  ];
  const { rows } = await client.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname = any($1)`,
    [fns]
  );
  for (const f of fns) {
    if (!rows.some((r) => r.proname === f)) problems.push(`function public.${f} missing`);
  }
}

// Triggers
{
  const { rows: upd } = await client.query(
    `select event_object_table as tbl from information_schema.triggers
     where trigger_schema='public' and trigger_name='set_updated_at'`
  );
  for (const t of ["profiles", "events", "forms", "form_fields", "registrations"]) {
    if (!upd.some((r) => r.tbl === t)) problems.push(`updated_at trigger missing on ${t}`);
  }
  const { rows: newUser } = await client.query(
    `select 1 from information_schema.triggers
     where trigger_schema='auth' and trigger_name='on_auth_user_created' limit 1`
  );
  if (!newUser.length) problems.push("auth user -> profile trigger missing");
}

// Uniqueness / integrity indexes and constraints
await expectTrue("unique registration_number missing",
  `select exists(select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='registrations' and c.contype='u'
      and c.conname like '%registration_number%')`);
await expectTrue("unique ticket_token missing",
  `select exists(select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='registrations' and c.contype='u'
      and c.conname like '%ticket_token%')`);
{
  const { rows } = await client.query(
    `select indexdef from pg_indexes
     where schemaname='public' and indexname in ('registrations_event_email_key','check_ins_one_success_per_registration')`
  );
  const dupGuard = rows.find((r) => r.indexdef.includes("registrations_event_email_key"));
  const oneSuccess = rows.find((r) => r.indexdef.includes("check_ins_one_success_per_registration"));
  if (!dupGuard || !/lower\(email\)/i.test(dupGuard.indexdef)) problems.push("duplicate-registration guard index missing/wrong");
  if (!oneSuccess || !/where\s+\(?status\)?\s*=\s*'success'/i.test(oneSuccess.indexdef)) {
    problems.push("one-successful-check-in partial index missing/wrong");
  }
}
await expectTrue("composite (event_id, form_id) FK missing",
  `select exists(select 1 from pg_constraint where conname='registrations_event_form_pairing' and contype='f')`);

await client.end();

if (problems.length > 0) {
  console.error("OBJECTS INVALID:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("OBJECTS_VERIFIED");
