-- =============================================================================
-- Professionnels: encrypted private data (SIN, bank account) and the retention program
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.5, §3.6, §3.9
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4a.17 (P4-7, P4-140…), redesigned by P4-180…P4-194
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
--   returns these rows with changed_fields null (reads keep only the known field names).
-- * One RPC per card (P4-148), so a save only ever writes its own fields and one person's save
--   cannot overwrite another's: set_professional_tax_numbers (NE, TPS, TVQ: plain, blank clears),
--   set_professional_bank (institution and transit: plain, blank clears; account: encrypted, blank
--   keeps), set_professional_sin (encrypted, blank refused), clear_professional_private_field
--   (removes the SIN or the account). The three set_* take p_expected_updated_at, the updated_at
--   the caller read (null when nothing was stored): a row changed since then is refused (P0001,
--   HINT 'stale'). They return the row's new updated_at.
-- * One key version per row (conventions §8): every write leaves the whole row on
--   private.pii_current_key_version() in one statement; a kept ciphertext is re-encrypted from the
--   row's version (left as is when the row is already current, so no spurious audit change). A
--   kept value that does not decrypt (key missing 55000, wrong key 39000) raises a clean P0001
--   naming the field, with a HINT.
-- * Spaces, tabs, line breaks and hyphens are stripped from numbers; any other character is
--   refused (never stripped). SIN: 9 digits and the Luhn check, refused while the module setting
--   collect_sin is off (P4-7); a stored SIN can still be revealed and cleared. No message ever
--   repeats a value. Every query on professional_private is scoped to the caller's clinic.
-- * Reveals (reveal_professional_private) decrypt with the row's version and write an audit_log
--   row: action 'read', source 'rpc:reveal_professional_private', changed_fields
--   {"fields": ["sin" | "bank_account"]}. Nothing stored → null, no audit row.
-- * The two encrypted columns are added to private.pii_encrypted_values() (row key
--   professional_id), so the health check, the canary seeding and the rotation runbook see them.
-- * Compensation: the clinic's retention program (« Programme de reconnaissance », P4-180…P4-194),
--   which replaced the legacy contract's model (ranges, dollar bonuses, levels; P4-8 and P4-9
--   superseded):
--   - retention_grids (one per profession title and period) with retention_grid_tiers (threshold
--     of cumulative sessions → clinic retention %) and retention_grid_prices (client price per
--     duration 60 / 50 / 30). A new version is a new grid row with its own tiers and prices;
--     seeded for every clinic from 2026-07-01 with the eight grids of the clinic's sheet (P4-184);
--   - professional_session_counts: one row per professional and month (50/60-minute sessions,
--     30-minute sessions counting half, an adjustment for an opening balance or a correction); the
--     cumulative total is their sum, never stored (P4-186);
--   - professional_retention: the applied retention %, dated, with the decision that set it
--     (initial, suggested, maintained, custom) and a snapshot of the count and the suggestion;
--   - professional_client_agreements (« Ententes particulières »): for one client and duration, a
--     fixed amount paid to the professional per session, dated; the retention does not apply;
--   - compensation_rates: the clinic's other kinds (Ateliers et conférences, Annulation tardive,
--     Autres frais), dated per-clinic rates, the same for every professional (P4-181).
--   Status, suggestion and pay are computed by private.retention_overview and
--   private.retention_pay, the one source of get_professional_compensation (the record, 4d,
--   Facturation) and list_retention_review (« Révision mensuelle »).
-- * Periods are [effective_from, effective_to) and never overlap (exclusion constraints). Every
--   set_* RPC closes the open row on the new start date, as add_tax_rate does, under the org row
--   lock (clinic rows) or the professional row lock; each dated table has a delete RPC for its
--   last row, while it is not in force yet or within 24 hours of its creation (P4-145). Dates are
--   bounded to 2000-01-01 … 2100-12-31 (P4-150). Every value is validated before any lock;
--   refusals never repeat a value. Clients read the tables (professionals.compensation,
--   org-scoped); writes are RPCs only. Every statement is scoped to the caller's clinic.
-- * The compensation tables are audited with their values (P4-149): the history and the
--   Journal d'audit keep what a grid, a count or a rate was, even after a deletion. audit.view
--   (admin-only by default) therefore shows them too. Except a client agreement's client_label,
--   redacted (Loi 25, P4-193): the log keeps the duration, dates and amounts only. The retention
--   is internal: nothing here is readable with professionals.self.
-- * import_professional (*_professionals_import.sql) is replaced at the end: two optional keys,
--   retention_pct and cumulative_sessions (P4-192).
-- * Permissions (4a.1): professionals.private for the private data, professionals.compensation
--   for the rest; both admin-only by default.
-- * service_role (conventions §3): its privileges are revoked explicitly on professional_private
--   (§8) and it gets no EXECUTE on these RPCs (they act for a user); on the compensation tables it
--   keeps Supabase's defaults, as on every table (server-only, bypasses RLS).
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
            hint = 'Le NAS enregistré peut être retiré. Il ne peut être saisi de nouveau que si la collecte du NAS est activée.';
  end if;
  raise exception 'Le numéro de compte enregistré ne peut pas être lu avec la clé de cet environnement.'
    using errcode = 'P0001',
          hint = 'Retirez le numéro de compte enregistré, ou saisissez-le de nouveau au complet : il remplacera celui qui est enregistré.';
end;
$$;

-- Which kept ciphertext of a row of p_org does not decrypt with its version: 'sin',
-- 'bank_account', or null. Called only after a write failed with 39000 / 55000, to name the field.
create function private.unreadable_private_field(p_id uuid, p_org uuid, p_check_sin boolean, p_check_account boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_row public.professional_private;
begin
  select * into v_row from public.professional_private pp where pp.professional_id = p_id and pp.org_id = p_org;
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

-- Optimistic concurrency for the card saves (P4-148): p_expected is the updated_at the caller
-- read from get_professional_private (null when nothing was stored). Compared to the millisecond,
-- so a value that went through a JavaScript Date still matches. Call it under the professional lock.
create function private.assert_private_not_stale(p_id uuid, p_org uuid, p_expected timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_current timestamptz;
begin
  select pp.updated_at into v_current
    from public.professional_private pp
   where pp.professional_id = p_id and pp.org_id = p_org;
  if pg_catalog.date_trunc('milliseconds', v_current) is distinct from pg_catalog.date_trunc('milliseconds', p_expected) then
    raise exception 'Ces renseignements ont été modifiés depuis leur affichage.' using errcode = 'P0001', hint = 'stale';
  end if;
end;
$$;

-- The plaintext of one encrypted field, and an audit row naming the field (never the value).
-- Nothing stored → null and no audit row. Allowed while collect_sin is off (P4-143).
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

-- « Fiscalité » card: the business, TPS and TVQ numbers, as given (blank clears). Numbers lose
-- spaces, tabs, line breaks and hyphens; TPS / TVQ letters are upper-cased; anything else is
-- refused. The encrypted columns are kept, on the current key version. All blank and no row yet:
-- no row is created. Returns the row's updated_at (null when there is no row).
create function public.set_professional_tax_numbers(
  p_id uuid,
  p_business_number text,
  p_gst_number text,
  p_qst_number text,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_strip constant text := '[ \t\r\n-]';
  v_bn text := nullif(pg_catalog.regexp_replace(coalesce(p_business_number, ''), v_strip, '', 'g'), '');
  v_gst text := nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_gst_number, ''), v_strip, '', 'g')), '');
  v_qst text := nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_qst_number, ''), v_strip, '', 'g')), '');
  v_version integer;
  v_updated_at timestamptz;
begin
  if not private.has_permission('professionals.private') then
    raise exception 'Permission refusée : professionals.private' using errcode = '42501';
  end if;

  -- Validation first: the table's checks are a backstop only (their error would print the row).
  if v_bn is not null and v_bn !~ '^[0-9]{9}$' then
    raise exception 'Le numéro d''entreprise (NE) compte 9 chiffres.' using errcode = 'P0001';
  end if;
  if v_gst is not null and v_gst !~ '^[0-9]{9}RT[0-9]{4}$' then
    raise exception 'Numéro de TPS : format attendu 123456789 RT 0001.' using errcode = 'P0001';
  end if;
  if v_qst is not null and v_qst !~ '^[0-9]{10}TQ[0-9]{4}$' then
    raise exception 'Numéro de TVQ : format attendu 1234567890 TQ 0001.' using errcode = 'P0001';
  end if;

  perform private.lock_professional(p_id);
  perform private.assert_private_not_stale(p_id, v_org, p_expected_updated_at);
  v_version := private.pii_current_key_version();

  begin
    if v_bn is null and v_gst is null and v_qst is null then
      -- Everything blank: clear the numbers of an existing row; never create an empty one.
      update public.professional_private pp
         set business_number = null, gst_number = null, qst_number = null,
             sin = case when pp.key_version = v_version then pp.sin
                        else private.encrypt_pii(private.decrypt_pii(pp.sin, pp.key_version), v_version) end,
             bank_account = case when pp.key_version = v_version then pp.bank_account
                                 else private.encrypt_pii(private.decrypt_pii(pp.bank_account, pp.key_version), v_version) end,
             key_version = v_version,
             updated_by = auth.uid()
       where pp.professional_id = p_id and pp.org_id = v_org
      returning pp.updated_at into v_updated_at;
    else
      insert into public.professional_private as pp
        (professional_id, org_id, business_number, gst_number, qst_number, key_version, updated_by)
      values (p_id, v_org, v_bn, v_gst, v_qst, v_version, auth.uid())
      on conflict (professional_id) do update
        set business_number = excluded.business_number,
            gst_number = excluded.gst_number,
            qst_number = excluded.qst_number,
            sin = case when pp.key_version = v_version then pp.sin
                       else private.encrypt_pii(private.decrypt_pii(pp.sin, pp.key_version), v_version) end,
            bank_account = case when pp.key_version = v_version then pp.bank_account
                                else private.encrypt_pii(private.decrypt_pii(pp.bank_account, pp.key_version), v_version) end,
            key_version = excluded.key_version,
            updated_by = excluded.updated_by
        where pp.org_id = v_org
      returning pp.updated_at into v_updated_at;
    end if;
  exception
    -- 39000: pgcrypto (wrong key or corrupt data); 55000: decrypt_pii (the row's key is missing).
    when sqlstate '39000' or sqlstate '55000' then
      perform private.raise_unreadable_private_value(private.unreadable_private_field(p_id, v_org, true, true));
  end;
  return v_updated_at;
end;
$$;

-- « Banque » card: institution and transit as given (blank clears); the account is encrypted, and
-- a blank account keeps the stored one (clear_professional_private_field removes it). The SIN is
-- kept, on the current key version. All blank and no row yet: no row is created.
create function public.set_professional_bank(
  p_id uuid,
  p_institution text,
  p_transit text,
  p_account text,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_strip constant text := '[ \t\r\n-]';
  v_institution text := nullif(pg_catalog.regexp_replace(coalesce(p_institution, ''), v_strip, '', 'g'), '');
  v_transit text := nullif(pg_catalog.regexp_replace(coalesce(p_transit, ''), v_strip, '', 'g'), '');
  v_account text := nullif(pg_catalog.regexp_replace(coalesce(p_account, ''), v_strip, '', 'g'), '');
  v_version integer;
  v_updated_at timestamptz;
begin
  if not private.has_permission('professionals.private') then
    raise exception 'Permission refusée : professionals.private' using errcode = '42501';
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
  perform private.assert_private_not_stale(p_id, v_org, p_expected_updated_at);
  v_version := private.pii_current_key_version();

  begin
    if v_institution is null and v_transit is null and v_account is null then
      update public.professional_private pp
         set bank_institution = null, bank_transit = null,
             sin = case when pp.key_version = v_version then pp.sin
                        else private.encrypt_pii(private.decrypt_pii(pp.sin, pp.key_version), v_version) end,
             bank_account = case when pp.key_version = v_version then pp.bank_account
                                 else private.encrypt_pii(private.decrypt_pii(pp.bank_account, pp.key_version), v_version) end,
             key_version = v_version,
             updated_by = auth.uid()
       where pp.professional_id = p_id and pp.org_id = v_org
      returning pp.updated_at into v_updated_at;
    else
      insert into public.professional_private as pp
        (professional_id, org_id, bank_institution, bank_transit, bank_account, bank_account_last4, key_version, updated_by)
      values (p_id, v_org, v_institution, v_transit, private.encrypt_pii(v_account, v_version),
              pg_catalog.right(v_account, 4), v_version, auth.uid())
      on conflict (professional_id) do update
        set bank_institution = excluded.bank_institution,
            bank_transit = excluded.bank_transit,
            bank_account = case when v_account is not null then excluded.bank_account
                                when pp.key_version = v_version then pp.bank_account
                                else private.encrypt_pii(private.decrypt_pii(pp.bank_account, pp.key_version), v_version) end,
            bank_account_last4 = coalesce(excluded.bank_account_last4, pp.bank_account_last4),
            sin = case when pp.key_version = v_version then pp.sin
                       else private.encrypt_pii(private.decrypt_pii(pp.sin, pp.key_version), v_version) end,
            key_version = excluded.key_version,
            updated_by = excluded.updated_by
        where pp.org_id = v_org
      returning pp.updated_at into v_updated_at;
    end if;
  exception
    when sqlstate '39000' or sqlstate '55000' then
      perform private.raise_unreadable_private_value(private.unreadable_private_field(p_id, v_org, true, v_account is null));
  end;
  return v_updated_at;
end;
$$;

-- « NAS »: stores a new SIN (9 digits, Luhn), refused while collect_sin is off (P4-7). A blank SIN
-- is refused: clear_professional_private_field removes one. The account is kept, on the current
-- key version.
create function public.set_professional_sin(p_id uuid, p_sin text, p_expected_updated_at timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_sin text := nullif(pg_catalog.regexp_replace(coalesce(p_sin, ''), '[ \t\r\n-]', '', 'g'), '');
  v_version integer;
  v_updated_at timestamptz;
begin
  if not private.has_permission('professionals.private') then
    raise exception 'Permission refusée : professionals.private' using errcode = '42501';
  end if;

  if not coalesce((private.professionals_setting(v_org, 'collect_sin'))::boolean, false) then
    raise exception 'La collecte du NAS n''est pas activée.' using errcode = 'P0001',
      hint = 'Un administrateur peut l''activer dans Paramètres, section Rémunération.';
  end if;
  if v_sin is null then
    raise exception 'Saisissez le NAS au complet.' using errcode = 'P0001',
      hint = 'Pour retirer le NAS enregistré, utilisez « Retirer ».';
  end if;
  if not private.is_valid_sin(v_sin) then
    raise exception 'NAS invalide.' using errcode = 'P0001',
      hint = 'Le NAS compte 9 chiffres, et son dernier chiffre doit correspondre aux huit autres.';
  end if;

  perform private.lock_professional(p_id);
  perform private.assert_private_not_stale(p_id, v_org, p_expected_updated_at);
  v_version := private.pii_current_key_version();

  begin
    insert into public.professional_private as pp
      (professional_id, org_id, sin, sin_last3, key_version, updated_by)
    values (p_id, v_org, private.encrypt_pii(v_sin, v_version), pg_catalog.right(v_sin, 3), v_version, auth.uid())
    on conflict (professional_id) do update
      set sin = excluded.sin,
          sin_last3 = excluded.sin_last3,
          bank_account = case when pp.key_version = v_version then pp.bank_account
                              else private.encrypt_pii(private.decrypt_pii(pp.bank_account, pp.key_version), v_version) end,
          key_version = excluded.key_version,
          updated_by = excluded.updated_by
      where pp.org_id = v_org
    returning pp.updated_at into v_updated_at;
  exception
    when sqlstate '39000' or sqlstate '55000' then
      perform private.raise_unreadable_private_value(private.unreadable_private_field(p_id, v_org, false, true));
  end;
  return v_updated_at;
end;
$$;

-- Removes the SIN (and its last 3 digits) or the bank account (and its last 4). The other
-- encrypted field is kept, on the current key version (one version per row). Nothing stored: no-op.
-- Allowed while collect_sin is off (removal stays possible, P4-143).
create function public.clear_professional_private_field(p_id uuid, p_field text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_version integer;
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
     where pp.professional_id = p_id and pp.org_id = v_org
       and case p_field when 'sin' then pp.sin is not null else pp.bank_account is not null end;
  exception
    when sqlstate '39000' or sqlstate '55000' then
      perform private.raise_unreadable_private_value(
        private.unreadable_private_field(p_id, v_org, p_field <> 'sin', p_field <> 'bank_account'));
  end;
end;
$$;

revoke all on function
  private.raise_unreadable_private_value(text),
  private.unreadable_private_field(uuid, uuid, boolean, boolean),
  private.assert_private_not_stale(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Compensation: the other kinds (global catalogue, changed by migration, not audited)
-- -----------------------------------------------------------------------------
-- Consultations follow the retention grids; these kinds have one clinic rate each (P4-181).
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
  ('workshop', 'Ateliers et conférences', 10),
  ('late_cancellation', 'Annulation tardive', 20),
  ('other_fees', 'Autres frais', 30)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Compensation: the clinic's rate per other kind (dated)
-- -----------------------------------------------------------------------------
create table public.compensation_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null references public.compensation_kinds(key),
  retention_pct numeric(5, 2) not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint compensation_rates_retention_pct_check check (retention_pct between 0 and 100),
  constraint compensation_rates_period_check check (effective_to is null or effective_to > effective_from),
  constraint compensation_rates_no_overlap exclude using gist (
    org_id with =,
    kind with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
create index compensation_rates_org_kind_idx on public.compensation_rates (org_id, kind, effective_from);
create index compensation_rates_kind_idx on public.compensation_rates (kind);
create index compensation_rates_created_by_idx on public.compensation_rates (created_by);

-- -----------------------------------------------------------------------------
-- Retention grids: one per profession title and period, with its tiers and client prices
-- -----------------------------------------------------------------------------
create table public.retention_grids (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title_id uuid not null,
  effective_from date not null,
  effective_to date,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint retention_grids_org_id_id_key unique (org_id, id),
  constraint retention_grids_title_fkey foreign key (org_id, title_id) references public.profession_titles (org_id, id),
  constraint retention_grids_note_check check (char_length(note) between 1 and 500 and private.is_tidy_text(note)),
  constraint retention_grids_period_check check (effective_to is null or effective_to > effective_from),
  constraint retention_grids_no_overlap exclude using gist (
    org_id with =,
    title_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
create index retention_grids_org_title_idx on public.retention_grids (org_id, title_id, effective_from);
create index retention_grids_created_by_idx on public.retention_grids (created_by);

-- A tier: from threshold_sessions cumulative sessions on, the clinic retains retention_pct.
-- Written only with its grid (set_retention_grid), never changed; gone with its grid.
create table public.retention_grid_tiers (
  org_id uuid not null,
  grid_id uuid not null,
  threshold_sessions int not null,
  retention_pct numeric(5, 2) not null,
  constraint retention_grid_tiers_pkey primary key (grid_id, threshold_sessions),
  constraint retention_grid_tiers_grid_fkey foreign key (org_id, grid_id)
    references public.retention_grids (org_id, id) on delete cascade,
  constraint retention_grid_tiers_threshold_sessions_check check (threshold_sessions between 0 and 100000),
  constraint retention_grid_tiers_retention_pct_check check (retention_pct between 0 and 100)
);
create index retention_grid_tiers_org_grid_idx on public.retention_grid_tiers (org_id, grid_id);

-- The client price of a duration (« 60 min / couple », « 50 min », « 30 min »), in cents.
create table public.retention_grid_prices (
  org_id uuid not null,
  grid_id uuid not null,
  duration smallint not null,
  client_price_cents int not null,
  constraint retention_grid_prices_pkey primary key (grid_id, duration),
  constraint retention_grid_prices_grid_fkey foreign key (org_id, grid_id)
    references public.retention_grids (org_id, id) on delete cascade,
  constraint retention_grid_prices_duration_check check (duration in (60, 50, 30)),
  constraint retention_grid_prices_client_price_cents_check check (client_price_cents between 1 and 100000)
);
create index retention_grid_prices_org_grid_idx on public.retention_grid_prices (org_id, grid_id);

-- -----------------------------------------------------------------------------
-- A professional's sessions, month by month (the cumulative count is their sum)
-- -----------------------------------------------------------------------------
-- A 50 or 60 minute session counts 1, a 30 minute session 0.5 (P4-186); `adjustment` (half
-- sessions, may be negative) carries an opening balance or a correction. A row holding nothing
-- is never kept: record_monthly_sessions deletes it.
create table public.professional_session_counts (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  month date not null,
  sessions_50_60 int not null default 0,
  sessions_30 int not null default 0,
  adjustment numeric(7, 1) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  -- PK starts with professional_id: audit record ids start with it (history, P4-36).
  constraint professional_session_counts_pkey primary key (professional_id, id),
  constraint professional_session_counts_id_key unique (id),
  constraint professional_session_counts_month_key unique (professional_id, month),
  constraint professional_session_counts_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_session_counts_month_check check (
    pg_catalog.date_trunc('month', month)::date = month and month between date '2000-01-01' and date '2100-12-01'),
  constraint professional_session_counts_sessions_50_60_check check (sessions_50_60 between 0 and 2000),
  constraint professional_session_counts_sessions_30_check check (sessions_30 between 0 and 2000),
  constraint professional_session_counts_adjustment_check check (
    adjustment between -100000 and 100000 and adjustment * 2 = pg_catalog.trunc(adjustment * 2)),
  constraint professional_session_counts_not_empty_check check (sessions_50_60 <> 0 or sessions_30 <> 0 or adjustment <> 0),
  constraint professional_session_counts_note_check check (char_length(note) between 1 and 500 and private.is_tidy_text(note))
);
create index professional_session_counts_org_idx on public.professional_session_counts (org_id, professional_id);
create index professional_session_counts_created_by_idx on public.professional_session_counts (created_by);
create index professional_session_counts_updated_by_idx on public.professional_session_counts (updated_by);
create trigger professional_session_counts_set_updated_at before update on public.professional_session_counts
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- A professional's applied retention (dated, with the decision that set it)
-- -----------------------------------------------------------------------------
-- decision: initial (the rate in force when tracking began), suggested (« Appliquer la
-- suggestion »), maintained (« Maintenir », tier_threshold = the tier it was kept at), custom
-- (« Taux particulier », note required). suggested_pct and sessions_total are a snapshot of what
-- the grid said when the decision was taken (P4-187).
create table public.professional_retention (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  retention_pct numeric(5, 2) not null,
  decision text not null,
  tier_threshold int,
  suggested_pct numeric(5, 2),
  sessions_total numeric(8, 1),
  effective_from date not null,
  effective_to date,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint professional_retention_pkey primary key (professional_id, id),
  constraint professional_retention_id_key unique (id),
  constraint professional_retention_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_retention_retention_pct_check check (retention_pct between 0 and 100),
  constraint professional_retention_decision_check check (decision in ('initial', 'suggested', 'maintained', 'custom')),
  constraint professional_retention_maintained_check check (decision <> 'maintained' or tier_threshold is not null),
  constraint professional_retention_custom_check check (decision <> 'custom' or note is not null),
  constraint professional_retention_tier_threshold_check check (tier_threshold between 0 and 100000),
  constraint professional_retention_suggested_pct_check check (suggested_pct between 0 and 100),
  constraint professional_retention_sessions_total_check check (sessions_total between 0 and 1000000),
  constraint professional_retention_note_check check (char_length(note) between 1 and 500 and private.is_tidy_text(note)),
  constraint professional_retention_period_check check (effective_to is null or effective_to > effective_from),
  constraint professional_retention_no_overlap exclude using gist (
    professional_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
create index professional_retention_org_idx on public.professional_retention (org_id, professional_id);
create index professional_retention_created_by_idx on public.professional_retention (created_by);

-- -----------------------------------------------------------------------------
-- A professional's agreements for one client (« Ententes particulières », dated, P4-183)
-- -----------------------------------------------------------------------------
-- Jonathan: a case-by-case agreement for one client, under which the professional receives a
-- fixed amount per session of one duration; the retention % does not apply to it.
-- client_label is a short reference (file number or initials, never a full name) until the
-- Clients module exists; client_id is that module's id, with no foreign key yet: Clients adds the
-- FK and backfills it. The client is client_id when set, else the label (case ignored).
-- client_price_cents: what the client pays (Jonathan: always known, required); the professional's
-- amount never exceeds it. Unlike the other
-- dated rows, an agreement can end without a successor: end_professional_client_agreement.
create table public.professional_client_agreements (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  client_label text not null,
  client_id uuid,
  duration smallint not null,
  professional_amount_cents int not null,
  client_price_cents int not null,
  effective_from date not null,
  effective_to date,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint professional_client_agreements_pkey primary key (professional_id, id),
  constraint professional_client_agreements_id_key unique (id),
  constraint professional_client_agreements_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_client_agreements_client_label_check check (
    char_length(client_label) between 1 and 40 and private.is_tidy_text(client_label)),
  constraint professional_client_agreements_duration_check check (duration in (60, 50, 30)),
  constraint professional_client_agreements_professional_amount_cents_check check (professional_amount_cents between 1 and 100000),
  constraint professional_client_agreements_client_price_cents_check check (client_price_cents between 1 and 100000),
  constraint professional_client_agreements_amounts_check check (professional_amount_cents <= client_price_cents),
  constraint professional_client_agreements_note_check check (char_length(note) between 1 and 500 and private.is_tidy_text(note)),
  constraint professional_client_agreements_period_check check (effective_to is null or effective_to > effective_from),
  constraint professional_client_agreements_no_overlap exclude using gist (
    professional_id with =,
    (coalesce(client_id::text, pg_catalog.lower(client_label))) with =,
    duration with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
comment on column public.professional_client_agreements.client_id is
  'The client (Clients module, to come): no foreign key yet; Clients adds it and backfills from client_label.';
create index professional_client_agreements_org_idx on public.professional_client_agreements (org_id, professional_id);
create index professional_client_agreements_created_by_idx on public.professional_client_agreements (created_by);

-- -----------------------------------------------------------------------------
-- Compensation tables: privileges, RLS, audit
-- -----------------------------------------------------------------------------
revoke all on public.compensation_rates, public.retention_grids, public.retention_grid_tiers,
              public.retention_grid_prices, public.professional_session_counts,
              public.professional_retention, public.professional_client_agreements
  from anon, authenticated;
grant select on public.compensation_rates, public.retention_grids, public.retention_grid_tiers,
                public.retention_grid_prices, public.professional_session_counts,
                public.professional_retention, public.professional_client_agreements
  to authenticated;
alter table public.compensation_rates enable row level security;
alter table public.retention_grids enable row level security;
alter table public.retention_grid_tiers enable row level security;
alter table public.retention_grid_prices enable row level security;
alter table public.professional_session_counts enable row level security;
alter table public.professional_retention enable row level security;
alter table public.professional_client_agreements enable row level security;

create policy compensation_rates_select on public.compensation_rates
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));
create policy retention_grids_select on public.retention_grids
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));
create policy retention_grid_tiers_select on public.retention_grid_tiers
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));
create policy retention_grid_prices_select on public.retention_grid_prices
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));
create policy professional_session_counts_select on public.professional_session_counts
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));
create policy professional_retention_select on public.professional_retention
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));
create policy professional_client_agreements_select on public.professional_client_agreements
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));

create trigger compensation_rates_audit after insert or update or delete on public.compensation_rates
  for each row execute function private.audit_trigger();
create trigger retention_grids_audit after insert or update or delete on public.retention_grids
  for each row execute function private.audit_trigger();
create trigger retention_grid_tiers_audit after insert or update or delete on public.retention_grid_tiers
  for each row execute function private.audit_trigger();
create trigger retention_grid_prices_audit after insert or update or delete on public.retention_grid_prices
  for each row execute function private.audit_trigger();
create trigger professional_session_counts_audit after insert or update or delete on public.professional_session_counts
  for each row execute function private.audit_trigger();
create trigger professional_retention_audit after insert or update or delete on public.professional_retention
  for each row execute function private.audit_trigger();
-- client_label is redacted (Loi 25): a client reference, even initials, stays out of the log;
-- Historique shows the agreement's duration, dates and amounts only (P4-193).
create trigger professional_client_agreements_audit after insert or update or delete on public.professional_client_agreements
  for each row execute function private.audit_trigger('client_label');

-- -----------------------------------------------------------------------------
-- The clinic's program for every clinic (P4-181, P4-182, P4-184: Jonathan's sheet, from 2026-07-01)
-- -----------------------------------------------------------------------------
-- Grids per title key: the starting retention drops by 0.5 point per tier of 50 sessions
-- (thresholds 0, 51, 101, …) down to the 25 % floor; client prices per duration, derived from
-- the sheet's « 50 et - » row (pay ÷ (1 − starting retention)) and checked against every tier;
-- Coach from the GoRV codes 10130, 10150 and 20150-20160; Psychoéducation 60 min is 165 $
-- (Jonathan's correction of the sheet's 170 $, P4-182). A title the clinic does not have, or
-- already holding a grid, is skipped. Runs after the reference seed (trigger name order), which
-- creates the titles.
create function private.seed_professionals_compensation(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_start constant date := date '2026-07-01';
  r record;
  v_title uuid;
  v_grid uuid;
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:professionals_compensation', true);

  insert into public.compensation_rates (org_id, kind, retention_pct, effective_from)
  select p_org, d.kind, d.pct, v_start
    from (values ('workshop', 25), ('late_cancellation', 30), ('other_fees', 15)) as d(kind, pct)
   where not exists (select 1 from public.compensation_rates c where c.org_id = p_org and c.kind = d.kind);

  for r in
    select * from (values
      ('psychologue',            28.00, 20000, 17500, 13000, null::text),
      ('psychotherapeute',       28.00, 18500, 16000, 12000, null),
      ('sexologue',              30.00, 17500, 15000, 11000, null),
      ('travailleur_social',     30.00, 15000, 12000,  8500, null),
      ('conseiller_orientation', 30.00,  null, 14000, 10000, null),
      ('naturopathe',            30.00,  null, 12000,  8000, null),
      ('psychoeducateur',        30.00, 16500, 14000, 10000, null),
      ('coach_professionnel',    30.00, 12177, 10437,  6958, 'Prix des codes GoRV 20150-20160 (60 min), 10150 (50 min) et 10130 (30 min).')
    ) as v(title_key, start_pct, price_60, price_50, price_30, note)
  loop
    select t.id into v_title from public.profession_titles t where t.org_id = p_org and t.key = r.title_key;
    continue when v_title is null
      or exists (select 1 from public.retention_grids g where g.org_id = p_org and g.title_id = v_title);

    insert into public.retention_grids (org_id, title_id, effective_from, note)
    values (p_org, v_title, v_start, r.note)
    returning id into v_grid;
    insert into public.retention_grid_tiers (org_id, grid_id, threshold_sessions, retention_pct)
    select p_org, v_grid, case when n = 0 then 0 else n * 50 + 1 end, r.start_pct - n * 0.5
      from pg_catalog.generate_series(0, ((r.start_pct - 25) / 0.5)::int) as n;
    insert into public.retention_grid_prices (org_id, grid_id, duration, client_price_cents)
    select p_org, v_grid, d.duration, d.cents
      from (values (60, r.price_60), (50, r.price_50), (30, r.price_30)) as d(duration, cents)
     where d.cents is not null;
  end loop;

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

-- « retention » sorts after « reference »: the titles exist when this trigger runs.
create trigger organizations_seed_professionals_retention
  after insert on public.organizations
  for each row execute function private.seed_professionals_compensation_on_org();

revoke all on function private.seed_professionals_compensation(uuid), private.seed_professionals_compensation_on_org()
  from public, anon, authenticated, service_role;

-- Existing organizations (staging).
select private.seed_professionals_compensation(o.id) from public.organizations o;

-- -----------------------------------------------------------------------------
-- Shared checks (granted to no role)
-- -----------------------------------------------------------------------------
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

-- A note as stored (one line, at most 500 characters), or a French P0001 (HINT note).
create function private.compensation_note(p_note text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_message text;
begin
  return private.reference_text(p_note, 'La note', 500, false, true);
exception when sqlstate 'P0001' then
  get stacked diagnostics v_message = message_text;
  raise exception '%', v_message using errcode = 'P0001', hint = 'note';
end;
$$;

-- Every date argument stays within 2000-01-01 … 2100-12-31 (P4-150): no infinity, no BC date, no
-- five-digit year typo. The HINT names the argument, so the UI shows the refusal under its field.
create function private.assert_compensation_date(p_date date, p_hint text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_date is not null and (p_date < date '2000-01-01' or p_date > date '2100-12-31') then
    raise exception 'La date doit être comprise entre le 2000-01-01 et le 2100-12-31.'
      using errcode = 'P0001', hint = p_hint;
  end if;
end;
$$;

-- The refusal when a new dated row has no start date, one out of bounds, or one that does not
-- start after the open one (as add_tax_rate). HINT 'effective_from' on each.
create function private.assert_starts_after(p_new date, p_open date, p_message text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_new is null then
    raise exception 'La date d''entrée en vigueur est requise.' using errcode = 'P0001', hint = 'effective_from';
  end if;
  perform private.assert_compensation_date(p_new, 'effective_from');
  if p_open is not null and p_new <= p_open then
    raise exception '% %.', p_message, pg_catalog.to_char(p_open, 'YYYY-MM-DD')
      using errcode = 'P0001', hint = 'effective_from';
  end if;
end;
$$;

-- The correction window of every delete (P4-145): a row not in force yet, or created less than
-- 24 hours ago. p_message is the refusal (« Un taux déjà en vigueur ne peut pas être supprimé. »).
create function private.assert_dated_deletable(p_effective_from date, p_created_at timestamptz, p_message text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not coalesce(p_effective_from > private.clinic_today(), false)
     and not coalesce(p_created_at > pg_catalog.now() - interval '24 hours', false) then
    raise exception '%', p_message using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- The computation (granted to no role; the definer RPCs below call it)
-- -----------------------------------------------------------------------------
-- The professional's pay for one session, in cents: the client price × (1 − retention), rounded
-- half away from zero to the cent (how the clinic's sheet rounds its « Tarif » columns, P4-189).
-- A client agreement (professional_client_agreements) is a fixed amount instead, never computed.
create function private.retention_pay_cents(p_price_cents int, p_pct numeric)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when p_pct is null or p_price_cents is null then null
              else pg_catalog.round(p_price_cents * (100 - p_pct) / 100)::int end
$$;

-- One row per professional of p_org: the primary title and its grid in force on p_on, the
-- cumulative sessions through the month p_through (entries of that month included), the applied
-- rate (the open row: the latest decision, even when it starts after p_on), the previous one and
-- the one in force on p_on, the suggested tier (the highest threshold the count reached), the
-- next tier, the floor (the grid's last tier) and the status (P4-188):
--   profession_unconfirmed  no grid for the primary title (or no title);
--   gap                     « Écart à valider »: no rate yet, or applied ≠ suggested with no
--                           decision covering it;
--   custom                  « Taux particulier » (Jonathan, 2026-10-08): stands while the count
--                           is still in the tier it was decided at (or a lower one, after a
--                           correction), and always once that tier is the floor; a new tier
--                           flags it again (gap), as does a grid applying to a rate decided
--                           without one (no tier_threshold);
--   floor                   « Palier maximum atteint »: applied = suggested = the floor;
--   conforme                applied = suggested;
--   maintained              « Maintenu »: kept at the tier the count is still in (or a lower one,
--                           after a correction); a new tier flags it again.
create function private.retention_overview(p_org uuid, p_through date, p_on date)
returns table (
  professional_id uuid,
  title_id uuid,
  title_name text,
  grid_id uuid,
  sessions_total numeric,
  applied_id uuid,
  applied_pct numeric,
  applied_decision text,
  applied_from date,
  applied_tier int,
  applied_note text,
  previous_pct numeric,
  in_force_pct numeric,
  suggested_threshold int,
  suggested_pct numeric,
  next_threshold int,
  next_pct numeric,
  floor_pct numeric,
  status text
)
language sql
stable
set search_path = ''
as $$
  select p.id, t.id, t.name, g.id, s.total,
         a.id, a.retention_pct, a.decision, a.effective_from, a.tier_threshold, a.note,
         prev.retention_pct, f.retention_pct,
         sug.threshold_sessions, sug.retention_pct, nxt.threshold_sessions, nxt.retention_pct, fl.retention_pct,
         case
           when g.id is null then 'profession_unconfirmed'
           when a.id is null then 'gap'
           when a.decision = 'custom' then
             case when a.tier_threshold is not null
                   and (sug.threshold_sessions <= a.tier_threshold or a.tier_threshold >= fl.threshold_sessions)
                  then 'custom' else 'gap' end
           when a.retention_pct = sug.retention_pct then
             case when sug.retention_pct = fl.retention_pct then 'floor' else 'conforme' end
           when a.decision = 'maintained' and sug.threshold_sessions <= a.tier_threshold then 'maintained'
           else 'gap'
         end
    from public.professionals p
    left join lateral (
      select pt.id, pt.name
        from public.professional_professions pp
        join public.profession_titles pt on pt.org_id = pp.org_id and pt.id = pp.profession_title_id
       where pp.professional_id = p.id and pp.org_id = p_org and pp.is_primary
       limit 1) t on true
    left join lateral (
      select rg.id
        from public.retention_grids rg
       where rg.org_id = p_org and rg.title_id = t.id
         and rg.effective_from <= p_on and (rg.effective_to is null or p_on < rg.effective_to)) g on true
    cross join lateral (
      select coalesce(sum(c.sessions_50_60 + c.sessions_30 * 0.5 + c.adjustment), 0)::numeric(8, 1) as total
        from public.professional_session_counts c
       where c.professional_id = p.id and c.org_id = p_org and c.month <= p_through) s
    left join lateral (
      select r.id, r.retention_pct, r.decision, r.effective_from, r.tier_threshold, r.note
        from public.professional_retention r
       where r.professional_id = p.id and r.org_id = p_org and r.effective_to is null) a on true
    left join lateral (
      select r.retention_pct
        from public.professional_retention r
       where r.professional_id = p.id and r.org_id = p_org and r.effective_to = a.effective_from) prev on true
    left join lateral (
      select r.retention_pct
        from public.professional_retention r
       where r.professional_id = p.id and r.org_id = p_org
         and r.effective_from <= p_on and (r.effective_to is null or p_on < r.effective_to)) f on true
    left join lateral (
      select gt.threshold_sessions, gt.retention_pct
        from public.retention_grid_tiers gt
       where gt.grid_id = g.id and gt.org_id = p_org and gt.threshold_sessions <= s.total
       order by gt.threshold_sessions desc
       limit 1) sug on true
    left join lateral (
      select gt.threshold_sessions, gt.retention_pct
        from public.retention_grid_tiers gt
       where gt.grid_id = g.id and gt.org_id = p_org and gt.threshold_sessions > s.total
       order by gt.threshold_sessions
       limit 1) nxt on true
    left join lateral (
      select gt.threshold_sessions, gt.retention_pct
        from public.retention_grid_tiers gt
       where gt.grid_id = g.id and gt.org_id = p_org
       order by gt.threshold_sessions desc
       limit 1) fl on true
   where p.org_id = p_org
$$;

-- Pay per duration of the grid, 60 then 50 then 30: [{duration, client_price_cents, applied_cents,
-- suggested_cents, upcoming_cents}]. applied_cents is at the rate in force on the read model's date
-- (what Facturation pays that day, P4-151), upcoming_cents at the latest decision when it starts
-- later (null otherwise); an amount is null when its rate is unknown.
create function private.retention_pay(p_org uuid, p_grid uuid, p_in_force numeric, p_suggested numeric, p_upcoming numeric)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'duration', gp.duration,
           'client_price_cents', gp.client_price_cents,
           'applied_cents', private.retention_pay_cents(gp.client_price_cents, p_in_force),
           'suggested_cents', private.retention_pay_cents(gp.client_price_cents, p_suggested),
           'upcoming_cents', private.retention_pay_cents(gp.client_price_cents, p_upcoming)
         ) order by gp.duration desc), '[]'::jsonb)
    from public.retention_grid_prices gp
   where gp.grid_id = p_grid and gp.org_id = p_org
$$;

-- -----------------------------------------------------------------------------
-- The clinic's other kinds (Paramètres → Rémunération)
-- -----------------------------------------------------------------------------
-- Appends a rate for a kind: closes the open one on p_effective_from.
create function public.set_compensation_rate(p_kind text, p_retention_pct numeric, p_effective_from date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pct numeric := round(p_retention_pct, 2);
  v_open public.compensation_rates;
  v_id uuid;
begin
  perform private.assert_compensation_access();
  perform private.assert_compensation_kind(p_kind);
  if v_pct is null or v_pct < 0 or v_pct > 100 then
    raise exception 'Le taux est compris entre 0 et 100 %%.' using errcode = 'P0001', hint = 'retention_pct';
  end if;
  perform private.assert_compensation_date(p_effective_from, 'effective_from');

  perform 1 from public.organizations o where o.id = v_org for no key update;
  select * into v_open from public.compensation_rates c
   where c.org_id = v_org and c.kind = p_kind and c.effective_to is null;
  perform private.assert_starts_after(p_effective_from, v_open.effective_from, 'Le nouveau taux doit commencer après le');
  if v_open.id is not null then
    update public.compensation_rates c set effective_to = p_effective_from where c.id = v_open.id and c.org_id = v_org;
  end if;

  insert into public.compensation_rates (org_id, kind, retention_pct, effective_from, created_by)
  values (v_org, p_kind, v_pct, p_effective_from, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Removes a kind's last (open) rate and reopens the previous one, within the correction window;
-- never a kind's first rate (it would be left with none).
create function public.delete_compensation_rate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.compensation_rates;
  v_reopened int;
begin
  perform private.assert_compensation_access();
  perform 1 from public.organizations o where o.id = v_org for no key update;

  select * into v_row from public.compensation_rates c where c.id = p_id and c.org_id = v_org;
  if v_row.id is null then
    raise exception 'Taux introuvable.' using errcode = 'P0001';
  end if;
  if v_row.effective_to is not null then
    raise exception 'Seul le dernier taux peut être supprimé.' using errcode = 'P0001';
  end if;
  perform private.assert_dated_deletable(v_row.effective_from, v_row.created_at, 'Un taux déjà en vigueur ne peut pas être supprimé.');
  if not exists (select 1 from public.compensation_rates c
                  where c.org_id = v_org and c.kind = v_row.kind and c.effective_to = v_row.effective_from) then
    raise exception 'Le premier taux d''un type ne peut pas être supprimé.' using errcode = 'P0001';
  end if;

  delete from public.compensation_rates c where c.id = v_row.id and c.org_id = v_org;
  update public.compensation_rates c
     set effective_to = null
   where c.org_id = v_org and c.kind = v_row.kind and c.effective_to = v_row.effective_from;
  get diagnostics v_reopened = row_count;
  if v_reopened <> 1 then
    raise exception 'L''historique des taux est incohérent ; contactez le soutien technique.' using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Retention grids (Paramètres → Rémunération)
-- -----------------------------------------------------------------------------
-- A new version of a title's grid from p_effective_from: closes the open one on that date.
-- p_tiers: [{threshold_sessions, retention_pct}] (1–100; one at 0 sessions; distinct thresholds;
-- a higher tier never retains more), p_prices: [{duration: 60 | 50 | 30, client_price_cents}]
-- (1–3, distinct durations). Shapes the UI never sends are 22023; values are P0001 with HINT
-- tiers / prices / effective_from / note (P4-185).
create function public.set_retention_grid(p_title_id uuid, p_effective_from date, p_tiers jsonb, p_prices jsonb, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_note text;
  v_open public.retention_grids;
  v_id uuid;
begin
  perform private.assert_compensation_access();

  -- Contract.
  if pg_catalog.jsonb_typeof(p_tiers) is distinct from 'array' or pg_catalog.jsonb_array_length(p_tiers) not between 1 and 100
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_tiers) e(v)
                 where case when pg_catalog.jsonb_typeof(e.v) <> 'object' then true
                            else exists (select 1 from pg_catalog.jsonb_object_keys(e.v) k
                                          where k <> all (array['threshold_sessions', 'retention_pct']))
                                 or pg_catalog.jsonb_typeof(e.v -> 'threshold_sessions') is distinct from 'number'
                                 or pg_catalog.jsonb_typeof(e.v -> 'retention_pct') is distinct from 'number' end) then
    raise exception 'Paliers invalides : [{"threshold_sessions": nombre, "retention_pct": nombre}] (1 à 100) attendu.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_prices) is distinct from 'array' or pg_catalog.jsonb_array_length(p_prices) not between 1 and 3
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_prices) e(v)
                 where case when pg_catalog.jsonb_typeof(e.v) <> 'object' then true
                            else exists (select 1 from pg_catalog.jsonb_object_keys(e.v) k
                                          where k <> all (array['duration', 'client_price_cents']))
                                 or pg_catalog.jsonb_typeof(e.v -> 'client_price_cents') is distinct from 'number'
                                 or (e.v -> 'duration') not in ('60'::jsonb, '50'::jsonb, '30'::jsonb) end)
     or (select count(distinct e.v -> 'duration') from pg_catalog.jsonb_array_elements(p_prices) e(v)) <> pg_catalog.jsonb_array_length(p_prices) then
    raise exception 'Prix invalides : [{"duration": 60 | 50 | 30, "client_price_cents": nombre}] (durées distinctes) attendu.' using errcode = '22023';
  end if;

  -- Values.
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_tiers) e(v)
              where (e.v ->> 'threshold_sessions')::numeric not between 0 and 100000
                 or (e.v ->> 'threshold_sessions')::numeric <> pg_catalog.trunc((e.v ->> 'threshold_sessions')::numeric)) then
    raise exception 'Les seuils sont des nombres entiers de séances, de 0 à 100 000.' using errcode = 'P0001', hint = 'tiers';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_tiers) e(v)
              where round((e.v ->> 'retention_pct')::numeric, 2) not between 0 and 100) then
    raise exception 'Les taux de retenue sont compris entre 0 et 100 %%.' using errcode = 'P0001', hint = 'tiers';
  end if;
  if (select count(distinct (e.v ->> 'threshold_sessions')::int) from pg_catalog.jsonb_array_elements(p_tiers) e(v))
     <> pg_catalog.jsonb_array_length(p_tiers) then
    raise exception 'Deux paliers ont le même seuil.' using errcode = 'P0001', hint = 'tiers';
  end if;
  if not exists (select 1 from pg_catalog.jsonb_array_elements(p_tiers) e(v) where (e.v ->> 'threshold_sessions')::int = 0) then
    raise exception 'Le premier palier commence à 0 séance.' using errcode = 'P0001', hint = 'tiers';
  end if;
  if exists (select 1 from (
               select round((e.v ->> 'retention_pct')::numeric, 2) as pct,
                      pg_catalog.lag(round((e.v ->> 'retention_pct')::numeric, 2))
                        over (order by (e.v ->> 'threshold_sessions')::int) as lower_pct
                 from pg_catalog.jsonb_array_elements(p_tiers) e(v)) x
              where x.pct > x.lower_pct) then
    raise exception 'Un palier plus élevé ne peut pas retenir davantage que le précédent.' using errcode = 'P0001', hint = 'tiers';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_prices) e(v)
              where (e.v ->> 'client_price_cents')::numeric not between 1 and 100000
                 or (e.v ->> 'client_price_cents')::numeric <> pg_catalog.trunc((e.v ->> 'client_price_cents')::numeric)) then
    raise exception 'Les prix sont compris entre 0,01 $ et 1 000 $.' using errcode = 'P0001', hint = 'prices';
  end if;
  v_note := private.compensation_note(p_note);
  perform private.assert_compensation_date(p_effective_from, 'effective_from');

  perform 1 from public.organizations o where o.id = v_org for no key update;
  if not exists (select 1 from public.profession_titles t where t.id = p_title_id and t.org_id = v_org) then
    raise exception 'Profession introuvable.' using errcode = 'P0001';
  end if;
  select * into v_open from public.retention_grids g
   where g.org_id = v_org and g.title_id = p_title_id and g.effective_to is null;
  perform private.assert_starts_after(p_effective_from, v_open.effective_from, 'La nouvelle grille doit commencer après le');
  if v_open.id is not null then
    update public.retention_grids g set effective_to = p_effective_from where g.id = v_open.id and g.org_id = v_org;
  end if;

  insert into public.retention_grids (org_id, title_id, effective_from, note, created_by)
  values (v_org, p_title_id, p_effective_from, v_note, auth.uid())
  returning id into v_id;
  insert into public.retention_grid_tiers (org_id, grid_id, threshold_sessions, retention_pct)
  select v_org, v_id, (e.v ->> 'threshold_sessions')::int, round((e.v ->> 'retention_pct')::numeric, 2)
    from pg_catalog.jsonb_array_elements(p_tiers) e(v);
  insert into public.retention_grid_prices (org_id, grid_id, duration, client_price_cents)
  select v_org, v_id, (e.v ->> 'duration')::smallint, (e.v ->> 'client_price_cents')::int
    from pg_catalog.jsonb_array_elements(p_prices) e(v);
  return v_id;
end;
$$;

-- Removes a title's last (open) grid with its tiers and prices, within the correction window,
-- and reopens the previous one. A title's first grid may go too (P4-185: a grid added to the
-- wrong title must be removable); its professionals then read « Profession à confirmer ».
create function public.delete_retention_grid(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.retention_grids;
begin
  perform private.assert_compensation_access();
  perform 1 from public.organizations o where o.id = v_org for no key update;

  select * into v_row from public.retention_grids g where g.id = p_id and g.org_id = v_org;
  if v_row.id is null then
    raise exception 'Grille introuvable.' using errcode = 'P0001';
  end if;
  if v_row.effective_to is not null then
    raise exception 'Seule la dernière grille d''une profession peut être supprimée.' using errcode = 'P0001';
  end if;
  perform private.assert_dated_deletable(v_row.effective_from, v_row.created_at, 'Une grille déjà en vigueur ne peut pas être supprimée.');

  delete from public.retention_grids g where g.id = v_row.id and g.org_id = v_org;
  update public.retention_grids g
     set effective_to = null
   where g.org_id = v_org and g.title_id = v_row.title_id and g.effective_to = v_row.effective_from;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sessions, month by month (P4-186)
-- -----------------------------------------------------------------------------
-- Writes one month's sessions for one or more professionals (the record's « Ajouter les séances
-- du mois » sends one entry, « Révision mensuelle » the rows it changed). p_entries: 1–500 of
-- {professional_id, sessions_50_60, sessions_30, adjustment?, note?, expected_updated_at}: a
-- month's row is replaced by what is sent (adjustment and note absent: kept), and removed when
-- nothing is left (0, 0, 0). expected_updated_at is the updated_at read for that month (null
-- when there was none): another change since then refuses the whole call (P0001, HINT stale,
-- DETAIL the professional's id). Values are refused before any lock, HINT naming the field
-- (sessions_long, sessions_short, adjustment, note, month) and DETAIL the professional's id. A
-- month after the clinic's current month is refused; so is any cumulative total that would go
-- below 0 at some month. All or nothing. Returns the number of entries.
create function public.record_monthly_sessions(p_month date, p_entries jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_month date;
  v_ids uuid[];
  v_locked int;
  e jsonb;
  v_id uuid;
  v_long numeric;
  v_short numeric;
  v_adjustment numeric;
  v_note text;
  v_message text;
  v_existing public.professional_session_counts;
  v_expected timestamptz;
  v_bad uuid;
begin
  perform private.assert_compensation_access();

  -- Contract.
  if pg_catalog.jsonb_typeof(p_entries) is distinct from 'array' or pg_catalog.jsonb_array_length(p_entries) not between 1 and 500
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_entries) x(v)
                 where case when pg_catalog.jsonb_typeof(x.v) <> 'object' then true
                            else exists (select 1 from pg_catalog.jsonb_object_keys(x.v) k
                                          where k <> all (array['professional_id', 'sessions_50_60', 'sessions_30', 'adjustment',
                                                                'note', 'expected_updated_at']))
                                 or coalesce(x.v ->> 'professional_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                 or pg_catalog.jsonb_typeof(x.v -> 'sessions_50_60') is distinct from 'number'
                                 or pg_catalog.jsonb_typeof(x.v -> 'sessions_30') is distinct from 'number'
                                 or pg_catalog.jsonb_typeof(x.v -> 'adjustment') not in ('number', 'null')
                                 or pg_catalog.jsonb_typeof(x.v -> 'note') not in ('string', 'null')
                                 or not (x.v ? 'expected_updated_at')
                                 or pg_catalog.jsonb_typeof(x.v -> 'expected_updated_at') not in ('string', 'null') end) then
    raise exception 'Entrées invalides : [{"professional_id", "sessions_50_60", "sessions_30", "adjustment"?, "note"?, "expected_updated_at"}] (1 à 500) attendu.'
      using errcode = '22023';
  end if;
  select array_agg(distinct (x.v ->> 'professional_id')::uuid order by (x.v ->> 'professional_id')::uuid)
    into v_ids from pg_catalog.jsonb_array_elements(p_entries) x(v);
  if pg_catalog.cardinality(v_ids) <> pg_catalog.jsonb_array_length(p_entries) then
    raise exception 'Un professionnel apparaît deux fois.' using errcode = '22023';
  end if;
  begin
    perform (x.v ->> 'expected_updated_at')::timestamptz from pg_catalog.jsonb_array_elements(p_entries) x(v);
  exception when others then
    raise exception 'expected_updated_at : date et heure attendues.' using errcode = '22023';
  end;

  -- Values (before any lock).
  if p_month is null then
    raise exception 'Le mois est requis.' using errcode = 'P0001', hint = 'month';
  end if;
  perform private.assert_compensation_date(p_month, 'month');
  v_month := pg_catalog.date_trunc('month', p_month)::date;
  if v_month > pg_catalog.date_trunc('month', private.clinic_today())::date then
    raise exception 'Les séances d''un mois à venir ne peuvent pas être saisies.' using errcode = 'P0001', hint = 'month';
  end if;
  for e in select x.v from pg_catalog.jsonb_array_elements(p_entries) x(v) loop
    v_id := (e ->> 'professional_id')::uuid;
    v_long := (e ->> 'sessions_50_60')::numeric;
    v_short := (e ->> 'sessions_30')::numeric;
    v_adjustment := (e ->> 'adjustment')::numeric;
    if v_long not between 0 and 2000 or v_long <> pg_catalog.trunc(v_long) then
      raise exception 'Le nombre de séances de 50 ou 60 minutes est un nombre entier de 0 à 2 000.'
        using errcode = 'P0001', hint = 'sessions_long', detail = v_id::text;
    end if;
    if v_short not between 0 and 2000 or v_short <> pg_catalog.trunc(v_short) then
      raise exception 'Le nombre de séances de 30 minutes est un nombre entier de 0 à 2 000.'
        using errcode = 'P0001', hint = 'sessions_short', detail = v_id::text;
    end if;
    if v_adjustment not between -100000 and 100000 or v_adjustment * 2 <> pg_catalog.trunc(v_adjustment * 2) then
      raise exception 'L''ajustement est un nombre de séances entre -100 000 et 100 000, par demi-séance.'
        using errcode = 'P0001', hint = 'adjustment', detail = v_id::text;
    end if;
    begin
      perform private.compensation_note(e ->> 'note');
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      raise exception '%', v_message using errcode = 'P0001', hint = 'note', detail = v_id::text;
    end;
  end loop;

  -- Lock every professional named, in id order (no deadlock between two batches).
  select count(*) into v_locked
    from (select 1 from public.professionals p
           where p.org_id = v_org and p.id = any (v_ids)
           order by p.id
             for no key update) x;
  if v_locked <> pg_catalog.cardinality(v_ids) then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;

  for e in select x.v from pg_catalog.jsonb_array_elements(p_entries) x(v) loop
    v_id := (e ->> 'professional_id')::uuid;
    v_expected := (e ->> 'expected_updated_at')::timestamptz;
    select * into v_existing from public.professional_session_counts c
     where c.professional_id = v_id and c.org_id = v_org and c.month = v_month;
    if pg_catalog.date_trunc('milliseconds', v_existing.updated_at) is distinct from pg_catalog.date_trunc('milliseconds', v_expected) then
      raise exception 'Les séances de ce mois ont été modifiées depuis leur affichage.'
        using errcode = 'P0001', hint = 'stale', detail = v_id::text;
    end if;
    v_long := (e ->> 'sessions_50_60')::numeric;
    v_short := (e ->> 'sessions_30')::numeric;
    v_adjustment := case when e ? 'adjustment' then coalesce((e ->> 'adjustment')::numeric, 0) else coalesce(v_existing.adjustment, 0) end;
    v_note := case when e ? 'note' then private.compensation_note(e ->> 'note') else v_existing.note end;

    if v_long = 0 and v_short = 0 and v_adjustment = 0 then
      delete from public.professional_session_counts c
       where c.professional_id = v_id and c.org_id = v_org and c.month = v_month;
    else
      insert into public.professional_session_counts as c
        (org_id, professional_id, month, sessions_50_60, sessions_30, adjustment, note, created_by, updated_by)
      values (v_org, v_id, v_month, v_long::int, v_short::int, v_adjustment, v_note, auth.uid(), auth.uid())
      on conflict (professional_id, month) do update
        set sessions_50_60 = excluded.sessions_50_60,
            sessions_30 = excluded.sessions_30,
            adjustment = excluded.adjustment,
            note = excluded.note,
            updated_by = excluded.updated_by
        where c.org_id = v_org;
    end if;
  end loop;

  -- The running total never goes below 0 (a correction cannot remove more than was counted).
  select x.professional_id into v_bad
    from (select c.professional_id,
                 sum(c.sessions_50_60 + c.sessions_30 * 0.5 + c.adjustment)
                   over (partition by c.professional_id order by c.month) as running
            from public.professional_session_counts c
           where c.org_id = v_org and c.professional_id = any (v_ids)) x
   where x.running < 0
   order by x.professional_id
   limit 1;
  if v_bad is not null then
    raise exception 'Le total cumulé de séances ne peut pas devenir négatif.'
      using errcode = 'P0001', hint = 'adjustment', detail = v_bad::text;
  end if;
  return pg_catalog.jsonb_array_length(p_entries);
end;
$$;

-- -----------------------------------------------------------------------------
-- Decisions on the applied retention (P4-187)
-- -----------------------------------------------------------------------------
-- A new applied rate from p_effective_from (closes the open one on that date):
--   initial     p_retention_pct required; only while the professional has no rate;
--   suggested   the grid's suggestion for the count (p_retention_pct must be null);
--   maintained  the open rate again, remembering the tier the count is in (p_retention_pct null);
--   custom      p_retention_pct and a note required; remembers the tier too (P4-188: a new tier
--               flags it again).
-- The count is every month through p_count_month (required; the reviewed month from « Révision
-- mensuelle », the clinic's current month from the record; not after the clinic's month, HINT
-- month), with the grid in force on p_effective_from: exactly what the caller showed, so applying
-- the suggestion stores the rate the dialog announced (P4-187). p_expected_open_id is the open
-- decision the caller read (null when there was none): another decision or deletion since then
-- refuses the call (P0001, HINT stale), so two people never decide on different states.
-- Returns {id, retention_pct, decreased}: decreased when the rate is lower than the open one
-- (an « augmentation » for the professional; the notice email is 4b's, P4-191).
create function public.decide_retention(
  p_id uuid,
  p_decision text,
  p_retention_pct numeric,
  p_effective_from date,
  p_note text,
  p_count_month date,
  p_expected_open_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pct numeric := round(p_retention_pct, 2);
  v_note text;
  v_month date;
  v_open public.professional_retention;
  v_state record;
  v_id uuid;
begin
  perform private.assert_compensation_access();
  if p_decision is null or p_decision not in ('initial', 'suggested', 'maintained', 'custom') then
    raise exception 'Décision inconnue (initial, suggested, maintained ou custom).' using errcode = '22023';
  end if;
  if p_decision in ('suggested', 'maintained') and p_retention_pct is not null then
    raise exception 'Le taux de cette décision est calculé : p_retention_pct doit être nul.' using errcode = '22023';
  end if;
  if p_decision in ('initial', 'custom') and (v_pct is null or v_pct < 0 or v_pct > 100) then
    raise exception 'Le taux est compris entre 0 et 100 %%.' using errcode = 'P0001', hint = 'retention_pct';
  end if;
  v_note := private.compensation_note(p_note);
  if p_decision = 'custom' and v_note is null then
    raise exception 'Précisez la raison du taux particulier.' using errcode = 'P0001', hint = 'note';
  end if;
  -- Values before any lock: the start date (null and bounds; « after the open one » needs the lock).
  perform private.assert_starts_after(p_effective_from, null, null);
  if p_count_month is null then
    raise exception 'Le mois du décompte est requis.' using errcode = 'P0001', hint = 'month';
  end if;
  perform private.assert_compensation_date(p_count_month, 'month');
  v_month := pg_catalog.date_trunc('month', p_count_month)::date;
  if v_month > pg_catalog.date_trunc('month', private.clinic_today())::date then
    raise exception 'Le décompte ne peut pas porter sur un mois à venir.' using errcode = 'P0001', hint = 'month';
  end if;

  perform private.lock_professional(p_id);
  select * into v_open from public.professional_retention r
   where r.professional_id = p_id and r.org_id = v_org and r.effective_to is null;
  if v_open.id is distinct from p_expected_open_id then
    raise exception 'Le taux de ce professionnel a été modifié depuis son affichage.' using errcode = 'P0001', hint = 'stale';
  end if;
  if p_decision = 'initial' and exists (select 1 from public.professional_retention r
                                         where r.professional_id = p_id and r.org_id = v_org) then
    raise exception 'Un taux est déjà appliqué : choisissez une autre décision.' using errcode = 'P0001';
  end if;
  if p_decision = 'maintained' and v_open.id is null then
    raise exception 'Aucun taux à maintenir.' using errcode = 'P0001';
  end if;
  perform private.assert_starts_after(p_effective_from, v_open.effective_from, 'Le nouveau taux doit commencer après le');

  select o.* into v_state
    from private.retention_overview(v_org, v_month, p_effective_from) o
   where o.professional_id = p_id;
  if p_decision in ('suggested', 'maintained') and v_state.suggested_pct is null then
    raise exception 'Aucune grille ne s''applique à la profession principale de ce professionnel à cette date.'
      using errcode = 'P0001', hint = 'effective_from';
  end if;
  v_pct := case p_decision when 'suggested' then v_state.suggested_pct
                           when 'maintained' then v_open.retention_pct
                           else v_pct end;

  if v_open.id is not null then
    update public.professional_retention r set effective_to = p_effective_from
     where r.professional_id = p_id and r.org_id = v_org and r.id = v_open.id;
  end if;
  insert into public.professional_retention
    (org_id, professional_id, retention_pct, decision, tier_threshold, suggested_pct, sessions_total,
     effective_from, note, created_by)
  values (v_org, p_id, v_pct, p_decision, v_state.suggested_threshold, v_state.suggested_pct, v_state.sessions_total,
          p_effective_from, v_note, auth.uid())
  returning id into v_id;
  return pg_catalog.jsonb_build_object('id', v_id, 'retention_pct', v_pct,
                                       'decreased', coalesce(v_pct < v_open.retention_pct, false));
end;
$$;

-- Removes a professional's last (open) rate within the correction window and reopens the
-- previous one, if any (the first may go: the professional is « Écart à valider » again).
create function public.delete_professional_retention(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.professional_retention;
begin
  perform private.assert_compensation_access();
  select * into v_row from public.professional_retention r where r.id = p_row_id and r.org_id = v_org;
  if v_row.id is null then
    raise exception 'Taux introuvable.' using errcode = 'P0001';
  end if;
  perform private.lock_professional(v_row.professional_id);
  -- Re-read under the lock: another call may have closed or removed it meanwhile.
  select * into v_row from public.professional_retention r where r.id = p_row_id and r.org_id = v_org;
  if v_row.id is null then
    raise exception 'Taux introuvable.' using errcode = 'P0001';
  end if;
  if v_row.effective_to is not null then
    raise exception 'Seul le dernier taux peut être supprimé.' using errcode = 'P0001';
  end if;
  perform private.assert_dated_deletable(v_row.effective_from, v_row.created_at, 'Un taux déjà en vigueur ne peut pas être supprimé.');

  delete from public.professional_retention r
   where r.professional_id = v_row.professional_id and r.org_id = v_org and r.id = v_row.id;
  update public.professional_retention r
     set effective_to = null
   where r.professional_id = v_row.professional_id and r.org_id = v_org and r.effective_to = v_row.effective_from;
end;
$$;

-- -----------------------------------------------------------------------------
-- Client agreements (« Ententes particulières », P4-183)
-- -----------------------------------------------------------------------------
create function private.assert_agreement_duration(p_duration int)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_duration is null or p_duration not in (60, 50, 30) then
    raise exception 'Durée inconnue (60, 50 ou 30).' using errcode = '22023';
  end if;
end;
$$;

-- An agreement for one client and duration from p_effective_from: closes that client's open
-- agreement of the same duration on that date; after an ended one, the next starts on its end
-- or later. The label is tidied (one line, at most 40 characters, HINT client_label); amounts in
-- cents, 0,01 $ to 1 000 $ (HINT professional_amount / client_price), both required, the
-- professional's never above the client's price (HINT professional_amount).
create function public.set_professional_client_agreement(
  p_id uuid,
  p_client_label text,
  p_duration int,
  p_professional_amount_cents int,
  p_client_price_cents int,
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
  v_label text;
  v_note text;
  v_message text;
  v_open public.professional_client_agreements;
  v_last_end date;
  v_id uuid;
begin
  perform private.assert_compensation_access();
  perform private.assert_agreement_duration(p_duration);
  begin
    v_label := private.reference_text(p_client_label, 'La référence du client', 40, true, true);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message = message_text;
    raise exception '%', v_message using errcode = 'P0001', hint = 'client_label';
  end;
  -- A light guard against a full name (P4-183, Loi 25): two or more words of letters (2 or more
  -- each, hyphens and apostrophes inside) and no digit. « AB-123 », « M.T. », « D-1042 » pass.
  if v_label !~ '[0-9]' and v_label ~ '^[[:alpha:]][[:alpha:]''’-]+([[:space:]]+[[:alpha:]][[:alpha:]''’-]+)+$' then
    raise exception 'Numéro de dossier ou initiales seulement.' using errcode = 'P0001', hint = 'client_label';
  end if;
  if p_professional_amount_cents is null or p_professional_amount_cents not between 1 and 100000 then
    raise exception 'Le montant versé est compris entre 0,01 $ et 1 000 $.' using errcode = 'P0001', hint = 'professional_amount';
  end if;
  if p_client_price_cents is null or p_client_price_cents not between 1 and 100000 then
    raise exception 'Le prix payé par le client est compris entre 0,01 $ et 1 000 $.' using errcode = 'P0001', hint = 'client_price';
  end if;
  if p_professional_amount_cents > p_client_price_cents then
    raise exception 'Le montant versé au professionnel ne peut pas dépasser le prix payé par le client.'
      using errcode = 'P0001', hint = 'professional_amount';
  end if;
  v_note := private.compensation_note(p_note);
  perform private.assert_compensation_date(p_effective_from, 'effective_from');

  perform private.lock_professional(p_id);
  select * into v_open from public.professional_client_agreements a
   where a.professional_id = p_id and a.org_id = v_org and a.duration = p_duration
     and a.client_id is null and pg_catalog.lower(a.client_label) = pg_catalog.lower(v_label)
     and a.effective_to is null;
  perform private.assert_starts_after(p_effective_from, v_open.effective_from, 'La nouvelle entente doit commencer après le');
  select max(a.effective_to) into v_last_end from public.professional_client_agreements a
   where a.professional_id = p_id and a.org_id = v_org and a.duration = p_duration
     and a.client_id is null and pg_catalog.lower(a.client_label) = pg_catalog.lower(v_label);
  if v_last_end is not null and p_effective_from < v_last_end then
    raise exception 'La nouvelle entente doit commencer au plus tôt le %.', pg_catalog.to_char(v_last_end, 'YYYY-MM-DD')
      using errcode = 'P0001', hint = 'effective_from';
  end if;
  if v_open.id is not null then
    update public.professional_client_agreements a set effective_to = p_effective_from
     where a.professional_id = p_id and a.org_id = v_org and a.id = v_open.id;
  end if;

  insert into public.professional_client_agreements
    (org_id, professional_id, client_label, duration, professional_amount_cents, client_price_cents, effective_from, note, created_by)
  values (v_org, p_id, v_label, p_duration, p_professional_amount_cents, p_client_price_cents, p_effective_from, v_note, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- The agreement's later rows (same client, same duration): an agreement is ended or deleted only
-- when it is that series' last row.
create function private.agreement_has_successor(p_row public.professional_client_agreements)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.professional_client_agreements a
                  where a.professional_id = p_row.professional_id and a.org_id = p_row.org_id
                    and a.duration = p_row.duration
                    and coalesce(a.client_id::text, pg_catalog.lower(a.client_label))
                        = coalesce(p_row.client_id::text, pg_catalog.lower(p_row.client_label))
                    and a.effective_from > p_row.effective_from)
$$;

-- Ends an agreement on p_effective_to (exclusive: the grid applies again from that day), or
-- reopens it with null. Only the last row of its client and duration. The end may not be before
-- the clinic's today (HINT effective_to): sessions already given under the agreement keep it.
create function public.end_professional_client_agreement(p_row_id uuid, p_effective_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.professional_client_agreements;
begin
  perform private.assert_compensation_access();
  perform private.assert_compensation_date(p_effective_to, 'effective_to');
  if p_effective_to < private.clinic_today() then
    raise exception 'La fin de l''entente ne peut pas précéder aujourd''hui.' using errcode = 'P0001', hint = 'effective_to';
  end if;
  select * into v_row from public.professional_client_agreements a where a.id = p_row_id and a.org_id = v_org;
  if v_row.id is null then
    raise exception 'Entente introuvable.' using errcode = 'P0001';
  end if;
  perform private.lock_professional(v_row.professional_id);
  select * into v_row from public.professional_client_agreements a where a.id = p_row_id and a.org_id = v_org;
  if v_row.id is null then
    raise exception 'Entente introuvable.' using errcode = 'P0001';
  end if;
  if private.agreement_has_successor(v_row) then
    raise exception 'Seule la dernière entente d''un client et d''une durée peut prendre fin.' using errcode = 'P0001';
  end if;
  if p_effective_to is not null and p_effective_to <= v_row.effective_from then
    raise exception 'La fin doit suivre le début (%).', pg_catalog.to_char(v_row.effective_from, 'YYYY-MM-DD')
      using errcode = 'P0001', hint = 'effective_to';
  end if;
  update public.professional_client_agreements a set effective_to = p_effective_to
   where a.professional_id = v_row.professional_id and a.org_id = v_org and a.id = v_row.id;
end;
$$;

-- Removes the last agreement of a client and duration within the correction window; the
-- previous one, when it ended on this one's start, is reopened.
create function public.delete_professional_client_agreement(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.professional_client_agreements;
begin
  perform private.assert_compensation_access();
  select * into v_row from public.professional_client_agreements a where a.id = p_row_id and a.org_id = v_org;
  if v_row.id is null then
    raise exception 'Entente introuvable.' using errcode = 'P0001';
  end if;
  perform private.lock_professional(v_row.professional_id);
  select * into v_row from public.professional_client_agreements a where a.id = p_row_id and a.org_id = v_org;
  if v_row.id is null then
    raise exception 'Entente introuvable.' using errcode = 'P0001';
  end if;
  if private.agreement_has_successor(v_row) then
    raise exception 'Seule la dernière entente d''un client et d''une durée peut être supprimée.' using errcode = 'P0001';
  end if;
  perform private.assert_dated_deletable(v_row.effective_from, v_row.created_at, 'Une entente déjà en vigueur ne peut pas être supprimée.');

  delete from public.professional_client_agreements a
   where a.professional_id = v_row.professional_id and a.org_id = v_org and a.id = v_row.id;
  update public.professional_client_agreements a
     set effective_to = null
   where a.professional_id = v_row.professional_id and a.org_id = v_org and a.duration = v_row.duration
     and coalesce(a.client_id::text, pg_catalog.lower(a.client_label))
         = coalesce(v_row.client_id::text, pg_catalog.lower(v_row.client_label))
     and a.effective_to = v_row.effective_from;
end;
$$;

-- -----------------------------------------------------------------------------
-- Read models
-- -----------------------------------------------------------------------------
-- A professional's compensation on a date (clinic today by default, P4-194): the primary title,
-- its grid in force (tiers, floor), the cumulative sessions (every month up to p_on's), the
-- applied rate (the latest decision) with the one in force on p_on, the suggestion and the next
-- tier, the status, the pay per duration (applied_cents at the rate in force on p_on, what
-- Facturation pays that day; upcoming_cents at the latest decision when it starts after p_on;
-- suggested_cents), the client agreements in force on p_on, and the other kinds' rates in force.
-- Read model for the record, 4d and Facturation.
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
  v_state record;
begin
  perform private.assert_compensation_access();
  if not exists (select 1 from public.professionals p where p.id = p_id and p.org_id = v_org) then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  perform private.assert_compensation_date(p_on, 'on');
  v_on := coalesce(p_on, private.clinic_today());

  select o.* into v_state
    from private.retention_overview(v_org, pg_catalog.date_trunc('month', v_on)::date, v_on) o
   where o.professional_id = p_id;

  return pg_catalog.jsonb_build_object(
    'on', v_on,
    'title', case when v_state.title_id is null then null
                  else pg_catalog.jsonb_build_object('id', v_state.title_id, 'name', v_state.title_name) end,
    'grid', case when v_state.grid_id is null then null else (
      select pg_catalog.jsonb_build_object(
               'id', g.id,
               'effective_from', g.effective_from,
               'floor_pct', v_state.floor_pct,
               'tiers', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                  'threshold_sessions', t.threshold_sessions, 'retention_pct', t.retention_pct)
                                  order by t.threshold_sessions), '[]'::jsonb)
                           from public.retention_grid_tiers t where t.grid_id = g.id and t.org_id = v_org))
        from public.retention_grids g where g.id = v_state.grid_id and g.org_id = v_org) end,
    'sessions_total', v_state.sessions_total,
    'applied', case when v_state.applied_id is null then null
                    else pg_catalog.jsonb_build_object(
                           'id', v_state.applied_id, 'retention_pct', v_state.applied_pct,
                           'decision', v_state.applied_decision, 'effective_from', v_state.applied_from,
                           'tier_threshold', v_state.applied_tier, 'note', v_state.applied_note) end,
    'previous_pct', v_state.previous_pct,
    'in_force_pct', v_state.in_force_pct,
    'suggested', case when v_state.suggested_pct is null then null
                      else pg_catalog.jsonb_build_object('threshold_sessions', v_state.suggested_threshold,
                                                         'retention_pct', v_state.suggested_pct) end,
    'next', case when v_state.next_pct is null then null
                 else pg_catalog.jsonb_build_object('threshold_sessions', v_state.next_threshold,
                                                    'retention_pct', v_state.next_pct) end,
    'status', v_state.status,
    'pay', private.retention_pay(v_org, v_state.grid_id, v_state.in_force_pct, v_state.suggested_pct,
                                 case when v_state.applied_from > v_on then v_state.applied_pct end),
    'agreements', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', a.id, 'client_label', a.client_label, 'client_id', a.client_id, 'duration', a.duration,
               'professional_amount_cents', a.professional_amount_cents, 'client_price_cents', a.client_price_cents,
               'effective_from', a.effective_from, 'effective_to', a.effective_to)
               order by a.duration desc, pg_catalog.lower(a.client_label), a.id), '[]'::jsonb)
        from public.professional_client_agreements a
       where a.professional_id = p_id and a.org_id = v_org
         and a.effective_from <= v_on and (a.effective_to is null or v_on < a.effective_to)),
    'other_rates', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'kind', k.key, 'name', k.name, 'retention_pct', c.retention_pct, 'effective_from', c.effective_from)
               order by k.sort_order, k.key), '[]'::jsonb)
        from public.compensation_kinds k
        left join public.compensation_rates c
          on c.org_id = v_org and c.kind = k.key
         and c.effective_from <= v_on and (c.effective_to is null or v_on < c.effective_to))
  );
end;
$$;

-- « Révision mensuelle » in one read (P4-190): every active professional of the clinic, with the
-- month's entry (and its updated_at, for record_monthly_sessions), the count before the month and
-- through it, the applied rate (latest decision) and the one in force on the first day of the
-- next month, the suggestion, the next tier, the status, increase_decided (a « suggested »
-- decision lowering the rate from the next month: the sheet's green), the pay on that day (in
-- force, upcoming, suggested), and the number of client agreements in force on that day.
create function public.list_retention_review(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_month date;
  v_on date;
begin
  perform private.assert_compensation_access();
  if p_month is null then
    raise exception 'Le mois est requis.' using errcode = 'P0001', hint = 'month';
  end if;
  perform private.assert_compensation_date(p_month, 'month');
  v_month := pg_catalog.date_trunc('month', p_month)::date;
  v_on := (v_month + interval '1 month')::date;

  return pg_catalog.jsonb_build_object(
    'month', v_month,
    'on', v_on,
    'rows', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', p.id,
               'first_name', p.first_name,
               'last_name', p.last_name,
               'title_name', o.title_name,
               'entry', case when e.id is null then null else pg_catalog.jsonb_build_object(
                          'sessions_50_60', e.sessions_50_60, 'sessions_30', e.sessions_30,
                          'adjustment', e.adjustment, 'note', e.note, 'updated_at', e.updated_at) end,
               'sessions_before', o.sessions_total - coalesce(e.sessions_50_60 + e.sessions_30 * 0.5 + e.adjustment, 0),
               'sessions_total', o.sessions_total,
               'applied', case when o.applied_id is null then null else pg_catalog.jsonb_build_object(
                            'id', o.applied_id, 'retention_pct', o.applied_pct, 'decision', o.applied_decision,
                            'effective_from', o.applied_from, 'tier_threshold', o.applied_tier, 'note', o.applied_note) end,
               'previous_pct', o.previous_pct,
               'in_force_pct', o.in_force_pct,
               'suggested', case when o.suggested_pct is null then null else pg_catalog.jsonb_build_object(
                              'threshold_sessions', o.suggested_threshold, 'retention_pct', o.suggested_pct) end,
               'next', case when o.next_pct is null then null else pg_catalog.jsonb_build_object(
                         'threshold_sessions', o.next_threshold, 'retention_pct', o.next_pct) end,
               'floor_pct', o.floor_pct,
               'status', o.status,
               'increase_decided', coalesce(o.applied_decision = 'suggested' and o.applied_pct < o.previous_pct
                                            and o.applied_from >= v_on
                                            and o.applied_from < (v_on + interval '1 month')::date, false),
               'pay', private.retention_pay(v_org, o.grid_id, o.in_force_pct, o.suggested_pct,
                                            case when o.applied_from > v_on then o.applied_pct end),
               'agreements', (select count(*) from public.professional_client_agreements a
                               where a.professional_id = p.id and a.org_id = v_org
                                 and a.effective_from <= v_on and (a.effective_to is null or v_on < a.effective_to))
             ) order by pg_catalog.lower(p.last_name), pg_catalog.lower(p.first_name), p.id), '[]'::jsonb)
        from private.retention_overview(v_org, v_month, v_on) o
        join public.professionals p on p.id = o.professional_id and p.org_id = v_org
        left join public.professional_session_counts e
          on e.professional_id = p.id and e.org_id = v_org and e.month = v_month
       where p.status = 'active')
  );
end;
$$;

revoke all on function
  private.assert_compensation_access(),
  private.assert_compensation_kind(text),
  private.compensation_note(text),
  private.assert_compensation_date(date, text),
  private.assert_starts_after(date, date, text),
  private.assert_dated_deletable(date, timestamptz, text),
  private.assert_agreement_duration(int),
  private.agreement_has_successor(public.professional_client_agreements),
  private.retention_pay_cents(int, numeric),
  private.retention_overview(uuid, date, date),
  private.retention_pay(uuid, uuid, numeric, numeric, numeric)
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
               'professional_professions', 'professional_clienteles',
               'professional_motifs', 'professional_languages', 'professional_payer_numbers',
               'professional_private', 'professional_retention', 'professional_session_counts',
               'professional_client_agreements']
$$;

-- The tables of a professional's history that only professionals.compensation sees.
create function private.professional_compensation_history_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['professional_retention', 'professional_session_counts', 'professional_client_agreements']
$$;

-- Same signature, grants and paging as *_professionals_lifecycle.sql. Two changes:
-- * professional_private rows carry no changed_fields (every value is redacted anyway; the
--   history says only that the private data changed), except reads, which keep only the string
--   elements 'sin' and 'bank_account' of their field list ({"fields": [...]}) and nothing else;
-- * the retention, session count and client agreement rows show only to holders of
--   professionals.compensation (professionals.view alone does not open them).
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
    v_tables := array(select t from pg_catalog.unnest(v_tables) t
                       where t <> all (private.professional_compensation_history_tables()));
  end if;
  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action,
           case
             when a.table_name <> 'professional_private' then a.changed_fields
             when a.action = 'read' and pg_catalog.jsonb_typeof(a.changed_fields -> 'fields') = 'array'
               then pg_catalog.jsonb_build_object('fields', (
                      select coalesce(pg_catalog.jsonb_agg(f.value order by f.ord), '[]'::jsonb)
                        from pg_catalog.jsonb_array_elements(a.changed_fields -> 'fields') with ordinality as f(value, ord)
                       where f.value in ('"sin"'::jsonb, '"bank_account"'::jsonb)))
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
revoke all on function private.professional_compensation_history_tables() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Import (*_professionals_import.sql): two optional keys (P4-192)
-- -----------------------------------------------------------------------------
-- Same signature, grants (authenticated), SECURITY INVOKER and results as before; the rest of
-- the import (contract, helpers, all-or-nothing block) is unchanged. New optional keys:
-- * retention_pct (number): the rate applied today, written as an « initial » decision from the
--   first day of the clinic's current month through decide_retention (so the first review's
--   decision, for the first day of a later month, starts after it; the rate covers the whole
--   import month);
-- * cumulative_sessions (number, half sessions allowed): the count so far, written as the opening
--   adjustment of the month before the clinic's current month (the last month the clinic's sheet
--   counted) through record_monthly_sessions.
-- Either one needs professionals.compensation (42501 otherwise: a bug of the caller, as the other
-- permissions). Values out of bounds are row errors on retentionPct / cumulativeSessions. Both
-- run inside the row's block, so a dry run writes nothing and a refusal undoes the whole row. A
-- skipped row (email already present) ignores them: the record's « Rétention » card sets them.
create or replace function public.import_professional(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_dry boolean := coalesce(p_dry_run, true);
  v_activate boolean;
  v_existing uuid;
  v_contact jsonb;
  v_sets jsonb;
  v_result record;
  v_errors jsonb;
  v_deferred boolean := false;
  v_message text;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_pct numeric;
  v_sessions numeric;
  v_comp_errors jsonb := '[]';
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(p_row) = 'object' then
    if pg_catalog.jsonb_typeof(p_row -> 'retention_pct') not in ('number', 'null') then
      raise exception 'Nombre attendu : retention_pct' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(p_row -> 'cumulative_sessions') not in ('number', 'null') then
      raise exception 'Nombre attendu : cumulative_sessions' using errcode = '22023';
    end if;
    v_pct := (p_row ->> 'retention_pct')::numeric;
    v_sessions := (p_row ->> 'cumulative_sessions')::numeric;
  end if;
  perform private.import_professional_check(case when pg_catalog.jsonb_typeof(p_row) = 'object'
                                                 then p_row - 'retention_pct' - 'cumulative_sessions' else p_row end);
  v_activate := coalesce((p_row ->> 'activate')::boolean, false);
  if v_activate and not private.has_permission('professionals.activate_override') then
    raise exception 'Permission refusée : professionals.activate_override' using errcode = '42501';
  end if;
  if (v_pct is not null or v_sessions is not null) and not private.has_permission('professionals.compensation') then
    raise exception 'Permission refusée : professionals.compensation' using errcode = '42501';
  end if;

  -- Idempotent re-runs: the clinic already has this professional (email as private.professional_email stores it).
  select p.id into v_existing from public.professionals p
   where p.org_id = v_org and p.email = pg_catalog.lower(pg_catalog.btrim(coalesce(p_row ->> 'email', ''), E' \t\r\n'));
  if v_existing is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', v_existing, 'reason', 'Courriel déjà présent');
  end if;

  v_contact := private.import_professional_contact(p_row);
  v_sets := private.import_professional_sets(v_org, p_row);
  -- The two compensation values, checked as the record's dialogs check them.
  if v_pct is not null and (v_pct < 0 or v_pct > 100 or v_pct <> round(v_pct, 2)) then
    v_comp_errors := v_comp_errors || pg_catalog.jsonb_build_object('field', 'retentionPct',
      'message', 'Le taux de retenue est un pourcentage entre 0 et 100, à deux décimales au plus.');
  end if;
  if v_sessions is not null and (v_sessions < 0 or v_sessions > 100000 or v_sessions * 2 <> pg_catalog.trunc(v_sessions * 2)) then
    v_comp_errors := v_comp_errors || pg_catalog.jsonb_build_object('field', 'cumulativeSessions',
      'message', 'Le nombre de séances cumulées est compris entre 0 et 100 000, par demi-séance.');
  end if;

  perform pg_catalog.set_config('app.audit_source', 'import', true);
  begin
    select * into v_result from private.import_professional_apply(p_row, v_contact, v_sets, v_activate);
    v_errors := (v_contact -> 'errors') || (v_sets -> 'errors') || v_comp_errors || v_result.errors;
    if v_result.id is not null and v_errors = '[]' then
      if v_sessions is not null and v_sessions > 0 then
        begin
          perform public.record_monthly_sessions(
            (pg_catalog.date_trunc('month', private.clinic_today()) - interval '1 month')::date,
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'professional_id', v_result.id, 'sessions_50_60', 0, 'sessions_30', 0,
              'adjustment', v_sessions, 'note', 'Solde importé', 'expected_updated_at', null)));
        exception when sqlstate 'P0001' then
          get stacked diagnostics v_message = message_text;
          v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'cumulativeSessions', 'message', v_message);
        end;
      end if;
      if v_pct is not null then
        begin
          perform public.decide_retention(v_result.id, 'initial', v_pct,
                                          pg_catalog.date_trunc('month', private.clinic_today())::date, null,
                                          pg_catalog.date_trunc('month', private.clinic_today())::date, null);
        exception when sqlstate 'P0001' then
          get stacked diagnostics v_message = message_text;
          v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'retentionPct', 'message', v_message);
        end;
      end if;
    end if;
    -- A dry run checks the deferred constraints now (the one-primary-title check), as the commit of
    -- a real run would. Set at this block's level, so its rollback puts the deferred mode back.
    if v_dry and v_errors = '[]' then
      v_deferred := true;
      set constraints all immediate;
      v_deferred := false;
    end if;
    if v_dry or v_errors <> '[]' then
      raise exception 'import_professional: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;  -- everything the block wrote is rolled back; v_result and v_errors keep their values
    when sqlstate 'P0001' then
      -- Only a deferred check refused by set constraints is a row error; anything else propagates.
      if not v_deferred then
        raise;
      end if;
      get stacked diagnostics v_message = message_text;
      v_errors := v_errors || pg_catalog.jsonb_build_object('field', null, 'message', v_message);
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);

  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null, 'errors', v_errors);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry, 'id', case when not v_dry then v_result.id end,
                                       'activated', v_result.activated, 'complete', v_result.complete,
                                       'missing', v_result.missing);
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges (service_role: none; these act for a user)
-- -----------------------------------------------------------------------------
revoke all on function
  public.get_professional_private(uuid),
  public.reveal_professional_private(uuid, text),
  public.set_professional_tax_numbers(uuid, text, text, text, timestamptz),
  public.set_professional_bank(uuid, text, text, text, timestamptz),
  public.set_professional_sin(uuid, text, timestamptz),
  public.clear_professional_private_field(uuid, text),
  public.set_compensation_rate(text, numeric, date),
  public.delete_compensation_rate(uuid),
  public.set_retention_grid(uuid, date, jsonb, jsonb, text),
  public.delete_retention_grid(uuid),
  public.record_monthly_sessions(date, jsonb),
  public.decide_retention(uuid, text, numeric, date, text, date, uuid),
  public.delete_professional_retention(uuid),
  public.set_professional_client_agreement(uuid, text, int, int, int, date, text),
  public.end_professional_client_agreement(uuid, date),
  public.delete_professional_client_agreement(uuid),
  public.get_professional_compensation(uuid, date),
  public.list_retention_review(date)
from public, anon, authenticated, service_role;
grant execute on function
  public.get_professional_private(uuid),
  public.reveal_professional_private(uuid, text),
  public.set_professional_tax_numbers(uuid, text, text, text, timestamptz),
  public.set_professional_bank(uuid, text, text, text, timestamptz),
  public.set_professional_sin(uuid, text, timestamptz),
  public.clear_professional_private_field(uuid, text),
  public.set_compensation_rate(text, numeric, date),
  public.delete_compensation_rate(uuid),
  public.set_retention_grid(uuid, date, jsonb, jsonb, text),
  public.delete_retention_grid(uuid),
  public.record_monthly_sessions(date, jsonb),
  public.decide_retention(uuid, text, numeric, date, text, date, uuid),
  public.delete_professional_retention(uuid),
  public.set_professional_client_agreement(uuid, text, int, int, int, date, text),
  public.end_professional_client_agreement(uuid, date),
  public.delete_professional_client_agreement(uuid),
  public.get_professional_compensation(uuid, date),
  public.list_retention_review(date)
to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
