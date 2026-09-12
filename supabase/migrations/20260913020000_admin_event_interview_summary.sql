create or replace function public.admin_event_interview_summary(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select jsonb_build_object(
    'hots_female', count(*) filter (where lower(r.form_data->>'sex') = 'female' and i.status = 'HOTS'),
    'hots_male', count(*) filter (where lower(r.form_data->>'sex') = 'male' and i.status = 'HOTS'),
    'near_hire_female', count(*) filter (where lower(r.form_data->>'sex') = 'female' and i.status = 'Near Hires'),
    'near_hire_male', count(*) filter (where lower(r.form_data->>'sex') = 'male' and i.status = 'Near Hires'),
    'qualified_female', count(*) filter (where lower(r.form_data->>'sex') = 'female' and i.status = 'Qualified'),
    'qualified_male', count(*) filter (where lower(r.form_data->>'sex') = 'male' and i.status = 'Qualified'),
    'not_qualified_female', count(*) filter (where lower(r.form_data->>'sex') = 'female' and i.status = 'Not Qualified'),
    'not_qualified_male', count(*) filter (where lower(r.form_data->>'sex') = 'male' and i.status = 'Not Qualified'),
    'total_female', count(*) filter (where lower(r.form_data->>'sex') = 'female'),
    'total_male', count(*) filter (where lower(r.form_data->>'sex') = 'male')
  ) into v_result
  from public.interview_statuses i
  join public.registrations r on r.id = i.registration_id
  where r.event_id = p_event_id;

  return jsonb_build_object('status', 'ok', 'data', v_result);
end;
$$;

revoke execute on function public.admin_event_interview_summary(uuid) from public, anon;
grant execute on function public.admin_event_interview_summary(uuid) to authenticated;
