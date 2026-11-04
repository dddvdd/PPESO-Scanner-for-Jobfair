// Local PostgreSQL integration check. No .env files or external services.
// Start an isolated PostgreSQL server on loopback port 55439 before running.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { MUNICIPALITIES } from "../../src/lib/municipalities.js";

const config = { host: "127.0.0.1", port: 55439, user: "postgres", database: "postgres" };
const control = new pg.Client(config);
await control.connect();
const database = `municipal_scanner_test_${Date.now()}`;
await control.query(`create database ${database}`);
await control.end();
const db = new pg.Client({ ...config, database });
await db.connect();
let checks = 0;
const check = (value, expected, label) => { assert.deepEqual(value, expected, label); checks++; };
const rpc = async (name, params = []) => (await db.query(
  `select public.${name}(${params.map((_, i) => `$${i + 1}`).join(",")}) as result`, params)).rows[0].result;
async function asUser(id, action, role = "authenticated") {
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? ""]);
    return await action();
  } finally { await db.query("rollback"); }
}
async function callAs(id, name, params) {
  // Commit password changes and other authorized writes when needed.
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    const result = await rpc(name, params);
    await db.query("commit");
    return result;
  } catch (error) { await db.query("rollback"); throw error; }
}
try {
  await db.query(`
    do $$ begin
      if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$;
    create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users (
      id uuid primary key, instance_id uuid, aud text, role text, email text unique,
      encrypted_password text, email_confirmed_at timestamptz, confirmation_token text,
      recovery_token text, email_change_token_new text, email_change text,
      raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_sso_user boolean,
      created_at timestamptz, updated_at timestamptz
    );
    create table auth.identities (
      id uuid primary key, user_id uuid references auth.users(id), provider_id text,
      provider text, identity_data jsonb, last_sign_in_at timestamptz,
      created_at timestamptz, updated_at timestamptz, unique(provider, provider_id)
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth,public,extensions to anon,authenticated,service_role;
    alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;
    alter default privileges in schema public grant usage on sequences to anon,authenticated;
    set search_path = public,extensions;
  `);
  const migrations = readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort();
  for (const migration of migrations) {
    try { await db.query(readFileSync(`supabase/migrations/${migration}`, "utf8").replace(/^\uFEFF/, "")); }
    catch (error) { throw new Error(`${migration}: ${error.message}`); }
  }
  console.log(`Applied all ${migrations.length} migrations locally.`);

  const admin = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'local-admin@example.test')", [admin]);
  await db.query("update public.profiles set role='admin' where id=$1", [admin]);
  // The six-character bootstrap value is supplied only to the local test DB.
  const initial = ["pass", 123].join("");
  const created = await callAs(admin, "admin_create_municipal_scanners", [initial]);
  check(created.status, "ok", "admin provisioning succeeds");
  check(created.accounts.length, 29, "exactly 29 scanners");
  check(created.accounts.map(a => a.email).sort(), MUNICIPALITIES.map(a => a.email).sort(), "all requested email names");
  check(created.accounts.every(a => a.status === "created"), true, "all created");
  const { rows: scanners } = await db.query("select p.id,p.municipality,p.must_change_password,u.email from public.profiles p join auth.users u using(id) where p.municipality is not null");
  check(scanners.every(p => p.must_change_password), true, "all first-login flags set");
  check((await db.query("select count(*)::int as n from auth.identities")).rows[0].n, 29, "email identities created");

  const fixtures = new Map();
  for (const municipality of ["Abulug", "Alcala", null]) {
    const event = randomUUID(), form = randomUUID(), registration = randomUUID(), token = randomUUID();
    await db.query("insert into public.events(id,name,status,event_date,municipality) values($1,$2,'published',(now() at time zone 'Asia/Manila')::date,$3)", [event, `${municipality ?? "Unassigned"} event`, municipality]);
    await db.query("insert into public.forms(id,event_id,name,status) values($1,$2,'Test form','published')", [form,event]);
    await db.query("insert into public.form_fields(form_id,field_key,label,field_type) values($1,'local_test','Test','short_text')", [form]);
    await db.query(`insert into public.registrations(id,event_id,form_id,registration_number,ticket_token,first_name,last_name,email,mobile_number)
      values($1,$2,$3,$4,$5,'Test','Applicant',$6,'09123456789')`, [registration,event,form,`LOCAL-${municipality}`,token,`${event}@example.test`]);
    fixtures.set(municipality, { event,form,registration,token });
  }
  const a = fixtures.get("Abulug"), b = fixtures.get("Alcala");
  const abulug = scanners.find(p => p.municipality === "Abulug").id;
  check((await callAs(abulug,"staff_list_events")).status,"forbidden","first login cannot list events");
  check((await callAs(abulug,"perform_check_in",[a.token])).status,"forbidden","first login cannot scan");
  check((await callAs(abulug,"staff_change_initial_password",["wrong", "LocalNewPassword42"])).status,"invalid_password","current password verified");
  check((await callAs(abulug,"staff_change_initial_password",[initial, initial])).status,"weak_password","cannot keep temporary password");
  check((await callAs(abulug,"staff_change_initial_password",[initial,"LocalNewPassword42"])).status,"ok","password change succeeds");
  check((await callAs(abulug,"staff_account_status")).must_change_password,false,"flag cleared atomically");
  check((await db.query("select encrypted_password = extensions.crypt($1,encrypted_password) as matches from auth.users where id=$2", ["LocalNewPassword42",abulug])).rows[0].matches,true,"new password hash works");
  check((await db.query("select encrypted_password = extensions.crypt($1,encrypted_password) as matches from auth.users where id=$2", [initial,abulug])).rows[0].matches,false,"temporary password no longer works");

  for (const [name, params] of [["staff_list_events",[]],["staff_walk_in_events",[]]]) {
    check((await callAs(abulug,name,params)).events.map(e => e.id),[a.event],`${name} only own event`);
  }
  await asUser(abulug, async () => {
    check((await db.query("select id from public.events")).rows.map(r=>r.id),[a.event],"direct event RLS");
    check((await db.query("select id from public.forms")).rows.map(r=>r.id),[a.form],"direct forms RLS");
    check((await db.query("select distinct form_id from public.form_fields")).rows.map(r=>r.form_id),[a.form],"direct form fields RLS");
  });
  for (const column of ["municipality", "must_change_password"]) {
    await assert.rejects(asUser(abulug, () => db.query(`update public.profiles set ${column}=${column} where id=$1`,[abulug])),{code:"42501"}); checks++;
  }
  check((await callAs(abulug,"staff_lookup",[b.token])).results,[],"foreign exact ticket lookup hidden");
  check((await callAs(abulug,"staff_lookup",[""])).results.length,1,"empty search only own registrants");
  check((await callAs(abulug,"perform_check_in",[b.token])).status,"registration_not_found","foreign QR rejected");
  check((await callAs(abulug,"perform_check_in",[a.token,null,b.event])).status,"forbidden","foreign target event rejected");
  check((await callAs(abulug,"staff_complete_scanner_profile",[b.token,{}])).status,"registration_not_found","foreign profile edits rejected");
  for (const name of ["staff_walk_in_form","staff_event_vacancies"]) {
    check((await callAs(abulug,name,[b.event])).status,"forbidden",`${name} rejects foreign event`);
    check((await callAs(abulug,name,[a.event])).status,"ok",`${name} accepts own event`);
  }
  check((await callAs(abulug,"staff_record_walk_in",[b.event,"Test","Walkin","walkin@example.test","09123456789"])).status,"forbidden","foreign walkin rejected");
  check((await callAs(abulug,"staff_record_walk_in",[a.event,"Test","Walkin","walkin@example.test","09123456789",null,null,a.form,{}])).status,"success","own walkin succeeds");
  check((await callAs(abulug,"perform_check_in",[a.token])).status,"success","own checkin succeeds");
  await db.query("insert into public.check_ins(registration_id,event_id,status) values($1,$2,'success')",[b.registration,b.event]);
  await assert.rejects(callAs(abulug,"staff_save_interview_status",[b.registration,"Company","Job","Qualified",b.event]),{code:"42501"}); checks++;
  await callAs(abulug,"staff_save_interview_status",[a.registration,"Company","Job","Qualified",a.event]);
  await db.query("insert into public.interview_statuses(registration_id,staff_id,company,position,status) values($1,$2,'Legacy','Job','Qualified'),($3,$2,'Foreign','Job','Qualified')",[a.registration,abulug,b.registration]);
  await asUser(abulug,async () => {
    check((await db.query("select registration_id from public.interview_statuses")).rows.map(r=>r.registration_id),[a.registration],"legacy interview reads preserve own municipality");
    check((await db.query("select * from public.staff_interview_applicants()" )).rows.every(r=>r.event_id===a.event),true,"interviews scoped");
    check((await db.query("select * from public.staff_export_interview_results($1)",[a.event])).rows.length,1,"own interview export");
  });
  await assert.rejects(asUser(abulug,()=> db.query("select * from public.staff_export_interview_results($1)",[b.event])),{code:"42501"}); checks++;
  check((await callAs(abulug,"admin_create_municipal_scanners",[initial])).status,"forbidden","staff cannot provision users");
  await assert.rejects(asUser(null,()=>rpc("admin_create_municipal_scanners",[initial]),"anon"),{code:"42501"}); checks++;
  const rerun = await callAs(admin,"admin_create_municipal_scanners",[initial]);
  check(rerun.accounts.every(a=>a.status.startsWith("existing")),true,"rerun skips existing accounts");
  check((await callAs(abulug,"staff_account_status")).must_change_password,false,"rerun preserves changed password state");
  await asUser(null, async () => check((await db.query("select count(*)::int as n from public.events")).rows[0].n,3,"anonymous public event listing preserved"),"anon");
  check((await callAs(admin,"staff_list_events")).events.length,3,"admin retains all events");
  const general = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'general-staff@example.test')",[general]);
  await db.query("update public.profiles set role='staff' where id=$1",[general]);
  check((await callAs(general,"staff_list_events")).events.length,3,"existing general staff retain access");
  for (const scanner of scanners) {
    if (scanner.id !== abulug) {
      check((await callAs(scanner.id,"staff_list_events")).status,"forbidden",`${scanner.municipality}: password gate`);
      check((await callAs(scanner.id,"staff_change_initial_password",[initial,"LocalNewPassword42"])).status,"ok",`${scanner.municipality}: first password change`);
    }
    const event = randomUUID();
    await db.query("insert into public.events(id,name,status,municipality) values($1,'Municipal event','published',$2)",[event,scanner.municipality]);
    await asUser(scanner.id,async () => {
      check((await db.query("select public.staff_can_access_event($1) as allowed",[event])).rows[0].allowed,true,`${scanner.municipality}: own municipality allowed`);
      check((await db.query("select count(*)::int as n from public.events where municipality is distinct from $1",[scanner.municipality])).rows[0].n,0,`${scanner.municipality}: all other municipalities hidden`);
    });
  }
  check((await db.query("select count(*)::int as n from pg_tables where schemaname='public' and not rowsecurity")).rows[0].n,0,"RLS stays enabled on all public tables");
  check((await db.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('staff_account_status','staff_change_initial_password',
      'admin_create_municipal_scanners','staff_can_access_event','staff_can_access_registration','scanner_event_visible')
    and has_function_privilege('anon',p.oid,'EXECUTE')`)).rows[0].n,0,"new privileged RPCs are not anonymous APIs");
  console.log(`PASS: ${checks} municipal scanner integration checks. Loopback DB only; no GoTrue service involved.`);
} finally { await db.end(); }
