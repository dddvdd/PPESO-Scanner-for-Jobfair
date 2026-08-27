import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { signInWithPassword } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";

/**
 * Staff/admin sign-in. Applicants never authenticate.
 *
 * After a successful Supabase Auth sign-in the AuthContext resolves the
 * application role via my_role(); this page simply waits for that result and
 * lets StaffRoute decide. A signed-in staff/admin landing here is sent
 * straight to the scanner.
 */
export default function StaffLogin() {
  const { session, role, roleLoading, initializing } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!initializing && session && !roleLoading) {
    if (role === "staff" || role === "admin") {
      return <Navigate to={location.state?.from ?? (role === "admin" ? "/admin" : "/staff/scanner")} replace />;
    }
    // Signed in but not operational staff — same boundary as the scanner.
    return (
      <section className="page">
        <h1 className="page-title">Staff check-in</h1>
        <p role="alert" className="alert alert--error">
          You are not authorized to use the check-in scanner.
        </p>
      </section>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const result = await signInWithPassword(email, password);
    if (result.ok) {
      // AuthContext picks up SIGNED_IN and resolves the role; rerender then
      // redirects via the block above.
      return;
    }
    setSubmitting(false);
    setError(result.error);
  }

  return (
    <section className="page">
      <div className="glass-card hero-card" style={{ maxWidth: 400 }}>
        <p className="page-kicker">Staff access</p>
        <h1 className="page-title">Staff check-in</h1>
        <p className="page-lead">
          Sign in with your staff account to open the ticket scanner.
        </p>

        {error && (
          <p role="alert" className="alert alert--error">
            {error.kind === "network"
              ? error.message
              : error.message ?? "Sign-in failed. Please try again."}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-stack">
            <div className="field">
              <label htmlFor="staff-email">Email</label>
              <input
                id="staff-email"
                type="email"
                autoComplete="username"
                value={email}
                disabled={submitting}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="staff-password">Password</label>
              <input
                id="staff-password"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={submitting}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>

        {session && roleLoading && (
          <p role="status" className="status-line">
            Checking authorization…
          </p>
        )}
      </div>
    </section>
  );
}
