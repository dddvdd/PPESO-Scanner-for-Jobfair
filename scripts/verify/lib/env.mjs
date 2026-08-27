import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Loads .env WITHOUT printing values anywhere. Session environment variables
// take precedence over .env so secrets can be injected without touching disk.
export function loadEnv() {
  const vars = {};
  const path = join(process.cwd(), ".env");
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith("#")) {
        vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
  const pick = (k) => process.env[k] ?? (vars[k] && vars[k]) ?? null;
  return {
    url: pick("VITE_SUPABASE_URL"),
    anonKey: pick("VITE_SUPABASE_ANON_KEY"),
    dbUrl: pick("SUPABASE_DB_URL"),
    serviceKey: pick("SUPABASE_SERVICE_KEY"),
  };
}

// Extracts only the non-secret project ref from the URL host (<ref>.supabase.co).
export function projectRef(url) {
  if (!url) return null;
  const m = String(url).match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

export function summarize(env) {
  return {
    project_ref: projectRef(env.url),
    VITE_SUPABASE_URL: Boolean(env.url),
    VITE_SUPABASE_ANON_KEY: Boolean(env.anonKey),
    SUPABASE_DB_URL: Boolean(env.dbUrl),
    SUPABASE_SERVICE_KEY: Boolean(env.serviceKey),
  };
}
