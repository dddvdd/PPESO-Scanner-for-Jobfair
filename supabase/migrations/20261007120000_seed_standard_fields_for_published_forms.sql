-- Standard reporting questions were seeded only for forms published when the
-- original seed migration ran. Forms created afterward could collect
-- registrations without the fields used by admin_event_category_breakdown.

create or replace function public.seed_standard_form_fields_on_create()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'published' then
    return new;
  end if;

  insert into public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
  select new.id, v.field_key, v.label, v.field_type::public.field_type, v.required, v.options, v.sort_order
  from (values
    ('date_of_birth', 'Date of Birth', 'date', false, '[]'::jsonb, 0),
    ('course', 'Highest Educational Attainment', 'short_text', true, '[]'::jsonb, 1),
    ('pwd', 'PWD', 'radio', false, '["Yes", "No"]'::jsonb, 2),
    ('sex', 'Sex', 'radio', true, '["Male", "Female"]'::jsonb, 3),
    ('first_time_job_seeker', 'FIRST TIME JOB SEEKER', 'yes_no', true, '[]'::jsonb, 4),
    ('returning_ofw', 'RETURNING OFW', 'yes_no', true, '[]'::jsonb, 5),
    ('returning_worker', 'RETURNING WORKER', 'yes_no', true, '[]'::jsonb, 6),
    ('interested_in_skills_training', 'INTERESTED IN SKILLS TRAINING', 'radio', false, '["Yes", "No"]'::jsonb, 7),
    ('province', 'Province', 'short_text', true, '[]'::jsonb, 8),
    ('municipality_city', 'Municipality/City', 'short_text', true, '[]'::jsonb, 9),
    ('barangay', 'Barangay', 'short_text', true, '[]'::jsonb, 10)
  ) as v(field_key, label, field_type, required, options, sort_order)
  on conflict (form_id, field_key) do nothing;

  return new;
end;
$$;

revoke all on function public.seed_standard_form_fields_on_create() from public, anon, authenticated;

create trigger seed_standard_form_fields_after_publish
after insert or update of status on public.forms
for each row
execute function public.seed_standard_form_fields_on_create();

-- Bring published forms created since the original seed migration up to the
-- same reporting schema. The unique (form_id, field_key) constraint keeps
-- this safe for forms that already have some or all standard fields.
insert into public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
select
  f.id,
  v.field_key,
  v.label,
  v.field_type::public.field_type,
  v.required,
  v.options,
  v.sort_order
from public.forms f
cross join (values
  ('date_of_birth', 'Date of Birth', 'date', false, '[]'::jsonb, 0),
  ('course', 'Highest Educational Attainment', 'short_text', true, '[]'::jsonb, 1),
  ('pwd', 'PWD', 'radio', false, '["Yes", "No"]'::jsonb, 2),
  ('sex', 'Sex', 'radio', true, '["Male", "Female"]'::jsonb, 3),
  ('first_time_job_seeker', 'FIRST TIME JOB SEEKER', 'yes_no', true, '[]'::jsonb, 4),
  ('returning_ofw', 'RETURNING OFW', 'yes_no', true, '[]'::jsonb, 5),
  ('returning_worker', 'RETURNING WORKER', 'yes_no', true, '[]'::jsonb, 6),
  ('interested_in_skills_training', 'INTERESTED IN SKILLS TRAINING', 'radio', false, '["Yes", "No"]'::jsonb, 7),
  ('province', 'Province', 'short_text', true, '[]'::jsonb, 8),
  ('municipality_city', 'Municipality/City', 'short_text', true, '[]'::jsonb, 9),
  ('barangay', 'Barangay', 'short_text', true, '[]'::jsonb, 10)
) as v(field_key, label, field_type, required, options, sort_order)
where f.status = 'published'
on conflict (form_id, field_key) do nothing;
