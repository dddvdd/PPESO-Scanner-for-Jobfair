drop function if exists public.staff_interview_applicants(text, integer);

create or replace function public.staff_interview_applicants(p_query text default '', p_page integer default 0)
returns table (registration_id uuid, registration_number text, applicant_name text,
  event_id uuid, event_name text, checked_in_at timestamptz, interviews jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_page is null or p_page < 0 or p_page > 1000000 or length(coalesce(p_query, '')) > 200 then
    raise exception 'Invalid search or page' using errcode = '22023';
  end if;
  return query
  select r.id, r.registration_number,
    concat_ws(' ', r.first_name, nullif(r.middle_name, ''), r.last_name, nullif(r.suffix, '')),
    e.id, e.name, c.scanned_at,
    coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'company', i.company,
      'position', i.position, 'status', i.status) order by i.updated_at desc, i.id)
      from public.interview_statuses i where i.registration_id = r.id and i.staff_id = auth.uid()), '[]'::jsonb)
  from public.registrations r
  join public.check_ins c on c.registration_id = r.id and c.status = 'success'
  join public.events e on e.id = r.event_id
  where strpos(lower(concat_ws(' ', r.first_name, r.middle_name, r.last_name, r.suffix)), lower(btrim(coalesce(p_query, '')))) > 0
  order by c.scanned_at desc, r.id
  limit 26 offset p_page * 25;
end;
$$;
revoke all on function public.staff_interview_applicants(text, integer) from public, anon;
grant execute on function public.staff_interview_applicants(text, integer) to authenticated;

create or replace function public.staff_event_vacancies(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or not public.is_staff() then
    return jsonb_build_object('status', 'forbidden', 'vacancies', '[]'::jsonb);
  end if;
  if not exists(select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('status', 'event_not_found', 'vacancies', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(to_jsonb(v) order by v.company_name, v.vacancy_title), '[]'::jsonb)
  into v_rows
  from public.vacancies v
  where v.event_id = p_event_id;
  return jsonb_build_object('status', 'ok', 'vacancies', v_rows);
end;
$$;

revoke execute on function public.staff_event_vacancies(uuid) from public, anon;
grant execute on function public.staff_event_vacancies(uuid) to authenticated;