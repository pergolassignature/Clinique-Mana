-- =============================================================================
-- Module settings, module toggling and Vault-backed secrets
-- =============================================================================
-- * org_module_settings: per-module JSON settings (validated by the module's
--   Zod schema in the client and edge functions).
-- * org_secrets: pointers to Supabase Vault secrets. Clients never read this
--   table; they write through RPCs and see key names only. Edge functions read
--   values with get_org_secret() under the service role.
-- * RPCs: module_enabled, set_module_enabled, list_modules,
--         set_org_secret, delete_org_secret, list_org_secret_keys,
--         get_org_secret (service role only).
--
-- Design:   docs/plans/2026-10-06-foundation-rebuild-design.md §3
-- Review:   docs/audit/2026-10-07-core-schema-design-review.md (C1, I1, I2, I10)
-- Rules:    docs/standards/database-conventions.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.org_module_settings (
  org_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null references public.modules(key),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  primary key (org_id, module_key)
);
create index org_module_settings_module_key_idx on public.org_module_settings (module_key);
create index org_module_settings_updated_by_idx on public.org_module_settings (updated_by);

create trigger org_module_settings_set_updated_at
  before update on public.org_module_settings
  for each row execute function private.set_updated_at();

create table public.org_secrets (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  vault_secret_id uuid not null unique,
  -- Bumped on every rotation so the change shows in the audit diff.
  version int not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  primary key (org_id, key)
);
create index org_secrets_updated_by_idx on public.org_secrets (updated_by);

create trigger org_secrets_set_updated_at
  before update on public.org_secrets
  for each row execute function private.set_updated_at();

-- A Vault secret never outlives its org_secrets row, whatever deletes it
-- (delete_org_secret, or the cascade from deleting an organization).
create function private.org_secrets_delete_vault()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets vs where vs.id = old.vault_secret_id;
  return null;
end;
$$;

create trigger org_secrets_delete_vault
  after delete on public.org_secrets
  for each row execute function private.org_secrets_delete_vault();

revoke all on function private.org_secrets_delete_vault() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Privileges and RLS
-- -----------------------------------------------------------------------------
revoke all on public.org_module_settings, public.org_secrets from anon, authenticated;
grant select on public.org_module_settings to authenticated;
-- org_secrets: no client grant and no policy on purpose. Only SECURITY DEFINER
-- functions touch it; a client select raises 42501.

alter table public.org_module_settings enable row level security;
alter table public.org_secrets enable row level security;

create policy org_module_settings_select on public.org_module_settings
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('settings.view'))
  );

-- -----------------------------------------------------------------------------
-- Audit (vault ids are pointers, not values, but stay out of the log anyway)
-- -----------------------------------------------------------------------------
create trigger org_module_settings_audit
  after insert or update or delete on public.org_module_settings
  for each row execute function private.audit_trigger();
create trigger org_secrets_audit
  after insert or update or delete on public.org_secrets
  for each row execute function private.audit_trigger('vault_secret_id');

-- -----------------------------------------------------------------------------
-- Modules
-- -----------------------------------------------------------------------------
-- Is a module enabled for the caller's org? `core` always is.
-- Used by edge functions (requireModule) and module RLS where needed.
create function public.module_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_key = 'core' or exists (
    select 1
      from public.org_modules om
     where om.org_id = private.current_user_org_id()
       and om.module_key = p_key
       and om.enabled
  )
$$;

-- Toggle a module for the caller's org, enforcing module_dependencies.
create function public.set_module_enabled(p_key text, p_enabled boolean)
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
  perform 1 from public.organizations o where o.id = v_org for update;

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

-- Module catalogue with the caller's org state (Settings → Modules). Excludes core.
create function public.list_modules()
returns table (key text, name text, depends_on text[], enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.key,
    m.name,
    coalesce(
      (select array_agg(d.depends_on order by d.depends_on)
         from public.module_dependencies d
        where d.module_key = m.key),
      '{}'::text[]),
    coalesce(om.enabled, false)
  from public.modules m
  left join public.org_modules om
    on om.module_key = m.key
   and om.org_id = private.current_user_org_id()
  where m.key <> 'core'
  order by m.key
$$;

-- -----------------------------------------------------------------------------
-- Secrets
-- -----------------------------------------------------------------------------
-- Create or rotate a secret for the caller's org. Values go straight to Vault;
-- only the key name, version and actor are recorded here and in the audit log.
create function public.set_org_secret(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_id uuid;
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
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
create function public.delete_org_secret(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;

  delete from public.org_secrets s
   where s.org_id = private.current_user_org_id()
     and s.key = p_key;
end;
$$;

-- Key names (never values) for the Settings UI: « Configurée ✓ / Remplacer ».
create function public.list_org_secret_keys()
returns table (key text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.key, s.updated_at
    from public.org_secrets s
   where s.org_id = (select private.current_user_org_id())
     and (select private.has_permission('settings.view'))
   order by s.key
$$;

-- Server side only: edge functions call this with the service role.
create function public.get_org_secret(p_org_id uuid, p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from public.org_secrets s
    join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
   where s.org_id = p_org_id
     and s.key = p_key
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function
  public.module_enabled(text),
  public.set_module_enabled(text, boolean),
  public.list_modules(),
  public.set_org_secret(text, text),
  public.delete_org_secret(text),
  public.list_org_secret_keys(),
  public.get_org_secret(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.module_enabled(text),
  public.set_module_enabled(text, boolean),
  public.list_modules(),
  public.set_org_secret(text, text),
  public.delete_org_secret(text),
  public.list_org_secret_keys()
to authenticated, service_role;

grant execute on function public.get_org_secret(uuid, text) to service_role;
