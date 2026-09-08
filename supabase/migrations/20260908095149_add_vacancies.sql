create table public.vacancies (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  company_name text not null check (length(btrim(company_name)) between 1 and 500),
  vacancy_title text not null check (length(btrim(vacancy_title)) between 1 and 500),
  number_of_vacancies integer not null check (number_of_vacancies > 0),
  created_at timestamptz not null default now()
);

alter table public.vacancies enable row level security;
revoke all on public.vacancies from anon, authenticated;
grant select, insert on public.vacancies to authenticated;

create policy vacancies_read_admin on public.vacancies
  for select to authenticated using ((select public.is_admin()));
create policy vacancies_insert_admin on public.vacancies
  for insert to authenticated with check ((select public.is_admin()));

create index vacancies_event_created_at_id_idx on public.vacancies (event_id, created_at desc, id);
