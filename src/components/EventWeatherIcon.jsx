export default function EventWeatherIcon({ kind, conditionLabel, date, location, updatedAt, feelsLikeHigh }) {
  const condition = conditionLabel || (kind === "sun" ? "Sunny" : kind === "rain" ? "Rainy" : kind === "wind" ? "Windy" : "Cloudy");
  const label = `${condition} forecast for ${location} on ${date}`;
  const hasTemperature = typeof feelsLikeHigh === "number" && Number.isFinite(feelsLikeHigh);
  return (
    <span className="event-weather-badge" title={updatedAt ? `Updated ${new Date(updatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} (Manila time)` : undefined}>
      <span className="event-weather-condition">
        <span className={`event-weather-icon event-weather-icon--${kind}`} role="img" aria-label={label}>
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
        {kind === "sun" && <>
          <circle cx="16" cy="16" r="5" />
          <path d="M16 2v5M16 25v5M2 16h5M25 16h5M6 6l3.5 3.5M22.5 22.5 26 26M26 6l-3.5 3.5M9.5 22.5 6 26" />
        </>}
        {kind === "cloud" && <path d="M8 24h16a5 5 0 0 0 .2-10A8.5 8.5 0 0 0 8 14a5 5 0 0 0 0 10Z" />}
        {kind === "rain" && <>
          <path d="M8 20h16a5 5 0 0 0 .2-10A8.5 8.5 0 0 0 8 10a5 5 0 0 0 0 10Z" />
          <path d="m10 24-2 4m9-4-2 4m9-4-2 4" />
        </>}
        {kind === "wind" && <>
          <path d="M3 11h19c3.5 0 5-2 5-4s-1.5-3-3.5-3S20 5 20 7M3 17h24M3 23h17c3.5 0 5 2 5 4s-1.5 3-3.5 3S18 29 18 27" />
        </>}
          </svg>
        </span>
        <span className="event-weather-condition-label" aria-hidden="true">{condition}</span>
      </span>
      {hasTemperature && <span className="event-weather-temperature"><span>Feels like high</span><strong>{Math.round(feelsLikeHigh)}°C</strong></span>}
    </span>
  );
}
