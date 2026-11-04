-- Municipality assignments are explicit; venue text is never authorization.
-- Existing unassigned events remain available to administrators/general staff.
alter table public.events add column municipality text;
alter table public.profiles add column municipality text;
alter table public.profiles add column must_change_password boolean not null default false;

alter table public.events add constraint events_municipality_valid check (municipality in (
  'Abulug','Alcala','Allacapan','Amulung','Aparri','Baggao','Ballesteros','Buguey',
  'Calayan','Camalaniugan','Claveria','Enrile','Gattaran','Gonzaga','Iguig','Lal-lo',
  'Lasam','Pamplona','Peñablanca','Piat','Rizal','Sanchez Mira','Santa Ana',
  'Santa Praxedes','Santa Teresita','Santo Niño','Solana','Tuao','Tuguegarao City'
));
alter table public.profiles add constraint profiles_municipality_valid check (municipality in (
  'Abulug','Alcala','Allacapan','Amulung','Aparri','Baggao','Ballesteros','Buguey',
  'Calayan','Camalaniugan','Claveria','Enrile','Gattaran','Gonzaga','Iguig','Lal-lo',
  'Lasam','Pamplona','Peñablanca','Piat','Rizal','Sanchez Mira','Santa Ana',
  'Santa Praxedes','Santa Teresita','Santo Niño','Solana','Tuao','Tuguegarao City'
));
create index events_municipality_idx on public.events(municipality);

-- Preserve existing profile editing without granting clients the ability to
-- clear first-login enforcement or change their municipality.
revoke update on public.profiles from public, anon, authenticated;
grant update(full_name, role) on public.profiles to authenticated;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid()
    and p.role in ('staff','admin') and not p.must_change_password);
$$;

create or replace function public.staff_can_access_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p join public.events e on e.id = p_event_id
    where p.id = auth.uid() and p.role in ('staff','admin')
      and not p.must_change_password
      and (p.role = 'admin' or p.municipality is null or p.municipality = e.municipality)
  );
$$;
revoke all on function public.staff_can_access_event(uuid) from public, anon;
grant execute on function public.staff_can_access_event(uuid) to authenticated;

-- Restrictive policies also constrain the existing public-read policies for
-- signed-in municipal accounts. Anonymous public registration is unchanged.
create or replace function public.scanner_event_visible(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    not exists(select 1 from public.profiles p where p.id = auth.uid()
      and (p.municipality is not null or p.must_change_password))
    or public.staff_can_access_event(p_event_id)
  );
$$;
revoke all on function public.scanner_event_visible(uuid) from public, anon;
grant execute on function public.scanner_event_visible(uuid) to authenticated;

create policy events_scanner_scope on public.events as restrictive for select to authenticated
  using (public.scanner_event_visible(id));
create policy forms_scanner_scope on public.forms as restrictive for select to authenticated
  using (public.scanner_event_visible(event_id));
create policy form_fields_scanner_scope on public.form_fields as restrictive for select to authenticated
  using (exists(select 1 from public.forms f where f.id = form_id and public.scanner_event_visible(f.event_id)));

-- The lookup runs as the owner because staff cannot read registrations directly.
create or replace function public.staff_can_access_registration(p_registration_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.registrations r
    where r.id = p_registration_id and public.staff_can_access_event(r.event_id));
$$;
revoke all on function public.staff_can_access_registration(uuid) from public, anon;
grant execute on function public.staff_can_access_registration(uuid) to authenticated;
create policy interview_statuses_scanner_scope on public.interview_statuses as restrictive for select to authenticated
  using (public.staff_can_access_registration(registration_id));

create or replace function public.staff_account_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('municipality', p.municipality,
    'must_change_password', p.must_change_password)
  from public.profiles p where p.id = auth.uid() and auth.uid() is not null;
$$;
revoke all on function public.staff_account_status() from public, anon;
grant execute on function public.staff_account_status() to authenticated;

-- Verifying and replacing the password and clearing the flag are atomic.
-- Auth metadata cannot clear this flag; neither can a direct profile update.
create or replace function public.staff_change_initial_password(p_current_password text, p_new_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  if auth.uid() is null then return jsonb_build_object('status','forbidden'); end if;
  select encrypted_password into v_hash from auth.users where id = auth.uid() for update;
  if not exists(select 1 from public.profiles where id = auth.uid()
    and role in ('staff','admin') and must_change_password) then
    return jsonb_build_object('status','forbidden');
  end if;
  if p_current_password is null or v_hash is null
    or crypt(p_current_password, v_hash) is distinct from v_hash then
    return jsonb_build_object('status','invalid_password');
  end if;
  if p_new_password is null or length(p_new_password) < 8 or octet_length(p_new_password) > 72
    or crypt(p_new_password, v_hash) = v_hash then
    return jsonb_build_object('status','weak_password');
  end if;
  update auth.users set encrypted_password = crypt(p_new_password, gen_salt('bf')),
    updated_at = now() where id = auth.uid();
  update public.profiles set must_change_password = false where id = auth.uid();
  return jsonb_build_object('status','ok');
end;
$$;
revoke all on function public.staff_change_initial_password(text,text) from public, anon;
grant execute on function public.staff_change_initial_password(text,text) to authenticated;

-- Admin supplies the requested temporary password at execution time. It is
-- never stored in source, returned, or written to account metadata.
-- Reruns skip existing emails, preserving passwords, roles and assignments.
create or replace function public.admin_create_municipal_scanners(p_initial_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_account record; v_id uuid; v_instance uuid;
  v_email text; v_accounts jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    return jsonb_build_object('status','forbidden');
  end if;
  if p_initial_password is null or length(p_initial_password) < 6 or octet_length(p_initial_password) > 72 then
    return jsonb_build_object('status','weak_password');
  end if;
  -- Serialize concurrent setup requests without changing unrelated accounts.
  perform pg_advisory_xact_lock(20261104, 29);
  select instance_id into v_instance from auth.users where id = auth.uid();
  v_instance := coalesce(v_instance, '00000000-0000-0000-0000-000000000000'::uuid);
  for v_account in select * from (values
    ('Abulug','abulug'),('Alcala','alcala'),('Allacapan','allacapan'),('Amulung','amulung'),
    ('Aparri','aparri'),('Baggao','baggao'),('Ballesteros','ballesteros'),('Buguey','buguey'),
    ('Calayan','calayan'),('Camalaniugan','camalaniugan'),('Claveria','claveria'),('Enrile','enrile'),
    ('Gattaran','gattaran'),('Gonzaga','gonzaga'),('Iguig','iguig'),('Lal-lo','lallo'),
    ('Lasam','lasam'),('Pamplona','pamplona'),('Peñablanca','penablanca'),('Piat','piat'),
    ('Rizal','rizal'),('Sanchez Mira','sanchezmira'),('Santa Ana','santaana'),
    ('Santa Praxedes','santapraxedes'),('Santa Teresita','santateresita'),('Santo Niño','santonino'),
    ('Solana','solana'),('Tuao','tuao'),('Tuguegarao City','tuguegarao')
  ) as accounts(municipality, slug) loop
    v_email := 'scanner@' || v_account.slug || '.peso';
    if exists(select 1 from auth.users where lower(email) = v_email) then
      v_accounts := v_accounts || jsonb_build_array(jsonb_build_object(
        'municipality',v_account.municipality,'email',v_email,'status','existing — unchanged'));
      continue;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      confirmation_token,recovery_token,email_change_token_new,email_change,
      raw_app_meta_data,raw_user_meta_data,is_sso_user,created_at,updated_at)
    values(v_instance,v_id,'authenticated','authenticated',v_email,
      crypt(p_initial_password,gen_salt('bf')),now(),'','','','',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name',v_account.municipality || ' Scanner'),false,now(),now());
    insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
    values(gen_random_uuid(),v_id,v_id::text,'email',
      jsonb_build_object('sub',v_id::text,'email',v_email,'email_verified',true,'phone_verified',false),now(),now());
    update public.profiles set role = 'staff', municipality = v_account.municipality,
      must_change_password = true where id = v_id;
    v_accounts := v_accounts || jsonb_build_array(jsonb_build_object(
      'municipality',v_account.municipality,'email',v_email,'status','created'));
  end loop;
  return jsonb_build_object('status','ok','accounts',v_accounts);
end;
$$;
revoke all on function public.admin_create_municipal_scanners(text) from public, anon;
grant execute on function public.admin_create_municipal_scanners(text) to authenticated;


-- Scope staff_lookup; preserve the existing RPC signature and response contract.
create or replace function public.staff_lookup(p_query text default '')
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_q text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null or not public.is_staff() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  return jsonb_build_object('status', 'ok', 'results', coalesce((
    select jsonb_agg(matches.payload order by matches.scanned_at desc nulls last, matches.registered_at desc)
    from (
      select jsonb_build_object(
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
      ) as payload, c.scanned_at, r.registered_at
      from public.registrations r
      join public.events e on e.id = r.event_id
      left join public.check_ins c on c.registration_id = r.id and c.status = 'success' and public.staff_can_access_event(c.event_id)
      where public.staff_can_access_event(r.event_id) and (v_q = '' or r.ticket_token = v_q
        or r.registration_number = upper(v_q)
        or r.email = lower(v_q)
        or concat_ws(' ', r.first_name, r.last_name) ilike '%' || v_q || '%')
      order by c.scanned_at desc nulls last, r.registered_at desc
      limit 30
    ) matches
  ), '[]'::jsonb));
end;
$$;


-- Scope perform_check_in; preserve the existing RPC signature and response contract.
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
         r.status, e.id as event_id, e.name as event_name, e.event_date
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


-- Scope staff_complete_scanner_profile; preserve the existing RPC signature and response contract.
create or replace function public.staff_complete_scanner_profile(p_ticket_token text, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_registration public.registrations%rowtype;
  v_missing text[];
  v_key text;
  v_value text;
  v_date date;
  v_patch jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or not public.is_staff() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('status', 'invalid_answers');
  end if;
  select * into v_registration from public.registrations
    where ticket_token = btrim(coalesce(p_ticket_token, '')) and public.staff_can_access_event(event_id) for update;
  if not found then return jsonb_build_object('status', 'registration_not_found'); end if;
  if v_registration.status <> 'registered' then return jsonb_build_object('status', 'invalid_ticket'); end if;
  if not public.scanner_profile_checkpoint_applies(v_registration.registration_number) then
    return jsonb_build_object('status', 'not_in_checkpoint');
  end if;
  if exists (select 1 from jsonb_object_keys(p_answers) as supplied(key)
    where not (supplied.key = any(array['date_of_birth', 'course', 'pwd', 'sex', 'first_time_job_seeker', 'returning_ofw', 'returning_worker', 'interested_in_skills_training', 'province', 'municipality_city', 'barangay']::text[]))) then
    return jsonb_build_object('status', 'invalid_answers');
  end if;
  v_missing := public.scanner_missing_fields(v_registration.form_data);
  foreach v_key in array v_missing loop
    if jsonb_typeof(p_answers -> v_key) is distinct from 'string' then
      return jsonb_build_object('status', 'required_fields');
    end if;
    v_value := nullif(btrim(p_answers ->> v_key), '');
    if v_value is null then return jsonb_build_object('status', 'required_fields'); end if;
    if v_key = 'date_of_birth' then
      begin
        v_date := v_value::date;
      exception
        when invalid_datetime_format or datetime_field_overflow then
          return jsonb_build_object('status', 'invalid_answers');
      end;
      if to_char(v_date, 'YYYY-MM-DD') <> v_value or v_date > (now() at time zone 'Asia/Manila')::date then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    elsif v_key in ('course', 'province', 'municipality_city', 'barangay') then
      if length(v_value) > 200 then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    elsif v_key = 'pwd' then
      if v_value not in ('Yes', 'No') then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    elsif v_key = 'sex' then
      if v_value not in ('Male', 'Female') then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    elsif v_key in ('first_time_job_seeker', 'returning_ofw', 'returning_worker') then
      if v_value not in ('yes', 'no') then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    elsif v_key = 'interested_in_skills_training' then
      if v_value not in ('Yes', 'No') then
        return jsonb_build_object('status', 'invalid_answers');
      end if;
    end if;


    v_patch := v_patch || jsonb_build_object(v_key, v_value);
  end loop;
  update public.registrations set form_data = coalesce(form_data, '{}'::jsonb) || v_patch,
    updated_at = now() where id = v_registration.id;
  return jsonb_build_object('status', 'ok');
end;
$$;


-- Scope staff_walk_in_events; preserve the existing RPC signature and response contract.
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
   from public.events where public.staff_can_access_event(id) and event_date between v_today-5 and v_today
     and status in ('published','closed','archived')
 ),'[]'::jsonb));
end;
$$;


-- Scope staff_list_events; preserve the existing RPC signature and response contract.
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
    where public.staff_can_access_event(id) and status in ('published', 'closed')
  ), '[]'::jsonb));
end;
$$;


-- Scope staff_walk_in_form; preserve the existing RPC signature and response contract.
create or replace function public.staff_walk_in_form(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_form public.forms%rowtype; v_fields jsonb; v_day date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.staff_can_access_event(p_event_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
 if auth.uid() is null or not public.is_staff() then return jsonb_build_object('status','forbidden'); end if;
 if not exists(select 1 from public.events where id=p_event_id and event_date between v_day-5 and v_day and status in ('published','closed','archived')) then
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


-- Scope staff_record_walk_in; preserve the existing RPC signature and response contract.
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
 if not found or v_event.event_date is null or v_event.event_date < v_today-5
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
 values(v_reg,auth.uid(),'success',v_event.event_date,'Post-event walk-in attendance recorded by staff/admin',p_event_id)
 returning scanned_at into v_recorded_at;
 return jsonb_build_object('status','success','registration_number',v_number,
   'attendance_date',v_event.event_date,'recorded_at',v_recorded_at);
end;
$$;


-- Scope staff_event_vacancies; preserve the existing RPC signature and response contract.
create or replace function public.staff_event_vacancies(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_rows jsonb;
begin
  if not public.staff_can_access_event(p_event_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if auth.uid() is null or not public.is_staff() then
    return jsonb_build_object('status', 'forbidden', 'vacancies', '[]'::jsonb);
  end if;
  if not exists(select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('status', 'event_not_found', 'vacancies', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(to_jsonb(v) order by v.company_name, v.vacancy_title), '[]'::jsonb)
  into v_rows
  from public.vacancies v
  where v.event_id = p_event_id;
  return jsonb_build_object('status', 'ok', 'vacancies', v_rows);
end;
$$;


-- Scope staff_interview_applicants; preserve the existing RPC signature and response contract.
create or replace function public.staff_interview_applicants(p_query text default '', p_page integer default 0, p_event_id uuid default null)
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
      from public.interview_results i where i.registration_id = r.id and i.event_id = c.event_id), '[]'::jsonb)
  from public.registrations r
  join public.check_ins c on c.registration_id = r.id and c.status = 'success'
  join public.events e on e.id = c.event_id
  where public.staff_can_access_event(c.event_id) and public.staff_can_access_event(r.event_id) and (p_event_id is null or c.event_id = p_event_id) and strpos(lower(concat_ws(' ', r.first_name, r.middle_name, r.last_name, r.suffix)), lower(btrim(coalesce(p_query, '')))) > 0
  order by c.scanned_at desc, r.id, c.event_id
  limit 26 offset p_page * 25;
end;
$$;


-- Scope staff_save_interview_status; preserve the existing RPC signature and response contract.
create or replace function public.staff_save_interview_status(p_registration_id uuid, p_company text, p_position text, p_status text, p_event_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.staff_can_access_event(p_event_id) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if auth.uid() is null or not public.is_staff() then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_company is null or length(btrim(p_company)) not between 1 and 500
    or p_position is null or length(btrim(p_position)) not between 1 and 500
    or p_status is null or p_status not in ('Not Qualified', 'Qualified', 'Near Hires', 'HOTS') then
    raise exception 'Invalid interview fields' using errcode = '22023';
  end if;
  if not exists (select 1 from public.check_ins c join public.registrations r on r.id = c.registration_id where public.staff_can_access_event(r.event_id) and c.registration_id = p_registration_id and c.event_id = p_event_id and c.status = 'success') then
    raise exception 'Applicant has not checked in' using errcode = '22023';
  end if;
  insert into public.interview_results(event_id, registration_id, staff_id, company, position, status)
    values (p_event_id, p_registration_id, auth.uid(), btrim(p_company), btrim(p_position), p_status)
    on conflict (event_id, registration_id, lower(company), lower(position))
    do update set status = excluded.status, staff_id = excluded.staff_id, updated_at = now()
    returning id into v_id;
  return v_id;
end;
$$;


-- Scope staff_save_interview_status; preserve the existing RPC signature and response contract.
create or replace function public.staff_save_interview_status(p_registration_id uuid,p_company text,p_position text,p_status text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
 if auth.uid() is null or not public.is_staff() then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
 if (select count(*) from public.check_ins where registration_id=p_registration_id and status='success' and public.staff_can_access_event(event_id)) <> 1 then
 raise exception 'Choose an event using the updated interview page' using errcode='22023'; end if;
 select event_id into v_event from public.check_ins where registration_id=p_registration_id and status='success' and public.staff_can_access_event(event_id);
 return public.staff_save_interview_status(p_registration_id,p_company,p_position,p_status,v_event);
end $$;


-- Scope staff_export_interview_results; preserve the existing RPC signature and response contract.
create or replace function public.staff_export_interview_results(p_event_id uuid, p_after uuid default null)
returns table(
  id uuid,
  registration_number text,
  applicant_name text,
  pwd text,
  sex text,
  first_time_job_seeker text,
  returning_ofw text,
  returning_worker text,
  interested_in_skills_training text,
  province text,
  municipality_city text,
  barangay text,
  company text,
  "position" text,
  status text,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.staff_can_access_event(p_event_id) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if auth.uid() is null or not public.is_staff() then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if p_event_id is null then raise exception 'Choose an event' using errcode='22023'; end if;
  return query
  select i.id,
         r.registration_number,
         concat_ws(' ', r.first_name, nullif(r.middle_name, ''), r.last_name, nullif(r.suffix, '')),
         r.form_data->>'pwd',
         r.form_data->>'sex',
         r.form_data->>'first_time_job_seeker',
         r.form_data->>'returning_ofw',
         r.form_data->>'returning_worker',
         r.form_data->>'interested_in_skills_training',
         r.form_data->>'province',
         r.form_data->>'municipality_city',
         r.form_data->>'barangay',
         i.company,
         i.position,
         i.status,
         i.updated_at
  from public.interview_results i join public.registrations r on r.id=i.registration_id
  where public.staff_can_access_event(r.event_id) and i.event_id=p_event_id and (p_after is null or i.id>p_after)
  order by i.id limit 500;
end $$;


create or replace function public.admin_list_profiles()
returns jsonb
language sql
security definer
set search_path = public, auth
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id',         p.id,
      'full_name',  p.full_name,
      'role',       p.role,
      'municipality', p.municipality,
      'must_change_password', p.must_change_password,
      'email',      u.email,
      'created_at', p.created_at
    ) order by p.created_at asc),
    '[]'::jsonb
  )
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.is_admin();
$$;

revoke execute on function public.admin_list_profiles() from public;
revoke execute on function public.admin_list_profiles() from anon;
grant execute on function public.admin_list_profiles() to authenticated;
