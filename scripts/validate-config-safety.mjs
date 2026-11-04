import { readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";

// Inspect publishable paths, not ignored local credentials, tools or backups.
const files = execFileSync("git", ["ls-files", "--cached", "-z"], { encoding: "utf8" })
  .split("\0").filter(Boolean).map(file => join(process.cwd(), file));

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
  const normalized = rel.replaceAll("\\", "/");
  if (/(^|\/)(tests?|__tests__|e2e|screenshots|test-results|playwright-report|coverage)(\/|$)|\.(test|spec)\.|\.snap$|-tests\.mjs$|^scripts\/verify\//i.test(normalized)) {
    problems.push(`Local test artifact is tracked: ${rel}`);
  }
  if ((/(^|\/)\.env(?:\.|$)/.test(normalized) && normalized !== ".env.example") || /\.(pem|key|p12|pfx)$/i.test(normalized)) {
    problems.push(`Private configuration file is tracked: ${rel}`);
  }
  if (/\.(png|gif|jpg|jpeg|webp|ico)$/i.test(normalized)) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // binary
  }

  // Ignore private local environment files; placeholders like YOUR_PROJECT_REF are safe.
  const isLocalEnv = rel === ".env" || rel.startsWith(".env.");

  // JWT-like secret material anywhere
  if (/eyJ[A-Za-z0-9_-]{30,}/.test(text)) {
    problems.push(`JWT-like token found in ${rel}`);
  }

  // API secret keys (e.g. sk- prefix)
  if (!isLocalEnv && /\bsk-[a-zA-Z0-9_-]{20,}\b/.test(text)) {
    problems.push(`Secret API key (sk-...) found in ${rel}`);
  }

  // Private key blocks
  if (/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    problems.push(`Private key found in ${rel}`);
  }

  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sb_secret_[A-Za-z0-9_-]{20,})\b/.test(text)) {
    problems.push(`Private access token found in ${rel}`);
  }

  if (/\b(?:const|let|var)\s+\w*password\w*\s*=\s*["'][^"']+["']/i.test(text)) {
    problems.push(`Hard-coded password assignment found in ${rel}`);
  }

  if (!isLocalEnv && /[a-z0-9]{20}\.supabase\.co/.test(text)) {
    problems.push(`Hard-coded Supabase project URL found in ${rel}`);
  }

  // Service-role credentials must never be bundled into code delivered to browsers.
  if (clientCode(file) && /(service_role|SUPABASE_SERVICE)/i.test(text)) {
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
