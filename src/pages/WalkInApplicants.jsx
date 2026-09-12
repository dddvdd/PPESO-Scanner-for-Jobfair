import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listWalkInEvents, getWalkInForm, recordWalkIn } from "../lib/api.js";

import { IdentityField } from "../components/FormFieldRenderer.jsx";
import RegistrationQuestions from "../components/RegistrationQuestions.jsx";
import { initialAnswers, validateIdentity, validateAnswers, buildFormData, resolveExclusiveGroups } from "../lib/registrationForm.js";

const EMPTY = { firstName: "", middleName: "", lastName: "", suffix: "", email: "", mobileNumber: "" };
const ERRORS = {
  forbidden: "Only staff and admins can record walk-in applicants.",
  event_not_eligible: "This activity is no longer eligible. Select an activity from the previous five days.",
  duplicate_registration: "This email is already registered for this activity. No new attendance was recorded. Check the existing registrant in the scanner list.",
  missing_required_fields: "Enter the applicant's first name, last name, and mobile number.",
  invalid_email: "Enter a valid email address.",
  form_not_found: "This activity has no published registration form. Ask an admin to publish its form.",
  invalid_fields: "Check the length of the applicant details.",
};

export default function WalkInApplicants() {
  const [events, setEvents] = useState(null);
  const [eventId, setEventId] = useState("");
  const [draft, setDraft] = useState(EMPTY);
  const [formState, setFormState] = useState(null);
  const [formError, setFormError] = useState(null);
  const [formAttempt, setFormAttempt] = useState(0);
  const [answers, setAnswers] = useState({});
  const [identityErrors, setIdentityErrors] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  const successRef = useRef(null);
  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);
  useEffect(() => {
    let active = true;
    setEvents(null);
    listWalkInEvents().then(result => {
      if (!active) return;
      if (result.ok && result.data?.status === "ok") {
        const available = result.data.events ?? [];
        setEvents(available);
        setEventId(current => available.some(event => event.id === current) ? current : "");
      } else {
        setError("Could not load eligible activities. Please retry.");
      }
    });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    let active = true;
    setFormState(null); setFormError(null); setAnswers({}); setFieldErrors({}); setConfirmed(false);
    if (eventId) getWalkInForm(eventId).then(result => {
      if (!active) return;
      if (result.ok && result.data?.status === "ok") {
        setFormState({ ...result.data, eventId });
        setAnswers(initialAnswers(result.data.fields));
      } else setFormError(ERRORS[result.data?.status] ?? "Could not load registration questions. Please retry.");
    });
    return () => { active = false; };
  }, [eventId, formAttempt]);
  const formReady = formState?.eventId === eventId;
  const fields = formReady ? formState.fields : [];
  function changeAnswer(key, value) {
    setAnswers(current => {
      const next = { ...current, [key]: value };
      if (typeof value === "string" && value.trim().toLowerCase() === "yes") for (const group of resolveExclusiveGroups(fields)) {
        if (group.includes(key)) for (const sibling of group) if (sibling !== key) next[sibling] = "no";
      }
      return next;
    });
  }
  const selected = events?.find(event => event.id === eventId);
  async function submit(event) {
    event.preventDefault();
    if (busy.current || !selected || !confirmed || !formReady) return;
    busy.current = true; setSaving(true); setError(null); setSuccess(null);
    try {
      const result = await recordWalkIn(eventId, draft, formState.form.id, buildFormData(answers));
      if (!result.ok || result.data?.status !== "success") {
        if (result.ok && result.data?.status === "invalid_answer") {
          setFieldErrors({ [result.data.field]: result.data.message });
        }
        setError(result.ok ? ERRORS[result.data?.status] ?? result.data?.message ?? "Could not save this applicant. Please retry." : "Unable to confirm the save. Retry with the same details; duplicate entries are blocked.");
        if (result.data?.status === "event_not_eligible") setAttempt(value => value + 1);
        return;
      }
      setSuccess(`${draft.firstName.trim()} ${draft.lastName.trim()} saved for ${selected.name}. Attendance: ${result.data.attendance_date}. Registration: ${result.data.registration_number}. Included in total check-ins.`);
      setDraft(EMPTY); setAnswers(initialAnswers(fields)); setIdentityErrors({}); setFieldErrors({}); setConfirmed(false);
    } finally { busy.current = false; setSaving(false); }
  }
  return <section className="page">
    <p className="page-kicker">Staff &amp; admin</p>
    <h1 className="page-title">Walk-in applicants</h1>
    <p className="page-lead">Record applicants who attended without pre-registering. Only activities held 1–5 days ago are available, based on Philippine time.</p>
    <Link to="/staff/scanner" className="btn btn--ghost btn--small">Back to scanner</Link>
    {error && <p role="alert" className="alert alert--error">{error}</p>}
    {success && <p ref={successRef} tabIndex={-1} role="status" className="alert alert--info">{success}</p>}
    {events === null ? <>
      {!error && <p role="status">Loading eligible activities...</p>}
      {error && <button className="btn btn--ghost" onClick={() => { setError(null); setAttempt(value => value + 1); }}>Retry activities</button>}
    </> : events.length === 0 ? <p>No activities were held in the previous five days.</p> :
      <form className="form-stack" onSubmit={submit} noValidate>
        <label className="field" htmlFor="walk-in-event">Activity *</label>
        <select id="walk-in-event" required value={eventId} disabled={saving} onChange={event => { setEventId(event.target.value); setConfirmed(false); setSuccess(null); }}>
          <option value="">Select a past activity</option>
          {events.map(event => <option key={event.id} value={event.id}>{event.name} — {event.event_date}</option>)}
        </select>
        {eventId && !formReady && !formError && <p role="status">Loading event registration form...</p>}
        {formError && <div role="alert"><p>{formError}</p><button className="btn btn--ghost" type="button" onClick={() => setFormAttempt(value => value + 1)}>Retry form</button></div>}
        {formReady && <>
          <fieldset className="form-section">
            <legend>Applicant details</legend>
            {["firstName", "middleName", "lastName", "suffix", "email", "mobileNumber"].map(name =>
              <IdentityField key={name} name={name} value={draft[name]} error={identityErrors[name]} disabled={saving}
                onChange={(key, value) => setDraft(current => ({ ...current, [key]: value }))} />)}
          </fieldset>
          <RegistrationQuestions fields={fields} answers={answers} fieldErrors={fieldErrors}
            submitting={saving} handleAnswerChange={changeAnswer} />
        </>}
        <label className="choice">
          <input type="checkbox" required checked={confirmed} disabled={saving || !selected || !formReady} onChange={event => setConfirmed(event.target.checked)} />
          I confirm this walk-in attended {selected ? `${selected.name} on ${selected.event_date}` : "the selected activity"}.
        </label>
        <p className="field-help">Saves registration and attendance together as a post-event walk-in. Your account and the actual recording time are retained.</p>
        <button type="submit" className="btn btn--primary" disabled={saving || !selected || !formReady || !confirmed}>{saving ? "Saving..." : "Save walk-in and attendance"}</button>
      </form>}
  </section>;
}
