-- ============================================================================
-- Migration 008 — Include ticket_token, event_date & default list in staff_lookup()
--
-- Enables manual check-in from staff search interface by returning ticket_token.
-- When p_query is empty, returns the recent registrants / check-ins so staff
-- sees the active check-in list immediately without needing to search.
-- ============================================================================

create or replace function public.staff_lookup(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text;
  v_rows jsonb;
begin
  if not public.is_staff() then
    return jsonb_build_object('status', 'forbidden', 'results', '[]'::jsonb);
  end if;

  v_q := btrim(coalesce(p_query, ''));

  if v_q = '' then
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'registration_number', r.registration_number,
        'ticket_token', r.ticket_token,
        'applicant_name', concat_ws(' ', r.first_name, r.last_name),
        'email', r.email,
        'event_name', e.name,
        'event_date', e.event_date,
        'registration_status', r.status,
        'checked_in_at', c.scanned_at
      )),
      '[]'::jsonb
    )
      into v_rows
      from (
        select r.id, r.registration_number, r.ticket_token, r.first_name, r.last_name, r.email, r.event_id, r.status, r.registered_at
          from public.registrations r
         order by r.registered_at desc
         limit 30
      ) r
      join public.events e on e.id = r.event_id
      left join public.check_ins c
        on c.registration_id = r.id and c.status = 'success'
     order by c.scanned_at desc nulls last, r.registered_at desc;

    return jsonb_build_object('status', 'ok', 'results', v_rows);
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'registration_number', r.registration_number,
      'ticket_token', r.ticket_token,
      'applicant_name', concat_ws(' ', r.first_name, r.last_name),
      'email', r.email,
      'event_name', e.name,
      'event_date', e.event_date,
      'registration_status', r.status,
      'checked_in_at', c.scanned_at
    )),
    '[]'::jsonb
  )
    into v_rows
    from public.registrations r
    join public.events e on e.id = r.event_id
    left join public.check_ins c
      on c.registration_id = r.id and c.status = 'success'
   where r.ticket_token = v_q
      or r.registration_number = upper(v_q)
      or r.email = lower(v_q)
      or concat_ws(' ', r.first_name, r.last_name) ilike '%' || v_q || '%'
   order by c.scanned_at desc nulls last, r.registered_at desc
   limit 30;

  return jsonb_build_object('status', 'ok', 'results', v_rows);
end;
$$;

revoke execute on function public.staff_lookup(text) from public;
revoke execute on function public.staff_lookup(text) from anon;
grant execute on function public.staff_lookup(text) to authenticated;
