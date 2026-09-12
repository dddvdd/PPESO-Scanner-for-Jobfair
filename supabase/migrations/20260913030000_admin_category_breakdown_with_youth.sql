drop function if exists public.admin_event_category_breakdown(uuid);

create or replace function public.parse_date_safe(p_text text)
returns date language plpgsql immutable as $$
declare
  v_clean text;
  v_date date;
begin
  if p_text is null then return null; end if;
  v_clean := trim(p_text);
  if v_clean = '' then return null; end if;
  v_clean := replace(v_clean, '.', '-');
  v_clean := replace(v_clean, '/', '-');
  v_clean := replace(v_clean, ' ', '');
  if v_clean ~ '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$' then
    begin
      v_date := v_clean::date;
      return v_date;
    exception when others then null;
    end;
  end if;
  if v_clean ~ '^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}$' then
    begin
      v_date := to_date(v_clean, 'MM-DD-YYYY');
      if v_date > now()::date then
        v_date := to_date(v_clean, 'DD-MM-YYYY');
      end if;
      return v_date;
    exception when others then null;
    end;
  end if;
  if v_clean ~ '^[0-9]{1,2}-[0-9]{1,2}-[0-9]{2}$' then
    begin
      v_date := to_date(v_clean, 'MM-DD-YY');
      if v_date > now()::date then
        v_date := to_date(v_clean, 'DD-MM-YY');
      end if;
      return v_date;
    exception when others then null;
    end;
  end if;
  begin
    v_date := v_clean::date;
    return v_date;
  exception when others then null;
  end;
  return null;
end;
$$;

create or replace function public.admin_event_category_breakdown(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  with base as (
    select r.*,
      public.parse_date_safe(r.form_data->>'date_of_birth') as dob_parsed
    from public.registrations r
    where r.event_id = p_event_id
  ), tagged as (
    select b.*,
      case when b.dob_parsed is not null
        then extract(year from age(b.dob_parsed)) <= 24
        else false
      end as is_youth
    from base b
  )
  select jsonb_build_object(
    'total_prereg', count(*) filter (where t.entry_source = 'pre_registration'),
    'total_checkin', count(*) filter (where exists (select 1 from public.check_ins c where c.registration_id = t.id and c.status = 'success')),
    'pwd_prereg', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'pwd' = 'Yes'),
    'pwd_checkin', count(*) filter (where t.form_data->>'pwd' = 'Yes' and exists (select 1 from public.check_ins c where c.registration_id = t.id and c.status = 'success')),
    'first_time_prereg', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'first_time_job_seeker') = 'yes'),
    'first_time_checkin', count(*) filter (where lower(t.form_data->>'first_time_job_seeker') = 'yes' and exists (select 1 from public.check_ins c where c.registration_id = t.id and c.status = 'success')),
    'ofw_prereg', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'returning_ofw') = 'yes'),
    'ofw_checkin', count(*) filter (where lower(t.form_data->>'returning_ofw') = 'yes' and exists (select 1 from public.check_ins c where c.registration_id = t.id and c.status = 'success')),
    'worker_prereg', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'returning_worker') = 'yes'),
    'worker_checkin', count(*) filter (where lower(t.form_data->>'returning_worker') = 'yes' and exists (select 1 from public.check_ins c where c.registration_id = t.id and c.status = 'success')),
    'training_prereg', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'interested_in_skills_training' = 'Yes'),
    'training_checkin', count(*) filter (where t.form_data->>'interested_in_skills_training' = 'Yes' and exists (select 1 from public.check_ins c where c.registration_id = t.id and c.status = 'success')),
    'walkin_prereg', count(*) filter (where t.entry_source = 'post_event_walk_in'),
    'walkin_checkin', count(*) filter (where t.entry_source = 'post_event_walk_in' and exists (select 1 from public.check_ins c where c.registration_id = t.id and c.status = 'success')),
    'youth_prereg', count(*) filter (where t.entry_source = 'pre_registration' and t.is_youth),
    'youth_checkin', count(*) filter (where t.is_youth and exists (select 1 from public.check_ins c where c.registration_id = t.id and c.status = 'success'))
  ) into v_result
  from tagged t;
  return jsonb_build_object('status', 'ok', 'data', v_result);
end;
$$;

revoke execute on function public.admin_event_category_breakdown(uuid) from public, anon;
grant execute on function public.admin_event_category_breakdown(uuid) to authenticated;
grant execute on function public.parse_date_safe(text) to authenticated;
