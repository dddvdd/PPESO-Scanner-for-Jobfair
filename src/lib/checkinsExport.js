import { registrantsCsv } from "./registrantsExport.js";

export function checkinsCsv(eventName, rows) {
  const columns = [
    ["registration_number", "Registration number"],
    ["applicant_name", "Applicant"],
    ["email", "Email"],
    ["mobile_number", "Mobile number"],
    ["pwd", "PWD"],
    ["sex", "Sex"],
    ["first_time_job_seeker", "First-time job seeker"],
    ["returning_ofw", "Returning OFW"],
    ["returning_worker", "Returning worker"],
    ["interested_in_skills_training", "Interested in Skills Training"],
    ["province", "Province"],
    ["municipality_city", "Municipality/City"],
    ["barangay", "Barangay"],
    ["date_of_birth", "Date of birth"],
    ["registration_event", "Registration event"],
    ["checkin_event", "Check-in event"],
    ["registered_at", "Registered at"],
    ["registration_status", "Registration status"],
    ["checked_in_at", "Checked in at (UTC)"],
    ["checkin_status", "Check-in status"],
    ["attendance_date", "Attendance date"],
  ].map(([key, label]) => ({ label, value: row => row[key] }));
  return registrantsCsv(eventName, columns, rows);
}

export function downloadCheckinsCsv(eventName, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${eventName.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 100) || "event"}-check-ins.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
