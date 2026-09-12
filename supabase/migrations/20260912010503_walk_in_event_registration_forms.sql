create or replace function public.staff_walk_in_form(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_form public.forms%rowtype; v_fields jsonb; v_day date := (now() at time zone 'Asia/Manila')::date;
begin
 if auth.uid() is null or not public.is_staff() then return jsonb_build_object('status','forbidden'); end if;
 if not exists(select 1 from public.events where id=p_event_id and event_date between v_day-5 and v_day-1 and status in ('published','closed','archived')) then
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
revoke execute on function public.staff_walk_in_form(uuid) from public,anon;
grant execute on function public.staff_walk_in_form(uuid) to authenticated;

-- Replace the basic-only API so callers cannot bypass required event questions.
drop function public.staff_record_walk_in(uuid,text,text,text,text,text,text);
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
 if p_form_id is null or not exists(select 1 from public.forms where id=p_form_id and event_id=p_event_id and status='published') then
   return jsonb_build_object('status','form_not_found');
 end if;
 v_form := p_form_id;
 if jsonb_typeof(p_form_data) is distinct from 'object' then return jsonb_build_object('status','invalid_fields'); end if;
 for v_field in select * from public.form_fields ff where form_id=v_form and not (lower(ff.field_key || ' ' || ff.label) like '%privacy%' and lower(ff.field_key || ' ' || ff.label) like '%consent%') order by sort_order loop
   v_value := p_form_data->v_field.field_key;
   v_text := p_form_data->>v_field.field_key;
   if v_value is null or v_value='null'::jsonb or v_value='""'::jsonb or v_value='[]'::jsonb then
     if v_field.required then return jsonb_build_object('status','invalid_answer','field',v_field.field_key,'message',v_field.label || ' is required.'); end if;
     continue;
   end if;
   if v_field.field_type in ('checkbox','multi_select') then
     if jsonb_typeof(v_value)<>'array' then return jsonb_build_object('status','invalid_answer','field',v_field.field_key,'message','Select valid options.'); end if;
     if exists(select 1 from jsonb_array_elements(v_value) el where jsonb_typeof(el)<>'string' or not (v_field.options @> jsonb_build_array(el))) then
       return jsonb_build_object('status','invalid_answer','field',v_field.field_key,'message','Select valid options.');
     end if;
   else
     if jsonb_typeof(v_value)<>'string' or btrim(v_text)='' then
       return jsonb_build_object('status','invalid_answer','field',v_field.field_key,'message','Enter a valid answer.');
     end if;
     if v_field.field_type='number' and v_text !~ '^-?[0-9]+([.][0-9]+)?$' then
       return jsonb_build_object('status','invalid_answer','field',v_field.field_key,'message','Enter a valid number.');
     end if;
     if v_field.field_type='date' then
       begin
         if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise invalid_datetime_format; end if;
         perform v_text::date;
       exception when invalid_datetime_format or datetime_field_overflow then
         return jsonb_build_object('status','invalid_answer','field',v_field.field_key,'message','Enter a valid date.');
       end;
     end if;
     if (v_field.field_type in ('dropdown','radio') and not (v_field.options @> jsonb_build_array(v_text)))
       or (v_field.field_type='yes_no' and lower(v_text) not in ('yes','no')) then
       return jsonb_build_object('status','invalid_answer','field',v_field.field_key,'message','Select a valid option.');
     end if;
   end if;
   v_clean := v_clean || jsonb_build_object(v_field.field_key,v_value);
 end loop;
 if length(regexp_replace(p_mobile_number,'[^0-9]','','g'))<7 then return jsonb_build_object('status','invalid_fields'); end if;
 v_number := 'JF'||to_char(now() at time zone 'Asia/Manila','YYYYMMDD')||'-'||lpad(nextval('public.registration_number_seq')::text,6,'0');
 begin
   insert into public.registrations(event_id,form_id,registration_number,ticket_token,
     first_name,middle_name,last_name,suffix,email,mobile_number,entry_source,recorded_by,form_data)
   values(p_event_id,v_form,v_number,encode(gen_random_bytes(24),'hex'),
     btrim(p_first_name),nullif(btrim(p_middle_name),''),btrim(p_last_name),nullif(btrim(p_suffix),''),
     lower(btrim(p_email)),btrim(p_mobile_number),'post_event_walk_in',auth.uid(),v_clean)
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
