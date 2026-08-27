import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const required = [
  ["Objective", /#\s*1?\.?\s*objective/i],
  ["Architecture", /architecture/i],
  ["Roles", /\broles\b/i],
  ["Database requirements", /core data model|database requirements/i],
  ["Form builder requirements", /form builder|admin form/i],
  ["Applicant registration", /registration flow/i],
  ["QR ticket", /qr ticket requirements|qr ticket/i],
  ["Ticket retrieval", /ticket retrieval/i],
  ["Mobile scanner", /mobile qr scanner|mobile scanner/i],
  ["Duplicate check-in protection", /duplicate check-in protection/i],
  ["Admin registration management", /admin registration management/i],
  ["CSV export", /data export|csv export/i],
  ["Security/RLS", /security requirements/i],
  ["Error handling", /error handling/i],
  ["Rate limiting", /rate limiting/i],
  ["Performance requirements", /performance requirements/i],
  ["Explicit out-of-scope features", /out of scope|explicitly out of scope/i],
  ["Development phases", /implementation phases|development phases/i],
  ["Acceptance criteria", /acceptance test|acceptance criteria/i],
  ["Definition of done", /definition of done/i],
];

const path = join(process.cwd(), "mvp_scope.md");
if (!existsSync(path)) {
  console.error("mvp_scope.md not found in current working directory");
  process.exit(1);
}

const text = readFileSync(path, "utf8");
const missing = required.filter(([, re]) => !re.test(text)).map(([name]) => name);

if (missing.length > 0) {
  console.error("MISSING SECTIONS:");
  for (const name of missing) console.error("  - " + name);
  process.exit(1);
}

console.log(`SCOPE_COMPLETE (${required.length}/${required.length} required sections present)`);
