alter table public.registrations
 add column entry_source text not null default 'pre_registration'
   check (entry_source in ('pre_registration', 'post_event_walk_in')),
 add column recorded_by uuid references auth.users(id) on delete set null;

create or replace function public.staff_walk_in_events()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Manila')::date;
begin
 if auth.uid() is null or not public.is_staff() then
   return jsonb_build_object('status','forbidden','events','[]'::jsonb);
 end if;
 return jsonb_build_object('status','ok','events',coalesce((
   select jsonb_agg(jsonb_build_object('id',id,'name',name,'event_date',event_date,'location',location)
     order by event_date desc, name)
   from public.events where event_date >= v_today-5 and event_date < v_today
     and status in ('published','closed','archived')
 ),'[]'::jsonb));
end;
$$;

create or replace function public.staff_record_walk_in(
 p_event_id uuid, p_first_name text, p_last_name text, p_email text,
 p_mobile_number text, p_middle_name text default null, p_suffix text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
 v_today date := (now() at time zone 'Asia/Manila')::date;
 v_event public.events%rowtype; v_form uuid; v_reg uuid; v_number text;
 v_recorded_at timestamptz;
begin
 if auth.uid() is null or not public.is_staff() then return jsonb_build_object('status','forbidden'); end if;
 select * into v_event from public.events where id=p_event_id for update;
 if not found or v_event.event_date is null or v_event.event_date < v_today-5
   or v_event.event_date >= v_today or v_event.status not in ('published','closed','archived') then
   return jsonb_build_object('status','event_not_eligible');
 end if;
 if nullif(btrim(p_first_name),'') is null or nullif(btrim(p_last_name),'') is null
   or nullif(btrim(p_mobile_number),'') is null then
   return jsonb_build_object('status','missing_required_fields');
 end if;
 if coalesce(btrim(p_email),'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
   return jsonb_build_object('status','invalid_email');
 end if;
 if length(btrim(p_first_name))>100 or length(btrim(p_last_name))>100
   or length(coalesce(p_middle_name,''))>100 or length(coalesce(p_suffix,''))>20
   or length(btrim(p_email))>254 or length(btrim(p_mobile_number))>30 then
   return jsonb_build_object('status','invalid_fields');
 end if;
 if exists(select 1 from public.registrations where event_id=p_event_id and lower(email)=lower(btrim(p_email))) then
   return jsonb_build_object('status','duplicate_registration');
 end if;
 -- A dedicated draft form keeps these basic records separate from public forms.
 select id into v_form from public.forms where event_id=p_event_id
   and name='Post-event walk-in recording' and status='draft' order by created_at limit 1;
 if v_form is null then
   insert into public.forms(event_id,name,status) values(p_event_id,'Post-event walk-in recording','draft') returning id into v_form;
 end if;
 v_number := 'JF'||to_char(now() at time zone 'Asia/Manila','YYYYMMDD')||'-'||lpad(nextval('public.registration_number_seq')::text,6,'0');
 begin
   insert into public.registrations(event_id,form_id,registration_number,ticket_token,
     first_name,middle_name,last_name,suffix,email,mobile_number,entry_source,recorded_by)
   values(p_event_id,v_form,v_number,encode(gen_random_bytes(24),'hex'),
     btrim(p_first_name),nullif(btrim(p_middle_name),''),btrim(p_last_name),nullif(btrim(p_suffix),''),
     lower(btrim(p_email)),btrim(p_mobile_number),'post_event_walk_in',auth.uid())
   returning id into v_reg;
 exception when unique_violation then
   return jsonb_build_object('status','duplicate_registration');
 end;
 insert into public.check_ins(registration_id,scanned_by,status,attendance_date,override_reason)
 values(v_reg,auth.uid(),'success',v_event.event_date,'Post-event walk-in attendance recorded by staff/admin')
 returning scanned_at into v_recorded_at;
 return jsonb_build_object('status','success','registration_number',v_number,
   'attendance_date',v_event.event_date,'recorded_at',v_recorded_at);
end;
$$;
revoke execute on function public.staff_walk_in_events() from public,anon;
revoke execute on function public.staff_record_walk_in(uuid,text,text,text,text,text,text) from public,anon;
grant execute on function public.staff_walk_in_events() to authenticated;
grant execute on function public.staff_record_walk_in(uuid,text,text,text,text,text,text) to authenticated;

-- Staff name lookup supplies the stored ticket token for manual check-in.
-- No attendee QR code is required; existing staff authorization is retained.
create or replace function public.staff_lookup(p_query text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_rows jsonb;
begin
  if not public.is_staff() then
    return jsonb_build_object('status', 'forbidden', 'results', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(matches) order by matches.checked_in_at desc nulls last, matches.registered_at desc), '[]'::jsonb)
  into v_rows
  from (
    select r.registration_number, r.ticket_token,
      concat_ws(' ', r.first_name, r.last_name) as applicant_name,
      r.email, e.name as event_name, e.event_date,
      r.status as registration_status, c.scanned_at as checked_in_at,
      r.entry_source, c.attendance_date, (c.override_reason is not null) as is_late_check_in,
      r.registered_at
    from public.registrations r
    join public.events e on e.id = r.event_id
    left join public.check_ins c on c.registration_id = r.id and c.status = 'success'
    where v_q = '' or r.ticket_token = v_q
      or r.registration_number = upper(v_q)
      or r.email = lower(v_q)
      or concat_ws(' ', r.first_name, r.last_name) ilike '%' || v_q || '%'
    order by c.scanned_at desc nulls last, r.registered_at desc
    limit 30
  ) matches;
  return jsonb_build_object('status', 'ok', 'results', v_rows);
end;
$$;
revoke execute on function public.staff_lookup(text) from public, anon;
grant execute on function public.staff_lookup(text) to authenticated;
