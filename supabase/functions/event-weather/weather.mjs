const DAY_MS = 86400000;
export function todayInManila(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function isForecastDate(date, today = todayInManila()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return false;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return false;
  const days = (timestamp - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
  return Number.isInteger(days) && days >= 0 && days <= 2;
}
export function forecastExpiry(date, now = new Date()) {
  const today = todayInManila(now);
  const midnight = Date.parse(`${today}T00:00:00+08:00`);
  // Align refreshes to Manila midnight and 00:00/03:00/... on event day.
  const interval = date === today ? 10800000 : DAY_MS;
  return new Date(midnight + (Math.floor((now.getTime() - midnight) / interval) + 1) * interval).toISOString();
}
export function googleWeatherKind(day) {
  const periods = [day?.daytimeForecast, day?.nighttimeForecast].filter(Boolean);
  if (!periods.length) return null;
  const types = periods.map((p) => p.weatherCondition?.type ?? "");
  if (types.some((t) => /RAIN|SHOWER|THUNDER|SNOW|SLEET|HAIL/.test(t))) return "rain";
  if (types.includes("WINDY") || periods.some((p) => p.wind?.speed?.unit === "KILOMETERS_PER_HOUR" && p.wind.speed.value >= 40)) return "wind";
  if (["CLEAR", "MOSTLY_CLEAR"].includes(types[0])) return "sun";
  if (types.some((t) => /CLOUD|FOG|HAZE|MIST/.test(t))) return "cloud";
  return null;
}
export function googleWeatherLabel(day) {
  const types = [day?.daytimeForecast, day?.nighttimeForecast]
    .map((period) => period?.weatherCondition?.type ?? "");
  if (types.some((type) => /THUNDER/.test(type))) return "Thunderstorms";
  if (types.some((type) => /HEAVY_RAIN|RAIN_PERIODICALLY_HEAVY|MODERATE_TO_HEAVY_RAIN/.test(type))) return "Heavy rain";
  if (types.some((type) => /RAIN|SHOWER|HAIL/.test(type))) return "Rainy";
  if (types.some((type) => /SNOW|SLEET/.test(type))) return "Snowy";
  if (types.some((type) => type === "WINDY")) return "Windy";
  if (["CLEAR", "MOSTLY_CLEAR"].includes(types[0])) return "Sunny";
  if (types[0] === "PARTLY_CLOUDY") return "Partly cloudy";
  if (types.some((type) => /CLOUD|FOG|HAZE|MIST/.test(type))) return "Cloudy";
  return null;
}
export function selectForecast(data, date) {
  return data.forecastDays?.find((day) => {
    const d = day.displayDate;
    return d && `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` === date;
  });
}
export function googleFeelsLikeHigh(day) {
  const temperature = day?.feelsLikeMaxTemperature;
  return temperature?.unit === "CELSIUS" && Number.isFinite(temperature.degrees)
    ? temperature.degrees : null;
}
export async function resolveLocation(location, fetcher = fetch) {
  if (/^(?:province of\s+)?cagayan(?:\s+province)?(?:\s*,\s*philippines)?$/i.test(location.trim())) {
    return { latitude: 17.61577, longitude: 121.72285 };
  }
  const names = [...new Set([location.trim(), ...location.split(",").map((p) => p.trim())])].slice(0, 5);
  for (const name of names) {
    if (name.length < 2) continue;
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({ name, count: "10", countryCode: "PH", language: "en" }).toString();
    const response = await fetcher(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Location lookup failed");
    const result = await response.json();
    const p = result.results?.find((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
      && /^(?:province of\s+)?cagayan$/i.test(p.admin2 ?? ""));
    if (p) return { latitude: p.latitude, longitude: p.longitude };
  }
  return null;
}
