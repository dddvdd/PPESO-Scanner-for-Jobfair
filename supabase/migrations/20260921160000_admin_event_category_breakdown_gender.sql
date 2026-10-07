drop function if exists public.admin_event_category_breakdown(uuid);
create or replace function public.admin_event_category_breakdown(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  with base as (
    select r.*, public.parse_date_safe(r.form_data->>'date_of_birth') as dob_parsed
    from public.registrations r where r.event_id = p_event_id
  ), tagged as (
    select b.*, case when b.dob_parsed is not null then extract(year from age(b.dob_parsed)) <= 30 else false end as is_youth
    from base b
  )
  select jsonb_build_object(
    'total_prereg', count(*) filter (where t.entry_source = 'pre_registration'),
    'total_prereg_male', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'sex' = 'Male'),
    'total_prereg_female', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'sex' = 'Female'),
    'total_checkin', count(*) filter (where exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'total_checkin_male', count(*) filter (where t.form_data->>'sex' = 'Male' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'total_checkin_female', count(*) filter (where t.form_data->>'sex' = 'Female' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    
    'pwd_prereg', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'pwd' = 'Yes'),
    'pwd_prereg_male', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'pwd' = 'Yes' and t.form_data->>'sex' = 'Male'),
    'pwd_prereg_female', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'pwd' = 'Yes' and t.form_data->>'sex' = 'Female'),
    'pwd_checkin', count(*) filter (where t.form_data->>'pwd' = 'Yes' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'pwd_checkin_male', count(*) filter (where t.form_data->>'pwd' = 'Yes' and t.form_data->>'sex' = 'Male' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'pwd_checkin_female', count(*) filter (where t.form_data->>'pwd' = 'Yes' and t.form_data->>'sex' = 'Female' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    
    'first_time_prereg', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'first_time_job_seeker') = 'yes'),
    'first_time_prereg_male', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'first_time_job_seeker') = 'yes' and t.form_data->>'sex' = 'Male'),
    'first_time_prereg_female', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'first_time_job_seeker') = 'yes' and t.form_data->>'sex' = 'Female'),
    'first_time_checkin', count(*) filter (where lower(t.form_data->>'first_time_job_seeker') = 'yes' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'first_time_checkin_male', count(*) filter (where lower(t.form_data->>'first_time_job_seeker') = 'yes' and t.form_data->>'sex' = 'Male' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'first_time_checkin_female', count(*) filter (where lower(t.form_data->>'first_time_job_seeker') = 'yes' and t.form_data->>'sex' = 'Female' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    
    'ofw_prereg', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'returning_ofw') = 'yes'),
    'ofw_prereg_male', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'returning_ofw') = 'yes' and t.form_data->>'sex' = 'Male'),
    'ofw_prereg_female', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'returning_ofw') = 'yes' and t.form_data->>'sex' = 'Female'),
    'ofw_checkin', count(*) filter (where lower(t.form_data->>'returning_ofw') = 'yes' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'ofw_checkin_male', count(*) filter (where lower(t.form_data->>'returning_ofw') = 'yes' and t.form_data->>'sex' = 'Male' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'ofw_checkin_female', count(*) filter (where lower(t.form_data->>'returning_ofw') = 'yes' and t.form_data->>'sex' = 'Female' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    
    'worker_prereg', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'returning_worker') = 'yes'),
    'worker_prereg_male', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'returning_worker') = 'yes' and t.form_data->>'sex' = 'Male'),
    'worker_prereg_female', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'returning_worker') = 'yes' and t.form_data->>'sex' = 'Female'),
    'worker_checkin', count(*) filter (where lower(t.form_data->>'returning_worker') = 'yes' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'worker_checkin_male', count(*) filter (where lower(t.form_data->>'returning_worker') = 'yes' and t.form_data->>'sex' = 'Male' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'worker_checkin_female', count(*) filter (where lower(t.form_data->>'returning_worker') = 'yes' and t.form_data->>'sex' = 'Female' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    
    'training_prereg', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'interested_in_skills_training' = 'Yes'),
    'training_prereg_male', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'interested_in_skills_training' = 'Yes' and t.form_data->>'sex' = 'Male'),
    'training_prereg_female', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'interested_in_skills_training' = 'Yes' and t.form_data->>'sex' = 'Female'),
    'training_checkin', count(*) filter (where t.form_data->>'interested_in_skills_training' = 'Yes' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'training_checkin_male', count(*) filter (where t.form_data->>'interested_in_skills_training' = 'Yes' and t.form_data->>'sex' = 'Male' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'training_checkin_female', count(*) filter (where t.form_data->>'interested_in_skills_training' = 'Yes' and t.form_data->>'sex' = 'Female' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    
    'walkin_prereg', count(*) filter (where t.entry_source = 'post_event_walk_in'),
    'walkin_prereg_male', count(*) filter (where t.entry_source = 'post_event_walk_in' and t.form_data->>'sex' = 'Male'),
    'walkin_prereg_female', count(*) filter (where t.entry_source = 'post_event_walk_in' and t.form_data->>'sex' = 'Female'),
    'walkin_checkin', count(*) filter (where t.entry_source = 'post_event_walk_in' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'walkin_checkin_male', count(*) filter (where t.entry_source = 'post_event_walk_in' and t.form_data->>'sex' = 'Male' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'walkin_checkin_female', count(*) filter (where t.entry_source = 'post_event_walk_in' and t.form_data->>'sex' = 'Female' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    
    'youth_prereg', count(*) filter (where t.entry_source = 'pre_registration' and t.is_youth),
    'youth_prereg_male', count(*) filter (where t.entry_source = 'pre_registration' and t.is_youth and t.form_data->>'sex' = 'Male'),
    'youth_prereg_female', count(*) filter (where t.entry_source = 'pre_registration' and t.is_youth and t.form_data->>'sex' = 'Female'),
    'youth_checkin', count(*) filter (where t.is_youth and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'youth_checkin_male', count(*) filter (where t.is_youth and t.form_data->>'sex' = 'Male' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'youth_checkin_female', count(*) filter (where t.is_youth and t.form_data->>'sex' = 'Female' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success'))
  ) into v_result from tagged t;
  return jsonb_build_object('status', 'ok', 'data', v_result);
end;
$$;

revoke execute on function public.admin_event_category_breakdown(uuid) from public, anon;
grant execute on function public.admin_event_category_breakdown(uuid) to authenticated;
