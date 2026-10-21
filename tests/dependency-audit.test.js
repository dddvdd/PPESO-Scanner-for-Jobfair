import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

test("Attack Class 8: Vulnerable Dependency Pin Verification", async (t) => {
  await t.test("npm audit --audit-level=high passes with zero high/critical vulnerabilities", () => {
    let output = "";
    try {
      output = execSync("npm audit --audit-level=high", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      assert.fail(`npm audit --audit-level=high failed with status ${err.status}:\n${err.stdout}\n${err.stderr}`);
    }
    assert.doesNotMatch(output, /Severity:\s+(high|critical)/i, "No high or critical vulnerabilities allowed");
  });
});
