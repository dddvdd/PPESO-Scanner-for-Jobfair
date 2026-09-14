-- Keep interview_statuses intact as the legacy record; shared results are event-specific.
create table public.interview_results (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.events(id) on delete restrict,
 registration_id uuid not null references public.registrations(id) on delete restrict,
 staff_id uuid not null references auth.users(id) on delete restrict,
 company text not null check (length(btrim(company)) between 1 and 500),
 position text not null check (length(btrim(position)) between 1 and 500),
 status text not null check (status in ('Not Qualified','Qualified','Near Hires','HOTS')),
 updated_at timestamptz not null default now()
);
create unique index interview_results_event_company_position on public.interview_results
 (event_id, registration_id, lower(company), lower(position));
alter table public.interview_results enable row level security;
revoke all on public.interview_results from public, anon, authenticated;
-- Fail closed if historical event attribution is ambiguous instead of guessing.
do $$ begin
 if exists (select 1 from public.check_ins c join public.interview_statuses i on i.registration_id=c.registration_id
 where c.status='success' group by c.registration_id having count(distinct c.event_id)>1) then
 raise exception 'Historical interviews require event attribution before migration';
 end if;
end $$;
insert into public.interview_results(event_id,registration_id,staff_id,company,position,status,updated_at)
select distinct on (c.event_id,i.registration_id,lower(btrim(i.company)),lower(btrim(i.position)))
 c.event_id,i.registration_id,i.staff_id,btrim(i.company),btrim(i.position),i.status,i.updated_at
from public.interview_statuses i join public.check_ins c on c.registration_id=i.registration_id and c.status='success'
order by c.event_id,i.registration_id,lower(btrim(i.company)),lower(btrim(i.position)),i.updated_at desc,i.id desc;
drop function public.staff_interview_applicants(text, integer);
create or replace function public.staff_interview_applicants(p_query text default '', p_page integer default 0, p_event_id uuid default null)
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
    c.event_id, e.name, c.scanned_at,
    coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'company', i.company,
      'position', i.position, 'status', i.status) order by i.updated_at desc, i.id)
      from public.interview_results i where i.registration_id = r.id and i.event_id = c.event_id), '[]'::jsonb)
  from public.registrations r
  join public.check_ins c on c.registration_id = r.id and c.status = 'success'
  join public.events e on e.id = c.event_id
  where (p_event_id is null or c.event_id = p_event_id) and strpos(lower(concat_ws(' ', r.first_name, r.middle_name, r.last_name, r.suffix)), lower(btrim(coalesce(p_query, '')))) > 0
  order by c.scanned_at desc, r.id, c.event_id
  limit 26 offset p_page * 25;
end;
$$;

revoke all on function public.staff_interview_applicants(text, integer, uuid) from public, anon;
grant execute on function public.staff_interview_applicants(text, integer, uuid) to authenticated;
create or replace function public.staff_save_interview_status(p_registration_id uuid, p_company text, p_position text, p_status text, p_event_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_company is null or length(btrim(p_company)) not between 1 and 500
    or p_position is null or length(btrim(p_position)) not between 1 and 500
    or p_status is null or p_status not in ('Not Qualified', 'Qualified', 'Near Hires', 'HOTS') then
    raise exception 'Invalid interview fields' using errcode = '22023';
  end if;
  if not exists (select 1 from public.check_ins where registration_id = p_registration_id and event_id = p_event_id and status = 'success') then
    raise exception 'Applicant has not checked in' using errcode = '22023';
  end if;
  insert into public.interview_results(event_id, registration_id, staff_id, company, position, status)
    values (p_event_id, p_registration_id, auth.uid(), btrim(p_company), btrim(p_position), p_status)
    on conflict (event_id, registration_id, lower(company), lower(position))
    do update set status = excluded.status, staff_id = excluded.staff_id, updated_at = now()
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.staff_save_interview_status(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.staff_save_interview_status(uuid,text,text,text,uuid) to authenticated;
-- Older clients may save only when the event is unambiguous.
create or replace function public.staff_save_interview_status(p_registration_id uuid,p_company text,p_position text,p_status text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
 if auth.uid() is null or not public.is_staff() then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
 if (select count(*) from public.check_ins where registration_id=p_registration_id and status='success') <> 1 then
 raise exception 'Choose an event using the updated interview page' using errcode='22023'; end if;
 select event_id into v_event from public.check_ins where registration_id=p_registration_id and status='success';
 return public.staff_save_interview_status(p_registration_id,p_company,p_position,p_status,v_event);
end $$;
drop function if exists public.admin_event_interview_summary(uuid);
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
    'total_male', count(*) filter (where lower(r.form_data->>'sex') = 'male'),
    'hots_total', count(*) filter (where i.status = 'HOTS'),
    'near_hire_total', count(*) filter (where i.status = 'Near Hires'),
    'qualified_total', count(*) filter (where i.status = 'Qualified'),
    'not_qualified_total', count(*) filter (where i.status = 'Not Qualified')
  ) into v_result
  from public.interview_results i
  join public.check_ins c on c.registration_id = i.registration_id and c.event_id = i.event_id and c.status = 'success'
  join public.registrations r on r.id = i.registration_id
  where c.event_id = p_event_id;

  return jsonb_build_object('status', 'ok', 'data', v_result);
end;
$$;

revoke execute on function public.admin_event_interview_summary(uuid) from public, anon;
grant execute on function public.admin_event_interview_summary(uuid) to authenticated;

create function public.staff_export_interview_results(p_event_id uuid, p_after uuid default null)
returns table(id uuid, registration_number text, applicant_name text, company text, "position" text, status text, updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_staff() then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
 if p_event_id is null then raise exception 'Choose an event' using errcode='22023'; end if;
 return query select i.id,r.registration_number,concat_ws(' ',r.first_name,nullif(r.middle_name,''),r.last_name,nullif(r.suffix,'')),i.company,i.position,i.status,i.updated_at
 from public.interview_results i join public.registrations r on r.id=i.registration_id
 where i.event_id=p_event_id and (p_after is null or i.id>p_after)
 order by i.id limit 500;
end $$;
revoke all on function public.staff_export_interview_results(uuid,uuid) from public,anon;
grant execute on function public.staff_export_interview_results(uuid,uuid) to authenticated;

