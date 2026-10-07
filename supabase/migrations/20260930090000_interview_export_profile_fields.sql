-- Add applicant profile/classification fields to the interview results export.
--
-- staff_export_interview_results previously returned only identity + outcome
-- columns (registration_number, applicant_name, company, position, status,
-- updated_at), so the interview CSV could not be analysed by sector without
-- joining it back to a registration dump.
--
-- This widens the function's return type with the nine analysis fields that
-- live in registrations.form_data (see 20260826160000_seed_form_fields.sql):
--   pwd, sex, first_time_job_seeker, returning_ofw, returning_worker,
--   interested_in_skills_training, province, municipality_city, barangay
--
-- Changing a function's return type requires dropping it first; the guard
-- checks (auth.uid()/is_staff(), event required) and the keyset pagination on
-- id > p_after are preserved verbatim.

drop function if exists public.staff_export_interview_results(uuid, uuid);

create function public.staff_export_interview_results(p_event_id uuid, p_after uuid default null)
returns table(
  id uuid,
  registration_number text,
  applicant_name text,
  pwd text,
  sex text,
  first_time_job_seeker text,
  returning_ofw text,
  returning_worker text,
  interested_in_skills_training text,
  province text,
  municipality_city text,
  barangay text,
  company text,
  "position" text,
  status text,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_event_id is null then raise exception 'Choose an event' using errcode='22023'; end if;
  return query
  select i.id,
         r.registration_number,
         concat_ws(' ', r.first_name, nullif(r.middle_name, ''), r.last_name, nullif(r.suffix, '')),
         r.form_data->>'pwd',
         r.form_data->>'sex',
         r.form_data->>'first_time_job_seeker',
         r.form_data->>'returning_ofw',
         r.form_data->>'returning_worker',
         r.form_data->>'interested_in_skills_training',
         r.form_data->>'province',
         r.form_data->>'municipality_city',
         r.form_data->>'barangay',
         i.company,
         i.position,
         i.status,
         i.updated_at
  from public.interview_results i join public.registrations r on r.id=i.registration_id
  where i.event_id=p_event_id and (p_after is null or i.id>p_after)
  order by i.id limit 500;
end $$;
revoke all on function public.staff_export_interview_results(uuid,uuid) from public,anon;
grant execute on function public.staff_export_interview_results(uuid,uuid) to authenticated;
