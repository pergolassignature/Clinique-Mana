-- =============================================================================
-- Professionnels: encrypted private data (SIN, bank account) and compensation terms
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.5, §3.6, §3.9
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4a.17 (P4-7, P4-8, P4-9, P4-140…)
-- ADR:     docs/adr/0004-secrets-in-vault.md
-- Rules:   docs/standards/database-conventions.md §7, §8 (« Encrypted columns », « Key versions »)
-- Runbook: docs/runbooks/pii-key-rotation.md (step 4 re-encrypts professional_private)
--
-- Key choices
-- * professional_private (1:1 with professionals): the SIN and the bank account are pgcrypto
--   ciphertexts (private.encrypt_pii, the row's key_version), with sin_last3 / bank_account_last4
--   for display. Business, TPS and TVQ numbers, institution and transit are plain text (printed on
--   invoices, not secret) but live here, behind the same permission. No client privilege, revoked
--   from service_role too, RLS on without a policy: only the definer RPCs below touch it.
-- * Every value column is redacted by the audit trigger (design decision #31): the log shows that
--   the private data changed, never a value, a mask or a ciphertext. list_professional_history
--   returns these rows with changed_fields null (reads keep their field names only).
-- * One key version per row (conventions §8): set_professional_private and
--   clear_professional_private_field leave the whole row on private.pii_current_key_version() in
--   one statement; a kept ciphertext is re-encrypted from the row's version (left as is when the
--   row is already current, so no spurious audit change). A kept value that does not decrypt
--   (key missing 55000, wrong key 39000) raises a clean P0001 naming the field, with a HINT.
-- * Encrypted fields: null or blank keeps the stored value; plain fields: as given, blank clears.
--   Spaces, tabs, line breaks and hyphens are stripped from numbers; any other character is
--   refused (never stripped). SIN: 9 digits and the Luhn check, refused while the module setting
--   collect_sin is off (P4-7). No message ever repeats a value.
-- * Reveals (reveal_professional_private) decrypt with the row's version and write an audit_log
--   row: action 'read', source 'rpc:reveal_professional_private', changed_fields
--   {"fields": ["sin" | "bank_account"]}. Nothing stored → null, no audit row.
-- * The two encrypted columns are added to private.pii_encrypted_values() (row key
--   professional_id), so the health check, the canary seeding and the rotation runbook see them.
-- * Compensation (design §3.6, P4-8, P4-9): a global catalogue of kinds; per-clinic dated default
--   margin ranges and recognition rules (seeded for every clinic, as tax rates); per-professional
--   dated margins and recognition levels. Periods are [effective_from, effective_to) and never
--   overlap (exclusion constraints). Every set_* RPC closes the open row on the new start date,
--   as add_tax_rate does, under the org row lock (clinic rows) or the professional row lock.
--   Clients read the tables (professionals.compensation, org-scoped); writes are RPCs only. No
--   amount is computed anywhere (P4-8).
-- * Permissions (4a.1): professionals.private for the private data, professionals.compensation
--   for the rest; both admin-only by default. service_role gets nothing.
-- * Patterns use [0-9], never \d (ICU: \d also matches non-ASCII digits).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_compensation_private', true);

-- -----------------------------------------------------------------------------
-- SIN check digit (Luhn). Granted to no role: only the definer RPC calls it.
-- -----------------------------------------------------------------------------
-- True when p_sin is 9 ASCII digits whose Luhn sum is a multiple of 10 (every second digit,
-- from the second, is doubled and its digits added).
create function private.is_valid_sin(p_sin text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_sin ~ '^[0-9]{9}$', false)
     and (select sum(case when i % 2 = 0 then (d * 2) / 10 + (d * 2) % 10 else d end) % 10 = 0
            from (select g.i, pg_catalog.substr(p_sin, g.i, 1)::int as d
                    from pg_catalog.generate_series(1, 9) as g(i)) x)
$$;
revoke all on function private.is_valid_sin(text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- professional_private
-- -----------------------------------------------------------------------------
create table public.professional_private (
  professional_id uuid primary key,
  org_id uuid not null,
  sin bytea,
  sin_last3 text,
  business_number text,
  gst_number text,
  qst_number text,
  bank_institution text,
  bank_transit text,
  bank_account bytea,
  bank_account_last4 text,
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint professional_private_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_private_sin_last3_check check (sin_last3 ~ '^[0-9]{3}$'),
  constraint professional_private_business_number_check check (business_number ~ '^[0-9]{9}$'),
  constraint professional_private_gst_number_check check (gst_number ~ '^[0-9]{9}RT[0-9]{4}$'),
  constraint professional_private_qst_number_check check (qst_number ~ '^[0-9]{10}TQ[0-9]{4}$'),
  constraint professional_private_bank_institution_check check (bank_institution ~ '^[0-9]{3}$'),
  constraint professional_private_bank_transit_check check (bank_transit ~ '^[0-9]{5}$'),
  constraint professional_private_bank_account_last4_check check (bank_account_last4 ~ '^[0-9]{4}$'),
  constraint professional_private_key_version_check check (key_version >= 1),
  constraint professional_private_sin_pair_check check ((sin is null) = (sin_last3 is null)),
  constraint professional_private_bank_account_pair_check check ((bank_account is null) = (bank_account_last4 is null))
);
create index professional_private_org_idx on public.professional_private (org_id);
create index professional_private_updated_by_idx on public.professional_private (updated_by);

revoke all on public.professional_private from anon, authenticated;
-- Server code does not need the ciphertexts either (conventions §3, §8: revoke explicitly).
revoke all on public.professional_private from service_role;
alter table public.professional_private enable row level security;
-- No policy and no grant on purpose: only the SECURITY DEFINER RPCs below touch it.

create trigger professional_private_set_updated_at before update on public.professional_private
  for each row execute function private.set_updated_at();
-- Loi 25: no value, mask or ciphertext in the log; a change shows as « [redacted] ».
create trigger professional_private_audit after insert or update or delete on public.professional_private
  for each row execute function private.audit_trigger(
    'sin', 'sin_last3', 'business_number', 'gst_number', 'qst_number',
    'bank_institution', 'bank_transit', 'bank_account', 'bank_account_last4');

-- -----------------------------------------------------------------------------
-- The list of encrypted columns (4a.16): professional_private's two branches added
-- -----------------------------------------------------------------------------
-- Same signature, grants (none) and contract as *_core_pii_key_versions.sql.
create or replace function private.pii_encrypted_values()
returns table (table_name text, column_name text, row_key text, key_version integer, ciphertext bytea)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'organization_bank_details'::text, 'account_number'::text, b.org_id::text, b.key_version::integer, b.account_number
    from public.organization_bank_details b
   where b.account_number is not null
  union all
  select 'professional_private'::text, 'sin'::text, p.professional_id::text, p.key_version::integer, p.sin
    from public.professional_private p
   where p.sin is not null
  union all
  select 'professional_private'::text, 'bank_account'::text, p.professional_id::text, p.key_version::integer, p.bank_account
    from public.professional_private p
   where p.bank_account is not null
$$;

-- -----------------------------------------------------------------------------
-- Private data RPCs (professionals.private)
-- -----------------------------------------------------------------------------
-- Masked values of one professional of the caller's clinic: always one row (nulls when nothing
-- is stored), so « nothing stored » and « professional not found » (P0001) differ.
create function public.get_professional_private(p_id uuid)
returns table (
  sin_last3 text,
  business_number text,
  gst_number text,
  qst_number text,
  bank_institution text,
  bank_transit text,
  bank_account_last4 text,
  updated_at timestamptz,
  updated_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('professionals.private') then
    raise exception 'Permission refusée : professionals.private' using errcode = '42501';
  end if;
  if not exists (select 1 from public.professionals p where p.id = p_id and p.org_id = v_org) then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  return query
    select pp.sin_last3, pp.business_number, pp.gst_number, pp.qst_number, pp.bank_institution,
           pp.bank_transit, pp.bank_account_last4, pp.updated_at, pr.display_name
      from (select 1) one
      left join public.professional_private pp on pp.professional_id = p_id and pp.org_id = v_org
      left join public.profiles pr on pr.user_id = pp.updated_by;
end;
$$;

-- The clean refusal for a stored value that does not decrypt with this environment's key
-- (conventions §8): names the field, never pgcrypto's error, and says how to fix it. A null field
-- (every kept value reads, so the write key itself is missing) is an environment fault: 55000,
-- which the UI shows as a generic error and reports.
create function private.raise_unreadable_private_value(p_field text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_field is null then
    raise exception 'Clé de chiffrement introuvable pour l''écriture (pii_health_check).' using errcode = '55000';
  end if;
  if p_field = 'sin' then
    raise exception 'Le NAS enregistré ne peut pas être lu avec la clé de cet environnement.'
      using errcode = 'P0001',
            hint = 'Retirez le NAS enregistré, ou saisissez-le de nouveau au complet : il remplacera celui qui est enregistré.';
  end if;
  raise exception 'Le numéro de compte enregistré ne peut pas être lu avec la clé de cet environnement.'
    using errcode = 'P0001',
          hint = 'Saisissez de nouveau le numéro de compte au complet : il remplacera celui qui est enregistré.';
end;
$$;

-- Which kept ciphertext of a row does not decrypt with its version: 'sin', 'bank_account', or
-- null. Called only after a write failed with 39000 / 55000, to name the field.
create function private.unreadable_private_field(p_id uuid, p_check_sin boolean, p_check_account boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_row public.professional_private;
begin
  select * into v_row from public.professional_private pp where pp.professional_id = p_id;
  if p_check_sin and v_row.sin is not null then
    begin
      perform private.decrypt_pii(v_row.sin, v_row.key_version);
    exception when sqlstate '39000' or sqlstate '55000' then
      return 'sin';
    end;
  end if;
  if p_check_account and v_row.bank_account is not null then
    begin
      perform private.decrypt_pii(v_row.bank_account, v_row.key_version);
    exception when sqlstate '39000' or sqlstate '55000' then
      return 'bank_account';
    end;
  end if;
  return null;
end;
$$;

-- The plaintext of one encrypted field, and an audit row naming the field (never the value).
-- Nothing stored → null and no audit row.
create function public.reveal_professional_private(p_id uuid, p_field text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_value bytea;
  v_version smallint;
  v_plain text;
begin
  if not private.has_permission('professionals.private') then
    raise exception 'Permission refusée : professionals.private' using errcode = '42501';
  end if;
  -- The field name is never echoed back: a confused caller could pass a value here.
  if p_field is null or p_field not in ('sin', 'bank_account') then
    raise exception 'Champ inconnu (attendu : sin ou bank_account).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.professionals p where p.id = p_id and p.org_id = v_org) then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;

  select case p_field when 'sin' then pp.sin else pp.bank_account end, pp.key_version
    into v_value, v_version
    from public.professional_private pp
   where pp.professional_id = p_id and pp.org_id = v_org;
  if v_value is null then
    return null;
  end if;

  begin
    v_plain := private.decrypt_pii(v_value, v_version);
  exception when sqlstate '39000' or sqlstate '55000' then
    perform private.raise_unreadable_private_value(p_field);
  end;

  insert into public.audit_log (org_id, table_name, record_id, action, changed_fields, actor_id, actor_role, source)
  values (
    v_org, 'professional_private', p_id::text, 'read',
    pg_catalog.jsonb_build_object('fields', pg_catalog.jsonb_build_array(p_field)),
    auth.uid(), private.current_user_role(), 'rpc:reveal_professional_private'
  );
  return v_plain;
end;
$$;

-- Upserts one professional's private data. Encrypted fields (p_sin, p_bank_account): null or
-- blank keeps the stored value. Plain fields: as given, blank clears. Numbers lose spaces, tabs,
-- line breaks and hyphens; TPS / TVQ letters are upper-cased; anything else is refused. The
-- whole row ends on the current key version (conventions §8). Nothing to store and no row yet:
-- no row is created.
create function public.set_professional_private(
  p_id uuid,
  p_sin text,
  p_business_number text,
  p_gst_number text,
  p_qst_number text,
  p_bank_institution text,
  p_bank_transit text,
  p_bank_account text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_strip constant text := '[ \t\r\n-]';
  v_sin text := nullif(pg_catalog.regexp_replace(coalesce(p_sin, ''), v_strip, '', 'g'), '');
  v_bn text := nullif(pg_catalog.regexp_replace(coalesce(p_business_number, ''), v_strip, '', 'g'), '');
  v_gst text := nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_gst_number, ''), v_strip, '', 'g')), '');
  v_qst text := nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_qst_number, ''), v_strip, '', 'g')), '');
  v_institution text := nullif(pg_catalog.regexp_replace(coalesce(p_bank_institution, ''), v_strip, '', 'g'), '');
  v_transit text := nullif(pg_catalog.regexp_replace(coalesce(p_bank_transit, ''), v_strip, '', 'g'), '');
  v_account text := nullif(pg_catalog.regexp_replace(coalesce(p_bank_account, ''), v_strip, '', 'g'), '');
  v_version integer;
  v_bad text;
begin
  if not private.has_permission('professionals.private') then
    raise exception 'Permission refusée : professionals.private' using errcode = '42501';
  end if;

  -- Validation first: the table's checks are a backstop only (their error would print the row).
  if v_sin is not null then
    if not coalesce((private.professionals_setting(v_org, 'collect_sin'))::boolean, false) then
      raise exception 'La collecte du NAS n''est pas activée.' using errcode = 'P0001',
        hint = 'Un administrateur peut l''activer dans Paramètres, section Rémunération.';
    end if;
    if not private.is_valid_sin(v_sin) then
      raise exception 'NAS invalide.' using errcode = 'P0001',
        hint = 'Le NAS compte 9 chiffres, et son dernier chiffre doit correspondre aux huit autres.';
    end if;
  end if;
  if v_bn is not null and v_bn !~ '^[0-9]{9}$' then
    raise exception 'Le numéro d''entreprise (NE) compte 9 chiffres.' using errcode = 'P0001';
  end if;
  if v_gst is not null and v_gst !~ '^[0-9]{9}RT[0-9]{4}$' then
    raise exception 'Numéro de TPS : format attendu 123456789 RT 0001.' using errcode = 'P0001';
  end if;
  if v_qst is not null and v_qst !~ '^[0-9]{10}TQ[0-9]{4}$' then
    raise exception 'Numéro de TVQ : format attendu 1234567890 TQ 0001.' using errcode = 'P0001';
  end if;
  if v_institution is not null and v_institution !~ '^[0-9]{3}$' then
    raise exception 'Le numéro d''institution compte 3 chiffres.' using errcode = 'P0001';
  end if;
  if v_transit is not null and v_transit !~ '^[0-9]{5}$' then
    raise exception 'Le numéro de transit compte 5 chiffres.' using errcode = 'P0001';
  end if;
  if v_account is not null and v_account !~ '^[0-9]{7,12}$' then
    raise exception 'Le numéro de compte compte de 7 à 12 chiffres.' using errcode = 'P0001';
  end if;

  perform private.lock_professional(p_id);
  v_version := private.pii_current_key_version();

  begin
    if v_sin is null and v_account is null and v_bn is null and v_gst is null and v_qst is null
       and v_institution is null and v_transit is null then
      -- Everything blank: clear the plain fields of an existing row; never create an empty one.
      update public.professional_private pp
         set business_number = null, gst_number = null, qst_number = null,
             bank_institution = null, bank_transit = null,
             sin = case when pp.key_version = v_version then pp.sin
                        else private.encrypt_pii(private.decrypt_pii(pp.sin, pp.key_version), v_version) end,
             bank_account = case when pp.key_version = v_version then pp.bank_account
                                 else private.encrypt_pii(private.decrypt_pii(pp.bank_account, pp.key_version), v_version) end,
             key_version = v_version,
             updated_by = auth.uid()
       where pp.professional_id = p_id;
    else
      insert into public.professional_private as pp
        (professional_id, org_id, sin, sin_last3, business_number, gst_number, qst_number,
         bank_institution, bank_transit, bank_account, bank_account_last4, key_version, updated_by)
      values
        (p_id, v_org, private.encrypt_pii(v_sin, v_version), pg_catalog.right(v_sin, 3), v_bn, v_gst, v_qst,
         v_institution, v_transit, private.encrypt_pii(v_account, v_version), pg_catalog.right(v_account, 4),
         v_version, auth.uid())
      on conflict (professional_id) do update
        set sin = case when v_sin is not null then excluded.sin
                       when pp.key_version = v_version then pp.sin
                       else private.encrypt_pii(private.decrypt_pii(pp.sin, pp.key_version), v_version) end,
            sin_last3 = coalesce(excluded.sin_last3, pp.sin_last3),
            business_number = excluded.business_number,
            gst_number = excluded.gst_number,
            qst_number = excluded.qst_number,
            bank_institution = excluded.bank_institution,
            bank_transit = excluded.bank_transit,
            bank_account = case when v_account is not null then excluded.bank_account
                                when pp.key_version = v_version then pp.bank_account
                                else private.encrypt_pii(private.decrypt_pii(pp.bank_account, pp.key_version), v_version) end,
            bank_account_last4 = coalesce(excluded.bank_account_last4, pp.bank_account_last4),
            key_version = excluded.key_version,
            updated_by = excluded.updated_by;
    end if;
  exception
    -- 39000: pgcrypto (wrong key or corrupt data); 55000: decrypt_pii (the row's key is missing).
    when sqlstate '39000' or sqlstate '55000' then
      v_bad := private.unreadable_private_field(p_id, v_sin is null, v_account is null);
      perform private.raise_unreadable_private_value(v_bad);
  end;
end;
$$;

-- Removes the SIN (and its last 3 digits) or the bank account (and its last 4). The other
-- encrypted field is kept, on the current key version (one version per row). Nothing stored: no-op.
create function public.clear_professional_private_field(p_id uuid, p_field text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
  v_bad text;
begin
  if not private.has_permission('professionals.private') then
    raise exception 'Permission refusée : professionals.private' using errcode = '42501';
  end if;
  if p_field is null or p_field not in ('sin', 'bank_account') then
    raise exception 'Champ inconnu (attendu : sin ou bank_account).' using errcode = '22023';
  end if;
  perform private.lock_professional(p_id);
  v_version := private.pii_current_key_version();

  begin
    update public.professional_private pp
       set sin = case when p_field = 'sin' then null
                      when pp.key_version = v_version then pp.sin
                      else private.encrypt_pii(private.decrypt_pii(pp.sin, pp.key_version), v_version) end,
           sin_last3 = case when p_field = 'sin' then null else pp.sin_last3 end,
           bank_account = case when p_field = 'bank_account' then null
                               when pp.key_version = v_version then pp.bank_account
                               else private.encrypt_pii(private.decrypt_pii(pp.bank_account, pp.key_version), v_version) end,
           bank_account_last4 = case when p_field = 'bank_account' then null else pp.bank_account_last4 end,
           key_version = v_version,
           updated_by = auth.uid()
     where pp.professional_id = p_id
       and case p_field when 'sin' then pp.sin is not null else pp.bank_account is not null end;
  exception
    when sqlstate '39000' or sqlstate '55000' then
      v_bad := private.unreadable_private_field(p_id, p_field <> 'sin', p_field <> 'bank_account');
      perform private.raise_unreadable_private_value(v_bad);
  end;
end;
$$;

revoke all on function
  private.raise_unreadable_private_value(text),
  private.unreadable_private_field(uuid, boolean, boolean)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Compensation: catalogue of kinds (global, changed by migration, not audited)
-- -----------------------------------------------------------------------------
create table public.compensation_kinds (
  key text primary key,
  name text not null,
  sort_order int not null,
  constraint compensation_kinds_key_check check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint compensation_kinds_name_check check (char_length(name) between 1 and 80 and private.is_tidy_text(name))
);
revoke all on public.compensation_kinds from anon, authenticated;
grant select on public.compensation_kinds to authenticated;
alter table public.compensation_kinds enable row level security;
create policy compensation_kinds_select on public.compensation_kinds
  for select to authenticated
  using ((select private.has_permission('professionals.compensation')));

insert into public.compensation_kinds (key, name, sort_order) values
  ('consultation', 'Consultation', 10),
  ('workshop', 'Atelier', 20),
  ('late_cancellation', 'Annulation tardive', 30),
  ('other_fees', 'Autres frais', 40)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Compensation: per-clinic default margin ranges (dated)
-- -----------------------------------------------------------------------------
create table public.compensation_defaults (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null references public.compensation_kinds(key),
  margin_min_pct numeric(5, 2) not null,
  margin_max_pct numeric(5, 2) not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint compensation_defaults_range_check check (0 <= margin_min_pct and margin_min_pct <= margin_max_pct and margin_max_pct <= 100),
  constraint compensation_defaults_period_check check (effective_to is null or effective_to > effective_from),
  constraint compensation_defaults_no_overlap exclude using gist (
    org_id with =,
    kind with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
create index compensation_defaults_org_kind_idx on public.compensation_defaults (org_id, kind, effective_from);
create index compensation_defaults_kind_idx on public.compensation_defaults (kind);
create index compensation_defaults_created_by_idx on public.compensation_defaults (created_by);

-- -----------------------------------------------------------------------------
-- Compensation: per-professional margins (dated, P4-9)
-- -----------------------------------------------------------------------------
create table public.professional_compensation (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  kind text not null references public.compensation_kinds(key),
  margin_pct numeric(5, 2) not null,
  effective_from date not null,
  effective_to date,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  -- PK starts with professional_id: audit record ids start with it (history, P4-36).
  constraint professional_compensation_pkey primary key (professional_id, id),
  constraint professional_compensation_id_key unique (id),
  constraint professional_compensation_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_compensation_margin_pct_check check (margin_pct between 0 and 100),
  constraint professional_compensation_note_check check (char_length(note) between 1 and 500 and private.is_tidy_text(note)),
  constraint professional_compensation_period_check check (effective_to is null or effective_to > effective_from),
  constraint professional_compensation_no_overlap exclude using gist (
    professional_id with =,
    kind with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
create index professional_compensation_org_idx on public.professional_compensation (org_id, professional_id);
create index professional_compensation_kind_idx on public.professional_compensation (kind);
create index professional_compensation_created_by_idx on public.professional_compensation (created_by);

-- -----------------------------------------------------------------------------
-- Programme de reconnaissance: per-clinic rules (dated, P4-8) and per-professional levels
-- -----------------------------------------------------------------------------
create table public.recognition_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  step_sessions int not null,
  bonus_per_50min_cents int not null,
  bonus_per_30min_cents int not null,
  cap_pct numeric(5, 2) not null,
  -- How « jusqu'à concurrence de 25 % » is read; 'unconfirmed' until the clinic confirms (P4-8).
  cap_basis text not null default 'unconfirmed',
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint recognition_rules_step_sessions_check check (step_sessions between 1 and 1000),
  constraint recognition_rules_bonus_per_50min_cents_check check (bonus_per_50min_cents between 0 and 10000),
  constraint recognition_rules_bonus_per_30min_cents_check check (bonus_per_30min_cents between 0 and 10000),
  constraint recognition_rules_cap_pct_check check (cap_pct between 0 and 100),
  constraint recognition_rules_cap_basis_check check (cap_basis in ('unconfirmed', 'margin_reduction', 'fee_increase')),
  constraint recognition_rules_note_check check (char_length(note) between 1 and 500 and private.is_tidy_text(note)),
  constraint recognition_rules_period_check check (effective_to is null or effective_to > effective_from),
  constraint recognition_rules_no_overlap exclude using gist (
    org_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
create index recognition_rules_org_idx on public.recognition_rules (org_id, effective_from);
create index recognition_rules_created_by_idx on public.recognition_rules (created_by);

create table public.professional_recognition (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  level int not null,
  sessions_counted int not null,
  effective_from date not null,
  effective_to date,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint professional_recognition_pkey primary key (professional_id, id),
  constraint professional_recognition_id_key unique (id),
  constraint professional_recognition_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_recognition_level_check check (level between 0 and 1000),
  constraint professional_recognition_sessions_counted_check check (sessions_counted between 0 and 100000),
  constraint professional_recognition_note_check check (char_length(note) between 1 and 500 and private.is_tidy_text(note)),
  constraint professional_recognition_period_check check (effective_to is null or effective_to > effective_from),
  constraint professional_recognition_no_overlap exclude using gist (
    professional_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
create index professional_recognition_org_idx on public.professional_recognition (org_id, professional_id);
create index professional_recognition_created_by_idx on public.professional_recognition (created_by);

-- -----------------------------------------------------------------------------
-- Compensation tables: privileges, RLS, audit
-- -----------------------------------------------------------------------------
revoke all on public.compensation_defaults, public.professional_compensation,
              public.recognition_rules, public.professional_recognition
  from anon, authenticated;
grant select on public.compensation_defaults, public.professional_compensation,
                public.recognition_rules, public.professional_recognition
  to authenticated;
alter table public.compensation_defaults enable row level security;
alter table public.professional_compensation enable row level security;
alter table public.recognition_rules enable row level security;
alter table public.professional_recognition enable row level security;

create policy compensation_defaults_select on public.compensation_defaults
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));
create policy professional_compensation_select on public.professional_compensation
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));
create policy recognition_rules_select on public.recognition_rules
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));
create policy professional_recognition_select on public.professional_recognition
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));

create trigger compensation_defaults_audit after insert or update or delete on public.compensation_defaults
  for each row execute function private.audit_trigger();
create trigger professional_compensation_audit after insert or update or delete on public.professional_compensation
  for each row execute function private.audit_trigger();
create trigger recognition_rules_audit after insert or update or delete on public.recognition_rules
  for each row execute function private.audit_trigger();
create trigger professional_recognition_audit after insert or update or delete on public.professional_recognition
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Defaults for every clinic (legacy contract values, from 2017-01-01)
-- -----------------------------------------------------------------------------
create function private.seed_professionals_compensation(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:professionals_compensation', true);

  insert into public.compensation_defaults (org_id, kind, margin_min_pct, margin_max_pct, effective_from)
  select p_org, d.kind, d.min_pct, d.max_pct, date '2017-01-01'
    from (values ('consultation', 25, 30), ('workshop', 25, 25), ('late_cancellation', 30, 30), ('other_fees', 15, 15))
         as d(kind, min_pct, max_pct)
   where not exists (select 1 from public.compensation_defaults c where c.org_id = p_org and c.kind = d.kind);

  insert into public.recognition_rules (org_id, effective_from, step_sessions, bonus_per_50min_cents,
                                        bonus_per_30min_cents, cap_pct, cap_basis)
  select p_org, date '2017-01-01', 50, 50, 25, 25, 'unconfirmed'
   where not exists (select 1 from public.recognition_rules r where r.org_id = p_org);

  -- set_config(…, true) lasts until the end of the transaction: give the caller's source back.
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_professionals_compensation_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_professionals_compensation(new.id);
  return null;
end;
$$;

create trigger organizations_seed_professionals_compensation
  after insert on public.organizations
  for each row execute function private.seed_professionals_compensation_on_org();

revoke all on function private.seed_professionals_compensation(uuid), private.seed_professionals_compensation_on_org()
  from public, anon, authenticated, service_role;

-- Existing organizations (staging).
select private.seed_professionals_compensation(o.id) from public.organizations o;

-- -----------------------------------------------------------------------------
-- Compensation RPCs (professionals.compensation)
-- -----------------------------------------------------------------------------
-- The two shared checks of every dated row.
create function private.assert_compensation_access()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_permission('professionals.compensation') then
    raise exception 'Permission refusée : professionals.compensation' using errcode = '42501';
  end if;
end;
$$;

create function private.assert_compensation_kind(p_kind text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_kind is null or not exists (select 1 from public.compensation_kinds k where k.key = p_kind) then
    raise exception 'Type de rémunération inconnu.' using errcode = '22023';
  end if;
end;
$$;

-- A note as stored (one line, at most 500 characters), or a French P0001.
create function private.compensation_note(p_note text)
returns text
language sql
immutable
set search_path = ''
as $$
  select private.reference_text(p_note, 'La note', 500, false, true)
$$;

-- The refusal when a new dated row does not start after the open one (as add_tax_rate).
create function private.assert_starts_after(p_new date, p_open date, p_message text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_new is null then
    raise exception 'La date d''entrée en vigueur est requise.' using errcode = 'P0001';
  end if;
  if p_open is not null and p_new <= p_open then
    raise exception '% %.', p_message, pg_catalog.to_char(p_open, 'YYYY-MM-DD') using errcode = 'P0001';
  end if;
end;
$$;

-- Appends a default range for a kind: closes the open one on p_effective_from.
create function public.set_compensation_default(p_kind text, p_min numeric, p_max numeric, p_effective_from date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_min numeric := round(p_min, 2);
  v_max numeric := round(p_max, 2);
  v_open public.compensation_defaults;
  v_id uuid;
begin
  perform private.assert_compensation_access();
  perform private.assert_compensation_kind(p_kind);
  if v_min is null or v_max is null or v_min < 0 or v_max > 100 then
    raise exception 'La marge est comprise entre 0 et 100 %%.' using errcode = 'P0001';
  end if;
  if v_min > v_max then
    raise exception 'La marge minimale ne peut pas dépasser la marge maximale.' using errcode = 'P0001';
  end if;

  perform 1 from public.organizations o where o.id = v_org for no key update;
  select * into v_open from public.compensation_defaults d
   where d.org_id = v_org and d.kind = p_kind and d.effective_to is null;
  perform private.assert_starts_after(p_effective_from, v_open.effective_from, 'La nouvelle fourchette doit commencer après le');
  if v_open.id is not null then
    update public.compensation_defaults d set effective_to = p_effective_from where d.id = v_open.id;
  end if;

  insert into public.compensation_defaults (org_id, kind, margin_min_pct, margin_max_pct, effective_from, created_by)
  values (v_org, p_kind, v_min, v_max, p_effective_from, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Removes the last (open) default range of a kind and reopens the previous one, as
-- delete_tax_rate: allowed when the range is not in force yet, or was created less than 24 hours
-- ago (the window to fix a typo); never the first range of a kind (it would be left with none).
create function public.delete_compensation_default(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.compensation_defaults;
  v_reopened int;
begin
  perform private.assert_compensation_access();
  perform 1 from public.organizations o where o.id = v_org for no key update;

  select * into v_row from public.compensation_defaults d where d.id = p_id and d.org_id = v_org;
  if v_row.id is null then
    raise exception 'Fourchette introuvable.' using errcode = 'P0001';
  end if;
  if v_row.effective_to is not null then
    raise exception 'Seule la dernière fourchette peut être supprimée.' using errcode = 'P0001';
  end if;
  if not coalesce(v_row.effective_from > private.clinic_today(), false)
     and not coalesce(v_row.created_at > pg_catalog.now() - interval '24 hours', false) then
    raise exception 'Une fourchette déjà en vigueur ne peut pas être supprimée.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.compensation_defaults d
                  where d.org_id = v_org and d.kind = v_row.kind and d.effective_to = v_row.effective_from) then
    raise exception 'La première fourchette d''un type ne peut pas être supprimée.' using errcode = 'P0001';
  end if;

  delete from public.compensation_defaults d where d.id = v_row.id;
  update public.compensation_defaults d
     set effective_to = null
   where d.org_id = v_org and d.kind = v_row.kind and d.effective_to = v_row.effective_from;
  get diagnostics v_reopened = row_count;
  if v_reopened <> 1 then
    raise exception 'L''historique des fourchettes est incohérent ; contactez le soutien technique.' using errcode = 'P0001';
  end if;
end;
$$;

-- Appends a professional's margin for a kind: closes the open one on p_effective_from. Returns
-- {id, warning}: warning is true when the margin is outside the default range in force on that
-- date (it is stored all the same).
create function public.set_professional_margin(p_id uuid, p_kind text, p_margin_pct numeric, p_effective_from date, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_margin numeric := round(p_margin_pct, 2);
  v_note text;
  v_open public.professional_compensation;
  v_default public.compensation_defaults;
  v_id uuid;
begin
  perform private.assert_compensation_access();
  perform private.assert_compensation_kind(p_kind);
  if v_margin is null or v_margin < 0 or v_margin > 100 then
    raise exception 'La marge est comprise entre 0 et 100 %%.' using errcode = 'P0001';
  end if;
  v_note := private.compensation_note(p_note);

  perform private.lock_professional(p_id);
  select * into v_open from public.professional_compensation c
   where c.professional_id = p_id and c.kind = p_kind and c.effective_to is null;
  perform private.assert_starts_after(p_effective_from, v_open.effective_from, 'La nouvelle marge doit commencer après le');
  if v_open.id is not null then
    update public.professional_compensation c set effective_to = p_effective_from
     where c.professional_id = p_id and c.id = v_open.id;
  end if;

  insert into public.professional_compensation (org_id, professional_id, kind, margin_pct, effective_from, note, created_by)
  values (v_org, p_id, p_kind, v_margin, p_effective_from, v_note, auth.uid())
  returning id into v_id;

  select * into v_default from public.compensation_defaults d
   where d.org_id = v_org and d.kind = p_kind
     and d.effective_from <= p_effective_from and (d.effective_to is null or p_effective_from < d.effective_to);
  return pg_catalog.jsonb_build_object(
    'id', v_id,
    'warning', coalesce(v_margin < v_default.margin_min_pct or v_margin > v_default.margin_max_pct, false)
  );
end;
$$;

-- Removes a professional's last (open) margin of a kind and reopens the previous one, if any.
-- Same window as delete_compensation_default; the first margin may go (the default applies again).
create function public.delete_professional_margin(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.professional_compensation;
begin
  perform private.assert_compensation_access();
  select * into v_row from public.professional_compensation c where c.id = p_row_id and c.org_id = v_org;
  if v_row.id is null then
    raise exception 'Marge introuvable.' using errcode = 'P0001';
  end if;
  perform private.lock_professional(v_row.professional_id);
  -- Re-read under the lock: another call may have closed or removed it meanwhile.
  select * into v_row from public.professional_compensation c where c.id = p_row_id and c.org_id = v_org;
  if v_row.id is null then
    raise exception 'Marge introuvable.' using errcode = 'P0001';
  end if;
  if v_row.effective_to is not null then
    raise exception 'Seule la dernière marge peut être supprimée.' using errcode = 'P0001';
  end if;
  if not coalesce(v_row.effective_from > private.clinic_today(), false)
     and not coalesce(v_row.created_at > pg_catalog.now() - interval '24 hours', false) then
    raise exception 'Une marge déjà en vigueur ne peut pas être supprimée.' using errcode = 'P0001';
  end if;

  delete from public.professional_compensation c where c.professional_id = v_row.professional_id and c.id = v_row.id;
  update public.professional_compensation c
     set effective_to = null
   where c.professional_id = v_row.professional_id and c.kind = v_row.kind and c.effective_to = v_row.effective_from;
end;
$$;

-- Appends a recognition rule: closes the open one on p_effective_from. Amounts in cents.
create function public.set_recognition_rule(
  p_step_sessions int,
  p_bonus_per_50min_cents int,
  p_bonus_per_30min_cents int,
  p_cap_pct numeric,
  p_cap_basis text,
  p_effective_from date,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_cap numeric := round(p_cap_pct, 2);
  v_note text;
  v_open public.recognition_rules;
  v_id uuid;
begin
  perform private.assert_compensation_access();
  if p_cap_basis is null or p_cap_basis not in ('unconfirmed', 'margin_reduction', 'fee_increase') then
    raise exception 'Base du plafond inconnue.' using errcode = '22023';
  end if;
  if p_step_sessions is null or p_step_sessions < 1 or p_step_sessions > 1000 then
    raise exception 'Le palier compte de 1 à 1 000 séances.' using errcode = 'P0001';
  end if;
  if p_bonus_per_50min_cents is null or p_bonus_per_30min_cents is null
     or p_bonus_per_50min_cents not between 0 and 10000 or p_bonus_per_30min_cents not between 0 and 10000 then
    raise exception 'Le boni est compris entre 0 et 100 $.' using errcode = 'P0001';
  end if;
  if v_cap is null or v_cap < 0 or v_cap > 100 then
    raise exception 'Le plafond est compris entre 0 et 100 %%.' using errcode = 'P0001';
  end if;
  v_note := private.compensation_note(p_note);

  perform 1 from public.organizations o where o.id = v_org for no key update;
  select * into v_open from public.recognition_rules r where r.org_id = v_org and r.effective_to is null;
  perform private.assert_starts_after(p_effective_from, v_open.effective_from, 'La nouvelle règle doit commencer après le');
  if v_open.id is not null then
    update public.recognition_rules r set effective_to = p_effective_from where r.id = v_open.id;
  end if;

  insert into public.recognition_rules (org_id, effective_from, step_sessions, bonus_per_50min_cents,
                                        bonus_per_30min_cents, cap_pct, cap_basis, note, created_by)
  values (v_org, p_effective_from, p_step_sessions, p_bonus_per_50min_cents, p_bonus_per_30min_cents,
          v_cap, p_cap_basis, v_note, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Appends a professional's recognition level (entered by hand, P4-8): closes the open one.
create function public.set_professional_recognition(p_id uuid, p_level int, p_sessions int, p_effective_from date, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_note text;
  v_open public.professional_recognition;
  v_id uuid;
begin
  perform private.assert_compensation_access();
  if p_level is null or p_level < 0 or p_level > 1000 then
    raise exception 'Le niveau est compris entre 0 et 1 000.' using errcode = 'P0001';
  end if;
  if p_sessions is null or p_sessions < 0 or p_sessions > 100000 then
    raise exception 'Le nombre de séances est compris entre 0 et 100 000.' using errcode = 'P0001';
  end if;
  v_note := private.compensation_note(p_note);

  perform private.lock_professional(p_id);
  select * into v_open from public.professional_recognition r
   where r.professional_id = p_id and r.effective_to is null;
  perform private.assert_starts_after(p_effective_from, v_open.effective_from, 'Le nouveau niveau doit commencer après le');
  if v_open.id is not null then
    update public.professional_recognition r set effective_to = p_effective_from
     where r.professional_id = p_id and r.id = v_open.id;
  end if;

  insert into public.professional_recognition (org_id, professional_id, level, sessions_counted, effective_from, note, created_by)
  values (v_org, p_id, p_level, p_sessions, p_effective_from, v_note, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- The terms in force on a date (clinic today by default): per kind, the professional's margin
-- (source 'professional') or else the default range (source 'default', or 'none' when the clinic
-- has none), with the default range always given; and the recognition level with the rule in
-- force. Read model for the contract (4d) and Facturation. Computes no amount (P4-8).
create function public.get_professional_compensation(p_id uuid, p_on date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_on date;
begin
  perform private.assert_compensation_access();
  if not exists (select 1 from public.professionals p where p.id = p_id and p.org_id = v_org) then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  v_on := coalesce(p_on, private.clinic_today());

  return pg_catalog.jsonb_build_object(
    'on', v_on,
    'margins', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'kind', k.key,
               'name', k.name,
               'source', case when c.id is not null then 'professional' when d.id is not null then 'default' else 'none' end,
               'margin_pct', c.margin_pct,
               'min', d.margin_min_pct,
               'max', d.margin_max_pct,
               'effective_from', coalesce(c.effective_from, d.effective_from),
               'id', c.id,
               'note', c.note
             ) order by k.sort_order, k.key), '[]'::jsonb)
        from public.compensation_kinds k
        left join public.compensation_defaults d
          on d.org_id = v_org and d.kind = k.key
         and d.effective_from <= v_on and (d.effective_to is null or v_on < d.effective_to)
        left join public.professional_compensation c
          on c.professional_id = p_id and c.kind = k.key
         and c.effective_from <= v_on and (c.effective_to is null or v_on < c.effective_to)
    ),
    'recognition', (
      select pg_catalog.jsonb_build_object(
               'id', r.id,
               'level', r.level,
               'sessions_counted', r.sessions_counted,
               'effective_from', r.effective_from,
               'note', r.note,
               'rule', (
                 select pg_catalog.jsonb_build_object(
                          'id', rr.id,
                          'step_sessions', rr.step_sessions,
                          'bonus_per_50min_cents', rr.bonus_per_50min_cents,
                          'bonus_per_30min_cents', rr.bonus_per_30min_cents,
                          'cap_pct', rr.cap_pct,
                          'cap_basis', rr.cap_basis,
                          'effective_from', rr.effective_from)
                   from public.recognition_rules rr
                  where rr.org_id = v_org
                    and rr.effective_from <= v_on and (rr.effective_to is null or v_on < rr.effective_to)))
        from (select 1) one
        left join public.professional_recognition r
          on r.professional_id = p_id
         and r.effective_from <= v_on and (r.effective_to is null or v_on < r.effective_to)
    )
  );
end;
$$;

revoke all on function
  private.assert_compensation_access(),
  private.assert_compensation_kind(text),
  private.compensation_note(text),
  private.assert_starts_after(date, date, text)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- History: private rows without values; compensation rows for compensation holders only
-- -----------------------------------------------------------------------------
-- Same signature and grants (none) as *_professionals_lifecycle.sql; every table a professional's
-- history may show. list_professional_history filters the compensation ones by permission.
create or replace function private.professional_history_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['professionals', 'professional_public_profiles', 'professional_matching_profiles',
               'professional_professions', 'professional_clienteles', 'professional_specialties',
               'professional_motifs', 'professional_languages', 'professional_payer_numbers',
               'professional_private', 'professional_compensation', 'professional_recognition']
$$;

-- Same signature, grants and paging as *_professionals_lifecycle.sql. Two changes:
-- * professional_private rows carry no changed_fields (every value is redacted anyway; the
--   history says only that the private data changed), except reads, which keep their field
--   names ({"fields": ["sin" | "bank_account"]}) and nothing else;
-- * professional_compensation and professional_recognition rows show only to holders of
--   professionals.compensation (professionals.view alone does not open the margins).
create or replace function public.list_professional_history(p_id uuid, p_before_id bigint default null, p_limit int default 50)
returns table (
  id bigint, created_at timestamptz, table_name text, record_id text, action text,
  changed_fields jsonb, actor_id uuid, actor_name text, actor_role text, source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_before bigint := coalesce(p_before_id, 9223372036854775807);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_prefix text := p_id::text;
  v_tables text[] := private.professional_history_tables();
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not private.has_permission('professionals.compensation') then
    v_tables := pg_catalog.array_remove(pg_catalog.array_remove(v_tables, 'professional_compensation'), 'professional_recognition');
  end if;
  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action,
           case
             when a.table_name <> 'professional_private' then a.changed_fields
             when a.action = 'read' and pg_catalog.jsonb_typeof(a.changed_fields -> 'fields') = 'array'
               then pg_catalog.jsonb_build_object('fields', a.changed_fields -> 'fields')
           end,
           a.actor_id, pr.display_name, a.actor_role, a.source
      from public.audit_log a
      left join public.profiles pr on pr.user_id = a.actor_id and pr.org_id = a.org_id
     where a.org_id = v_org
       and left(a.record_id, 36) = v_prefix
       and a.id < v_before
       and a.table_name = any (v_tables)
     order by a.id desc
     limit v_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges (service_role: none; these act for a user)
-- -----------------------------------------------------------------------------
revoke all on function
  public.get_professional_private(uuid),
  public.reveal_professional_private(uuid, text),
  public.set_professional_private(uuid, text, text, text, text, text, text, text),
  public.clear_professional_private_field(uuid, text),
  public.set_compensation_default(text, numeric, numeric, date),
  public.delete_compensation_default(uuid),
  public.set_professional_margin(uuid, text, numeric, date, text),
  public.delete_professional_margin(uuid),
  public.set_recognition_rule(int, int, int, numeric, text, date, text),
  public.set_professional_recognition(uuid, int, int, date, text),
  public.get_professional_compensation(uuid, date)
from public, anon, authenticated, service_role;
grant execute on function
  public.get_professional_private(uuid),
  public.reveal_professional_private(uuid, text),
  public.set_professional_private(uuid, text, text, text, text, text, text, text),
  public.clear_professional_private_field(uuid, text),
  public.set_compensation_default(text, numeric, numeric, date),
  public.delete_compensation_default(uuid),
  public.set_professional_margin(uuid, text, numeric, date, text),
  public.delete_professional_margin(uuid),
  public.set_recognition_rule(int, int, int, numeric, text, date, text),
  public.set_professional_recognition(uuid, int, int, date, text),
  public.get_professional_compensation(uuid, date)
to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
