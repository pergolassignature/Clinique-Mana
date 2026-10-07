-- =============================================================================
-- Core access foundation
-- =============================================================================
-- Organizations, roles, profiles, permissions, module registry and the RLS
-- helpers every later module builds on.
--
-- Design:   docs/plans/2026-10-06-foundation-rebuild-design.md §2, §3
-- Review:   docs/audit/2026-10-07-core-schema-design-review.md (C2, I4–I9, I11, I12)
-- Rules:    docs/standards/database-conventions.md
--
-- Key choices
-- * Closed by default: Supabase grants ALL on new public objects to anon and
--   authenticated. We revoke those defaults first, then grant per table.
-- * The role is read from public.user_roles (not the JWT), so disabling a user
--   or changing a role takes effect on the next query.
-- * RLS helpers are SECURITY DEFINER functions in schema `private`, which is not
--   exposed through the API. Only intended RPCs live in `public`.
-- * Roles are rows in public.roles (not an enum): new roles are usable in the
--   same transaction and can be retired.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Closed default privileges (C2)
-- -----------------------------------------------------------------------------
-- Applies to every object `postgres` (the migration role) creates from here on.
-- service_role keeps Supabase's defaults: it bypasses RLS and is server-only.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
-- Functions are executable by PUBLIC unless revoked: close that for every schema.
alter default privileges for role postgres revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Schema `private`: RLS helpers and trigger functions (I8)
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Shared trigger: keep updated_at current.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Module registry (I6)
-- -----------------------------------------------------------------------------
-- Every permission belongs to a module. `core` is the always-on platform module.
create table public.modules (
  key text primary key check (key ~ '^[a-z][a-z_]*$'),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  -- Core permission prefixes (settings.*, users.*, …) can never be module keys.
  constraint modules_key_not_core_prefix check (key not in ('settings', 'users', 'modules', 'audit'))
);

-- `core` is implicit for every module, so it never appears here.
create table public.module_dependencies (
  module_key text not null references public.modules(key) on delete cascade,
  depends_on text not null references public.modules(key),
  primary key (module_key, depends_on),
  check (module_key <> depends_on),
  constraint module_dependencies_no_core check (module_key <> 'core' and depends_on <> 'core')
);
create index module_dependencies_depends_on_idx on public.module_dependencies (depends_on);

-- Reject any edge that closes a cycle (A → B → … → A). The table lock
-- serializes concurrent inserts so two halves of a cycle cannot both pass.
create function private.module_dependencies_no_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  lock table public.module_dependencies in share row exclusive mode;
  if exists (
    with recursive reach(key) as (
      select new.depends_on
      union
      select d.depends_on
        from public.module_dependencies d
        join reach on d.module_key = reach.key
    )
    select 1 from reach where reach.key = new.module_key
  ) then
    raise exception 'Dépendance circulaire : % → %', new.module_key, new.depends_on using errcode = '23514';
  end if;
  return null;
end;
$$;

create trigger module_dependencies_no_cycle
  after insert or update on public.module_dependencies
  for each row execute function private.module_dependencies_no_cycle();

insert into public.modules (key, name) values ('core', 'Noyau')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Organizations (the clinic). Phase 2 adds identity / tax / privacy columns.
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  timezone text not null default 'America/Toronto',
  default_locale text not null default 'fr-CA',
  currency text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  constraint organizations_default_locale_check check (default_locale in ('fr-CA', 'en-CA')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

-- pg_timezone_names is not immutable, so a CHECK constraint cannot use it (I12).
create function private.validate_org_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = new.timezone) then
    raise exception 'Fuseau horaire inconnu : %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger organizations_validate_timezone
  before insert or update of timezone on public.organizations
  for each row execute function private.validate_org_timezone();

-- -----------------------------------------------------------------------------
-- Roles (I7): a table, not an enum
-- -----------------------------------------------------------------------------
create table public.roles (
  key text primary key check (key ~ '^[a-z][a-z_]*$'),
  name text not null check (length(trim(name)) > 0),
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.roles (key, name, is_system) values
  ('admin',    'Administrateur',         true),
  ('staff',    'Personnel administratif', true),
  ('provider', 'Professionnel',          true)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Profiles: application identity for every auth user
-- -----------------------------------------------------------------------------
-- The only table that references auth.users (I4).
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  display_name text not null check (length(trim(display_name)) > 0),
  -- Copied from auth.users by trigger; auth is the only source of truth (I9).
  email text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of the composite FKs on per-user tables (I11).
  unique (user_id, org_id)
);
create index profiles_org_id_idx on public.profiles (org_id);
create unique index profiles_email_lower_key on public.profiles (lower(email));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Whatever the caller passes, profiles.email is copied from auth.users.
create function private.profiles_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select u.email into new.email from auth.users u where u.id = new.user_id;
  if new.email is null then
    raise exception 'Utilisateur sans courriel : %', new.user_id using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger profiles_email_from_auth
  before insert or update of email on public.profiles
  for each row execute function private.profiles_email_from_auth();

-- Keep profiles.email in sync when the user changes their auth email (I9).
-- Tags the audit row, then restores the caller's audit source.
create function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform pg_catalog.set_config('app.audit_source', 'auth:email_change', true);
  update public.profiles p
     set email = new.email
   where p.user_id = new.id;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (new.email is not null and old.email is distinct from new.email)
  execute function private.sync_profile_email();

-- -----------------------------------------------------------------------------
-- Permission catalogue (a table: modules add keys in their own migration)
-- -----------------------------------------------------------------------------
create table public.permissions (
  key text primary key check (key ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  module_key text not null references public.modules(key),
  description text not null,
  -- `<module>.<action>`; core keys (settings.*, users.*, …) are the exception.
  check (module_key = 'core' or split_part(key, '.', 1) = module_key)
);
create index permissions_module_key_idx on public.permissions (module_key);

create table public.role_permissions (
  role text not null references public.roles(key) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role, permission_key)
);
create index role_permissions_permission_key_idx on public.role_permissions (permission_key);

-- -----------------------------------------------------------------------------
-- Per-user role and permission overrides (both carry org_id, I11)
-- -----------------------------------------------------------------------------
create table public.user_roles (
  user_id uuid primary key,
  org_id uuid not null,
  role text not null references public.roles(key),
  created_at timestamptz not null default now(),
  foreign key (user_id, org_id) references public.profiles(user_id, org_id) on delete cascade
);
create index user_roles_org_id_idx on public.user_roles (org_id);
create index user_roles_role_idx on public.user_roles (role);

create table public.user_permission_overrides (
  user_id uuid not null,
  org_id uuid not null,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted boolean not null,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, permission_key),
  foreign key (user_id, org_id) references public.profiles(user_id, org_id) on delete cascade
);
create index user_permission_overrides_org_id_idx on public.user_permission_overrides (org_id);
create index user_permission_overrides_permission_key_idx on public.user_permission_overrides (permission_key);
create index user_permission_overrides_created_by_idx on public.user_permission_overrides (created_by);

-- -----------------------------------------------------------------------------
-- Module activation per organization
-- -----------------------------------------------------------------------------
-- Written only through public.set_module_enabled() (next migrations).
create table public.org_modules (
  org_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null references public.modules(key),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  primary key (org_id, module_key),
  -- `core` is always on; it never has a row here.
  check (module_key <> 'core')
);
create index org_modules_module_key_idx on public.org_modules (module_key);
create index org_modules_updated_by_idx on public.org_modules (updated_by);

create trigger org_modules_set_updated_at
  before update on public.org_modules
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS helpers (private, SECURITY DEFINER, STABLE)
-- -----------------------------------------------------------------------------
-- Policies call these wrapped in `(select …)` so they run once per statement.
-- Policies never query profiles / user_roles inline (prevents RLS recursion).

-- Org of the caller, or null when the caller has no active profile.
create function private.current_user_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.org_id
    from public.profiles p
   where p.user_id = auth.uid()
     and p.status = 'active'
$$;

-- Role key of the caller, or null when inactive / without a role.
create function private.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.role
    from public.user_roles r
    join public.profiles p on p.user_id = r.user_id
   where r.user_id = auth.uid()
     and p.status = 'active'
$$;

create function private.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_user_role() = p_role, false)
$$;

-- Role defaults ∪ override grants − override revokes, restricted to modules
-- enabled for the caller's org (`core` always is). False when the caller is
-- disabled, has no role (overrides alone never grant anything), or the key is
-- unknown. This is the module gate for RLS: a disabled module grants nothing.
create function private.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select r.user_id, r.role, p.org_id
      from public.user_roles r
      join public.profiles p on p.user_id = r.user_id
     where r.user_id = auth.uid()
       and p.status = 'active'
  ),
  -- The permission, only if its module is on for the caller's org.
  perm as (
    select pm.key
      from public.permissions pm
     cross join me
     where pm.key = p_key
       and (pm.module_key = 'core' or exists (
             select 1 from public.org_modules om
              where om.org_id = me.org_id
                and om.module_key = pm.module_key
                and om.enabled))
  )
  select coalesce(
    (select o.granted
       from public.user_permission_overrides o
       join me on me.user_id = o.user_id
       join perm on perm.key = o.permission_key),
    exists (select 1
              from public.role_permissions rp
              join me on me.role = rp.role
              join perm on perm.key = rp.permission_key),
    false
  )
$$;

revoke all on function
  private.current_user_org_id(),
  private.current_user_role(),
  private.has_role(text),
  private.has_permission(text)
from public, anon;
grant execute on function
  private.current_user_org_id(),
  private.current_user_role(),
  private.has_role(text),
  private.has_permission(text)
to authenticated, service_role;

-- Trigger functions are never called directly.
revoke all on function
  private.set_updated_at(),
  private.module_dependencies_no_cycle(),
  private.validate_org_timezone(),
  private.profiles_email_from_auth(),
  private.sync_profile_email()
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- public.get_my_access(): one call for the frontend and edge functions
-- -----------------------------------------------------------------------------
-- Profile + org + role + effective permissions + enabled modules.
-- * null when the caller has no profile;
-- * disabled profiles are returned (status = 'disabled') so the UI can explain
--   the refusal, but with empty permissions and modules;
-- * permissions are empty unless the profile is active AND has a role, and
--   only include modules enabled for the org (core always): this mirrors
--   private.has_permission() exactly (I5).
create function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id',      p.user_id,
    'org_id',       p.org_id,
    'org_name',     o.name,
    'org_timezone', o.timezone,
    'display_name', p.display_name,
    'email',        p.email,
    'status',       p.status,
    'role',         r.role,
    'permissions', case when p.status = 'active' and r.role is not null then coalesce((
        select jsonb_agg(e.k order by e.k)
          from (
            select rp.permission_key as k
              from public.role_permissions rp
             where rp.role = r.role
               and not exists (
                 select 1 from public.user_permission_overrides x
                  where x.user_id = p.user_id
                    and x.permission_key = rp.permission_key
                    and not x.granted)
            union
            select x.permission_key
              from public.user_permission_overrides x
             where x.user_id = p.user_id
               and x.granted
          ) e
          join public.permissions pm on pm.key = e.k
         where pm.module_key = 'core'
            or exists (
              select 1 from public.org_modules om
               where om.org_id = p.org_id
                 and om.module_key = pm.module_key
                 and om.enabled)
      ), '[]'::jsonb) else '[]'::jsonb end,
    'modules', case when p.status = 'active' then coalesce((
        select jsonb_agg(om.module_key order by om.module_key)
          from public.org_modules om
         where om.org_id = p.org_id
           and om.enabled
      ), '[]'::jsonb) else '[]'::jsonb end
  )
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  left join public.user_roles r on r.user_id = p.user_id
  where p.user_id = auth.uid()
$$;

revoke all on function public.get_my_access() from public, anon;
grant execute on function public.get_my_access() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Privileges: revoke everything, then grant only what clients need (C2)
-- -----------------------------------------------------------------------------
revoke all on
  public.modules, public.module_dependencies, public.organizations, public.roles,
  public.profiles, public.permissions, public.role_permissions, public.user_roles,
  public.user_permission_overrides, public.org_modules
from anon, authenticated;

grant select on
  public.modules, public.module_dependencies, public.organizations, public.roles,
  public.profiles, public.permissions, public.role_permissions, public.user_roles,
  public.user_permission_overrides, public.org_modules
to authenticated;

-- Column-level update grants; RLS decides which rows.
grant update (name, timezone, default_locale, currency) on public.organizations to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------
alter table public.modules enable row level security;
alter table public.module_dependencies enable row level security;
alter table public.organizations enable row level security;
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.org_modules enable row level security;

-- Catalogues: readable by any signed-in user.
create policy modules_select on public.modules
  for select to authenticated using (true);
create policy module_dependencies_select on public.module_dependencies
  for select to authenticated using (true);
create policy roles_select on public.roles
  for select to authenticated using (true);
create policy permissions_select on public.permissions
  for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions
  for select to authenticated using (true);

-- Organizations: own org; updates need settings.manage.
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = (select private.current_user_org_id()));
create policy organizations_update on public.organizations
  for update to authenticated
  using (id = (select private.current_user_org_id()) and (select private.has_permission('settings.manage')))
  with check (id = (select private.current_user_org_id()));

-- Profiles: own profile, or the whole org with users.view.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (user_id = (select auth.uid()) or (select private.has_permission('users.view')))
  );
-- Self-service rename only (column grant above). Admin changes go through RPCs.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()) and status = 'active')
  with check (user_id = (select auth.uid()));

-- Roles and overrides: own row, or the whole org with users.view.
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (user_id = (select auth.uid()) or (select private.has_permission('users.view')))
  );
create policy user_permission_overrides_select on public.user_permission_overrides
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (user_id = (select auth.uid()) or (select private.has_permission('users.view')))
  );

-- Module activation: visible to the whole org (the menu depends on it).
create policy org_modules_select on public.org_modules
  for select to authenticated
  using (org_id = (select private.current_user_org_id()));

-- -----------------------------------------------------------------------------
-- Core permission catalogue and role defaults
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module_key, description) values
  ('settings.view',   'core', 'Voir les paramètres'),
  ('settings.manage', 'core', 'Modifier les paramètres de la clinique'),
  ('users.view',      'core', 'Voir les utilisateurs'),
  ('users.manage',    'core', 'Inviter et gérer les utilisateurs'),
  ('modules.manage',  'core', 'Activer ou désactiver des modules'),
  ('audit.view',      'core', 'Consulter le journal d''audit')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'settings.view'),
  ('admin', 'settings.manage'),
  ('admin', 'users.view'),
  ('admin', 'users.manage'),
  ('admin', 'modules.manage'),
  ('admin', 'audit.view'),
  ('staff', 'settings.view'),
  ('staff', 'users.view')
on conflict do nothing;
