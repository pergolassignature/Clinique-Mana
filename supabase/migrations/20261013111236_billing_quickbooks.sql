-- =============================================================================
-- Module Facturation (`billing`), batch FQ part 1: the QuickBooks Online connection
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (FQ); roadmap §2.6 and §2.6 bis
-- Decisions: FQ-1 … (docs/plans/2026-10-07-decisions-log.md)
--
-- On F1's module (lane A, `20261013105817_billing_module`: the registry row, `billing.settings`,
-- `payment_modes`, Clients' handler rows): the QuickBooks tables (all `qbo_*`), keyed to F1's
-- `payment_modes` by code (`deposit.<code>` for each mode that lands money, `is_deposit`), and
-- the QuickBooks part of F1's two Clients handlers (replaced, F1's body kept).
--
-- PS Hub's connector is the source (roadmap §2.6), with its flaws fixed:
-- * the tokens are encrypted under a key version (`qbo_connection_tokens`, nobody reads the
--   table; the service RPCs below are the only path; ADR 0004), never plain text readable by a
--   policy;
-- * one connection per clinic, keyed by the clinic (PS Hub keyed it by user and looked it up by
--   org); the realm is fixed once connected: a reconnection to another QuickBooks company is
--   refused until the clinic disconnects;
-- * the OAuth state is signed and single-use (`_shared/oauth-state.ts`); the callback is a user
--   function holding the caller's session;
-- * the keep-alive job goes through `runJob` (`X-Job-Signature`), never a service-role key.
--
-- Nothing is created in QuickBooks in this part (FQ-4): the customers of the company (those made
-- by GOrendezvous) are read into `qbo_customers` and matched to the clinic's clients with Clients'
-- own duplicate rules (`private.clients_find_duplicates`, I-5): HIGH → linked, MEDIUM → « à
-- décider », none → nothing. The parent customer per payer and the sub-customer per (payer,
-- dossier) pair (R-30) are recorded in `qbo_links` by the push (after F1).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:billing_quickbooks', true);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- The actor model (conventions §8b): a service RPC acting for a person re-checks her standing.
create function private.qbo_assert_manager(p_actor uuid, p_org uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_actor is null or p_org is null
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org and p.status = 'active')
     or not ('billing.settings' = any (private.permission_keys_for(p_actor))) then
    raise exception 'Permission refusée : billing.settings' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.qbo_assert_manager(uuid, uuid) from public, anon, authenticated, service_role;

-- A user RPC's check: billing.settings, the caller's clinic.
create function private.qbo_require_settings()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_permission('billing.settings') then
    raise exception 'Permission refusée : billing.settings' using errcode = '42501';
  end if;
  return private.current_user_org_id();
end;
$$;
revoke all on function private.qbo_require_settings() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- qbo_connections: the clinic's QuickBooks company (one per clinic, audited)
-- -----------------------------------------------------------------------------
create table public.qbo_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Intuit's company id (`realmId`), fixed once connected (FQ-2).
  realm_id text not null,
  -- `production` or `sandbox` (Intuit's developer sandbox: tests before the real company).
  environment text not null default 'production',
  company_name text,
  -- `connected`; `needs_reconnect` (Intuit refused the refresh: `invalid_grant`); `disconnected`
  -- (« Déconnecter »: tokens deleted, the snapshots and the links kept).
  status text not null default 'connected',
  status_reason text,
  connected_by uuid references public.profiles(user_id) on delete set null,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  disconnected_by uuid references public.profiles(user_id) on delete set null,
  -- When the refresh token stops working (Intuit: 100 days, renewed at each refresh); shown.
  refresh_token_expires_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text,
  last_error_code text,
  last_error_at timestamptz,
  accounts_synced_at timestamptz,
  customers_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qbo_connections_realm_check check (realm_id ~ '^[0-9]{1,32}$'),
  constraint qbo_connections_environment_check check (environment in ('production', 'sandbox')),
  constraint qbo_connections_status_check check (status in ('connected', 'needs_reconnect', 'disconnected')),
  constraint qbo_connections_status_reason_check check (status_reason is null or status_reason ~ '^[a-z0-9_]{1,64}$'),
  constraint qbo_connections_company_check check (company_name is null or pg_catalog.length(company_name) <= 200),
  constraint qbo_connections_sync_status_check check (last_sync_status is null or last_sync_status in ('ok', 'partial', 'failed')),
  constraint qbo_connections_error_check check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  constraint qbo_connections_org_key unique (org_id),
  constraint qbo_connections_org_id_id_key unique (org_id, id)
);
create index qbo_connections_connected_by_idx on public.qbo_connections (connected_by);
create index qbo_connections_disconnected_by_idx on public.qbo_connections (disconnected_by);

revoke all on public.qbo_connections from anon, authenticated;
grant select on public.qbo_connections to authenticated;
alter table public.qbo_connections enable row level security;
create policy qbo_connections_select on public.qbo_connections
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.settings')));
create trigger qbo_connections_set_updated_at before update on public.qbo_connections
  for each row execute function private.set_updated_at();
create trigger qbo_connections_audit after insert or update or delete on public.qbo_connections
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- qbo_connection_tokens: the OAuth tokens, encrypted (nobody reads the table)
-- -----------------------------------------------------------------------------
create table public.qbo_connection_tokens (
  connection_id uuid primary key references public.qbo_connections(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  access_token bytea not null,
  refresh_token bytea not null,
  access_token_expires_at timestamptz not null,
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qbo_connection_tokens_key_version_check check (key_version >= 1),
  constraint qbo_connection_tokens_connection_fkey foreign key (org_id, connection_id)
    references public.qbo_connections(org_id, id) on delete cascade
);
create index qbo_connection_tokens_org_idx on public.qbo_connection_tokens (org_id, connection_id);
revoke all on public.qbo_connection_tokens from anon, authenticated, service_role;
alter table public.qbo_connection_tokens enable row level security;
-- No policy on purpose: the service RPCs below are the only path.
create trigger qbo_connection_tokens_set_updated_at before update on public.qbo_connection_tokens
  for each row execute function private.set_updated_at();
create trigger qbo_connection_tokens_audit after insert or update or delete on public.qbo_connection_tokens
  for each row execute function private.audit_trigger('access_token', 'refresh_token');

-- The list of encrypted columns (conventions §8): the two token columns added. Same signature,
-- grants (none) and contract as *_core_pii_key_versions.sql.
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
  union all
  select 'professional_submission_private'::text, 'sin'::text, s.submission_id::text, s.key_version::integer, s.sin
    from public.professional_submission_private s
   where s.sin is not null
  union all
  select 'professional_submission_private'::text, 'bank_account'::text, s.submission_id::text, s.key_version::integer, s.bank_account
    from public.professional_submission_private s
   where s.bank_account is not null
  union all
  select 'mail_connection_tokens'::text, 'access_token'::text, t.connection_id::text, t.key_version::integer, t.access_token
    from public.mail_connection_tokens t
  union all
  select 'mail_connection_tokens'::text, 'refresh_token'::text, t.connection_id::text, t.key_version::integer, t.refresh_token
    from public.mail_connection_tokens t
  union all
  select 'video_connection_tokens'::text, 'access_token'::text, t.connection_id::text, t.key_version::integer, t.access_token
    from public.video_connection_tokens t
  union all
  select 'video_connection_tokens'::text, 'refresh_token'::text, t.connection_id::text, t.key_version::integer, t.refresh_token
    from public.video_connection_tokens t  union all
  select 'qbo_connection_tokens'::text, 'access_token'::text, t.connection_id::text, t.key_version::integer, t.access_token
    from public.qbo_connection_tokens t
  union all
  select 'qbo_connection_tokens'::text, 'refresh_token'::text, t.connection_id::text, t.key_version::integer, t.refresh_token
    from public.qbo_connection_tokens t
$$;

-- -----------------------------------------------------------------------------
-- qbo_accounts: the company's chart of accounts, as last read (a mirror, not audited)
-- -----------------------------------------------------------------------------
create table public.qbo_accounts (
  connection_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  qbo_id text not null,
  name text not null,
  fully_qualified_name text,
  acct_num text,
  -- Intuit's `AccountType` (`Income`, `Expense`, `Bank`, `Other Current Asset`…), `AccountSubType`
  -- and `Classification` (`Revenue`, `Expense`, `Asset`…).
  account_type text not null,
  account_sub_type text,
  classification text,
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  constraint qbo_accounts_pkey primary key (connection_id, qbo_id),
  constraint qbo_accounts_connection_fkey foreign key (org_id, connection_id)
    references public.qbo_connections(org_id, id) on delete cascade,
  constraint qbo_accounts_id_check check (qbo_id ~ '^[0-9]{1,32}$'),
  constraint qbo_accounts_text_check check (
    pg_catalog.length(name) between 1 and 200 and pg_catalog.length(coalesce(fully_qualified_name, '')) <= 400
    and pg_catalog.length(coalesce(acct_num, '')) <= 32 and pg_catalog.length(account_type) <= 64
    and pg_catalog.length(coalesce(account_sub_type, '')) <= 64 and pg_catalog.length(coalesce(classification, '')) <= 32)
);
create index qbo_accounts_org_connection_idx on public.qbo_accounts (org_id, connection_id);
revoke all on public.qbo_accounts from anon, authenticated;
grant select on public.qbo_accounts to authenticated;
alter table public.qbo_accounts enable row level security;
create policy qbo_accounts_select on public.qbo_accounts
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.settings')));

-- -----------------------------------------------------------------------------
-- qbo_account_map: which QuickBooks account each kind of entry uses (audited)
-- -----------------------------------------------------------------------------
-- map_key: `revenue.services` (client invoices, « Services »), `revenue.file_opening` (file
-- openings, « Ventes »), `deposit.<mode>` (where a payment of that mode lands: `interac` « 1075
-- Virement bancaire à recevoir », `stripe` « 1070 Banque Stripe », `qbo_payments_card` « Fonds non
-- déposés », `bank_transfer` and `cheque` « Compte courant »: one per F1 `payment_modes` code with
-- `is_deposit`; `credit_note` lands no money, so it has none), `expense` with a profession title
-- (the professionals' invoices by specialty, FPay).
-- qbo_account_id null: not chosen yet. `suggested`: filled by the sync from Christine's defaults
-- (names and numbers), until a person chooses (then false, never overwritten).
create table public.qbo_account_map (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  map_key text not null,
  profession_title_id uuid,
  qbo_account_id text,
  suggested boolean not null default false,
  updated_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qbo_account_map_key_check check (
    map_key in ('revenue.services', 'revenue.file_opening', 'expense')
    or map_key ~ '^deposit\.[a-z][a-z0-9_]{1,40}$'),
  constraint qbo_account_map_title_check check ((map_key = 'expense') = (profession_title_id is not null)),
  constraint qbo_account_map_account_check check (qbo_account_id is null or qbo_account_id ~ '^[0-9]{1,32}$'),
  constraint qbo_account_map_title_fkey foreign key (org_id, profession_title_id)
    references public.profession_titles(org_id, id) on delete cascade
);
create unique index qbo_account_map_key on public.qbo_account_map (org_id, map_key, profession_title_id) nulls not distinct;
create index qbo_account_map_title_idx on public.qbo_account_map (org_id, profession_title_id);
create index qbo_account_map_updated_by_idx on public.qbo_account_map (updated_by);
revoke all on public.qbo_account_map from anon, authenticated;
grant select on public.qbo_account_map to authenticated;
alter table public.qbo_account_map enable row level security;
create policy qbo_account_map_select on public.qbo_account_map
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.settings')));
create trigger qbo_account_map_set_updated_at before update on public.qbo_account_map
  for each row execute function private.set_updated_at();
create trigger qbo_account_map_audit after insert or update or delete on public.qbo_account_map
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- qbo_customers: the company's customers, as last read (a mirror, not audited)
-- -----------------------------------------------------------------------------
-- The customers GOrendezvous made (and any made by hand) are read so they are matched, never
-- duplicated (R-30). is_job / parent_qbo_id: a sub-customer. Names, email and phones are what
-- QuickBooks holds (personal data: billing.settings only; an anonymised client's matched rows are
-- blanked here, QuickBooks keeps its accounting record).
create table public.qbo_customers (
  connection_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  qbo_id text not null,
  display_name text not null,
  given_name text,
  family_name text,
  company_name text,
  email text,
  phones text[] not null default '{}',
  is_job boolean not null default false,
  parent_qbo_id text,
  active boolean not null default true,
  -- A hash of the fields the matching reads: a changed customer is matched again.
  match_input_hash text not null,
  synced_at timestamptz not null default now(),
  constraint qbo_customers_pkey primary key (connection_id, qbo_id),
  constraint qbo_customers_connection_fkey foreign key (org_id, connection_id)
    references public.qbo_connections(org_id, id) on delete cascade,
  constraint qbo_customers_id_check check (qbo_id ~ '^[0-9]{1,32}$' and (parent_qbo_id is null or parent_qbo_id ~ '^[0-9]{1,32}$')),
  constraint qbo_customers_text_check check (
    pg_catalog.length(display_name) between 1 and 500 and pg_catalog.length(coalesce(given_name, '')) <= 100
    and pg_catalog.length(coalesce(family_name, '')) <= 100 and pg_catalog.length(coalesce(company_name, '')) <= 100
    and pg_catalog.length(coalesce(email, '')) <= 254 and pg_catalog.cardinality(phones) <= 4
    and pg_catalog.length(match_input_hash) between 1 and 64)
);
create index qbo_customers_org_connection_idx on public.qbo_customers (org_id, connection_id);
revoke all on public.qbo_customers from anon, authenticated;
grant select on public.qbo_customers to authenticated;
alter table public.qbo_customers enable row level security;
create policy qbo_customers_select on public.qbo_customers
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.settings')));

-- -----------------------------------------------------------------------------
-- qbo_customer_matches: each QuickBooks customer ↔ a client (the mapping report; audited)
-- -----------------------------------------------------------------------------
-- level: the best of Clients' duplicate rules (`high`, `medium`) or `none`. status: `linked` (one
-- HIGH, or a person's choice), `to_decide` (MEDIUM, several HIGH, or the client already linked to
-- another customer), `no_match`, `ignored` (a person said « ne pas rattacher »). source `auto` is
-- recomputed when the customer changes; `manual` never is.
create table public.qbo_customer_matches (
  connection_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  qbo_id text not null,
  client_id uuid,
  level text not null,
  reasons text[] not null default '{}',
  candidate_client_ids uuid[] not null default '{}',
  status text not null,
  source text not null default 'auto',
  match_input_hash text not null,
  decided_by uuid references public.profiles(user_id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qbo_customer_matches_pkey primary key (connection_id, qbo_id),
  constraint qbo_customer_matches_customer_fkey foreign key (connection_id, qbo_id)
    references public.qbo_customers(connection_id, qbo_id) on delete cascade,
  constraint qbo_customer_matches_connection_fkey foreign key (org_id, connection_id)
    references public.qbo_connections(org_id, id) on delete cascade,
  constraint qbo_customer_matches_client_fkey foreign key (org_id, client_id)
    references public.clients(org_id, id),
  constraint qbo_customer_matches_level_check check (level in ('high', 'medium', 'none')),
  constraint qbo_customer_matches_status_check check (status in ('linked', 'to_decide', 'no_match', 'ignored')),
  constraint qbo_customer_matches_linked_check check ((status = 'linked') = (client_id is not null)),
  constraint qbo_customer_matches_source_check check (source in ('auto', 'manual')),
  constraint qbo_customer_matches_reasons_check check (pg_catalog.cardinality(reasons) <= 20 and pg_catalog.cardinality(candidate_client_ids) <= 10)
);
create index qbo_customer_matches_org_status_idx on public.qbo_customer_matches (org_id, status);
create index qbo_customer_matches_org_connection_idx on public.qbo_customer_matches (org_id, connection_id);
create index qbo_customer_matches_client_idx on public.qbo_customer_matches (org_id, client_id);
create index qbo_customer_matches_decided_by_idx on public.qbo_customer_matches (decided_by);
-- One QuickBooks customer per client in a company: a second one goes to « à décider ».
create unique index qbo_customer_matches_client_key on public.qbo_customer_matches (connection_id, client_id)
  where status = 'linked';
revoke all on public.qbo_customer_matches from anon, authenticated;
grant select on public.qbo_customer_matches to authenticated;
alter table public.qbo_customer_matches enable row level security;
create policy qbo_customer_matches_select on public.qbo_customer_matches
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.settings')));
create trigger qbo_customer_matches_set_updated_at before update on public.qbo_customer_matches
  for each row execute function private.set_updated_at();
create trigger qbo_customer_matches_audit after insert or update or delete on public.qbo_customer_matches
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- qbo_links: the customers the push bills (R-30; audited)
-- -----------------------------------------------------------------------------
-- kind `payer`: the payer (a client paying for herself or for someone) → the parent customer;
-- kind `dossier`: the (payer, dossier) pair → its sub-customer « facturé avec le parent », never
-- re-parented (QuickBooks would move the history). source `matched` (a customer GOrendezvous made,
-- from qbo_customer_matches) or `created` (by the push). Organisation payers (IVAC, PAE) join
-- with FP.
create table public.qbo_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  payer_client_id uuid not null,
  client_id uuid,
  qbo_customer_id text not null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint qbo_links_connection_fkey foreign key (org_id, connection_id)
    references public.qbo_connections(org_id, id) on delete cascade,
  constraint qbo_links_payer_fkey foreign key (org_id, payer_client_id) references public.clients(org_id, id),
  constraint qbo_links_client_fkey foreign key (org_id, client_id) references public.clients(org_id, id),
  constraint qbo_links_kind_check check (kind in ('payer', 'dossier')),
  constraint qbo_links_shape_check check ((kind = 'dossier') = (client_id is not null)),
  constraint qbo_links_source_check check (source in ('matched', 'created')),
  constraint qbo_links_customer_check check (qbo_customer_id ~ '^[0-9]{1,32}$')
);
create unique index qbo_links_pair_key on public.qbo_links (connection_id, kind, payer_client_id, client_id) nulls not distinct;
create unique index qbo_links_customer_key on public.qbo_links (connection_id, qbo_customer_id);
create index qbo_links_org_payer_idx on public.qbo_links (org_id, payer_client_id);
create index qbo_links_org_connection_idx on public.qbo_links (org_id, connection_id);
create index qbo_links_org_client_idx on public.qbo_links (org_id, client_id);
revoke all on public.qbo_links from anon, authenticated;
grant select on public.qbo_links to authenticated;
alter table public.qbo_links enable row level security;
create policy qbo_links_select on public.qbo_links
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.settings')));
create trigger qbo_links_audit after insert or update or delete on public.qbo_links
  for each row execute function private.audit_trigger();

-- =============================================================================
-- Service RPCs (the functions; each takes the org from the verified caller or the job)
-- =============================================================================

-- Stores (or reconnects) the clinic's company: the connection `connected`, its tokens encrypted.
-- A clinic connected to a company reconnects to the same one only (another realm: P0001, until
-- « Déconnecter »). Returns the connection id.
create function public.store_qbo_connection(
  p_actor uuid, p_org_id uuid, p_realm_id text, p_environment text, p_company_name text,
  p_access_token text, p_refresh_token text, p_access_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
  v_row public.qbo_connections;
  v_id uuid;
  v_version integer;
begin
  perform private.qbo_assert_manager(p_actor, p_org_id);
  if p_realm_id is null or p_realm_id !~ '^[0-9]{1,32}$' or p_environment not in ('production', 'sandbox') then
    raise exception 'A realm and an environment are required' using errcode = '22023';
  end if;
  if coalesce(p_access_token, '') = '' or coalesce(p_refresh_token, '') = '' or p_access_token_expires_at is null then
    raise exception 'Tokens are required' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'billing') then
    raise exception 'Le module Facturation n''est pas activé.' using errcode = 'P0001';
  end if;
  perform 1 from public.organizations o where o.id = p_org_id for no key update;
  perform pg_catalog.set_config('app.audit_source', 'rpc:store_qbo_connection', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);

  select * into v_row from public.qbo_connections c where c.org_id = p_org_id for no key update;
  if v_row.id is null then
    insert into public.qbo_connections (org_id, realm_id, environment, company_name, status, connected_by, refresh_token_expires_at)
    values (p_org_id, p_realm_id, p_environment, nullif(pg_catalog.btrim(p_company_name), ''), 'connected', p_actor,
            p_refresh_token_expires_at)
    returning id into v_id;
  else
    if v_row.status <> 'disconnected' and (v_row.realm_id <> p_realm_id or v_row.environment <> p_environment) then
      raise exception 'La clinique est déjà reliée à une autre entreprise QuickBooks. Déconnectez-la d''abord.'
        using errcode = 'P0001';
    end if;
    v_id := v_row.id;
    -- A new company after « Déconnecter »: the old one's mirrors, matches and links go.
    if v_row.realm_id <> p_realm_id or v_row.environment <> p_environment then
      delete from public.qbo_links l where l.connection_id = v_id;
      delete from public.qbo_customers x where x.connection_id = v_id;
      delete from public.qbo_accounts a where a.connection_id = v_id;
      update public.qbo_account_map m set qbo_account_id = null, suggested = false where m.org_id = p_org_id;
    end if;
    update public.qbo_connections c
       set realm_id = p_realm_id, environment = p_environment,
           company_name = coalesce(nullif(pg_catalog.btrim(p_company_name), ''), c.company_name),
           status = 'connected', status_reason = null,
           connected_by = p_actor, connected_at = pg_catalog.now(),
           disconnected_at = null, disconnected_by = null,
           refresh_token_expires_at = p_refresh_token_expires_at,
           last_error_code = null, last_error_at = null
     where c.id = v_id;
  end if;

  v_version := private.pii_current_key_version();
  insert into public.qbo_connection_tokens as t (connection_id, org_id, access_token, refresh_token, access_token_expires_at, key_version)
  values (v_id, p_org_id, private.encrypt_pii(p_access_token, v_version), private.encrypt_pii(p_refresh_token, v_version),
          p_access_token_expires_at, v_version)
  on conflict (connection_id) do update
    set access_token = excluded.access_token, refresh_token = excluded.refresh_token,
        access_token_expires_at = excluded.access_token_expires_at, key_version = excluded.key_version;

  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return v_id;
end;
$$;
revoke all on function public.store_qbo_connection(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.store_qbo_connection(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz)
  to service_role;

-- « Déconnecter »: `disconnected`, its tokens deleted (the function revoked them at Intuit first);
-- the mirrors, matches and links stay (a reconnection to the same company keeps them). Returns
-- false when there is nothing to disconnect.
create function public.disconnect_qbo_connection(p_actor uuid, p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
  v_id uuid;
begin
  perform private.qbo_assert_manager(p_actor, p_org_id);
  perform pg_catalog.set_config('app.audit_source', 'rpc:disconnect_qbo_connection', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  update public.qbo_connections c
     set status = 'disconnected', status_reason = null, disconnected_at = pg_catalog.now(), disconnected_by = p_actor
   where c.org_id = p_org_id and c.status <> 'disconnected'
  returning c.id into v_id;
  if v_id is not null then
    delete from public.qbo_connection_tokens t where t.connection_id = v_id and t.org_id = p_org_id;
  end if;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return v_id is not null;
end;
$$;
revoke all on function public.disconnect_qbo_connection(uuid, uuid) from public, anon, authenticated;
grant execute on function public.disconnect_qbo_connection(uuid, uuid) to service_role;

-- The clinic's connection with its tokens decrypted (the one reader of the tokens). No row when
-- disconnected or without tokens.
create function public.get_qbo_credentials(p_org_id uuid)
returns table (
  connection_id uuid, realm_id text, environment text, status text,
  access_token text, refresh_token text, access_token_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.realm_id, c.environment, c.status,
         private.decrypt_pii(t.access_token, t.key_version),
         private.decrypt_pii(t.refresh_token, t.key_version),
         t.access_token_expires_at
    from public.qbo_connections c
    join public.qbo_connection_tokens t on t.connection_id = c.id
   where c.org_id = p_org_id and c.status <> 'disconnected'
$$;
revoke all on function public.get_qbo_credentials(uuid) from public, anon, authenticated;
grant execute on function public.get_qbo_credentials(uuid) to service_role;

-- A refresh's answer: Intuit rotates the refresh token, so both are stored, re-encrypted under the
-- current key version. p_previous_refresh: the refresh token this refresh used. When another pass
-- already rotated it (the stored one differs), nothing is written and false is returned: the
-- caller reads the credentials again (PS Hub's race, roadmap §2.6).
create function public.set_qbo_tokens(
  p_org_id uuid, p_connection_id uuid, p_previous_refresh text,
  p_access_token text, p_refresh_token text, p_access_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer := private.pii_current_key_version();
  v_current text;
begin
  if coalesce(p_access_token, '') = '' or coalesce(p_refresh_token, '') = '' or p_access_token_expires_at is null then
    raise exception 'Tokens are required' using errcode = '22023';
  end if;
  select private.decrypt_pii(t.refresh_token, t.key_version) into v_current
    from public.qbo_connection_tokens t
   where t.connection_id = p_connection_id and t.org_id = p_org_id
   for update;
  if v_current is null or v_current is distinct from p_previous_refresh then
    return false;
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_qbo_tokens', true);
  update public.qbo_connection_tokens t
     set access_token = private.encrypt_pii(p_access_token, v_version),
         refresh_token = private.encrypt_pii(p_refresh_token, v_version),
         access_token_expires_at = p_access_token_expires_at,
         key_version = v_version
   where t.connection_id = p_connection_id and t.org_id = p_org_id;
  update public.qbo_connections c
     set refresh_token_expires_at = coalesce(p_refresh_token_expires_at, c.refresh_token_expires_at),
         status = case when c.status = 'needs_reconnect' then 'connected' else c.status end,
         status_reason = case when c.status = 'needs_reconnect' then null else c.status_reason end
   where c.id = p_connection_id and c.org_id = p_org_id
     and (c.refresh_token_expires_at is distinct from p_refresh_token_expires_at or c.status = 'needs_reconnect');
  return true;
end;
$$;
revoke all on function public.set_qbo_tokens(uuid, uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.set_qbo_tokens(uuid, uuid, text, text, text, timestamptz, timestamptz) to service_role;

-- `needs_reconnect` with its reason (Intuit refused the refresh).
create function public.set_qbo_connection_status(p_org_id uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('connected', 'needs_reconnect') or (p_reason is not null and p_reason !~ '^[a-z0-9_]{1,64}$') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_qbo_connection_status', true);
  update public.qbo_connections c
     set status = p_status, status_reason = case when p_status = 'connected' then null else p_reason end
   where c.org_id = p_org_id and c.status <> 'disconnected'
     and (c.status, c.status_reason) is distinct from (p_status, case when p_status = 'connected' then null else p_reason end);
end;
$$;
revoke all on function public.set_qbo_connection_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_qbo_connection_status(uuid, text, text) to service_role;

-- The end of a sync pass: its outcome on the connection, the company's name.
create function public.finish_qbo_sync(
  p_org_id uuid, p_status text, p_error_code text, p_company_name text,
  p_accounts_synced boolean, p_customers_synced boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('ok', 'partial', 'failed') or (p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,64}$') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:finish_qbo_sync', true);
  update public.qbo_connections c
     set last_sync_at = pg_catalog.now(), last_sync_status = p_status,
         last_error_code = case when p_status = 'ok' then null else p_error_code end,
         last_error_at = case when p_status = 'ok' then null else pg_catalog.now() end,
         company_name = coalesce(nullif(pg_catalog.btrim(pg_catalog.left(p_company_name, 200)), ''), c.company_name),
         accounts_synced_at = case when p_accounts_synced then pg_catalog.now() else c.accounts_synced_at end,
         customers_synced_at = case when p_customers_synced then pg_catalog.now() else c.customers_synced_at end
   where c.org_id = p_org_id and c.status <> 'disconnected';
end;
$$;
revoke all on function public.finish_qbo_sync(uuid, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.finish_qbo_sync(uuid, text, text, text, boolean, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- The chart of accounts and Christine's defaults
-- -----------------------------------------------------------------------------
-- Lower case, unaccented: how names are compared.
create function private.qbo_fold(p_value text)
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_value, '')))
$$;
revoke all on function private.qbo_fold(text) from public, anon, authenticated, service_role;

-- Which Intuit account types a key accepts: revenue → income; deposit → bank or current asset
-- (1075 and the undeposited funds are current assets); expense → expense or cost of sales.
create function private.qbo_account_fits(p_key text, p_account_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
           when p_key like 'revenue.%' then p_account_type in ('Income', 'Other Income')
           when p_key like 'deposit.%' then p_account_type in ('Bank', 'Other Current Asset')
           when p_key = 'expense' then p_account_type in ('Expense', 'Other Expense', 'Cost of Goods Sold')
           else false
         end
$$;
revoke all on function private.qbo_account_fits(text, text) from public, anon, authenticated, service_role;

-- The account a key should use by default (Christine, answer 17; roadmap §2.6), among the
-- company's active accounts of the right kind: the number first (1075, 1070), then the name. An
-- expense by specialty: an account whose name holds one of the title's names (« Psychologue »,
-- « Travailleuse sociale »…); none → the admin chooses.
create function private.qbo_default_account(p_connection_id uuid, p_key text, p_title_names text[])
returns text
language sql
stable
set search_path = ''
as $$
  select a.qbo_id
    from public.qbo_accounts a
   where a.connection_id = p_connection_id and a.active
     and private.qbo_account_fits(p_key, a.account_type)
     and case p_key
           when 'revenue.services' then private.qbo_fold(a.name) like 'services%'
           when 'revenue.file_opening' then private.qbo_fold(a.name) like 'ventes%'
           when 'deposit.interac' then a.acct_num = '1075' or private.qbo_fold(a.name) like '%virement bancaire a recevoir%'
           when 'deposit.stripe' then a.acct_num = '1070' or private.qbo_fold(a.name) like '%banque stripe%'
           when 'deposit.qbo_payments_card' then a.account_sub_type = 'UndepositedFunds'
                                                or private.qbo_fold(a.name) in ('fonds non deposes', 'undeposited funds')
           when 'deposit.bank_transfer' then private.qbo_fold(a.name) like '%compte courant%'
           when 'deposit.cheque' then private.qbo_fold(a.name) like '%compte courant%'
           when 'expense' then exists (select 1 from unnest(p_title_names) n
                                        where pg_catalog.length(pg_catalog.btrim(n)) >= 3
                                          and private.qbo_fold(a.name) like '%' || private.qbo_fold(pg_catalog.btrim(n)) || '%')
           else false
         end
   order by (a.acct_num is not null and a.acct_num in ('1075', '1070')) desc, pg_catalog.length(a.name), a.qbo_id
   limit 1
$$;


revoke all on function private.qbo_default_account(uuid, text, text[]) from public, anon, authenticated, service_role;

-- The map's rows exist for every key, every payment mode that lands money (F1's `payment_modes`,
-- `is_deposit`, active) and every active profession title; an empty or suggested row takes the
-- default (a person's choice is never overwritten).
create function private.qbo_apply_account_defaults(p_org_id uuid, p_connection_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  insert into public.qbo_account_map (org_id, map_key)
  select p_org_id, k.key
    from (values ('revenue.services'), ('revenue.file_opening')) k(key)
  union all
  select p_org_id, 'deposit.' || pm.code
    from public.payment_modes pm
   where pm.org_id = p_org_id and pm.is_deposit and pm.is_active
  on conflict do nothing;
  insert into public.qbo_account_map (org_id, map_key, profession_title_id)
  select p_org_id, 'expense', t.id from public.profession_titles_catalog t where t.org_id = p_org_id
  on conflict do nothing;

  update public.qbo_account_map m
     set qbo_account_id = d.account_id, suggested = d.account_id is not null
    from (select m2.id,
                 private.qbo_default_account(p_connection_id, m2.map_key,
                   (select array[t.name, t.name_feminine, t.name_masculine]
                      from public.profession_titles_catalog t where t.id = m2.profession_title_id)) as account_id
            from public.qbo_account_map m2
           where m2.org_id = p_org_id and (m2.qbo_account_id is null or m2.suggested)) d
   where m.id = d.id and m.qbo_account_id is distinct from d.account_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.qbo_apply_account_defaults(uuid, uuid) from public, anon, authenticated, service_role;

-- The company's accounts as read (the whole chart: rows not in it are removed), then the defaults.
-- p_accounts: [{ id, name, fully_qualified_name, acct_num, account_type, account_sub_type,
-- classification, active }], at most 2 000.
create function public.replace_qbo_accounts(p_org_id uuid, p_accounts jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
begin
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'array' or jsonb_array_length(p_accounts) > 2000 then
    raise exception 'Accounts must be an array of at most 2000' using errcode = '22023';
  end if;
  select c.id into v_connection from public.qbo_connections c where c.org_id = p_org_id and c.status <> 'disconnected';
  if v_connection is null then
    raise exception 'No connection' using errcode = '22023';
  end if;
  insert into public.qbo_accounts as a (connection_id, org_id, qbo_id, name, fully_qualified_name, acct_num, account_type,
                                        account_sub_type, classification, active, synced_at)
  select v_connection, p_org_id, x.id, x.name, x.fully_qualified_name, nullif(x.acct_num, ''), x.account_type,
         x.account_sub_type, x.classification, coalesce(x.active, true), pg_catalog.now()
    from jsonb_to_recordset(p_accounts) as x(id text, name text, fully_qualified_name text, acct_num text,
                                              account_type text, account_sub_type text, classification text, active boolean)
  on conflict (connection_id, qbo_id) do update
    set name = excluded.name, fully_qualified_name = excluded.fully_qualified_name, acct_num = excluded.acct_num,
        account_type = excluded.account_type, account_sub_type = excluded.account_sub_type,
        classification = excluded.classification, active = excluded.active, synced_at = excluded.synced_at;
  delete from public.qbo_accounts a
   where a.connection_id = v_connection
     and a.qbo_id not in (select x->>'id' from jsonb_array_elements(p_accounts) x);
  perform pg_catalog.set_config('app.audit_source', 'rpc:replace_qbo_accounts', true);
  return private.qbo_apply_account_defaults(p_org_id, v_connection);
end;
$$;
revoke all on function public.replace_qbo_accounts(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_qbo_accounts(uuid, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- The customers and their matching
-- -----------------------------------------------------------------------------
-- One page of the company's customers (≤ 500). p_customers: [{ id, display_name, given_name,
-- family_name, company_name, email, phones[], is_job, parent_id, active, hash }]. Returns how many
-- changed (new or another hash): those are matched again.
create function public.upsert_qbo_customers(p_org_id uuid, p_sync_started_at timestamptz, p_customers jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
  v_count int;
begin
  if p_customers is null or jsonb_typeof(p_customers) <> 'array' or jsonb_array_length(p_customers) > 500 then
    raise exception 'Customers must be an array of at most 500' using errcode = '22023';
  end if;
  select c.id into v_connection from public.qbo_connections c where c.org_id = p_org_id and c.status <> 'disconnected';
  if v_connection is null then
    raise exception 'No connection' using errcode = '22023';
  end if;
  with incoming as (
    select x.id, pg_catalog.left(coalesce(nullif(pg_catalog.btrim(x.display_name), ''), '(sans nom)'), 500) as display_name,
           nullif(pg_catalog.btrim(pg_catalog.left(x.given_name, 100)), '') as given_name,
           nullif(pg_catalog.btrim(pg_catalog.left(x.family_name, 100)), '') as family_name,
           nullif(pg_catalog.btrim(pg_catalog.left(x.company_name, 100)), '') as company_name,
           nullif(pg_catalog.lower(pg_catalog.btrim(pg_catalog.left(x.email, 254))), '') as email,
           coalesce((select array_agg(p) from (select distinct pg_catalog.left(pg_catalog.btrim(p), 40) as p
                                                 from unnest(x.phones) p where pg_catalog.btrim(p) <> '' limit 4) q), '{}') as phones,
           coalesce(x.is_job, false) as is_job, x.parent_id, coalesce(x.active, true) as active, x.hash
      from jsonb_to_recordset(p_customers) as x(id text, display_name text, given_name text, family_name text,
                                                 company_name text, email text, phones text[], is_job boolean,
                                                 parent_id text, active boolean, hash text)
  ), written as (
    insert into public.qbo_customers as q (connection_id, org_id, qbo_id, display_name, given_name, family_name, company_name,
                                           email, phones, is_job, parent_qbo_id, active, match_input_hash, synced_at)
    select v_connection, p_org_id, i.id, i.display_name, i.given_name, i.family_name, i.company_name, i.email, i.phones,
           i.is_job, i.parent_id, i.active, i.hash, greatest(p_sync_started_at, pg_catalog.now())
      from incoming i
    on conflict (connection_id, qbo_id) do update
      set display_name = excluded.display_name, given_name = excluded.given_name, family_name = excluded.family_name,
          company_name = excluded.company_name, email = excluded.email, phones = excluded.phones,
          is_job = excluded.is_job, parent_qbo_id = excluded.parent_qbo_id, active = excluded.active,
          match_input_hash = excluded.match_input_hash, synced_at = excluded.synced_at
    returning q.qbo_id, q.match_input_hash
  )
  select count(*) into v_count
    from written w
   where not exists (select 1 from public.qbo_customer_matches m
                      where m.connection_id = v_connection and m.qbo_id = w.qbo_id and m.match_input_hash = w.match_input_hash);
  return v_count;
end;
$$;
revoke all on function public.upsert_qbo_customers(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_qbo_customers(uuid, timestamptz, jsonb) to service_role;

-- After a full read: the customers QuickBooks no longer has (merged, deleted) are removed, with
-- their matches; a customer the push bills (qbo_links) is kept and its link stays.
create function public.prune_qbo_customers(p_org_id uuid, p_sync_started_at timestamptz)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.qbo_customers q
   using public.qbo_connections c
   where c.org_id = p_org_id and c.status <> 'disconnected' and q.connection_id = c.id
     and q.synced_at < p_sync_started_at
     and not exists (select 1 from public.qbo_links l where l.connection_id = q.connection_id and l.qbo_customer_id = q.qbo_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.prune_qbo_customers(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.prune_qbo_customers(uuid, timestamptz) to service_role;

-- One customer's match, with Clients' own rules (`private.clients_find_duplicates`: the import's
-- I-5): a company's name with no person's name never matches; a sub-customer is never matched
-- (it is the push's, under its parent). Returns the status written.
create function private.qbo_match_one(p_org_id uuid, p_connection_id uuid, p_qbo_id text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_c public.qbo_customers;
  v_first text;
  v_last text;
  v_high uuid[];
  v_medium uuid[];
  v_reasons text[];
  v_level text;
  v_status text;
  v_client uuid;
  v_candidates uuid[];
  v_existing public.qbo_customer_matches;
begin
  select * into v_c from public.qbo_customers q where q.connection_id = p_connection_id and q.qbo_id = p_qbo_id;
  if v_c.qbo_id is null then
    return null;
  end if;
  select * into v_existing from public.qbo_customer_matches m where m.connection_id = p_connection_id and m.qbo_id = p_qbo_id;
  -- A person's decision stands.
  if v_existing.source = 'manual' then
    update public.qbo_customer_matches m set match_input_hash = v_c.match_input_hash
     where m.connection_id = p_connection_id and m.qbo_id = p_qbo_id and m.match_input_hash <> v_c.match_input_hash;
    return v_existing.status;
  end if;

  v_first := v_c.given_name;
  v_last := v_c.family_name;
  if v_first is null and v_last is null and v_c.display_name is not null then
    -- « Prénom Nom » (GOrendezvous's display name): the last word is the family name.
    v_last := pg_catalog.regexp_replace(pg_catalog.btrim(v_c.display_name), '^.*\s', '');
    v_first := nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(v_c.display_name),
                 pg_catalog.length(pg_catalog.btrim(v_c.display_name)) - pg_catalog.length(v_last))), '');
  end if;

  if v_c.is_job or (v_last is null and v_c.email is null and pg_catalog.cardinality(v_c.phones) = 0) then
    v_level := 'none';
  else
    with found as (
      select d.client_id, d.level, d.reasons
        from private.clients_find_duplicates(p_org_id, v_first, v_last, v_c.email, v_c.phones, null, null) d
    )
    select (select array_agg(f.client_id order by f.client_id) from found f where f.level = 'high'),
           (select array_agg(f.client_id order by f.client_id) from found f where f.level = 'medium'),
           (select array_agg(distinct r order by r) from found f, unnest(f.reasons) r)
      into v_high, v_medium, v_reasons;
    v_level := case when pg_catalog.cardinality(v_high) > 0 then 'high'
                    when pg_catalog.cardinality(v_medium) > 0 then 'medium' else 'none' end;
  end if;

  v_candidates := coalesce(v_high, '{}') || coalesce(v_medium, '{}');
  v_candidates := v_candidates[1:10];
  if v_level = 'high' and pg_catalog.cardinality(v_high) = 1
     and not exists (select 1 from public.qbo_customer_matches m
                      where m.connection_id = p_connection_id and m.status = 'linked' and m.client_id = v_high[1]
                        and m.qbo_id <> p_qbo_id) then
    v_status := 'linked';
    v_client := v_high[1];
  elsif v_level = 'none' then
    v_status := 'no_match';
  else
    v_status := 'to_decide';
  end if;

  insert into public.qbo_customer_matches as m (connection_id, org_id, qbo_id, client_id, level, reasons, candidate_client_ids,
                                                status, source, match_input_hash)
  values (p_connection_id, p_org_id, p_qbo_id, v_client, v_level, coalesce(v_reasons[1:20], '{}'), v_candidates,
          v_status, 'auto', v_c.match_input_hash)
  on conflict (connection_id, qbo_id) do update
    set client_id = excluded.client_id, level = excluded.level, reasons = excluded.reasons,
        candidate_client_ids = excluded.candidate_client_ids, status = excluded.status,
        match_input_hash = excluded.match_input_hash
    where (m.client_id, m.level, m.reasons, m.candidate_client_ids, m.status, m.match_input_hash)
          is distinct from (excluded.client_id, excluded.level, excluded.reasons, excluded.candidate_client_ids,
                            excluded.status, excluded.match_input_hash);
  perform private.qbo_sync_payer_link(p_org_id, p_connection_id, p_qbo_id);
  return v_status;
end;
$$;
revoke all on function private.qbo_match_one(uuid, uuid, text) from public, anon, authenticated, service_role;

-- A linked match is the payer's parent customer (source `matched`); a match that is no longer
-- linked loses its payer link, unless the push already billed under it (a dossier link exists).
create function private.qbo_sync_payer_link(p_org_id uuid, p_connection_id uuid, p_qbo_id text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_m public.qbo_customer_matches;
begin
  select * into v_m from public.qbo_customer_matches m where m.connection_id = p_connection_id and m.qbo_id = p_qbo_id;
  if v_m.status = 'linked' then
    insert into public.qbo_links (connection_id, org_id, kind, payer_client_id, qbo_customer_id, source)
    values (p_connection_id, p_org_id, 'payer', v_m.client_id, p_qbo_id, 'matched')
    on conflict do nothing;
  end if;
  delete from public.qbo_links l
   where l.connection_id = p_connection_id and l.kind = 'payer' and l.qbo_customer_id = p_qbo_id and l.source = 'matched'
     and (v_m.status is distinct from 'linked' or l.payer_client_id is distinct from v_m.client_id)
     and not exists (select 1 from public.qbo_links d
                      where d.connection_id = p_connection_id and d.kind = 'dossier' and d.payer_client_id = l.payer_client_id);
end;
$$;
revoke all on function private.qbo_sync_payer_link(uuid, uuid, text) from public, anon, authenticated, service_role;

-- Matches the customers whose input changed, at most p_limit a call (the function calls it until
-- it answers 0). Returns how many were matched.
create function public.match_qbo_customers(p_org_id uuid, p_limit int default 300)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
  v_count int := 0;
  r record;
begin
  select c.id into v_connection from public.qbo_connections c where c.org_id = p_org_id and c.status <> 'disconnected';
  if v_connection is null then
    return 0;
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:match_qbo_customers', true);
  for r in
    select q.qbo_id from public.qbo_customers q
     where q.connection_id = v_connection
       and not exists (select 1 from public.qbo_customer_matches m
                        where m.connection_id = q.connection_id and m.qbo_id = q.qbo_id and m.match_input_hash = q.match_input_hash)
     order by q.qbo_id
     limit least(greatest(coalesce(p_limit, 300), 1), 1000)
  loop
    perform private.qbo_match_one(p_org_id, v_connection, r.qbo_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.match_qbo_customers(uuid, int) from public, anon, authenticated;
grant execute on function public.match_qbo_customers(uuid, int) to service_role;

-- =============================================================================
-- User RPCs (billing.settings)
-- =============================================================================

-- The settings screen: the connection (no token), the accounts the map may choose and the map.
create function public.get_qbo_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.qbo_require_settings();
  v_connection uuid;
begin
  select c.id into v_connection from public.qbo_connections c where c.org_id = v_org;
  return jsonb_build_object(
    'connection', (select jsonb_build_object(
                     'id', c.id, 'realm_id', c.realm_id, 'environment', c.environment, 'company_name', c.company_name,
                     'status', c.status, 'status_reason', c.status_reason, 'connected_at', c.connected_at,
                     'connected_by_name', (select p.display_name from public.profiles p where p.user_id = c.connected_by),
                     'disconnected_at', c.disconnected_at, 'refresh_token_expires_at', c.refresh_token_expires_at,
                     'last_sync_at', c.last_sync_at, 'last_sync_status', c.last_sync_status,
                     'last_error_code', c.last_error_code, 'accounts_synced_at', c.accounts_synced_at,
                     'customers_synced_at', c.customers_synced_at)
                     from public.qbo_connections c where c.id = v_connection),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
                     'id', a.qbo_id, 'name', a.name, 'fully_qualified_name', a.fully_qualified_name,
                     'acct_num', a.acct_num, 'account_type', a.account_type)
                     order by a.acct_num nulls last, a.fully_qualified_name, a.name)
                     from public.qbo_accounts a where a.connection_id = v_connection and a.active), '[]'::jsonb),
    -- A deposit row carries its payment mode's name (F1's `payment_modes`); a mode no longer
    -- active or no longer a deposit is left out.
    'map', coalesce((select jsonb_agg(jsonb_build_object(
                     'key', m.map_key, 'profession_title_id', m.profession_title_id, 'profession_title_name', t.name,
                     'mode_name', pm.name, 'account_id', m.qbo_account_id, 'suggested', m.suggested)
                     order by m.map_key not like 'revenue.%', pm.sort_order nulls last, m.map_key, t.sort_order, t.name)
                     from public.qbo_account_map m
                     left join public.profession_titles_catalog t on t.id = m.profession_title_id
                     left join public.payment_modes pm on pm.org_id = m.org_id and 'deposit.' || pm.code = m.map_key
                    where m.org_id = v_org and (m.profession_title_id is null or t.id is not null)
                      and (m.map_key not like 'deposit.%' or (pm.id is not null and pm.is_deposit and pm.is_active))), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_qbo_settings() from public, anon, authenticated;
grant execute on function public.get_qbo_settings() to authenticated;

-- One map row: an account of the right kind (null: none chosen). A person's choice is final.
create function public.set_qbo_account_map(p_key text, p_profession_title_id uuid, p_account_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.qbo_require_settings();
  v_connection uuid;
  v_type text;
begin
  if p_key is null or (p_key = 'expense') <> (p_profession_title_id is not null) then
    raise exception 'A key (and a title for an expense)' using errcode = '22023';
  end if;
  if p_key not in ('revenue.services', 'revenue.file_opening', 'expense')
     and not exists (select 1 from public.payment_modes pm
                      where pm.org_id = v_org and pm.is_deposit and 'deposit.' || pm.code = p_key) then
    raise exception 'Unknown key' using errcode = '22023';
  end if;
  select c.id into v_connection from public.qbo_connections c where c.org_id = v_org and c.status <> 'disconnected';
  if v_connection is null then
    raise exception 'Connectez d''abord QuickBooks.' using errcode = 'P0001';
  end if;
  if p_account_id is not null then
    select a.account_type into v_type from public.qbo_accounts a
     where a.connection_id = v_connection and a.qbo_id = p_account_id and a.active;
    if v_type is null then
      raise exception 'Ce compte n''existe plus dans QuickBooks. Synchronisez, puis choisissez-en un autre.' using errcode = 'P0001';
    end if;
    if not private.qbo_account_fits(p_key, v_type) then
      raise exception 'Ce type de compte ne convient pas à cette ligne.' using errcode = 'P0001';
    end if;
  end if;
  if p_profession_title_id is not null
     and not exists (select 1 from public.profession_titles_catalog t where t.id = p_profession_title_id and t.org_id = v_org) then
    raise exception 'Unknown title' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_qbo_account_map', true);
  insert into public.qbo_account_map as m (org_id, map_key, profession_title_id, qbo_account_id, suggested, updated_by)
  values (v_org, p_key, p_profession_title_id, p_account_id, false, auth.uid())
  on conflict (org_id, map_key, profession_title_id) do update
    set qbo_account_id = excluded.qbo_account_id, suggested = false, updated_by = excluded.updated_by
    where (m.qbo_account_id, m.suggested) is distinct from (excluded.qbo_account_id, false);
end;
$$;
revoke all on function public.set_qbo_account_map(text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_qbo_account_map(text, uuid, text) to authenticated;

-- « Correspondance des clients QuickBooks »: the counts per status.
create function public.qbo_customer_match_counts()
returns table (status text, customers bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.qbo_require_settings();
begin
  return query
    select s.status, count(m.qbo_id)
      from (values ('linked'), ('to_decide'), ('no_match'), ('ignored')) s(status)
      left join public.qbo_customer_matches m
        on m.status = s.status and m.org_id = v_org
       and m.connection_id = (select c.id from public.qbo_connections c where c.org_id = v_org)
     group by s.status;
end;
$$;
revoke all on function public.qbo_customer_match_counts() from public, anon, authenticated;
grant execute on function public.qbo_customer_match_counts() to authenticated;

-- The report, one status at a time (p_search: the customer's name or email), 50 a page, with the
-- linked client or the candidates (number and name, from Clients' published directory).
create function public.list_qbo_customer_matches(p_status text, p_search text default null, p_offset int default 0, p_limit int default 50)
returns table (
  qbo_id text, display_name text, email text, phones text[], active boolean,
  level text, reasons text[], status text, source text, decided_at timestamptz,
  client jsonb, candidates jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.qbo_require_settings();
  v_search text := nullif(private.qbo_fold(pg_catalog.btrim(pg_catalog.left(p_search, 100))), '');
begin
  if p_status not in ('linked', 'to_decide', 'no_match', 'ignored') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  return query
    select q.qbo_id, q.display_name, q.email, q.phones, q.active,
           m.level, m.reasons, m.status, m.source, m.decided_at,
           (select jsonb_build_object('id', d.id, 'client_number', d.client_number, 'display_name', d.display_name,
                                      'is_archived', d.is_archived)
              from public.clients_directory d where d.id = m.client_id),
           coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'client_number', d.client_number,
                                                         'display_name', d.display_name, 'email', d.email,
                                                         'is_archived', d.is_archived)
                                      order by pg_catalog.array_position(m.candidate_client_ids, d.id))
                       from public.clients_directory d where d.id = any (m.candidate_client_ids)
                         and d.merged_into_id is null and not d.is_anonymized), '[]'::jsonb)
      from public.qbo_customer_matches m
      join public.qbo_customers q on q.connection_id = m.connection_id and q.qbo_id = m.qbo_id
     where m.org_id = v_org and m.status = p_status
       and m.connection_id = (select c.id from public.qbo_connections c where c.org_id = v_org)
       and (v_search is null or private.qbo_fold(q.display_name) like '%' || v_search || '%'
            or coalesce(q.email, '') like '%' || v_search || '%')
     order by q.display_name, q.qbo_id
     offset greatest(coalesce(p_offset, 0), 0)
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;
revoke all on function public.list_qbo_customer_matches(text, text, int, int) from public, anon, authenticated;
grant execute on function public.list_qbo_customer_matches(text, text, int, int) to authenticated;

-- A person's decision: `link` to a client of the clinic (a candidate or any active file), `ignore`
-- (« ne pas rattacher »), or `reset` (back to the automatic match). Final until reset.
create function public.decide_qbo_customer_match(p_qbo_id text, p_decision text, p_client_id uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.qbo_require_settings();
  v_connection uuid;
  v_status text;
begin
  if p_decision not in ('link', 'ignore', 'reset') or (p_decision = 'link') <> (p_client_id is not null) then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  select c.id into v_connection from public.qbo_connections c where c.org_id = v_org and c.status <> 'disconnected';
  if v_connection is null then
    raise exception 'Connectez d''abord QuickBooks.' using errcode = 'P0001';
  end if;
  perform 1 from public.qbo_customer_matches m where m.connection_id = v_connection and m.qbo_id = p_qbo_id for update;
  if not found then
    raise exception 'Ce client QuickBooks n''est plus dans la liste. Synchronisez.' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:decide_qbo_customer_match', true);
  if p_decision = 'link' then
    if not exists (select 1 from public.clients_directory d
                    where d.id = p_client_id and d.org_id = v_org and d.merged_into_id is null and not d.is_anonymized) then
      raise exception 'Ce dossier client n''existe pas ou a été fusionné.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.qbo_customer_matches m
                where m.connection_id = v_connection and m.status = 'linked' and m.client_id = p_client_id and m.qbo_id <> p_qbo_id) then
      raise exception 'Ce dossier est déjà rattaché à un autre client QuickBooks.' using errcode = 'P0001';
    end if;
    update public.qbo_customer_matches m
       set status = 'linked', client_id = p_client_id, source = 'manual', decided_by = auth.uid(), decided_at = pg_catalog.now()
     where m.connection_id = v_connection and m.qbo_id = p_qbo_id;
  elsif p_decision = 'ignore' then
    update public.qbo_customer_matches m
       set status = 'ignored', client_id = null, source = 'manual', decided_by = auth.uid(), decided_at = pg_catalog.now()
     where m.connection_id = v_connection and m.qbo_id = p_qbo_id;
  else
    update public.qbo_customer_matches m
       set source = 'auto', decided_by = null, decided_at = null, match_input_hash = ''
     where m.connection_id = v_connection and m.qbo_id = p_qbo_id;
    v_status := private.qbo_match_one(v_org, v_connection, p_qbo_id);
    return v_status;
  end if;
  perform private.qbo_sync_payer_link(v_org, v_connection, p_qbo_id);
  select m.status into v_status from public.qbo_customer_matches m where m.connection_id = v_connection and m.qbo_id = p_qbo_id;
  return v_status;
end;
$$;
revoke all on function public.decide_qbo_customer_match(text, text, uuid) from public, anon, authenticated;
grant execute on function public.decide_qbo_customer_match(text, text, uuid) to authenticated;

-- =============================================================================
-- Clients' merge and anonymisation: F1's two handlers (`20261013105817_billing_module`) replaced,
-- F1's body kept as is, the QuickBooks part added after it (F1 registered the handler rows)
-- =============================================================================
-- A merge moves the matches and the links to the kept file, unless the kept file already has its
-- own (then the merged file's stay where they are: QuickBooks keeps its history under its own
-- customer; the push bills the kept file's).
create or replace function private.billing_reassign_client(p_old uuid, p_new uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_total int := 0;
  v_count int;
begin
  -- F1: the invoices and the default payers.
  update public.invoices i set client_id = p_new,
         payer_client_id = case when i.payer_client_id = p_old then p_new else i.payer_client_id end,
         payer_kind = case when (case when i.payer_client_id = p_old then p_new else i.payer_client_id end) = p_new then 'client' else i.payer_kind end
   where i.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.invoices i set payer_client_id = p_new,
         payer_kind = case when i.client_id = p_new then 'client' else 'relation' end
   where i.payer_client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  delete from public.billing_payer_defaults d
   where d.client_id = p_old
     and exists (select 1 from public.billing_payer_defaults k where k.client_id = p_new and k.effective_from = d.effective_from);
  update public.billing_payer_defaults d set client_id = p_new where d.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.billing_payer_defaults d set payer_client_id = p_new where d.payer_client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  -- FQ: the QuickBooks matches and links.
  update public.qbo_customer_matches m
     set candidate_client_ids = pg_catalog.array_replace(m.candidate_client_ids, p_old, p_new)
   where p_old = any (m.candidate_client_ids);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.qbo_customer_matches m set client_id = p_new
   where m.client_id = p_old
     and not exists (select 1 from public.qbo_customer_matches k
                      where k.connection_id = m.connection_id and k.client_id = p_new and k.status = 'linked');
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.qbo_links l set payer_client_id = p_new
   where l.payer_client_id = p_old
     and not exists (select 1 from public.qbo_links k
                      where k.connection_id = l.connection_id and k.kind = l.kind and k.payer_client_id = p_new
                        and k.client_id is not distinct from (case when l.client_id = p_old then p_new else l.client_id end));
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.qbo_links l set client_id = p_new
   where l.client_id = p_old
     and not exists (select 1 from public.qbo_links k
                      where k.connection_id = l.connection_id and k.kind = 'dossier'
                        and k.payer_client_id = l.payer_client_id and k.client_id = p_new);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  return v_total;
end;
$$;

-- An anonymisation: F1 keeps the invoices and blanks their free texts, drops the default payers;
-- FQ blanks this app's copy of the customers matched to the person (QuickBooks keeps its
-- accounting record; the next read brings its names back only if the clinic left them there).
create or replace function private.billing_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_total int := 0;
  v_count int;
begin
  -- F1.
  update public.invoices i set notes_client = null, notes_internal = null
   where (i.client_id = p_id or i.payer_client_id = p_id) and (i.notes_client is not null or i.notes_internal is not null);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  delete from public.billing_payer_defaults d where d.client_id = p_id or d.payer_client_id = p_id;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  -- FQ.
  update public.qbo_customers q
     set display_name = '(anonymisé)', given_name = null, family_name = null, company_name = null, email = null, phones = '{}'
    from public.qbo_customer_matches m
   where m.connection_id = q.connection_id and m.qbo_id = q.qbo_id and m.client_id = p_id
     and q.display_name <> '(anonymisé)';
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  return v_total;
end;
$$;
revoke all on function private.billing_reassign_client(uuid, uuid), private.billing_anonymize_client(uuid)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- The keep-alive job: refresh the tokens daily so the 100-day refresh token never lapses while
-- nothing is pushed (maintenance: always on; it does nothing without a connection).
-- =============================================================================
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('billing.qbo_token_refresh', 'billing', 'Maintien de la connexion QuickBooks',
   'Renouvelle chaque jour l''accès à QuickBooks, pour que la connexion n''expire pas (Intuit la coupe après 100 jours sans usage).',
   'function', 'qbo-token-refresh', null, 'billing.qbo_token_refresh', null, true)
on conflict do nothing;

select cron.schedule('billing.qbo_token_refresh', '17 7 * * *',
  $$select private.invoke_job_function('billing.qbo_token_refresh')$$);
