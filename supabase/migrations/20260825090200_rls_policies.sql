-- ============================================================================
-- Migration 003 — Row Level Security (mvp_scope.md §5/§14)
--
-- Design notes:
-- * RLS is ENABLED on every table. No table relies on disabled RLS.
-- * registrations/check_ins have NO anonymous policies: all public access
--   flows through SECURITY DEFINER RPCs (register_applicant,
--   retrieve_ticket), so anon can neither list nor read arbitrary records.
-- * Staff never touch tables directly for scanning; they call
--   perform_check_in()/staff_lookup(). Direct table access stays admin-only.
-- * profiles policies use my_role()/is_admin() (SECURITY DEFINER) to avoid
--   recursive self-referencing policy evaluation.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.forms enable row level security;
alter table public.form_fields enable row level security;
alter table public.registrations enable row level security;
alter table public.check_ins enable row level security;

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- events — drafts are admin-only; published/closed/archived are public read
-- (needed by form page context and ticket display).
-- ----------------------------------------------------------------------------

create policy "events_read_public"
  on public.events
  for select
  using (status in ('published', 'closed', 'archived'));

create policy "events_manage_admin"
  on public.events
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- forms / form_fields — publicly readable only while the form is published.
-- All writes are admin-only.
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- registrations — NO anonymous/authenticated-staff policies exist.
-- Public writes go through register_applicant(); verified reads through
-- retrieve_ticket(); admin gets full access explicitly.
-- ----------------------------------------------------------------------------

create policy "registrations_admin_all"
  on public.registrations
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- check_ins — inserts happen exclusively inside perform_check_in()
-- (SECURITY DEFINER). Reads/writes otherwise admin-only.
-- ----------------------------------------------------------------------------

create policy "check_ins_admin_all"
  on public.check_ins
  for all
  using (public.is_admin())
  with check (public.is_admin());
