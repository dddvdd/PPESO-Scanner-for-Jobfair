alter table public.events add column is_online boolean not null default false;

create policy online_positions_read_published_event on public.form_fields
as restrictive for select to anon, authenticated
using (
  field_key <> 'position_applying_for'
  or (select public.is_admin())
  or exists (
    select 1
    from public.forms f
    join public.events e on e.id = f.event_id
    where f.id = form_id and e.status = 'published'
  )
);

-- Save the online event and its public registration choices in one transaction.
-- The caller reuses the same event ID when retrying a new event.
create function public.admin_save_online_event(
  p_event_id uuid,
  p_create boolean,
  p_name text,
  p_description text,
  p_event_date date,
  p_municipality text,
  p_positions text[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_positions text[];
  v_form_id uuid;
begin
  if public.is_admin() is not true then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(array_agg(title order by first_ordinal), array[]::text[])
    into v_positions
  from (
    select btrim(position_title) as title, min(ordinal) as first_ordinal
    from unnest(p_positions) with ordinality as positions(position_title, ordinal)
    where btrim(position_title) <> ''
    group by btrim(position_title)
  ) as unique_positions;

  if cardinality(v_positions) not between 1 and 500 or exists (
    select 1 from unnest(v_positions) as positions(title)
    where char_length(title) > 500 or title ~ '[[:cntrl:]]'
  ) then
    raise exception 'INVALID_ONLINE_POSITIONS';
  end if;

  if p_create then
    insert into public.events (id, name, status, is_online)
    values (p_event_id, p_name, 'published', true)
    on conflict (id) do nothing;
  end if;

  update public.events
    set name = p_name,
        description = p_description,
        event_date = p_event_date,
        municipality = p_municipality
    where id = p_event_id and is_online;

  if not found then
    raise exception 'ONLINE_EVENT_NOT_FOUND';
  end if;

  select id into v_form_id
  from public.forms
  where event_id = p_event_id and status = 'published'
  order by published_at desc nulls last, id
  limit 1;

  if v_form_id is null then
    insert into public.forms (event_id, name, status, published_at)
    values (p_event_id, p_name || ' — Registration', 'published', now())
    returning id into v_form_id;
  end if;

  insert into public.form_fields (form_id, field_key, label, field_type, required, options, sort_order)
  values (v_form_id, 'position_applying_for', 'Position applying for', 'dropdown', true, to_jsonb(v_positions), -1)
  on conflict (form_id, field_key) do update
    set label = excluded.label,
        field_type = excluded.field_type,
        required = excluded.required,
        options = excluded.options,
        sort_order = excluded.sort_order;
end;
$$;

revoke all on function public.admin_save_online_event(uuid, boolean, text, text, date, text, text[]) from public, anon;
grant execute on function public.admin_save_online_event(uuid, boolean, text, text, date, text, text[]) to authenticated;

notify pgrst, 'reload schema';
