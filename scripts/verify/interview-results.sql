-- Run inside a transaction and ROLLBACK. Uses existing role/check-in fixtures,
-- writes only test company names, and leaves no changes behind.
do $$
declare
 v_staff uuid; v_admin uuid; v_registration uuid; v_event uuid;
 v_id uuid; v_second uuid; v_updated uuid; v_status text; v_count integer;
begin
 select id into strict v_staff from public.profiles where role='staff' limit 1;
 select id into strict v_admin from public.profiles where role='admin' limit 1;
 select registration_id,event_id into strict v_registration,v_event from public.check_ins where status='success' order by scanned_at desc limit 1;
 perform set_config('request.jwt.claim.sub',v_staff::text,true);
 v_id := public.staff_save_interview_status(v_registration,'__sync_test_A','Clerk','HOTS',v_event);
 v_second := public.staff_save_interview_status(v_registration,'__sync_test_B','Clerk','Qualified',v_event);
 perform set_config('request.jwt.claim.sub',v_admin::text,true);
 select status into v_status from public.staff_export_interview_results(v_event) where id=v_id;
 if v_status is distinct from 'HOTS' then raise exception 'Staff to admin sync failed'; end if;
 v_updated := public.staff_save_interview_status(v_registration,' __SYNC_TEST_A ',' clerk ','Near Hires',v_event);
 if v_updated <> v_id then raise exception 'Admin created duplicate instead of updating'; end if;
 if public.admin_event_interview_summary(v_event)->>'status' <> 'ok' then raise exception 'Summary failed'; end if;
 perform set_config('request.jwt.claim.sub',v_staff::text,true);
 select status into v_status from public.staff_export_interview_results(v_event) where id=v_id;
 if v_status is distinct from 'Near Hires' then raise exception 'Admin to staff sync failed'; end if;
 select count(*) into v_count from public.staff_export_interview_results(v_event) where id in (v_id,v_second);
 if v_count <> 2 then raise exception 'Multiple companies were lost'; end if;
 if not exists (select 1 from public.staff_interview_applicants('',0,v_event) a,
 jsonb_array_elements(a.interviews) i where a.registration_id=v_registration and i->>'id'=v_id::text and i->>'status'='Near Hires') then
 raise exception 'Shared applicant listing failed'; end if;
 begin
  perform public.staff_save_interview_status(v_registration,'__sync_test_A','Clerk','HOTS',gen_random_uuid());
  raise exception 'Wrong event accepted';
 exception when invalid_parameter_value then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.staff_export_interview_results(v_event);
  raise exception 'Unauthenticated export accepted';
 exception when insufficient_privilege then null; end;
end $$;
select 'INTERVIEW_SYNC_TESTS_PASSED' as result;
