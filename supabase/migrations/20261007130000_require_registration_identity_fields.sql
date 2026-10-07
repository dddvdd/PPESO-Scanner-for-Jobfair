-- Keep the requested registration answers mandatory in every published
-- form, including forms published after the standard-field seed migration.

create or replace function public.require_registration_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'published' then
    update public.form_fields
    set required = true
    where form_id = new.id
      and field_key in ('date_of_birth', 'pwd');
  end if;

  return new;
end;
$$;

revoke all on function public.require_registration_identity_fields() from public, anon, authenticated;

create trigger zz_require_registration_identity_fields
after insert or update of status on public.forms
for each row
execute function public.require_registration_identity_fields();

update public.form_fields ff
set required = true
from public.forms f
where ff.form_id = f.id
  and ff.field_key in ('date_of_birth', 'pwd');
