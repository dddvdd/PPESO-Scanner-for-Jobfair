-- ============================================================================
-- Migration 006 — Ticket retrieval by email alone
--
-- Business rule (Sept 11 MVP): one email per event identifies the jobseeker,
-- so applicants retrieve their ticket with ONLY their email address.
--
-- Behaviour:
--   p_registration_number EMPTY  -> look up by verified email, returning the
--                                   NEWEST matching registration
--   p_registration_number GIVEN  -> original behaviour (number + email),
--                                   fully backwards compatible
--
-- Anti-enumeration contract preserved: any miss raises the identical
-- TICKET_NOT_FOUND signal regardless of which condition failed.
--
-- Privileges are preserved automatically: CREATE OR REPLACE keeps the
-- existing EXECUTE grants (anon, authenticated, service_role).
-- ============================================================================

create or replace function public.retrieve_ticket(
  p_registration_number text,
  p_verification_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select r.id,
         r.registration_number,
         r.ticket_token,
         r.first_name,
         r.middle_name,
         r.last_name,
         r.suffix,
         r.email,
         r.status,
         r.registered_at,
         e.name        as event_name,
         e.event_date  as event_date,
         e.location    as location,
         c.scanned_at  as checked_in_at
    into v_row
    from public.registrations r
    join public.events e on e.id = r.event_id
    left join public.check_ins c
      on c.registration_id = r.id and c.status = 'success'
   where (
         (btrim(coalesce(p_registration_number, '')) = ''
            and r.email = lower(btrim(p_verification_email)))
      or
         (btrim(coalesce(p_registration_number, '')) <> ''
            and r.registration_number = upper(btrim(p_registration_number))
            and r.email = lower(btrim(p_verification_email)))
         )
   order by greatest(coalesce(c.scanned_at, timestamptz '-infinity'),
                     r.registered_at) desc
   limit 1;

  if v_row.id is null then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'registration_number', v_row.registration_number,
    'ticket_token',        v_row.ticket_token,
    'first_name',          v_row.first_name,
    'middle_name',         v_row.middle_name,
    'last_name',           v_row.last_name,
    'suffix',              v_row.suffix,
    'email',               v_row.email,
    'event_name',          v_row.event_name,
    'event_date',          v_row.event_date,
    'location',            v_row.location,
    'registration_status', v_row.status,
    'registered_at',       v_row.registered_at,
    'checked_in_at',       v_row.checked_in_at
  );
end;
$$;
