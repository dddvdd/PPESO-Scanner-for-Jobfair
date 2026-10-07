import test from "node:test";
import assert from "node:assert/strict";
import { checkinsCsv } from "../../src/lib/checkinsExport.js";
import { interviewResultsCsv } from "../../src/lib/interviewExport.js";

// PESO reporting requires these applicant profile/classification columns on
// every CSV the admin can download from the Export tab.
const REQUIRED_HEADERS = [
  "PWD",
  "Sex",
  "First-time job seeker",
  "Returning OFW",
  "Returning worker",
  "Interested in Skills Training",
  "Province",
  "Municipality/City",
  "Barangay",
];

function headersOf(csv) {
  const header = csv.replace(/^\uFEFF/, "").split("\r\n")[0];
  return header.split(",").map(cell => cell.replace(/^"|"$/g, ""));
}

const PROFILE_ROW = {
  pwd: "No",
  sex: "Female",
  first_time_job_seeker: "yes",
  returning_ofw: "no",
  returning_worker: "no",
  interested_in_skills_training: "Yes",
  province: "Cagayan",
  municipality_city: "Tuguegarao City",
  barangay: "Poblacion",
};

test("check-ins CSV carries every required profile column", () => {
  const headers = headersOf(checkinsCsv("Job Fair", [{ registration_number: "REG-001" }]));
  for (const header of REQUIRED_HEADERS) {
    assert.ok(headers.includes(header), `check-ins CSV is missing "${header}"`);
  }
});

test("interview CSV carries every required profile column", () => {
  const headers = headersOf(interviewResultsCsv("Job Fair", [{ registration_number: "REG-001" }]));
  for (const header of REQUIRED_HEADERS) {
    assert.ok(headers.includes(header), `interview CSV is missing "${header}"`);
  }
});

test("profile answers reach the CSV cells", () => {
  for (const csv of [
    checkinsCsv("Job Fair", [{ registration_number: "REG-001", ...PROFILE_ROW }]),
    interviewResultsCsv("Job Fair", [{ registration_number: "REG-001", ...PROFILE_ROW }]),
  ]) {
    assert.ok(csv.includes('"No","Female","yes","no","no","Yes","Cagayan","Tuguegarao City","Poblacion"'));
  }
});

test("blank profile answers export as empty cells, not undefined", () => {
  const csv = checkinsCsv("Job Fair", [{ registration_number: "REG-001" }]);
  const row = csv.replace(/^\uFEFF/, "").split("\r\n")[1].split(",");
  assert.equal(row.length, headersOf(csv).length);
  assert.ok(row.includes('""'));
  assert.ok(!csv.includes("undefined"));
});
