import { useId, useState } from "react";

export default function PasswordInput({ id, disabled, ...props }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? "Hide password" : "Show password";

  return (
    <span className="password-input">
      <input {...props} id={inputId} type={visible ? "text" : "password"} disabled={disabled} />
      <button
        className="password-toggle"
        type="button"
        aria-label={toggleLabel}
        aria-controls={inputId}
        aria-pressed={visible}
        title={toggleLabel}
        disabled={disabled}
        onClick={() => setVisible((value) => !value)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </span>
  );
}
