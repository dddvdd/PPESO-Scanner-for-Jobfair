const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER_PATTERN = /^-?[0-9]+(\.[0-9]+)?$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;


const EXCLUSIVE_YES_FIELDS = [
  ["first_time_job_seeker", "first time job seeker?"],
  ["returning_ofw", "returning ofw?"],
  ["returning_worker", "returning worker?"],
];

export function resolveExclusiveGroups(allFields) {
  const findKey = ([key, label]) =>
    allFields.find(
      (f) => f.field_key === key || f.label.trim().toLowerCase() === label
    )?.field_key;
  const group = EXCLUSIVE_YES_FIELDS.map(findKey).filter(Boolean);
  return group.length > 1 ? [group] : [];
}

export function initialIdentity() {
  return { firstName: "", lastName: "", email: "", mobileNumber: "", middleName: "", suffix: "" };
}

export function initialAnswers(fields) {
  const answers = {};
  for (const field of fields) {
    answers[field.field_key] =
      field.field_type === "checkbox" || field.field_type === "multi_select" ? [] : "";
  }
  return answers;
}

export function validateIdentity(identity) {
  const errors = {};
  if (!identity.firstName.trim()) errors.firstName = "First name is required.";
  if (!identity.lastName.trim()) errors.lastName = "Last name is required.";
  if (!identity.email.trim()) errors.email = "Email is required.";
  else if (!EMAIL_PATTERN.test(identity.email.trim())) errors.email = "Please enter a valid email address.";
  if (!identity.mobileNumber.trim()) errors.mobileNumber = "Mobile number is required.";
  else if (identity.mobileNumber.replace(/[^0-9]/g, "").length < 7)
    errors.mobileNumber = "Please enter a valid mobile number.";
  return errors;
}

export function validateAnswers(fields, answers) {
  const errors = {};
  for (const field of fields) {
    const value = answers[field.field_key];
    if (field.field_type === "checkbox" || field.field_type === "multi_select") {
      const selected = Array.isArray(value) ? value : [];
      if (field.required && selected.length === 0) {
        errors[field.field_key] = "Please select at least one option.";
        continue;
      }
      const allowed = Array.isArray(field.options) ? field.options : [];
      if (selected.some((v) => !allowed.includes(v))) {
        errors[field.field_key] = "Please choose one of the available options.";
      }
      continue;
    }
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      if (field.required) errors[field.field_key] = `${field.label} is required.`;
      continue;
    }
    if (field.field_type === "number" && !NUMBER_PATTERN.test(text)) {
      errors[field.field_key] = "Please enter a valid number.";
    } else if (field.field_type === "date" && !DATE_PATTERN.test(text)) {
      errors[field.field_key] = "Please enter a valid date in YYYY-MM-DD format.";
    } else if (
      (field.field_type === "dropdown" || field.field_type === "radio") &&
      !(Array.isArray(field.options) ? field.options : []).includes(text)
    ) {
      errors[field.field_key] = "Please choose one of the available options.";
    } else if (field.field_type === "yes_no" && !["yes", "no"].includes(text.toLowerCase())) {
      errors[field.field_key] = "Please choose Yes or No.";
    }
  }
  return errors;
}

/**
 * form_data wire format: include only answered fields. The backend treats
 * key PRESENCE as "answered", so untouched optional scalars must be omitted
 * entirely (an empty string would be rejected as an invalid choice/value);
 * arrays are always safe to send ([] satisfies optional multi-selects).
 */
export function buildFormData(answers) {
  const data = {};
  for (const [key, value] of Object.entries(answers)) {
    if (Array.isArray(value)) {
      data[key] = value;
    } else if (typeof value === "string" && value.trim() !== "") {
      data[key] = value.trim();
    }
  }
  return data;
}

