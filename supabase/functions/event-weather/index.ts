import { createClient } from "npm:@supabase/supabase-js@2";
import { forecastExpiry, googleFeelsLikeHigh, googleWeatherKind, googleWeatherLabel, resolveLocation, selectForecast } from "./weather.mjs";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey || (request.headers.get("apikey") !== anonKey
    && request.headers.get("authorization") !== `Bearer ${anonKey}`)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const key = Deno.env.get("GOOGLE_WEATHER_API_KEY");
  if (!url || !secret || !key) return json({ error: "Weather service is not configured" }, 503);
  const db = createClient(url, secret, { auth: { persistSession: false } });
  try {
    // Request input cannot choose a location/date; only public event records can.
    const { data: groups, error } = await db.rpc("claim_event_weather");
    if (error) throw error;
    await Promise.all((groups ?? []).map(async (group) => {
      try {
        const place = group.latitude != null && group.longitude != null
          ? { latitude: group.latitude, longitude: group.longitude } : await resolveLocation(group.location_key);
        if (!place) throw new Error("Location unavailable");
        const endpoint = new URL("https://weather.googleapis.com/v1/forecast/days:lookup");
        endpoint.search = new URLSearchParams({ key, "location.latitude": String(place.latitude),
          "location.longitude": String(place.longitude), days: "3", pageSize: "3", unitsSystem: "METRIC", languageCode: "en" }).toString();
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("Weather provider unavailable");
        const day = selectForecast(await response.json(), group.event_date);
        const kind = googleWeatherKind(day);
        if (!kind) throw new Error("Forecast unavailable");
        const now = new Date();
        const { error: saveError } = await db.from("event_weather_cache").update({ ...place, kind,
          condition_label: googleWeatherLabel(day),
          feels_like_high_celsius: googleFeelsLikeHigh(day),
          fetched_at: now.toISOString(), expires_at: forecastExpiry(group.event_date, now),
          lease_token: null, lease_until: null, retry_after: null,
        }).eq("location_key", group.location_key).eq("event_date", group.event_date).eq("lease_token", group.lease_token);
        if (saveError) throw saveError;
      } catch {
        await db.from("event_weather_cache").update({ lease_token: null, lease_until: null,
          retry_after: new Date(Date.now() + 3600000).toISOString(),
        }).eq("location_key", group.location_key).eq("event_date", group.event_date).eq("lease_token", group.lease_token);
        console.warn("Event forecast refresh failed");
      }
    }));
    const { data, error: readError } = await db.rpc("read_event_weather_display");
    if (readError) throw readError;
    return json({ forecasts: data ?? [] });
  } catch {
    return json({ error: "Weather service unavailable" }, 503);
  }
});
