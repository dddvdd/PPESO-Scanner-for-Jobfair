import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import EventRegistrants from "../components/EventRegistrants.jsx";
import { adminGetEvent } from "../lib/api.js";

export default function EventRegistrantsPage() {
  const { eventId } = useParams();
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setResult(null);
    adminGetEvent(eventId).then(next => {
      if (active) setResult({ ...next, eventId });
    });
    return () => { active = false; };
  }, [eventId, attempt]);

  const current = result?.eventId === eventId ? result : null;
  const event = current?.ok ? current.data : null;

  return (
    <section className="page" style={{ maxWidth: 1400 }}>
      <Link className="btn btn--ghost btn--small" style={{ alignSelf: "flex-start" }} to="/admin">Back to events</Link>
      <p className="page-kicker">Admin</p>
      <h1 className="page-title">Registrants</h1>
      {!current && <p role="status">Loading event…</p>}
      {current && !current.ok && <>
        <p role="alert" className="alert alert--error">{current.error.message}</p>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setAttempt(value => value + 1)}>Retry</button>
      </>}
      {current?.ok && !event && <p role="status">Event not found.</p>}
      {event && <>
        <h2 className="section-heading">{event.name}</h2>
        <p className="event-meta">{[event.event_date, event.location].filter(Boolean).join(" · ")}</p>
        <div className="glass-card" style={{ minWidth: 0 }}>
          <EventRegistrants key={event.id} event={event} />
        </div>
      </>}
    </section>
  );
}
