create table public.interview_statuses (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete restrict,
  staff_id uuid not null references auth.users(id) on delete restrict,
  company text not null check (length(btrim(company)) between 1 and 500),
  position text not null check (length(btrim(position)) between 1 and 500),
  status text not null check (status in ('Not Qualified', 'Qualified', 'Near Hires', 'HOTS')),
  updated_at timestamptz not null default now()
);
create unique index interview_statuses_owner_company_position on public.interview_statuses
  (registration_id, staff_id, lower(company), lower(position));
create index interview_statuses_staff_idx on public.interview_statuses(staff_id);
alter table public.interview_statuses enable row level security;
revoke all on public.interview_statuses from anon, authenticated;
grant select on public.interview_statuses to authenticated;
create policy interview_statuses_read_own on public.interview_statuses for select to authenticated
  using (staff_id = (select auth.uid()) and (select public.is_staff()));

-- Deliberately bounded RPCs follow the existing scanner boundary: staff never
-- receive direct access to registrations, check-ins, or other staff records.
create function public.staff_interview_applicants(p_query text default '', p_page integer default 0)
returns table (registration_id uuid, registration_number text, applicant_name text,
  event_name text, checked_in_at timestamptz, interviews jsonb)
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
    e.name, c.scanned_at,
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

create function public.staff_save_interview_status(p_registration_id uuid, p_company text, p_position text, p_status text)
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
  if not exists (select 1 from public.check_ins where registration_id = p_registration_id and status = 'success') then
    raise exception 'Applicant has not checked in' using errcode = '22023';
  end if;
  insert into public.interview_statuses(registration_id, staff_id, company, position, status)
    values (p_registration_id, auth.uid(), btrim(p_company), btrim(p_position), p_status)
    on conflict (registration_id, staff_id, lower(company), lower(position))
    do update set status = excluded.status, updated_at = now()
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.staff_interview_applicants(text, integer) from public, anon;
revoke all on function public.staff_save_interview_status(uuid, text, text, text) from public, anon;
grant execute on function public.staff_interview_applicants(text, integer) to authenticated;
grant execute on function public.staff_save_interview_status(uuid, text, text, text) to authenticated;
