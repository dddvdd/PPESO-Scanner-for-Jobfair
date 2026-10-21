alter table public.registration_correction_tokens
  add column if not exists provider_message_id text,
  add column if not exists email_status text,
  add column if not exists email_status_updated_at timestamptz;

alter table public.registration_correction_tokens
  alter column email_status set default 'pending';

update public.registration_correction_tokens
set email_status = case when sent_at is not null then 'unknown' else 'pending' end
where email_status is null
   or (sent_at is not null and provider_message_id is null and email_status in ('pending', 'sent'));

alter table public.registration_correction_tokens
  alter column email_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.registration_correction_tokens'::regclass
      and conname = 'registration_correction_email_status_check'
  ) then
    alter table public.registration_correction_tokens
      add constraint registration_correction_email_status_check
      check (email_status in ('unknown', 'pending', 'sent', 'delivered', 'bounced', 'complained', 'delayed', 'failed'));
  end if;
end
$$;

create unique index if not exists registration_correction_provider_message_id_key
  on public.registration_correction_tokens(provider_message_id)
  where provider_message_id is not null;

create table if not exists public.registration_correction_email_webhook_events (
  event_id text primary key,
  created_at timestamptz not null default now()
);

alter table public.registration_correction_email_webhook_events enable row level security;
revoke all on public.registration_correction_email_webhook_events from public, anon, authenticated;
grant all on public.registration_correction_email_webhook_events to service_role;

create or replace function public.record_registration_correction_email_sends(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_updated integer := 0;
  v_count integer;
  v_token_hash text;
  v_message_id text;
  v_now timestamptz := now();
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Email send records must be an array';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_token_hash := v_item ->> 'token_hash';
    v_message_id := v_item ->> 'email_id';
    if v_token_hash !~ '^[a-f0-9]{64}$' or nullif(v_message_id, '') is null then
      raise exception 'Invalid email send record';
    end if;

    update public.registration_correction_tokens
    set provider_message_id = v_message_id,
        email_status = 'sent',
        sent_at = v_now
    where token_hash = v_token_hash
      and sent_at is null
      and revoked_at is null;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'Could not register an accepted correction email';
    end if;
    v_updated := v_updated + v_count;
  end loop;

  return v_updated;
end;
$$;

create or replace function public.record_registration_correction_email_event(
  p_event_id text,
  p_email_id text,
  p_status text,
  p_event_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_event_id text;
  v_message_exists boolean;
begin
  if nullif(p_event_id, '') is null
     or nullif(p_email_id, '') is null
     or p_status not in ('sent', 'delivered', 'bounced', 'complained', 'delayed', 'failed')
     or p_event_at is null then
    raise exception 'Invalid correction email event';
  end if;

  insert into public.registration_correction_email_webhook_events(event_id)
  values (p_event_id)
  on conflict do nothing
  returning event_id into v_inserted_event_id;

  if v_inserted_event_id is null then
    return 'duplicate';
  end if;

  update public.registration_correction_tokens
  set email_status = p_status,
      email_status_updated_at = p_event_at
  where provider_message_id = p_email_id
    and (email_status_updated_at is null or p_event_at >= email_status_updated_at);

  if found then
    return 'recorded';
  end if;

  select exists (
    select 1 from public.registration_correction_tokens
    where provider_message_id = p_email_id
  ) into v_message_exists;

  if v_message_exists then
    return 'recorded';
  end if;

  delete from public.registration_correction_email_webhook_events
  where event_id = p_event_id;
  return 'unknown';
end;
$$;

revoke all on function public.record_registration_correction_email_sends(jsonb) from public, anon, authenticated;
revoke all on function public.record_registration_correction_email_event(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_registration_correction_email_sends(jsonb) to service_role;
grant execute on function public.record_registration_correction_email_event(text, text, text, timestamptz) to service_role;
