-- =============================================================================
-- PII key versions, canary and deploy health check (ADR 0004 « Before Phase 4 »)
-- =============================================================================
-- Plan:     docs/plans/2026-10-08-professionals-module-plan.md Task 4a.16
-- ADR:      docs/adr/0004-secrets-in-vault.md
-- Rules:    docs/standards/database-conventions.md §8 (« Encrypted columns », « Key versions »)
-- Runbooks: docs/runbooks/pii-key-escrow.md, docs/runbooks/pii-key-rotation.md
--
-- Key choices
-- * Versioned secret names: version 1 is the existing Vault secret `pii_encryption_key`, version
--   n ≥ 2 is `pii_encryption_key_v<n>`. Every encrypted row records the version it was written
--   with (`key_version smallint`), so a rotation re-encrypts row by row while both keys exist.
-- * The version arguments are `integer`, not `smallint`: a literal (`encrypt_pii(x, 2)`, typed
--   by hand in the rotation runbook) is an integer and would not resolve to a smallint
--   parameter, while a `smallint` column casts implicitly to integer.
-- * The one-argument helpers stay and mean version 1 (Phase 2 callers and tests). Code writes
--   with the two-argument forms: set_bank_details and reveal_bank_account_number move to them
--   here, with the same signatures and grants.
-- * The write version is the highest version that has a canary row
--   (private.pii_current_key_version()). Adding the canary of a new key is therefore the one
--   act that switches writes to it, and only a key the deploy health check proves readable can
--   receive new data. No canary at all (broken environment) falls back to version 1.
-- * The canary is a fixed test value ('mana-pii-canary', not personal data) encrypted with each
--   key, in private.pii_canary (schema not exposed, no grant, RLS on without a policy).
-- * public.pii_health_check() (definer, service_role only) returns true when every canary row
--   decrypts to the test value, false otherwise: no row, a missing key, a wrong key or corrupt
--   bytes. It never raises for those, never returns a key or a value, and its warnings name only
--   the key version and the SQLSTATE. The deploy job runs it after `supabase db push`.
-- * The canary is seeded only when the version 1 key is readable. Raising here would stop
--   `db push` in the middle of a deploy (later migrations unapplied while Vercel ships the
--   app); an empty canary instead makes the health check fail loudly after the push.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_pii_key_versions', true);

-- -----------------------------------------------------------------------------
-- Versioned key and helpers (granted to no role, like the Phase 2 ones)
-- -----------------------------------------------------------------------------
-- Null when the version is below 1 or its secret does not exist.
create function private.pii_key(p_version integer)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select ds.decrypted_secret
    from vault.decrypted_secrets ds
   where p_version >= 1
     and ds.name = case when p_version = 1 then 'pii_encryption_key'
                        else 'pii_encryption_key_v' || p_version::text end
$$;

create function private.encrypt_pii(p_value text, p_version integer)
returns bytea
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_value is null then
    return null;
  end if;
  v_key := private.pii_key(p_version);
  if v_key is null then
    raise exception 'Clé de chiffrement introuvable (version %)', p_version using errcode = '55000';
  end if;
  return extensions.pgp_sym_encrypt(p_value, v_key, 'cipher-algo=aes256, s2k-digest-algo=sha256');
end;
$$;

-- Only ever pass bytes read from an encrypted column, with that row's key_version.
create function private.decrypt_pii(p_value bytea, p_version integer)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_value is null then
    return null;
  end if;
  v_key := private.pii_key(p_version);
  if v_key is null then
    raise exception 'Clé de chiffrement introuvable (version %)', p_version using errcode = '55000';
  end if;
  return extensions.pgp_sym_decrypt(p_value, v_key);
end;
$$;

-- The one-argument forms are version 1 (same signatures, so their grants (none) are kept).
create or replace function private.pii_key()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select private.pii_key(1)
$$;

create or replace function private.encrypt_pii(p_value text)
returns bytea
language sql
security invoker
set search_path = ''
as $$
  select private.encrypt_pii(p_value, 1)
$$;

create or replace function private.decrypt_pii(p_value bytea)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select private.decrypt_pii(p_value, 1)
$$;

-- -----------------------------------------------------------------------------
-- Canary
-- -----------------------------------------------------------------------------
create table private.pii_canary (
  key_version smallint primary key,
  ciphertext bytea not null,
  created_at timestamptz not null default now(),
  constraint pii_canary_key_version_check check (key_version >= 1)
);
revoke all on private.pii_canary from public, anon, authenticated, service_role;
alter table private.pii_canary enable row level security;
-- No policy and no grant on purpose: only pii_health_check and the owner touch it.

do $$
begin
  if private.pii_key(1) is null then
    raise warning 'pii_encryption_key is unreadable: no canary seeded, pii_health_check() will return false (docs/runbooks/pii-key-escrow.md)';
  else
    insert into private.pii_canary (key_version, ciphertext)
    values (1, private.encrypt_pii('mana-pii-canary', 1));
  end if;
end;
$$;

-- The version new values are written with: the highest version with a canary row.
create function private.pii_current_key_version()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(max(c.key_version)::integer, 1) from private.pii_canary c
$$;

revoke all on function
  private.pii_key(integer),
  private.encrypt_pii(text, integer),
  private.decrypt_pii(bytea, integer),
  private.pii_current_key_version()
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Health check (deploy job, `.github/workflows/supabase-migrations.yml`)
-- -----------------------------------------------------------------------------
create function public.pii_health_check()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_plain text;
  v_checked int := 0;
begin
  for v_row in select c.key_version, c.ciphertext from private.pii_canary c order by c.key_version loop
    begin
      v_plain := private.decrypt_pii(v_row.ciphertext, v_row.key_version);
    exception when others then
      raise warning 'pii_health_check: key version % does not decrypt its canary (SQLSTATE %)', v_row.key_version, sqlstate;
      return false;
    end;
    if v_plain is distinct from 'mana-pii-canary' then
      raise warning 'pii_health_check: key version % decrypts its canary to an unexpected value', v_row.key_version;
      return false;
    end if;
    v_checked := v_checked + 1;
  end loop;

  if v_checked = 0 then
    raise warning 'pii_health_check: no canary row';
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.pii_health_check() from public, anon, authenticated;
grant execute on function public.pii_health_check() to service_role;

-- -----------------------------------------------------------------------------
-- organization_bank_details: key version per row
-- -----------------------------------------------------------------------------
-- Existing rows were all written with pii_encryption_key: the default 1 is their true version.
alter table public.organization_bank_details
  add column key_version smallint not null default 1,
  add constraint organization_bank_details_key_version_check check (key_version >= 1);

-- Same body as *_core_bank_details.sql, but decrypting with the row's key_version.
create or replace function public.reveal_bank_account_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_value bytea;
  v_version smallint;
begin
  if not private.has_permission('settings.bank_manage') then
    raise exception 'Permission refusée : settings.bank_manage' using errcode = '42501';
  end if;

  select b.account_number, b.key_version into v_value, v_version
    from public.organization_bank_details b where b.org_id = v_org;
  -- No bank details yet: nothing is revealed, so no audit row is written.
  if v_value is null then
    return null;
  end if;

  insert into public.audit_log (org_id, table_name, record_id, action, changed_fields, actor_id, actor_role, source)
  values (
    v_org, 'organization_bank_details', v_org::text, 'read',
    jsonb_build_object('fields', jsonb_build_array('account_number')),
    auth.uid(), private.current_user_role(), 'rpc:reveal_bank_account_number'
  );
  return private.decrypt_pii(v_value, v_version);
end;
$$;

-- Same body as *_core_bank_details.sql, but a new account is encrypted with the current key
-- version and records it. Keeping the stored account (blank p_account_number) keeps its version.
create or replace function public.set_bank_details(
  p_institution_number text,
  p_transit_number text,
  p_account_number text,
  p_etransfer_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_account text := nullif(pg_catalog.regexp_replace(coalesce(p_account_number, ''), '[ \t\r\n-]', '', 'g'), '');
  v_institution text := pg_catalog.btrim(p_institution_number, E' \t\r\n');
  v_transit text := pg_catalog.btrim(p_transit_number, E' \t\r\n');
  v_email text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(p_etransfer_email, ''), E' \t\r\n'), ''));
  v_version integer;
begin
  if not private.has_permission('settings.bank_manage') then
    raise exception 'Permission refusée : settings.bank_manage' using errcode = '42501';
  end if;
  if v_institution is null or v_institution !~ '^[0-9]{3}$' then
    raise exception 'Le numéro d''institution compte 3 chiffres.' using errcode = 'P0001';
  end if;
  if v_transit is null or v_transit !~ '^[0-9]{5}$' then
    raise exception 'Le numéro de transit compte 5 chiffres.' using errcode = 'P0001';
  end if;
  if v_account is not null and v_account !~ '^[0-9]{7,12}$' then
    raise exception 'Le numéro de compte compte de 7 à 12 chiffres.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Courriel Interac invalide.' using errcode = 'P0001';
  end if;

  if v_account is null then
    update public.organization_bank_details b
       set institution_number = v_institution,
           transit_number = v_transit,
           etransfer_email = v_email,
           updated_by = auth.uid()
     where b.org_id = v_org;
    if not found then
      raise exception 'Le numéro de compte est requis.' using errcode = 'P0001';
    end if;
  else
    v_version := private.pii_current_key_version();
    insert into public.organization_bank_details
      (org_id, institution_number, transit_number, account_number, account_last4, key_version, etransfer_email, updated_by)
    values
      (v_org, v_institution, v_transit, private.encrypt_pii(v_account, v_version), right(v_account, 4), v_version,
       v_email, auth.uid())
    on conflict (org_id) do update
      set institution_number = excluded.institution_number,
          transit_number = excluded.transit_number,
          account_number = excluded.account_number,
          account_last4 = excluded.account_last4,
          key_version = excluded.key_version,
          etransfer_email = excluded.etransfer_email,
          updated_by = excluded.updated_by;
  end if;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
