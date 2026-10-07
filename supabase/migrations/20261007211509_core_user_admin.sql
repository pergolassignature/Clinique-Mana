-- =============================================================================
-- User administration: list, role, status, permission overrides
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §3.5 (decision #28)
-- Guards (French P0001 messages):
-- * nobody changes their own role, status or overrides;
-- * the provider role is owned by the Professionnels module;
-- * only an admin changes an admin, or makes someone admin;
-- * a non-admin manager only grants permissions they hold;
-- * no overrides on admins (they already hold every permission);
-- * every org keeps at least one active admin (trigger, any write path).
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
  -- profiles: only an admin's status change or deletion matters.
  if tg_table_name = 'profiles'
     and not exists (select 1 from public.user_roles r where r.user_id = old.user_id and r.role = 'admin') then
    return null;
  end if;

  -- Serialize admin changes per org: two transactions demoting or disabling the
  -- last two admins would each still see the other one. After the lock, the
  -- check below runs with a new snapshot (READ COMMITTED) and sees the winner.
  perform 1 from public.organizations o where o.id = old.org_id for update;

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

-- AFTER ROW triggers run at the end of the statement, so they see its final state.
create trigger user_roles_keep_active_admin
  after update of role or delete on public.user_roles
  for each row when (old.role = 'admin')
  execute function private.ensure_active_admin();

create trigger profiles_keep_active_admin
  after update of status or delete on public.profiles
  for each row when (old.status = 'active')
  execute function private.ensure_active_admin();

revoke all on function private.ensure_active_admin() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Shared checks for the write RPCs
-- -----------------------------------------------------------------------------
-- Raises unless the caller may manage the target; returns the target's current role (may be null).
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
  if not exists (
    select 1 from public.profiles p
     where p.user_id = p_user_id and p.org_id = private.current_user_org_id()
  ) then
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
     order by (p.status = 'disabled'), pg_catalog.lower(p.display_name);
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

  insert into public.user_roles (user_id, org_id, role)
  values (p_user_id, private.current_user_org_id(), p_role)
  on conflict (user_id) do update set role = excluded.role
   where public.user_roles.role is distinct from excluded.role;

  -- An admin holds every permission: leftover overrides would only confuse.
  if p_role = 'admin' then
    delete from public.user_permission_overrides o where o.user_id = p_user_id;
  end if;
end;
$$;

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

create function public.clear_permission_override(p_user_id uuid, p_permission_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage_user(p_user_id);
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
