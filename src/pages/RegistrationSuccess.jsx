import { Link, useLocation } from "react-router-dom";
import TicketCard from "../components/TicketCard.jsx";

/**
 * Immediate post-registration ticket.
 *
 * Data arrives via router location state only (in-memory, per history
 * entry): no URL params, no storage, no logging. If state is lost (direct
 * entry or refresh), direct applicants to their saved ticket or event staff.
 */
export default function RegistrationSuccess() {
  const location = useLocation();
  const result = location.state ?? null;

  if (!result?.registrationNumber) {
    return (
      <section className="page">
        <div className="glass-card hero-card">
          <h1 className="page-title">Registration</h1>
          <p className="page-lead">No recent confirmation found for this session.</p>
          <p className="page-lead">
            If you have already registered, use your saved QR ticket or ask
            event staff to find your registration at check-in.
          </p>
          <div className="link-row">
            <Link className="link" to="/events">
              View published events
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const applicantName = [result.firstName, result.lastName].filter(Boolean).join(" ");

  return (
    <section className="page">
      <div className="glass-card hero-card">
        <p className="page-kicker">Registration complete</p>
        <h1 className="page-title">You&apos;re registered! 🎉</h1>
        <p className="page-lead">
          Your registration was received successfully. Your QR ticket is ready.
        </p>
      </div>

      <TicketCard
        eventName={result.eventName}
        applicantName={applicantName || null}
        registrationNumber={result.registrationNumber}
        registrationStatus="registered"
        ticketToken={result.ticketToken}
      />

      <p className="page-lead">
        Take a screenshot of your QR ticket and keep your registration number
        before leaving this page. If you lose your ticket, ask event staff to
        find your registration at check-in.
      </p>
    </section>
  );
}
