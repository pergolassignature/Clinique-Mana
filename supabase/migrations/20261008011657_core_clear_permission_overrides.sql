-- =============================================================================
-- « Rétablir les permissions du rôle »: remove all of a user's overrides at once
-- =============================================================================
-- Decision #39: the user sheet shows one switch per permission and a button that
-- puts the person back on their role's defaults. One atomic call, with the guards
-- of clear_permission_override (20261007211509_core_user_admin.sql):
-- * private.assert_can_manage_user: users.manage, not one's own account, same org,
--   only an admin changes an admin; it locks the target's profile, so no override
--   can be written for them between the check and the delete;
-- * clearing a revoke can give the permission back through the role default, so a
--   non-admin manager is refused, as a whole, if any revoke is on a permission they
--   lack (same message as the single clear). Removing a grant gives nothing.
-- Each deleted row is audited by user_permission_overrides_audit.
-- =============================================================================

create function public.clear_permission_overrides(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed int;
begin
  perform private.assert_can_manage_user(p_user_id);
  if not private.has_role('admin') and exists (
    select 1 from public.user_permission_overrides o
     where o.user_id = p_user_id
       and not o.granted
       and not private.has_permission(o.permission_key)
  ) then
    raise exception 'Vous ne pouvez pas accorder une permission que vous n''avez pas.' using errcode = 'P0001';
  end if;
  delete from public.user_permission_overrides o where o.user_id = p_user_id;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.clear_permission_overrides(uuid) from public, anon, authenticated, service_role;
grant execute on function public.clear_permission_overrides(uuid) to authenticated;
-- service_role is revoked (Supabase's default privileges grant it EXECUTE): the
-- function acts for the calling user (auth.uid()), which a service-role caller lacks.
