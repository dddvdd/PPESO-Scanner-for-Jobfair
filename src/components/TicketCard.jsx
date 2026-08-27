import TicketQr from "./TicketQr.jsx";

function formatDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const REGISTRATION_STATUS_LABELS = {
  registered: "Registered",
  cancelled: "Cancelled",
};

/**
 * Shared ticket presentation for both flows:
 *   registration hand-off (token via router state)
 *   retrieval (full row from retrieve_ticket RPC)
 *
 * The ticket token appears ONLY inside the QR image — it is never rendered
 * as text.
 */
export default function TicketCard({
  eventName,
  eventDate,
  location,
  applicantName,
  registrationNumber,
  registrationStatus,
  registeredAt,
  checkedInAt,
  ticketToken,
}) {
  const statusLabel =
    REGISTRATION_STATUS_LABELS[registrationStatus] ??
    (registrationStatus ? String(registrationStatus) : null);

  return (
    <div className="glass-card ticket-pass">
      <div className="ticket-pass-body">
        <section>
          <h3 className="ticket-event-name">{eventName ?? "Job fair event"}</h3>
          {eventDate && (
            <p className="ticket-meta">Date: {formatDateTime(eventDate) ?? eventDate}</p>
          )}
          {location && <p className="ticket-meta">Location: {location}</p>}
        </section>

        <hr className="ticket-divider" />

        <section>
          {statusLabel && (
            <p style={{ margin: "0 0 10px" }}>
              <span className="chip">
                <span className="chip-dot" aria-hidden="true" />
                {statusLabel}
              </span>
            </p>
          )}
          <dl style={{ margin: 0, display: "grid", gap: "8px" }}>
            <div className="ticket-row">
              <dt>Applicant</dt>
              <dd>{applicantName ?? "—"}</dd>
            </div>
            <div className="ticket-row">
              <dt>Registration no.</dt>
              <dd className="ticket-reg-no">{registrationNumber}</dd>
            </div>
            {registeredAt && (
              <div className="ticket-row">
                <dt>Registered</dt>
                <dd>{formatDateTime(registeredAt)}</dd>
              </div>
            )}
          </dl>
        </section>

        <hr className="ticket-divider" />

        <section className="ticket-qr-zone">
          <div className="ticket-qr-tile">
            <TicketQr value={ticketToken} />
          </div>
          <p className="ticket-note">Present this QR code at the entrance.</p>
        </section>

        <hr className="ticket-divider" />

        <section>
          <div className="ticket-row">
            <span style={{ color: "var(--text-dim)" }}>Check-in:</span>
            <span style={{ fontWeight: 600, textAlign: "right" }}>
              {checkedInAt ? formatDateTime(checkedInAt) : "Not checked in"}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
