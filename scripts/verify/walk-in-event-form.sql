begin;
do $test$
declare s uuid; e uuid; f uuid; other_f uuid; result jsonb; n text; v_key uuid:=gen_random_uuid();
begin
 select id into s from public.profiles where role='staff' limit 1;
 if s is null then raise exception 'Missing staff test role'; end if;
 insert into public.events(name,event_date,status) values('Form test',(now() at time zone 'Asia/Manila')::date-1,'closed') returning id into e;
 insert into public.forms(event_id,name,status,published_at) values(e,'Event registration','published',now()) returning id into f;
 insert into public.forms(event_id,name,status) values(e,'Unpublished form','draft') returning id into other_f;
 insert into public.form_fields(form_id,field_key,label,field_type,required,options,sort_order) values
 (f,'education','Education','short_text',true,'[]',1),
 (f,'sex','Sex','radio',true,'["Female","Male"]',2),
 (f,'data_privacy_consent','Data Privacy Consent','yes_no',true,'[]',3);
 perform set_config('request.jwt.claim.sub',s::text,true);
 result:=public.staff_walk_in_form(e);
 if result->>'status'<>'ok' or jsonb_array_length(result->'fields')<>2 then raise exception 'Form did not exclude consent: %',result; end if;
 if public.staff_record_walk_in(e,'Test','Only',v_key||'@example.test','09000000000',p_form_id=>other_f,p_form_data=>'{}')->>'status'<>'form_not_found' then raise exception 'Draft form accepted'; end if;
 if public.staff_record_walk_in(e,'Test','Only',v_key||'@example.test','09000000000',p_form_id=>f,p_form_data=>'{}')->>'status'<>'invalid_answer' then raise exception 'Required answers not checked'; end if;
 if public.staff_record_walk_in(e,'Test','Only',v_key||'@example.test','09000000000',p_form_id=>f,p_form_data=>'{"education":"College","sex":"Invalid"}')->>'status'<>'invalid_answer' then raise exception 'Invalid choice accepted'; end if;
 result:=public.staff_record_walk_in(e,'Test','Only',v_key||'@example.test','09000000000',p_form_id=>f,p_form_data=>'{"education":"College","sex":"Female","data_privacy_consent":"yes","unknown":"discard"}');
 if result->>'status'<>'success' then raise exception 'Save failed %',result; end if;
 n:=result->>'registration_number';
 if not exists(select 1 from public.registrations where registration_number=n and form_id=f and form_data='{"education":"College","sex":"Female"}'::jsonb and recorded_by=s) then raise exception 'Answers not stored correctly'; end if;
 if not exists(select 1 from public.check_ins c join public.registrations r on r.id=c.registration_id where r.registration_number=n) then raise exception 'Attendance not saved'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if public.staff_walk_in_form(e)->>'status'<>'forbidden' then raise exception 'Unprivileged read allowed'; end if;
end $test$;
rollback;
