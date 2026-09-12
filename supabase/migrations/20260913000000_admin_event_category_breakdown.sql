create or replace function public.admin_event_category_breakdown(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select jsonb_build_object(
    'total_prereg', count(*) filter (where r.entry_source = 'pre_registration'),
    'total_checkin', count(*) filter (where exists (
      select 1 from public.check_ins c where c.registration_id = r.id and c.status = 'success'
    )),
    'pwd_prereg', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'pwd' = 'Yes'),
    'pwd_checkin', count(*) filter (where r.form_data->>'pwd' = 'Yes' and exists (
      select 1 from public.check_ins c where c.registration_id = r.id and c.status = 'success'
    )),
    'first_time_prereg', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'first_time_job_seeker') = 'yes'),
    'first_time_checkin', count(*) filter (where lower(r.form_data->>'first_time_job_seeker') = 'yes' and exists (
      select 1 from public.check_ins c where c.registration_id = r.id and c.status = 'success'
    )),
    'ofw_prereg', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'returning_ofw') = 'yes'),
    'ofw_checkin', count(*) filter (where lower(r.form_data->>'returning_ofw') = 'yes' and exists (
      select 1 from public.check_ins c where c.registration_id = r.id and c.status = 'success'
    )),
    'worker_prereg', count(*) filter (where r.entry_source = 'pre_registration' and lower(r.form_data->>'returning_worker') = 'yes'),
    'worker_checkin', count(*) filter (where lower(r.form_data->>'returning_worker') = 'yes' and exists (
      select 1 from public.check_ins c where c.registration_id = r.id and c.status = 'success'
    )),
    'training_prereg', count(*) filter (where r.entry_source = 'pre_registration' and r.form_data->>'interested_in_skills_training' = 'Yes'),
    'training_checkin', count(*) filter (where r.form_data->>'interested_in_skills_training' = 'Yes' and exists (
      select 1 from public.check_ins c where c.registration_id = r.id and c.status = 'success'
    )),
    'walkin_prereg', count(*) filter (where r.entry_source = 'post_event_walk_in'),
    'walkin_checkin', count(*) filter (where r.entry_source = 'post_event_walk_in' and exists (
      select 1 from public.check_ins c where c.registration_id = r.id and c.status = 'success'
    )),
    'youth_prereg', count(*) filter (where r.entry_source = 'pre_registration'
      and r.form_data->>'date_of_birth' is not null
      and r.form_data->>'date_of_birth' != ''
      and (date_part('year', age(r.form_data->>'date_of_birth'::date))) <= 24),
    'youth_checkin', count(*) filter (
      and r.form_data->>'date_of_birth' is not null
      and r.form_data->>'date_of_birth' != ''
      and (date_part('year', age(r.form_data->>'date_of_birth'::date))) <= 24
      and exists (
      select 1 from public.check_ins c where c.registration_id = r.id and c.status = 'success'
    ))
  ) into v_result
  from public.registrations r
  where r.event_id = p_event_id;

  return jsonb_build_object('status', 'ok', 'data', v_result);
end;
$$;

revoke execute on function public.admin_event_category_breakdown(uuid) from public, anon;
grant execute on function public.admin_event_category_breakdown(uuid) to authenticated;