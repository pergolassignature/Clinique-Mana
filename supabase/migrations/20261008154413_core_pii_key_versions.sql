-- =============================================================================
-- PII key versions, canary and health check (ADR 0004 « Before Phase 4 »)
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
-- * One version per row: a write re-encrypts every encrypted column of the row with the current
--   version in the same statement and sets `key_version` to it (columns it does not change are
--   decrypted with the row's old version and re-encrypted, unless the row is already current).
-- * The version arguments are `integer`, not `smallint`: a literal (`encrypt_pii(x, 2)`, typed
--   by hand in the rotation runbook) is an integer and would not resolve to a smallint
--   parameter, while a `smallint` column casts implicitly to integer.
-- * The one-argument helpers stay and mean version 1 (Phase 2 callers and tests). Code writes
--   with the two-argument forms: set_bank_details and reveal_bank_account_number move to them
--   here, with the same signatures and grants.
-- * The list of encrypted columns lives in ONE place, private.pii_encrypted_values(). Every new
--   encrypted table or column is added to it (`create or replace`) in the migration that creates
--   it; the health check, the canary seeding and the rotation runbook all read it.
-- * The write version is the highest version that has a canary row
--   (private.pii_current_key_version()). Adding the canary of a new key is therefore the one
--   act that switches writes to it. No canary at all (broken environment) falls back to version 1.
-- * The canary is a fixed test value ('mana-pii-canary', not personal data) encrypted with each
--   key, in private.pii_canary (schema not exposed, no grant, RLS on without a policy). It is only
--   ever created by private.pii_seed_canary(v), which refuses unless every value stored with
--   version v decrypts with the current v key: a canary never vouches for a key that would not
--   read the data.
-- * public.pii_health_check() (definer, granted to no role: the owner `postgres` runs it, from
--   the SQL Editor or the GitHub jobs) returns true when every canary decrypts to the test value,
--   every version that holds stored data has its key and a canary, AND every stored value decrypts
--   with its row's version; false otherwise. The last step is a full scan (one decryption per
--   stored value, cheap at the clinic's size: about 100 values). It never raises, never returns a
--   key or a value, and its warnings name only the key version, the table, the column and the
--   SQLSTATE. GitHub runs it after each migration push and every day
--   (.github/workflows/supabase-migrations.yml, pii-health.yml): a red job is an alarm, it
--   blocks nothing (Vercel deploys the app regardless).
-- * The version 1 canary is seeded here only when the key reads every existing encrypted value.
--   Raising instead would stop `db push` in the middle of a deploy (later migrations unapplied
--   while Vercel ships the app); a missing canary keeps the health check red instead.
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
-- organization_bank_details: key version per row
-- -----------------------------------------------------------------------------
-- Existing rows were all written with pii_encryption_key: the default 1 is their true version.
alter table public.organization_bank_details
  add column key_version smallint not null default 1,
  add constraint organization_bank_details_key_version_check check (key_version >= 1);

-- -----------------------------------------------------------------------------
-- The list of encrypted columns (the one place to extend)
-- -----------------------------------------------------------------------------
-- Every stored ciphertext with its row's key (the primary key as text, never a value) and the
-- version it was written with: one `union all` branch per encrypted column, null values left out.
-- A new encrypted table or column is added here, with `create or replace`, in the migration that
-- creates it (conventions §8; 4a.17 adds professional_private.sin and .bank_account, 4b.1
-- professional_submission_private's). pgTAP 047 fails while a table with a key_version column is
-- missing from this body. Granted to no role.
create function private.pii_encrypted_values()
returns table (table_name text, column_name text, row_key text, key_version integer, ciphertext bytea)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'organization_bank_details'::text, 'account_number'::text, b.org_id::text, b.key_version::integer, b.account_number
    from public.organization_bank_details b
   where b.account_number is not null
$$;

-- The key versions that hold stored data, per table, with the number of values. A row with no
-- ciphertext needs no key, so it does not count. Inventory of the rotation runbook.
create function private.pii_key_versions_in_use()
returns table (key_version integer, table_name text, value_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.key_version, e.table_name, count(*)
    from private.pii_encrypted_values() e
   group by e.key_version, e.table_name
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
-- No policy and no grant on purpose: only pii_seed_canary, pii_health_check and the owner touch it.

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

-- Creates the canary of a key version, only when that key reads every value already stored with
-- it (none, for a new key). Returns true when it created the canary; otherwise false with a
-- WARNING naming only the version and the SQLSTATE: the version already has a canary (left
-- unchanged, also when a concurrent call created it first: `on conflict do nothing`), its key is
-- missing, or a stored value does not decrypt with it (a key replaced after data was written).
-- The only way the migration and the runbooks create a canary.
create function private.pii_seed_canary(p_version integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_values bigint;
begin
  if p_version is null or p_version < 1 then
    raise exception 'Version de clé invalide' using errcode = '22023';
  end if;
  if exists (select 1 from private.pii_canary c where c.key_version = p_version) then
    raise warning 'pii_seed_canary: key version % already has a canary (left unchanged)', p_version;
    return false;
  end if;
  if private.pii_key(p_version) is null then
    raise warning 'pii_seed_canary: key version % is missing: no canary, pii_health_check() stays false (docs/runbooks/pii-key-escrow.md)', p_version;
    return false;
  end if;

  begin
    -- count(expr) evaluates the decryption for every value; the plaintexts go nowhere.
    select count(private.decrypt_pii(e.ciphertext, e.key_version)) into v_values
      from private.pii_encrypted_values() e
     where e.key_version = p_version;
  exception when others then
    raise warning 'pii_seed_canary: key version % does not decrypt every value stored with it (SQLSTATE %): no canary, pii_health_check() stays false (docs/runbooks/pii-key-escrow.md)', p_version, sqlstate;
    return false;
  end;

  -- A concurrent call may have created it since the check above: it waits for that call's commit
  -- on the primary key, then inserts nothing.
  insert into private.pii_canary (key_version, ciphertext)
  values (p_version, private.encrypt_pii('mana-pii-canary', p_version))
  on conflict (key_version) do nothing;
  if not found then
    raise warning 'pii_seed_canary: key version % already has a canary (left unchanged)', p_version;
    return false;
  end if;
  return true;
end;
$$;

-- Version 1: never raises (see the header). A false result leaves the health check red.
do $$
begin
  perform private.pii_seed_canary(1);
end;
$$;

revoke all on function
  private.pii_key(integer),
  private.encrypt_pii(text, integer),
  private.decrypt_pii(bytea, integer),
  private.pii_encrypted_values(),
  private.pii_key_versions_in_use(),
  private.pii_current_key_version(),
  private.pii_seed_canary(integer)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Health check (GitHub: .github/workflows/supabase-migrations.yml and pii-health.yml)
-- -----------------------------------------------------------------------------
-- Definer so that a future monitoring role could be granted this function alone, never the
-- private helpers. Today it is granted to no role: `postgres` (its owner) runs it.
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
  v_has_key boolean;
  v_checked int := 0;
begin
  -- 1. Every canary decrypts to the test value with its key.
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

  -- 2. Every version that holds stored data has its key and a canary. Step 1 proved that key reads
  -- its canary, not that it reads the data: step 3 does.
  for v_row in select u.key_version, u.table_name from private.pii_key_versions_in_use() u order by 1, 2 loop
    begin
      v_has_key := private.pii_key(v_row.key_version) is not null;
    exception when others then
      raise warning 'pii_health_check: key version % (used by %) could not be read (SQLSTATE %)', v_row.key_version, v_row.table_name, sqlstate;
      return false;
    end;
    if not v_has_key then
      raise warning 'pii_health_check: key version % is used by % but its key is missing', v_row.key_version, v_row.table_name;
      return false;
    end if;
    if not exists (select 1 from private.pii_canary c where c.key_version = v_row.key_version) then
      raise warning 'pii_health_check: key version % is used by % but has no canary', v_row.key_version, v_row.table_name;
      return false;
    end if;
  end loop;

  -- 3. Every stored value decrypts with its row's version: a canary only proves the key it was
  -- made with, so data restored or copied from another project (production on staging, a new
  -- project restored without the escrowed key) or written before the key was replaced is caught
  -- here. Full scan on purpose: one decryption (and one subtransaction) per stored value, well
  -- under a second for today's ~50 professionals (SIN and account) and one bank row; revisit
  -- (sample, or check only rows changed since the last run) if it reaches tens of thousands
  -- (conventions §8). The plaintext goes nowhere.
  for v_row in select e.table_name, e.column_name, e.key_version, e.ciphertext
                 from private.pii_encrypted_values() e order by 1, 2, 3 loop
    begin
      v_plain := private.decrypt_pii(v_row.ciphertext, v_row.key_version);
    exception when others then
      raise warning 'pii_health_check: a value of %.% stored with key version % does not decrypt (SQLSTATE %)', v_row.table_name, v_row.column_name, v_row.key_version, sqlstate;
      return false;
    end;
  end loop;
  return true;
end;
$$;

revoke all on function public.pii_health_check() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Bank details RPCs: decrypt with the row's version, write with the current one
-- -----------------------------------------------------------------------------
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

-- Same body as *_core_bank_details.sql, but every write leaves the row on the current key
-- version (conventions §8, « one version per row »): a new account is encrypted with it; a kept
-- account (blank p_account_number) is re-encrypted from the row's version in the same statement,
-- unless the row is already current (no new ciphertext, so no spurious « changed » audit entry).
-- A kept account that does not decrypt (its key is missing, or the row was copied from another
-- environment) raises a clean P0001 with a hint, never pgcrypto's error: entering the full
-- account number again replaces it (docs/runbooks/pii-key-rotation.md, « Une valeur illisible »).
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

  v_version := private.pii_current_key_version();
  if v_account is null then
    begin
      update public.organization_bank_details b
         set institution_number = v_institution,
             transit_number = v_transit,
             etransfer_email = v_email,
             account_number = case when b.key_version = v_version then b.account_number
                                   else private.encrypt_pii(private.decrypt_pii(b.account_number, b.key_version), v_version)
                              end,
             key_version = v_version,
             updated_by = auth.uid()
       where b.org_id = v_org;
    exception
      -- 39000: pgcrypto (wrong key or corrupt data); 55000: decrypt_pii (the row's key is missing).
      when sqlstate '39000' or sqlstate '55000' then
        raise exception 'Le numéro de compte enregistré ne peut pas être lu avec la clé de cet environnement.'
          using errcode = 'P0001',
                hint = 'Saisissez de nouveau le numéro de compte au complet : il remplacera celui qui est enregistré.';
    end;
    if not found then
      raise exception 'Le numéro de compte est requis.' using errcode = 'P0001';
    end if;
  else
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
