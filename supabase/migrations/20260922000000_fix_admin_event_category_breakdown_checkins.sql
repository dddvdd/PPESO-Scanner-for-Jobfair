-- Fix admin_event_category_breakdown: drive check-in metrics from check_ins.event_id
--
-- Root cause: the previous RPC started from registrations WHERE event_id = p_event_id,
-- then checked for matching check-ins via EXISTS. Cross-event check-ins (where
-- check_ins.event_id = target_event but registrations.event_id = different_event)
-- were invisible because the registration was never in the driving row set.
--
-- Fix: for CHECK-IN metrics, start from check_ins WHERE event_id = p_event_id
-- AND status = 'success', then JOIN to registrations for form_data classification.
-- PREREGISTRATION metrics remain driven by registrations.event_id (unchanged).

drop function if exists public.admin_event_category_breakdown(uuid);
create or replace function public.admin_event_category_breakdown(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  with
  -- Preregistration metrics: driven by registrations for this event
  prereg_stats as (
    select jsonb_build_object(
      'total_prereg', count(*) filter (where r.entry_source = 'pre_registration'),
      'total_prereg_male', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'sex' = 'Male'),
      'total_prereg_female', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'sex' = 'Female'),
      'total_prereg_unspecified', count(*) filter (where r.entry_source = 'pre_registration' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'pwd_prereg', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'pwd' = 'Yes'),
      'pwd_prereg_male', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'pwd' = 'Yes' and r.form_data->>'sex' = 'Male'),
      'pwd_prereg_female', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'pwd' = 'Yes' and r.form_data->>'sex' = 'Female'),
      'pwd_prereg_unspecified', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'pwd' = 'Yes' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'first_time_prereg', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'first_time_job_seeker') = 'yes'),
      'first_time_prereg_male', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'first_time_job_seeker') = 'yes' and r.form_data->>'sex' = 'Male'),
      'first_time_prereg_female', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'first_time_job_seeker') = 'yes' and r.form_data->>'sex' = 'Female'),
      'first_time_prereg_unspecified', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'first_time_job_seeker') = 'yes' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'ofw_prereg', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'returning_ofw') = 'yes'),
      'ofw_prereg_male', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'returning_ofw') = 'yes' and r.form_data->>'sex' = 'Male'),
      'ofw_prereg_female', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'returning_ofw') = 'yes' and r.form_data->>'sex' = 'Female'),
      'ofw_prereg_unspecified', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'returning_ofw') = 'yes' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'worker_prereg', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'returning_worker') = 'yes'),
      'worker_prereg_male', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'returning_worker') = 'yes' and r.form_data->>'sex' = 'Male'),
      'worker_prereg_female', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'returning_worker') = 'yes' and r.form_data->>'sex' = 'Female'),
      'worker_prereg_unspecified', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'returning_worker') = 'yes' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'training_prereg', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'interested_in_skills_training' = 'Yes'),
      'training_prereg_male', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'interested_in_skills_training' = 'Yes' and r.form_data->>'sex' = 'Male'),
      'training_prereg_female', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'interested_in_skills_training' = 'Yes' and r.form_data->>'sex' = 'Female'),
      'training_prereg_unspecified', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'interested_in_skills_training' = 'Yes' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'walkin_prereg', count(*) filter (where r.entry_source = 'post_event_walk_in'),
      'walkin_prereg_male', count(*) filter (where r.entry_source = 'post_event_walk_in' and r.form_data->>'sex' = 'Male'),
      'walkin_prereg_female', count(*) filter (where r.entry_source = 'post_event_walk_in' and r.form_data->>'sex' = 'Female'),
      'walkin_prereg_unspecified', count(*) filter (where r.entry_source = 'post_event_walk_in' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'youth_prereg', count(*) filter (where r.entry_source = 'pre_registration' and public.parse_date_safe(r.form_data->>'date_of_birth') is not null and extract(year from age(public.parse_date_safe(r.form_data->>'date_of_birth'))) <= 30),
      'youth_prereg_male', count(*) filter (where r.entry_source = 'pre_registration' and public.parse_date_safe(r.form_data->>'date_of_birth') is not null and extract(year from age(public.parse_date_safe(r.form_data->>'date_of_birth'))) <= 30 and r.form_data->>'sex' = 'Male'),
      'youth_prereg_female', count(*) filter (where r.entry_source = 'pre_registration' and public.parse_date_safe(r.form_data->>'date_of_birth') is not null and extract(year from age(public.parse_date_safe(r.form_data->>'date_of_birth'))) <= 30 and r.form_data->>'sex' = 'Female'),
      'youth_prereg_unspecified', count(*) filter (where r.entry_source = 'pre_registration' and public.parse_date_safe(r.form_data->>'date_of_birth') is not null and extract(year from age(public.parse_date_safe(r.form_data->>'date_of_birth'))) <= 30 and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female')))
    ) as stats
    from public.registrations r
    where r.event_id = p_event_id
  ),

  -- Check-in metrics: driven by check_ins for this event, joined to registrations for attributes
  checkin_stats as (
    select jsonb_build_object(
      'total_checkin', count(*),
      'total_checkin_male', count(*) filter (where r.form_data->>'sex' = 'Male'),
      'total_checkin_female', count(*) filter (where r.form_data->>'sex' = 'Female'),
      'total_checkin_unspecified', count(*) filter (where r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female')),
      'pwd_checkin', count(*) filter (where r.form_data->>'pwd' = 'Yes'),
      'pwd_checkin_male', count(*) filter (where r.form_data->>'pwd' = 'Yes' and r.form_data->>'sex' = 'Male'),
      'pwd_checkin_female', count(*) filter (where r.form_data->>'pwd' = 'Yes' and r.form_data->>'sex' = 'Female'),
      'pwd_checkin_unspecified', count(*) filter (where r.form_data->>'pwd' = 'Yes' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'first_time_checkin', count(*) filter (where lower(r.form_data->>'first_time_job_seeker') = 'yes'),
      'first_time_checkin_male', count(*) filter (where lower(r.form_data->>'first_time_job_seeker') = 'yes' and r.form_data->>'sex' = 'Male'),
      'first_time_checkin_female', count(*) filter (where lower(r.form_data->>'first_time_job_seeker') = 'yes' and r.form_data->>'sex' = 'Female'),
      'first_time_checkin_unspecified', count(*) filter (where lower(r.form_data->>'first_time_job_seeker') = 'yes' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'ofw_checkin', count(*) filter (where lower(r.form_data->>'returning_ofw') = 'yes'),
      'ofw_checkin_male', count(*) filter (where lower(r.form_data->>'returning_ofw') = 'yes' and r.form_data->>'sex' = 'Male'),
      'ofw_checkin_female', count(*) filter (where lower(r.form_data->>'returning_ofw') = 'yes' and r.form_data->>'sex' = 'Female'),
      'ofw_checkin_unspecified', count(*) filter (where lower(r.form_data->>'returning_ofw') = 'yes' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'worker_checkin', count(*) filter (where lower(r.form_data->>'returning_worker') = 'yes'),
      'worker_checkin_male', count(*) filter (where lower(r.form_data->>'returning_worker') = 'yes' and r.form_data->>'sex' = 'Male'),
      'worker_checkin_female', count(*) filter (where lower(r.form_data->>'returning_worker') = 'yes' and r.form_data->>'sex' = 'Female'),
      'worker_checkin_unspecified', count(*) filter (where lower(r.form_data->>'returning_worker') = 'yes' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'training_checkin', count(*) filter (where r.form_data->>'interested_in_skills_training' = 'Yes'),
      'training_checkin_male', count(*) filter (where r.form_data->>'interested_in_skills_training' = 'Yes' and r.form_data->>'sex' = 'Male'),
      'training_checkin_female', count(*) filter (where r.form_data->>'interested_in_skills_training' = 'Yes' and r.form_data->>'sex' = 'Female'),
      'training_checkin_unspecified', count(*) filter (where r.form_data->>'interested_in_skills_training' = 'Yes' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'walkin_checkin', count(*) filter (where r.entry_source = 'post_event_walk_in'),
      'walkin_checkin_male', count(*) filter (where r.entry_source = 'post_event_walk_in' and r.form_data->>'sex' = 'Male'),
      'walkin_checkin_female', count(*) filter (where r.entry_source = 'post_event_walk_in' and r.form_data->>'sex' = 'Female'),
      'walkin_checkin_unspecified', count(*) filter (where r.entry_source = 'post_event_walk_in' and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female'))),
      'youth_checkin', count(*) filter (where public.parse_date_safe(r.form_data->>'date_of_birth') is not null and extract(year from age(public.parse_date_safe(r.form_data->>'date_of_birth'))) <= 30),
      'youth_checkin_male', count(*) filter (where public.parse_date_safe(r.form_data->>'date_of_birth') is not null and extract(year from age(public.parse_date_safe(r.form_data->>'date_of_birth'))) <= 30 and r.form_data->>'sex' = 'Male'),
      'youth_checkin_female', count(*) filter (where public.parse_date_safe(r.form_data->>'date_of_birth') is not null and extract(year from age(public.parse_date_safe(r.form_data->>'date_of_birth'))) <= 30 and r.form_data->>'sex' = 'Female'),
      'youth_checkin_unspecified', count(*) filter (where public.parse_date_safe(r.form_data->>'date_of_birth') is not null and extract(year from age(public.parse_date_safe(r.form_data->>'date_of_birth'))) <= 30 and (r.form_data->>'sex' is null or r.form_data->>'sex' not in ('Male', 'Female')))
    ) as stats
    from public.check_ins ci
    join public.registrations r on r.id = ci.registration_id
    where ci.event_id = p_event_id
      and ci.status = 'success'
  )

  select jsonb_build_object(
    'status', 'ok',
    'data', ps.stats || cs.stats
  ) into v_result
  from prereg_stats ps, checkin_stats cs;

  return v_result;
end;
$$;

revoke execute on function public.admin_event_category_breakdown(uuid) from public, anon;
grant execute on function public.admin_event_category_breakdown(uuid) to authenticated;
