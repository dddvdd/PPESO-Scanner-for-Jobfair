import { useEffect, useId, useRef, useState } from "react";

/**
 * Per-field explainer shown in a small bubble anchored to the "?" button.
 * Matched by field_key with lowercased label fallback.
 */
const CARD_TIPS = {
  first_time_job_seeker:
    "You have never held formal employment before — this job fair is your first time applying for work.",
  returning_ofw:
    "You previously worked overseas as an Overseas Filipino Worker and are now seeking employment again.",
  returning_worker:
    "Workers who originate from Cagayan, sought employment outside the province, and have now returned home to find work within the province.",
};

function tipFor(key, label) {
  if (CARD_TIPS[key]) return CARD_TIPS[key];
  return CARD_TIPS[String(label ?? "").trim().toLowerCase()];
}

function InfoTip({ id, tipText, disabled }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!tipText) return null;

  return (
    <span className="tip-wrap" ref={wrapRef}>
      <button
        type="button"
        className="choice-tip"
        aria-label="What does this mean?"
        aria-expanded={open}
        aria-describedby={id}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        ?
      </button>
      {open && (
        <span role="tooltip" id={id} className="tip-pop">
          {tipText}
        </span>
      )}
    </span>
  );
}

/**
 * Single-select card picker replacing three mutually exclusive yes/no fields.
 * Selecting a card stores "yes" on that field; the shared change handler in
 * RegisterPage flips its group siblings to "no", so form_data keeps the exact
 * shape the backend expects (each field present as "yes"/"no").
 */
export default function ClassificationCardGroup({
  trio,
  labels,
  answers,
  hasError,
  disabled,
  onChange,
}) {
  const groupId = useId();
  const selected = trio.find((key) => answers[key] === "yes") ?? null;

  return (
    <div className="field">
      <span id={`${groupId}-label`} className="group-label">
        Which best describes you? *
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${groupId}-label`}
        aria-required="true"
        aria-invalid={hasError ? true : undefined}
        aria-describedby={hasError ? `${groupId}-error` : undefined}
        className="choice-cards"
      >
        {trio.map((key) => {
          const isSelected = selected === key;
          const label = labels[key] ?? key;
          return (
            <label
              key={key}
              className={`choice-card ${isSelected ? "choice-card--selected" : ""} ${
                disabled ? "choice-card--disabled" : ""
              }`}
            >
              <input
                type="radio"
                name={`${groupId}-classification`}
                value={key}
                checked={isSelected}
                disabled={disabled}
                onChange={() => onChange(key, "yes")}
              />
              <span className="choice-card-text">
                {label}
                <InfoTip
                  id={`${groupId}-tip-${key}`}
                  tipText={tipFor(key, label)}
                  disabled={disabled}
                />
              </span>
              <span className="choice-check" aria-hidden="true">
                {isSelected && (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <path
                      d="M4 12.5l5.5 5.5L20 6.5"
                      stroke="#ffffff"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {hasError && (
        <p id={`${groupId}-error`} role="alert" className="field-error">
          Please choose the one option that applies to you.
        </p>
      )}
    </div>
  );
}
