import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPublishedFormWithFields, listPublishedEvents } from "../lib/api.js";
import EventWeatherIcon from "../components/EventWeatherIcon.jsx";
import { getEventWeather, todayInManila } from "../lib/eventWeather.js";
import { getSupabase } from "../lib/supabaseClient.js";
import noEventsGif from "../assets/no-events.gif";
import noEventsStill from "../assets/no-events.png";

const AVAILABILITY_MESSAGE = "This form is no longer available.";

function formatEventDate(value) {
  const date = new Date(`${value}T12:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", {
    weekday: "short", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila",
  }).format(date);
}

export default function EventPicker() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [events, setEvents] = useState([]);
  const [banner, setBanner] = useState(null);
  const [cardNotices, setCardNotices] = useState({});
  const [busyEventId, setBusyEventId] = useState(null);
  const [weatherByEvent, setWeatherByEvent] = useState({});
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setBanner(null);
    listPublishedEvents().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const today = todayInManila();
        const visible = (result.data ?? []).filter(e => !e.event_date || e.event_date >= today);
        setEvents(visible);
        setStatus("ready");
      } else {
        setBanner(result.error);
        setStatus("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [retryCount]);

  useEffect(() => {
    if (!events.length) return;
    let cancelled = false;
    let timer;
    const refresh = async () => {
      try {
        const forecasts = await getEventWeather(events, getSupabase());
        if (cancelled) return;
        setWeatherByEvent(forecasts);
        const expiries = Object.values(forecasts).map((row) => Date.parse(row.expires_at));
        const next = expiries.length ? Math.min(...expiries) - Date.now() + 1000 : 60000;
        timer = setTimeout(refresh, Math.max(10000, next));
      } catch {
        if (!cancelled) {
          setWeatherByEvent({});
          timer = setTimeout(refresh, 60000);
        }
      }
    };
    refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [events]);

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

  if (status === "ready" && events.length === 0) {
    return (
      <section className="page events-empty" aria-labelledby="events-empty-title">
        <h1 className="events-empty-accessible-title" id="events-empty-title">No events right now.</h1>
        <picture className="events-empty-art">
          <source media="(prefers-reduced-motion: reduce)" srcSet={noEventsStill} />
          <img src={noEventsGif} width="640" height="400" alt="PPESO Cagayan. No events right now." />
        </picture>
        <p className="page-lead">Watch for updates on our Facebook page.</p>
        <a className="btn btn--primary" href="https://www.facebook.com/pesocagayan" target="_blank" rel="noopener noreferrer">
          PPESO Cagayan on Facebook
        </a>
      </section>
    );
  }

  return (
    <section className="page">
      <h1 className="page-title">Jobseeker Registration</h1>

      {banner && (
        <div role="alert" className="alert alert--error">
          <p>
          {banner.kind === "network"
            ? banner.message
            : "Could not load events right now. Please try again."}
          </p>
          {status === "error" && <button className="btn btn--ghost btn--small" type="button" onClick={() => setRetryCount(count => count + 1)}>Try again</button>}
        </div>
      )}

      <ul className="event-list">
        {events.map((event) => (
          <li key={event.id} className="glass-card event-card">
            <div className="event-card-heading">
              <h2>{event.name}</h2>
              {weatherByEvent[event.id] && (
                <EventWeatherIcon kind={weatherByEvent[event.id].kind} conditionLabel={weatherByEvent[event.id].condition_label} feelsLikeHigh={weatherByEvent[event.id].feels_like_high_celsius} updatedAt={weatherByEvent[event.id].fetched_at} date={event.event_date} location={event.location} />
              )}
            </div>
            <dl className="event-details">
              <div><dt>Date</dt><dd>{event.event_date ? <time dateTime={event.event_date}>{formatEventDate(event.event_date)}</time> : "To be announced"}</dd></div>
              <div><dt>Venue</dt><dd>{event.location || "To be announced"}</dd></div>
            </dl>
            {event.description && <p className="event-desc">{event.description}</p>}
            {cardNotices[event.id] ? (
              <p role="alert" className="alert alert--warn">
                {cardNotices[event.id]}
              </p>
            ) : null}
            <button type="button" className="btn btn--primary btn--small" aria-label={`Register for ${event.name}`} onClick={() => openRegistration(event)} disabled={busyEventId !== null}>
              {busyEventId === event.id ? "Checking availability…" : "Register"}
            </button>
          </li>
        ))}
      </ul>
      {Object.keys(weatherByEvent).length > 0 && (
        <p className="event-weather-credit">Includes data from Google Maps · Source: Includes weather data from Google · Location data: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></p>
      )}
    </section>
  );
}
