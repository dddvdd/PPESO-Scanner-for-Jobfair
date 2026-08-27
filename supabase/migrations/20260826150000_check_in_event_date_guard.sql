-- ============================================================================
-- Migration 009 — Enforce current date match in perform_check_in() RPC
--
-- Only allows check-in if the registrant's event date matches CURRENT_DATE.
-- Rejects check-ins for events scheduled on a different date.
-- ============================================================================

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
  if v_reg.event_date is not null and v_reg.event_date <> current_date then
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
