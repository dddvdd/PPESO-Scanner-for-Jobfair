/**
 * Renders one form_field row (backend enum field_type, core_schema):
 *   short_text | long_text | number | date | dropdown | radio |
 *   checkbox | multi_select | yes_no
 *
 * Value contract (must match register_applicant / form_data):
 *   scalar fields  → string ("yes"/"no" for yes_no)
 *   checkbox and multi_select → array of exact option strings
 */

const IDENTITY = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  mobileNumber: "Mobile number",
  middleName: "Middle name (If Applicable)",
  suffix: "Suffix (optional)",
};

const IDENTITY_PLACEHOLDER = {
  firstName: "Juan",
  middleName: "Reyes",
  lastName: "Dela Cruz",
  suffix: "e.g. Jr., III",
  email: "juandelacruz@example.com",
  mobileNumber: "0917 123 4567",
};

// Sample text for dynamic short_text fields; matched by field_key with the
// lowercased label as fallback.
const FIELD_PLACEHOLDER = {
  course: "e.g. BS Information Technology",
};

function placeholderFor(field) {
  if (!field) return undefined;
  const key = String(field.field_key ?? "").trim().toLowerCase();
  if (FIELD_PLACEHOLDER[key]) return FIELD_PLACEHOLDER[key];
  return FIELD_PLACEHOLDER[String(field.label ?? "").trim().toLowerCase()];
}

function optionsOf(field) {
  return Array.isArray(field?.options) ? field.options : [];
}

export function IdentityField({ name, value, error, disabled, onChange }) {
  const type = name === "email" ? "email" : "text";
  const inputMode = name === "mobileNumber" ? "tel" : undefined;
  return (
    <div>
      <label htmlFor={`identity-${name}`}>{IDENTITY[name]}</label>
      <input
        id={`identity-${name}`}
        type={type}
        inputMode={inputMode}
        placeholder={IDENTITY_PLACEHOLDER[name]}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(name, e.target.value)}
      />
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export default function FormFieldRenderer({ field, value, error, disabled, onChange }) {
  const options = optionsOf(field);
  const id = `field-${field.field_key}`;
  const describedBy = error ? `${id}-error` : undefined;

  let control;

  switch (field.field_type) {
    case "short_text":
      control = (
        <input
          id={id}
          type="text"
          placeholder={placeholderFor(field)}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(e) => onChange(field.field_key, e.target.value)}
        />
      );
      break;

    case "long_text":
      control = (
        <textarea
          id={id}
          rows={3}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(e) => onChange(field.field_key, e.target.value)}
        />
      );
      break;

    case "number":
      control = (
        <input
          id={id}
          type="text"
          inputMode="decimal"
          placeholder="e.g. 25 or 25.5"
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(e) => onChange(field.field_key, e.target.value)}
        />
      );
      break;

    case "date":
      control = (
        <input
          id={id}
          type="date"
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(e) => onChange(field.field_key, e.target.value)}
        />
      );
      break;

    case "dropdown":
      control = (
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(e) => onChange(field.field_key, e.target.value)}
        >
          <option value="">— Select —</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
      break;

    case "radio":
      control = (
        <div role="radiogroup" aria-labelledby={`${id}-label`}>
          {options.map((option) => (
            <label key={option} className="choice">
              <input
                type="radio"
                name={id}
                value={option}
                checked={value === option}
                disabled={disabled}
                onChange={() => onChange(field.field_key, option)}
              />
              {option}
            </label>
          ))}
        </div>
      );
      break;

    case "checkbox":
    case "multi_select": {
      const selected = Array.isArray(value) ? value : [];
      const toggle = (option) => {
        onChange(
          field.field_key,
          selected.includes(option)
            ? selected.filter((v) => v !== option)
            : [...selected, option]
        );
      };
      control = (
        <div>
          {options.map((option) => (
            <label key={option} className="choice">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                disabled={disabled}
                onChange={() => toggle(option)}
              />
              {option}
            </label>
          ))}
        </div>
      );
      break;
    }

    case "yes_no":
      control = (
        <div role="radiogroup" aria-labelledby={`${id}-label`}>
          {["yes", "no"].map((option) => (
            <label key={option} className="choice">
              <input
                type="radio"
                name={id}
                value={option}
                checked={value === option}
                disabled={disabled}
                onChange={() => onChange(field.field_key, option)}
              />
              {option === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
      );
      break;

    default:
      control = (
        <input
          id={id}
          type="text"
          placeholder={placeholderFor(field)}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(e) => onChange(field.field_key, e.target.value)}
        />
      );
  }

  return (
    <div>
      <label id={`${id}-label`} htmlFor={field.field_type === "short_text" || field.field_type === "long_text" || field.field_type === "number" || field.field_type === "date" || field.field_type === "dropdown" ? id : undefined}>
        {field.label}
        {field.required ? " *" : ""}
      </label>
      {control}
      {error && (
        <p id={`${id}-error`} role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
