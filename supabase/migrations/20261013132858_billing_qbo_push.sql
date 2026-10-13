-- =============================================================================
-- Facturation, batch FQ part 2: the push to QuickBooks Online
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (FQ); roadmap §2.6
-- Decisions: FQ-6 … FQ-10 (docs/plans/2026-10-07-decisions-log.md)
-- Needs:     FQ part 1 (`qbo_*`), F2's outbox (`billing_sync_events` and its two service RPCs,
--            `private.billing_invoice_for_sync` / `billing_payment_for_sync`, agreed with lane A),
--            FPay's `professional_invoices` (`qbo_bill_id`, lane C), Clients' and Professionnels'
--            published reads.
--
-- What the job `billing.qbo_push` (function `qbo-push`) sends, in the outbox's order:
-- * `invoice_issued` → an Invoice for the (payer, dossier) sub-customer (R-30: the payer a parent
--   customer, matched in part 1 or created on first use), its lines by item: the QuickBooks item of
--   the service code (GOrendezvous's), else one made for it on the income account of its kind
--   (`revenue.file_opening` for a file opening, `revenue.services` otherwise); the tax code
--   « taxable » or « exempt » per line (`tax.taxable`, `tax.exempt` in the map).
-- * `invoice_credited` → a CreditMemo with the invoice's lines, for the same customer.
-- * `payment_recorded` → a Payment applied to the pushed invoice, deposited to the account of its
--   mode (`deposit.<code>`); it waits for its invoice.
-- * `payment_refunded` (F3) → not yet: left pending with `not_supported`.
-- * The professionals' invoices (FPay, a validated or paid period with its invoice) → a Bill for
--   her vendor (made on first use), on the expense account of her specialty.
-- Nothing is pushed while the clinic's switch is on « En pause » — the default (FQ-6): the
-- go/no-go of the cutover turns it off. Each push is recorded in `qbo_pushes` (its state, the
-- QuickBooks id, the tries, the next try with a backoff), which the settings and an invoice read.
-- Idempotent: a document already pushed is never sent again (its row), and each create carries a
-- `requestid` derived from the entity, so an answer lost in transit is not a second document.
-- Additive: tables, functions, catalogue rows, one job; part 1's map check and two of its
-- functions widened (same signatures).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:billing_qbo_push', true);

-- -----------------------------------------------------------------------------
-- The company's items and tax codes (mirrors, read by the sync; not audited, like the accounts)
-- -----------------------------------------------------------------------------
create table public.qbo_items (
  connection_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  qbo_id text not null,
  name text not null,
  sku text,
  item_type text,
  income_account_id text,
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  constraint qbo_items_pkey primary key (connection_id, qbo_id),
  constraint qbo_items_connection_fkey foreign key (org_id, connection_id)
    references public.qbo_connections(org_id, id) on delete cascade,
  constraint qbo_items_id_check check (qbo_id ~ '^[0-9]{1,32}$'),
  constraint qbo_items_text_check check (
    pg_catalog.length(name) between 1 and 200 and pg_catalog.length(coalesce(sku, '')) <= 100
    and pg_catalog.length(coalesce(item_type, '')) <= 32)
);
create index qbo_items_org_connection_idx on public.qbo_items (org_id, connection_id);
revoke all on public.qbo_items from anon, authenticated;
grant select on public.qbo_items to authenticated;
alter table public.qbo_items enable row level security;
create policy qbo_items_select on public.qbo_items
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.settings')));

create table public.qbo_tax_codes (
  connection_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  qbo_id text not null,
  name text not null,
  taxable boolean,
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  constraint qbo_tax_codes_pkey primary key (connection_id, qbo_id),
  constraint qbo_tax_codes_connection_fkey foreign key (org_id, connection_id)
    references public.qbo_connections(org_id, id) on delete cascade,
  constraint qbo_tax_codes_id_check check (qbo_id ~ '^[A-Za-z0-9]{1,32}$'),
  constraint qbo_tax_codes_name_check check (pg_catalog.length(name) between 1 and 200)
);
create index qbo_tax_codes_org_connection_idx on public.qbo_tax_codes (org_id, connection_id);
revoke all on public.qbo_tax_codes from anon, authenticated;
grant select on public.qbo_tax_codes to authenticated;
alter table public.qbo_tax_codes enable row level security;
create policy qbo_tax_codes_select on public.qbo_tax_codes
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.settings')));

-- The map gains the two tax codes (their id in `qbo_account_id`: a TaxCode's, not an account's).
alter table public.qbo_account_map drop constraint qbo_account_map_key_check;
alter table public.qbo_account_map add constraint qbo_account_map_key_check check (
  map_key in ('revenue.services', 'revenue.file_opening', 'expense', 'tax.taxable', 'tax.exempt')
  or map_key ~ '^deposit\.[a-z][a-z0-9_]{1,40}$');
alter table public.qbo_account_map drop constraint qbo_account_map_account_check;
alter table public.qbo_account_map add constraint qbo_account_map_account_check check (
  qbo_account_id is null
  or (map_key like 'tax.%' and qbo_account_id ~ '^[A-Za-z0-9]{1,32}$')
  or (map_key not like 'tax.%' and qbo_account_id ~ '^[0-9]{1,32}$'));

-- -----------------------------------------------------------------------------
-- qbo_vendor_links: a professional's vendor (made by the push on her first bill; audited)
-- -----------------------------------------------------------------------------
create table public.qbo_vendor_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  professional_id uuid not null,
  qbo_vendor_id text not null,
  created_at timestamptz not null default now(),
  constraint qbo_vendor_links_connection_fkey foreign key (org_id, connection_id)
    references public.qbo_connections(org_id, id) on delete cascade,
  constraint qbo_vendor_links_professional_fkey foreign key (org_id, professional_id)
    references public.professionals(org_id, id),
  constraint qbo_vendor_links_vendor_check check (qbo_vendor_id ~ '^[0-9]{1,32}$'),
  constraint qbo_vendor_links_key unique (connection_id, professional_id)
);
create index qbo_vendor_links_org_idx on public.qbo_vendor_links (org_id, professional_id);
revoke all on public.qbo_vendor_links from anon, authenticated;
grant select on public.qbo_vendor_links to authenticated;
alter table public.qbo_vendor_links enable row level security;
create policy qbo_vendor_links_select on public.qbo_vendor_links
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.settings')));
create trigger qbo_vendor_links_audit after insert or update or delete on public.qbo_vendor_links
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- qbo_pushes: each document's push (its state; ids and codes only; not audited, see 000)
-- -----------------------------------------------------------------------------
-- kind: `invoice`, `credit_memo`, `payment` (entity: the invoice, the credit note, the payment),
-- `bill` (entity: the professional's invoice). status: `pending` (to try, from next_attempt_at),
-- `pushed` (qbo_id), `failed` (8 tries: waits for « Réessayer »).
create table public.qbo_pushes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  entity_id uuid not null,
  invoice_id uuid,
  event_id bigint,
  status text not null default 'pending',
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  qbo_id text,
  qbo_customer_id text,
  -- QuickBooks' total differed from ours (its tax rounding): pushed, shown to check.
  amount_mismatch boolean not null default false,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qbo_pushes_kind_check check (kind in ('invoice', 'credit_memo', 'payment', 'bill')),
  constraint qbo_pushes_status_check check (status in ('pending', 'pushed', 'failed')),
  constraint qbo_pushes_error_check check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,40}$'),
  constraint qbo_pushes_qbo_check check (qbo_id is null or qbo_id ~ '^[0-9]{1,32}$'),
  constraint qbo_pushes_pushed_check check ((status = 'pushed') = (qbo_id is not null and pushed_at is not null)),
  constraint qbo_pushes_entity_key unique (org_id, kind, entity_id)
);
create index qbo_pushes_org_status_idx on public.qbo_pushes (org_id, status, next_attempt_at);
create index qbo_pushes_org_invoice_idx on public.qbo_pushes (org_id, invoice_id) where invoice_id is not null;
create trigger qbo_pushes_set_updated_at before update on public.qbo_pushes
  for each row execute function private.set_updated_at();
revoke all on public.qbo_pushes from anon, authenticated;
alter table public.qbo_pushes enable row level security;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- The clinic's switch (org_module_settings, module billing, `qbo_push_paused`): absent is paused.
create function private.qbo_push_paused(p_org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select (s.settings ->> 'qbo_push_paused')::boolean
                     from public.org_module_settings s where s.org_id = p_org and s.module_key = 'billing'), true)
$$;
revoke all on function private.qbo_push_paused(uuid) from public, anon, authenticated, service_role;

-- The wait before try n+1 (FQ-8): 5 min, 10, 20 … at most 12 h.
create function private.qbo_push_backoff(p_attempts int)
returns interval
language sql
immutable
set search_path = ''
as $$
  select least(pg_catalog.make_interval(mins => (5 * pg_catalog.power(2, greatest(p_attempts - 1, 0)))::int),
               interval '12 hours')
$$;
revoke all on function private.qbo_push_backoff(int) from public, anon, authenticated, service_role;

-- A client as the push names it (Clients' published facts): number, first and last names.
create function private.qbo_person(p_org uuid, p_client uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'client_id', f.client_id, 'client_number', f.client_number, 'first_name', coalesce(f.first_name, ''),
           'last_name', pg_catalog.btrim(pg_catalog.substr(f.display_name, pg_catalog.length(coalesce(f.first_name, '')) + 1)))
    from private.clients_billing_facts(p_org, array[p_client]) f
   where f.found
$$;
revoke all on function private.qbo_person(uuid, uuid) from public, anon, authenticated, service_role;

-- The map's id for a key (an account, or a tax code for `tax.*`), or null.
create function private.qbo_mapped(p_org uuid, p_key text)
returns text
language sql
stable
set search_path = ''
as $$
  select m.qbo_account_id from public.qbo_account_map m
   where m.org_id = p_org and m.map_key = p_key and m.profession_title_id is null
$$;
revoke all on function private.qbo_mapped(uuid, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The sync's new reads (service role): items and tax codes, then the defaults
-- -----------------------------------------------------------------------------
create function public.replace_qbo_items(p_org_id uuid, p_items jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
  v_count int;
begin
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' or pg_catalog.jsonb_array_length(p_items) > 5000 then
    raise exception 'Items must be an array of at most 5000' using errcode = '22023';
  end if;
  select c.id into v_connection from public.qbo_connections c where c.org_id = p_org_id and c.status <> 'disconnected';
  if v_connection is null then
    raise exception 'No connection' using errcode = '22023';
  end if;
  insert into public.qbo_items as i (connection_id, org_id, qbo_id, name, sku, item_type, income_account_id, active, synced_at)
  select v_connection, p_org_id, x.id, pg_catalog.left(x.name, 200), nullif(pg_catalog.left(x.sku, 100), ''),
         pg_catalog.left(x.item_type, 32), x.income_account_id, coalesce(x.active, true), pg_catalog.now()
    from pg_catalog.jsonb_to_recordset(p_items) as x(id text, name text, sku text, item_type text, income_account_id text, active boolean)
  on conflict (connection_id, qbo_id) do update
    set name = excluded.name, sku = excluded.sku, item_type = excluded.item_type,
        income_account_id = excluded.income_account_id, active = excluded.active, synced_at = excluded.synced_at;
  get diagnostics v_count = row_count;
  delete from public.qbo_items i
   where i.connection_id = v_connection and i.qbo_id not in (select x ->> 'id' from pg_catalog.jsonb_array_elements(p_items) x);
  return v_count;
end;
$$;
revoke all on function public.replace_qbo_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_qbo_items(uuid, jsonb) to service_role;

create function public.replace_qbo_tax_codes(p_org_id uuid, p_codes jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
begin
  if p_codes is null or pg_catalog.jsonb_typeof(p_codes) <> 'array' or pg_catalog.jsonb_array_length(p_codes) > 500 then
    raise exception 'Tax codes must be an array of at most 500' using errcode = '22023';
  end if;
  select c.id into v_connection from public.qbo_connections c where c.org_id = p_org_id and c.status <> 'disconnected';
  if v_connection is null then
    raise exception 'No connection' using errcode = '22023';
  end if;
  insert into public.qbo_tax_codes as t (connection_id, org_id, qbo_id, name, taxable, active, synced_at)
  select v_connection, p_org_id, x.id, pg_catalog.left(x.name, 200), x.taxable, coalesce(x.active, true), pg_catalog.now()
    from pg_catalog.jsonb_to_recordset(p_codes) as x(id text, name text, taxable boolean, active boolean)
  on conflict (connection_id, qbo_id) do update
    set name = excluded.name, taxable = excluded.taxable, active = excluded.active, synced_at = excluded.synced_at;
  delete from public.qbo_tax_codes t
   where t.connection_id = v_connection and t.qbo_id not in (select x ->> 'id' from pg_catalog.jsonb_array_elements(p_codes) x);
  perform pg_catalog.set_config('app.audit_source', 'rpc:replace_qbo_tax_codes', true);
  -- The two tax rows, suggested (« TPS/TVQ QC », « Exonéré »), never over a person's choice.
  insert into public.qbo_account_map (org_id, map_key) values (p_org_id, 'tax.taxable'), (p_org_id, 'tax.exempt')
  on conflict do nothing;
  update public.qbo_account_map m
     set qbo_account_id = d.code_id, suggested = d.code_id is not null
    from (select m2.id,
                 (select t.qbo_id from public.qbo_tax_codes t
                   where t.connection_id = v_connection and t.active
                     and case m2.map_key
                           when 'tax.taxable' then private.qbo_fold(t.name) ~ '(tps.*tvq|gst.*qst)'
                           else private.qbo_fold(t.name) ~ '(exonere|exempt|detaxe|zero)'
                         end
                   order by pg_catalog.length(t.name), t.qbo_id limit 1) as code_id
            from public.qbo_account_map m2
           where m2.org_id = p_org_id and m2.map_key like 'tax.%' and (m2.qbo_account_id is null or m2.suggested)) d
   where m.id = d.id and m.qbo_account_id is distinct from d.code_id;
  return (select pg_catalog.count(*)::int from public.qbo_tax_codes t where t.connection_id = v_connection);
end;
$$;
revoke all on function public.replace_qbo_tax_codes(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_qbo_tax_codes(uuid, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- The push (service role: the job `qbo-push`)
-- -----------------------------------------------------------------------------
-- The clinic's state for a pass: whether to push (connected, not paused), and the map.
create function public.qbo_push_state_for_service(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'connection_id', c.id,
           'status', c.status,
           'paused', private.qbo_push_paused(p_org_id),
           'module_enabled', public.module_enabled_for_org(p_org_id, 'billing'))
    from public.qbo_connections c where c.org_id = p_org_id
$$;
revoke all on function public.qbo_push_state_for_service(uuid) from public, anon, authenticated;
grant execute on function public.qbo_push_state_for_service(uuid) to service_role;

-- What one outbox event needs pushed, or why it waits. p_kind / p_entity / p_invoice: the event's.
-- Answers {action: 'push' | 'done' | 'wait' | 'missing_map', kind, ...}:
--   done    the document is already in QuickBooks (its row): the event is closed;
--   wait    its next try is later, or (a payment) its invoice is not pushed yet;
--   push    with the document, the payer and dossier (names, the customers already known), the
--           items per line (the mapped item, or what to create), the accounts and tax codes.
create function public.prepare_qbo_push_for_service(p_org_id uuid, p_kind text, p_entity uuid, p_invoice uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
  v_push_kind text := case p_kind when 'invoice_issued' then 'invoice' when 'invoice_credited' then 'credit_memo'
                                  when 'payment_recorded' then 'payment' end;
  v_push public.qbo_pushes;
  v_invoice jsonb;
  v_payment jsonb;
  v_payer uuid;
  v_client uuid;
  v_invoice_push public.qbo_pushes;
  v_missing text[] := '{}';
  v_lines jsonb;
begin
  if v_push_kind is null then
    return pg_catalog.jsonb_build_object('action', 'unsupported');
  end if;
  select c.id into v_connection from public.qbo_connections c where c.org_id = p_org_id and c.status = 'connected';
  if v_connection is null then
    return pg_catalog.jsonb_build_object('action', 'wait', 'reason', 'not_connected');
  end if;
  select p.* into v_push from public.qbo_pushes p where p.org_id = p_org_id and p.kind = v_push_kind and p.entity_id = p_entity;
  if v_push.status = 'pushed' then
    return pg_catalog.jsonb_build_object('action', 'done', 'qbo_id', v_push.qbo_id);
  end if;
  if v_push.id is not null and (v_push.status = 'failed' or v_push.next_attempt_at > pg_catalog.now()) then
    return pg_catalog.jsonb_build_object('action', 'wait', 'reason', 'backoff');
  end if;

  v_invoice := private.billing_invoice_for_sync(p_org_id, p_invoice);
  if v_invoice is null then
    return pg_catalog.jsonb_build_object('action', 'gone');
  end if;
  v_payer := (v_invoice ->> 'payer_client_id')::uuid;
  v_client := (v_invoice ->> 'client_id')::uuid;

  if v_push_kind = 'payment' then
    v_payment := private.billing_payment_for_sync(p_org_id, p_entity);
    if v_payment is null then
      return pg_catalog.jsonb_build_object('action', 'gone');
    end if;
    select p.* into v_invoice_push from public.qbo_pushes p
     where p.org_id = p_org_id and p.kind = 'invoice' and p.entity_id = p_invoice and p.status = 'pushed';
    if v_invoice_push.id is null then
      return pg_catalog.jsonb_build_object('action', 'wait', 'reason', 'invoice_not_pushed');
    end if;
    if private.qbo_mapped(p_org_id, 'deposit.' || (v_payment ->> 'mode_code')) is null then
      v_missing := v_missing || ('deposit.' || (v_payment ->> 'mode_code'));
    end if;
  else
    if private.qbo_mapped(p_org_id, 'revenue.services') is null then v_missing := v_missing || 'revenue.services'::text; end if;
    if private.qbo_mapped(p_org_id, 'revenue.file_opening') is null then v_missing := v_missing || 'revenue.file_opening'::text; end if;
    if private.qbo_mapped(p_org_id, 'tax.taxable') is null then v_missing := v_missing || 'tax.taxable'::text; end if;
    if private.qbo_mapped(p_org_id, 'tax.exempt') is null then v_missing := v_missing || 'tax.exempt'::text; end if;
    if v_push_kind = 'credit_memo' then
      select p.* into v_invoice_push from public.qbo_pushes p
       where p.org_id = p_org_id and p.kind = 'invoice' and p.entity_id = p_invoice and p.status = 'pushed';
      if v_invoice_push.id is null then
        return pg_catalog.jsonb_build_object('action', 'wait', 'reason', 'invoice_not_pushed');
      end if;
    end if;
  end if;
  if pg_catalog.cardinality(v_missing) > 0 then
    return pg_catalog.jsonb_build_object('action', 'missing_map', 'keys', pg_catalog.to_jsonb(v_missing));
  end if;

  -- Each line's item: the company's item for the service code (its SKU, else a name starting
  -- with the code), else one to create on the account of the line's kind.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', l ->> 'id', 'line_type', l ->> 'line_type', 'service_code', l ->> 'service_code',
           'quantity', l -> 'quantity', 'unit_price_cents', l -> 'unit_price_cents', 'subtotal_cents', l -> 'subtotal_cents',
           'total_cents', l -> 'total_cents', 'taxable', (l ->> 'tax_rule') = 'taxable' and not coalesce((v_invoice ->> 'tax_exempt')::boolean, false),
           'description', coalesce(s.name, case l ->> 'line_type' when 'file_opening' then 'Ouverture de dossier' else 'Service' end),
           'item_id', (select i.qbo_id from public.qbo_items i
                        where i.connection_id = v_connection and i.active and l ->> 'service_code' is not null
                          and (i.sku = l ->> 'service_code' or i.name = l ->> 'service_code'
                               or i.name like (l ->> 'service_code') || ' %')
                        order by (i.sku = l ->> 'service_code') desc, pg_catalog.length(i.name), i.qbo_id limit 1),
           'item_name', pg_catalog.left(coalesce(l ->> 'service_code' || ' ', '') || coalesce(s.name,
                          case l ->> 'line_type' when 'file_opening' then 'Ouverture de dossier' else 'Services' end), 100),
           'income_account_id', private.qbo_mapped(p_org_id,
                                  case l ->> 'line_type' when 'file_opening' then 'revenue.file_opening' else 'revenue.services' end))
           order by (l ->> 'position')::int), '[]'::jsonb)
    into v_lines
    from pg_catalog.jsonb_array_elements(v_invoice -> 'lines') l
    left join public.services_catalog s on s.org_id = p_org_id and s.id = (l ->> 'service_id')::uuid;

  return pg_catalog.jsonb_build_object(
    'action', 'push',
    'push_kind', v_push_kind,
    'connection_id', v_connection,
    'attempts', coalesce(v_push.attempts, 0),
    'invoice', v_invoice - 'lines',
    'lines', v_lines,
    'payment', v_payment,
    'invoice_qbo_id', v_invoice_push.qbo_id,
    'invoice_customer_id', v_invoice_push.qbo_customer_id,
    'payer', private.qbo_person(p_org_id, v_payer),
    'dossier', private.qbo_person(p_org_id, v_client),
    'payer_customer_id', (select l.qbo_customer_id from public.qbo_links l
                           where l.connection_id = v_connection and l.kind = 'payer' and l.payer_client_id = v_payer),
    'dossier_customer_id', (select l.qbo_customer_id from public.qbo_links l
                             where l.connection_id = v_connection and l.kind = 'dossier' and l.payer_client_id = v_payer
                               and l.client_id = v_client),
    'tax_taxable', private.qbo_mapped(p_org_id, 'tax.taxable'),
    'tax_exempt', private.qbo_mapped(p_org_id, 'tax.exempt'),
    'deposit_account_id', case when v_payment is not null then private.qbo_mapped(p_org_id, 'deposit.' || (v_payment ->> 'mode_code')) end);
end;
$$;
revoke all on function public.prepare_qbo_push_for_service(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_qbo_push_for_service(uuid, text, uuid, uuid) to service_role;

-- A customer the push matched or made (part 1's links: the payer's parent, the dossier's sub-customer).
create function public.record_qbo_link_for_service(p_org_id uuid, p_kind text, p_payer uuid, p_client uuid, p_qbo_customer_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
begin
  select c.id into v_connection from public.qbo_connections c where c.org_id = p_org_id;
  if v_connection is null or p_kind not in ('payer', 'dossier') then
    raise exception 'Invalid link' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'fn:qbo-push', true);
  insert into public.qbo_links (connection_id, org_id, kind, payer_client_id, client_id, qbo_customer_id, source)
  values (v_connection, p_org_id, p_kind, p_payer, case when p_kind = 'dossier' then p_client end, p_qbo_customer_id, 'created')
  on conflict do nothing;
end;
$$;
revoke all on function public.record_qbo_link_for_service(uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_qbo_link_for_service(uuid, text, uuid, uuid, text) to service_role;

-- An item the push made for a service code (kept in the mirror until the next sync reads it).
create function public.record_qbo_item_for_service(p_org_id uuid, p_qbo_id text, p_name text, p_sku text, p_income_account_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
begin
  select c.id into v_connection from public.qbo_connections c where c.org_id = p_org_id;
  if v_connection is null then
    raise exception 'No connection' using errcode = '22023';
  end if;
  insert into public.qbo_items (connection_id, org_id, qbo_id, name, sku, item_type, income_account_id, active)
  values (v_connection, p_org_id, p_qbo_id, pg_catalog.left(p_name, 200), nullif(p_sku, ''), 'Service', p_income_account_id, true)
  on conflict (connection_id, qbo_id) do nothing;
end;
$$;
revoke all on function public.record_qbo_item_for_service(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_qbo_item_for_service(uuid, text, text, text, text) to service_role;

-- The outcome of one push (p_qbo_id: pushed; else a code: one more try after the backoff, failed
-- after 8). Returns the row's state.
create function public.record_qbo_push_for_service(
  p_org_id uuid,
  p_kind text,
  p_entity uuid,
  p_invoice uuid,
  p_event_id bigint,
  p_qbo_id text,
  p_qbo_customer_id text,
  p_error_code text,
  p_amount_mismatch boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.qbo_pushes;
begin
  if p_kind not in ('invoice', 'credit_memo', 'payment', 'bill') or (p_qbo_id is null) = (p_error_code is null) then
    raise exception 'Invalid push outcome' using errcode = '22023';
  end if;
  insert into public.qbo_pushes as q (org_id, kind, entity_id, invoice_id, event_id)
  values (p_org_id, p_kind, p_entity, p_invoice, p_event_id)
  on conflict (org_id, kind, entity_id) do update set event_id = coalesce(excluded.event_id, q.event_id)
  returning * into v;
  if p_qbo_id is not null then
    update public.qbo_pushes q
       set status = 'pushed', qbo_id = p_qbo_id, qbo_customer_id = p_qbo_customer_id, pushed_at = pg_catalog.now(),
           last_error_code = null, amount_mismatch = coalesce(p_amount_mismatch, false), attempts = q.attempts + 1
     where q.id = v.id;
    if p_kind = 'bill' then
      update public.professional_invoices i set qbo_bill_id = p_qbo_id, exported_at = pg_catalog.now()
       where i.org_id = p_org_id and i.id = p_entity and i.qbo_bill_id is null;
    end if;
    return 'pushed';
  end if;
  update public.qbo_pushes q
     set attempts = q.attempts + 1, last_error_code = p_error_code,
         status = case when q.attempts + 1 >= 8 then 'failed' else 'pending' end,
         next_attempt_at = pg_catalog.now() + private.qbo_push_backoff(q.attempts + 1)
   where q.id = v.id
  returning * into v;
  return v.status;
end;
$$;
revoke all on function public.record_qbo_push_for_service(uuid, text, uuid, uuid, bigint, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_qbo_push_for_service(uuid, text, uuid, uuid, bigint, text, text, text, boolean) to service_role;

-- The professionals' invoices to bill (FPay: a validated or paid period with its invoice, not
-- billed yet, not waiting), oldest first, with what the Bill needs: the vendor (or the name to make
-- one), the amount, the expense account of her specialty (the period's title).
create function public.qbo_bills_to_push_for_service(p_org_id uuid, p_limit int default 20)
returns table (invoice_id uuid, professional_id uuid, professional_name text, number text, issued_on date,
               amount_cents int, vendor_id text, expense_account_id text, title_name text, attempts int)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, p.professional_id, n.display_name, i.number, i.issued_on, i.amount_cents,
         (select v.qbo_vendor_id from public.qbo_vendor_links v
           join public.qbo_connections c on c.id = v.connection_id
          where c.org_id = p_org_id and v.professional_id = p.professional_id),
         (select m.qbo_account_id from public.qbo_account_map m
           join public.profession_titles_catalog t on t.id = m.profession_title_id
          where m.org_id = p_org_id and m.map_key = 'expense'
            and p.title_name is not null and p.title_name in (t.name, t.name_feminine, t.name_masculine)
          limit 1),
         p.title_name,
         coalesce(q.attempts, 0)
    from public.professional_invoices i
    join public.payout_periods p on p.org_id = i.org_id and p.id = i.period_id
    left join public.qbo_pushes q on q.org_id = i.org_id and q.kind = 'bill' and q.entity_id = i.id
    left join private.professional_display_names(p_org_id,
           (select coalesce(pg_catalog.array_agg(x.professional_id), '{}') from public.payout_periods x where x.org_id = p_org_id)) n
      on n.professional_id = p.professional_id
   where i.org_id = p_org_id and p.state in ('validated', 'paid') and i.qbo_bill_id is null
     and (q.id is null or (q.status = 'pending' and q.next_attempt_at <= pg_catalog.now()))
   order by i.issued_on, i.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;
revoke all on function public.qbo_bills_to_push_for_service(uuid, int) from public, anon, authenticated;
grant execute on function public.qbo_bills_to_push_for_service(uuid, int) to service_role;

create function public.record_qbo_vendor_for_service(p_org_id uuid, p_professional uuid, p_qbo_vendor_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
begin
  select c.id into v_connection from public.qbo_connections c where c.org_id = p_org_id;
  if v_connection is null then
    raise exception 'No connection' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'fn:qbo-push', true);
  insert into public.qbo_vendor_links (connection_id, org_id, professional_id, qbo_vendor_id)
  values (v_connection, p_org_id, p_professional, p_qbo_vendor_id)
  on conflict (connection_id, professional_id) do nothing;
end;
$$;
revoke all on function public.record_qbo_vendor_for_service(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_qbo_vendor_for_service(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- User RPCs (billing.settings; an invoice's state with billing.view)
-- -----------------------------------------------------------------------------
-- « En pause » / « Envoi actif » (FQ-6). Audited through org_module_settings.
create function public.set_qbo_push_paused(p_paused boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.qbo_require_settings();
begin
  if p_paused is null then
    raise exception 'A state' using errcode = '22023';
  end if;
  if not p_paused and not exists (select 1 from public.qbo_connections c where c.org_id = v_org and c.status = 'connected') then
    raise exception 'Connectez d''abord QuickBooks.' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_qbo_push_paused', true);
  insert into public.org_module_settings as s (org_id, module_key, settings, updated_by)
  values (v_org, 'billing', pg_catalog.jsonb_build_object('qbo_push_paused', p_paused), auth.uid())
  on conflict (org_id, module_key) do update
    set settings = s.settings || pg_catalog.jsonb_build_object('qbo_push_paused', p_paused), updated_by = auth.uid();
end;
$$;
revoke all on function public.set_qbo_push_paused(boolean) from public, anon, authenticated;
grant execute on function public.set_qbo_push_paused(boolean) to authenticated;

-- « Envois à QuickBooks »: the switch, the counts per state, then the pushes not done (or all),
-- newest first, with the invoice's number.
create function public.list_qbo_pushes(p_status text default null, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.qbo_require_settings();
begin
  return pg_catalog.jsonb_build_object(
    'paused', private.qbo_push_paused(v_org),
    'pending_events', (select pg_catalog.count(*) from public.billing_sync_events e where e.org_id = v_org and e.processed_at is null),
    'counts', (select coalesce(pg_catalog.jsonb_object_agg(x.status, x.n), '{}'::jsonb)
                 from (select q.status, pg_catalog.count(*) as n from public.qbo_pushes q where q.org_id = v_org group by q.status) x),
    'pushes', coalesce((select pg_catalog.jsonb_agg(r order by r.updated_at desc) from (
        select q.id, q.kind, q.entity_id, q.invoice_id, inv.number as invoice_number, q.status, q.attempts,
               q.next_attempt_at, q.last_error_code, q.qbo_id, q.amount_mismatch, q.pushed_at, q.updated_at
          from public.qbo_pushes q
          left join public.invoices inv on inv.org_id = q.org_id and inv.id = q.invoice_id
         where q.org_id = v_org and (p_status is null or q.status = p_status)
         order by q.updated_at desc
         limit least(greatest(coalesce(p_limit, 100), 1), 500)) r), '[]'::jsonb));
end;
$$;
revoke all on function public.list_qbo_pushes(text, int) from public, anon, authenticated;
grant execute on function public.list_qbo_pushes(text, int) to authenticated;

-- « Réessayer » a failed (or waiting) push: tried at the next pass.
create function public.retry_qbo_push(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.qbo_require_settings();
begin
  update public.qbo_pushes q
     set status = 'pending', next_attempt_at = pg_catalog.now(), attempts = least(q.attempts, 7)
   where q.id = p_id and q.org_id = v_org and q.status <> 'pushed';
  if not found then
    raise exception 'Cet envoi n''est plus à reprendre.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.retry_qbo_push(uuid) from public, anon, authenticated;
grant execute on function public.retry_qbo_push(uuid) to authenticated;

-- An invoice's state in QuickBooks (the invoice page): its own push, its credit memo's and its
-- payments'. `not_sent` when nothing was tried yet (paused, or not reached).
create function public.qbo_invoice_push_status(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('billing.view') then
    raise exception 'Permission refusée : billing.view' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'paused', private.qbo_push_paused(v_org),
    'connected', exists (select 1 from public.qbo_connections c where c.org_id = v_org and c.status = 'connected'),
    'pushes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'kind', q.kind, 'status', q.status, 'pushed_at', q.pushed_at, 'last_error_code', q.last_error_code,
                 'amount_mismatch', q.amount_mismatch) order by q.created_at)
                from public.qbo_pushes q where q.org_id = v_org and q.invoice_id = p_invoice_id), '[]'::jsonb));
end;
$$;
revoke all on function public.qbo_invoice_push_status(uuid) from public, anon, authenticated;
grant execute on function public.qbo_invoice_push_status(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- The settings read gains the switch, the tax codes and the push counts (same signature)
-- -----------------------------------------------------------------------------
create or replace function public.get_qbo_settings()
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
    'tax_codes', coalesce((select jsonb_agg(jsonb_build_object('id', t.qbo_id, 'name', t.name) order by t.name)
                     from public.qbo_tax_codes t where t.connection_id = v_connection and t.active), '[]'::jsonb),
    'map', coalesce((select jsonb_agg(jsonb_build_object(
                     'key', m.map_key, 'profession_title_id', m.profession_title_id, 'profession_title_name', t.name,
                     'mode_name', pm.name, 'account_id', m.qbo_account_id, 'suggested', m.suggested)
                     order by m.map_key not like 'revenue.%', m.map_key like 'tax.%', pm.sort_order nulls last, m.map_key, t.sort_order, t.name)
                     from public.qbo_account_map m
                     left join public.profession_titles_catalog t on t.id = m.profession_title_id
                     left join public.payment_modes pm on pm.org_id = m.org_id and 'deposit.' || pm.code = m.map_key
                    where m.org_id = v_org and (m.profession_title_id is null or t.id is not null)
                      and (m.map_key not like 'deposit.%' or (pm.id is not null and pm.is_deposit and pm.is_active))), '[]'::jsonb),
    'push', jsonb_build_object(
              'paused', private.qbo_push_paused(v_org),
              'pending', (select count(*) from public.qbo_pushes q where q.org_id = v_org and q.status = 'pending'),
              'failed', (select count(*) from public.qbo_pushes q where q.org_id = v_org and q.status = 'failed'),
              'pushed', (select count(*) from public.qbo_pushes q where q.org_id = v_org and q.status = 'pushed'),
              'waiting_events', (select count(*) from public.billing_sync_events e where e.org_id = v_org and e.processed_at is null))
  );
end;
$$;

-- A map row: an account of the right kind, or (tax.*) one of the company's tax codes.
create or replace function public.set_qbo_account_map(p_key text, p_profession_title_id uuid, p_account_id text)
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
  if p_key not in ('revenue.services', 'revenue.file_opening', 'expense', 'tax.taxable', 'tax.exempt')
     and not exists (select 1 from public.payment_modes pm
                      where pm.org_id = v_org and pm.is_deposit and 'deposit.' || pm.code = p_key) then
    raise exception 'Unknown key' using errcode = '22023';
  end if;
  select c.id into v_connection from public.qbo_connections c where c.org_id = v_org and c.status <> 'disconnected';
  if v_connection is null then
    raise exception 'Connectez d''abord QuickBooks.' using errcode = 'P0001';
  end if;
  if p_account_id is not null and p_key like 'tax.%' then
    if not exists (select 1 from public.qbo_tax_codes t where t.connection_id = v_connection and t.qbo_id = p_account_id and t.active) then
      raise exception 'Ce code de taxe n''existe plus dans QuickBooks. Synchronisez, puis choisissez-en un autre.' using errcode = 'P0001';
    end if;
  elsif p_account_id is not null then
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

-- -----------------------------------------------------------------------------
-- The job (off until enabled; paused until the go/no-go)
-- -----------------------------------------------------------------------------
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('billing.qbo_push', 'billing', 'Envoi à QuickBooks',
   'Envoie à QuickBooks les factures émises, les notes de crédit, les paiements et les factures des professionnels, toutes les 10 minutes. Rien ne part tant que l''envoi est « En pause » dans Paramètres → QuickBooks.',
   'function', 'qbo-push', null, 'billing.qbo_push', null, false)
on conflict do nothing;

select cron.schedule('billing.qbo_push', '*/10 * * * *',
  $$select private.invoke_job_function('billing.qbo_push')$$);
