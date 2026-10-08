export { todayInManila, isForecastDate } from "../../supabase/functions/event-weather/weather.mjs";

export async function getEventWeather(events, client) {
  const { data, error } = await client.functions.invoke("event-weather", { body: {} });
  if (error) throw error;
  const ids = new Set(events.map((event) => event.id));
  return Object.fromEntries((data?.forecasts ?? [])
    .filter((row) => ids.has(row.event_id) && ["sun", "rain", "wind", "cloud"].includes(row.kind))
    .map((row) => [row.event_id, row]));
}
