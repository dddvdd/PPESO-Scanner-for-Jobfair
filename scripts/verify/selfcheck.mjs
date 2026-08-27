import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(process.cwd(), "scripts");
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith(".mjs")) files.push(relative(process.cwd(), full));
  }
}
walk(root);

const failures = [];
for (const file of files) {
  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (res.status !== 0) {
    failures.push(`${file}: ${res.stderr.trim()}`);
  }
}

if (failures.length > 0) {
  console.error("SYNTAX ERRORS:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(`SYNTAX_OK (${files.length} scripts checked)`);
