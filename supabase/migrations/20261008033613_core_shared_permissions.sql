-- =============================================================================
-- Shared-services permissions and one permission source
-- =============================================================================
-- Design:  docs/plans/2026-10-08-phase-3-shared-services-design.md §9
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.1
--          P3-12 (integrations_manage gates org secrets), P3-21 (one source, per statement)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Two core permissions, granted to admin in the template; the Task 2.20 trigger
--   (role_permissions_propagate) copies them into every existing org's admin defaults.
-- * private.current_permission_keys() is the one place that evaluates permissions: the
--   caller's org defaults (org_role_permissions), plus granted overrides, minus revoked ones,
--   for core and the modules enabled in the caller's org. has_permission and get_my_access
--   read it, so they cannot drift. A policy can call it once per statement:
--   `col = any ((select private.current_permission_keys()))`.
-- * has_permission keeps its signature, grants and contract (false for an unknown or null
--   key, a disabled user, a role-less user, a disabled module).
-- * set_org_secret / delete_org_secret now need settings.integrations_manage; the rest of
--   each body (validation, Vault, audit row) is unchanged.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_shared_permissions', true);

insert into public.permissions (key, module_key, description) values
  ('settings.email_manage',        'core', 'Gérer les courriels de la clinique'),
  ('settings.integrations_manage', 'core', 'Gérer les clés d''intégration')
on conflict do nothing;

-- The Task 2.20 trigger copies new template rows into org_role_permissions for every org.
insert into public.role_permissions (role, permission_key) values
  ('admin', 'settings.email_manage'), ('admin', 'settings.integrations_manage')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- One permission source
-- -----------------------------------------------------------------------------
-- The caller's effective permission keys, sorted; '{}' without an active profile and a role.
create function private.current_permission_keys()
returns text[]
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
  -- The permissions whose module is on for the caller's org.
  perm as (
    select pm.key
      from public.permissions pm
     cross join me
     where pm.module_key = 'core'
        or exists (
             select 1 from public.org_modules om
              where om.org_id = me.org_id
                and om.module_key = pm.module_key
                and om.enabled)
  )
  select coalesce(array_agg(perm.key order by perm.key), '{}')
    from perm
   cross join me
    left join public.user_permission_overrides o
      on o.user_id = me.user_id
     and o.permission_key = perm.key
   where coalesce(
           o.granted,
           exists (select 1
                     from public.org_role_permissions rp
                    where rp.org_id = me.org_id
                      and rp.role = me.role
                      and rp.permission_key = perm.key))
$$;

revoke all on function private.current_permission_keys() from public, anon;
grant execute on function private.current_permission_keys() to authenticated, service_role;

-- Same signature; create or replace keeps the grants. coalesce keeps « false » for a null key.
create or replace function private.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_key = any (private.current_permission_keys()), false)
$$;

-- Only the permissions field changes; every other field is as in *_core_editable_roles.sql.
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
    'permissions',  to_jsonb(private.current_permission_keys()),
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
-- Org secrets need settings.integrations_manage (P3-12)
-- -----------------------------------------------------------------------------
-- Create or rotate a secret for the caller's org. Values go straight to Vault;
-- only the key name, version and actor are recorded here and in the audit log.
create or replace function public.set_org_secret(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_id uuid;
begin
  if not private.has_permission('settings.integrations_manage') then
    raise exception 'Permission refusée : settings.integrations_manage' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Clé invalide : %', p_key using errcode = '22023';
  end if;
  if coalesce(length(p_value), 0) = 0 then
    raise exception 'La valeur ne peut pas être vide' using errcode = '22023';
  end if;

  select s.vault_secret_id into v_id
    from public.org_secrets s
   where s.org_id = v_org and s.key = p_key
     for update;

  if v_id is null then
    v_id := vault.create_secret(p_value, format('org:%s:%s', v_org, p_key));
    insert into public.org_secrets (org_id, key, vault_secret_id, updated_by)
    values (v_org, p_key, v_id, auth.uid());
  else
    perform vault.update_secret(v_id, p_value);
    update public.org_secrets s
       set version = s.version + 1,
           updated_by = auth.uid()
     where s.org_id = v_org and s.key = p_key;
    -- The value change is invisible to the row diff: record the rotation explicitly.
    insert into public.audit_log (org_id, table_name, record_id, action, changed_fields, actor_id, actor_role, source)
    values (
      v_org, 'org_secrets', format('%s:%s', v_org, p_key), 'update',
      jsonb_build_object('value', jsonb_build_object('rotated', true)),
      auth.uid(), private.current_user_role(), 'rpc:set_org_secret'
    );
  end if;
end;
$$;

-- Remove a secret; the org_secrets_delete_vault trigger removes the Vault entry.
-- Missing keys are a no-op.
create or replace function public.delete_org_secret(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('settings.integrations_manage') then
    raise exception 'Permission refusée : settings.integrations_manage' using errcode = '42501';
  end if;

  delete from public.org_secrets s
   where s.org_id = private.current_user_org_id()
     and s.key = p_key;
end;
$$;
