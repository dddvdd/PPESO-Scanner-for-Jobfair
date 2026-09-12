import { lazy, Suspense, useState, useEffect, useRef, useCallback } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import EventPicker from "./pages/EventPicker.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import RegistrationSuccess from "./pages/RegistrationSuccess.jsx";
import RetrieveTicket from "./pages/RetrieveTicket.jsx";
import StaffLogin from "./pages/StaffLogin.jsx";
import StaffAccount from "./pages/StaffAccount.jsx";
import StaffRoute from "./components/StaffRoute.jsx";
import { useAuth } from "./context/AuthContext.jsx";

const StaffScanner = lazy(() => import("./pages/StaffScanner.jsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.jsx"));
const EventRegistrantsPage = lazy(() => import("./pages/EventRegistrantsPage.jsx"));
const VacanciesPage = lazy(() => import("./pages/VacanciesPage.jsx"));
const InterviewStatus = lazy(() => import("./pages/InterviewStatus.jsx"));
const WalkInApplicants = lazy(() => import("./pages/WalkInApplicants.jsx"));

function HamburgerMenu() {
  const { session, role, roleLoading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) {
        close();
      }
    }
    function onKeyDown(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
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
        onClick={() => setOpen(o => !o)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {open ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></> : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>}
        </svg>
      </button>

      {open && (
        <div className="nav-overlay" onClick={close} />
      )}

      <nav ref={panelRef} className={`nav-drawer${open ? " nav-drawer--open" : ""}`} aria-label="Navigation">
        {isLoggedIn && (
          <div className="nav-drawer-header">
            <span className="nav-drawer-role">{isAdmin ? "Admin" : "Staff"}</span>
          </div>
        )}

        <div className="nav-drawer-section">
          <span className="nav-drawer-label">Public</span>
          <NavLink className="nav-drawer-link" to="/" onClick={close}>Register</NavLink>
          <NavLink className="nav-drawer-link" to="/retrieve-ticket" onClick={close}>My Ticket</NavLink>
        </div>

        {isLoggedIn && isStaff && (
          <div className="nav-drawer-section">
            <span className="nav-drawer-label">Staff Tools</span>
            <NavLink className="nav-drawer-link" to="/staff/scanner" onClick={close}>Scanner</NavLink>
            <NavLink className="nav-drawer-link" to="/staff/interviews" onClick={close}>Interview Status</NavLink>
            <NavLink className="nav-drawer-link" to="/staff/walk-ins" onClick={close}>Walk-in Applicants</NavLink>
          </div>
        )}

        {isAdmin && (
          <div className="nav-drawer-section">
            <span className="nav-drawer-label">Admin</span>
            <NavLink className="nav-drawer-link" to="/admin" onClick={close}>Admin Console</NavLink>
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
      </nav>
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
        <NavLink className="btn btn--ghost btn--small" to="/retrieve-ticket">
          My Ticket
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
            Job Fair
          </NavLink>
          <HamburgerMenu />
        </nav>
      </header>

      <main id="main">
        <Routes>
          {/* Landing page IS the event — jobseekers land straight on registration */}
          <Route path="/" element={<EventPicker />} />
          <Route path="/events" element={<EventPicker />} />
          <Route path="/events/:eventId/register/:formId" element={<RegisterPage />} />
          <Route path="/registration/success" element={<RegistrationSuccess />} />
          <Route path="/retrieve-ticket" element={<RetrieveTicket />} />
          {/* Staff area lives off the public menu; reached by direct link */}
          <Route path="/staff/login" element={<StaffLogin />} />
          <Route
            path="/staff/account"
            element={
              <StaffRoute>
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
    </>
  );
}
