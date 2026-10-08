-- =============================================================================
-- Professionnels: a disabled account's sessions end, whatever disables it; the account status the
-- sign-in ban follows
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4b.6 (P4-380, P4-381); P3-32
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * P3-32: set_user_status (« Utilisateurs ») and private.set_provider_account_status (4a.4, the
--   deactivation « Fin de collaboration ») delete the person's auth.sessions when they disable a
--   profile; their refresh tokens and MFA claims cascade. A profile disabled any other way (a fix
--   by hand in the SQL editor, a later RPC that forgets the delete) kept its sessions: data stayed
--   closed (every policy needs an active profile), but the Auth session lived on and its refresh
--   token kept minting access tokens. The trigger profiles_end_sessions_on_disable closes that
--   gap for every account, provider or staff (P4-380): an update that turns a profile's status to
--   'disabled' deletes the user's sessions in the same transaction. The two functions keep their
--   own delete: a repeated « Désactiver » still ends a session left behind, and neither depends on
--   this trigger. An access token already issued lives until it expires (an hour at most), with
--   no data behind it.
-- * The trigger function is definer, owned by the migration role, which may delete from
--   auth.sessions (P3-32; 057 checks it); no API role may call it.
-- * New sign-ins are refused by the Auth ban, which only an edge function can set:
--   users-set-status (core) and professionals-set-status (4b.6). The latter reads the account
--   through get_professional_account_status for « Réessayer » (P4-381): the ban follows the
--   account's status ('disabled' → banned, 'active' → not), for a provider account linked to a
--   professional of the caller's clinic only, with professionals.manage.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_account_sessions', true);

-- -----------------------------------------------------------------------------
-- Any disable ends the sessions (P4-380)
-- -----------------------------------------------------------------------------
create function private.end_sessions_of_disabled_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Refresh tokens and MFA claims cascade from their session.
  delete from auth.sessions s where s.user_id = new.user_id;
  return null;
end;
$$;
revoke all on function private.end_sessions_of_disabled_profile() from public, anon, authenticated, service_role;

create trigger profiles_end_sessions_on_disable
  after update of status on public.profiles
  for each row when (new.status = 'disabled' and old.status is distinct from 'disabled')
  execute function private.end_sessions_of_disabled_profile();

-- -----------------------------------------------------------------------------
-- The account the ban follows (professionals-set-status, « Réessayer », P4-381)
-- -----------------------------------------------------------------------------
-- The provider account linked to a professional of the caller's clinic and its status ('active'
-- or 'disabled'). No row when the file has no account, or when the linked profile does not hold
-- the role provider (the module never bans a staff account). professionals.manage, as the status
-- RPCs.
create function public.get_professional_account_status(p_id uuid)
returns table (profile_id uuid, account_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  return query
    select pr.user_id, pr.status
      from public.professionals p
      join public.profiles pr on pr.user_id = p.profile_id and pr.org_id = p.org_id
     where p.id = p_id and p.org_id = v_org
       and exists (select 1 from public.user_roles r where r.user_id = pr.user_id and r.role = 'provider');
end;
$$;
revoke all on function public.get_professional_account_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_professional_account_status(uuid) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
