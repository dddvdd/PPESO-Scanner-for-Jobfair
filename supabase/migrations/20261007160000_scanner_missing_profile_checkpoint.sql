-- Check the 603 registrations known to have incomplete profiles before attendance.
-- Ticket QR codes contain a token, so the registration number is read by the
-- existing check-in lookup before this range can be evaluated.
create or replace function public.scanner_profile_checkpoint_applies(p_registration_number text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(
    p_registration_number ~ '^JF26-[0-9]{6}$'
    and p_registration_number collate "C" between 'JF26-001218' and 'JF26-001820',
    false
  );
$$;
revoke all on function public.scanner_profile_checkpoint_applies(text) from public, anon, authenticated;

create or replace function public.scanner_missing_fields(p_data jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(key order by position), '{}'::text[])
  from unnest(array['date_of_birth', 'course', 'pwd', 'sex', 'first_time_job_seeker', 'returning_ofw', 'returning_worker', 'interested_in_skills_training', 'province', 'municipality_city', 'barangay']::text[]) with ordinality as fields(key, position)
  where nullif(btrim(p_data ->> key), '') is null
     or p_data -> key in ('[]'::jsonb, '{}'::jsonb);
$$;
revoke all on function public.scanner_missing_fields(jsonb) from public, anon, authenticated;

create or replace function public.perform_check_in(
  p_ticket_token text,
  p_device_identifier text default null,
  p_event_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_reg record;
  v_profile public.registrations%rowtype;
  v_missing text[];
  v_ci_id uuid;
  v_scanned_at timestamptz;
begin
  if auth.uid() is null or not public.is_staff() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select r.id, r.registration_number, r.ticket_token, r.first_name, r.last_name,
         r.status, e.id as event_id, e.name as event_name, e.event_date
    into v_reg
    from public.registrations r
    join public.events e on e.id = r.event_id
   where r.ticket_token = btrim(coalesce(p_ticket_token, ''));

  if v_reg.id is null then
    return jsonb_build_object('status', 'registration_not_found');
  end if;

  if public.scanner_profile_checkpoint_applies(v_reg.registration_number) then
    -- Lock targeted profiles through the attendance insert to avoid a save race.
    select * into v_profile from public.registrations where id = v_reg.id for update;
    v_missing := public.scanner_missing_fields(v_profile.form_data);
    if v_profile.status = 'registered' and cardinality(v_missing) > 0
       and not exists (select 1 from public.check_ins where registration_id = v_profile.id and status = 'success') then
      return jsonb_build_object('status', 'missing_profile', 'missing_fields', v_missing,
        'registration_number', v_profile.registration_number,
        'applicant_name', concat_ws(' ', v_profile.first_name, v_profile.last_name));
    end if;
  end if;

  if v_reg.status <> 'registered' then
    return jsonb_build_object('status', 'invalid_ticket',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name));
  end if;

  if v_reg.event_date is not null and v_reg.event_date < (now() at time zone 'Asia/Manila')::date then
    return jsonb_build_object('status', 'event_past',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
      'event_name', v_reg.event_name,
      'event_date', v_reg.event_date);
  end if;

  begin
    insert into public.check_ins (registration_id, scanned_by, device_identifier, status, event_id)
    values (v_reg.id, auth.uid(), nullif(btrim(coalesce(p_device_identifier, '')), ''), 'success',
            coalesce(p_event_id, v_reg.event_id))
    on conflict (registration_id) where status = 'success'
    do nothing
    returning id, scanned_at into v_ci_id, v_scanned_at;

    if v_ci_id is not null then
      return jsonb_build_object('status', 'success',
        'registration_number', v_reg.registration_number,
        'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
        'checked_in_at', v_scanned_at);
    end if;

    select c.scanned_at into v_scanned_at
      from public.check_ins c
     where c.registration_id = v_reg.id and c.status = 'success';

    return jsonb_build_object('status', 'already_checked_in',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
      'checked_in_at', v_scanned_at);
  exception
    when others then
      return jsonb_build_object('status', 'error',
        'message', 'CHECK-IN COULD NOT BE COMPLETED');
  end;
end;
$$;

revoke execute on function public.perform_check_in(text, text, uuid) from public;
revoke execute on function public.perform_check_in(text, text, uuid) from anon;
grant execute on function public.perform_check_in(text, text, uuid) to authenticated;


create or replace function public.admin_record_late_check_in(
  p_registration_number text, p_reason text, p_device_identifier text default null
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_reg record;
  v_profile public.registrations%rowtype;
  v_missing text[];
  v_ci public.check_ins%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 1000 then
    return jsonb_build_object('status', 'reason_required');
  end if;
  select r.id, r.registration_number, r.first_name, r.last_name, r.status, e.event_date, e.id as event_id
    into v_reg from public.registrations r join public.events e on e.id = r.event_id
    where r.registration_number = btrim(p_registration_number)
    for update of r for share of e;
  if not found then return jsonb_build_object('status', 'registration_not_found'); end if;
  if public.scanner_profile_checkpoint_applies(v_reg.registration_number) then
    select * into v_profile from public.registrations where id = v_reg.id for update;
    v_missing := public.scanner_missing_fields(v_profile.form_data);
    if v_profile.status = 'registered' and cardinality(v_missing) > 0
       and not exists (select 1 from public.check_ins where registration_id = v_profile.id and status = 'success') then
      return jsonb_build_object('status', 'missing_profile', 'missing_fields', v_missing,
        'registration_number', v_profile.registration_number,
        'applicant_name', concat_ws(' ', v_profile.first_name, v_profile.last_name));
    end if;
  end if;

  if v_reg.status <> 'registered' then return jsonb_build_object('status', 'invalid_ticket'); end if;
  if v_reg.event_date is null or v_reg.event_date >= (now() at time zone 'Asia/Manila')::date then
    return jsonb_build_object('status', 'not_past_event');
  end if;

  insert into public.check_ins (
    registration_id, scanned_by, device_identifier, status, attendance_date, override_reason, event_id
  ) values (
    v_reg.id, auth.uid(), nullif(btrim(p_device_identifier), ''), 'success',
    v_reg.event_date, btrim(p_reason), v_reg.event_id
  )
  on conflict (registration_id) where status = 'success' do nothing
  returning * into v_ci;
  if v_ci.id is null then
    select * into v_ci from public.check_ins where registration_id = v_reg.id and status = 'success';
    return jsonb_build_object('status', 'already_checked_in',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
      'checked_in_at', v_ci.scanned_at);
  end if;
  return jsonb_build_object('status', 'success',
    'registration_number', v_reg.registration_number,
    'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
    'checked_in_at', v_ci.scanned_at,
    'attendance_date', v_ci.attendance_date);
end;
$$;

revoke execute on function public.admin_record_late_check_in(text, text, text) from public, anon;
grant execute on function public.admin_record_late_check_in(text, text, text) to authenticated;


create or replace function public.staff_complete_scanner_profile(p_ticket_token text, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_registration public.registrations%rowtype;
  v_missing text[];
  v_key text;
  v_value text;
  v_date date;
  v_patch jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or not public.is_staff() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('status', 'invalid_answers');
  end if;
  select * into v_registration from public.registrations
    where ticket_token = btrim(coalesce(p_ticket_token, '')) for update;
  if not found then return jsonb_build_object('status', 'registration_not_found'); end if;
  if v_registration.status <> 'registered' then return jsonb_build_object('status', 'invalid_ticket'); end if;
  if not public.scanner_profile_checkpoint_applies(v_registration.registration_number) then
    return jsonb_build_object('status', 'not_in_checkpoint');
  end if;
  if exists (select 1 from jsonb_object_keys(p_answers) as supplied(key)
    where not (supplied.key = any(array['date_of_birth', 'course', 'pwd', 'sex', 'first_time_job_seeker', 'returning_ofw', 'returning_worker', 'interested_in_skills_training', 'province', 'municipality_city', 'barangay']::text[]))) then
    return jsonb_build_object('status', 'invalid_answers');
  end if;
  v_missing := public.scanner_missing_fields(v_registration.form_data);
  foreach v_key in array v_missing loop
    if jsonb_typeof(p_answers -> v_key) is distinct from 'string' then
      return jsonb_build_object('status', 'required_fields');
    end if;
    v_value := nullif(btrim(p_answers ->> v_key), '');
    if v_value is null then return jsonb_build_object('status', 'required_fields'); end if;
    if v_key = 'date_of_birth' then
      begin
        v_date := v_value::date;
      exception
        when invalid_datetime_format or datetime_field_overflow then
          return jsonb_build_object('status', 'invalid_answers');
      end;
      if to_char(v_date, 'YYYY-MM-DD') <> v_value or v_date > (now() at time zone 'Asia/Manila')::date then
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
  end loop;
  update public.registrations set form_data = coalesce(form_data, '{}'::jsonb) || v_patch,
    updated_at = now() where id = v_registration.id;
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke all on function public.staff_complete_scanner_profile(text, jsonb) from public, anon;
grant execute on function public.staff_complete_scanner_profile(text, jsonb) to authenticated;
