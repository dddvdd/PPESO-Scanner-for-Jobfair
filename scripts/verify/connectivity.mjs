import { loadEnv, projectRef } from "./lib/env.mjs";

const env = loadEnv();
if (!env.url || !env.anonKey) {
  console.error("CONNECTIVITY_FAILED: configuration missing (run npm run verify:env)");
  process.exit(1);
}

const started = Date.now();
try {
  const res = await fetch(`${env.url.replace(/\/$/, "")}/auth/v1/health`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${env.anonKey}` },
    signal: AbortSignal.timeout(15000),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    console.error(`CONNECTIVITY_FAILED: auth health endpoint returned HTTP ${res.status}`);
    process.exit(1);
  }
  console.log(`project_ref=${projectRef(env.url)} http=${res.status} latency_ms=${ms}`);
  console.log("REACHABLE");
} catch (err) {
  console.error(`CONNECTIVITY_FAILED: ${err && err.name === "TimeoutError" ? "timeout after 15s" : err.message}`);
  process.exit(1);
}
