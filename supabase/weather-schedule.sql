-- Run AFTER the migration and Edge Function deployment. Replace the URL
-- placeholder with this project's public Edge Function URL (no secret key).
-- Store the project's anon key in Supabase Vault as weather_anon_key first.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare job bigint;
begin
  for job in select jobid from cron.job where jobname in ('refresh-event-weather', 'expire-event-weather') loop
    perform cron.unschedule(job);
  end loop;
end;
$$;

-- UTC 16:00/19:00/22:00/01:00/... correspond to Manila 00:00/03:00/... .
-- The function only fetches due cache groups; future events remain daily.
select cron.schedule('refresh-event-weather', '0 1,4,7,10,13,16,19,22 * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/event-weather',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'weather_anon_key' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

-- Expired Google forecast values are removed even if the provider is down.
select cron.schedule('expire-event-weather', '* * * * *', $$
  update public.event_weather_cache set kind = null, fetched_at = null
    where kind is not null and (expires_at <= now() or fetched_at <= now() - interval '23 hours 59 minutes');
  delete from public.event_weather_cache
    where event_date < (now() at time zone 'Asia/Manila')::date;
$$);
