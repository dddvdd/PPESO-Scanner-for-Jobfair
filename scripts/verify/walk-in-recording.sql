begin;
do $test$
declare
 v_form uuid; v_staff uuid; v_admin uuid; v_event uuid; v_old uuid; v_today uuid; v_future uuid; v_draft uuid;
 v_result jsonb; v_reg uuid; v_count int; v_email text := gen_random_uuid()::text||'@example.test';
 v_day date := (now() at time zone 'Asia/Manila')::date;
begin
 select id into v_staff from public.profiles where role='staff' limit 1;
 select id into v_admin from public.profiles where role='admin' limit 1;
 if v_staff is null or v_admin is null then raise exception 'Test needs staff and admin accounts'; end if;
 insert into public.events(name,event_date,status) values('Walk-in test',v_day-5,'closed') returning id into v_event;
 insert into public.events(name,event_date,status) values('Walk-in old',v_day-6,'closed') returning id into v_old;
 insert into public.events(name,event_date,status) values('Walk-in today',v_day,'published') returning id into v_today;
 insert into public.events(name,event_date,status) values('Walk-in future',v_day+1,'published') returning id into v_future;
 insert into public.events(name,event_date,status) values('Walk-in draft',v_day-1,'draft') returning id into v_draft;
 insert into public.forms(event_id,name,status,published_at) values(v_event,'Test form','published',now()) returning id into v_form;
 perform set_config('request.jwt.claim.sub','',true);
 if public.staff_record_walk_in(v_event,'Test','Only',v_email,'09000000000',p_form_id=>v_form)->>'status' <> 'forbidden' then raise exception 'Anonymous allowed'; end if;
 perform set_config('request.jwt.claim.sub',v_staff::text,true);
 v_result:=public.staff_walk_in_events();
 if not exists(select 1 from jsonb_array_elements(v_result->'events') e where e->>'id'=v_event::text) then raise exception 'Day 5 missing'; end if;
 if exists(select 1 from jsonb_array_elements(v_result->'events') e where (e->>'id')::uuid in(v_old,v_today,v_future,v_draft)) then raise exception 'Invalid event offered'; end if;
 if public.staff_record_walk_in(v_old,'Test','Only',v_email,'09000000000',p_form_id=>v_form)->>'status' <> 'event_not_eligible' then raise exception 'Old accepted'; end if;
 if public.staff_record_walk_in(v_today,'Test','Only',v_email,'09000000000',p_form_id=>v_form)->>'status' <> 'event_not_eligible' then raise exception 'Today accepted'; end if;
 if public.staff_record_walk_in(v_future,'Test','Only',v_email,'09000000000',p_form_id=>v_form)->>'status' <> 'event_not_eligible' then raise exception 'Future accepted'; end if;
 if public.staff_record_walk_in(v_draft,'Test','Only',v_email,'09000000000',p_form_id=>v_form)->>'status' <> 'event_not_eligible' then raise exception 'Draft accepted'; end if;
 if public.staff_record_walk_in(v_event,' ','Only',v_email,'09000000000',p_form_id=>v_form)->>'status' <> 'missing_required_fields' then raise exception 'Empty name accepted'; end if;
 v_result:=public.staff_record_walk_in(v_event,'Test','Only',v_email,'09000000000',p_form_id=>v_form);
 if v_result->>'status'<>'success' then raise exception 'Staff save failed %',v_result; end if;
 select id into v_reg from public.registrations where registration_number=v_result->>'registration_number';
 if not exists(select 1 from public.registrations where id=v_reg and entry_source='post_event_walk_in' and recorded_by=v_staff and registered_at>=transaction_timestamp()) then raise exception 'Registration audit missing'; end if;
 if not exists(select 1 from public.check_ins where registration_id=v_reg and scanned_by=v_staff and attendance_date=v_day-5 and scanned_at>=transaction_timestamp()) then raise exception 'Attendance missing'; end if;
 if public.staff_record_walk_in(v_event,'Test','Only',upper(v_email),'09000000000',p_form_id=>v_form)->>'status'<>'duplicate_registration' then raise exception 'Duplicate allowed'; end if;
 if (select count(*) from public.check_ins where registration_id=v_reg)<>1 then raise exception 'Duplicate attendance'; end if;
 perform set_config('request.jwt.claim.sub',v_admin::text,true);
 if public.staff_record_walk_in(v_event,'Admin','Test','admin-'||v_email,'09000000001',p_form_id=>v_form)->>'status'<>'success' then raise exception 'Admin rejected'; end if;
 if has_function_privilege('anon','public.staff_record_walk_in(uuid,text,text,text,text,text,text,uuid,jsonb)','execute') then raise exception 'Public execution allowed'; end if;
end $test$;
rollback;
