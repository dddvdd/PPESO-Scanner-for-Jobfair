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
 v_first text := coalesce(nullif(btrim(p_first_name),''), 'Walk-in');
 v_last text := coalesce(nullif(btrim(p_last_name),''), 'Applicant');
 v_email text := nullif(btrim(p_email),'');
 v_mobile text := nullif(btrim(p_mobile_number),'');
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
 begin
   insert into public.registrations(event_id,form_id,registration_number,ticket_token,
     first_name,middle_name,last_name,suffix,email,mobile_number,entry_source,recorded_by,form_data)
   values(p_event_id,coalesce(v_form,v_event.id),v_number,encode(gen_random_bytes(24),'hex'),
     v_first,nullif(btrim(p_middle_name),''),v_last,nullif(btrim(p_suffix),''),
     coalesce(v_email,v_number||'@walkin.local'),coalesce(v_mobile,'0000000000'),'post_event_walk_in',auth.uid(),v_clean)
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

revoke execute on function public.staff_record_walk_in(uuid,text,text,text,text,text,text,uuid,jsonb) from public,anon;
grant execute on function public.staff_record_walk_in(uuid,text,text,text,text,text,text,uuid,jsonb) to authenticated;
