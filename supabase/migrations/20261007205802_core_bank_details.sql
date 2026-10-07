-- =============================================================================
-- Clinic bank details, account number encrypted (ADR 0004)
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §3.4
-- * The data key is a Vault secret (pii_encryption_key). Vault encrypts it with
--   a root key kept outside the database, so a dump alone does not reveal it.
-- * private.pii_key / encrypt_pii / decrypt_pii (pgcrypto, AES-256, S2K SHA-256)
--   are SECURITY INVOKER and granted to no role: they work only inside the
--   SECURITY DEFINER RPCs owned by postgres, so even a stray future grant
--   would give a client nothing (clients cannot read vault.decrypted_secrets).
-- * The table is revoked from service_role too.
-- * org_secrets functions (get_org_secret, the vault-delete trigger) are
--   tightened here so a forged org_secrets row can never reach this key.
-- * Clients have no privilege on the table: they use get_bank_details (masked),
--   reveal_bank_account_number (audited read) and set_bank_details.
-- * Every bank value is redacted from the audit trail: audit.view must not
--   reveal what settings.bank_manage guards. Changes stay visible (« [redacted] »).
-- * Phase 4 reuses the helpers for professionals' SIN and bank accounts.
-- * Patterns use [0-9], never \d (ICU: \d also matches non-ASCII digits).
-- =============================================================================

-- Reads of sensitive data are audited too (constraint name checked in pg_constraint).
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('insert', 'update', 'delete', 'read'));

-- -----------------------------------------------------------------------------
-- Encryption key and helpers
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'pii_encryption_key') then
    perform vault.create_secret(
      pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'),
      'pii_encryption_key',
      'Clé de chiffrement des renseignements sensibles (ADR 0004). Ne jamais supprimer ni remplacer.'
    );
  end if;
end;
$$;

create function private.pii_key()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'pii_encryption_key'
$$;

create function private.encrypt_pii(p_value text)
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
  v_key := private.pii_key();
  if v_key is null then
    raise exception 'Clé de chiffrement introuvable' using errcode = '55000';
  end if;
  return extensions.pgp_sym_encrypt(p_value, v_key, 'cipher-algo=aes256, s2k-digest-algo=sha256');
end;
$$;

-- Only ever pass bytes read from an encrypted column, never caller-supplied bytes.
-- pgp_sym_decrypt reads the cipher and S2K options from the message, so rows
-- written with older options still decrypt.
create function private.decrypt_pii(p_value bytea)
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
  v_key := private.pii_key();
  if v_key is null then
    raise exception 'Clé de chiffrement introuvable' using errcode = '55000';
  end if;
  return extensions.pgp_sym_decrypt(p_value, v_key);
end;
$$;

revoke all on function private.pii_key(), private.encrypt_pii(text), private.decrypt_pii(bytea)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Org secrets: only touch the Vault secret named after the row
-- -----------------------------------------------------------------------------
-- set_org_secret names each secret 'org:<org_id>:<key>'. Matching that exact name
-- means a forged org_secrets row pointing at another secret (pii_encryption_key,
-- or another org's) can neither read nor delete it. Same signatures; grants kept.
create or replace function public.get_org_secret(p_org_id uuid, p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from public.org_secrets s
    join vault.decrypted_secrets ds
      on ds.id = s.vault_secret_id
     and ds.name = pg_catalog.format('org:%s:%s', s.org_id, s.key)
   where s.org_id = p_org_id
     and s.key = p_key
$$;

create or replace function private.org_secrets_delete_vault()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets vs
   where vs.id = old.vault_secret_id
     and vs.name = pg_catalog.format('org:%s:%s', old.org_id, old.key);
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------
create table public.organization_bank_details (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  institution_number text not null,
  transit_number text not null,
  account_number bytea not null,
  account_last4 text not null,
  etransfer_email text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint organization_bank_details_institution_number_check check (institution_number ~ '^[0-9]{3}$'),
  constraint organization_bank_details_transit_number_check check (transit_number ~ '^[0-9]{5}$'),
  constraint organization_bank_details_account_last4_check check (account_last4 ~ '^[0-9]{4}$'),
  constraint organization_bank_details_etransfer_email_check check (etransfer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
create index organization_bank_details_updated_by_idx on public.organization_bank_details (updated_by);

create trigger organization_bank_details_set_updated_at
  before update on public.organization_bank_details
  for each row execute function private.set_updated_at();

create trigger organization_bank_details_audit
  after insert or update or delete on public.organization_bank_details
  for each row execute function private.audit_trigger(
    'account_number', 'account_last4', 'institution_number', 'transit_number', 'etransfer_email');

revoke all on public.organization_bank_details from anon, authenticated;
-- Server code does not need the ciphertext either (conventions §3: revoke explicitly).
revoke all on public.organization_bank_details from service_role;
alter table public.organization_bank_details enable row level security;
-- No policy and no grant on purpose: only the SECURITY DEFINER RPCs below touch it.

-- -----------------------------------------------------------------------------
-- RPCs (settings.bank_manage)
-- -----------------------------------------------------------------------------
create function public.get_bank_details()
returns table (
  institution_number text,
  transit_number text,
  account_last4 text,
  etransfer_email text,
  updated_at timestamptz,
  updated_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.has_permission('settings.bank_manage') then
    raise exception 'Permission refusée : settings.bank_manage' using errcode = '42501';
  end if;
  return query
    select b.institution_number, b.transit_number, b.account_last4, b.etransfer_email, b.updated_at, p.display_name
      from public.organization_bank_details b
      left join public.profiles p on p.user_id = b.updated_by
     where b.org_id = private.current_user_org_id();
end;
$$;

create function public.reveal_bank_account_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_value bytea;
begin
  if not private.has_permission('settings.bank_manage') then
    raise exception 'Permission refusée : settings.bank_manage' using errcode = '42501';
  end if;

  select b.account_number into v_value from public.organization_bank_details b where b.org_id = v_org;
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
  return private.decrypt_pii(v_value);
end;
$$;

-- p_account_number null or blank keeps the stored account (editing the transit alone).
-- Spaces and hyphens are stripped (« 765-4321 »); any other character is refused,
-- never stripped, so « abc » is an error and not a silent « keep ».
-- Institution and transit are trimmed; the Interac email is trimmed and lowercased
-- (blank → null).
create function public.set_bank_details(
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
    insert into public.organization_bank_details
      (org_id, institution_number, transit_number, account_number, account_last4, etransfer_email, updated_by)
    values
      (v_org, v_institution, v_transit, private.encrypt_pii(v_account), right(v_account, 4), v_email, auth.uid())
    on conflict (org_id) do update
      set institution_number = excluded.institution_number,
          transit_number = excluded.transit_number,
          account_number = excluded.account_number,
          account_last4 = excluded.account_last4,
          etransfer_email = excluded.etransfer_email,
          updated_by = excluded.updated_by;
  end if;
end;
$$;

revoke all on function
  public.get_bank_details(),
  public.reveal_bank_account_number(),
  public.set_bank_details(text, text, text, text)
from public, anon, authenticated, service_role;
grant execute on function
  public.get_bank_details(),
  public.reveal_bank_account_number(),
  public.set_bank_details(text, text, text, text)
to authenticated;
-- service_role is revoked above (Supabase's default privileges grant it EXECUTE):
-- nothing server-side needs these yet, and they act for a user (auth.uid()).
