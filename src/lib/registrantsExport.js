const BASE_FIELDS = [
  ["registration_number", "Registration number"],
  ["first_name", "First name"], ["middle_name", "Middle name"],
  ["last_name", "Last name"], ["suffix", "Suffix"],
  ["email", "Email"], ["mobile_number", "Mobile number"],
  ["status", "Status"], ["registered_at", "Registered at"],
  ["entry_source", "Entry source"], ["recorded_by", "Recorded by (account ID)"],
];

export function registrationColumns(fields, rows) {
  const dynamic = new Map();
  for (const field of [...fields].sort((a, b) => a.sort_order - b.sort_order)) {
    dynamic.set(field.field_key, field.label);
  }
  // Keep historical answers even when their field has since been removed.
  for (const row of rows) {
    for (const key of Object.keys(row.form_data ?? {})) {
      if (!dynamic.has(key)) dynamic.set(key, key);
    }
  }
  return [
    ...BASE_FIELDS.map(([key, label]) => ({ key, label, value: row => row[key] })),
    ...Array.from(dynamic, ([key, label]) => ({
      key: `form:${key}`, label: `${label} (${key})`, value: row => row.form_data?.[key],
    })),
  ];
}

export function displayAnswer(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvCell(value) {
  let text = displayAnswer(value);
  // Prevent spreadsheet formulas from executing when opening applicant input.
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function registrantsCsv(eventName, columns, rows) {
  return "\uFEFF" + [
    ["Event", ...columns.map(column => column.label)].map(csvCell).join(","),
    ...rows.map(row => [eventName, ...columns.map(column => column.value(row))].map(csvCell).join(",")),
  ].join("\r\n");
}
