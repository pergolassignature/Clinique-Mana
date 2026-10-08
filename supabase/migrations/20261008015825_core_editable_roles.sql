-- =============================================================================
-- Editable roles, per clinic
-- =============================================================================
-- Plan:     docs/plans/2026-10-07-phase-2-core-settings-plan.md, Task 2.20 (decision #40)
-- Rules:    docs/standards/database-conventions.md
--
-- Key choices
-- * The role defaults that are evaluated become per clinic: public.org_role_permissions.
--   public.role_permissions stays as the TEMPLATE: copied into every new org (trigger on
--   organizations) and, row by row, into every existing org when a migration adds a
--   template row (trigger on role_permissions). Only new template rows propagate: an
--   org's own removals are never undone, and deleting a template row changes no org.
-- * has_permission and get_my_access keep their signatures, grants and module gate; they
--   read the caller's org's defaults instead of the template.
-- * Custom roles are rows of public.roles with org_id set (null = base role, shared) and a
--   generated key `custom_` + 8 hex characters. A role's key, org and is_system never change
--   (trigger). Names: Unicode whitespace stripped at the ends and collapsed to one space
--   inside, no control or invisible format characters, 1–60 characters, unique per org and
--   never a base role's name, compared as lower(normalize(name, NFKC)) so look-alikes
--   (« Administrateur » in full-width letters, a decomposed « è ») count as the same name.
--   A trigger keeps user_roles and org_role_permissions on roles of their own org.
-- * New core permission roles.manage (admin in the template). The four role RPCs require
--   it, act on the caller's org only and lock the org row (FOR NO KEY UPDATE, conventions
--   §6). set_user_role takes the same lock after the target's profile (same order as the
--   last-admin trigger), so a role cannot be deleted, nor its defaults changed, between its
--   hold check and its write.
-- * Hold rule (mirrors set_permission_override): a non-admin manager never gives what she
--   does not hold. She cannot add a permission she lacks to a role, nor create a role as a
--   copy of one carrying such a permission. Removing a permission gives nothing: allowed.
-- * No self-grant: a non-admin manager cannot add permissions to the role she holds herself
--   (it would turn her temporary overrides into role defaults that clearing her overrides
--   leaves in place). Removing one from it stays allowed. She cannot take another role
--   either: nobody changes their own role (decision #28).
-- * The provider role's defaults are locked, like admin's: they belong to the Professionnels
--   module (reopens in Phase 4).
-- * Lock-out: the admin role cannot be edited, renamed or deleted, admins take no overrides
--   and every org keeps an active admin (core_user_admin), so every org always has someone
--   holding roles.manage and users.manage. Admin rows of org_role_permissions cannot be
--   deleted or changed except by cascade (trigger), and service_role can only read the table.
-- * A role that is unknown, just deleted or another org's is « Ce rôle n'existe plus. » (P0001,
--   HINT role_missing) for every RPC that names one: the same error either way, so another
--   org's role is not revealed, and the UI closes what showed the role and refetches the roles.
-- * set_permission_override, clear_permission_override and clear_permission_overrides take
--   the org lock after the target's profile, before checking the caller's own permissions,
--   so they serialize with set_role_permission changing the caller's role.
-- * `roles` is now org-scoped and audited (org_id from the row; null for base roles).
--   Correction: the comment above the audit triggers in 20261007140623_core_audit.sql (on
--   staging, so not edited) still says roles change only through migrations and are not
--   audited; from this migration on, `roles` is audited and changed through the role RPCs.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:core_editable_roles', true);

-- -----------------------------------------------------------------------------
-- `roles` is a core permission prefix now: no module may take that key
-- -----------------------------------------------------------------------------
alter table public.modules drop constraint modules_key_not_core_prefix;
alter table public.modules add constraint modules_key_not_core_prefix
  check (key not in ('settings', 'users', 'modules', 'audit', 'roles'));

-- -----------------------------------------------------------------------------
-- Custom roles: roles.org_id
-- -----------------------------------------------------------------------------
alter table public.roles add column org_id uuid references public.organizations(id) on delete cascade;

-- Base roles: lower-case words. Custom roles: custom_ + 8 hex characters.
alter table public.roles drop constraint roles_key_check;
alter table public.roles add constraint roles_key_check
  check (key ~ '^custom_[0-9a-f]{8}$' or (key ~ '^[a-z][a-z_]*$' and key !~ '^custom_'));
-- A role belongs to an org exactly when its key is a custom key.
alter table public.roles add constraint roles_org_id_check
  check ((org_id is null) = (key !~ '^custom_'));
-- A custom role is never a system role.
alter table public.roles add constraint roles_is_system_check
  check (not is_system or org_id is null);
-- Names are stored normalized (private.valid_role_name): 1–60 characters, the only
-- whitespace is a single U+0020 between words. The class below is Unicode's White_Space
-- minus U+0020, written out (POSIX classes depend on the database locale); keep it equal
-- to the one in valid_role_name.
alter table public.roles drop constraint roles_name_check;
alter table public.roles add constraint roles_name_check
  check (char_length(name) between 1 and 60
         and name !~ '^ | $|  '
         and name !~ '[\t\n\v\f\r\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]');
-- No control characters (C0, C1) nor invisible characters: two names that look the same must
-- be the same name. Written as escapes (never literally: they would be invisible here too):
-- soft hyphen (00AD), combining grapheme joiner (034F), Arabic letter mark (061C), Hangul
-- fillers (115F, 1160, 3164, FFA0), Mongolian vowel separator (180E), zero-width characters
-- and bidi marks (200B–200F), line/paragraph separators and bidi embeddings (2028–202F), word
-- joiner and invisible operators (2060–2064), bidi isolates and deprecated format characters
-- (2066–206F), variation selectors (FE00–FE0F), BOM (FEFF), tag characters (E0000–E007F).
-- Keep it equal to the one in valid_role_name.
alter table public.roles add constraint roles_name_no_control_chars
  check (name !~ '[[:cntrl:]\u0080-\u009F\u00AD\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202F\u2060-\u2064\u2066-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\U000E0000-\U000E007F]');

-- Unique name per org, compared like valid_role_name does (NFKC, case-insensitive); also
-- the index of the org_id foreign key.
create unique index roles_org_id_name_key on public.roles (org_id, lower(normalize(name, NFKC)))
  where org_id is not null;

-- A role's identity never changes: its key is referenced everywhere, its org scopes it and
-- is_system marks the base roles. Only the name changes (rename_role).
create function private.roles_freeze_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key is distinct from old.key
     or new.org_id is distinct from old.org_id
     or new.is_system is distinct from old.is_system then
    raise exception 'La clé, la clinique et le statut système d''un rôle ne changent pas : %', old.key
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger roles_freeze_identity
  before update on public.roles
  for each row execute function private.roles_freeze_identity();

drop policy roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (org_id is null or org_id = (select private.current_user_org_id()));

create trigger roles_audit
  after insert or update or delete on public.roles
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Per-org role defaults
-- -----------------------------------------------------------------------------
create table public.org_role_permissions (
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null references public.roles(key) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (org_id, role, permission_key)
);
create index org_role_permissions_role_idx on public.org_role_permissions (role);
create index org_role_permissions_permission_key_idx on public.org_role_permissions (permission_key);

revoke all on public.org_role_permissions from anon, authenticated;
grant select on public.org_role_permissions to authenticated;
-- Server code reads role defaults, never writes them: writes go through the role RPCs and
-- the seeding/propagation triggers (SECURITY DEFINER, owned by postgres). Cascades from a
-- deleted org, role or permission run as the table owner, so they are unaffected.
-- service_role keeps SELECT only: Supabase's default privileges grant it everything, and it
-- needs neither REFERENCES nor TRIGGER (no server code creates objects on this table).
revoke insert, update, delete, truncate, references, trigger on public.org_role_permissions from service_role;

alter table public.org_role_permissions enable row level security;
create policy org_role_permissions_select on public.org_role_permissions
  for select to authenticated
  using (org_id = (select private.current_user_org_id()));

create trigger org_role_permissions_audit
  after insert or update or delete on public.org_role_permissions
  for each row execute function private.audit_trigger();

-- Every existing org starts from the template (audited, source migration:core_editable_roles).
insert into public.org_role_permissions (org_id, role, permission_key)
select o.id, rp.role, rp.permission_key
  from public.organizations o
 cross join public.role_permissions rp
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Triggers: role/org consistency, seeding, template propagation
-- -----------------------------------------------------------------------------
-- user_roles and org_role_permissions only reference base roles or roles of their own org.
create function private.check_role_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.roles ro
     where ro.key = new.role and ro.org_id is not null and ro.org_id <> new.org_id
  ) then
    raise exception 'Rôle d''une autre clinique : %', new.role using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger user_roles_check_role_org
  before insert or update of role, org_id on public.user_roles
  for each row execute function private.check_role_org();
create trigger org_role_permissions_check_role_org
  before insert or update of role, org_id on public.org_role_permissions
  for each row execute function private.check_role_org();

-- Admin rows: admin holds every permission in every org (invariant test 000). Any write path
-- (RPC, SQL as postgres) is refused, except the cascade of deleting the org, the role or the
-- permission: then that parent is already gone when the row is deleted.
create function private.protect_admin_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.organizations o where o.id = old.org_id)
     and exists (select 1 from public.roles ro where ro.key = old.role)
     and exists (select 1 from public.permissions pm where pm.key = old.permission_key) then
    raise exception 'L''administrateur a toujours toutes les permissions.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger org_role_permissions_protect_admin
  before update or delete on public.org_role_permissions
  for each row when (old.role = 'admin')
  execute function private.protect_admin_role_permissions();

-- A new org copies the template.
create function private.seed_org_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.org_role_permissions (org_id, role, permission_key)
  select new.id, rp.role, rp.permission_key
    from public.role_permissions rp
  on conflict do nothing;
  return null;
end;
$$;

create trigger organizations_seed_role_permissions
  after insert on public.organizations
  for each row execute function private.seed_org_role_permissions();

-- A new template row (a module migration adding a permission) reaches every existing org.
-- Only inserted rows fire it: `insert … on conflict do nothing` on an existing template row
-- inserts nothing, so an org's removal is never undone.
create function private.propagate_template_role_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.roles ro where ro.key = new.role and ro.org_id is not null) then
    raise exception 'Le modèle ne contient que des rôles de base : %', new.role using errcode = '23514';
  end if;
  insert into public.org_role_permissions (org_id, role, permission_key)
  select o.id, new.role, new.permission_key
    from public.organizations o
  on conflict do nothing;
  return null;
end;
$$;

create trigger role_permissions_propagate
  after insert on public.role_permissions
  for each row execute function private.propagate_template_role_permission();

revoke all on function
  private.roles_freeze_identity(),
  private.check_role_org(),
  private.protect_admin_role_permissions(),
  private.seed_org_role_permissions(),
  private.propagate_template_role_permission()
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- roles.manage (propagates to every org's admin through the trigger above)
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module_key, description) values
  ('roles.manage', 'core', 'Gérer les rôles')
on conflict do nothing;
insert into public.role_permissions (role, permission_key) values
  ('admin', 'roles.manage')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- has_permission and get_my_access read the org's defaults
-- -----------------------------------------------------------------------------
-- Same signatures, bodies and module gate; only the role-default source changes.
-- create or replace keeps the grants.
create or replace function private.has_permission(p_key text)
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
              from public.org_role_permissions rp
              join me on me.org_id = rp.org_id and me.role = rp.role
              join perm on perm.key = rp.permission_key),
    false
  )
$$;

create or replace function public.get_my_access()
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
              from public.org_role_permissions rp
             where rp.org_id = p.org_id
               and rp.role = r.role
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

-- -----------------------------------------------------------------------------
-- Shared checks for the role RPCs
-- -----------------------------------------------------------------------------
-- Raises unless the caller holds roles.manage; locks the caller's org row until the end of
-- the transaction and returns its id. has_permission is false without an active profile,
-- so the org is never null after the check.
-- Lock order: profile before org; never lock a profile after the org lock.
-- (assert_can_manage_user, set_user_role, the override RPCs and the last-admin trigger all
-- lock the target's profile first, then the org.)
create function private.assert_can_manage_roles()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not private.has_permission('roles.manage') then
    raise exception 'Permission refusée : roles.manage' using errcode = '42501';
  end if;
  v_org := private.current_user_org_id();
  perform 1 from public.organizations o where o.id = v_org for no key update;
  return v_org;
end;
$$;

-- The normalized name, or a French P0001 error. Normalized: Unicode whitespace (same class
-- as roles_name_check, plus U+0020) stripped at the ends, each inner run replaced by one
-- space. Then: required, at most 60 characters, no control or format character (same class
-- as roles_name_no_control_chars), not used by a base role or another role of the org,
-- compared as lower(normalize(…, NFKC)) like the unique index. p_except_key: the role being
-- renamed (it may keep its own name, or change its case).
create function private.valid_role_name(p_org uuid, p_name text, p_except_key text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ws constant text := '[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+';
  v_name text;
begin
  v_name := pg_catalog.regexp_replace(coalesce(p_name, ''), '^' || v_ws || '|' || v_ws || '$', '', 'g');
  v_name := pg_catalog.regexp_replace(v_name, v_ws, ' ', 'g');
  if v_name = '' then
    raise exception 'Le nom du rôle est requis.' using errcode = 'P0001';
  end if;
  if pg_catalog.char_length(v_name) > 60 then
    raise exception 'Le nom du rôle ne peut pas dépasser 60 caractères.' using errcode = 'P0001';
  end if;
  if v_name ~ '[[:cntrl:]\u0080-\u009F\u00AD\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u2028-\u202F\u2060-\u2064\u2066-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\U000E0000-\U000E007F]' then
    raise exception 'Le nom du rôle contient des caractères invisibles ou non permis.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.roles ro
     where (ro.org_id is null or ro.org_id = p_org)
       and pg_catalog.lower(pg_catalog.normalize(ro.name, 'NFKC')) = pg_catalog.lower(pg_catalog.normalize(v_name, 'NFKC'))
       and ro.key is distinct from p_except_key
  ) then
    raise exception 'Un rôle porte déjà ce nom.' using errcode = 'P0001';
  end if;
  return v_name;
end;
$$;

-- Raises unless p_role is a base role or one of p_org's custom roles; returns whether it is a
-- custom role. Unknown, just deleted or another org's: the same P0001, so another org's role is
-- not revealed, and a manager whose page still shows a deleted role gets a message rather than
-- a technical error. HINT role_missing: the UI keys on it, never on the text. A null role is a
-- technical error (the UI always sends one).
create function private.assert_org_role(p_org uuid, p_role text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role_org uuid;
begin
  if p_role is null then
    raise exception 'Valeur manquante' using errcode = '22023';
  end if;
  select ro.org_id into v_role_org
    from public.roles ro
   where ro.key = p_role and (ro.org_id is null or ro.org_id = p_org);
  if not found then
    raise exception 'Ce rôle n''existe plus.' using errcode = 'P0001', hint = 'role_missing';
  end if;
  return v_role_org is not null;
end;
$$;

revoke all on function
  private.assert_can_manage_roles(),
  private.valid_role_name(uuid, text, text),
  private.assert_org_role(uuid, text)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Role RPCs
-- -----------------------------------------------------------------------------
-- A role that does not exist (any more) in the caller's org: private.assert_org_role.
create function public.set_role_permission(p_role text, p_permission_key text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.assert_can_manage_roles();
begin
  if p_granted is null then
    raise exception 'Valeur manquante' using errcode = '22023';
  end if;
  perform private.assert_org_role(v_org, p_role);
  if p_role = 'admin' then
    raise exception 'L''administrateur a toujours toutes les permissions.' using errcode = 'P0001';
  end if;
  -- Locked until Phase 4: the Professionnels module owns the provider role (decision #40).
  if p_role = 'provider' then
    raise exception 'Les permissions du rôle Professionnel se gèrent dans le module Professionnels.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.permissions pm where pm.key = p_permission_key) then
    raise exception 'Permission inconnue : %', p_permission_key using errcode = '22023';
  end if;
  if p_granted and not private.has_role('admin') then
    -- No self-grant: adding to her own role would make her overrides permanent role
    -- defaults, out of reach of clear_permission_overrides. Removing stays allowed.
    if p_role = private.current_user_role() then
      raise exception 'Vous ne pouvez pas ajouter de permissions à votre propre rôle.' using errcode = 'P0001';
    end if;
    -- Fails closed like set_user_role: has_permission is false for a disabled module.
    if not private.has_permission(p_permission_key) then
      raise exception 'Vous ne pouvez pas accorder une permission que vous n''avez pas.' using errcode = 'P0001';
    end if;
  end if;

  if p_granted then
    insert into public.org_role_permissions (org_id, role, permission_key)
    values (v_org, p_role, p_permission_key)
    on conflict do nothing;
  else
    delete from public.org_role_permissions rp
     where rp.org_id = v_org and rp.role = p_role and rp.permission_key = p_permission_key;
  end if;
end;
$$;

-- Returns the new key. Starts empty, or with a copy of p_copy_from's defaults in this org.
-- The copy refusal carries HINT copy_from, so the UI shows it on the copy field without
-- matching its text (every other P0001 here is about the name, or role_missing).
create function public.create_role(p_name text, p_copy_from text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.assert_can_manage_roles();
  v_name text := private.valid_role_name(v_org, p_name, null);
  v_key text;
  v_try int := 0;
begin
  if p_copy_from is not null then
    perform private.assert_org_role(v_org, p_copy_from);
    if not private.has_role('admin') and exists (
      select 1 from public.org_role_permissions rp
       where rp.org_id = v_org and rp.role = p_copy_from
         and not private.has_permission(rp.permission_key)
    ) then
      raise exception 'Vous ne pouvez pas copier un rôle qui donne des permissions que vous n''avez pas.'
        using errcode = 'P0001', hint = 'copy_from';
    end if;
  end if;

  -- 2^32 keys: a collision is unlikely; retry a few times rather than fail on one.
  loop
    v_key := 'custom_' || pg_catalog.encode(extensions.gen_random_bytes(4), 'hex');
    exit when not exists (select 1 from public.roles ro where ro.key = v_key);
    v_try := v_try + 1;
    if v_try >= 5 then
      raise exception 'Impossible de générer une clé de rôle unique' using errcode = 'XX000';
    end if;
  end loop;

  insert into public.roles (key, name, is_system, org_id) values (v_key, v_name, false, v_org);
  if p_copy_from is not null then
    insert into public.org_role_permissions (org_id, role, permission_key)
    select v_org, v_key, rp.permission_key
      from public.org_role_permissions rp
     where rp.org_id = v_org and rp.role = p_copy_from;
  end if;
  return v_key;
end;
$$;

create function public.rename_role(p_role text, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.assert_can_manage_roles();
  v_name text;
begin
  if not private.assert_org_role(v_org, p_role) then
    raise exception 'Les rôles de base ne peuvent pas être renommés.' using errcode = 'P0001';
  end if;
  v_name := private.valid_role_name(v_org, p_name, p_role);
  update public.roles ro set name = v_name
   where ro.key = p_role and ro.name is distinct from v_name;
end;
$$;

-- Custom roles only, and only when nobody holds the role. Its defaults go with it (cascade,
-- audited row by row).
create function public.delete_role(p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.assert_can_manage_roles();
  v_holders int;
begin
  if not private.assert_org_role(v_org, p_role) then
    raise exception 'Les rôles de base ne peuvent pas être supprimés.' using errcode = 'P0001';
  end if;
  -- After the org lock: a concurrent set_user_role giving this role has committed or waits.
  select count(*)::int into v_holders from public.user_roles r where r.role = p_role;
  if v_holders > 0 then
    raise exception 'Ce rôle est attribué à % personne(s).', v_holders using errcode = 'P0001';
  end if;
  delete from public.roles ro where ro.key = p_role;
end;
$$;

revoke all on function
  public.set_role_permission(text, text, boolean),
  public.create_role(text, text),
  public.rename_role(text, text),
  public.delete_role(text)
from public, anon, authenticated, service_role;
grant execute on function
  public.set_role_permission(text, text, boolean),
  public.create_role(text, text),
  public.rename_role(text, text),
  public.delete_role(text)
to authenticated;
-- service_role is revoked (Supabase's default privileges grant it EXECUTE): these act for
-- the calling user (auth.uid()), which a service-role caller lacks.

-- -----------------------------------------------------------------------------
-- set_user_role: custom roles of the caller's org; hold check on the org's defaults
-- -----------------------------------------------------------------------------
-- Same signature and grants (create or replace keeps them). Lock order: the target's profile
-- (assert_can_manage_user), then the org row, as in the last-admin trigger.
-- list_org_users needs no change: it joins roles by key, so role_name is the custom name.
create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text := private.assert_can_manage_user(p_user_id);
  v_org uuid := private.current_user_org_id();
begin
  -- Serializes with the role RPCs: the role cannot be deleted, nor its defaults changed,
  -- between the checks below and the write.
  perform 1 from public.organizations o where o.id = v_org for no key update;

  -- A role deleted meanwhile (or another org's): « Ce rôle n'existe plus. », like the role RPCs.
  perform private.assert_org_role(v_org, p_role);
  if p_role = 'provider' or v_current = 'provider' then
    raise exception 'Le rôle Professionnel se gère dans le module Professionnels.' using errcode = 'P0001';
  end if;
  if p_role = 'admin' and not private.has_role('admin') then
    raise exception 'Seul un administrateur peut modifier un administrateur.' using errcode = 'P0001';
  end if;
  -- Fails closed by design: has_permission is false for a disabled module, so a
  -- non-admin cannot assign a role whose defaults include such a permission.
  if not private.has_role('admin') and exists (
    select 1 from public.org_role_permissions rp
     where rp.org_id = v_org and rp.role = p_role and not private.has_permission(rp.permission_key)
  ) then
    raise exception 'Vous ne pouvez pas attribuer un rôle qui donne des permissions que vous n''avez pas.' using errcode = 'P0001';
  end if;

  -- Becoming admin deletes the user's overrides (trigger user_roles_clear_admin_overrides).
  insert into public.user_roles (user_id, org_id, role)
  values (p_user_id, v_org, p_role)
  on conflict (user_id) do update set role = excluded.role
   where public.user_roles.role is distinct from excluded.role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Override RPCs: the org lock before the caller's own hold check
-- -----------------------------------------------------------------------------
-- The hold check reads the caller's role defaults, which set_role_permission can now change.
-- Taking the org lock (after the target's profile: lock order profile → org) before that
-- check means a concurrent removal from the caller's role has committed or waits, so the
-- check sees it. Same signatures, bodies and grants otherwise (create or replace keeps the
-- grants). Originals: 20261007211509_core_user_admin.sql and
-- 20261008011657_core_clear_permission_overrides.sql.
create or replace function public.set_permission_override(p_user_id uuid, p_permission_key text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.assert_can_manage_user(p_user_id);
begin
  perform 1 from public.organizations o where o.id = private.current_user_org_id() for no key update;

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

create or replace function public.clear_permission_override(p_user_id uuid, p_permission_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage_user(p_user_id);
  perform 1 from public.organizations o where o.id = private.current_user_org_id() for no key update;

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

create or replace function public.clear_permission_overrides(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed int;
begin
  perform private.assert_can_manage_user(p_user_id);
  perform 1 from public.organizations o where o.id = private.current_user_org_id() for no key update;

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

select pg_catalog.set_config('app.audit_source', '', true);
