import pg from "pg";
import { loadEnv } from "./lib/env.mjs";

const env = loadEnv();
if (!env.dbUrl) {
  console.error("INTEGRITY_BLOCKED: SUPABASE_DB_URL not set in this session.");
  process.exit(1);
}

const db = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } });
await db.connect();

const problems = [];
const okSteps = [];

async function expectViolation(name, expectedCode, sqlFn) {
  try {
    await sqlFn();
    problems.push(`${name}: statement unexpectedly succeeded`);
  } catch (err) {
    if (err.code === expectedCode) okSteps.push(`${name} -> ${err.code}`);
    else problems.push(`${name}: expected SQLSTATE ${expectedCode}, got ${err.code ?? "?"} (${err.message})`);
  }
}

// Minimal dedicated fixtures, fully cleaned up afterwards.
const q = (sql, params) => db.query(sql, params);

const ev = await q(
  `insert into public.events (name, event_date, location, status)
   values ('P15 Integrity', current_date + 1, 'X', 'published') returning id`
);
const evId = ev.rows[0].id;
const fm = await q(
  `insert into public.forms (event_id, name, status) values ($1, 'Integrity Form', 'published') returning id`,
  [evId]
);
const fmId = fm.rows[0].id;
const reg = await q(
  `insert into public.registrations
     (event_id, form_id, registration_number, ticket_token, first_name, last_name, email, mobile_number)
   values ($1, $2, 'JF99-900001', repeat('ab', 24), 'T', 'U', 'integrity@verify.local', '+63 917 111 1111')
   returning id`,
  [evId, fmId]
);
const regId = reg.rows[0].id;

await expectViolation("I1 duplicate registration_number", "23505", () =>
  q(
    `insert into public.registrations
       (event_id, form_id, registration_number, ticket_token, first_name, last_name, email, mobile_number)
     values ($1, $2, 'JF99-900001', repeat('cd', 24), 'T', 'U', 'other@verify.local', '+63 917 222 2222')`,
    [evId, fmId]
  )
);

await expectViolation("I2 duplicate ticket_token", "23505", () =>
  q(
    `insert into public.registrations
       (event_id, form_id, registration_number, ticket_token, first_name, last_name, email, mobile_number)
     values ($1, $2, 'JF99-900002', repeat('ab', 24), 'T', 'U', 'another@verify.local', '+63 917 333 3333')`,
    [evId, fmId]
  )
);

await expectViolation("I3 invalid event foreign key", "23503", () =>
  q(
    `insert into public.registrations
       (event_id, form_id, registration_number, ticket_token, first_name, last_name, email, mobile_number)
     values ('00000000-0000-0000-0000-00000000dead', $1, 'JF99-900003', repeat('ef', 24), 'T', 'U', 'fk@verify.local', '+63 917 444 4444')`,
    [fmId]
  )
);

{
  const otherEv = await q(
    `insert into public.events (name, status) values ('P15 Integrity B', 'published') returning id`
  );
  await expectViolation("I4 form/event pairing mismatch", "23503", () =>
    q(
      `insert into public.registrations
         (event_id, form_id, registration_number, ticket_token, first_name, last_name, email, mobile_number)
       values ($1, $2, 'JF99-900004', repeat('12', 24), 'T', 'U', 'pair@verify.local', '+63 917 555 5555')`,
      [otherEv.rows[0].id, fmId]
    )
  );
}

await q(
  `insert into public.check_ins (registration_id, scanned_at, device_identifier, status)
   values ($1, now(), 'integrity', 'success')`,
  [regId]
);
await expectViolation("I5 second successful check-in", "23505", () =>
  q(
    `insert into public.check_ins (registration_id, scanned_at, device_identifier, status)
     values ($1, now(), 'integrity-b', 'success')`,
    [regId]
  )
);

await expectViolation("I6 choice field without options", "23514", () =>
  q(
    `insert into public.form_fields (form_id, field_key, label, field_type, required, options)
     values ($1, 'bad_choice', 'Bad', 'dropdown', false, '[]')`,
    [fmId]
  )
);

await expectViolation("I7 duplicate registration per event (lowered email)", "23505", () =>
  q(
    `insert into public.registrations
       (event_id, form_id, registration_number, ticket_token, first_name, last_name, email, mobile_number)
     values ($1, $2, 'JF99-900005', repeat('34', 24), 'T', 'U', 'INTEGRITY@VERIFY.LOCAL', '+63 917 666 6666')`,
    [evId, fmId]
  )
);

await q("delete from public.registrations where id = $1", [regId]);
await q("delete from public.events where id in (select id from public.events where name like 'P15 Integrity%')");
console.log("[ok]   integrity fixtures cleaned up");

await db.end();

for (const s of okSteps) console.log(`[ok]   ${s}`);
if (problems.length > 0) {
  console.error("INTEGRITY PROBLEMS:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("INTEGRITY_TESTS_PASSED");
