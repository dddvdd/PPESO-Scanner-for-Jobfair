import AddressFieldsGroup from "./AddressFieldsGroup.jsx";
import ClassificationCardGroup from "./ClassificationCardGroup.jsx";
import { SCANNER_PROFILE_FIELDS, PROFILE_CLASSIFICATION_KEYS, PROFILE_ADDRESS_KEYS } from "../lib/scannerProfileFields.js";

export default function MissingProfileFields({ fields, answers, disabled, onChange, idPrefix, maxDate }) {
  const trio = PROFILE_CLASSIFICATION_KEYS.filter((key) => fields.includes(key));
  const addressFields = Object.values(PROFILE_ADDRESS_KEYS);
  const hasAddress = fields.some((key) => addressFields.includes(key));
  return <>
    {fields.map((key) => {
      if (addressFields.includes(key)) return null;
      if (trio.includes(key)) {
        if (key !== fields.find((field) => trio.includes(field))) return null;
        return <ClassificationCardGroup key={key} trio={trio}
          labels={Object.fromEntries(trio.map((field) => [field, SCANNER_PROFILE_FIELDS[field].label]))}
          answers={answers} disabled={disabled} onChange={onChange} />;
      }
      const field = SCANNER_PROFILE_FIELDS[key];
      if (!field) return null;
      const id = `${idPrefix}-${key}`;
      const props = { id, required: true, disabled, value: answers[key] ?? "",
        onChange: (event) => onChange(key, event.target.value) };
      return <div className="field" key={key}>
        <label htmlFor={id}>{field.label} *</label>
        {field.options ? <select {...props}>
          <option value="">Select an answer</option>
          {field.options.map((value) => <option key={value} value={value}>{value}</option>)}
        </select> : <input {...props} type={field.type} maxLength={200}
          max={field.type === "date" ? maxDate : undefined} />}
      </div>;
    })}
    {hasAddress && <>
      {addressFields.some((key) => !fields.includes(key)) &&
        <p>Select the province and municipality/city to find the missing address details. Only the requested missing fields will be saved.</p>}
      <AddressFieldsGroup keys={PROFILE_ADDRESS_KEYS} answers={answers} errors={{}}
        disabled={disabled} onChange={onChange} />
    </>}
  </>;
}
