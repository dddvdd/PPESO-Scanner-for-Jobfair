-- ============================================================================
-- Migration 013 — Admin: set a user's password
--
-- Lets an admin reset/set a staff or admin password directly from the Admin
-- console. Hashes with crypt()/gen_salt('bf') exactly like GoTrue, so the new
-- password logs in cleanly. SECURITY DEFINER + admin-only guard (is_admin).
-- ============================================================================

create or replace function public.admin_set_password(
  p_email text,
  p_new_password text
)
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

  if p_new_password is null or length(p_new_password) < 8 then
    return jsonb_build_object('status', 'weak_password');
  end if;

  select id
    into v_user_id
    from auth.users
   where lower(email) = lower(btrim(p_email));

  if v_user_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  update auth.users
     set encrypted_password = crypt(p_new_password, gen_salt('bf')),
         updated_at = now()
   where id = v_user_id;

  return jsonb_build_object('status', 'ok', 'email', lower(btrim(p_email)));

exception
  when others then
    return jsonb_build_object('status', 'error', 'message', sqlerrm);
end;
$$;

revoke execute on function public.admin_set_password(text, text) from public;
revoke execute on function public.admin_set_password(text, text) from anon;
grant execute on function public.admin_set_password(text, text) to authenticated;
