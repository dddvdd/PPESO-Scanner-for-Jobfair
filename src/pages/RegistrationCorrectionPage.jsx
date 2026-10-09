import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import MissingProfileFields from "../components/MissingProfileFields.jsx";
import { SCANNER_PROFILE_FIELDS, initialProfileAnswers, changeProfileAnswer, profileAnswersToSave } from "../lib/scannerProfileFields.js";
import { registrationCorrectionDetails, submitRegistrationCorrection } from "../lib/api.js";

const CORRECTION_FIELDS = SCANNER_PROFILE_FIELDS;

function correctionToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
}

export default function RegistrationCorrectionPage() {
  const [token] = useState(correctionToken);
  const [details, setDetails] = useState(null);
  const [answers, setAnswers] = useState({});
  const [status, setStatus] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (!/^[a-f0-9]{64}$/.test(token)) {
      setStatus("invalid");
      return () => { cancelled = true; };
    }

    registrationCorrectionDetails(token).then((result) => {
      if (cancelled) return;
      if (!result.ok || result.data?.status !== "ok") {
        setStatus("invalid");
        return;
      }
      const missingFields = Array.isArray(result.data.missing_fields)
        ? result.data.missing_fields.filter((key) => CORRECTION_FIELDS[key])
        : [];
      if (missingFields.length === 0) {
        setStatus("invalid");
        return;
      }
      setDetails({ ...result.data, missing_fields: missingFields });
      setAnswers(initialProfileAnswers(missingFields));
      setStatus("ready");
    });

    return () => { cancelled = true; };
  }, [token]);

  function changeAnswer(field, value) {
    setAnswers((current) => changeProfileAnswer(current, field, value, details.missing_fields));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy || !details) return;
    setError(null);
    const firstMissing = details.missing_fields.find((key) => !answers[key]?.trim());
    if (firstMissing) {
      document.getElementById(`correction-${firstMissing}`)?.focus();
      document.getElementById(`addr-${firstMissing}`)?.focus();
      document.querySelector(`#field-${firstMissing} input`)?.focus();
      setError(`Please complete ${CORRECTION_FIELDS[firstMissing].label}.`);
      return;
    }

    setBusy(true);
    const result = await submitRegistrationCorrection(token, profileAnswersToSave(details.missing_fields, answers));
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.data?.status === "ok") {
      setStatus("complete");
    } else if (result.data?.status === "required_fields") {
      setError("Please complete every requested field.");
    } else if (result.data?.status === "invalid_answers") {
      setError("One or more answers are invalid. Please check your entries and try again.");
    } else {
      setStatus("invalid");
    }
  }

  if (status === "loading") {
    return <section className="page"><p role="status">Checking your correction link…</p></section>;
  }

  if (status === "invalid") {
    return (
      <section className="page">
        <h1 className="page-title">Correction link unavailable</h1>
        <p className="page-lead">This link may have expired, already been used, or been replaced. Please contact the Public Employment Service Office through the official Provincial Government of Cagayan contact channels for assistance.</p>
        <Link to="/" className="btn btn--ghost btn--small">Back to registration</Link>
      </section>
    );
  }

  if (status === "complete") {
    return (
      <section className="page">
        <h1 className="page-title">Thank you</h1>
        <p className="page-lead">Your registration details have been updated. You may close this page.</p>
      </section>
    );
  }

  return (
    <section className="page">
      <p className="page-kicker">Registration details</p>
      <h1 className="page-title">Complete missing information</h1>
      <p className="page-lead">
        Hello {details.first_name}. Complete the missing details for {details.event_name}.
        This secure link can be used only once.
      </p>
      <form className="form-stack" onSubmit={handleSubmit} noValidate>
        <fieldset className="form-section">
          <legend>Missing registration details</legend>
          <MissingProfileFields fields={details.missing_fields} answers={answers}
            disabled={busy} onChange={changeAnswer} idPrefix="correction"
            maxDate={new Date().toISOString().slice(0, 10)} />
        </fieldset>
        {error && <p role="alert" className="alert alert--error">{error}</p>}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "Saving…" : "Save corrected details"}
        </button>
      </form>
    </section>
  );
}
