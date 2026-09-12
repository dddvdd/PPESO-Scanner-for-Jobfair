-- 1. Add event_id column to check_ins
alter table public.check_ins
  add column event_id uuid references public.events(id) on delete set null;

create index check_ins_event_idx on public.check_ins (event_id);

-- 2. Backfill existing check_ins from their registration's event
update public.check_ins c
  set event_id = r.event_id
  from public.registrations r
  where c.registration_id = r.id and c.event_id is null;

-- 3. Update perform_check_in to accept and store event_id
drop function if exists public.perform_check_in(text, text);
create or replace function public.perform_check_in(
  p_ticket_token text,
  p_device_identifier text default null,
  p_event_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_reg record;
  v_ci_id uuid;
  v_scanned_at timestamptz;
begin
  if not public.is_staff() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select r.id, r.registration_number, r.ticket_token, r.first_name, r.last_name,
         r.status, e.id as event_id, e.name as event_name, e.event_date
    into v_reg
    from public.registrations r
    join public.events e on e.id = r.event_id
   where r.ticket_token = btrim(coalesce(p_ticket_token, ''));

  if v_reg.id is null then
    return jsonb_build_object('status', 'registration_not_found');
  end if;

  if v_reg.status <> 'registered' then
    return jsonb_build_object('status', 'invalid_ticket',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name));
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
     where c.registration_id = v_reg.id and c.status = 'success';

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

revoke execute on function public.perform_check_in(text, text, uuid) from public;
revoke execute on function public.perform_check_in(text, text, uuid) from anon;
grant execute on function public.perform_check_in(text, text, uuid) to authenticated;

-- 4. Update admin_record_late_check_in to store event_id
drop function if exists public.admin_record_late_check_in(text, text, text);
create or replace function public.admin_record_late_check_in(
  p_registration_number text, p_reason text, p_device_identifier text default null
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_reg record;
  v_ci public.check_ins%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 1000 then
    return jsonb_build_object('status', 'reason_required');
  end if;
  select r.id, r.registration_number, r.first_name, r.last_name, r.status, e.event_date, e.id as event_id
    into v_reg from public.registrations r join public.events e on e.id = r.event_id
    where r.registration_number = btrim(p_registration_number)
    for share of r, e;
  if not found then return jsonb_build_object('status', 'registration_not_found'); end if;
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

revoke execute on function public.admin_record_late_check_in(text, text, text) from public, anon;
grant execute on function public.admin_record_late_check_in(text, text, text) to authenticated;

-- 5. Update staff_record_walk_in to store event_id
drop function if exists public.staff_record_walk_in(uuid,text,text,text,text,text,text,uuid,jsonb);
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
 if auth.uid() is null or not public.is_staff() then return jsonb_build_object('status','forbidden'); end if;
 select * into v_event from public.events where id=p_event_id for update;
 if not found or v_event.event_date is null or v_event.event_date < v_today-5
   or v_event.event_date >= v_today or v_event.status not in ('published','closed','archived') then
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
 values(v_reg,auth.uid(),'success',v_event.event_date,'Post-event walk-in attendance recorded by staff/admin',p_event_id)
 returning scanned_at into v_recorded_at;
 return jsonb_build_object('status','success','registration_number',v_number,
   'attendance_date',v_event.event_date,'recorded_at',v_recorded_at);
end;
$$;

revoke execute on function public.staff_record_walk_in(uuid,text,text,text,text,text,text,uuid,jsonb) from public,anon;
grant execute on function public.staff_record_walk_in(uuid,text,text,text,text,text,text,uuid,jsonb) to authenticated;

-- 6. Update category breakdown to use check_ins.event_id
drop function if exists public.admin_event_category_breakdown(uuid);
create or replace function public.admin_event_category_breakdown(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  with base as (
    select r.*, public.parse_date_safe(r.form_data->>'date_of_birth') as dob_parsed
    from public.registrations r where r.event_id = p_event_id
  ), tagged as (
    select b.*, case when b.dob_parsed is not null then extract(year from age(b.dob_parsed)) <= 30 else false end as is_youth
    from base b
  )
  select jsonb_build_object(
    'total_prereg', count(*) filter (where t.entry_source = 'pre_registration'),
    'total_checkin', count(*) filter (where exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'pwd_prereg', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'pwd' = 'Yes'),
    'pwd_checkin', count(*) filter (where t.form_data->>'pwd' = 'Yes' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'first_time_prereg', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'first_time_job_seeker') = 'yes'),
    'first_time_checkin', count(*) filter (where lower(t.form_data->>'first_time_job_seeker') = 'yes' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'ofw_prereg', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'returning_ofw') = 'yes'),
    'ofw_checkin', count(*) filter (where lower(t.form_data->>'returning_ofw') = 'yes' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'worker_prereg', count(*) filter (where t.entry_source = 'pre_registration' and lower(t.form_data->>'returning_worker') = 'yes'),
    'worker_checkin', count(*) filter (where lower(t.form_data->>'returning_worker') = 'yes' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'training_prereg', count(*) filter (where t.entry_source = 'pre_registration' and t.form_data->>'interested_in_skills_training' = 'Yes'),
    'training_checkin', count(*) filter (where t.form_data->>'interested_in_skills_training' = 'Yes' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'walkin_prereg', count(*) filter (where t.entry_source = 'post_event_walk_in'),
    'walkin_checkin', count(*) filter (where t.entry_source = 'post_event_walk_in' and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success')),
    'youth_prereg', count(*) filter (where t.entry_source = 'pre_registration' and t.is_youth),
    'youth_checkin', count(*) filter (where t.is_youth and exists (select 1 from public.check_ins c where c.event_id = p_event_id and c.registration_id = t.id and c.status = 'success'))
  ) into v_result from tagged t;
  return jsonb_build_object('status', 'ok', 'data', v_result);
end;
$$;

revoke execute on function public.admin_event_category_breakdown(uuid) from public, anon;
grant execute on function public.admin_event_category_breakdown(uuid) to authenticated;

-- 7. Update staff_lookup to show check-in event_id
drop function if exists public.staff_lookup(text);
create or replace function public.staff_lookup(p_query text default '')
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_q text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null or not public.is_staff() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  return coalesce((
    select jsonb_build_object('status', 'ok', 'results', jsonb_agg(jsonb_build_object(
      'registration_number', r.registration_number,
      'ticket_token', r.ticket_token,
      'applicant_name', concat_ws(' ', r.first_name, nullif(r.middle_name, ''), r.last_name, nullif(r.suffix, '')),
      'event_name', e.name,
      'event_date', e.event_date,
      'form_id', r.form_id,
      'checked_in_at', c.scanned_at,
      'attendance_date', c.attendance_date,
      'is_late_check_in', c.override_reason is not null,
      'entry_source', r.entry_source,
      'check_in_event_id', c.event_id
    ) order by c.scanned_at desc nulls last, r.registered_at desc))
    from public.registrations r
    join public.events e on e.id = r.event_id
    left join public.check_ins c on c.registration_id = r.id and c.status = 'success'
    where v_q = '' or r.ticket_token = v_q
      or r.registration_number = upper(v_q)
      or r.email = lower(v_q)
      or concat_ws(' ', r.first_name, r.last_name) ilike '%' || v_q || '%'
    limit 30
  ), jsonb_build_object('status', 'ok', 'results', '[]'::jsonb));
end;
$$;

revoke execute on function public.staff_lookup(text) from public, anon;
grant execute on function public.staff_lookup(text) to authenticated;

-- 8. Update staff_interview_applicants to use check_ins.event_id
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
    c.event_id, e.name, c.scanned_at,
    coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'company', i.company,
      'position', i.position, 'status', i.status) order by i.updated_at desc, i.id)
      from public.interview_statuses i where i.registration_id = r.id and i.staff_id = auth.uid()), '[]'::jsonb)
  from public.registrations r
  join public.check_ins c on c.registration_id = r.id and c.status = 'success'
  join public.events e on e.id = c.event_id
  where strpos(lower(concat_ws(' ', r.first_name, r.middle_name, r.last_name, r.suffix)), lower(btrim(coalesce(p_query, '')))) > 0
  order by c.scanned_at desc, r.id
  limit 26 offset p_page * 25;
end;
$$;

revoke all on function public.staff_interview_applicants(text, integer) from public, anon;
grant execute on function public.staff_interview_applicants(text, integer) to authenticated;
