-- ============================================================================
-- Migration 012 — Expose auth email on the admin profile list
--
-- The client cannot read auth.users directly (RLS), so admins need an RPC that
-- joins profiles -> auth.users and returns email alongside the role. SECURITY
-- DEFINER + admin-only guard (is_admin) keeps it safe; granted to authenticated.
-- ============================================================================

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
