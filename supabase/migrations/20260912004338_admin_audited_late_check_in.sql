-- Late attendance is a separate, audited admin action. Timestamps remain truthful.
alter table public.check_ins
  add column attendance_date date,
  add column override_reason text;
alter table public.check_ins add constraint check_ins_override_audit
  check (override_reason is null or
    (attendance_date is not null and length(btrim(override_reason)) between 1 and 1000));

create or replace function public.admin_record_late_check_in(
  p_registration_number text, p_reason text, p_device_identifier text default null
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_reg record;
  v_ci public.check_ins%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 1000 then
    return jsonb_build_object('status', 'reason_required');
  end if;
  select r.id, r.registration_number, r.first_name, r.last_name, r.status, e.event_date
    into v_reg from public.registrations r join public.events e on e.id = r.event_id
    where r.registration_number = btrim(p_registration_number)
    for share of r, e;
  if not found then return jsonb_build_object('status', 'registration_not_found'); end if;
  if v_reg.status <> 'registered' then return jsonb_build_object('status', 'invalid_ticket'); end if;
  if v_reg.event_date is null or v_reg.event_date >= (now() at time zone 'Asia/Manila')::date then
    return jsonb_build_object('status', 'not_past_event');
  end if;

  insert into public.check_ins (
    registration_id, scanned_by, device_identifier, status, attendance_date, override_reason
  ) values (
    v_reg.id, auth.uid(), nullif(btrim(p_device_identifier), ''), 'success',
    v_reg.event_date, btrim(p_reason)
  )
  on conflict (registration_id) where status = 'success' do nothing
  returning * into v_ci;
  if v_ci.id is null then
    select * into v_ci from public.check_ins where registration_id = v_reg.id and status = 'success';
    return jsonb_build_object('status', 'already_checked_in',
      'registration_number', v_reg.registration_number, 'checked_in_at', v_ci.scanned_at,
      'attendance_date', v_ci.attendance_date);
  end if;
  return jsonb_build_object('status', 'success', 'registration_number', v_reg.registration_number,
    'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
    'checked_in_at', v_ci.scanned_at, 'attendance_date', v_ci.attendance_date);
end;
$$;
revoke execute on function public.admin_record_late_check_in(text, text, text) from public, anon;
grant execute on function public.admin_record_late_check_in(text, text, text) to authenticated;

-- Enforce the normal date rule server-side, using Philippine time.
create or replace function public.perform_check_in(
  p_ticket_token text,
  p_device_identifier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg record;
  v_ci_id uuid;
  v_scanned_at timestamptz;
begin
  if not public.is_staff() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select r.id,
         r.registration_number,
         r.ticket_token,
         r.first_name,
         r.last_name,
         r.status,
         e.id as event_id,
         e.name as event_name,
         e.event_date
    into v_reg
    from public.registrations r
    join public.events e on e.id = r.event_id
   where r.ticket_token = btrim(coalesce(p_ticket_token, ''));

  if v_reg.id is null then
    return jsonb_build_object('status', 'registration_not_found');
  end if;

  if v_reg.status <> 'registered' then
    return jsonb_build_object(
      'status', 'invalid_ticket',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name)
    );
  end if;

  -- Guard: Event date must match CURRENT_DATE (today)
  if v_reg.event_date is not null and v_reg.event_date <> (now() at time zone 'Asia/Manila')::date then
    return jsonb_build_object(
      'status', 'event_date_mismatch',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
      'event_name', v_reg.event_name,
      'event_date', v_reg.event_date
    );
  end if;

  begin
    insert into public.check_ins (registration_id, scanned_by, device_identifier, status)
    values (v_reg.id, auth.uid(), nullif(btrim(coalesce(p_device_identifier, '')), ''), 'success')
    on conflict (registration_id) where status = 'success'
    do nothing
    returning id, scanned_at into v_ci_id, v_scanned_at;

    if v_ci_id is not null then
      return jsonb_build_object(
        'status', 'success',
        'registration_number', v_reg.registration_number,
        'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
        'checked_in_at', v_scanned_at
      );
    end if;

    -- Conflict lost the race: report original check-in
    select c.scanned_at
      into v_scanned_at
      from public.check_ins c
     where c.registration_id = v_reg.id
       and c.status = 'success';

    return jsonb_build_object(
      'status', 'already_checked_in',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
      'checked_in_at', v_scanned_at
    );
  exception
    when others then
      return jsonb_build_object(
        'status', 'error',
        'message', 'CHECK-IN COULD NOT BE COMPLETED'
      );
  end;
end;
$$;

revoke execute on function public.perform_check_in(text, text) from public;
revoke execute on function public.perform_check_in(text, text) from anon;
grant execute on function public.perform_check_in(text, text) to authenticated;
-- Staff name lookup supplies the stored ticket token for manual check-in.
-- No attendee QR code is required; existing staff authorization is retained.
create or replace function public.staff_lookup(p_query text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_rows jsonb;
begin
  if not public.is_staff() then
    return jsonb_build_object('status', 'forbidden', 'results', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(matches) order by matches.checked_in_at desc nulls last, matches.registered_at desc), '[]'::jsonb)
  into v_rows
  from (
    select r.registration_number, r.ticket_token,
      concat_ws(' ', r.first_name, r.last_name) as applicant_name,
      r.email, e.name as event_name, e.event_date,
      r.status as registration_status, c.scanned_at as checked_in_at,
      c.attendance_date, (c.override_reason is not null) as is_late_check_in,
      r.registered_at
    from public.registrations r
    join public.events e on e.id = r.event_id
    left join public.check_ins c on c.registration_id = r.id and c.status = 'success'
    where v_q = '' or r.ticket_token = v_q
      or r.registration_number = upper(v_q)
      or r.email = lower(v_q)
      or concat_ws(' ', r.first_name, r.last_name) ilike '%' || v_q || '%'
    order by c.scanned_at desc nulls last, r.registered_at desc
    limit 30
  ) matches;
  return jsonb_build_object('status', 'ok', 'results', v_rows);
end;
$$;
revoke execute on function public.staff_lookup(text) from public, anon;
grant execute on function public.staff_lookup(text) to authenticated;
