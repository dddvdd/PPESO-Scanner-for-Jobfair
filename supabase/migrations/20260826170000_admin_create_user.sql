-- ============================================================================
-- Migration 011 — Admin: create auth users with a proper bcrypt password
--
-- Lets an admin create staff/admin accounts directly from the Admin console
-- (email + password + role) without touching the Supabase Dashboard. The
-- password is hashed with crypt()/gen_salt('bf'), exactly like GoTrue does,
-- so the new account logs in cleanly (no 500 from a malformed hash).
--
-- Security:
--   * SECURITY DEFINER + fixed search_path (postgres-owned, not caller).
--   * Hard admin-only guard via is_admin() (caller's JWT identity).
--   * Granted to authenticated only (never anon / public).
--   * The on_auth_user_created trigger creates the profiles row; we then
--     set its role.
-- ============================================================================

create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_role text default 'staff'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_instance_id uuid;
  v_user_id uuid;
  v_valid_roles text[] := array['admin', 'staff', 'supervisor', 'pending'];
begin
  if not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if not (p_role = any(v_valid_roles)) then
    return jsonb_build_object('status', 'invalid_role');
  end if;

  if p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('status', 'invalid_email');
  end if;

  if length(p_password) < 8 then
    return jsonb_build_object('status', 'weak_password');
  end if;

  select instance_id
    into v_instance_id
    from auth.users
   where instance_id is not null
   limit 1;

  insert into auth.users (
    instance_id,
    id,
    email,
    encrypted_password,
    email_confirmed_at,
    is_sso_user,
    aud,
    role,
    raw_app_meta_data,
    created_at,
    updated_at
  ) values (
    v_instance_id,
    gen_random_uuid(),
    lower(btrim(p_email)),
    crypt(p_password, gen_salt('bf')),
    now(),
    false,
    'authenticated',
    'authenticated',
    '{"provider":"email","providers":["email"]}'::jsonb,
    now(),
    now()
  )
  returning id into v_user_id;

  update public.profiles
     set role = p_role
   where id = v_user_id;

  return jsonb_build_object(
    'status', 'ok',
    'user_id', v_user_id,
    'email', lower(btrim(p_email)),
    'role', p_role
  );

exception
  when unique_violation then
    return jsonb_build_object('status', 'email_taken');
  when others then
    return jsonb_build_object('status', 'error', 'message', sqlerrm);
end;
$$;

-- Execution privileges: authenticated admins only.
revoke execute on function public.admin_create_user(text, text, text) from public;
revoke execute on function public.admin_create_user(text, text, text) from anon;
grant execute on function public.admin_create_user(text, text, text) to authenticated;
