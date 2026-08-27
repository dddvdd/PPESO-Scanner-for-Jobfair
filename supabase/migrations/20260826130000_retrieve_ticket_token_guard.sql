-- ============================================================================
-- Migration 007 — P1 fix: stop ticket_token leaking via email-only lookup
--
-- Vulnerability (security audit P1): retrieve_ticket() allowed an email-only
-- lookup to return the COMPLETE ticket (including ticket_token) to anyone who
-- knew a jobseeker's email address.
--
-- Fix:
--   - p_registration_number EMPTY (email-only) -> returns a NON-SENSITIVE
--     confirmation only: applicant name, email, event + check-in details.
--     NEVER returns registration_number or ticket_token (either one would
--     let the "require both" gate be bypassed in two calls).
--   - p_registration_number GIVEN (number + email) -> original behaviour,
--     full details INCLUDING registration_number and ticket_token
--     (fully backwards compatible for legitimate holders).
--
-- Unchanged:
--   - WHERE/ordering semantics (NEWEST match for email-only, exact match for
--     number + email)
--   - Anti-enumeration contract: any miss raises the identical
--     TICKET_NOT_FOUND signal
--   - SECURITY DEFINER + set search_path = public
--   - EXECUTE grants are preserved by CREATE OR REPLACE (anon, authenticated)
--   - perform_check_in(), staff scanner, QR generation, RLS policies untouched
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
  v_row     record;
  v_result  jsonb;
  v_has_regno boolean;
begin
  v_has_regno := btrim(coalesce(p_registration_number, '')) <> '';

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
          (not v_has_regno
             and r.email = lower(btrim(p_verification_email)))
       or
          (v_has_regno
             and r.registration_number = upper(btrim(p_registration_number))
             and r.email = lower(btrim(p_verification_email)))
          )
   order by greatest(coalesce(c.scanned_at, timestamptz '-infinity'),
                     r.registered_at) desc
   limit 1;

  if v_row.id is null then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  -- Email-only path: non-sensitive confirmation only. registration_number is
  -- deliberately EXCLUDED so it cannot be chained with the email to unlock
  -- the token in a second call.
  v_result := jsonb_build_object(
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

  -- Full ticket is released ONLY when the caller proves knowledge of BOTH the
  -- registration number AND the matching verification email.
  if v_has_regno then
    v_result := v_result || jsonb_build_object(
      'registration_number', v_row.registration_number,
      'ticket_token',        v_row.ticket_token
    );
  end if;

  return v_result;
end;
$$;
