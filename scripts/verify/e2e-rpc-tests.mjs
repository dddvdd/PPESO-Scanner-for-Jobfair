import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { loadEnv } from "./lib/env.mjs";

const env = loadEnv();
const problems = [];
const step = (name, fn) => fn();

function ok(name) {
  console.log(`[ok]   ${name}`);
}
function fail(name, reason) {
  problems.push(`${name}: ${reason}`);
  console.error(`[FAIL] ${name}: ${reason}`);
}

if (!env.url || !env.anonKey || !env.dbUrl) {
  console.error("RPC_TESTS_BLOCKED: need VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (.env) and SUPABASE_DB_URL (session env).");
  process.exit(1);
}

const db = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } });
await db.connect();

const anon = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
const adminApi = env.serviceKey
  ? createClient(env.url, env.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const ts = Date.now();
const password = randomBytes(16).toString("base64url") + "!Aa1";
const adminEmail = `p15-adm-${ts}@verify.local`;
const staffEmail = `p15-stf-${ts}@verify.local`;
let adminUserId = null;
let staffUserId = null;
let fixtureIds = {};

// ---------------------------------------------------------------------------
// Step A — accounts: create -> profile auto-created ('pending') -> promote
// ---------------------------------------------------------------------------
async function ensureUser(email) {
  if (adminApi) {
    const { data, error } = await adminApi.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) return { error };
    return { userId: data.user.id };
  }
  const { data, error } = await anon.auth.signUp({ email, password });
  if (error) return { error };
  return { userId: data.user?.id ?? null, needsSignIn: true };
}

let authBlocked = null;
for (const [email, role] of [[adminEmail, "admin"], [staffEmail, "staff"]]) {
  const res = await ensureUser(email);
  if (res.error) {
    authBlocked = `${email} could not be created (${res.error.message}). Either provide SUPABASE_SERVICE_KEY in the session env, or enable sign-ups/disable email confirmation in the dev project.`;
    break;
  }
  if (!res.userId) {
    // signUp path: fetch id by email via privileged connection
    const { rows } = await db.query("select id from auth.users where email = $1", [email]);
    res.userId = rows[0]?.id ?? null;
  }
  if (role === "admin") adminUserId = res.userId;
  else staffUserId = res.userId;

  // Trigger chain: auth.users -> profiles(role='pending')
  const { rows } = await db.query("select role from public.profiles where id = $1", [res.userId]);
  if (!rows.length) {
    authBlocked = `profile auto-create trigger did not fire for ${email}`;
    break;
  }
  if (rows[0].role !== "pending") {
    fail(`profile default role (${email})`, `expected 'pending', got '${rows[0].role}'`);
  } else {
    ok(`profile created pending for ${role}`);
  }

  const upd = await db.query("update public.profiles set role = $1 where id = $2", [role, res.userId]);
  if (upd.rowCount !== 1) {
    authBlocked = `could not promote ${email}`;
    break;
  }
}

if (!authBlocked) {
  for (const [label, email] of [["admin", adminEmail], ["staff", staffEmail]]) {
    const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      authBlocked = `sign-in failed for ${email}: ${error.message}`;
      break;
    }
    if (label === "admin") globalThis.__adminClient = client;
    else globalThis.__staffClient = client;
  }
}
const adminClient = globalThis.__adminClient ?? null;
const staffClient = globalThis.__staffClient ?? null;

// ---------------------------------------------------------------------------
// Step B — fixtures
// ---------------------------------------------------------------------------
{
  const ev = await db.query(
    `insert into public.events (name, description, event_date, location, status)
     values ('P15 Verify Main', 'fixture', current_date + 30, 'Test Hall', 'published'),
            ('P15 Verify Draft', 'fixture', current_date + 60, 'Hidden Hall', 'draft'),
            ('P15 Verify Other', 'fixture', current_date + 90, 'Other Hall', 'published')
     returning id, name`
  );
  const [evMain, , evOther] = ev.rows;
  const fm = await db.query(
    `insert into public.forms (event_id, name, description, status, version)
     values ($1, 'P15 Form', 'fixture', 'published', 1),
            ($1, 'P15 Form Draft', 'fixture', 'draft', 1)
     returning id`,
    [evMain.id]
  );
  const formId = fm.rows[0].id;

  await db.query(
    `insert into public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
     values
       ($1,'province','Province','dropdown',true,'["Cagayan","Isabela"]',1),
       ($1,'skills','Skills','multi_select',false,'["Cooking","Carpentry"]',2),
       ($1,'newsletter','Subscribe?','yes_no',true,'[]',3),
       ($1,'age','Age','number',true,'[]',4),
       ($1,'birth_date','Birth date','date',false,'[]',5),
       ($1,'notes','Notes','long_text',false,'[]',6),
       ($1,'referral','Heard via','radio',false,'["Facebook","Friend"]',7)`,
    [formId]
  );

  fixtureIds = { evMain: evMain.id, evOther: evOther.id, formId };
}

const baseArgs = {
  p_event_id: fixtureIds.evMain,
  p_form_id: fixtureIds.formId,
};

async function register(overrides = {}) {
  const { data, error } = await anon.rpc("register_applicant", {
    ...baseArgs,
    p_first_name: "Juan",
    p_middle_name: "",
    p_last_name: "Dela Cruz",
    p_suffix: "",
    p_email: overrides.email ?? `p15-applicant-${ts}@verify.local`,
    p_mobile_number: "+63 917 000 0000",
    p_form_data: {
      province: "Cagayan",
      newsletter: "yes",
      age: "29",
      ...(overrides.form_data ?? {}),
    },
    ...overrides.args,
  });
  return { data, error };
}

let validReg = null;

await step("register_applicant", async () => {
  const { data, error } = await register();
  if (error) return fail("valid registration", error.message);
  if (!/^JF\d{2}-\d{6}$/.test(data?.registration_number ?? "")) {
    return fail("valid registration", `bad registration_number ${JSON.stringify(data?.registration_number)}`);
  }
  if (!/^[0-9a-f]{48}$/.test(data?.ticket_token ?? "")) {
    return fail("valid registration", "ticket_token is not a 48-char hex opaque token");
  }
  validReg = data;
  ok("valid registration (unique number + opaque token)");
});

await step("duplicate handling", async () => {
  const { error } = await register();
  if (!error || !String(error.message).includes("DUPLICATE_REGISTRATION")) {
    return fail("duplicate registration", `unexpected result ${JSON.stringify(error)}`);
  }
  const { rows } = await db.query(
    "select count(*)::int as n from public.registrations where event_id=$1 and email=$2",
    [fixtureIds.evMain, `p15-applicant-${ts}@verify.local`]
  );
  if (rows[0].n !== 1) return fail("duplicate registration", `row count ${rows[0].n}`);
  ok("duplicate rejected, exactly one row");
});

await step("validation errors", async () => {
  const cases = [
    [{ args: { p_form_data: { province: "Cagayan", newsletter: "yes" } } }, "MISSING_REQUIRED_FIELD"],
    [{ args: { p_form_data: { province: "Cagayan", newsletter: "yes", age: "abc" } } }, "INVALID_NUMBER"],
    [{ args: { p_form_data: { province: "Mars", newsletter: "yes", age: "30" } } }, "INVALID_CHOICE"],
    [{ args: { p_form_data: { province: "Cagayan", newsletter: "yes", age: "30", birth_date: "31-31-2030" } } }, "INVALID_DATE"],
    [{ args: { p_email: "not-an-email" } }, "INVALID_EMAIL"],
    [{ args: { p_mobile_number: "123" } }, "INVALID_MOBILE"],
  ];
  let i = 0;
  for (const [override, expectedToken] of cases) {
    i++;
    const { error } = await register(override);
    if (!error || !String(error.message).includes(expectedToken)) {
      fail(`validation case #${i}`, `expected ${expectedToken}, got ${JSON.stringify(error?.message ?? data_ok)}`);
    }
  }
  if (!problems.some((p) => p.startsWith("validation case"))) ok("all validation cases returned controlled tokens");
});

await step("per-event uniqueness", async () => {
  const other = await db.query(
    `insert into public.forms (event_id, name, description, status, version)
     values ($1, 'P15 Other Form', 'fixture', 'published', 1) returning id`,
    [fixtureIds.evOther]
  );
  const { data, error } = await register({
    args: {
      p_event_id: fixtureIds.evOther,
      p_form_id: other.rows[0].id,
      p_form_data: { province: "Isabela", newsletter: "no", age: "41", skills: ["Cooking"], referral: "Friend" },
    },
  });
  if (error) return fail("same email, different event", error.message);
  if (data.registration_number === validReg.registration_number) {
    return fail("same email, different event", "registration numbers collided");
  }
  ok("second registration allowed for a different event");
});

await step("retrieve_ticket", async () => {
  const good = await anon.rpc("retrieve_ticket", {
    p_registration_number: validReg.registration_number,
    p_verification_email: `p15-applicant-${ts}@verify.local`,
  });
  if (good.error || good.data?.ticket_token !== validReg.ticket_token || good.data?.event_name !== "P15 Verify Main") {
    fail("retrieve_ticket valid", JSON.stringify(good.error?.message ?? good.data));
  } else {
    ok("valid retrieval returns matching token");
  }

  // Email-only lookup must NOT return the ticket token or registration
  // number (P1 security fix). Either one would let the "require both" gate
  // be bypassed in two calls.
  const emailOnly = await anon.rpc("retrieve_ticket", {
    p_registration_number: "",
    p_verification_email: `p15-applicant-${ts}@verify.local`,
  });
  if (emailOnly.error) {
    fail("email-only retrieval", `unexpected error ${JSON.stringify(emailOnly.error?.message)}`);
  } else if (emailOnly.data?.ticket_token != null) {
    fail("email-only retrieval", "ticket_token must not be returned from email-only lookup");
  } else if (emailOnly.data?.registration_number != null) {
    fail("email-only retrieval", "registration_number must not be returned from email-only lookup");
  } else if (!emailOnly.data?.event_name) {
    fail("email-only retrieval", "email-only should still return event_name for confirmation");
  } else {
    ok("email-only lookup returns confirmation details but NO ticket_token or registration_number");
  }

  const wrongEmail = await anon.rpc("retrieve_ticket", {
    p_registration_number: validReg.registration_number,
    p_verification_email: "attacker@verify.local",
  });
  const unknown = await anon.rpc("retrieve_ticket", {
    p_registration_number: "JF99-999999",
    p_verification_email: "attacker@verify.local",
  });
  const m1 = String(wrongEmail.error?.message);
  const m2 = String(unknown.error?.message);
  if (!m1.includes("TICKET_NOT_FOUND") || m1 !== m2) {
    fail("retrieve_ticket anti-enumeration", `messages differ: "${m1}" vs "${m2}"`);
  } else {
    ok("wrong verification and unknown number are indistinguishable");
  }
});

await step("perform_check_in sequential", async () => {
  if (!staffClient) return fail("check-in", authBlocked ?? "no staff session");
  const first = await staffClient.rpc("perform_check_in", {
    p_ticket_token: validReg.ticket_token,
    p_device_identifier: "verify-suite-A",
  });
  if (first.error || first.data?.status !== "success") {
    return fail("first scan", JSON.stringify(first.error?.message ?? first.data));
  }
  const second = await staffClient.rpc("perform_check_in", {
    p_ticket_token: validReg.ticket_token,
    p_device_identifier: "verify-suite-B",
  });
  if (second.error || second.data?.status !== "already_checked_in") {
    return fail("second scan", JSON.stringify(second.error?.message ?? second.data));
  }
  const { rows } = await db.query(
    "select count(*)::int as n from public.check_ins where registration_id=$1 and status='success'",
    [validReg.registration_id]
  );
  if (rows[0].n !== 1) return fail("check-in persistence", `${rows[0].n} successful check-ins`);
  ok("first=success, second=already_checked_in, exactly one row");
});

await step("concurrent race", async () => {
  if (!staffClient) return fail("race", "no staff session");
  let worst = 0;
  for (let round = 1; round <= 3; round++) {
    await db.query("delete from public.check_ins where registration_id=$1", [validReg.registration_id]);
    const attempts = Array.from({ length: 8 }, (_, i) =>
      staffClient.rpc("perform_check_in", {
        p_ticket_token: validReg.ticket_token,
        p_device_identifier: `race-${round}-${i}`,
      })
    );
    const results = (await Promise.allSettled(attempts)).map((r) =>
      r.status === "fulfilled" ? r.value.data?.status : "rejected"
    );
    const successes = results.filter((s) => s === "success").length;
    const duplicates = results.filter((s) => s === "already_checked_in").length;
    worst = Math.max(worst, successes);
    if (successes !== 1 || duplicates !== 7) {
      return fail("race", `round ${round}: successes=${successes} already=${duplicates} raw=${results.join(",")}`);
    }
  }
  ok("3 rounds x 8 parallel scans: always exactly one success");
});

await step("RLS behavior — anonymous", async () => {
  const visForm = await anon.from("forms").select("id").eq("id", fixtureIds.formId);
  if (visForm.error || visForm.data.length !== 1) return fail("anon published form", JSON.stringify(visForm.error?.message ?? visForm.data));

  const draftForms = await db.query("select id from public.forms where name='P15 Form Draft'");
  const hiddenForm = await anon.from("forms").select("id").eq("id", draftForms.rows[0].id);
  if (hiddenForm.error || hiddenForm.data.length !== 0) return fail("anon draft form hidden", JSON.stringify(hiddenForm.data));

  const regs = await anon.from("registrations").select("*");
  if (regs.error || regs.data.length !== 0) return fail("anon registrations denied", `visible rows: ${regs.data?.length}`);

  const cins = await anon.from("check_ins").select("*");
  if (cins.error || cins.data.length !== 0) return fail("anon check_ins denied", `visible rows: ${cins.data?.length}`);

  const ins = await anon.from("registrations").insert({ first_name: "Evil" });
  if (!ins.error) return fail("anon insert denied", "insert unexpectedly succeeded");

  const upd = await anon.from("registrations").update({ first_name: "Evil" }).eq("id", validReg.registration_id);
  if (!upd.error) return fail("anon update denied", "update unexpectedly succeeded");

  ok("anon: published visible, drafts hidden, registrations/check-ins opaque, writes denied");
});

await step("RLS behavior — staff", async () => {
  if (!staffClient) return fail("staff rls", authBlocked ?? "no staff session");

  const regs = await staffClient.from("registrations").select("*");
  if (regs.error || regs.data.length !== 0) return fail("staff registrations denied", `visible rows: ${regs.data?.length}`);

  const lookup = await staffClient.rpc("staff_lookup", { p_query: validReg.registration_number });
  if (lookup.error || lookup.data?.results?.length !== 1) {
    return fail("staff_lookup", JSON.stringify(lookup.error?.message ?? lookup.data));
  }

  const profs = await staffClient.from("profiles").select("id, role");
  if (profs.error) return fail("staff profiles self-read", profs.error.message);
  if (!profs.data.every((p) => p.id === staffUserId)) {
    return fail("staff profiles isolation", "staff can see profiles other than their own");
  }

  const evIns = await staffClient.from("events").insert({ name: "Staff Should Fail" });
  if (!evIns.error) return fail("staff event create denied", "insert unexpectedly succeeded");

  const esc = await staffClient.from("profiles").update({ role: "admin" }).eq("id", staffUserId);
  if (!esc.error) return fail("staff self-promotion denied", "role update unexpectedly succeeded");

  const rename = await staffClient.from("profiles").update({ full_name: "Verified Staff" }).eq("id", staffUserId);
  if (rename.error) return fail("staff own-profile update", rename.error.message);

  ok("staff: scanner RPC path works, tables closed, no privilege escalation");
});

await step("RLS behavior — admin + role helpers", async () => {
  if (!adminClient) return fail("admin rls", authBlocked ?? "no admin session");

  const regs = await adminClient.from("registrations").select("id");
  if (regs.error || regs.data.length < 1) return fail("admin registrations readable", JSON.stringify(regs.error?.message ?? regs.data?.length));

  const evIns = await adminClient.from("events").insert({ name: `P15 Admin Event ${ts}`, status: "draft" });
  if (evIns.error) return fail("admin event create", evIns.error.message);

  const roles = await adminClient.rpc("my_role");
  if (roles.error || roles.data !== "admin") return fail("my_role(admin)", JSON.stringify(roles.data));
  const staffRole = await staffClient.rpc("my_role");
  if (staffRole.error || staffRole.data !== "staff") return fail("my_role(staff)", JSON.stringify(staffRole.data));
  const staffIsAdmin = await staffClient.rpc("is_admin");
  if (staffIsAdmin.error || staffIsAdmin.data !== false) return fail("is_admin(staff)", JSON.stringify(staffIsAdmin.data));
  const anonIsStaff = await anon.rpc("is_staff");
  if (anonIsStaff.error || anonIsStaff.data !== false) return fail("is_staff(anon)", JSON.stringify(anonIsStaff.data));

  await adminClient.from("events").delete().eq("name", `P15 Admin Event ${ts}`);
  ok("admin: reads registrations, creates events, helpers report correct roles");
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
try {
  await db.query("delete from public.registrations where event_id = any($1)", [
    [fixtureIds.evMain, fixtureIds.evOther],
  ]);
  await db.query("delete from public.events where id = any($1)", [
    [fixtureIds.evMain, fixtureIds.evOther],
  ]);
  const ids = [adminUserId, staffUserId].filter(Boolean);
  if (ids.length && adminApi) {
    for (const id of ids) await adminApi.auth.admin.deleteUser(id);
  } else if (ids.length) {
    await db.query("delete from auth.users where id = any($1)", [ids]);
  }
  console.log("[ok]   cleanup complete");
} catch (err) {
  console.error(`[warn] cleanup incomplete: ${err.message} — leftover P15 fixture rows may remain`);
}

await db.end();

if (authBlocked) {
  console.error(`AUTH NOTE: ${authBlocked}`);
}
if (problems.length > 0) {
  console.error(`${problems.length} FAILURE(S)`);
  process.exit(1);
}
console.log("RPC_TESTS_PASSED");
