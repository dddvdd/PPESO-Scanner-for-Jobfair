import { loadEnv, summarize } from "./lib/env.mjs";

const env = loadEnv();
const status = summarize(env);
console.log(JSON.stringify(status));

const missing = Object.entries(status)
  .filter(([k, v]) => !v && k !== "project_ref")
  .map(([k]) => k);

if (!status.VITE_SUPABASE_URL || !status.VITE_SUPABASE_ANON_KEY) {
  console.error("CONFIG_MISSING:");
  console.error("  Required in .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY");
  for (const k of missing) console.error(`  - ${k}`);
  process.exit(1);
}

console.log("CONFIG_PRESENT");
