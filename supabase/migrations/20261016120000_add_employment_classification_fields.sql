-- "Which best describes you?" also offers employment status next to the three
-- legacy classifications. Each choice is a yes_no form field: the card picker
-- in ClassificationCardGroup stores "yes" on the selected key and flips its
-- group siblings to "no", so register_applicant's required-field and yes_no
-- validation keep passing unchanged.

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
    ('currently_employed', 'EMPLOYED / CURRENTLY EMPLOYED', 'yes_no', true, '[]'::jsonb, 7),
    ('unemployed_seeking_employment', 'UNEMPLOYED but seeking employment', 'yes_no', true, '[]'::jsonb, 8),
    ('interested_in_skills_training', 'INTERESTED IN SKILLS TRAINING', 'radio', false, '["Yes", "No"]'::jsonb, 9),
    ('province', 'Province', 'short_text', true, '[]'::jsonb, 10),
    ('municipality_city', 'Municipality/City', 'short_text', true, '[]'::jsonb, 11),
    ('barangay', 'Barangay', 'short_text', true, '[]'::jsonb, 12)
  ) as v(field_key, label, field_type, required, options, sort_order)
  on conflict (form_id, field_key) do nothing;

  return new;
end;
$$;

revoke all on function public.seed_standard_form_fields_on_create() from public, anon, authenticated;

-- Shift everything currently at sort_order 7 or later so the two new cards sit
-- directly after RETURNING WORKER on forms already in the field builder. The
-- relative order of existing fields is preserved.
update public.form_fields
   set sort_order = sort_order + 2
 where sort_order >= 7;

-- Bring forms published before this migration in line with the seed function.
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
  ('currently_employed', 'EMPLOYED / CURRENTLY EMPLOYED', 'yes_no', true, '[]'::jsonb, 7),
  ('unemployed_seeking_employment', 'UNEMPLOYED but seeking employment', 'yes_no', true, '[]'::jsonb, 8)
) as v(field_key, label, field_type, required, options, sort_order)
where f.status = 'published'
on conflict (form_id, field_key) do nothing;
