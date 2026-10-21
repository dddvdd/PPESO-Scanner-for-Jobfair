import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

test("Attack Class 9: AI-Agent Configuration Safety", async (t) => {
  await t.test("AGENTS.md exists and establishes security guidelines", () => {
    assert.ok(existsSync(join(ROOT, "AGENTS.md")), "AGENTS.md must exist in the repository root");
    const agentsMd = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

    assert.match(
      agentsMd,
      /No Untrusted Executable Instructions/i,
      "AGENTS.md must prohibit untrusted executable instructions"
    );
    assert.match(
      agentsMd,
      /Secret & Key Protection/i,
      "AGENTS.md must mandate secret and key protection"
    );
    assert.match(
      agentsMd,
      /No Destructive Operations/i,
      "AGENTS.md must mandate no destructive commands"
    );
    assert.match(
      agentsMd,
      /Row Level Security/i,
      "AGENTS.md must require Row Level Security on all tables"
    );
  });

  await t.test("AGENTS.md contains no dangerous shell injection commands", () => {
    const agentsMd = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    assert.doesNotMatch(agentsMd, /curl\s+.*\|\s*sh/i, "No pipe-to-shell instructions");
    assert.doesNotMatch(agentsMd, /eval\s*\(/i, "No eval commands in agent configuration");
    assert.doesNotMatch(agentsMd, /rm\s+-rf\s+[\/\*]/i, "No destructive rm commands");
  });
});
