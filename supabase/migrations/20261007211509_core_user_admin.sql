-- =============================================================================
-- User administration: list, role, status, permission overrides
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §3.5 (decision #28)
-- Guards (French P0001 messages):
-- * nobody changes their own role, status or overrides;
-- * the provider role is owned by the Professionnels module;
-- * only an admin changes an admin, makes someone admin, or re-enables an account;
-- * a non-admin manager never gives what they do not hold: no override grant,
--   no role, and no cleared revoke carrying a permission they lack;
-- * no overrides on admins (they already hold every permission): table triggers,
--   any write path; becoming admin deletes the user's overrides;
-- * every org keeps at least one active admin (triggers, any write path).
-- Locks on organizations use FOR NO KEY UPDATE (conventions §6): it serializes
-- writers without blocking the FK key-share checks of inserts that reference the org.
-- set_module_enabled (Phase 1, on staging) is re-created only to adopt that lock mode.
-- Invitations come after Phase 3 (decision #22).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- At least one active admin per org
-- -----------------------------------------------------------------------------
create function private.ensure_active_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Updates that change nothing relevant: no check, no lock. (Nested IFs: NEW has
  -- different columns on each table, so the field tests must not share an expression.)
  if tg_op = 'UPDATE' then
    if tg_table_name = 'user_roles' then
      if new.role = old.role and new.user_id = old.user_id and new.org_id = old.org_id then
        return null;
      end if;
    elsif new.status = old.status and new.user_id = old.user_id and new.org_id = old.org_id then
      return null;
    end if;
  end if;

  -- profiles: only an admin's status change, move or deletion matters.
  if tg_table_name = 'profiles'
     and not exists (select 1 from public.user_roles r where r.user_id = old.user_id and r.role = 'admin') then
    return null;
  end if;

  -- Serialize admin changes per org: two transactions demoting or disabling the
  -- last two admins would each still see the other one. This relies on READ
  -- COMMITTED (the PostgREST default): after the lock, the check below runs with
  -- a new snapshot and sees the transaction that committed first.
  perform 1 from public.organizations o where o.id = old.org_id for no key update;

  if not exists (
    select 1
      from public.user_roles r
      join public.profiles p on p.user_id = r.user_id
     where r.org_id = old.org_id
       and r.role = 'admin'
       and p.status = 'active'
  ) then
    raise exception 'La clinique doit garder au moins un administrateur actif.' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

-- AFTER ROW triggers run at the end of the statement, so they see its final state
-- (a multi-row demotion is checked as a whole). Any update fires them, so moving
-- user_id or org_id is covered; the function skips irrelevant updates.
create trigger user_roles_keep_active_admin
  after update or delete on public.user_roles
  for each row when (old.role = 'admin')
  execute function private.ensure_active_admin();

create trigger profiles_keep_active_admin
  after update or delete on public.profiles
  for each row when (old.status = 'active')
  execute function private.ensure_active_admin();

-- -----------------------------------------------------------------------------
-- No permission overrides on admins
-- -----------------------------------------------------------------------------
create function private.reject_admin_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.user_roles r where r.user_id = new.user_id and r.role = 'admin') then
    raise exception 'Un administrateur a déjà toutes les permissions.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger user_permission_overrides_reject_admin
  before insert or update on public.user_permission_overrides
  for each row execute function private.reject_admin_override();

-- Becoming admin (any write path: RPC, bootstrap script, SQL) deletes the user's
-- overrides; the deletions are audited by user_permission_overrides_audit.
create function private.clear_overrides_of_new_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_permission_overrides o where o.user_id = new.user_id;
  return null;
end;
$$;

create trigger user_roles_clear_admin_overrides
  after insert or update on public.user_roles
  for each row when (new.role = 'admin')
  execute function private.clear_overrides_of_new_admin();

revoke all on function
  private.ensure_active_admin(),
  private.reject_admin_override(),
  private.clear_overrides_of_new_admin()
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Shared checks for the write RPCs
-- -----------------------------------------------------------------------------
-- Raises unless the caller may manage the target; returns the target's current role
-- (may be null). Locks the target's profile until the end of the transaction, so the
-- role and status read here cannot change before the RPC writes. FOR NO KEY UPDATE
-- leaves the FK key-share checks of user_roles / overrides unblocked.
create function private.assert_can_manage_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not private.has_permission('users.manage') then
    raise exception 'Permission refusée : users.manage' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Vous ne pouvez pas modifier votre propre compte ici. Passez par « Mon compte ».' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles p
   where p.user_id = p_user_id and p.org_id = private.current_user_org_id()
     for no key update;
  if not found then
    raise exception 'Utilisateur introuvable.' using errcode = 'P0001';
  end if;
  select r.role into v_role from public.user_roles r where r.user_id = p_user_id;
  if v_role = 'admin' and not private.has_role('admin') then
    raise exception 'Seul un administrateur peut modifier un administrateur.' using errcode = 'P0001';
  end if;
  return v_role;
end;
$$;

revoke all on function private.assert_can_manage_user(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
create function public.list_org_users()
returns table (
  user_id uuid,
  display_name text,
  email text,
  status text,
  role text,
  role_name text,
  last_sign_in_at timestamptz,
  override_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.has_permission('users.view') then
    raise exception 'Permission refusée : users.view' using errcode = '42501';
  end if;
  return query
    select p.user_id, p.display_name, p.email, p.status, r.role, ro.name, u.last_sign_in_at,
           (select count(*)::int from public.user_permission_overrides o where o.user_id = p.user_id)
      from public.profiles p
      left join public.user_roles r on r.user_id = p.user_id
      left join public.roles ro on ro.key = r.role
      left join auth.users u on u.id = p.user_id
     where p.org_id = private.current_user_org_id()
     order by (p.status = 'disabled'), pg_catalog.lower(p.display_name), p.user_id;
end;
$$;

create function public.set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text := private.assert_can_manage_user(p_user_id);
begin
  if p_role is null or not exists (select 1 from public.roles ro where ro.key = p_role) then
    raise exception 'Rôle inconnu : %', p_role using errcode = '22023';
  end if;
  if p_role = 'provider' or v_current = 'provider' then
    raise exception 'Le rôle Professionnel se gère dans le module Professionnels.' using errcode = 'P0001';
  end if;
  if p_role = 'admin' and not private.has_role('admin') then
    raise exception 'Seul un administrateur peut modifier un administrateur.' using errcode = 'P0001';
  end if;
  if not private.has_role('admin') and exists (
    select 1 from public.role_permissions rp
     where rp.role = p_role and not private.has_permission(rp.permission_key)
  ) then
    raise exception 'Vous ne pouvez pas attribuer un rôle qui donne des permissions que vous n''avez pas.' using errcode = 'P0001';
  end if;

  -- Becoming admin deletes the user's overrides (trigger user_roles_clear_admin_overrides).
  insert into public.user_roles (user_id, org_id, role)
  values (p_user_id, private.current_user_org_id(), p_role)
  on conflict (user_id) do update set role = excluded.role
   where public.user_roles.role is distinct from excluded.role;
end;
$$;

-- Non-admin managers may disable a non-admin; only an admin re-enables an account.
create function public.set_user_status(p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage_user(p_user_id);
  if p_status is null or p_status not in ('active', 'disabled') then
    raise exception 'Statut inconnu : %', p_status using errcode = '22023';
  end if;
  if p_status = 'active' and not private.has_role('admin') then
    raise exception 'Seul un administrateur peut réactiver un compte.' using errcode = 'P0001';
  end if;
  update public.profiles p set status = p_status
   where p.user_id = p_user_id and p.status is distinct from p_status;
end;
$$;

create function public.set_permission_override(p_user_id uuid, p_permission_key text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.assert_can_manage_user(p_user_id);
begin
  if p_granted is null then
    raise exception 'Valeur manquante' using errcode = '22023';
  end if;
  if not exists (select 1 from public.permissions pm where pm.key = p_permission_key) then
    raise exception 'Permission inconnue : %', p_permission_key using errcode = '22023';
  end if;
  -- Also enforced by user_permission_overrides_reject_admin; checked here first for the message order.
  if v_role = 'admin' then
    raise exception 'Un administrateur a déjà toutes les permissions.' using errcode = 'P0001';
  end if;
  if p_granted and not private.has_role('admin') and not private.has_permission(p_permission_key) then
    raise exception 'Vous ne pouvez pas accorder une permission que vous n''avez pas.' using errcode = 'P0001';
  end if;

  insert into public.user_permission_overrides (user_id, org_id, permission_key, granted, created_by)
  values (p_user_id, private.current_user_org_id(), p_permission_key, p_granted, auth.uid())
  on conflict (user_id, permission_key) do update
    set granted = excluded.granted, created_by = excluded.created_by
   where public.user_permission_overrides.granted is distinct from excluded.granted;
end;
$$;

-- Clearing a revoke can give the permission back (through the role default), so a
-- non-admin manager may only clear a revoke on a permission they hold.
create function public.clear_permission_override(p_user_id uuid, p_permission_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage_user(p_user_id);
  if not private.has_role('admin')
     and exists (
       select 1 from public.user_permission_overrides o
        where o.user_id = p_user_id and o.permission_key = p_permission_key and not o.granted
     )
     and not private.has_permission(p_permission_key) then
    raise exception 'Vous ne pouvez pas accorder une permission que vous n''avez pas.' using errcode = 'P0001';
  end if;
  delete from public.user_permission_overrides o
   where o.user_id = p_user_id and o.permission_key = p_permission_key;
end;
$$;

revoke all on function
  public.list_org_users(),
  public.set_user_role(uuid, text),
  public.set_user_status(uuid, text),
  public.set_permission_override(uuid, text, boolean),
  public.clear_permission_override(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function
  public.list_org_users(),
  public.set_user_role(uuid, text),
  public.set_user_status(uuid, text),
  public.set_permission_override(uuid, text, boolean),
  public.clear_permission_override(uuid, text)
to authenticated;
-- service_role is revoked above (Supabase's default privileges grant it EXECUTE):
-- these act for the calling user (auth.uid()), which a service-role caller lacks.

-- -----------------------------------------------------------------------------
-- Phase 1 RPC re-created for the lock mode only (FOR UPDATE → FOR NO KEY UPDATE).
-- Same signature, body and grants (create or replace keeps the grants).
-- -----------------------------------------------------------------------------
create or replace function public.set_module_enabled(p_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_blockers text[];
begin
  if not private.has_permission('modules.manage') then
    raise exception 'Permission refusée : modules.manage' using errcode = '42501';
  end if;

  -- Serialize toggles per org so two concurrent calls cannot break a dependency (I10).
  perform 1 from public.organizations o where o.id = v_org for no key update;

  if not exists (select 1 from public.modules m where m.key = p_key) then
    raise exception 'Module inconnu : %', p_key using errcode = '22023';
  end if;
  if p_key = 'core' then
    raise exception 'Le module core est toujours actif' using errcode = '22023';
  end if;

  if p_enabled then
    -- Every dependency must already be enabled (core is implicit, never listed).
    -- The message is user-facing (P0001), so it lists module names, not keys.
    select array_agg(m.name order by m.name)
      into v_blockers
      from public.module_dependencies d
      join public.modules m on m.key = d.depends_on
     where d.module_key = p_key
       and not exists (
         select 1 from public.org_modules om
          where om.org_id = v_org and om.module_key = d.depends_on and om.enabled);
    if v_blockers is not null then
      raise exception 'Activez d''abord : %', array_to_string(v_blockers, ', ') using errcode = 'P0001';
    end if;
  else
    -- No enabled module may depend on this one (names, as above).
    select array_agg(m.name order by m.name)
      into v_blockers
      from public.module_dependencies d
      join public.org_modules om
        on om.org_id = v_org and om.module_key = d.module_key and om.enabled
      join public.modules m on m.key = d.module_key
     where d.depends_on = p_key;
    if v_blockers is not null then
      raise exception 'Désactivez d''abord : %', array_to_string(v_blockers, ', ') using errcode = 'P0001';
    end if;
  end if;

  insert into public.org_modules (org_id, module_key, enabled, updated_at, updated_by)
  values (v_org, p_key, p_enabled, now(), auth.uid())
  on conflict (org_id, module_key) do update
    set enabled = excluded.enabled,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
end;
$$;
