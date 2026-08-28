-- ============================================================================
-- Migration 016 — Admin: delete a staff/admin Auth account completely.
--
-- The old Admin console only deleted the public.profiles row, leaving the
-- auth.users + auth.identities rows orphaned (which is exactly how the
-- broken test accounts accumulated). This RPC deletes the full Auth account
-- the supported way: it removes the child rows first, then the auth.users row,
-- relying on the existing FK cascade (profiles -> auth.users,
-- identities -> auth.users) rather than adding any new destructive cascade.
--
-- Security:
--   * SECURITY DEFINER + fixed search_path (postgres-owned).
--   * Hard admin-only guard via is_admin() (caller's JWT identity).
--   * Granted to authenticated only (never anon / public).
-- ============================================================================

create or replace function public.admin_delete_user(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = lower(btrim(p_email));

  if v_user_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Children first, then the Auth user (FK cascade handles the rest).
  delete from auth.identities where user_id = v_user_id;
  delete from public.profiles where id = v_user_id;
  delete from auth.users where id = v_user_id;

  return jsonb_build_object('status', 'ok', 'user_id', v_user_id, 'email', lower(btrim(p_email)));
end;
$$;

revoke execute on function public.admin_delete_user(text) from public;
revoke execute on function public.admin_delete_user(text) from anon;
grant execute on function public.admin_delete_user(text) to authenticated;
