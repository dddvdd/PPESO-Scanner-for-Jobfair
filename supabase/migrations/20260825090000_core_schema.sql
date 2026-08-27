-- ============================================================================
-- Migration 001 — Core schema
-- Job Fair Registration & QR Check-In System (MVP, see mvp_scope.md §5)
--
-- Tables: profiles, events, forms, form_fields, registrations, check_ins
-- Integrity: PK/FK relationships, unique registration number, unique ticket
-- token, duplicate-registration guard, one-successful-check-in-per-registration
-- (partial unique index), composite FK guaranteeing form belongs to event.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Enumerated domain types
-- ----------------------------------------------------------------------------

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
-- events (mvp_scope.md §5)
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
-- registrations (mvp_scope.md §5)
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

-- Duplicate prevention: one registration per email per event (mvp_scope.md §6/§15).
create unique index registrations_event_email_key
  on public.registrations (event_id, lower(email));

create index registrations_event_idx on public.registrations (event_id);
create index registrations_registered_at_idx on public.registrations (registered_at desc);

-- ----------------------------------------------------------------------------
-- check_ins (mvp_scope.md §5/§11)
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

-- ----------------------------------------------------------------------------
-- updated_at maintenance triggers
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- Auto-create a 'pending' profile whenever an auth user is created.
-- ----------------------------------------------------------------------------

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
