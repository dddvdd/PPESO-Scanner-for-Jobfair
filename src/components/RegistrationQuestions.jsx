import { useMemo } from "react";
import FormFieldRenderer from "./FormFieldRenderer.jsx";
import AddressFieldsGroup from "./AddressFieldsGroup.jsx";
import ClassificationCardGroup from "./ClassificationCardGroup.jsx";
import { resolveExclusiveGroups } from "../lib/registrationForm.js";

export default function RegistrationQuestions({ fields, answers, fieldErrors, submitting, handleAnswerChange, hideRequired }) {
  const exclusiveTrio = useMemo(() => resolveExclusiveGroups(fields)[0] ?? null, [fields]);
  const trioLabels = useMemo(() => {
    if (!exclusiveTrio) return {};
    const map = {};
    for (const key of exclusiveTrio) {
      const field = fields.find((f) => f.field_key === key);
      if (field) map[key] = field.label;
    }
    return map;
  }, [fields, exclusiveTrio]);

  const sortedFields = useMemo(() => fields, [fields]);

  // The cascading PSGC address block (Province -> Municipality/City ->
  // Barangay) replaces the three plain address fields wherever admins place
  // them; matched by field_key with a label fallback for older rows.
  const addressKeys = useMemo(() => {
    const find = (candidates) => {
      const field = fields.find(
        (f) =>
          candidates.includes(f.field_key.trim().toLowerCase()) ||
          candidates.includes(f.label.trim().toLowerCase().replace(/\s*\/\s*/g, " / "))
      );
      return field?.field_key ?? null;
    };
    return {
      province: find(["province"]),
      city: find(["city_municipality", "municipality / city"]),
      barangay: find(["barangay"]),
    };
  }, [fields]);

  const hasAddressGroup = Boolean(addressKeys.province && addressKeys.city && addressKeys.barangay);

  const plainFields = useMemo(() => {
    if (!hasAddressGroup) return sortedFields;
    const group = new Set(Object.values(addressKeys));
    return sortedFields.filter((f) => !group.has(f.field_key));
  }, [sortedFields, hasAddressGroup, addressKeys]);

  // The three exclusive classifications render as one card picker, placed
  // where the first of them appears; the rest keep their order.
  const { cardlessFields, cardsBefore, cardsAfter } = useMemo(() => {
    if (!exclusiveTrio) {
      return { cardlessFields: plainFields, cardsBefore: null, cardsAfter: null };
    }
    const trioSet = new Set(exclusiveTrio);
    const rest = [];
    let insertAt = -1;
    for (const field of plainFields) {
      if (trioSet.has(field.field_key)) {
        // First trio field encountered: its card group takes this slot.
        if (insertAt < 0) insertAt = rest.length;
        continue;
      }
      rest.push(field);
    }
    if (insertAt < 0) {
      return { cardlessFields: plainFields, cardsBefore: null, cardsAfter: null };
    }
    return {
      cardlessFields: rest,
      cardsBefore: rest.slice(0, insertAt),
      cardsAfter: rest.slice(insertAt),
    };
  }, [plainFields, exclusiveTrio]);

  const trioHasError = Boolean(
    exclusiveTrio?.some((key) => fieldErrors[key])
  );

  return <>
        {sortedFields.length > 0 && (
          <fieldset className="form-section">
            <legend>
              Registration questions
            </legend>
            {hasAddressGroup && (
              <AddressFieldsGroup
                keys={addressKeys}
                answers={answers}
                errors={fieldErrors}
                disabled={submitting}
                onChange={handleAnswerChange}
                hideRequired={hideRequired}
              />
            )}
            {(cardsBefore ?? cardlessFields).map((field) => (
              <FormFieldRenderer
                key={field.field_key}
                field={field}
                value={answers[field.field_key]}
                error={fieldErrors[field.field_key]}
                disabled={submitting}
                onChange={handleAnswerChange}
                hideRequired={hideRequired}
              />
            ))}
            {exclusiveTrio && (
              <ClassificationCardGroup
                trio={exclusiveTrio}
                labels={trioLabels}
                answers={answers}
                hasError={trioHasError}
                disabled={submitting}
                onChange={handleAnswerChange}
              />
            )}
            {(cardsAfter ?? []).map((field) => (
              <FormFieldRenderer
                key={field.field_key}
                field={field}
                value={answers[field.field_key]}
                error={fieldErrors[field.field_key]}
                disabled={submitting}
                onChange={handleAnswerChange}
                hideRequired={hideRequired}
              />
            ))}
          </fieldset>
        )}

  </>;
}
