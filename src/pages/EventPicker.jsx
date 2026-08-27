import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPublishedFormWithFields, listPublishedEvents } from "../lib/api.js";

const AVAILABILITY_MESSAGE = "This form is no longer available.";

export default function EventPicker() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [events, setEvents] = useState([]);
  const [banner, setBanner] = useState(null);
  const [cardNotices, setCardNotices] = useState({});
  const [busyEventId, setBusyEventId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listPublishedEvents().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setEvents(result.data ?? []);
        setStatus("ready");
      } else {
        setBanner(result.error);
        setStatus("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openRegistration = useCallback(
    async (event) => {
      if (busyEventId) return;
      setBusyEventId(event.id);
      setCardNotices((prev) => ({ ...prev, [event.id]: null }));
      setBanner(null);

      const result = await getPublishedFormWithFields(event.id);
      setBusyEventId(null);

      if (!result.ok) {
        setBanner(result.error);
        return;
      }
      if (!result.data?.form?.id) {
        setCardNotices((prev) => ({ ...prev, [event.id]: AVAILABILITY_MESSAGE }));
        return;
      }
      navigate(`/events/${event.id}/register/${result.data.form.id}`);
    },
    [busyEventId, navigate]
  );

  if (status === "loading") {
    return (
      <section className="page">
        <p className="status-line" role="status">
          Loading events…
        </p>
      </section>
    );
  }

  return (
    <section className="page">
      <h1 className="page-title">Jobseeker Registration</h1>

      {banner && (
        <p role="alert" className="alert alert--error">
          {banner.kind === "network"
            ? banner.message
            : "Could not load events right now. Please try again."}
        </p>
      )}

      {status === "ready" && events.length === 0 && (
        <p className="page-lead">
          There are no events open for registration right now. Please check back soon.
        </p>
      )}

      <ul className="event-list">
        {events.map((event) => (
          <li key={event.id} className="glass-card event-card">
            <h2>{event.name}</h2>
            {event.event_date && (
              <p className="event-meta">
                Date: {event.event_date}
                {event.location ? ` · ${event.location}` : ""}
              </p>
            )}
            {event.description && <p className="event-desc">{event.description}</p>}
            {cardNotices[event.id] ? (
              <p role="alert" className="alert alert--warn">
                {cardNotices[event.id]}
              </p>
            ) : null}
            <button type="button" className="btn btn--primary btn--small" onClick={() => openRegistration(event)} disabled={busyEventId !== null}>
              {busyEventId === event.id ? "Checking availability…" : "Register"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
