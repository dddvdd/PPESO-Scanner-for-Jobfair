import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { retrieveTicket } from "../lib/api.js";
import TicketCard from "../components/TicketCard.jsx";

const GENERIC_NOT_FOUND_MESSAGE =
  "We couldn't find a ticket for that email address. Please check it and try again.";

export default function RetrieveTicket() {
  const [email, setEmail] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [fieldError, setFieldError] = useState(null);
  const [banner, setBanner] = useState(null);
  const [searching, setSearching] = useState(false);
  const [ticket, setTicket] = useState(null);

  const searchingRef = useRef(false);

  async function runLookup(regNumber, verificationEmail) {
    const result = await retrieveTicket(regNumber, verificationEmail);

    searchingRef.current = false;
    setSearching(false);

    if (result.ok) {
      setTicket(result.data);
      return;
    }

    const failure = result.error;
    switch (failure.token) {
      case "TICKET_NOT_FOUND":
        // Deliberately identical copy for every miss — anti-enumeration contract.
        setBanner({ kind: "application", message: GENERIC_NOT_FOUND_MESSAGE });
        break;
      default:
        if (failure.kind === "network") {
          setBanner(failure);
        } else {
          setBanner({
            kind: "unknown",
            message: "Something went wrong while looking up your ticket. Please try again.",
          });
        }
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (searchingRef.current) return;

    // Any new attempt supersedes a previous failure banner.
    setBanner(null);

    const verificationEmail = email.trim();
    if (!verificationEmail) {
      setFieldError("Email address is required.");
      return;
    }
    setFieldError(null);

    searchingRef.current = true;
    setSearching(true);
    setTicket(null);

    // Registration number is optional: without it we return a non-sensitive
    // confirmation only (no QR); with it the full ticket incl. QR is returned.
    await runLookup(registrationNumber.trim().toUpperCase(), verificationEmail);
  }

  // Revealing the QR requires both the registration number and the email —
  // an email-only lookup never returns the token.
  async function handleRevealQr(event) {
    event.preventDefault();
    if (searchingRef.current) return;
    const regNumber = registrationNumber.trim().toUpperCase();
    if (!regNumber) {
      setBanner({
        kind: "application",
        message: "Enter your registration number to reveal the QR code.",
      });
      return;
    }
    const verificationEmail = email.trim();
    if (!verificationEmail) {
      setFieldError("Email address is required.");
      return;
    }
    setFieldError(null);
    setBanner(null);

    searchingRef.current = true;
    setSearching(true);
    await runLookup(regNumber, verificationEmail);
  }

  return (
    <section className="page">
      <p className="page-kicker">Ticket lookup</p>
      <h1 className="page-title">Retrieve your ticket</h1>
      <p className="page-lead">
        Enter the email address you used when registering. Add your
        registration number to show the QR ticket.
      </p>

      {banner && (
        <p
          role="alert"
          className={`alert ${banner.kind === "network" ? "alert--error" : "alert--warn"}`}
        >
          {banner.message}
        </p>
      )}

      {!ticket && (
        <form onSubmit={handleSubmit} noValidate className="form-stack">
          <div className="field">
            <label htmlFor="retrieve-verification-email">Email address</label>
            <input
              id="retrieve-verification-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              disabled={searching}
              aria-invalid={fieldError ? true : undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
            {fieldError && (
              <p role="alert" className="field-error">
                {fieldError}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="retrieve-registration-number">
              Registration number <span className="field-optional">(optional)</span>
            </label>
            <input
              id="retrieve-registration-number"
              type="text"
              autoComplete="off"
              placeholder="e.g. JF26-000103"
              value={registrationNumber}
              disabled={searching}
              onChange={(e) => setRegistrationNumber(e.target.value)}
            />
            <p className="field-hint">
              Without it, we&apos;ll confirm your registration but won&apos;t show the QR.
            </p>
          </div>
          <button type="submit" className="btn btn--primary btn--block" disabled={searching}>
            {searching ? "Looking up…" : "Retrieve ticket"}
          </button>
        </form>
      )}

      {ticket && (
        <>
          <TicketCard
            eventName={ticket.eventName}
            eventDate={ticket.eventDate}
            location={ticket.location}
            applicantName={[ticket.firstName, ticket.lastName].filter(Boolean).join(" ") || null}
            registrationNumber={ticket.registrationNumber}
            registrationStatus={ticket.registrationStatus}
            registeredAt={ticket.registeredAt}
            checkedInAt={ticket.checkedInAt}
            ticketToken={ticket.ticketToken}
          />

          {!ticket.ticketToken && (
            <form onSubmit={handleRevealQr} noValidate className="form-section">
              <div className="form-stack">
                <p className="page-lead">
                  To reveal the QR code, enter your registration number
                  (found on your ticket confirmation) and we&apos;ll verify it
                  against your email address.
                </p>
                <div className="field">
                  <label htmlFor="reveal-registration-number">Registration number</label>
                  <input
                    id="reveal-registration-number"
                    type="text"
                    autoComplete="off"
                    placeholder="e.g. JF26-000103"
                    value={registrationNumber}
                    disabled={searching}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn--primary btn--block" disabled={searching}>
                  {searching ? "Revealing…" : "Reveal QR code"}
                </button>
              </div>
            </form>
          )}

          <p className="page-lead">
            Not your ticket?{" "}
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => {
                setTicket(null);
                setEmail("");
                setRegistrationNumber("");
              }}
            >
              Look up another
            </button>
          </p>
        </>
      )}

      <p className="page-lead" style={{ marginTop: "auto", paddingTop: 16 }}>
        Haven&apos;t registered yet? <Link to="/events">View published events</Link>
      </p>
    </section>
  );
}
