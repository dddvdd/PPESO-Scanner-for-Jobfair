alter table public.event_weather_cache
  add column if not exists feels_like_high_celsius double precision
  check (feels_like_high_celsius between -100 and 100);

-- A separate RPC preserves the original function signature for older clients.
create function public.read_event_weather_details()
returns table(event_id uuid, kind text, feels_like_high_celsius double precision,
  fetched_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, c.kind, c.feels_like_high_celsius, c.fetched_at, c.expires_at
  from public.events e join public.event_weather_cache c
    on c.location_key = public.weather_location_key(e.location) and c.event_date = e.event_date
  where e.status in ('published', 'closed', 'archived')
    and e.event_date between (now() at time zone 'Asia/Manila')::date
      and (now() at time zone 'Asia/Manila')::date + 2
    and c.expires_at > now() and c.kind is not null;
$$;
revoke all on function public.read_event_weather_details() from public;
grant execute on function public.read_event_weather_details() to anon, authenticated, service_role;

-- Refresh pre-existing icon-only entries once so cards can show the new value.
update public.event_weather_cache
set kind = null, fetched_at = null, expires_at = now()
where kind is not null and feels_like_high_celsius is null
  and event_date between (now() at time zone 'Asia/Manila')::date
    and (now() at time zone 'Asia/Manila')::date + 2;
