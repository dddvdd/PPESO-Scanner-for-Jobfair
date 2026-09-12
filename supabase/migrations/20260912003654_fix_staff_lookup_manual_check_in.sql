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
