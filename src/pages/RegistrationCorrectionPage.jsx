import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { registrationCorrectionDetails, submitRegistrationCorrection } from "../lib/api.js";

const CORRECTION_FIELDS = {
  date_of_birth: { label: "Date of Birth", type: "date" },
  course: { label: "Highest Educational Attainment", type: "text" },
  pwd: { label: "PWD?", type: "choice", options: ["Yes", "No"] },
  sex: { label: "Sex", type: "choice", options: ["Male", "Female"] },
  first_time_job_seeker: { label: "FIRST TIME JOB SEEKER", type: "yesNo" },
  returning_ofw: { label: "RETURNING OFW", type: "yesNo" },
  returning_worker: { label: "RETURNING WORKER", type: "yesNo" },
  interested_in_skills_training: { label: "INTERESTED IN SKILLS TRAINING", type: "choice", options: ["Yes", "No"] },
  province: { label: "Province", type: "text" },
  municipality_city: { label: "Municipality/City", type: "text" },
  barangay: { label: "Barangay", type: "text" },
};

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
      setAnswers(Object.fromEntries(missingFields.map((key) => [key, ""])));
      setStatus("ready");
    });

    return () => { cancelled = true; };
  }, [token]);

  function changeAnswer(field, value) {
    setAnswers((current) => {
      const next = { ...current, [field]: value };
      if (value === "yes" && ["first_time_job_seeker", "returning_ofw", "returning_worker"].includes(field)) {
        for (const sibling of ["first_time_job_seeker", "returning_ofw", "returning_worker"]) {
          if (sibling !== field && Object.hasOwn(next, sibling)) next[sibling] = "no";
        }
      }
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy || !details) return;
    setError(null);
    const firstMissing = details.missing_fields.find((key) => !answers[key]?.trim());
    if (firstMissing) {
      document.getElementById(`correction-${firstMissing}`)?.focus();
      setError(`Please complete ${CORRECTION_FIELDS[firstMissing].label}.`);
      return;
    }

    setBusy(true);
    const result = await submitRegistrationCorrection(token, answers);
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
          {details.missing_fields.map((key) => {
            const field = CORRECTION_FIELDS[key];
            const inputId = `correction-${key}`;
            if (field.type === "choice" || field.type === "yesNo") {
              const options = field.type === "yesNo" ? ["yes", "no"] : field.options;
              return (
                <div className="field" key={key}>
                  <span id={`${inputId}-label`} className="group-label">{field.label} *</span>
                  <div role="radiogroup" aria-labelledby={`${inputId}-label`}>
                    {options.map((option, index) => (
                      <label className="choice" key={option}>
                        <input
                          id={index === 0 ? inputId : `${inputId}-${index}`}
                          type="radio"
                          name={key}
                          required
                          value={option}
                          checked={answers[key] === option}
                          disabled={busy}
                          onChange={() => changeAnswer(key, option)}
                        />
                        {option === "yes" ? "Yes" : option === "no" ? "No" : option}
                      </label>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <div className="field" key={key}>
                <label htmlFor={inputId}>{field.label} *</label>
                <input
                  id={inputId}
                  type={field.type}
                  required
                  maxLength={field.type === "text" ? 200 : undefined}
                  max={field.type === "date" ? new Date().toISOString().slice(0, 10) : undefined}
                  value={answers[key] ?? ""}
                  disabled={busy}
                  onChange={(event) => changeAnswer(key, event.target.value)}
                />
              </div>
            );
          })}
        </fieldset>
        {error && <p role="alert" className="alert alert--error">{error}</p>}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "Saving…" : "Save corrected details"}
        </button>
      </form>
    </section>
  );
}
