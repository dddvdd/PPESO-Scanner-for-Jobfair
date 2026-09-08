import { lazy, Suspense } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import EventPicker from "./pages/EventPicker.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import RegistrationSuccess from "./pages/RegistrationSuccess.jsx";
import RetrieveTicket from "./pages/RetrieveTicket.jsx";
import StaffLogin from "./pages/StaffLogin.jsx";
import StaffAccount from "./pages/StaffAccount.jsx";
import StaffRoute from "./components/StaffRoute.jsx";

const StaffScanner = lazy(() => import("./pages/StaffScanner.jsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.jsx"));
const EventRegistrantsPage = lazy(() => import("./pages/EventRegistrantsPage.jsx"));
const VacanciesPage = lazy(() => import("./pages/VacanciesPage.jsx"));
const InterviewStatus = lazy(() => import("./pages/InterviewStatus.jsx"));

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
          <NavLink className="nav-link" to="/retrieve-ticket">
            My Ticket
          </NavLink>
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
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}
