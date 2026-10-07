import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_RESULTS_DIR = join(__dirname, "..", "..", "test-results");

const EXPECTED_PRE_REGISTRANTS = 780;
const EXPECTED_CHECK_INS = 497;

function parseCSVIntoMatrix(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let current = "";
  let inQuotes = false;
  const lineBuffer = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { lineBuffer.push(current); current = ""; }
      else if (ch === "\r") { if (text[i + 1] === "\n") i++; lineBuffer.push(current); current = ""; rows.push(lineBuffer.splice(0)); }
      else if (ch === "\n") { lineBuffer.push(current); current = ""; rows.push(lineBuffer.splice(0)); }
      else { current += ch; }
    }
  }
  lineBuffer.push(current);
  if (lineBuffer.some(c => c !== "")) rows.push(lineBuffer.splice(0));
  return rows;
}

function findDuplicates(dataRows, colIndex) {
  if (colIndex < 0) return [];
  const seen = new Map();
  const dups = [];
  for (const row of dataRows) {
    const val = (row[colIndex] || "").trim();
    if (seen.has(val)) dups.push(val);
    else seen.set(val, true);
  }
  return dups;
}

async function main() {
  console.log("=== Verify Exports ===\n");
  const files = await readdir(TEST_RESULTS_DIR);
  const preRegFile = files.find(f => f.endsWith("-pre-registrants.csv"));
  const checkInFile = files.find(f => f.endsWith("-check-ins.csv"));

  if (!preRegFile) { console.error("ERROR: No pre-registrants CSV found"); process.exit(1); }
  if (!checkInFile) { console.error("ERROR: No check-ins CSV found"); process.exit(1); }

  console.log("Pre-registrant file:", preRegFile);
  console.log("Check-in file:     ", checkInFile);
  console.log();

  const results = {};
  for (const [label, filename] of [["Pre-Registrants", preRegFile], ["Check-Ins", checkInFile]]) {
    const raw = await readFile(join(TEST_RESULTS_DIR, filename), "utf-8");
    console.log(`--- ${label} (${filename}) ---`);
    const matrix = parseCSVIntoMatrix(raw);
    if (matrix.length === 0) { console.log("  (empty)\n"); results[label] = { rows: 0, headers: [], valid: false, duplicates: [] }; continue; }
    const headers = matrix[0].map(h => h.trim());
    const dataRows = matrix.slice(1);
    console.log(`  Headers (${headers.length}): ${JSON.stringify(headers)}`);
    console.log(`  Data rows: ${dataRows.length}`);
    console.log("  First 3 rows:");
    for (let i = 0; i < 3 && i < dataRows.length; i++) console.log(`    Row ${i + 1}: ${JSON.stringify(dataRows[i])}`);
    const regIdx = headers.findIndex(h => h.trim().toLowerCase() === "registration number");
    const duplicates = regIdx >= 0 ? findDuplicates(dataRows, regIdx) : [];
    console.log(`  Duplicate registration numbers: ${duplicates.length}`);
    if (duplicates.length > 0) console.log(`    ${JSON.stringify(duplicates.slice(0, 10))}`);

    if (label === "Check-Ins") {
      const regEvtIdx = headers.findIndex(h => h.trim().toLowerCase() === "registration event");
      const chkEvtIdx = headers.findIndex(h => h.trim().toLowerCase() === "check-in event");
      if (regEvtIdx >= 0 && chkEvtIdx >= 0) {
        let crossEvent = 0;
        for (const row of dataRows) {
          if (row[regEvtIdx] && row[chkEvtIdx] && row[regEvtIdx] !== row[chkEvtIdx]) crossEvent++;
        }
        console.log(`  Cross-event check-ins (reg != checkin event): ${crossEvent}`);
      }
    }

    results[label] = { rows: dataRows.length, headers, valid: headers.length > 0 && headers.some(h => /registration/i.test(h)), duplicates };
    console.log();
  }

  console.log("=== Summary ===\n");
  console.log(`Pre-registrant rows: ${results["Pre-Registrants"].rows} (expected ${EXPECTED_PRE_REGISTRANTS}) ${results["Pre-Registrants"].rows === EXPECTED_PRE_REGISTRANTS ? "PASS" : "FAIL"}`);
  console.log(`Check-in rows:       ${results["Check-Ins"].rows} (expected ${EXPECTED_CHECK_INS}) ${results["Check-Ins"].rows === EXPECTED_CHECK_INS ? "PASS" : "FAIL"}`);
  console.log(`Pre-reg valid headers: ${results["Pre-Registrants"].valid ? "PASS" : "FAIL"}`);
  console.log(`Check-in valid headers: ${results["Check-Ins"].valid ? "PASS" : "FAIL"}`);
  console.log(`No pre-reg duplicates: ${results["Pre-Registrants"].duplicates.length === 0 ? "PASS" : "FAIL"}`);
  console.log(`No check-in duplicates: ${results["Check-Ins"].duplicates.length === 0 ? "PASS" : "FAIL"}`);

  const all = results["Pre-Registrants"].rows === EXPECTED_PRE_REGISTRANTS &&
    results["Check-Ins"].rows === EXPECTED_CHECK_INS &&
    results["Pre-Registrants"].valid && results["Check-Ins"].valid &&
    results["Pre-Registrants"].duplicates.length === 0 &&
    results["Check-Ins"].duplicates.length === 0;
  console.log(`\nOverall: ${all ? "ALL PASS" : "SOME FAILED"}`);
  if (!all) process.exit(1);
}

main();
