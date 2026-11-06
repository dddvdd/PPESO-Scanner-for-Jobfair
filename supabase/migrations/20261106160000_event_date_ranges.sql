alter table public.events add column event_end_date date;
alter table public.events add constraint events_date_range_valid check (
  event_end_date is null or (event_date is not null and event_end_date >= event_date)
);

create function public.admin_save_online_event_range(
  p_event_id uuid, p_create boolean, p_name text, p_description text,
  p_event_date date, p_event_end_date date, p_municipality text, p_positions text[]
)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if public.is_admin() is not true then
    raise exception 'FORBIDDEN';
  end if;
  if p_event_end_date is not null and (p_event_date is null or p_event_end_date < p_event_date) then
    raise exception 'INVALID_EVENT_DATE_RANGE';
  end if;
  -- Lock the event and clear its old end before moving the start forward.
  -- Both dates and the registration choices commit together.
  update public.events set event_end_date = null where id = p_event_id and is_online;
  perform public.admin_save_online_event(
    p_event_id, p_create, p_name, p_description, p_event_date, p_municipality, p_positions
  );
  update public.events set event_end_date = p_event_end_date where id = p_event_id;
end;
$$;

revoke all on function public.admin_save_online_event_range(uuid, boolean, text, text, date, date, text, text[]) from public, anon;
grant execute on function public.admin_save_online_event_range(uuid, boolean, text, text, date, date, text, text[]) to authenticated;


-- Retain existing authorization and ticket rules while using the final event day.
create or replace function public.perform_check_in(
  p_ticket_token text,
  p_device_identifier text default null,
  p_event_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_reg record;
  v_profile public.registrations%rowtype;
  v_missing text[];
  v_ci_id uuid;
  v_scanned_at timestamptz;
begin
  if p_event_id is not null and not public.staff_can_access_event(p_event_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if auth.uid() is null or not public.is_staff() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select r.id, r.registration_number, r.ticket_token, r.first_name, r.last_name,
         r.status, e.id as event_id, e.name as event_name, coalesce(e.event_end_date, e.event_date) as event_date
    into v_reg
    from public.registrations r
    join public.events e on e.id = r.event_id
   where r.ticket_token = btrim(coalesce(p_ticket_token, ''))
     and public.staff_can_access_event(r.event_id);

  if v_reg.id is null then
    return jsonb_build_object('status', 'registration_not_found');
  end if;

  if public.scanner_profile_checkpoint_applies(v_reg.registration_number) then
    -- Lock targeted profiles through the attendance insert to avoid a save race.
    select * into v_profile from public.registrations where id = v_reg.id for update;
    v_missing := public.scanner_missing_fields(v_profile.form_data);
    if v_profile.status = 'registered' and cardinality(v_missing) > 0
       and not exists (select 1 from public.check_ins where registration_id = v_profile.id and status = 'success') then
      return jsonb_build_object('status', 'missing_profile', 'missing_fields', v_missing,
        'registration_number', v_profile.registration_number,
        'applicant_name', concat_ws(' ', v_profile.first_name, v_profile.last_name));
    end if;
  end if;

  if v_reg.status <> 'registered' then
    return jsonb_build_object('status', 'invalid_ticket',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name));
  end if;

  if v_reg.event_date is not null and v_reg.event_date < (now() at time zone 'Asia/Manila')::date then
    return jsonb_build_object('status', 'event_past',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
      'event_name', v_reg.event_name,
      'event_date', v_reg.event_date);
  end if;

  begin
    insert into public.check_ins (registration_id, scanned_by, device_identifier, status, event_id)
    values (v_reg.id, auth.uid(), nullif(btrim(coalesce(p_device_identifier, '')), ''), 'success',
            coalesce(p_event_id, v_reg.event_id))
    on conflict (registration_id) where status = 'success'
    do nothing
    returning id, scanned_at into v_ci_id, v_scanned_at;

    if v_ci_id is not null then
      return jsonb_build_object('status', 'success',
        'registration_number', v_reg.registration_number,
        'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
        'checked_in_at', v_scanned_at);
    end if;

    select c.scanned_at into v_scanned_at
      from public.check_ins c
     where c.registration_id = v_reg.id and c.status = 'success'
       and public.staff_can_access_event(c.event_id);

    return jsonb_build_object('status', 'already_checked_in',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
      'checked_in_at', v_scanned_at);
  exception
    when others then
      return jsonb_build_object('status', 'error',
        'message', 'CHECK-IN COULD NOT BE COMPLETED');
  end;
end;
$$;

create or replace function public.staff_walk_in_events()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Manila')::date;
begin
 if auth.uid() is null or not public.is_staff() then
   return jsonb_build_object('status','forbidden','events','[]'::jsonb);
 end if;
 return jsonb_build_object('status','ok','events',coalesce((
   select jsonb_agg(jsonb_build_object('id',id,'name',name,'event_date',event_date,'event_end_date',event_end_date,'location',location)
     order by event_date desc, name)
   from public.events where public.staff_can_access_event(id) and event_date <= v_today and coalesce(event_end_date, event_date) >= v_today-5
     and status in ('published','closed','archived')
 ),'[]'::jsonb));
end;
$$;

create or replace function public.staff_list_events()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_staff() then
    return jsonb_build_object('status', 'forbidden', 'events', '[]'::jsonb);
  end if;
  return jsonb_build_object('status', 'ok', 'events', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'event_date', event_date, 'event_end_date', event_end_date, 'location', location)
      order by event_date desc, name)
    from public.events
    where public.staff_can_access_event(id) and status in ('published', 'closed')
  ), '[]'::jsonb));
end;
$$;

create or replace function public.staff_walk_in_form(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_form public.forms%rowtype; v_fields jsonb; v_day date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.staff_can_access_event(p_event_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
 if auth.uid() is null or not public.is_staff() then return jsonb_build_object('status','forbidden'); end if;
 if not exists(select 1 from public.events where id=p_event_id and event_date <= v_day and coalesce(event_end_date, event_date) >= v_day-5 and status in ('published','closed','archived')) then
   return jsonb_build_object('status','event_not_eligible');
 end if;
 select * into v_form from public.forms where event_id=p_event_id and status='published'
 order by published_at desc nulls last, created_at desc, id limit 1;
 if not found then return jsonb_build_object('status','form_not_found'); end if;
 select coalesce(jsonb_agg(to_jsonb(ff) order by sort_order,id),'[]'::jsonb) into v_fields
 from public.form_fields ff where ff.form_id=v_form.id and not (lower(ff.field_key || ' ' || ff.label) like '%privacy%' and lower(ff.field_key || ' ' || ff.label) like '%consent%');
 return jsonb_build_object('status','ok','form',to_jsonb(v_form),'fields',v_fields);
end;
$$;

create or replace function public.staff_record_walk_in(
 p_event_id uuid, p_first_name text, p_last_name text, p_email text,
 p_mobile_number text, p_middle_name text default null, p_suffix text default null,
 p_form_id uuid default null, p_form_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
 v_today date := (now() at time zone 'Asia/Manila')::date;
 v_event public.events%rowtype; v_form uuid; v_reg uuid; v_number text;
 v_recorded_at timestamptz;
 v_clean jsonb := '{}'::jsonb; v_field record; v_value jsonb; v_text text;
 v_first text := coalesce(nullif(btrim(p_first_name),''), '');
 v_last text := coalesce(nullif(btrim(p_last_name),''), '');
 v_email text := nullif(btrim(p_email),'');
 v_mobile text := nullif(btrim(p_mobile_number),'');
 v_eff_email text;
begin
  if not public.staff_can_access_event(p_event_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
 if auth.uid() is null or not public.is_staff() then return jsonb_build_object('status','forbidden'); end if;
 select * into v_event from public.events where id=p_event_id for update;
 if not found or v_event.event_date is null or coalesce(v_event.event_end_date, v_event.event_date) < v_today-5
   or v_event.event_date > v_today or v_event.status not in ('published','closed','archived') then
   return jsonb_build_object('status','event_not_eligible');
 end if;
 if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
   return jsonb_build_object('status','invalid_email');
 end if;
 if v_email is not null and exists(select 1 from public.registrations where event_id=p_event_id and lower(email)=lower(v_email)) then
   return jsonb_build_object('status','duplicate_registration');
 end if;
 if p_form_id is not null and exists(select 1 from public.forms where id=p_form_id and event_id=p_event_id and status='published') then
   v_form := p_form_id;
   if jsonb_typeof(p_form_data) = 'object' then
     for v_field in select * from public.form_fields ff where form_id=v_form and not (lower(ff.field_key || ' ' || ff.label) like '%privacy%' and lower(ff.field_key || ' ' || ff.label) like '%consent%') order by sort_order loop
       v_value := p_form_data->v_field.field_key;
       v_text := p_form_data->>v_field.field_key;
       if v_value is null or v_value='null'::jsonb or v_value='""'::jsonb or v_value='[]'::jsonb then
         continue;
       end if;
       if v_field.field_type in ('checkbox','multi_select') then
         if jsonb_typeof(v_value)<>'array' then continue; end if;
         if exists(select 1 from jsonb_array_elements(v_value) el where jsonb_typeof(el)<>'string' or not (v_field.options @> jsonb_build_array(el))) then
           continue;
         end if;
       else
         if jsonb_typeof(v_value)<>'string' or btrim(v_text)='' then
           continue;
         end if;
         if v_field.field_type='number' and v_text !~ '^-?[0-9]+([.][0-9]+)?$' then continue; end if;
         if v_field.field_type='date' then
           begin
             if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise invalid_datetime_format; end if;
             perform v_text::date;
           exception when invalid_datetime_format or datetime_field_overflow then
             continue;
           end;
         end if;
         if (v_field.field_type in ('dropdown','radio') and not (v_field.options @> jsonb_build_array(v_text)))
           or (v_field.field_type='yes_no' and lower(v_text) not in ('yes','no')) then
           continue;
         end if;
       end if;
       v_clean := v_clean || jsonb_build_object(v_field.field_key,v_value);
     end loop;
   end if;
 end if;
 v_number := 'JF'||to_char(now() at time zone 'Asia/Manila','YYYYMMDD')||'-'||lpad(nextval('public.registration_number_seq')::text,6,'0');
 v_eff_email := coalesce(v_email, v_number || '@walkin.local');
 begin
   insert into public.registrations(event_id,form_id,registration_number,ticket_token,
     first_name,middle_name,last_name,suffix,email,mobile_number,entry_source,recorded_by,form_data)
   values(p_event_id,coalesce(v_form,v_event.id),v_number,encode(gen_random_bytes(24),'hex'),
     v_first,nullif(btrim(p_middle_name),''),v_last,nullif(btrim(p_suffix),''),
     v_eff_email,coalesce(v_mobile,''),'post_event_walk_in',auth.uid(),v_clean)
   returning id into v_reg;
 exception when unique_violation then
   return jsonb_build_object('status','duplicate_registration');
 end;
 insert into public.check_ins(registration_id,scanned_by,status,attendance_date,override_reason,event_id)
 values(v_reg,auth.uid(),'success',least(v_today, coalesce(v_event.event_end_date, v_event.event_date)),'Post-event walk-in attendance recorded by staff/admin',p_event_id)
 returning scanned_at into v_recorded_at;
 return jsonb_build_object('status','success','registration_number',v_number,
   'attendance_date',least(v_today, coalesce(v_event.event_end_date, v_event.event_date)),'recorded_at',v_recorded_at);
end;
$$;

create or replace function public.admin_record_late_check_in(
  p_registration_number text, p_reason text, p_device_identifier text default null
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_reg record;
  v_profile public.registrations%rowtype;
  v_missing text[];
  v_ci public.check_ins%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 1000 then
    return jsonb_build_object('status', 'reason_required');
  end if;
  select r.id, r.registration_number, r.first_name, r.last_name, r.status, coalesce(e.event_end_date, e.event_date) as event_date, e.id as event_id
    into v_reg from public.registrations r join public.events e on e.id = r.event_id
    where r.registration_number = btrim(p_registration_number)
    for update of r for share of e;
  if not found then return jsonb_build_object('status', 'registration_not_found'); end if;
  if public.scanner_profile_checkpoint_applies(v_reg.registration_number) then
    select * into v_profile from public.registrations where id = v_reg.id for update;
    v_missing := public.scanner_missing_fields(v_profile.form_data);
    if v_profile.status = 'registered' and cardinality(v_missing) > 0
       and not exists (select 1 from public.check_ins where registration_id = v_profile.id and status = 'success') then
      return jsonb_build_object('status', 'missing_profile', 'missing_fields', v_missing,
        'registration_number', v_profile.registration_number,
        'applicant_name', concat_ws(' ', v_profile.first_name, v_profile.last_name));
    end if;
  end if;

  if v_reg.status <> 'registered' then return jsonb_build_object('status', 'invalid_ticket'); end if;
  if v_reg.event_date is null or v_reg.event_date >= (now() at time zone 'Asia/Manila')::date then
    return jsonb_build_object('status', 'not_past_event');
  end if;

  insert into public.check_ins (
    registration_id, scanned_by, device_identifier, status, attendance_date, override_reason, event_id
  ) values (
    v_reg.id, auth.uid(), nullif(btrim(p_device_identifier), ''), 'success',
    v_reg.event_date, btrim(p_reason), v_reg.event_id
  )
  on conflict (registration_id) where status = 'success' do nothing
  returning * into v_ci;
  if v_ci.id is null then
    select * into v_ci from public.check_ins where registration_id = v_reg.id and status = 'success';
    return jsonb_build_object('status', 'already_checked_in',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
      'checked_in_at', v_ci.scanned_at);
  end if;
  return jsonb_build_object('status', 'success',
    'registration_number', v_reg.registration_number,
    'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
    'checked_in_at', v_ci.scanned_at,
    'attendance_date', v_ci.attendance_date);
end;
$$;

notify pgrst, 'reload schema';
