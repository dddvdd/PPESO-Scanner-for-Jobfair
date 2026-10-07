import { registrantsCsv, registrationColumns } from "./registrantsExport.js";

export function preRegistrantsCsv(eventName, fields, rows) {
  const columns = registrationColumns(fields, rows);
  return registrantsCsv(eventName, columns, rows);
}

export function downloadPreRegistrantsCsv(eventName, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${eventName.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 100) || "event"}-pre-registrants.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
