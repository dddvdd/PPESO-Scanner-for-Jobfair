alter table public.event_weather_cache
  add column if not exists condition_label text
  check (condition_label in ('Sunny', 'Partly cloudy', 'Cloudy', 'Windy',
    'Rainy', 'Heavy rain', 'Thunderstorms', 'Snowy'));

create function public.read_event_weather_display()
returns table(event_id uuid, kind text, condition_label text,
  feels_like_high_celsius double precision, fetched_at timestamptz,
  expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, c.kind, c.condition_label, c.feels_like_high_celsius,
    c.fetched_at, c.expires_at
  from public.events e join public.event_weather_cache c
    on c.location_key = public.weather_location_key(e.location)
      and c.event_date = e.event_date
  where e.status in ('published', 'closed', 'archived')
    and e.event_date between (now() at time zone 'Asia/Manila')::date
      and (now() at time zone 'Asia/Manila')::date + 2
    and c.expires_at > now() and c.kind is not null;
$$;
revoke all on function public.read_event_weather_display() from public;
grant execute on function public.read_event_weather_display()
  to anon, authenticated, service_role;

-- Refill existing event forecasts with Google's condition detail.
update public.event_weather_cache
set kind = null, fetched_at = null, expires_at = now()
where kind is not null and condition_label is null
  and event_date between (now() at time zone 'Asia/Manila')::date
    and (now() at time zone 'Asia/Manila')::date + 2;
