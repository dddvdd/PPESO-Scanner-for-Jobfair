import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getPublishedFormWithFields, listPublishedEvents, registerApplicant } from "../lib/api.js";
import FormFieldRenderer, { IdentityField } from "../components/FormFieldRenderer.jsx";
import AddressFieldsGroup from "../components/AddressFieldsGroup.jsx";
import ClassificationCardGroup from "../components/ClassificationCardGroup.jsx";

const AVAILABILITY_MESSAGE = "This form is no longer available.";
const DUPLICATE_MESSAGE = "This registration already exists — retrieve your ticket instead.";

const CONSENT_HEADING = "Data Privacy Consent";
const CONSENT_ERROR = "Please tick the Data Privacy Consent box before submitting.";
const CONSENT_PARAGRAPHS = [
  "I understand that the Public Employment Service Office (PESO) is committed to protecting and respecting my personal data in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173).",
  "By checking the box below, I voluntarily give my consent to the collection, recording, use, processing, storage, and retention of my personal information for the purpose of processing my jobseeker registration and my participation in this job fair.",
  "I also acknowledge my rights as a data subject under the law, including the right to access, correct, and request the deletion of my personal information.",
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER_PATTERN = /^-?[0-9]+(\.[0-9]+)?$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * Fields where answering Yes excludes the others (only one classification
 * applies). Matched by field_key with lowercased label fallback.
 */
const EXCLUSIVE_YES_FIELDS = [
  ["first_time_job_seeker", "first time job seeker?"],
  ["returning_ofw", "returning ofw?"],
  ["returning_worker", "returning worker?"],
];

function resolveExclusiveGroups(allFields) {
  const findKey = ([key, label]) =>
    allFields.find(
      (f) => f.field_key === key || f.label.trim().toLowerCase() === label
    )?.field_key;
  const group = EXCLUSIVE_YES_FIELDS.map(findKey).filter(Boolean);
  return group.length > 1 ? [group] : [];
}

function initialIdentity() {
  return { firstName: "", lastName: "", email: "", mobileNumber: "", middleName: "", suffix: "" };
}

function initialAnswers(fields) {
  const answers = {};
  for (const field of fields) {
    answers[field.field_key] =
      field.field_type === "checkbox" || field.field_type === "multi_select" ? [] : "";
  }
  return answers;
}

function validateIdentity(identity) {
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

function validateAnswers(fields, answers) {
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
function buildFormData(answers) {
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

export default function RegisterPage() {
  const { eventId, formId } = useParams();
  const navigate = useNavigate();
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unavailableMessage, setUnavailableMessage] = useState(null);
  const [eventName, setEventName] = useState(null);
  const [form, setForm] = useState(null);
  const [fields, setFields] = useState([]);
  const [identity, setIdentity] = useState(initialIdentity);
  const [answers, setAnswers] = useState({});
  const [identityErrors, setIdentityErrors] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentError, setConsentError] = useState(null);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    if (!UUID_PATTERN.test(String(eventId ?? "")) || !UUID_PATTERN.test(String(formId ?? ""))) {
      setUnavailableMessage(AVAILABILITY_MESSAGE);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setUnavailableMessage(null);

    (async () => {
      const eventsResult = await listPublishedEvents();
      if (cancelled) return;
      if (!eventsResult.ok) {
        setBanner(eventsResult.error.kind === "network" ? eventsResult.error : null);
        setLoading(false);
        return;
      }
      const event = (eventsResult.data ?? []).find((e) => e.id === eventId);
      if (!event) {
        setUnavailableMessage(AVAILABILITY_MESSAGE);
        setLoading(false);
        return;
      }

      const formResult = await getPublishedFormWithFields(eventId);
      if (cancelled) return;
      if (!formResult.ok || !formResult.data?.form || formResult.data.form.id !== formId) {
        setUnavailableMessage(AVAILABILITY_MESSAGE);
        setLoading(false);
        return;
      }

      setEventName(event.name);
      setForm(formResult.data.form);
      setFields(formResult.data.fields);
      setAnswers(initialAnswers(formResult.data.fields));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, formId]);

  const handleIdentityChange = useCallback((name, value) => {
    setIdentity((prev) => ({ ...prev, [name]: value }));
  }, []);

  const exclusiveGroups = useMemo(() => resolveExclusiveGroups(fields), [fields]);
  const exclusiveTrio = exclusiveGroups[0] ?? null;
  const exclusiveGroupsRef = useRef([]);
  exclusiveGroupsRef.current = exclusiveGroups;

  const trioLabels = useMemo(() => {
    if (!exclusiveTrio) return {};
    const map = {};
    for (const key of exclusiveTrio) {
      const field = fields.find((f) => f.field_key === key);
      if (field) map[key] = field.label;
    }
    return map;
  }, [fields, exclusiveTrio]);

  const handleAnswerChange = useCallback((key, value) => {
    setAnswers((prev) => {
      const next = { ...prev, [key]: value };
      // Yes on one classification forces No on its group siblings, so at
      // most one of the choices can ever be Yes.
      if (typeof value === "string" && value.trim().toLowerCase() === "yes") {
        for (const group of exclusiveGroupsRef.current) {
          if (!group.includes(key)) continue;
          for (const sibling of group) {
            if (sibling !== key) next[sibling] = "no";
          }
        }
      }
      return next;
    });
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current) return;

    const idErrors = validateIdentity(identity);
    const answerErrors = validateAnswers(fields, answers);

    // Data Privacy Consent is mandatory before any data is sent.
    const consentMissing = !consentGiven;
    setConsentError(consentMissing ? CONSENT_ERROR : null);

    setIdentityErrors(idErrors);
    setFieldErrors(answerErrors);

    if (
      Object.keys(idErrors).length > 0 ||
      Object.keys(answerErrors).length > 0 ||
      consentMissing
    ) {
      setBanner({
        kind: "application",
        message: consentMissing
          ? CONSENT_ERROR
          : "Please fix the highlighted fields before continuing.",
      });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setBanner(null);

    const result = await registerApplicant({
      eventId,
      formId,
      firstName: identity.firstName,
      lastName: identity.lastName,
      email: identity.email,
      mobileNumber: identity.mobileNumber,
      middleName: identity.middleName,
      suffix: identity.suffix,
      formData: buildFormData(answers),
    });

    if (result.ok) {
      // Hand-off to the ticket flow uses router location state only: no URL
      // params, no storage, no logging. RegistrationSuccess renders the QR
      // ticket immediately; /retrieve-ticket remains the recovery path if
      // this transient state is lost.
      navigate("/registration/success", {
        replace: true,
        state: {
          registrationNumber: result.data.registrationNumber,
          ticketToken: result.data.ticketToken,
          firstName: identity.firstName.trim(),
          lastName: identity.lastName.trim(),
          eventName: eventName ?? null,
        },
      });
      return;
    }

    submittingRef.current = false;
    setSubmitting(false);

    const failure = result.error;
    switch (failure.token) {
      case "FORM_NOT_FOUND":
      case "EVENT_NOT_PUBLISHED":
      case "FORM_NOT_PUBLISHED":
        setUnavailableMessage(AVAILABILITY_MESSAGE);
        break;
      case "DUPLICATE_REGISTRATION":
        setBanner({ kind: "application", message: DUPLICATE_MESSAGE, duplicate: true });
        break;
      case "INVALID_EMAIL":
        setIdentityErrors((prev) => ({ ...prev, email: failure.message }));
        break;
      case "INVALID_MOBILE":
        setIdentityErrors((prev) => ({ ...prev, mobileNumber: failure.message }));
        break;
      default:
        if (failure.field) {
          setFieldErrors((prev) => ({ ...prev, [failure.field]: failure.message }));
          setBanner({ kind: failure.kind, message: "Please fix the highlighted fields before continuing." });
        } else {
          setBanner(failure);
        }
    }
  }

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

  if (loading) {
    return (
      <section className="page">
        <p className="status-line" role="status">
          Loading registration form…
        </p>
      </section>
    );
  }

  if (unavailableMessage) {
    return (
      <section className="page">
        <h1 className="page-title">Registration</h1>
        <p role="alert" className="alert alert--warn">
          {unavailableMessage}
        </p>
        <p className="page-lead">
          {banner?.kind === "network"
            ? banner.message
            : "You can check which events are currently open below."}
        </p>
        {banner?.kind === "network" ? (
          <Link className="btn btn--ghost btn--small" to={`/events/${eventId}/register/${formId}`}>
            Try again
          </Link>
        ) : (
          <Link className="btn btn--ghost btn--small" to="/events">
            View published events
          </Link>
        )}
      </section>
    );
  }

  return (
    <section className="page">
      <div>
        <p className="page-kicker">Registration</p>
        <h1 className="page-title">Register{eventName ? ` — ${eventName}` : ""}</h1>
        {form?.name && <p className="page-lead mt-8">{form.name}</p>}
      </div>

      {banner && (
        <div
          role="alert"
          className={`alert ${banner.kind === "network" ? "alert--error" : "alert--warn"}`}
        >
          <p>{banner.message}</p>
          {banner.duplicate && (
            <p>
              Ticket retrieval arrives in the next update. Meanwhile you can{" "}
              <Link to="/events">return to published events</Link>.
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="form-stack">
        <fieldset className="form-section">
          <legend>Your details</legend>
          <IdentityField name="firstName" value={identity.firstName} error={identityErrors.firstName} disabled={submitting} onChange={handleIdentityChange} />
          <IdentityField name="middleName" value={identity.middleName} error={identityErrors.middleName} disabled={submitting} onChange={handleIdentityChange} />
          <IdentityField name="lastName" value={identity.lastName} error={identityErrors.lastName} disabled={submitting} onChange={handleIdentityChange} />
          <IdentityField name="suffix" value={identity.suffix} error={identityErrors.suffix} disabled={submitting} onChange={handleIdentityChange} />
          <IdentityField name="email" value={identity.email} error={identityErrors.email} disabled={submitting} onChange={handleIdentityChange} />
          <IdentityField name="mobileNumber" value={identity.mobileNumber} error={identityErrors.mobileNumber} disabled={submitting} onChange={handleIdentityChange} />
        </fieldset>

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
              />
            )}
            {(cardsBefore ?? cardlessFields).map((field) => (
              <FormFieldRenderer
                key={field.id}
                field={field}
                value={answers[field.field_key]}
                error={fieldErrors[field.field_key]}
                disabled={submitting}
                onChange={handleAnswerChange}
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
                key={field.id}
                field={field}
                value={answers[field.field_key]}
                error={fieldErrors[field.field_key]}
                disabled={submitting}
                onChange={handleAnswerChange}
              />
            ))}
          </fieldset>
        )}

        {/* Mandatory Data Privacy Act consent — submission is blocked until ticked */}
        <fieldset className="form-section" aria-describedby={consentError ? "consent-error" : undefined}>
          <legend>{CONSENT_HEADING}</legend>
          <div className="consent-text">
            {CONSENT_PARAGRAPHS.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          <label className="choice consent-check">
            <input
              type="checkbox"
              checked={consentGiven}
              disabled={submitting}
              aria-invalid={consentError ? true : undefined}
              onChange={(e) => {
                setConsentGiven(e.target.checked);
                if (e.target.checked) setConsentError(null);
              }}
            />
            <span>
              I have read and understood the Data Privacy Consent above, and I
              voluntarily give my consent.
            </span>
          </label>
          {consentError && (
            <p id="consent-error" role="alert" className="field-error">
              {consentError}
            </p>
          )}
        </fieldset>

        <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit registration"}
        </button>
      </form>
    </section>
  );
}
