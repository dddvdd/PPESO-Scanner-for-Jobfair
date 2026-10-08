import assert from "node:assert/strict";
import test from "node:test";
import { getEventWeather } from "../../src/lib/eventWeather.js";
import { todayInManila, isForecastDate, forecastExpiry, googleFeelsLikeHigh, googleWeatherKind, googleWeatherLabel, selectForecast, resolveLocation } from "../../supabase/functions/event-weather/weather.mjs";

test("three-day window follows Manila dates and rejects invalid dates", () => {
  assert.equal(todayInManila(new Date("2026-10-07T16:00:00Z")), "2026-10-08");
  for (const date of ["2026-10-08", "2026-10-09", "2026-10-10"]) assert.equal(isForecastDate(date, "2026-10-08"), true);
  for (const date of ["2026-10-07", "2026-10-11", "2026-02-30", "bad"]) assert.equal(isForecastDate(date, "2026-10-08"), false);
});
test("future forecasts expire at Manila midnight; event-day forecasts at next three-hour boundary", () => {
  const now = new Date("2026-10-08T02:30:00+08:00");
  assert.equal(forecastExpiry("2026-10-09", now), "2026-10-08T16:00:00.000Z");
  assert.equal(forecastExpiry("2026-10-08", now), "2026-10-07T19:00:00.000Z");
  assert.equal(forecastExpiry("2026-10-08", new Date("2026-10-08T03:00:00+08:00")), "2026-10-07T22:00:00.000Z");
  assert.equal(forecastExpiry("2026-10-08", new Date("2026-10-08T23:59:00+08:00")), "2026-10-08T16:00:00.000Z");
});
test("selects the event date and maps Google daytime/nighttime data", () => {
  const clear = { displayDate: { year: 2026, month: 10, day: 8 }, daytimeForecast: { weatherCondition: { type: "CLEAR" } } };
  const rain = { ...clear, displayDate: { year: 2026, month: 10, day: 9 }, nighttimeForecast: { weatherCondition: { type: "SCATTERED_SHOWERS" } } };
  assert.equal(selectForecast({ forecastDays: [clear, rain] }, "2026-10-09"), rain);
  assert.equal(googleWeatherKind(rain), "rain");
  assert.equal(googleWeatherKind(clear), "sun");
  assert.equal(googleWeatherKind({ daytimeForecast: { weatherCondition: { type: "CLOUDY" }, wind: { speed: { value: 45, unit: "KILOMETERS_PER_HOUR" } } } }), "wind");
  assert.equal(googleWeatherKind({ daytimeForecast: { weatherCondition: { type: "PARTLY_CLOUDY" } } }), "cloud");
  assert.equal(googleWeatherKind(undefined), null);
});
test("reads the daily feels-like high only when Google supplies Celsius", () => {
  assert.equal(googleFeelsLikeHigh({ feelsLikeMaxTemperature: { degrees: 37.4, unit: "CELSIUS" } }), 37.4);
  assert.equal(googleFeelsLikeHigh({ feelsLikeMaxTemperature: { degrees: 99, unit: "FAHRENHEIT" } }), null);
  assert.equal(googleFeelsLikeHigh({}), null);
});
test("shows heavy rain separately from ordinary rain and clear skies", () => {
  const condition = (type) => ({ daytimeForecast: { weatherCondition: { type } } });
  assert.equal(googleWeatherLabel(condition("HEAVY_RAIN_SHOWERS")), "Heavy rain");
  assert.equal(googleWeatherLabel(condition("RAIN")), "Rainy");
  assert.equal(googleWeatherLabel(condition("CLEAR")), "Sunny");
  assert.equal(googleWeatherLabel(condition("PARTLY_CLOUDY")), "Partly cloudy");
  assert.equal(googleWeatherLabel(condition("THUNDERSTORM")), "Thunderstorms");
});
test("one cache response supplies duplicate event cards, excludes unrelated records", async () => {
  let calls = 0;
  const client = { functions: { invoke: async () => {
    calls++;
    return { data: { forecasts: [
      { event_id: "a", kind: "rain", fetched_at: "same" },
      { event_id: "b", kind: "rain", fetched_at: "same" },
      { event_id: "other", kind: "sun" },
    ] }, error: null };
  } } };
  const data = await getEventWeather([{ id: "a" }, { id: "b" }], client);
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(data), ["a", "b"]);
  assert.equal(data.a.fetched_at, data.b.fetched_at);
});
test("location resolver rejects places outside Cagayan", async () => {
  const result = await resolveLocation("Aparri", async () => ({ ok: true, json: async () => ({ results: [
    { latitude: 16.9, longitude: 121.5, admin2: "Ifugao" },
    { latitude: 18.35, longitude: 121.64, admin2: "Province of Cagayan" },
  ] }) }));
  assert.deepEqual(result, { latitude: 18.35, longitude: 121.64 });
  assert.deepEqual(await resolveLocation("Province of Cagayan", () => { throw Error("unexpected request"); }), { latitude: 17.61577, longitude: 121.72285 });
});
