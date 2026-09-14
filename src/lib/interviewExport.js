import { registrantsCsv } from "./registrantsExport.js";

export function interviewResultsCsv(eventName, rows) {
  const columns = [
    ["registration_number", "Registration number"],
    ["applicant_name", "Applicant"],
    ["company", "Company"],
    ["position", "Position"],
    ["status", "Interview status"],
    ["updated_at", "Updated at (UTC)"],
  ].map(([key, label]) => ({ label, value: row => row[key] }));
  return registrantsCsv(eventName, columns, rows);
}

export function downloadInterviewCsv(eventName, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${eventName.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 100) || "event"}-interview-results.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
