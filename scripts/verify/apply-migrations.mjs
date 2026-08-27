import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { loadEnv } from "./lib/env.mjs";

const env = loadEnv();
if (!env.dbUrl) {
  console.error("MIGRATIONS_BLOCKED: SUPABASE_DB_URL not set in this session.");
  console.error("Provide it WITHOUT saving to disk, e.g.:");
  console.error('  $env:SUPABASE_DB_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"');
  process.exit(1);
}

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({
  connectionString: env.dbUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

// Bookkeeping lives in its own schema, revoked from anon/authenticated so the
// API can never see it.
await client.query(`
  create schema if not exists patch2_meta;
  revoke all on schema patch2_meta from anon, authenticated;
  create table if not exists patch2_meta.applied_migrations (
    filename text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  );
`);

const { rows: known } = await client.query("select filename, checksum from patch2_meta.applied_migrations");
const knownMap = new Map(known.map((r) => [r.filename, r.checksum]));

let applied = 0;
let skipped = 0;
for (const name of files) {
  const sqlText = readFileSync(join(dir, name), "utf8");
  const checksum = createHash("sha256").update(sqlText).digest("hex");

  if (knownMap.has(name)) {
    if (knownMap.get(name) !== checksum) {
      console.error(`MIGRATION_CONFLICT: ${name} was already applied with a different checksum. Refusing to run.`);
      await client.end();
      process.exit(1);
    }
    skipped++;
    continue;
  }

  try {
    await client.query("begin");
    await client.query(sqlText);
    await client.query(
      "insert into patch2_meta.applied_migrations (filename, checksum) values ($1, $2)",
      [name, checksum]
    );
    await client.query("commit");
    console.log(`APPLIED ${name}`);
    applied++;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error(`FAILED ${name}: ${err.message}`);
    if (err.detail) console.error(`detail: ${err.detail}`);
    await client.end();
    process.exit(1);
  }
}

console.log(`${applied} applied, ${skipped} already up-to-date (${files.length} total)`);
await client.end();
console.log("MIGRATIONS_APPLIED");
