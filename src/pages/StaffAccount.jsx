import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { signInWithPassword, updatePassword } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const MIN_LENGTH = 8;

export default function StaffAccount() {
  const { user, role } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [banner, setBanner] = useState(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (savingRef.current) return;

    const errors = {};
    if (!current) errors.current = "Enter your current password.";
    if (next.length < MIN_LENGTH) errors.next = `New password must be at least ${MIN_LENGTH} characters.`;
    if (confirm !== next) errors.confirm = "Passwords do not match.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    savingRef.current = true;
    setSaving(true);
    setBanner(null);
    setSuccess(false);

    // Re-verify the current password before allowing a change, so an
    // unattended open session can't be hijacked by a passer-by.
    const verify = await signInWithPassword(user?.email ?? "", current);
    if (!verify.ok) {
      savingRef.current = false;
      setSaving(false);
      if (verify.error.kind === "network") {
        setBanner(verify.error);
      } else {
        setFieldErrors({ current: "Current password is incorrect." });
      }
      return;
    }

    const result = await updatePassword(next);

    savingRef.current = false;
    setSaving(false);

    if (result.ok) {
      setSuccess(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } else {
      setBanner(result.error);
    }
  }

  return (
    <section className="page">
      <p className="page-kicker">Account</p>
      <h1 className="page-title">Change password</h1>
      <Link className="btn btn--primary btn--small" to="/staff/interviews">Interview Status</Link>
      <p className="page-lead">
        Signed in as <strong>{user?.email ?? "unknown"}</strong> ({role ?? "no role"}).
      </p>

      {success && (
        <p role="status" className="alert alert--info">
          Password updated. Use your new password next time you sign in.
        </p>
      )}

      {banner && (
        <p
          role="alert"
          className={`alert ${banner.kind === "network" ? "alert--error" : "alert--warn"}`}
        >
          {banner.message}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="form-stack">
        <fieldset className="form-section">
          <legend>Password</legend>
          <div className="form-stack">
            <div className="field">
              <label htmlFor="account-current">Current password</label>
              <input
                id="account-current"
                type="password"
                autoComplete="current-password"
                value={current}
                disabled={saving}
                aria-invalid={fieldErrors.current ? true : undefined}
                onChange={(e) => setCurrent(e.target.value)}
              />
              {fieldErrors.current && (
                <p role="alert" className="field-error">{fieldErrors.current}</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="account-new">New password</label>
              <input
                id="account-new"
                type="password"
                autoComplete="new-password"
                value={next}
                disabled={saving}
                aria-invalid={fieldErrors.next ? true : undefined}
                onChange={(e) => setNext(e.target.value)}
              />
              {fieldErrors.next && (
                <p role="alert" className="field-error">{fieldErrors.next}</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="account-confirm">Confirm new password</label>
              <input
                id="account-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                disabled={saving}
                aria-invalid={fieldErrors.confirm ? true : undefined}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {fieldErrors.confirm && (
                <p role="alert" className="field-error">{fieldErrors.confirm}</p>
              )}
            </div>
            <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
              {saving ? "Updating…" : "Update password"}
            </button>
          </div>
        </fieldset>
      </form>

      <p className="page-lead">
        {role === "admin" && (
          <>
            <Link to="/admin">Admin console</Link>
            {" · "}
          </>
        )}
        <Link to="/staff/scanner">Back to scanner</Link>
        {" · "}
        <Link to="/">Home</Link>
      </p>
    </section>
  );
}
