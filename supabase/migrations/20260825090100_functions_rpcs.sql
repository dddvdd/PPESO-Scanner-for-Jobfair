-- ============================================================================
-- Migration 002 — Role helper functions and RPCs
--
-- Security model helpers:
--   is_admin() / is_staff()  — SECURITY DEFINER so RLS policies can consult
--                              profiles without recursive policy evaluation.
-- RPC API (database-authoritative, mvp_scope.md §6/§8/§10/§11):
--   register_applicant()     — public submission w/ server-side validation,
--                              duplicate handling, reg-number + token issuance
--   retrieve_ticket()        — reg number + email verification -> ticket data
--   perform_check_in()       — ATOMIC staff check-in (ON CONFLICT DO NOTHING
--                              against the partial unique index); Scanner A
--                              gets success, Scanner B gets already_checked_in
--   staff_lookup()           — narrow authorized lookup for scanner/admin UI
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Role helpers
-- ----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('staff', 'admin')
  );
$$;

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- register_applicant — called by anonymous users through Supabase JS.
-- Error contract (stable uppercase tokens, mvp_scope.md §16):
--   FORM_NOT_FOUND | FORM_NOT_PUBLISHED | EVENT_NOT_PUBLISHED
--   MISSING_REQUIRED_FIELD:<key> | INVALID_NUMBER:<key> | INVALID_DATE:<key>
--   INVALID_EMAIL | INVALID_MOBILE | INVALID_CHOICE:<key>
--   DUPLICATE_REGISTRATION | REGISTRATION_FAILED
-- Returns { registration_id, registration_number, ticket_token }.
-- The raw ticket_token is returned exactly once here and via verified
-- retrieval only.
-- ----------------------------------------------------------------------------

create or replace function public.register_applicant(
  p_event_id uuid,
  p_form_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_mobile_number text,
  p_middle_name text default null,
  p_suffix text default null,
  p_form_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form_status public.form_status;
  v_event_status public.event_status;
  v_clean jsonb;
  v_rec public.form_fields%rowtype;
  v_text text;
  v_jsonb jsonb;
  v_element text;
  v_valid_choice boolean;
  v_registration_number text;
  v_ticket_token text;
  v_registration_id uuid;
begin
  -- Form must exist and belong to the given event.
  select f.status
    into v_form_status
    from public.forms f
   where f.id = p_form_id
     and f.event_id = p_event_id;

  if v_form_status is null then
    raise exception 'FORM_NOT_FOUND';
  end if;
  if v_form_status <> 'published' then
    raise exception 'FORM_NOT_PUBLISHED';
  end if;

  select e.status
    into v_event_status
    from public.events e
   where e.id = p_event_id;

  if v_event_status is null or v_event_status <> 'published' then
    raise exception 'EVENT_NOT_PUBLISHED';
  end if;

  -- Keep only responses whose keys match configured fields.
  select coalesce(jsonb_object_agg(ff.field_key, p_form_data -> ff.field_key), '{}'::jsonb)
    into v_clean
    from public.form_fields ff
   where ff.form_id = p_form_id
     and p_form_data ? ff.field_key;

  -- Required-field presence.
  for v_rec in
    select * from public.form_fields where form_id = p_form_id and required
  loop
    if v_rec.field_type in ('checkbox', 'multi_select') then
      v_jsonb := v_clean -> v_rec.field_key;
      if v_jsonb is null
         or jsonb_typeof(v_jsonb) <> 'array'
         or jsonb_array_length(v_jsonb) = 0 then
        raise exception 'MISSING_REQUIRED_FIELD:%', v_rec.field_key;
      end if;
    else
      v_text := v_clean ->> v_rec.field_key;
      if v_text is null or btrim(v_text) = '' then
        raise exception 'MISSING_REQUIRED_FIELD:%', v_rec.field_key;
      end if;
    end if;
  end loop;

  -- Type validation for every provided value (required or optional).
  for v_rec in
    select *
      from public.form_fields
     where form_id = p_form_id
       and p_form_data ? field_key
  loop
    continue when not (v_clean ? v_rec.field_key);
    v_text := v_clean ->> v_rec.field_key;
    v_jsonb := v_clean -> v_rec.field_key;

    case v_rec.field_type
      when 'number' then
        if v_text !~ '^-?[0-9]+(\.[0-9]+)?$' then
          raise exception 'INVALID_NUMBER:%', v_rec.field_key;
        end if;
      when 'date' then
        if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'INVALID_DATE:%', v_rec.field_key;
        end if;
      when 'dropdown', 'radio' then
        select exists (
          select 1
          from jsonb_array_elements_text(v_rec.options) as opt(value)
          where opt.value = v_text
        )
          into v_valid_choice;
        if not v_valid_choice then
          raise exception 'INVALID_CHOICE:%', v_rec.field_key;
        end if;
      when 'yes_no' then
        if lower(coalesce(v_text, '')) not in ('yes', 'no') then
          raise exception 'INVALID_CHOICE:%', v_rec.field_key;
        end if;
      when 'checkbox', 'multi_select' then
        if jsonb_typeof(v_jsonb) <> 'array' then
          raise exception 'INVALID_CHOICE:%', v_rec.field_key;
        end if;
        foreach v_element in array array(select jsonb_array_elements_text(v_jsonb))
        loop
          if not exists (
            select 1
            from jsonb_array_elements_text(v_rec.options) as opt(value)
            where opt.value = v_element
          ) then
            raise exception 'INVALID_CHOICE:%', v_rec.field_key;
          end if;
        end loop;
      else
        null; -- short_text / long_text: free-form
    end case;
  end loop;

  -- Identity sanity checks.
  if btrim(p_first_name) = '' or btrim(p_last_name) = '' then
    raise exception 'MISSING_REQUIRED_FIELD:name';
  end if;
  if p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL';
  end if;
  if length(regexp_replace(p_mobile_number, '[^0-9]', '', 'g')) < 7 then
    raise exception 'INVALID_MOBILE';
  end if;

  -- Duplicate handling (mvp_scope.md §14): friendly duplicate signal,
  -- never a rate-limit style rejection.
  if exists (
    select 1
      from public.registrations r
     where r.event_id = p_event_id
       and r.email = lower(btrim(p_email))
  ) then
    raise exception 'DUPLICATE_REGISTRATION';
  end if;

  v_registration_number := 'JF'
    || to_char(now(), 'YY')
    || '-'
    || lpad(nextval('public.registration_number_seq')::text, 6, '0');
  v_ticket_token := encode(gen_random_bytes(24), 'hex');

  begin
    insert into public.registrations (
      event_id, form_id, registration_number, ticket_token,
      first_name, middle_name, last_name, suffix,
      email, mobile_number, form_data
    ) values (
      p_event_id, p_form_id, v_registration_number, v_ticket_token,
      btrim(p_first_name), nullif(btrim(p_middle_name), ''), btrim(p_last_name),
      nullif(btrim(p_suffix), ''),
      lower(btrim(p_email)), btrim(p_mobile_number), v_clean
    )
    returning id into v_registration_id;
  exception
    when unique_violation then
      if sqlerrm like '%registrations_event_email_key%' then
        raise exception 'DUPLICATE_REGISTRATION';
      else
        raise exception 'REGISTRATION_FAILED';
      end if;
  end;

  return jsonb_build_object(
    'registration_id', v_registration_id,
    'registration_number', v_registration_number,
    'ticket_token', v_ticket_token
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- retrieve_ticket — Registration Number + verification email.
-- One generic failure token prevents enumeration (mvp_scope.md §8).
-- ----------------------------------------------------------------------------

create or replace function public.retrieve_ticket(
  p_registration_number text,
  p_verification_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_checked_in_at timestamptz;
begin
  select r.id,
         r.registration_number,
         r.ticket_token,
         r.first_name,
         r.middle_name,
         r.last_name,
         r.suffix,
         r.email,
         r.status as registration_status,
         r.registered_at,
         e.name as event_name,
         e.event_date,
         e.location
    into v_row
    from public.registrations r
    join public.events e on e.id = r.event_id
   where r.registration_number = upper(btrim(p_registration_number))
     and r.email = lower(btrim(p_verification_email));

  if v_row.id is null then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  select c.scanned_at
    into v_checked_in_at
    from public.check_ins c
   where c.registration_id = v_row.id
     and c.status = 'success';

  return jsonb_build_object(
    'registration_number', v_row.registration_number,
    'ticket_token', v_row.ticket_token,
    'first_name', v_row.first_name,
    'middle_name', v_row.middle_name,
    'last_name', v_row.last_name,
    'suffix', v_row.suffix,
    'email', v_row.email,
    'event_name', v_row.event_name,
    'event_date', v_row.event_date,
    'location', v_row.location,
    'registration_status', v_row.registration_status,
    'registered_at', v_row.registered_at,
    'checked_in_at', v_checked_in_at
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- perform_check_in — THE atomic operation (mvp_scope.md §11).
-- Concurrency safety relies on INSERT ... ON CONFLICT against the partial
-- unique index check_ins_one_success_per_registration. Two simultaneous
-- scans can never both insert a successful check-in.
-- Result statuses: success | already_checked_in | registration_not_found |
--                  invalid_ticket | forbidden | error
-- ----------------------------------------------------------------------------

create or replace function public.perform_check_in(
  p_ticket_token text,
  p_device_identifier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_ci_id uuid;
  v_scanned_at timestamptz;
begin
  if not public.is_staff() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select *
    into v_reg
    from public.registrations r
   where r.ticket_token = btrim(coalesce(p_ticket_token, ''));

  if v_reg.id is null then
    return jsonb_build_object('status', 'registration_not_found');
  end if;

  if v_reg.status <> 'registered' then
    return jsonb_build_object(
      'status', 'invalid_ticket',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name)
    );
  end if;

  begin
    insert into public.check_ins (registration_id, scanned_by, device_identifier, status)
    values (v_reg.id, auth.uid(), nullif(btrim(coalesce(p_device_identifier, '')), ''), 'success')
    on conflict (registration_id) where status = 'success'
    do nothing
    returning id, scanned_at into v_ci_id, v_scanned_at;

    if v_ci_id is not null then
      return jsonb_build_object(
        'status', 'success',
        'registration_number', v_reg.registration_number,
        'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
        'checked_in_at', v_scanned_at
      );
    end if;

    -- Conflict lost the race: report the original check-in truthfully.
    select c.scanned_at
      into v_scanned_at
      from public.check_ins c
     where c.registration_id = v_reg.id
       and c.status = 'success';

    return jsonb_build_object(
      'status', 'already_checked_in',
      'registration_number', v_reg.registration_number,
      'applicant_name', concat_ws(' ', v_reg.first_name, v_reg.last_name),
      'checked_in_at', v_scanned_at
    );
  exception
    when others then
      return jsonb_build_object(
        'status', 'error',
        'message', 'CHECK-IN COULD NOT BE COMPLETED'
      );
  end;
end;
$$;

-- ----------------------------------------------------------------------------
-- staff_lookup — minimum-necessary authorized lookup (reg #, token, name, email).
-- ----------------------------------------------------------------------------

create or replace function public.staff_lookup(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text;
  v_rows jsonb;
begin
  if not public.is_staff() then
    return jsonb_build_object('status', 'forbidden', 'results', '[]'::jsonb);
  end if;

  v_q := btrim(coalesce(p_query, ''));
  if v_q = '' then
    return jsonb_build_object('status', 'ok', 'results', '[]'::jsonb);
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'registration_number', r.registration_number,
      'applicant_name', concat_ws(' ', r.first_name, r.last_name),
      'email', r.email,
      'event_name', e.name,
      'registration_status', r.status,
      'checked_in_at', c.scanned_at
    )),
    '[]'::jsonb
  )
    into v_rows
    from public.registrations r
    join public.events e on e.id = r.event_id
    left join public.check_ins c
      on c.registration_id = r.id and c.status = 'success'
   where r.ticket_token = v_q
      or r.registration_number = upper(v_q)
      or r.email = lower(v_q)
      or concat_ws(' ', r.first_name, r.last_name) ilike '%' || v_q || '%'
   limit 20;

  return jsonb_build_object('status', 'ok', 'results', v_rows);
end;
$$;

-- ----------------------------------------------------------------------------
-- Execution privileges
-- ----------------------------------------------------------------------------

revoke execute on function public.register_applicant(uuid, uuid, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.register_applicant(uuid, uuid, text, text, text, text, text, text, jsonb) to anon, authenticated;

revoke execute on function public.retrieve_ticket(text, text) from public;
grant execute on function public.retrieve_ticket(text, text) to anon, authenticated;

revoke execute on function public.perform_check_in(text, text) from public;
revoke execute on function public.perform_check_in(text, text) from anon;
grant execute on function public.perform_check_in(text, text) to authenticated;

revoke execute on function public.staff_lookup(text) from public;
revoke execute on function public.staff_lookup(text) from anon;
grant execute on function public.staff_lookup(text) to authenticated;
