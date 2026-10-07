create table public.registration_correction_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  missing_fields text[] not null check (
    cardinality(missing_fields) > 0
    and missing_fields <@ array[
      'date_of_birth', 'course', 'pwd', 'sex', 'first_time_job_seeker',
      'returning_ofw', 'returning_worker', 'interested_in_skills_training',
      'province', 'municipality_city', 'barangay'
    ]::text[]
  ),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  sent_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  completed_fields text[],
  constraint registration_correction_expiry_check check (expires_at > created_at)
);

create unique index registration_correction_one_active_per_registration
  on public.registration_correction_tokens(registration_id)
  where used_at is null and revoked_at is null;

alter table public.registration_correction_tokens enable row level security;
revoke all on public.registration_correction_tokens from public, anon, authenticated;
grant all on public.registration_correction_tokens to service_role;

create or replace function public.registration_correction_details(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_details jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select jsonb_build_object(
    'status', 'ok',
    'first_name', r.first_name,
    'event_name', e.name,
    'missing_fields', t.missing_fields
  )
  into v_details
  from public.registration_correction_tokens t
  join public.registrations r on r.id = t.registration_id
  join public.events e on e.id = r.event_id
  where t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and t.sent_at is not null
    and t.used_at is null
    and t.revoked_at is null
    and t.expires_at > now();

  return coalesce(v_details, jsonb_build_object('status', 'invalid'));
end;
$$;

create or replace function public.submit_registration_correction(
  p_token text,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token public.registration_correction_tokens%rowtype;
  v_registration public.registrations%rowtype;
  v_key text;
  v_value text;
  v_patch jsonb := '{}'::jsonb;
  v_completed_fields text[] := '{}';
  v_date date;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$'
     or p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select *
  into v_token
  from public.registration_correction_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found or v_token.sent_at is null or v_token.used_at is not null
     or v_token.revoked_at is not null or v_token.expires_at <= now() then
    return jsonb_build_object('status', 'invalid');
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_answers) as supplied(key)
    where not (supplied.key = any(v_token.missing_fields))
  ) then
    return jsonb_build_object('status', 'invalid_answers');
  end if;

  select *
  into v_registration
  from public.registrations
  where id = v_token.registration_id
  for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  foreach v_key in array v_token.missing_fields
  loop
    v_value := nullif(btrim(p_answers ->> v_key), '');

    if v_value is null then
      return jsonb_build_object('status', 'required_fields');
    end if;

    if coalesce(nullif(btrim(v_registration.form_data ->> v_key), ''), '') <> '' then
      continue;
    end if;

    if v_key = 'date_of_birth' then
      begin
        v_date := v_value::date;
      exception
        when invalid_datetime_format or datetime_field_overflow then
          return jsonb_build_object('status', 'invalid_answers');
      end;
      if to_char(v_date, 'YYYY-MM-DD') <> v_value or v_date > current_date then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    elsif v_key in ('course', 'province', 'municipality_city', 'barangay') then
      if length(v_value) > 200 then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    elsif v_key = 'pwd' then
      if v_value not in ('Yes', 'No') then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    elsif v_key = 'sex' then
      if v_value not in ('Male', 'Female') then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    elsif v_key in ('first_time_job_seeker', 'returning_ofw', 'returning_worker') then
      if v_value not in ('yes', 'no') then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    elsif v_key = 'interested_in_skills_training' then
      if v_value not in ('Yes', 'No') then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    end if;

    v_patch := v_patch || jsonb_build_object(v_key, v_value);
    v_completed_fields := array_append(v_completed_fields, v_key);
  end loop;

  if cardinality(v_completed_fields) > 0 then
    update public.registrations
    set form_data = coalesce(form_data, '{}'::jsonb) || v_patch,
        updated_at = now()
    where id = v_registration.id;
  end if;

  update public.registration_correction_tokens
  set used_at = now(),
      completed_fields = v_completed_fields
  where token_hash = v_token.token_hash;

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.registration_correction_details(text) from public;
revoke all on function public.submit_registration_correction(text, jsonb) from public;
grant execute on function public.registration_correction_details(text) to anon, authenticated;
grant execute on function public.submit_registration_correction(text, jsonb) to anon, authenticated;
