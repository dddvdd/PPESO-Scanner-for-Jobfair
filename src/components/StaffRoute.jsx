import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

function UnauthorizedPanel({ adminOnly }) {
  return (
    <section className="page">
      <h1 className="page-title">{adminOnly ? "Admin area" : "Staff check-in"}</h1>
      <p role="alert" className="alert alert--error">
        {adminOnly
          ? "You are not authorized to access the admin area."
          : "You are not authorized to use the check-in scanner."}
      </p>
      <p className="page-lead">
        {adminOnly
          ? "This section is limited to administrator accounts."
          : "This account is signed in but does not have an operational role for this page."}
      </p>
      <div className="link-row">
        <Link className="link" to="/">
          Back to home
        </Link>
      </div>
    </section>
  );
}

/**
 * Navigation-level guard ONLY. The authoritative authorization remains the
 * RPCs + Supabase policies; this component just keeps the wrong roles out of
 * operational interfaces (UX boundary).
 *
 * Decisions use AuthContext.role (my_role RPC) — never session.user.role.
 *
 *   <StaffRoute>            staff or admin  (scanner)
 *   <StaffRoute adminOnly>  admin only      (admin console)
 */
export default function StaffRoute({ children, adminOnly = false }) {
  const { session, initializing, role, roleLoading, refreshRole } = useAuth();
  const location = useLocation();

  if (initializing || (session && role === null && roleLoading)) {
    return (
      <section className="page">
        <p role="status" className="status-line">
          Checking access…
        </p>
      </section>
    );
  }

  if (!session) {
    return <Navigate to="/staff/login" replace state={{ from: location.pathname }} />;
  }

  const allowed = adminOnly ? role === "admin" : role === "staff" || role === "admin";

  if (!allowed) {
    if (!roleLoading) {
      // Fail closed. A transient role-resolution failure looks identical to a
      // missing role; offer an explicit retry.
      return (
        <section className="page">
          <UnauthorizedPanel adminOnly={adminOnly} />
          <button type="button" className="btn btn--ghost btn--small" onClick={() => refreshRole()}>
            Retry authorization check
          </button>
        </section>
      );
    }
    return (
      <section className="page">
        <p role="status" className="status-line">
          Checking access…
        </p>
      </section>
    );
  }

  return children;
}
