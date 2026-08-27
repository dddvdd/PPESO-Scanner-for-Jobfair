-- ============================================================================
-- db_set-up_schema.sql — FIRST-TIME PRODUCTION SET-UP (fresh project)
-- Job Fair Registration & QR Check-In System (MVP, see mvp_scope.md)
--
-- Single consolidated script representing the FINAL state of every migration
-- in supabase/migrations/ (001–006), flattened into correct dependency order:
--
--   §1  Extensions
--   §2  Enumerated domain types
--   §3  Tables, sequence, indexes, integrity constraints
--   §4  updated_at maintenance triggers + auth.users profile bootstrap
--   §5  Role helper functions (is_admin / is_staff / my_role)
--   §6  RPC API (register_applicant, retrieve_ticket, perform_check_in,
--       staff_lookup) — final bodies, incl. email-only ticket retrieval and
--       register_applicant search-path fix for pgcrypto in "extensions"
--   §7  Row Level Security policies
--   §8  Privileges: EXECUTE grants/revokes + client table-privilege hardening
--
-- USAGE (empty production database, run once as postgres/service role):
--   psql "$SUPABASE_DB_URL" -f supabase/db_set-up_schema.sql
--
-- supabase/migrations/ remains the source of truth for existing projects;
-- do NOT run this script against a database already migrated.
-- ============================================================================

-- ============================================================================
-- §1 EXTENSIONS
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- §2 ENUMERATED DOMAIN TYPES
-- ============================================================================

create type public.event_status as enum ('draft', 'published', 'closed', 'archived');

create type public.form_status as enum ('draft', 'published', 'closed');

create type public.field_type as enum (
  'short_text',
  'long_text',
  'number',
  'date',
  'dropdown',
  'radio',
  'checkbox',
  'multi_select',
  'yes_no'
);

create type public.registration_status as enum ('registered', 'cancelled');

create type public.check_in_status as enum ('success', 'voided');

-- ============================================================================
-- §3 TABLES, SEQUENCE, INDEXES, INTEGRITY CONSTRAINTS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles — extends Supabase Auth users with an application role.
-- New sign-ups start as 'pending' (no permissions) and MUST be promoted to
-- 'staff' or 'admin' by an existing admin via SQL. Keep public sign-ups
-- disabled in Supabase Auth settings (see README.md).
-- ----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'pending' check (role in ('admin', 'staff', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- events
-- ----------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  event_date date,
  location text,
  status public.event_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- forms — belongs to exactly one event.
-- The composite UNIQUE (event_id, id) lets registrations carry a composite FK
-- so a registration can never pair an event with another event's form.
-- ----------------------------------------------------------------------------

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  description text,
  status public.form_status not null default 'draft',
  version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, id)
);

-- ----------------------------------------------------------------------------
-- form_fields — dynamic form builder configuration stored in the database.
-- Choice-type fields (dropdown, radio, multi_select) must declare options.
-- ----------------------------------------------------------------------------

create table public.form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type public.field_type not null,
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  validation_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint form_fields_form_field_key_key unique (form_id, field_key),

  constraint form_fields_options_required check (
    field_type not in ('dropdown', 'radio', 'multi_select')
    or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) > 0)
  )
);

-- ----------------------------------------------------------------------------
-- registrations
-- ticket_token is an opaque bearer token; it is the ONLY value encoded in QR.
-- registration_number is human-facing and sequential — never used for auth.
-- ----------------------------------------------------------------------------

create sequence public.registration_number_seq start 1;

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  form_id uuid not null,
  registration_number text not null unique,
  ticket_token text not null unique,
  first_name text not null,
  middle_name text,
  last_name text not null,
  suffix text,
  email text not null,
  mobile_number text not null,
  form_data jsonb not null default '{}'::jsonb,
  status public.registration_status not null default 'registered',
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A registration may only reference a form that belongs to its own event.
  constraint registrations_event_form_pairing foreign key (event_id, form_id)
    references public.forms (event_id, id) on delete restrict
);

-- Duplicate prevention: one registration per email per event.
create unique index registrations_event_email_key
  on public.registrations (event_id, lower(email));

create index registrations_event_idx on public.registrations (event_id);
create index registrations_registered_at_idx on public.registrations (registered_at desc);

-- ----------------------------------------------------------------------------
-- check_ins
-- Database-authoritative duplicate protection: at most ONE successful
-- check-in per registration via a partial unique index.
-- ----------------------------------------------------------------------------

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  scanned_by uuid references auth.users (id) on delete set null,
  scanned_at timestamptz not null default now(),
  device_identifier text,
  status public.check_in_status not null default 'success'
);

create unique index check_ins_one_success_per_registration
  on public.check_ins (registration_id)
  where status = 'success';

create index check_ins_registration_idx on public.check_ins (registration_id);

create index forms_event_idx on public.forms (event_id);
create index form_fields_form_sort_idx on public.form_fields (form_id, sort_order);

-- ============================================================================
-- §4 TRIGGERS: updated_at MAINTENANCE + AUTH.USER PROFILE BOOTSTRAP
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.events
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.forms
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.form_fields
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.registrations
  for each row execute function public.set_updated_at();

-- Auto-create a 'pending' profile whenever an auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================================
-- §5 ROLE HELPER FUNCTIONS
-- SECURITY DEFINER so RLS policies can consult profiles without recursive
-- policy evaluation.
-- ============================================================================

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

-- ============================================================================
-- §6 RPC API (database-authoritative)
-- All functions are SECURITY DEFINER with pinned search_path.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- register_applicant — called by anonymous users through Supabase JS.
-- Error contract (stable uppercase tokens):
--   FORM_NOT_FOUND | FORM_NOT_PUBLISHED | EVENT_NOT_PUBLISHED
--   MISSING_REQUIRED_FIELD:<key> | INVALID_NUMBER:<key> | INVALID_DATE:<key>
--   INVALID_EMAIL | INVALID_MOBILE | INVALID_CHOICE:<key>
--   DUPLICATE_REGISTRATION | REGISTRATION_FAILED
-- Returns { registration_id, registration_number, ticket_token }.
-- The raw ticket_token is returned exactly once here and via verified
-- retrieval only.
-- search_path includes "extensions" because pgcrypto's gen_random_bytes is
-- installed there on Supabase (migration 004 fix).
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
set search_path = public, extensions
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

  -- Duplicate handling: friendly duplicate signal, never a rate-limit style
  -- rejection.
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
-- retrieve_ticket — Registration Number (optional) + verification email.
-- Business rule (Sept 11 MVP): one email per event identifies the jobseeker,
-- so applicants may retrieve their ticket with ONLY their email address.
--   p_registration_number EMPTY  -> newest registration for the verified email
--   p_registration_number GIVEN  -> number + email (backwards compatible)
-- One generic failure token prevents enumeration: any miss raises the
-- identical TICKET_NOT_FOUND signal regardless of which condition failed.
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
begin
  select r.id,
         r.registration_number,
         r.ticket_token,
         r.first_name,
         r.middle_name,
         r.last_name,
         r.suffix,
         r.email,
         r.status,
         r.registered_at,
         e.name        as event_name,
         e.event_date  as event_date,
         e.location    as location,
         c.scanned_at  as checked_in_at
    into v_row
    from public.registrations r
    join public.events e on e.id = r.event_id
    left join public.check_ins c
      on c.registration_id = r.id and c.status = 'success'
   where (
          (btrim(coalesce(p_registration_number, '')) = ''
             and r.email = lower(btrim(p_verification_email)))
       or
          (btrim(coalesce(p_registration_number, '')) <> ''
             and r.registration_number = upper(btrim(p_registration_number))
             and r.email = lower(btrim(p_verification_email)))
         )
   order by greatest(coalesce(c.scanned_at, timestamptz '-infinity'),
                     r.registered_at) desc
   limit 1;

  if v_row.id is null then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'registration_number', v_row.registration_number,
    'ticket_token',        v_row.ticket_token,
    'first_name',          v_row.first_name,
    'middle_name',         v_row.middle_name,
    'last_name',           v_row.last_name,
    'suffix',              v_row.suffix,
    'email',               v_row.email,
    'event_name',          v_row.event_name,
    'event_date',          v_row.event_date,
    'location',            v_row.location,
    'registration_status', v_row.status,
    'registered_at',       v_row.registered_at,
    'checked_in_at',       v_row.checked_in_at
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- perform_check_in — THE atomic operation.
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

-- ============================================================================
-- §7 ROW LEVEL SECURITY
-- Design notes:
-- * RLS is ENABLED on every table.
-- * registrations/check_ins have NO anonymous policies: all public access
--   flows through SECURITY DEFINER RPCs, so anon can neither list nor read
--   arbitrary records.
-- * Staff never touch tables directly for scanning; they call
--   perform_check_in()/staff_lookup(). Direct table access stays admin-only.
-- * profiles policies use my_role()/is_admin() to avoid recursive
--   self-referencing policy evaluation.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.forms enable row level security;
alter table public.form_fields enable row level security;
alter table public.registrations enable row level security;
alter table public.check_ins enable row level security;

-- profiles ------------------------------------------------------------------

create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = public.my_role());

create policy "profiles_select_admin"
  on public.profiles
  for select
  using (public.is_admin());

create policy "profiles_manage_admin"
  on public.profiles
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- events — drafts are admin-only; published/closed/archived are public read --

create policy "events_read_public"
  on public.events
  for select
  using (status in ('published', 'closed', 'archived'));

create policy "events_manage_admin"
  on public.events
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- forms / form_fields — publicly readable only while published; writes admin -

create policy "forms_read_published"
  on public.forms
  for select
  using (status = 'published');

create policy "forms_manage_admin"
  on public.forms
  for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "form_fields_read_published"
  on public.form_fields
  for select
  using (
    exists (
      select 1
      from public.forms f
      where f.id = form_id
        and f.status = 'published'
    )
  );

create policy "form_fields_manage_admin"
  on public.form_fields
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- registrations — admin-only direct access -----------------------------------

create policy "registrations_admin_all"
  on public.registrations
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- check_ins — inserts happen exclusively inside perform_check_in() ----------

create policy "check_ins_admin_all"
  on public.check_ins
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- §8 PRIVILEGES
-- ============================================================================

-- RPC execution --------------------------------------------------------------

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

-- Client table-privilege hardening (P0 audit finding F1) ---------------------
-- Supabase default grants give anon/authenticated more than the HTTP API can
-- use. RLS is the boundary for row DML/SELECT, but TRUNCATE bypasses RLS and
-- REFERENCES/TRIGGER have no legitimate client use. Row DML grants stay
-- unchanged; privileged server-side roles are untouched.

revoke truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
