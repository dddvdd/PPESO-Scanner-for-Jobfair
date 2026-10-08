create or replace function public.weather_location_key(value text) returns text
language sql immutable strict set search_path = '' as $$
  select lower(regexp_replace(trim(value), '\s+', ' ', 'g'));
$$;
create table if not exists public.event_weather_cache (
  location_key text not null,
  event_date date not null,
  latitude double precision,
  longitude double precision,
  kind text check (kind in ('sun', 'rain', 'wind', 'cloud')),
  fetched_at timestamptz,
  expires_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  retry_after timestamptz,
  primary key (location_key, event_date)
);
alter table public.event_weather_cache enable row level security;
revoke all on public.event_weather_cache from anon, authenticated;
grant all on public.event_weather_cache to service_role;
create or replace function public.claim_event_weather() returns setof public.event_weather_cache
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Manila')::date;
begin
  delete from public.event_weather_cache where event_date < today;
  update public.event_weather_cache set kind = null, fetched_at = null where expires_at <= now();
  insert into public.event_weather_cache (location_key, event_date)
    select distinct public.weather_location_key(e.location), e.event_date from public.events e
    where e.status in ('published', 'closed', 'archived')
      and e.event_date between today and today + 2 and trim(e.location) <> ''
    on conflict do nothing;
  return query
    update public.event_weather_cache c set lease_token = gen_random_uuid(), lease_until = now() + interval '10 minutes'
    where (c.expires_at is null or c.expires_at <= now())
      and (c.lease_until is null or c.lease_until <= now())
      and (c.retry_after is null or c.retry_after <= now())
      and exists (select 1 from public.events e where e.status in ('published', 'closed', 'archived')
        and e.event_date between today and today + 2 and e.event_date = c.event_date
        and public.weather_location_key(e.location) = c.location_key)
    returning c.*;
end;
$$;
revoke all on function public.claim_event_weather() from public, anon, authenticated;
grant execute on function public.claim_event_weather() to service_role;
create or replace function public.read_event_weather()
returns table(event_id uuid, kind text, fetched_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, c.kind, c.fetched_at, c.expires_at from public.events e
  join public.event_weather_cache c on c.location_key = public.weather_location_key(e.location) and c.event_date = e.event_date
  where e.status in ('published', 'closed', 'archived')
    and e.event_date between (now() at time zone 'Asia/Manila')::date and (now() at time zone 'Asia/Manila')::date + 2
    and c.expires_at > now() and c.kind is not null;
$$;
revoke all on function public.read_event_weather() from public;
grant execute on function public.read_event_weather() to anon, authenticated, service_role;
