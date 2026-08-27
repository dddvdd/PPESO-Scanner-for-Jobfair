import { Link, useLocation } from "react-router-dom";
import TicketCard from "../components/TicketCard.jsx";

/**
 * Immediate post-registration ticket.
 *
 * Data arrives via router location state only (in-memory, per history
 * entry): no URL params, no storage, no logging. If state is lost (direct
 * entry or refresh), we deliberately show a recovery path instead of
 * persisting the bearer token — Phase 2D contract. The retrieval page is the
 * durable recovery mechanism.
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
            If you have already registered, you can recover your ticket using
            just the email address you registered with.
          </p>
          <div className="link-row">
            <Link className="btn btn--primary btn--small" to="/retrieve-ticket">
              Retrieve your ticket
            </Link>
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
        Keep your registration number safe. Lost your QR? You can always
        recover this ticket via{" "}
        <Link className="link" to="/retrieve-ticket">ticket retrieval</Link>{" "}
        using your email alone.
      </p>
    </section>
  );
}
