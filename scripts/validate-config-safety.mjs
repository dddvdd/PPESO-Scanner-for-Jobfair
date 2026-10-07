import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else files.push(full);
  }
}

walk(process.cwd());

const problems = [];
const warnings = [];

// Client-shipped code/config locations where server-only credentials must never appear.
const clientCode = (f) => {
  const rel = relative(process.cwd(), f).toLowerCase();
  return (
    rel.startsWith(`src${sep}`) ||
    rel === "index.html" ||
    rel === "package.json"
  );
};

for (const file of files) {
  const rel = relative(process.cwd(), file);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // binary
  }

  // JWT-like secret material anywhere
  if (/eyJ[A-Za-z0-9_-]{30,}/.test(text)) {
    problems.push(`JWT-like token found in ${rel}`);
  }

  // Ignore private local environment files; placeholders like YOUR_PROJECT_REF are safe.
  const isLocalEnv = rel === ".env" || rel.startsWith(".env.");
  if (!isLocalEnv && /[a-z0-9]{20}\.supabase\.co/.test(text)) {
    problems.push(`Hard-coded Supabase project URL found in ${rel}`);
  }

  // Service-role credentials must never be bundled into code delivered to browsers.
  if (clientCode(file) && /service_role/i.test(text)) {
    problems.push(`service_role reference found in ${rel}`);
  }
}

const gitignorePath = join(process.cwd(), ".gitignore");
if (!statSync(gitignorePath, { throwIfNoEntry: false })) {
  problems.push(".gitignore is missing");
} else {
  const gi = readFileSync(gitignorePath, "utf8");
  if (!/^\.env$/m.test(gi)) problems.push(".gitignore does not ignore .env");
  if (!/^\.env\.local/m.test(gi) && !/^\.env\b/m.test(gi) === false) warnings.push(".env.local not explicitly ignored");
}

const envExample = join(process.cwd(), ".env.example");
if (!statSync(envExample, { throwIfNoEntry: false })) {
  problems.push(".env.example is missing (Supabase configuration must be documented)");
} else {
  const ex = readFileSync(envExample, "utf8");
  if (!/VITE_SUPABASE_URL\s*=\s*\S/.test(ex)) problems.push(".env.example missing VITE_SUPABASE_URL placeholder");
  if (!/VITE_SUPABASE_ANON_KEY\s*=\s*\S/.test(ex)) problems.push(".env.example missing VITE_SUPABASE_ANON_KEY placeholder");
  if (/eyJ[A-Za-z0-9_-]{30,}/.test(ex)) problems.push(".env.example contains a real-looking key");
}

if (problems.length > 0) {
  console.error("CONFIG UNSAFE:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
for (const w of warnings) console.warn("warning: " + w);
console.log("CONFIG_SAFE");
