import pg from "pg";
import { loadEnv } from "./lib/env.mjs";

const env = loadEnv();
if (!env.dbUrl) {
  console.error("POLICIES_BLOCKED: SUPABASE_DB_URL not set in this session.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(`
  select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies where schemaname = 'public'
`);

const problems = [];
const byTable = new Map();
for (const r of rows) {
  if (!byTable.has(r.tablename)) byTable.set(r.tablename, []);
  byTable.get(r.tablename).push(r);
}

function hasPolicy(table, nameFragment) {
  return (byTable.get(table) || []).some((p) => p.policyname.includes(nameFragment));
}

for (const t of ["profiles", "events", "forms", "form_fields", "registrations", "check_ins"]) {
  if (!byTable.has(t)) problems.push(`no policies found on ${t}`);
}

// Security-model assertions
if (!hasPolicy("events", "read_public")) problems.push("events public-read policy missing");
if (!hasPolicy("events", "admin")) problems.push("events admin policy missing");
if (!hasPolicy("forms", "published")) problems.push("forms published-read policy missing");
if (!hasPolicy("form_fields", "published")) problems.push("form_fields published-read policy missing");

for (const t of ["registrations", "check_ins"]) {
  const pols = byTable.get(t) || [];
  if (pols.some((p) => p.roles.includes("anon") && !p.policyname.includes("admin"))) {
    problems.push(`${t}: anon-facing policy detected (must be RPC-only)`);
  }
  if (!pols.some((p) => String(p.qual).includes("is_admin"))) {
    problems.push(`${t}: admin-gated policy missing`);
  }
}

const profilesPolicies = byTable.get("profiles") || [];
if (!profilesPolicies.some((p) => String(p.qual).includes("auth.uid()") || String(p.with_check).includes("auth.uid()"))) {
  problems.push("profiles: own-row policy missing");
}
if (!hasPolicy("profiles", "admin")) problems.push("profiles admin policy missing");

await client.end();

console.log(`policy count: ${rows.length}`);
if (problems.length > 0) {
  console.error("POLICIES INVALID:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("POLICIES_VERIFIED");
