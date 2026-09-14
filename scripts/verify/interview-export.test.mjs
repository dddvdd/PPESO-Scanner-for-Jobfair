import test from "node:test";
import assert from "node:assert/strict";
import { interviewResultsCsv } from "../../src/lib/interviewExport.js";

test("exports every company result for the same applicant, including all statuses", () => {
  const rows = ["HOTS", "Qualified", "Near Hires", "Not Qualified"].map((status, index) => ({
    registration_number: "REG-001", applicant_name: "Juan dela Cruz",
    company: `Company ${String.fromCharCode(65 + index)}`, position: "Clerk", status,
    updated_at: "2026-09-14T00:00:00Z",
  }));
  const csv = interviewResultsCsv("Job Fair", rows);
  assert.equal(csv.split("\r\n").length, 5);
  assert.equal(csv.match(/Juan dela Cruz/g).length, 4);
  assert.ok(csv.includes('"Company A","Clerk","HOTS"'));
  assert.ok(csv.includes('"Company B","Clerk","Qualified"'));
  assert.ok(csv.startsWith("\uFEFF"));
});

test("escapes commas, quotes and newlines and neutralizes spreadsheet formulas", () => {
  const csv = interviewResultsCsv("Event", [{ applicant_name: '=HYPERLINK("x")', company: 'A, "B"\nC' }]);
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"A, ""B""\nC"'));
  assert.equal(interviewResultsCsv("Empty", []).split("\r\n").length, 1);
});

