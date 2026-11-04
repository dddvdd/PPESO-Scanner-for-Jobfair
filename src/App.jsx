import { lazy, Suspense, useState, useEffect, useRef, useCallback } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import EventPicker from "./pages/EventPicker.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import RegistrationCorrectionPage from "./pages/RegistrationCorrectionPage.jsx";
import RegistrationSuccess from "./pages/RegistrationSuccess.jsx";
import StaffLogin from "./pages/StaffLogin.jsx";
import StaffAccount from "./pages/StaffAccount.jsx";
import StaffRoute from "./components/StaffRoute.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import pesoSeal from "./assets/peso-seal.png";

const StaffScanner = lazy(() => import("./pages/StaffScanner.jsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.jsx"));
const EventRegistrantsPage = lazy(() => import("./pages/EventRegistrantsPage.jsx"));
const VacanciesPage = lazy(() => import("./pages/VacanciesPage.jsx"));
const InterviewStatus = lazy(() => import("./pages/InterviewStatus.jsx"));
const WalkInApplicants = lazy(() => import("./pages/WalkInApplicants.jsx"));

function HamburgerMenu() {
  const { session, role, mustChangePassword, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector("button, a")?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onPointerDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) {
        close();
      }
    }
    function onKeyDown(e) {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const controls = [...panelRef.current.querySelectorAll("a[href], button:not(:disabled)")];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const isLoggedIn = Boolean(session);
  const isAdmin = role === "admin";
  const isStaff = role === "staff" || isAdmin;

  return (
    <>
      <button
        ref={btnRef}
        className="nav-hamburger"
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen(o => !o)}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {open ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></> : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>}
        </svg>
        <span>Menu</span>
      </button>

      {open && (
        <div className="nav-overlay" onClick={close} />
      )}

      <div ref={panelRef} id="site-menu" className={`nav-drawer${open ? " nav-drawer--open" : ""}`} role="dialog" aria-modal={open ? "true" : undefined} aria-label="Navigation" aria-hidden={!open} inert={open ? undefined : ""}>
        <div className="nav-drawer-header">
          <span className="nav-drawer-role">{isLoggedIn ? (isAdmin ? "Admin" : "Staff") : "Navigation"}</span>
          <button type="button" className="nav-close" onClick={close}>Close menu</button>
        </div>

        <div className="nav-drawer-section">
          <span className="nav-drawer-label">Public</span>
          <NavLink className="nav-drawer-link" to="/" onClick={close}>Register</NavLink>
        </div>

        {isLoggedIn && isStaff && !mustChangePassword && (
          <div className="nav-drawer-section">
            <span className="nav-drawer-label">Staff Tools</span>
            <NavLink className="nav-drawer-link" to="/staff/scanner" onClick={close}>Scanner</NavLink>
            <NavLink className="nav-drawer-link" to="/staff/interviews" onClick={close}>Interview Status</NavLink>
            <NavLink className="nav-drawer-link" to="/staff/walk-ins" onClick={close}>Walk-in Applicants</NavLink>
          </div>
        )}

        {isAdmin && !mustChangePassword && (
          <div className="nav-drawer-section">
            <span className="nav-drawer-label">Admin</span>
            <NavLink className="nav-drawer-link" to="/admin" end onClick={close}>Admin Console</NavLink>
            <NavLink className="nav-drawer-link" to="/admin/vacancies" onClick={close}>Vacancies</NavLink>
          </div>
        )}

        {isLoggedIn ? (
          <div className="nav-drawer-section">
            <NavLink className="nav-drawer-link" to="/staff/account" onClick={close}>Account</NavLink>
            <button className="nav-drawer-link nav-drawer-btn" type="button" onClick={() => { close(); signOut(); }}>Sign Out</button>
          </div>
        ) : (
          <div className="nav-drawer-section">
            <NavLink className="nav-drawer-link" to="/staff/login" onClick={close}>Staff Login</NavLink>
          </div>
        )}
      </div>
    </>
  );
}

function NotFound() {
  return (
    <section className="page">
      <h1 className="page-title">Page not found</h1>
      <p className="page-lead">The page you were looking for does not exist.</p>
      <div className="link-row">
        <NavLink className="btn btn--primary btn--small" to="/">
          Register
        </NavLink>
        <NavLink className="btn btn--ghost btn--small" to="/staff/login">
          Staff login
        </NavLink>
      </div>
    </section>
  );
}

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="app-header">
        <nav className="app-nav" aria-label="Main">
          <NavLink className="nav-brand" to="/">
            <img className="nav-brand-seal" src={pesoSeal} alt="PESO Cagayan seal" width="52" height="52" />
            <span>PPESO Job Fairs &amp; Recruitment Events</span>
          </NavLink>
          <HamburgerMenu />
        </nav>
      </header>

      <main id="main" tabIndex={-1}>
        <Routes>
          {/* Landing page IS the event — jobseekers land straight on registration */}
          <Route path="/" element={<EventPicker />} />
          <Route path="/events" element={<EventPicker />} />
          <Route path="/events/:eventId/register/:formId" element={<RegisterPage />} />
          <Route path="/registration-correction" element={<RegistrationCorrectionPage />} />
          <Route path="/registration/success" element={<RegistrationSuccess />} />
          {/* Staff area lives off the public menu; reached by direct link */}
          <Route path="/staff/login" element={<StaffLogin />} />
          <Route
            path="/staff/account"
            element={
              <StaffRoute allowPasswordChange>
                <StaffAccount />
              </StaffRoute>
            }
          />
          <Route
            path="/staff/scanner"
            element={
              <StaffRoute>
                <Suspense fallback={<p role="status">Loading scanner…</p>}>
                  <StaffScanner />
                </Suspense>
              </StaffRoute>
            }
          />
          {/* Admin console — events + staff roles, admins only */}
          <Route
            path="/admin"
            element={
              <StaffRoute adminOnly>
                <Suspense fallback={<p role="status">Loading admin console…</p>}>
                  <AdminPage />
                </Suspense>
              </StaffRoute>
            }
          />
          <Route
            path="/admin/events/:eventId/registrants"
            element={
              <StaffRoute adminOnly>
                <Suspense fallback={<p role="status">Loading registrants…</p>}>
                  <EventRegistrantsPage />
                </Suspense>
              </StaffRoute>
            }
          />
          <Route path="/admin/vacancies/:eventId?" element={
            <StaffRoute adminOnly>
              <Suspense fallback={<p role="status">Loading vacancies…</p>}><VacanciesPage /></Suspense>
            </StaffRoute>
          } />
          <Route path="/staff/interviews" element={<StaffRoute><Suspense fallback={<p role="status">Loading interviews…</p>}><InterviewStatus /></Suspense></StaffRoute>} />
          <Route path="/staff/walk-ins" element={<StaffRoute><Suspense fallback={<p role="status">Loading walk-in form...</p>}><WalkInApplicants /></Suspense></StaffRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="app-footer">
        <p>A project of Cagayan Provincial Public Employment Service Office</p>
      </footer>
    </>
  );
}
