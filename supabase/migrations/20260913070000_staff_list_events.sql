create or replace function public.staff_list_events()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_staff() then
    return jsonb_build_object('status', 'forbidden', 'events', '[]'::jsonb);
  end if;
  return jsonb_build_object('status', 'ok', 'events', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'event_date', event_date, 'location', location)
      order by event_date desc, name)
    from public.events
    where status in ('published', 'closed')
  ), '[]'::jsonb));
end;
$$;

revoke execute on function public.staff_list_events() from public, anon;
grant execute on function public.staff_list_events() to authenticated;
